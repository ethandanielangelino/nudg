import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { decryptChannelConfig } from "@/lib/channel-secrets";
import { createEventActionToken, createTelegramEventAction } from "@/lib/event-actions";
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

function missingOptionalColumn(error: { message?: string } | null, column: string) {
  return Boolean(error?.message && error.message.toLowerCase().includes(column.toLowerCase()) && /column|schema cache|does not exist|not found/i.test(error.message));
}

function describeDeliveryError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "Notification delivery failed.";
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

    let supportsRepeatReminders = true;
    let { data: due, error: dueError } = await supabase.from("reminders")
      .select("id, event_id, user_id, channel_id, remind_at, attempts, repeat_until_action")
      .or("status.eq.pending,and(status.eq.sent,repeat_until_action.eq.true)").lte("remind_at", now.toISOString())
      .order("remind_at", { ascending: true }).limit(25);
    if (missingOptionalColumn(dueError, "repeat_until_action")) {
      // Keep first reminders working while a project owner applies the newer
      // optional migration. Five-minute follow-ups require that migration.
      supportsRepeatReminders = false;
      const legacyDue = await supabase.from("reminders")
        .select("id, event_id, user_id, channel_id, remind_at, attempts")
        .eq("status", "pending").lte("remind_at", now.toISOString())
        .order("remind_at", { ascending: true }).limit(25);
      due = legacyDue.data as typeof due;
      dueError = legacyDue.error;
      console.warn("Reminder repeat migration is missing; sending due reminders once without five-minute follow-ups.");
    }
    if (dueError) throw dueError;

    let sent = 0;
    let retried = 0;
    let failed = 0;
    for (const reminder of due ?? []) {
      // Conditional update is the claim lock, preventing overlapping cron runs from double sending.
      let claimQuery = supabase.from("reminders").update({ status: "processing", locked_at: now.toISOString() }).eq("id", reminder.id);
      claimQuery = supportsRepeatReminders
        ? claimQuery.or("status.eq.pending,and(status.eq.sent,repeat_until_action.eq.true)")
        : claimQuery.eq("status", "pending");
      const { data: claim, error: claimError } = await claimQuery.select("id").maybeSingle();
      if (claimError) throw claimError;
      if (!claim) continue;

      try {
        const [{ data: event, error: eventError }, { data: channel, error: channelError }, { data: profile, error: profileError }] = await Promise.all([
          // select * keeps reminders working on databases that have not yet run
          // the optional event workflow migrations (for example, status).
          supabase.from("events").select("*").eq("id", reminder.event_id).eq("user_id", reminder.user_id).maybeSingle(),
          supabase.from("reminder_channels").select("channel_type, channel_config, is_active").eq("id", reminder.channel_id).eq("user_id", reminder.user_id).maybeSingle(),
          supabase.from("profiles").select("timezone").eq("id", reminder.user_id).maybeSingle(),
        ]);
        if (eventError) throw eventError;
        if (channelError) throw channelError;
        if (profileError) throw profileError;
        if (!event || (event.status && event.status !== "scheduled") || !channel || !channel.is_active) {
          await supabase.from("reminders").update({ status: "failed", ...(supportsRepeatReminders ? { repeat_until_action: false } : {}), last_error: "Event or active channel no longer exists.", locked_at: null }).eq("id", reminder.id);
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
        const telegramWebhookUrl = new URL("/api/telegram/webhook", appOrigin);

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
          telegramWebhookUrl: telegramWebhookUrl.toString(),
          telegramAttendCallback: createTelegramEventAction(event.id, "attended"),
          telegramCancelCallback: createTelegramEventAction(event.id, "cancelled"),
        });
        if (result.success) {
          const repeatUntilAction = channel.channel_type === "telegram";
          const nextReminderAt = new Date(Date.now() + 5 * 60_000).toISOString();
          const { error } = await supabase.from("reminders")
            .update({ status: "sent", attempts: 0, last_error: null, locked_at: null, ...(supportsRepeatReminders && repeatUntilAction ? { remind_at: nextReminderAt } : {}) })
            .eq("id", reminder.id);
          if (error) throw error;
          const deliveryMetadata = await supabase.from("reminders").update({ sent_at: new Date().toISOString(), ...(supportsRepeatReminders ? { repeat_until_action: repeatUntilAction } : {}) }).eq("id", reminder.id);
          if (deliveryMetadata.error) {
            if (missingOptionalColumn(deliveryMetadata.error, "sent_at")) {
              console.warn("Reminder sent; the optional sent_at migration is missing, so delivery time could not be recorded.");
            } else if (supportsRepeatReminders && missingOptionalColumn(deliveryMetadata.error, "repeat_until_action")) {
              supportsRepeatReminders = false;
              console.warn("Reminder sent, but five-minute follow-ups are disabled until the attendance reminder migration is applied.");
            } else {
              console.error("Reminder sent, but delivery metadata could not be saved:", deliveryMetadata.error.message);
            }
          }
          sent += 1;
        } else {
          const providerError = "error" in result && typeof result.error === "string" ? result.error : undefined;
          throw new Error(providerError || "Notification provider rejected the message.");
        }
      } catch (error) {
        const attempts = reminder.attempts + 1;
        const isFinal = attempts >= 3;
        const delayMinutes = [2, 10, 30][attempts - 1] ?? 30;
        const retryAt = new Date(Date.now() + delayMinutes * 60_000).toISOString();
        const message = describeDeliveryError(error).slice(0, 500);
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

    return NextResponse.json({ processed: sent + retried + failed, sent, retried, failed, repeatRemindersEnabled: supportsRepeatReminders });
  } catch (error) {
    const message = describeDeliveryError(error);
    console.error("Reminder cron failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
