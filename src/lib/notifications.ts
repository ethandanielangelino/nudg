import nodemailer from "nodemailer";

export interface NotificationPayload {
  to: string; // email, chat_id, webhook_url, or phone number
  title: string;
  description?: string;
  startTime: string;
  timezone?: string;
  priority?: string;
  category?: string;
  organization?: string;
  project?: string;
  location?: string;
  manageUrl?: string;
}

function formatReminderTime(isoTime: string, timezone?: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(new Date(isoTime));
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

// 1. Email via Gmail SMTP (100% Free)
export async function sendEmailReminder(payload: NotificationPayload) {
  if (!process.env.SMTP_EMAIL || !process.env.SMTP_APP_PASSWORD) {
    console.warn("SMTP credentials not configured.");
    return { success: false, error: "SMTP not configured" };
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.SMTP_EMAIL,
      pass: (process.env.SMTP_APP_PASSWORD || "").replace(/\s+/g, ""),
    },
  });

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 20px;">
        <span style="font-size: 24px; font-weight: 800; background: linear-gradient(135deg, #6366f1, #a855f7); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">nudg</span>
      </div>
      <h2 style="color: #0f172a; margin-top: 0;">⏰ Reminder: ${escapeHtml(payload.title)}</h2>
      <p style="color: #475569; font-size: 16px; line-height: 24px;">
        ${escapeHtml(payload.description || "You have an upcoming event scheduled.")}
      </p>
      <div style="margin: 20px 0; padding: 16px; background: #f8fafc; border-radius: 8px; border-left: 4px solid #6366f1;">
        <strong style="color: #1e293b;">Time:</strong>
        <span style="color: #475569;">${formatReminderTime(payload.startTime, payload.timezone)}</span>
      </div>
      <table role="presentation" style="width:100%; border-collapse:collapse; color:#475569; font-size:14px;">
        ${payload.priority ? `<tr><td style="padding:5px 0;color:#64748b;">Priority</td><td style="padding:5px 0;text-align:right;text-transform:capitalize;">${escapeHtml(payload.priority)}</td></tr>` : ""}
        ${payload.category ? `<tr><td style="padding:5px 0;color:#64748b;">Category</td><td style="padding:5px 0;text-align:right;text-transform:capitalize;">${escapeHtml(payload.category)}</td></tr>` : ""}
        ${payload.organization ? `<tr><td style="padding:5px 0;color:#64748b;">Organization</td><td style="padding:5px 0;text-align:right;">${escapeHtml(payload.organization)}</td></tr>` : ""}
        ${payload.project ? `<tr><td style="padding:5px 0;color:#64748b;">Project</td><td style="padding:5px 0;text-align:right;">${escapeHtml(payload.project)}</td></tr>` : ""}
        ${payload.location ? `<tr><td style="padding:5px 0;color:#64748b;">Location</td><td style="padding:5px 0;text-align:right;">${escapeHtml(payload.location)}</td></tr>` : ""}
      </table>
      ${payload.manageUrl ? `<div style="margin:24px 0;text-align:center;"><a href="${escapeHtml(payload.manageUrl)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:8px;">Manage event</a></div>` : ""}
      <p style="color: #94a3b8; font-size: 13px; margin-top: 24px;">
        Sent automatically by Nudg • Your Personal AI Schedule Assistant
      </p>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"Nudg Assistant" <${process.env.SMTP_EMAIL}>`,
      to: payload.to,
      subject: `⏰ Reminder: ${payload.title}`,
      html,
    });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("Email send error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Email delivery failed." };
  }
}

// 2. Telegram via Bot API (100% Free)
export async function sendTelegramReminder(payload: NotificationPayload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn("Telegram bot token not configured.");
    return { success: false, error: "Telegram not configured" };
  }

  const messageText = ["NUDG · EVENT REMINDER", "", payload.title, payload.description, `Time: ${formatReminderTime(payload.startTime, payload.timezone)}`, payload.priority && `Priority: ${payload.priority}`, payload.category && `Category: ${payload.category}`, payload.organization && `Organization: ${payload.organization}`, payload.project && `Project: ${payload.project}`, payload.location && `Location: ${payload.location}`, payload.manageUrl && "Use the button below to mark this event complete or cancel it."].filter(Boolean).join("\n");

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: payload.to,
        text: messageText,
        ...(payload.manageUrl ? { reply_markup: { inline_keyboard: [[{ text: "Manage event", url: payload.manageUrl }]] } } : {}),
      }),
    });

    const data = await res.json();
    return { success: data.ok, data };
  } catch (error) {
    console.error("Telegram send error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Telegram delivery failed." };
  }
}

// 3. Discord via Webhook (100% Free)
export async function sendDiscordReminder(payload: NotificationPayload) {
  const webhookUrl = payload.to;
  if (!webhookUrl) {
    console.warn("Discord webhook not configured.");
    return { success: false, error: "Discord webhook not configured" };
  }

  let webhook: URL;
  try {
    webhook = new URL(webhookUrl);
  } catch {
    return { success: false, error: "Invalid Discord webhook URL" };
  }
  if (webhook.protocol !== "https:" || !["discord.com", "discordapp.com"].includes(webhook.hostname) || !webhook.pathname.startsWith("/api/webhooks/")) {
    return { success: false, error: "Discord webhook must be hosted on discord.com/api/webhooks" };
  }
  if (payload.manageUrl) webhook.searchParams.set("with_components", "true");

  const embed = {
    title: `⏰ Reminder: ${payload.title}`,
    description: payload.description || "You have an upcoming event scheduled.",
    color: 0x6366f1, // Indigo
    fields: [
      {
        name: "📅 Scheduled Time",
        value: formatReminderTime(payload.startTime, payload.timezone),
        inline: false,
      },
      ...(payload.priority ? [{ name: "Priority", value: payload.priority, inline: true }] : []),
      ...(payload.category ? [{ name: "Category", value: payload.category, inline: true }] : []),
      ...(payload.organization ? [{ name: "Organization", value: payload.organization, inline: true }] : []),
      ...(payload.project ? [{ name: "Project", value: payload.project, inline: true }] : []),
      ...(payload.location ? [{ name: "Location", value: payload.location, inline: false }] : []),
    ],
    footer: {
      text: "Nudg — Personal AI Schedule Assistant",
    },
    timestamp: new Date().toISOString(),
  };

  try {
    const res = await fetch(webhook.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Nudg Assistant",
        embeds: [embed],
        ...(payload.manageUrl ? { components: [{ type: 1, components: [{ type: 2, style: 5, label: "Manage event", url: payload.manageUrl }] }] } : {}),
        allowed_mentions: { parse: [] },
      }),
    });

    return { success: res.ok, status: res.status };
  } catch (error) {
    console.error("Discord send error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Discord delivery failed." };
  }
}

// 4. WhatsApp via Meta Cloud API (1,000 free conversations/month)
export async function sendWhatsAppReminder(payload: NotificationPayload) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    console.warn("WhatsApp credentials not configured.");
    return { success: false, error: "WhatsApp credentials not configured" };
  }

  // Sanitize phone number (strip non-digits)
  const recipient = payload.to.replace(/\D/g, "");
  const templateDetails = [payload.description, payload.priority && `Priority: ${payload.priority}`, payload.category && `Category: ${payload.category}`, payload.organization && `Organization: ${payload.organization}`, payload.project && `Project: ${payload.project}`, payload.location && `Location: ${payload.location}`].filter(Boolean).join(" · ").slice(0, 900);

  try {
    const res = await fetch(
      `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || "v27.0"}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: recipient,
          ...(process.env.WHATSAPP_TEMPLATE_NAME
            ? {
                type: "template",
                template: {
                  name: process.env.WHATSAPP_TEMPLATE_NAME,
                  language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en_US" },
                  components: [{
                    type: "body",
                    parameters: [payload.title, templateDetails, formatReminderTime(payload.startTime, payload.timezone)]
                      .map((text) => ({ type: "text", text })),
                  }, ...(payload.manageUrl && process.env.WHATSAPP_TEMPLATE_MANAGE_BUTTON_INDEX !== undefined ? [{
                    type: "button",
                    sub_type: "url",
                    index: process.env.WHATSAPP_TEMPLATE_MANAGE_BUTTON_INDEX,
                    parameters: [{ type: "text", text: new URL(payload.manageUrl).searchParams.get("token") || "" }],
                  }] : [])],
                },
              }
            : {
                type: "text",
                text: {
                  preview_url: false,
                  body: ["NUDG · EVENT REMINDER", "", payload.title, payload.description, `Time: ${formatReminderTime(payload.startTime, payload.timezone)}`, payload.priority && `Priority: ${payload.priority}`, payload.category && `Category: ${payload.category}`, payload.organization && `Organization: ${payload.organization}`, payload.project && `Project: ${payload.project}`, payload.location && `Location: ${payload.location}`, payload.manageUrl && `Manage event: ${payload.manageUrl}`].filter(Boolean).join("\n"),
                },
              }),
        }),
      }
    );

    const data = await res.json();
    return { success: res.ok, data };
  } catch (error) {
    console.error("WhatsApp send error:", error);
    return { success: false, error: error instanceof Error ? error.message : "WhatsApp delivery failed." };
  }
}
