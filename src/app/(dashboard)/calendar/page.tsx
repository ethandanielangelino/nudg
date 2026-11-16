"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, isToday, parseISO, startOfMonth, startOfWeek, subMonths, subWeeks } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, MapPin, Plus, Trash2, X, Bell, Building2, BriefcaseBusiness } from "lucide-react";
import type { CalendarEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

const COLORS = ["#ff4d24", "#10b981", "#0ea5e9", "#8b5cf6", "#f59e0b", "#6b7280"];
const CATEGORIES = ["general", "meeting", "focus time", "client", "deadline", "personal"];
const LEADS = [{ value: "default", label: "Use account default" }, { value: "0", label: "At event time" }, { value: "5", label: "5 minutes before" }, { value: "15", label: "15 minutes before" }, { value: "30", label: "30 minutes before" }, { value: "60", label: "1 hour before" }, { value: "120", label: "2 hours before" }, { value: "1440", label: "1 day before" }, { value: "10080", label: "1 week before" }];
type EventDraft = { title: string; description: string; date: string; start: string; end: string; color: string; location: string; priority: string; category: string; organization: string; project: string; lead: string };
const newDraft = (date = new Date()): EventDraft => ({ title: "", description: "", date: format(date, "yyyy-MM-dd"), start: "10:00", end: "11:00", color: COLORS[0], location: "", priority: "normal", category: "general", organization: "", project: "", lead: "default" });
const priorityStyle: Record<string, string> = { low: "text-slate-500 bg-slate-500/10", normal: "text-sky-600 bg-sky-500/10", high: "text-amber-600 bg-amber-500/10", urgent: "text-rose-600 bg-rose-500/10" };
function deliverySummary(event: CalendarEvent) {
  const records = event.reminder_deliveries ?? [];
  if (!records.length) return "No reminder queued";
  const failed = records.filter((record) => record.status === "failed");
  const pending = records.filter((record) => record.status === "pending" || record.status === "processing");
  if (failed.length) return `Delivery failed: ${failed.map((record) => record.channel_type).join(", ")}`;
  if (pending.length) return `Reminder ${pending.some((record) => record.status === "processing") ? "sending" : "scheduled"}`;
  return `Sent to ${records.map((record) => record.channel_type).join(", ")}`;
}

export default function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"month" | "week">("month");
  const [activeEvent, setActiveEvent] = useState<CalendarEvent | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<EventDraft>(newDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const openNew = useCallback((date = selectedDate) => { setDraft(newDraft(date)); setActiveEvent(null); setError(""); setEditorOpen(true); }, [selectedDate]);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/events");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load events.");
      const list = (result.events ?? []) as CalendarEvent[];
      setEvents(list);
      setError("");
      return list;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load events.");
      setEvents([]);
      return [];
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { queueMicrotask(() => { void fetchEvents(); }); }, [fetchEvents, currentDate]);
  useEffect(() => {
    queueMicrotask(() => {
      const url = new URL(window.location.href);
      if (url.searchParams.get("new") === "1") {
        openNew(currentDate);
        url.searchParams.delete("new");
        window.history.replaceState({}, "", url);
      }
    });
  }, [currentDate, openNew]);

  const days = useMemo(() => view === "month"
    ? eachDayOfInterval({ start: startOfWeek(startOfMonth(currentDate)), end: endOfWeek(endOfMonth(currentDate)) })
    : eachDayOfInterval({ start: startOfWeek(currentDate), end: endOfWeek(currentDate) }), [currentDate, view]);
  const dayEvents = events.filter((event) => isSameDay(parseISO(event.start_time), selectedDate));

  function movePeriod(direction: number) {
    setCurrentDate((date) => view === "month" ? (direction > 0 ? addMonths(date, 1) : subMonths(date, 1)) : (direction > 0 ? addWeeks(date, 1) : subWeeks(date, 1)));
  }
  function openEdit(event: CalendarEvent) {
    setActiveEvent(event);
    setDraft({ title: event.title, description: event.description ?? "", date: format(parseISO(event.start_time), "yyyy-MM-dd"), start: format(parseISO(event.start_time), "HH:mm"), end: format(parseISO(event.end_time), "HH:mm"), color: event.color || COLORS[0], location: event.location ?? "", priority: event.priority ?? "normal", category: event.category ?? "general", organization: event.organization ?? "", project: event.project ?? "", lead: event.reminder_lead_minutes == null ? "default" : String(event.reminder_lead_minutes) });
    setError(""); setEditorOpen(true);
  }
  function set<K extends keyof EventDraft>(key: K, value: EventDraft[K]) { setDraft((current) => ({ ...current, [key]: value })); }
  async function saveEvent(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError("");
    const payload = { ...(activeEvent ? { id: activeEvent.id } : {}), title: draft.title.trim(), description: draft.description, start_time: new Date(`${draft.date}T${draft.start}:00`).toISOString(), end_time: new Date(`${draft.date}T${draft.end}:00`).toISOString(), color: draft.color, location: draft.location, priority: draft.priority, category: draft.category, organization: draft.organization, project: draft.project, reminder_lead_minutes: draft.lead };
    try {
      const response = await fetch("/api/events", { method: activeEvent ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save event.");
      setEditorOpen(false); setSelectedDate(parseISO(result.event.start_time));
      const refreshed = await fetchEvents();
      setActiveEvent(refreshed.find((event) => event.id === result.event.id) ?? result.event);
      if (result.reminderWarning) setError(result.reminderWarning);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save event."); }
    setSaving(false);
  }
  async function deleteEvent(id: string) {
    try {
      const response = await fetch(`/api/events?id=${id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not delete event.");
      setEvents((items) => items.filter((item) => item.id !== id)); setActiveEvent(null); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete event."); }
  }

  return <div className="mx-auto flex min-h-full max-w-[1500px] flex-col gap-6 p-5 md:p-8">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Planning workspace</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground">Calendar</h1><p className="mt-1 text-sm text-muted-foreground">A clear view of priorities, people, and what needs your attention.</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-border bg-card p-1">{(["month", "week"] as const).map((item) => <button key={item} onClick={() => setView(item)} className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition", view === item ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{item}</button>)}</div>
        <button onClick={() => { setCurrentDate(new Date()); setSelectedDate(new Date()); }} className="rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold hover:bg-secondary">Today</button>
        <div className="flex items-center rounded-xl border border-border bg-card"><button onClick={() => movePeriod(-1)} aria-label="Previous period" className="p-2.5 text-muted-foreground hover:text-foreground"><ChevronLeft className="h-4 w-4" /></button><span className="min-w-32 text-center text-sm font-semibold">{view === "month" ? format(currentDate, "MMMM yyyy") : `${format(days[0], "MMM d")} – ${format(days[6], "MMM d, yyyy")}`}</span><button onClick={() => movePeriod(1)} aria-label="Next period" className="p-2.5 text-muted-foreground hover:text-foreground"><ChevronRight className="h-4 w-4" /></button></div>
        <button onClick={() => openNew()} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/15 transition hover:brightness-110"><Plus className="h-4 w-4" /> New event</button>
      </div>
    </header>

    {error && !editorOpen && <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-xs text-destructive"><span>{error}</span><button onClick={() => void fetchEvents()} className="shrink-0 font-semibold underline underline-offset-2">Retry</button></div>}

    <div className="grid min-h-[620px] flex-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="grid grid-cols-7 border-b border-border bg-secondary/40 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="py-3">{d}</div>)}</div>
        <div className={cn("grid grid-cols-7", view === "month" ? "auto-rows-fr" : "min-h-[540px] grid-rows-1")}>
          {days.map((day) => {
            const items = events.filter((event) => isSameDay(parseISO(event.start_time), day));
            return <button key={day.toISOString()} onClick={() => setSelectedDate(day)} className={cn("group min-h-[100px] border-b border-r border-border/70 p-2 text-left transition-colors hover:bg-secondary/30 md:min-h-[125px]", selectedDate.toDateString() === day.toDateString() && "bg-primary/[0.045]", view === "month" && !isSameMonth(day, currentDate) && "bg-secondary/20 text-muted-foreground/50")}>
              <div className="mb-2 flex items-center justify-between"><span className={cn("flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold", isToday(day) && "bg-primary text-primary-foreground", selectedDate.toDateString() === day.toDateString() && !isToday(day) && "ring-1 ring-primary text-primary")}>{format(day, "d")}</span><span className="text-[10px] text-muted-foreground">{items.length > 0 ? items.length : ""}</span></div>
              <div className="space-y-1">{items.slice(0, view === "week" ? 6 : 3).map((event) => <div key={event.id} onClick={(e) => { e.stopPropagation(); setSelectedDate(day); setActiveEvent(event); }} className="flex cursor-pointer items-center gap-1.5 truncate rounded-md bg-secondary/70 px-1.5 py-1 text-[10px] font-medium text-foreground hover:bg-secondary" title={`${event.title} · ${event.priority} priority`}><span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", event.priority === "urgent" ? "bg-rose-500" : event.priority === "high" ? "bg-amber-500" : "bg-primary")} style={{ backgroundColor: event.priority === "urgent" ? undefined : event.priority === "high" ? undefined : event.color }} /><span className="truncate">{view === "week" && !event.all_day ? `${format(parseISO(event.start_time), "HH:mm")} ` : ""}{event.title}</span></div>)}{items.length > (view === "week" ? 6 : 3) && <span className="pl-1 text-[10px] text-muted-foreground">+{items.length - (view === "week" ? 6 : 3)} more</span>}</div>
            </button>;
          })}
        </div>
      </section>

      <aside className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="border-b border-border p-5"><div className="flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Selected day</p><h2 className="mt-1 text-lg font-bold">{format(selectedDate, "EEEE, MMM d")}</h2></div><button onClick={() => openNew(selectedDate)} aria-label="Add event to selected day" className="rounded-xl bg-primary/10 p-2.5 text-primary hover:bg-primary/15"><Plus className="h-4 w-4" /></button></div><p className="mt-2 text-xs text-muted-foreground">{dayEvents.length} {dayEvents.length === 1 ? "event" : "events"}</p></div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">{loading ? <p className="py-8 text-center text-sm text-muted-foreground">Loading calendar…</p> : dayEvents.length === 0 ? <div className="py-12 text-center"><CalendarDays className="mx-auto h-8 w-8 text-muted-foreground/35"/><p className="mt-3 text-sm font-medium">Nothing scheduled</p><p className="mt-1 text-xs text-muted-foreground">Use this space for focused work.</p><button onClick={() => openNew(selectedDate)} className="mt-4 text-xs font-semibold text-primary">Add an event</button></div> : dayEvents.map((event) => <button key={event.id} onClick={() => setActiveEvent(event)} className="w-full rounded-xl border border-border/80 p-3 text-left transition hover:border-primary/40 hover:bg-secondary/25"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-semibold">{event.title}</p><p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="h-3 w-3"/>{event.all_day ? "All day" : `${format(parseISO(event.start_time), "p")} – ${format(parseISO(event.end_time), "p")}`}</p></div><span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize", priorityStyle[event.priority ?? "normal"])}>{event.priority ?? "normal"}</span></div><div className="mt-2 flex flex-wrap gap-1.5"><span className="rounded-md bg-secondary px-2 py-1 text-[10px] capitalize text-muted-foreground">{event.category || "general"}</span>{event.organization && <span className="max-w-32 truncate rounded-md bg-secondary px-2 py-1 text-[10px] text-muted-foreground">{event.organization}</span>}</div><p className={cn("mt-2 flex items-center gap-1 text-[10px]", event.reminder_deliveries?.some((record) => record.status === "failed") ? "text-destructive" : "text-muted-foreground")}><Bell className="h-3 w-3"/>{deliverySummary(event)}</p></button>)}</div>
      </aside>
    </div>

    <AnimatePresence>{activeEvent && !editorOpen && <div className="fixed inset-0 z-50 flex items-center justify-center p-4"><motion.button aria-label="Close event details" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setActiveEvent(null)} className="fixed inset-0 bg-black/55 backdrop-blur-sm"/><motion.div initial={{ opacity: 0, y: 12, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} className="relative z-10 w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: activeEvent.color }}/><h3 className="text-xl font-bold">{activeEvent.title}</h3></div><div className="mt-2 flex gap-2"><span className={cn("rounded-full px-2.5 py-1 text-[10px] font-semibold capitalize", priorityStyle[activeEvent.priority ?? "normal"])}>{activeEvent.priority ?? "normal"} priority</span><span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] capitalize text-muted-foreground">{activeEvent.category || "general"}</span></div></div><button onClick={() => setActiveEvent(null)} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary"><X className="h-4 w-4"/></button></div>
      {activeEvent.description && <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{activeEvent.description}</p>}<div className="mt-5 space-y-3 rounded-xl bg-secondary/40 p-4 text-sm"><p className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary"/>{format(parseISO(activeEvent.start_time), "EEEE, MMMM d, yyyy")}</p><p className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-primary"/>{activeEvent.all_day ? "All day" : `${format(parseISO(activeEvent.start_time), "p")} – ${format(parseISO(activeEvent.end_time), "p")}`}</p>{activeEvent.location && <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-primary"/>{activeEvent.location}</p>}{activeEvent.organization && <p className="flex items-center gap-2"><Building2 className="h-4 w-4 text-primary"/>{activeEvent.organization}</p>}{activeEvent.project && <p className="flex items-center gap-2"><BriefcaseBusiness className="h-4 w-4 text-primary"/>{activeEvent.project}</p>}<p className="flex items-center gap-2"><Bell className="h-4 w-4 text-primary"/>{activeEvent.reminder_lead_minutes == null ? "Account default reminder" : activeEvent.reminder_lead_minutes === 0 ? "Reminder at event time" : `Reminder ${activeEvent.reminder_lead_minutes >= 1440 ? `${activeEvent.reminder_lead_minutes / 1440} day(s)` : activeEvent.reminder_lead_minutes >= 60 ? `${activeEvent.reminder_lead_minutes / 60} hour(s)` : `${activeEvent.reminder_lead_minutes} minutes`} before`}</p></div><div className="mt-4 rounded-xl border border-border p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Reminder delivery</p>{activeEvent.reminder_deliveries?.length ? <div className="mt-2 space-y-1.5">{activeEvent.reminder_deliveries.map((delivery, index) => <div key={`${delivery.channel_type}-${index}`} className="flex justify-between gap-3 text-[11px]"><span className="capitalize">{delivery.channel_type}</span><span className={delivery.status === "sent" ? "text-emerald-600" : delivery.status === "failed" ? "text-destructive" : "text-muted-foreground"}>{delivery.status === "sent" ? `Sent${delivery.sent_at ? ` · ${format(parseISO(delivery.sent_at), "MMM d, p")}` : ""}` : delivery.status === "pending" ? `Scheduled · ${format(parseISO(delivery.remind_at), "MMM d, p")}` : delivery.status === "processing" ? "Sending" : "Delivery failed"}</span></div>)}</div> : <p className="mt-2 text-[11px] text-muted-foreground">No reminder is queued for a channel.</p>}<p className="mt-2 text-[10px] text-muted-foreground">Sent means the channel accepted the reminder; it cannot confirm that it was opened.</p></div><div className="mt-5 flex justify-between border-t border-border pt-4"><button onClick={() => void deleteEvent(activeEvent.id)} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4"/>Delete</button><button onClick={() => openEdit(activeEvent)} className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground">Edit event</button></div></motion.div></div>}</AnimatePresence>

    <AnimatePresence>{editorOpen && <div className="fixed inset-0 z-50 flex items-center justify-center p-3"><motion.button aria-label="Close editor" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setEditorOpen(false)} className="fixed inset-0 bg-black/55 backdrop-blur-sm"/><motion.div initial={{ opacity: 0, y: 12, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} className="relative z-10 max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-2xl sm:p-6"><div className="flex items-center justify-between border-b border-border pb-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-primary">Event details</p><h3 className="mt-1 text-lg font-bold">{activeEvent ? "Edit event" : "Create an event"}</h3></div><button onClick={() => setEditorOpen(false)} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary"><X className="h-4 w-4"/></button></div>
      <form onSubmit={saveEvent} className="mt-4 space-y-4"><div className="grid gap-4 sm:grid-cols-2"><label className="sm:col-span-2"><span className="text-xs font-medium">Event title *</span><input required maxLength={160} value={draft.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Quarterly planning review" className="mt-1 w-full rounded-xl border border-border bg-secondary/40 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary"/></label><label><span className="text-xs font-medium">Date</span><input required type="date" value={draft.date} onChange={(e) => set("date", e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-secondary/40 px-3 py-2.5 text-sm"/></label><div className="grid grid-cols-2 gap-2"><label><span className="text-xs font-medium">Starts</span><input required type="time" value={draft.start} onChange={(e) => set("start", e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-secondary/40 px-3 py-2.5 text-sm"/></label><label><span className="text-xs font-medium">Ends</span><input required type="time" value={draft.end} onChange={(e) => set("end", e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-secondary/40 px-3 py-2.5 text-sm"/></label></div><label><span className="text-xs font-medium">Priority</span><select value={draft.priority} onChange={(e) => set("priority", e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-secondary/40 px-3 py-2.5 text-sm">{["low", "normal", "high", "urgent"].map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}</select></label><label><span className="text-xs font-medium">Category</span><select value={draft.category} onChange={(e) => set("category", e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-secondary/40 px-3 py-2.5 text-sm">{CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/\b\w/g, (x) => x.toUpperCase())}</option>)}</select></label><label><span className="text-xs font-medium">Organization / client</span><input maxLength={120} value={draft.organization} onChange={(e) => set("organization", e.target.value)} placeholder="Company or team" className="mt-1 w-full rounded-xl border border-border bg-secondary/40 px-3 py-2.5 text-sm"/></label><label><span className="text-xs font-medium">Project</span><input maxLength={120} value={draft.project} onChange={(e) => set("project", e.target.value)} placeholder="Project name" className="mt-1 w-full rounded-xl border border-border bg-secondary/40 px-3 py-2.5 text-sm"/></label><label><span className="text-xs font-medium">Location</span><input maxLength={200} value={draft.location} onChange={(e) => set("location", e.target.value)} placeholder="Room, office, or meeting link" className="mt-1 w-full rounded-xl border border-border bg-secondary/40 px-3 py-2.5 text-sm"/></label><label><span className="text-xs font-medium">Reminder</span><select value={draft.lead} onChange={(e) => set("lead", e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-secondary/40 px-3 py-2.5 text-sm">{LEADS.map((lead) => <option key={lead.value} value={lead.value}>{lead.label}</option>)}</select></label><label className="sm:col-span-2"><span className="text-xs font-medium">Notes</span><textarea rows={3} maxLength={2000} value={draft.description} onChange={(e) => set("description", e.target.value)} placeholder="Agenda, preparation, or follow-up notes" className="mt-1 w-full resize-y rounded-xl border border-border bg-secondary/40 px-3 py-2.5 text-sm"/></label><div className="sm:col-span-2"><span className="text-xs font-medium">Calendar color</span><div className="mt-2 flex gap-3">{COLORS.map((color) => <button type="button" key={color} aria-label={`Set color ${color}`} onClick={() => set("color", color)} style={{ backgroundColor: color }} className={cn("h-6 w-6 rounded-full transition", draft.color === color && "ring-2 ring-offset-2 ring-offset-card ring-foreground")}/>)}</div></div></div>
      {error && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}<div className="flex justify-end gap-2 border-t border-border pt-4"><button type="button" onClick={() => setEditorOpen(false)} className="rounded-xl px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary">Cancel</button><button disabled={saving} type="submit" className="rounded-xl bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{saving ? "Saving…" : activeEvent ? "Save changes" : "Create event"}</button></div></form></motion.div></div>}</AnimatePresence>
  </div>;
}
