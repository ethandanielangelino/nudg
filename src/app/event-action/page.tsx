"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { CalendarDays, Check, CircleAlert, Clock3, LoaderCircle, X } from "lucide-react";

type EventDetails = { id: string; title: string; description: string | null; start_time: string; end_time: string; location: string | null; priority: string; category: string; organization: string | null; project: string | null; status: string };
type Delivery = { channel_type: string; status: "pending" | "processing" | "sent" | "failed"; remind_at: string; sent_at: string | null; attempts: number };

export default function EventActionPage() {
  const [token, setToken] = useState("");
  const [event, setEvent] = useState<EventDetails | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    queueMicrotask(() => {
      const currentToken = new URLSearchParams(window.location.search).get("token") || "";
      setToken(currentToken);
      if (!currentToken) { setError("This event link is missing its access token."); setLoading(false); return; }
      void fetch(`/api/event-actions?token=${encodeURIComponent(currentToken)}`).then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not load event details.");
        setEvent(result.event);
        setDeliveries(result.reminders ?? []);
      }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load event details.")).finally(() => setLoading(false));
    });
  }, []);

  async function updateEvent(status: "attended" | "completed" | "cancelled") {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/event-actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, status }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update event.");
      setEvent((previous) => previous ? { ...previous, status: result.event.status } : previous);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update event."); }
    setSaving(false);
  }

  return <main className="grid min-h-screen place-items-center bg-background p-5 text-foreground"><section className="w-full max-w-lg rounded-3xl border border-border bg-card p-7 shadow-xl sm:p-9"><div className="mb-7 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">N</div><div><p className="font-semibold tracking-tight">Nudg</p><p className="text-xs text-muted-foreground">Event actions</p></div></div>
    {loading ? <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin"/>Loading your event…</div> : error && !event ? <div className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">{error}</div> : event ? <><p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">Scheduled event</p><h1 className="mt-2 text-2xl font-bold tracking-tight">{event.title}</h1>{event.description && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{event.description}</p>}<div className="mt-5 space-y-3 rounded-2xl bg-secondary/50 p-4 text-sm"><p className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary"/>{format(parseISO(event.start_time), "EEEE, MMMM d, yyyy")}</p><p className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-primary"/>{`${format(parseISO(event.start_time), "p")} – ${format(parseISO(event.end_time), "p")}`}</p><p className="text-xs capitalize text-muted-foreground">{event.priority} priority · {event.category}{event.organization ? ` · ${event.organization}` : ""}{event.project ? ` · ${event.project}` : ""}{event.location ? ` · ${event.location}` : ""}</p></div>
    <div className="mt-5 rounded-2xl border border-border p-4"><h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reminder delivery</h2>{deliveries.length ? <div className="mt-3 space-y-2">{deliveries.map((delivery) => <div key={`${delivery.channel_type}-${delivery.remind_at}`} className="flex items-center justify-between gap-3 text-xs"><span className="capitalize">{delivery.channel_type}</span><span className={delivery.status === "sent" ? "font-medium text-emerald-600" : delivery.status === "failed" ? "font-medium text-destructive" : "text-muted-foreground"}>{delivery.status === "sent" ? `Sent${delivery.sent_at ? ` · ${format(parseISO(delivery.sent_at), "MMM d, p")}` : ""}` : delivery.status === "pending" ? `Scheduled · ${format(parseISO(delivery.remind_at), "MMM d, p")}` : delivery.status === "processing" ? "Sending" : "Could not be delivered"}</span></div>)}</div> : <p className="mt-2 text-xs text-muted-foreground">No reminder is queued. Check the event reminder setting and your active notification channels.</p>}<p className="mt-3 text-[10px] text-muted-foreground">“Sent” means the channel provider accepted it; it cannot confirm that the message was opened.</p></div>
    {event.status === "scheduled" ? <div className="mt-4 grid gap-2 sm:grid-cols-3"><button disabled={saving} onClick={() => void updateEvent("attended")} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"><Check className="h-4 w-4"/>{saving ? "Updating…" : "Mark attended"}</button><button disabled={saving} onClick={() => void updateEvent("completed")} className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-3 py-3 text-xs font-semibold hover:bg-secondary disabled:opacity-50"><Check className="h-4 w-4"/>Mark completed</button><button disabled={saving} onClick={() => void updateEvent("cancelled")} className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-3 py-3 text-xs font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"><X className="h-4 w-4"/>Cancel event</button></div> : <div className="mt-6 flex items-center gap-2 rounded-xl bg-emerald-500/10 p-3 text-sm font-medium capitalize text-emerald-700 dark:text-emerald-400"><Check className="h-4 w-4"/>This event was marked {event.status}.</div>}
    {error && <p className="mt-3 flex items-center gap-2 text-xs text-destructive"><CircleAlert className="h-4 w-4"/>{error}</p>}</> : null}
    <div className="mt-7 border-t border-border pt-5"><Link href="/" className="text-xs font-semibold text-primary hover:underline">Open Nudg</Link></div>
  </section></main>;
}
