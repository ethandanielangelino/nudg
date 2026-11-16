import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalendarEvent } from "@/lib/types";
import { decryptChannelConfig } from "@/lib/channel-secrets";

export async function scheduleEventReminders(
  supabase: SupabaseClient,
  userId: string,
  event: Pick<CalendarEvent, "id" | "start_time" | "reminder_lead_minutes">,
  refreshExisting = false
) {
  const [{ data: profile, error: profileError }, { data: channels, error: channelError }] = await Promise.all([
    supabase.from("profiles").select("reminder_lead_minutes").eq("id", userId).maybeSingle(),
    supabase.from("reminder_channels").select("id, channel_type, channel_config").eq("user_id", userId).eq("is_active", true),
  ]);
  if (profileError) throw profileError;
  if (channelError) throw channelError;

  const startAt = new Date(event.start_time).getTime();
  const now = Date.now();
  const readyChannels = (channels ?? []).filter((channel) => {
    const config = decryptChannelConfig(channel.channel_config);
    const destination = channel.channel_type === "email" ? config.email
      : channel.channel_type === "telegram" ? config.chatId
      : channel.channel_type === "discord" ? config.webhookUrl
      : config.phoneNumber;
    return Boolean(destination?.trim());
  });
  if (!Number.isFinite(startAt) || startAt <= now || !readyChannels.length) {
    if (refreshExisting) {
      const message = !Number.isFinite(startAt) || startAt <= now
        ? "Event time has passed; reminder cancelled."
        : "No active reminder channel is configured.";
      const { error: cancelError } = await supabase.from("reminders").update({
        status: "failed", locked_at: null, last_error: message,
      }).eq("user_id", userId).eq("event_id", event.id).in("status", ["pending", "failed"]);
      if (cancelError) throw cancelError;
    }
    return 0;
  }

  const leadMinutes = Number(event.reminder_lead_minutes ?? profile?.reminder_lead_minutes ?? 15);
  const remindAt = new Date(Math.max(now, startAt - leadMinutes * 60_000)).toISOString();
  if (refreshExisting) {
    const readyChannelIds = readyChannels.map((channel) => channel.id);
    if (readyChannelIds.length) {
      const { error: refreshError } = await supabase.from("reminders").update({
        remind_at: remindAt,
        status: "pending",
        attempts: 0,
        last_error: null,
        locked_at: null,
      }).eq("user_id", userId).eq("event_id", event.id)
        .in("channel_id", readyChannelIds).in("status", ["pending", "failed"]);
      if (refreshError) throw refreshError;
    }
  }
  const { error } = await supabase.from("reminders").upsert(
    readyChannels.map((channel) => ({
      event_id: event.id,
      user_id: userId,
      channel_id: channel.id,
      remind_at: remindAt,
      status: "pending",
    })),
    { onConflict: "event_id,channel_id", ignoreDuplicates: true }
  );
  if (error) throw error;
  return readyChannels.length;
}
