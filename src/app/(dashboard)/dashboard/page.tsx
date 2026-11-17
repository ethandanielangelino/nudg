"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Calendar as CalendarIcon,
  Clock,
  Plus,
  Sparkles,
  CheckCircle2,
  ArrowRight,
  Trash2,
  CornerDownLeft,
} from "lucide-react";
import { endOfWeek, format, isToday, parseISO } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { CalendarEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

function statusLabel(status?: CalendarEvent["status"]) {
  if (status === "attended_late") return "Attended late";
  return (status || "scheduled").replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

export default function DashboardPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState("there");
  const [quickInput, setQuickInput] = useState("");
  const [quickLoading, setQuickLoading] = useState(false);
  const [quickMessage, setQuickMessage] = useState<string | null>(null);
  const [quickNeedsChat, setQuickNeedsChat] = useState(false);
  const [activeChannels, setActiveChannels] = useState<string[]>([]);
  const supabase = createClient();

  useEffect(() => {
    loadDashboardData();
  }, []);

  async function loadDashboardData() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      setUserName(user.user_metadata?.full_name || user.email?.split("@")[0] || "Friend");

      // Use the same authenticated event endpoint as the calendar. The old
      // direct query required an optional status column and could silently
      // turn a query error into an empty overview.
      const [eventResponse, { data: channels }] = await Promise.all([
        fetch("/api/events", { cache: "no-store" }),
        supabase
          .from("reminder_channels")
          .select("channel_type")
          .eq("user_id", user.id)
          .eq("is_active", true),
      ]);

      const eventResult = await eventResponse.json();
      if (!eventResponse.ok) {
        setEventsError(eventResult.error || "Could not load your events.");
      } else {
        setEvents((eventResult.events ?? []) as CalendarEvent[]);
        setEventsError(null);
      }
      setActiveChannels((channels ?? []).map((channel) => channel.channel_type));
    }
    setLoading(false);
  }

  // Quick NLP add using /api/chat
  async function handleQuickAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!quickInput.trim()) return;

    setQuickLoading(true);
    setQuickMessage(null);
    setQuickNeedsChat(false);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: quickInput }),
        keepalive: true,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not schedule that event.");
      if (data.action?.type === "clarify_event" || data.action?.type === "confirm_event") {
        setQuickInput("");
        setQuickMessage("Your assistant has prepared the next step. Open chat to answer and confirm the event.");
        setQuickNeedsChat(true);
        return;
      }
      if (!data.action?.event) {
        setQuickMessage(data.message || "I couldn’t find a date and time. Try ‘Lunch tomorrow at 1pm’.");
        return;
      }
      setQuickInput("");
      setQuickMessage(`Added “${data.action.event.title}” to your schedule.`);
      await loadDashboardData();
    } catch (err) {
      setQuickMessage(err instanceof Error ? err.message : "Could not schedule that event.");
    } finally {
      setQuickLoading(false);
    }
  }

  async function handleDeleteEvent(id: string) {
    const res = await fetch(`/api/events?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setEvents((prev) => prev.filter((ev) => ev.id !== id));
    }
  }

  // Filter today's and upcoming events
  const todayEvents = events.filter((ev) => {
    try {
      return ev.status !== "cancelled" && isToday(parseISO(ev.start_time));
    } catch {
      return false;
    }
  });

  const upcomingEvents = events.filter((ev) => {
    try {
      return ev.status !== "cancelled" && new Date(ev.start_time) > new Date() && new Date(ev.start_time) <= endOfWeek(new Date()) && !isToday(parseISO(ev.start_time));
    } catch {
      return false;
    }
  }).slice(0, 5);
  const futureEventCount = events.filter((ev) => ev.status !== "cancelled" && new Date(ev.start_time) > new Date()).length;

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  return (
    <div className="mx-auto max-w-7xl space-y-7 p-5 md:p-9">
      {/* ── Top Header ── */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: "easeOut" }} className="relative isolate overflow-hidden rounded-3xl border border-border bg-card px-6 py-7 sm:px-9 sm:py-9">
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 -z-10 w-2/3 opacity-60" style={{ background: "radial-gradient(ellipse at 85% 35%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 58%)" }} />
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background/70 px-2.5 py-1 badge-mono text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />YOUR DAY, IN FOCUS</span>
            <span className="text-muted-foreground font-mono text-xs">
              {format(new Date(), "EEEE, MMM d")}
            </span>
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-[-.045em] text-foreground sm:text-5xl">
            {getGreeting()}, {userName}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">A little more headspace for what matters next.</p>
        </div>

        <div className="flex items-center gap-2.5">
          <Link
            href="/chat"
            className="btn-press inline-flex items-center gap-2 rounded-xl border border-border bg-background/80 px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-secondary"
          >
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            <span>AI Assistant</span>
          </Link>
          <Link
            href="/calendar?new=1"
            className="btn-press inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New Event</span>
          </Link>
        </div>
        </div>
      </motion.div>

      {/* ── Command Bar / Quick NLP Add ── */}
      <div className="rounded-2xl border border-border bg-card p-2 shadow-sm transition-colors focus-within:border-accent/60 focus-within:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_9%,transparent)]">
        <form onSubmit={handleQuickAdd} className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <Sparkles className="h-4 w-4 text-accent" />
          </div>
          <input
            type="text"
            value={quickInput}
            aria-label="Describe an event to add to your schedule"
            onChange={(e) => setQuickInput(e.target.value)}
            placeholder="Try ‘Coffee with Sarah tomorrow at 2pm’"
            className="min-w-0 flex-1 bg-transparent px-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <button
            type="submit"
            disabled={quickLoading || !quickInput.trim()}
            className="btn-press flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
          >
            {quickLoading ? (
              <span className="animate-spin text-xs">⏳</span>
            ) : (
              <>
                <span>Schedule</span>
                <CornerDownLeft className="h-3 w-3" />
              </>
            )}
          </button>
        </form>
        {quickMessage && <p role="status" className="px-3 pb-2 pt-1 text-xs text-muted-foreground">{quickMessage}{quickNeedsChat && <> <Link href="/chat" className="font-semibold text-primary underline">Open AI chat</Link></>}</p>}
      </div>

      {/* ── Metric Tiles ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          {
            label: "Today's Agenda",
            val: todayEvents.length,
            note: "Events today",
            href: "/calendar",
          },
          {
            label: "Upcoming Queue",
            val: futureEventCount,
            note: "Still ahead",
            href: "/calendar",
          },
          {
            label: "Channels Linked",
            val: `${activeChannels.length} active`,
            note: "Reminder channels",
            href: "/settings",
          },
          {
            label: "Assistant Memory",
            val: "Ask Nudg",
            note: "Plan it in plain language",
            href: "/chat",
          },
        ].map((m) => (
          <Link key={m.label} href={m.href} className="group rounded-2xl border border-border bg-card p-4 transition duration-200 hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-md sm:p-5">
            <span className="text-[11px] font-mono uppercase text-muted-foreground tracking-wider">
              {m.label}
            </span>
            <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {m.val}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">{m.note}</div>
            <div className="mt-3 h-px w-8 bg-accent/70 transition-all group-hover:w-14" />
          </Link>
        ))}
      </div>

      {/* ── Two Column Schedule Grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left: Today's Timeline (8 cols) */}
        <div className="lg:col-span-8 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold font-mono uppercase tracking-wider text-foreground flex items-center gap-2">
              <CalendarIcon className="h-4 w-4 text-accent" />
              Today&apos;s Schedule
            </h2>
            <span className="text-xs text-muted-foreground font-mono">
              {todayEvents.length} {todayEvents.length === 1 ? "item" : "items"}
            </span>
          </div>

          {loading ? (
            <div className="rounded-xl border border-border bg-card p-12 text-center text-xs text-muted-foreground font-mono">
              Loading schedule data...
            </div>
          ) : todayEvents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-muted-foreground mb-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              </div>
              <p className="text-sm font-bold text-foreground">Nothing scheduled for today</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                Your agenda is completely clear. Type in the bar above or use the AI Assistant to schedule.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {todayEvents.map((ev) => (
                <div
                  key={ev.id}
                  className="group flex items-center justify-between rounded-xl border border-border bg-card p-4 hover:border-foreground/30 transition shadow-2xs"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="mt-1 h-3 w-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: ev.color || "#ff4d24" }}
                    />
                    <div>
                      <h4 className="font-semibold text-foreground text-sm">{ev.title}</h4>
                      {ev.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{ev.description}</p>
                      )}
                      <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground mt-1.5">
                        <Clock className="h-3 w-3" />
                        <span>
                          {format(parseISO(ev.start_time), "p")} – {format(parseISO(ev.end_time), "p")}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                        <span className={cn("rounded-full px-2 py-1", ev.status === "attended_late" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : ev.status === "attended" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-secondary")}>{statusLabel(ev.status)}</span>
                        <span className="rounded-full bg-secondary px-2 py-1 capitalize">{ev.priority ?? "normal"} priority</span>
                        <span className="rounded-full bg-secondary px-2 py-1 capitalize">{ev.category ?? "general"}</span>
                        {ev.organization && <span className="rounded-full bg-secondary px-2 py-1">{ev.organization}</span>}
                        {ev.project && <span className="rounded-full bg-secondary px-2 py-1">Project: {ev.project}</span>}
                        {ev.location && <span className="rounded-full bg-secondary px-2 py-1">{ev.location}</span>}
                        <span className="rounded-full bg-primary/10 px-2 py-1 text-primary">Reminder: {ev.reminder_lead_minutes == null ? "account default" : ev.reminder_lead_minutes === 0 ? "at start" : `${ev.reminder_lead_minutes} min before`}</span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleDeleteEvent(ev.id)}
                    className="opacity-0 group-hover:opacity-100 rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition"
                    title="Delete event"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Upcoming Agenda & Channel Status (4 cols) */}
        <div className="lg:col-span-4 space-y-6">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold font-mono uppercase tracking-wider text-foreground">
                Upcoming
              </h2>
              <Link
                href="/calendar"
                className="text-xs font-semibold text-accent hover:underline flex items-center gap-1"
              >
                Calendar <ArrowRight className="h-3 w-3" />
              </Link>
            </div>

            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              {eventsError ? (
                <div className="py-3 text-center"><p role="alert" className="text-xs text-destructive">{eventsError}</p><button onClick={() => void loadDashboardData()} className="mt-2 text-xs font-semibold text-primary underline underline-offset-2">Retry</button></div>
              ) : upcomingEvents.length === 0 ? (
                <p className="text-xs text-muted-foreground font-mono text-center py-4">
                  No upcoming events this week.
                </p>
              ) : (
                upcomingEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className="flex items-start gap-3 pb-2.5 border-b border-border/60 last:border-0 last:pb-0"
                  >
                    <div
                      className="mt-1 h-2 w-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: ev.color || "#ff4d24" }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-foreground truncate">{ev.title}</p>
                      <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                        {format(parseISO(ev.start_time), "EEE, MMM d • p")}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">{[statusLabel(ev.status), ev.priority ? `${ev.priority} priority` : "normal priority", ev.category || "general", ev.organization, ev.project, ev.location, `Reminder: ${ev.reminder_lead_minutes == null ? "account default" : ev.reminder_lead_minutes === 0 ? "at start" : ev.reminder_lead_minutes >= 1440 ? `${ev.reminder_lead_minutes / 1440} day(s) before` : ev.reminder_lead_minutes >= 60 ? `${ev.reminder_lead_minutes / 60} hour(s) before` : `${ev.reminder_lead_minutes} min before`}`].filter(Boolean).map((detail) => <span key={detail} className="rounded bg-secondary px-1.5 py-0.5 text-[9px] capitalize">{detail}</span>)}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Connected Channels Widget */}
          <div className="rounded-xl border border-border bg-secondary/30 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                Active Channels
              </span>
              <Link href="/settings" className="text-[11px] font-semibold text-accent hover:underline">
                Manage
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              {[
                ["WhatsApp", "whatsapp", "text-emerald-500"],
                ["Telegram", "telegram", "text-sky-500"],
                ["Discord", "discord", "text-indigo-500"],
                ["Email", "email", "text-amber-500"],
              ].map(([label, type, tone]) => {
                const enabled = activeChannels.includes(type);
                return (
                  <Link key={type} href="/settings" className="rounded-lg border border-border bg-card p-2 text-muted-foreground transition-colors hover:border-accent/50">
                    {label}: <span className={cn("font-bold", enabled ? tone : "text-muted-foreground")}>{enabled ? "On" : "Off"}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
