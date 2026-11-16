import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { decryptChannelConfig } from "@/lib/channel-secrets";
import { createEventActionToken } from "@/lib/event-actions";
import {
  sendDiscordReminder,
  sendEmailReminder,
  sendTelegramReminder,
  sendWhatsAppReminder,
  type NotificationPayload,
} from "@/lib/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function deliver(channelType: string, payload: NotificationPayload) {
  switch (channelType) {
    case "email": return sendEmailReminder(payload);
    case "telegram": return sendTelegramReminder(payload);
    case "discord": return sendDiscordReminder(payload);
    case "whatsapp": return sendWhatsAppReminder(payload);
    default: return { success: false, error: "Unsupported reminder channel." };
  }
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!projectUrl || !secretKey) {
    return NextResponse.json({ error: "Reminder worker is missing its server Supabase credentials." }, { status: 503 });
  }

  try {
    const supabase = createSupabaseClient(projectUrl, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const now = new Date();
    const staleLock = new Date(now.getTime() - 10 * 60_000).toISOString();
    const { error: unlockError } = await supabase.from("reminders")
      .update({ status: "pending", locked_at: null })
      .eq("status", "processing").lt("locked_at", staleLock);
    if (unlockError) throw unlockError;

    const { data: due, error: dueError } = await supabase.from("reminders")
      .select("id, event_id, user_id, channel_id, remind_at, attempts")
      .eq("status", "pending").lte("remind_at", now.toISOString())
      .order("remind_at", { ascending: true }).limit(25);
    if (dueError) throw dueError;

    let sent = 0;
    let retried = 0;
    let failed = 0;
    for (const reminder of due ?? []) {
      // Conditional update is the claim lock, preventing overlapping cron runs from double sending.
      const { data: claim, error: claimError } = await supabase.from("reminders")
        .update({ status: "processing", locked_at: now.toISOString() })
        .eq("id", reminder.id).eq("status", "pending").select("id").maybeSingle();
      if (claimError) throw claimError;
      if (!claim) continue;

      try {
        const [{ data: event, error: eventError }, { data: channel, error: channelError }, { data: profile, error: profileError }] = await Promise.all([
          supabase.from("events").select("id, user_id, title, description, start_time, location, priority, category, organization, project, status").eq("id", reminder.event_id).eq("user_id", reminder.user_id).maybeSingle(),
          supabase.from("reminder_channels").select("channel_type, channel_config, is_active").eq("id", reminder.channel_id).eq("user_id", reminder.user_id).maybeSingle(),
          supabase.from("profiles").select("timezone").eq("id", reminder.user_id).maybeSingle(),
        ]);
        if (eventError) throw eventError;
        if (channelError) throw channelError;
        if (profileError) throw profileError;
        if (!event || event.status !== "scheduled" || !channel || !channel.is_active) {
          await supabase.from("reminders").update({ status: "failed", last_error: "Event or active channel no longer exists.", locked_at: null }).eq("id", reminder.id);
          failed += 1;
          continue;
        }

        const config = decryptChannelConfig(channel.channel_config);
        const to = channel.channel_type === "email" ? config.email
          : channel.channel_type === "telegram" ? config.chatId
          : channel.channel_type === "discord" ? config.webhookUrl
          : config.phoneNumber;
        if (!to) throw new Error("No destination is configured for this channel.");

        const actionToken = createEventActionToken(event.id, reminder.user_id);
        const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL;
        const appOrigin = configuredAppUrl && !new URL(configuredAppUrl).hostname.includes("localhost")
          ? configuredAppUrl : new URL(request.url).origin;
        const manageUrl = new URL("/event-action", appOrigin);
        manageUrl.searchParams.set("token", actionToken);

        const result = await deliver(channel.channel_type, {
          to,
          title: event.title,
          description: event.description ?? undefined,
          startTime: event.start_time,
          timezone: profile?.timezone || "UTC",
          priority: event.priority,
          category: event.category,
          organization: event.organization ?? undefined,
          project: event.project ?? undefined,
          location: event.location ?? undefined,
          manageUrl: manageUrl.toString(),
        });
        if (result.success) {
          const { error } = await supabase.from("reminders")
            .update({ status: "sent", last_error: null, locked_at: null })
            .eq("id", reminder.id);
          if (error) throw error;
          const { error: sentAtError } = await supabase.from("reminders")
            .update({ sent_at: new Date().toISOString() }).eq("id", reminder.id);
          if (sentAtError) console.error("Could not record reminder delivery time:", sentAtError.message);
          sent += 1;
        } else {
          throw new Error(result.error || "Notification provider rejected the message.");
        }
      } catch (error) {
        const attempts = reminder.attempts + 1;
        const isFinal = attempts >= 3;
        const delayMinutes = [2, 10, 30][attempts - 1] ?? 30;
        const retryAt = new Date(Date.now() + delayMinutes * 60_000).toISOString();
        const message = (error instanceof Error ? error.message : "Notification delivery failed.").slice(0, 500);
        const { error: updateError } = await supabase.from("reminders").update({
          status: isFinal ? "failed" : "pending",
          attempts,
          last_error: message,
          locked_at: null,
          ...(isFinal ? {} : { remind_at: retryAt }),
        }).eq("id", reminder.id);
        if (updateError) throw updateError;
        if (isFinal) failed += 1;
        else retried += 1;
      }
    }

    return NextResponse.json({ processed: sent + retried + failed, sent, retried, failed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reminder worker failed.";
    console.error("Reminder cron failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
