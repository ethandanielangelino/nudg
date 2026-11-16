"use client";

import { useState, useEffect } from "react";
import {
  Bell,
  Mail,
  Send,
  Gamepad2,
  MessageCircle,
  Check,
  Save,
  Clock,
} from "lucide-react";

interface ChannelConfig {
  email: string;
  telegramChatId: string;
  discordWebhook: string;
  whatsappPhone: string;
}

export default function SettingsPage() {
  const [timezone, setTimezone] = useState("UTC");
  const [leadTime, setLeadTime] = useState("15");
  const [configuredChannels, setConfiguredChannels] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  // Channels
  const [config, setConfig] = useState<ChannelConfig>({
    email: "",
    telegramChatId: "",
    discordWebhook: "",
    whatsappPhone: "",
  });

  const [activeChannels, setActiveChannels] = useState<{ [key: string]: boolean }>({
    email: true,
    telegram: false,
    discord: false,
    whatsapp: false,
  });

  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [testingChannel, setTestingChannel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/settings");
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load settings.");
        if (cancelled) return;
        setConfig(data.values);
        setActiveChannels(data.activeChannels);
        setConfiguredChannels(data.configuredChannels);
        const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        setTimezone(!data.timezone || data.timezone === "UTC" ? deviceTimezone : data.timezone);
        setLeadTime(data.leadTime || "15");
      } catch (error) {
        if (!cancelled) setFormError(error instanceof Error ? error.message : "Could not load settings.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatusMsg(null);
    setFormError(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone, leadTime, values: config, activeChannels }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save settings.");
      setConfig((current) => ({ ...current, discordWebhook: "" }));
      setConfiguredChannels((current) => ({
        ...current,
        email: Boolean(config.email),
        telegram: Boolean(config.telegramChatId),
        discord: Boolean(config.discordWebhook) || current.discord,
        whatsapp: Boolean(config.whatsappPhone),
      }));
      setStatusMsg(data.reminderWarning || "Preferences saved.");
      window.setTimeout(() => setStatusMsg(null), 4000);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTestReminder(type: string) {
    const destination = type === "email" ? config.email
      : type === "telegram" ? config.telegramChatId
      : type === "discord" ? (configuredChannels.discord || Boolean(config.discordWebhook))
      : config.whatsappPhone;
    if (!destination) {
      setFormError(`Add and save a destination for ${type} before testing it.`);
      return;
    }
    setTestingChannel(type);
    setFormError(null);
    setStatusMsg(null);

    try {
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_type: type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "The test notification could not be sent.");
      setStatusMsg(`Test notification sent to ${type}.`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Test notification failed.");
    } finally {
      setTestingChannel(null);
    }
  }

  const toggleChannelActive = (type: string) => {
    setActiveChannels((prev) => ({ ...prev, [type]: !prev[type] }));
  };

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto space-y-8">
      {/* ── Header ── */}
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
          Settings & Channels
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure where and when Nudg sends your reminders.
        </p>
      </div>

      {loading && <p className="text-xs text-muted-foreground">Loading saved preferences…</p>}
      {formError && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{formError}</p>}

      <form onSubmit={handleSaveSettings} className="space-y-8">
        {/* ── Reminder Channels Section ── */}
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            Reminder Channels
          </h2>
          <p className="text-xs text-muted-foreground">
            Enable the channels you want Nudg to use when alerting you for upcoming schedule items.
          </p>

          <div className="grid grid-cols-1 gap-4">
            {/* 1. Email */}
            <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500">
                    <Mail className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      Email (Gmail)
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Free delivery via SMTP
                    </p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={activeChannels.email}
                  onChange={() => toggleChannelActive("email")}
                  className="h-5 w-5 rounded border-border accent-primary cursor-pointer"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <input
                  type="email"
                  value={config.email}
                  onChange={(e) => setConfig({ ...config, email: e.target.value })}
                  placeholder="your.email@example.com"
                  className="flex-1 rounded-xl border border-border bg-secondary/50 px-3.5 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <button
                  type="button"
                  disabled={testingChannel === "email"}
                  onClick={() => handleTestReminder("email")}
                  className="rounded-xl border border-border bg-secondary px-3 py-2 text-xs font-semibold text-foreground hover:bg-secondary/80 transition"
                >
                  {testingChannel === "email" ? "Sending..." : "Test"}
                </button>
              </div>
            </div>

            {/* 2. Telegram */}
            <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/10 text-sky-500">
                    <Send className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      Telegram Bot
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      100% free instant alerts
                    </p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={activeChannels.telegram}
                  onChange={() => toggleChannelActive("telegram")}
                  className="h-5 w-5 rounded border-border accent-primary cursor-pointer"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <input
                  type="text"
                  value={config.telegramChatId}
                  onChange={(e) =>
                    setConfig({ ...config, telegramChatId: e.target.value })
                  }
                  placeholder="Your Telegram Chat ID (e.g. 123456789)"
                  className="flex-1 rounded-xl border border-border bg-secondary/50 px-3.5 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <button
                  type="button"
                  disabled={testingChannel === "telegram"}
                  onClick={() => handleTestReminder("telegram")}
                  className="rounded-xl border border-border bg-secondary px-3 py-2 text-xs font-semibold text-foreground hover:bg-secondary/80 transition"
                >
                  {testingChannel === "telegram" ? "Sending..." : "Test"}
                </button>
              </div>
            </div>

            {/* 3. Discord */}
            <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500">
                    <Gamepad2 className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      Discord Webhook
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Direct server or DM alerts
                    </p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={activeChannels.discord}
                  onChange={() => toggleChannelActive("discord")}
                  className="h-5 w-5 rounded border-border accent-primary cursor-pointer"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <input
                  type="url"
                  value={config.discordWebhook}
                  onChange={(e) =>
                    setConfig({ ...config, discordWebhook: e.target.value })
                  }
                  placeholder={configuredChannels.discord ? "Saved securely · enter a new URL to replace" : "https://discord.com/api/webhooks/..."}
                  className="flex-1 rounded-xl border border-border bg-secondary/50 px-3.5 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <button
                  type="button"
                  disabled={testingChannel === "discord"}
                  onClick={() => handleTestReminder("discord")}
                  className="rounded-xl border border-border bg-secondary px-3 py-2 text-xs font-semibold text-foreground hover:bg-secondary/80 transition"
                >
                  {testingChannel === "discord" ? "Sending..." : "Test"}
                </button>
              </div>
            </div>

            {/* 4. WhatsApp */}
            <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
                    <MessageCircle className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      WhatsApp (Meta Cloud API)
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      1,000 free conversations/month
                    </p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={activeChannels.whatsapp}
                  onChange={() => toggleChannelActive("whatsapp")}
                  className="h-5 w-5 rounded border-border accent-primary cursor-pointer"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <input
                  type="tel"
                  value={config.whatsappPhone}
                  onChange={(e) =>
                    setConfig({ ...config, whatsappPhone: e.target.value })
                  }
                  placeholder="+1234567890 (with country code)"
                  className="flex-1 rounded-xl border border-border bg-secondary/50 px-3.5 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <button
                  type="button"
                  disabled={testingChannel === "whatsapp"}
                  onClick={() => handleTestReminder("whatsapp")}
                  className="rounded-xl border border-border bg-secondary px-3 py-2 text-xs font-semibold text-foreground hover:bg-secondary/80 transition"
                >
                  {testingChannel === "whatsapp" ? "Sending..." : "Test"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Preferences Section ── */}
        <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Notification Timing
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-foreground">
                Default Alert Lead Time
              </label>
              <select
                value={leadTime}
                onChange={(e) => setLeadTime(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-secondary/50 px-3.5 py-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="5">5 minutes before</option>
                <option value="15">15 minutes before (Recommended)</option>
                <option value="30">30 minutes before</option>
                <option value="60">1 hour before</option>
                <option value="1440">1 day before</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-foreground">
                Account Timezone
              </label>
              <input
                type="text"
                readOnly
                value={timezone}
                className="mt-1 w-full rounded-xl border border-border bg-secondary/30 px-3.5 py-2.5 text-xs text-muted-foreground"
              />
            </div>
          </div>
        </div>

        {/* ── Submit Button & Feedback ── */}
        <div className="flex items-center justify-between pt-2">
          {statusMsg ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-500">
              <Check className="h-4 w-4" />
              {statusMsg}
            </span>
          ) : (
            <span />
          )}

          <button
            type="submit"
                disabled={saving || loading}
            className="flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition disabled:opacity-50 shadow-md shadow-primary/20"
          >
            <Save className="h-4 w-4" />
            <span>{saving ? "Saving..." : "Save Preferences"}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
