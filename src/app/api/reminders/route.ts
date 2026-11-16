import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decryptChannelConfig } from "@/lib/channel-secrets";
import type { ReminderChannel } from "@/lib/types";
import {
  sendEmailReminder,
  sendTelegramReminder,
  sendDiscordReminder,
  sendWhatsAppReminder,
} from "@/lib/notifications";

// POST /api/reminders: Send a test reminder using the signed-in user's saved channel.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const channelType = body.channel_type as ReminderChannel["channel_type"];
    if (!["email", "telegram", "discord", "whatsapp"].includes(channelType)) {
      return NextResponse.json({ error: "Invalid channel type" }, { status: 400 });
    }

    const { data: channel, error: channelError } = await supabase
      .from("reminder_channels")
      .select("channel_type, channel_config")
      .eq("user_id", user.id)
      .eq("channel_type", channelType)
      .maybeSingle();
    if (channelError) throw channelError;
    if (!channel) return NextResponse.json({ error: "Save this channel before testing it." }, { status: 400 });

    const config = decryptChannelConfig(channel.channel_config);
    const to = channelType === "email" ? config.email
      : channelType === "telegram" ? config.chatId
      : channelType === "discord" ? config.webhookUrl
      : config.phoneNumber;
    if (!to) return NextResponse.json({ error: "Add a destination for this channel before testing it." }, { status: 400 });

    if (channelType === "discord") {
      let webhook: URL;
      try {
        webhook = new URL(to);
      } catch {
        return NextResponse.json({ error: "Enter a valid Discord webhook URL." }, { status: 400 });
      }
      if (webhook.protocol !== "https:" || !["discord.com", "discordapp.com"].includes(webhook.hostname) || !webhook.pathname.startsWith("/api/webhooks/")) {
        return NextResponse.json({ error: "Discord webhook URLs must use discord.com/api/webhooks." }, { status: 400 });
      }
    }

    let result;
    const payload = {
      to,
      title: "Test notification from Nudg",
      description: "Your reminder channel is connected.",
      startTime: new Date().toISOString(),
    };

    switch (channelType) {
      case "email":
        result = await sendEmailReminder(payload);
        break;
      case "telegram":
        result = await sendTelegramReminder(payload);
        break;
      case "discord":
        result = await sendDiscordReminder(payload);
        break;
      case "whatsapp":
        result = await sendWhatsAppReminder(payload);
        break;
      default:
        return NextResponse.json(
          { error: "Invalid channel type" },
          { status: 400 }
        );
    }

    if (!result?.success) {
      return NextResponse.json({ error: result?.error || "The provider rejected the test notification. Check its credentials and destination." }, { status: 502 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not send test reminder.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
