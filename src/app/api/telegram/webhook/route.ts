import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { decryptChannelConfig } from "@/lib/channel-secrets";
import { createTelegramWebhookSecret, verifyTelegramEventAction } from "@/lib/event-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Server database credentials are not configured.");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function telegram(method: string, body: Record<string, unknown>) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Telegram bot is not configured.");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json() as { ok?: boolean; description?: string };
  if (!response.ok || !result.ok) throw new Error(result.description || `Telegram ${method} failed.`);
}

export async function POST(request: Request) {
  const expectedSecret = createTelegramWebhookSecret();
  if (request.headers.get("x-telegram-bot-api-secret-token") !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized webhook." }, { status: 401 });
  }

  try {
    const update = await request.json();
    const callback = update?.callback_query;
    if (!callback?.id || !callback?.message?.chat?.id || typeof callback?.data !== "string") {
      return NextResponse.json({ ok: true });
    }
    const action = verifyTelegramEventAction(callback.data);
    if (!action) {
      await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "This event button is invalid or expired.", show_alert: true });
      return NextResponse.json({ ok: true });
    }

    const supabase = adminClient();
    const { data: event, error: eventError } = await supabase.from("events")
      .select("id,user_id,title,start_time,status")
      .eq("id", action.eventId).maybeSingle();
    if (eventError) throw eventError;
    if (!event) {
      await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "This event is no longer available.", show_alert: true });
      return NextResponse.json({ ok: true });
    }

    const { data: channels, error: channelError } = await supabase.from("reminder_channels")
      .select("channel_config").eq("user_id", event.user_id).eq("channel_type", "telegram").eq("is_active", true);
    if (channelError) throw channelError;
    const isRecipient = (channels ?? []).some((channel) => String(decryptChannelConfig(channel.channel_config).chatId) === String(callback.message.chat.id));
    if (!isRecipient) {
      await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "This button is not linked to your Nudg account.", show_alert: true });
      return NextResponse.json({ ok: true });
    }
    if (event.status !== "scheduled") {
      await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: `Already marked ${String(event.status).replaceAll("_", " ")}.` });
      await telegram("editMessageReplyMarkup", { chat_id: callback.message.chat.id, message_id: callback.message.message_id, reply_markup: { inline_keyboard: [] } });
      return NextResponse.json({ ok: true });
    }

    const now = new Date();
    const status = action.status === "attended" && now.getTime() > new Date(event.start_time).getTime() ? "attended_late" : action.status;
    const { data: updated, error: updateError } = await supabase.from("events").update({ status, updated_at: now.toISOString() })
      .eq("id", event.id).eq("user_id", event.user_id).eq("status", "scheduled")
      .select("id,status,title").maybeSingle();
    if (updateError) throw updateError;
    if (!updated) {
      await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "This event was already updated." });
      return NextResponse.json({ ok: true });
    }

    await supabase.from("reminders").update({ repeat_until_action: false }).eq("event_id", event.id).eq("user_id", event.user_id);
    await supabase.from("reminders").update({ status: "failed", locked_at: null, last_error: `Event ${status.replaceAll("_", " ")}.` })
      .eq("event_id", event.id).eq("user_id", event.user_id).in("status", ["pending", "processing"]);

    const statusLabel = status === "attended_late" ? "Attended late" : status === "attended" ? "Attended" : "Cancelled";
    await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: `Marked ${statusLabel.toLowerCase()}.` });
    await telegram("editMessageText", {
      chat_id: callback.message.chat.id,
      message_id: callback.message.message_id,
      text: `NUDG · EVENT UPDATE\n\n${event.title}\nStatus: ${statusLabel}`,
      reply_markup: { inline_keyboard: [] },
    });
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    console.error("Telegram callback failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not process Telegram event action." }, { status: 500 });
  }
}
