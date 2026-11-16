import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decryptChannelConfig, encryptChannelConfig } from "@/lib/channel-secrets";
import type { ReminderChannel } from "@/lib/types";
import { scheduleEventReminders } from "@/lib/reminders";

const CHANNEL_TYPES = ["email", "telegram", "discord", "whatsapp"] as const;
type ChannelType = (typeof CHANNEL_TYPES)[number];
type ChannelValues = {
  email: string;
  telegramChatId: string;
  discordWebhook: string;
  whatsappPhone: string;
};

const EMPTY_VALUES: ChannelValues = {
  email: "",
  telegramChatId: "",
  discordWebhook: "",
  whatsappPhone: "",
};

function hasChannelValue(type: ChannelType, config: Record<string, string>) {
  const value = type === "email" ? config.email
    : type === "telegram" ? config.chatId
    : type === "discord" ? config.webhookUrl
    : config.phoneNumber;
  return Boolean(value?.trim());
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const [{ data: profile, error: profileError }, { data: rows, error: channelsError }] = await Promise.all([
      supabase.from("profiles").select("timezone, reminder_lead_minutes").eq("id", user.id).maybeSingle(),
      supabase.from("reminder_channels").select("id, channel_type, channel_config, is_active").eq("user_id", user.id),
    ]);
    if (profileError) throw profileError;
    if (channelsError) throw channelsError;

    const values: ChannelValues = { ...EMPTY_VALUES, email: user.email ?? "" };
    const activeChannels: Record<ChannelType, boolean> = {
      email: false, telegram: false, discord: false, whatsapp: false,
    };
    const configuredChannels: Record<ChannelType, boolean> = {
      email: false, telegram: false, discord: false, whatsapp: false,
    };

    for (const row of (rows ?? []) as Pick<ReminderChannel, "id" | "channel_type" | "channel_config" | "is_active">[]) {
      const type = row.channel_type as ChannelType;
      if (!CHANNEL_TYPES.includes(type)) continue;
      const config = decryptChannelConfig(row.channel_config);
      configuredChannels[type] = hasChannelValue(type, config);
      activeChannels[type] = row.is_active;

      // Migrate legacy plaintext settings into authenticated ciphertext.
      if (!("encrypted" in (row.channel_config ?? {}))) {
        const { error } = await supabase.from("reminder_channels")
          .update({ channel_config: { encrypted: encryptChannelConfig(config) } })
          .eq("id", row.id).eq("user_id", user.id);
        if (error) throw error;
      }

      if (type === "email") values.email = config.email ?? "";
      if (type === "telegram") values.telegramChatId = config.chatId ?? "";
      if (type === "whatsapp") values.whatsappPhone = config.phoneNumber ?? "";
      // Discord webhooks are intentionally never returned to the browser.
    }

    return NextResponse.json({
      values,
      activeChannels,
      configuredChannels,
      timezone: profile?.timezone || "UTC",
      leadTime: String(profile?.reminder_lead_minutes ?? 15),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load settings.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const timezone = typeof body.timezone === "string" ? body.timezone : "UTC";
    const leadTime = Number(body.leadTime);
    const validLeadTimes = [5, 15, 30, 60, 1440];
    if (!validLeadTimes.includes(leadTime)) {
      return NextResponse.json({ error: "Choose a valid reminder lead time." }, { status: 400 });
    }
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
    } catch {
      return NextResponse.json({ error: "Choose a valid timezone." }, { status: 400 });
    }

    const values = body.values as ChannelValues | undefined;
    const active = body.activeChannels as Partial<Record<ChannelType, boolean>> | undefined;
    if (!values || !active) return NextResponse.json({ error: "Channel settings are missing." }, { status: 400 });

    const { error: profileError } = await supabase.from("profiles")
      .update({ timezone, reminder_lead_minutes: leadTime, updated_at: new Date().toISOString() })
      .eq("id", user.id);
    if (profileError) throw profileError;

    const { data: existingRows, error: existingError } = await supabase
      .from("reminder_channels").select("id, channel_type, channel_config")
      .eq("user_id", user.id);
    if (existingError) throw existingError;
    const existing = new Map((existingRows ?? []).map((row) => [row.channel_type as ChannelType, row]));

    const entries: Array<{ type: ChannelType; config: Record<string, string> }> = [
      { type: "email", config: { email: values.email?.trim() ?? "" } },
      { type: "telegram", config: { chatId: values.telegramChatId?.trim() ?? "" } },
      { type: "discord", config: { webhookUrl: values.discordWebhook?.trim() ?? "" } },
      { type: "whatsapp", config: { phoneNumber: values.whatsappPhone?.trim() ?? "" } },
    ];

    for (const entry of entries) {
      const previous = existing.get(entry.type);
      const priorConfig = previous ? decryptChannelConfig(previous.channel_config) : {};
      // An empty Discord field means “keep the saved webhook”; only replace it when a new URL is entered.
      if (entry.type === "discord" && !entry.config.webhookUrl) {
        entry.config.webhookUrl = priorConfig.webhookUrl ?? "";
      }
      const encrypted = { encrypted: encryptChannelConfig(entry.config) };
      const channelRow = {
        channel_config: encrypted,
        is_active: Boolean(active[entry.type]),
      };
      const result = previous
        ? await supabase.from("reminder_channels").update(channelRow).eq("id", previous.id).eq("user_id", user.id)
        : await supabase.from("reminder_channels").insert({ ...channelRow, user_id: user.id, channel_type: entry.type });
      if (result.error) throw result.error;
    }

    const { data: savedChannels, error: savedChannelsError } = await supabase.from("reminder_channels")
      .select("id, channel_type, channel_config, is_active").eq("user_id", user.id);
    if (savedChannelsError) throw savedChannelsError;
    const isReady = (channel: { channel_type: string; channel_config: unknown; is_active: boolean }) => {
      if (!channel.is_active || !CHANNEL_TYPES.includes(channel.channel_type as ChannelType)) return false;
      const config = decryptChannelConfig(channel.channel_config);
      return hasChannelValue(channel.channel_type as ChannelType, config);
    };
    const activeIds = (savedChannels ?? []).filter(isReady).map((channel) => channel.id);
    const inactiveIds = (savedChannels ?? []).filter((channel) => !isReady(channel)).map((channel) => channel.id);
    if (inactiveIds.length) {
      const { error } = await supabase.from("reminders").update({
        status: "failed", locked_at: null, last_error: "Reminder channel is disabled or has no destination.",
      }).eq("user_id", user.id).eq("status", "pending").in("channel_id", inactiveIds);
      if (error) throw error;
    }

    let reminderWarning: string | null = null;
    const { data: upcomingEvents, error: eventsError } = await supabase.from("events")
      .select("id, start_time, reminder_lead_minutes").eq("user_id", user.id)
      .gt("start_time", new Date().toISOString()).order("start_time", { ascending: true }).limit(500);
    if (eventsError) {
      reminderWarning = "Preferences saved, but Nudg could not update reminders for existing events.";
    } else {
      try {
        for (const event of upcomingEvents ?? []) {
          const start = new Date(event.start_time).getTime();
          const eventLeadTime = event.reminder_lead_minutes ?? leadTime;
          const remindAt = new Date(Math.max(Date.now(), start - eventLeadTime * 60_000)).toISOString();
          if (activeIds.length) {
            const { error } = await supabase.from("reminders").update({
              status: "pending", remind_at: remindAt, attempts: 0, last_error: null, locked_at: null,
            }).eq("user_id", user.id).eq("event_id", event.id)
              .in("channel_id", activeIds).in("status", ["pending", "failed"]);
            if (error) throw error;
          }
          await scheduleEventReminders(supabase, user.id, event, true);
        }
      } catch (error) {
        console.error("Could not update reminders for existing events:", error);
        reminderWarning = "Preferences saved, but Nudg could not update reminders for existing events.";
      }
    }

    return NextResponse.json({ success: true, reminderWarning });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save settings.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
