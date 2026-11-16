"use client";

import { useState, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Bot,
  CalendarCheck,
  RefreshCw,
  CornerDownLeft,
  Check,
} from "lucide-react";
import { format } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";

type ChatEventDraft = { title: string; description?: string; start_time: string; end_time: string; location?: string; priority?: string; category?: string; organization?: string; project?: string; reminder_lead_minutes?: number | null; color?: string; all_day?: boolean };
type ChatInteraction = { type: "clarify_event"; question: string; options: string[] } | { type: "select_event"; question: string; options: { id: string; label: string }[] } | { type: "confirm_event"; confirmation_id: string; confirmation_status?: string; event: ChatEventDraft } | { type: "confirm_event_edit"; confirmation_id: string; confirmation_status?: string; event_id: string; event: ChatEventDraft } | { type: "confirm_event_delete"; confirmation_id: string; confirmation_status?: string; event_id: string; event: { title: string; start_time: string; end_time: string } } | { type: "confirm_event_bulk_delete"; confirmation_id: string; confirmation_status?: string; date: string; events: { id: string; title: string; start_time: string; end_time: string }[] } | { type: "event_created"; confirmation_id?: string; event: { title: string } };
type ChatAction = Extract<ChatInteraction, { type: "event_created" }> | null;

function normalizeAssistantText(value: string) {
  return value
    .replace(/&#x20;|&#32;|&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\\([*_`])/g, "$1")
    .replace(/\\\s*(?=\r?\n|$)/g, "")
    .replace(/[ \t]+\r?\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderInline(text: string): ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*|_[^_]+_)/g);
  return tokens.filter(Boolean).map((token, index) => {
    if ((token.startsWith("**") && token.endsWith("**")) || (token.startsWith("__") && token.endsWith("__"))) {
      return <strong key={index} className="font-semibold text-foreground">{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith("*") && token.endsWith("*")) {
      return <em key={index}>{token.slice(1, -1)}</em>;
    }
    if (token.startsWith("_") && token.endsWith("_")) {
      return <em key={index}>{token.slice(1, -1)}</em>;
    }
    if (token.startsWith("`") && token.endsWith("`")) {
      return <code key={index} className="rounded bg-secondary px-1 py-0.5 font-mono text-[0.9em]">{token.slice(1, -1)}</code>;
    }
    return token;
  });
}

function AssistantMessage({ content }: { content: string }) {
  const lines = normalizeAssistantText(content).split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) { index += 1; continue; }

    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      blocks.push(<h3 key={`h-${index}`} className="mb-2 mt-3 text-sm font-semibold tracking-tight first:mt-0">{renderInline(heading[1])}</h3>);
      index += 1;
      continue;
    }

    const listType = line.match(/^(?:[-*•])\s+(.+)$/) ? "unordered" : line.match(/^\d+[.)]\s+(.+)$/) ? "ordered" : null;
    if (listType) {
      const items: string[] = [];
      const matcher = listType === "unordered" ? /^(?:[-*•])\s+(.+)$/ : /^\d+[.)]\s+(.+)$/;
      while (index < lines.length) {
        const item = lines[index].trim().match(matcher);
        if (!item) break;
        items.push(item[1]);
        index += 1;
      }
      const List = listType === "unordered" ? "ul" : "ol";
      blocks.push(
        <List key={`list-${index}`} className={`${listType === "unordered" ? "list-disc" : "list-decimal"} my-2 space-y-1.5 pl-5 marker:text-accent`}>
          {items.map((item, itemIndex) => <li key={itemIndex} className="pl-1">{renderInline(item)}</li>)}
        </List>
      );
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^#{1,3}\s+/.test(lines[index].trim()) && !/^(?:[-*•])\s+/.test(lines[index].trim()) && !/^\d+[.)]\s+/.test(lines[index].trim())) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(<p key={`p-${index}`} className="my-1.5 first:mt-0 last:mb-0">{renderInline(paragraph.join(" "))}</p>);
  }

  return <div className="space-y-1">{blocks}</div>;
}

const SUGGESTED_PROMPTS = [
  "What is on my schedule today?",
  "Schedule gym tomorrow at 7:00 AM",
  "Dentist appointment next Monday at 2:30 PM",
  "Do I have any meetings next Friday?",
];

function localDateTimeValue(iso: string) {
  const value = new Date(iso);
  return Number.isFinite(value.getTime()) ? new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "";
}

function EventConfirmationCard({ event, disabled, onConfirm, buttonLabel = "Confirm and add event" }: { event: ChatEventDraft; disabled: boolean; onConfirm: (event: ChatEventDraft) => void; buttonLabel?: string }) {
  const [draft, setDraft] = useState<ChatEventDraft>(() => ({ priority: "normal", category: "general", reminder_lead_minutes: null, ...event }));
  const field = (key: keyof ChatEventDraft, value: string | number | null) => setDraft((current) => ({ ...current, [key]: value }));
  const inputClass = "mt-1 w-full rounded-lg border border-border bg-card px-2.5 py-2 text-xs text-foreground";
  return <div className="mt-3 overflow-hidden rounded-xl border border-primary/25 bg-primary/[0.035]"><div className="space-y-3 p-3">
    <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Event title<input value={draft.title} onChange={(e) => field("title", e.target.value)} className={inputClass}/></label>
    <div className="grid gap-2 sm:grid-cols-2"><label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Starts<input type="datetime-local" value={localDateTimeValue(draft.start_time)} onChange={(e) => { const value = new Date(e.target.value); if (Number.isFinite(value.getTime())) field("start_time", value.toISOString()); }} className={inputClass}/></label><label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Ends<input type="datetime-local" value={localDateTimeValue(draft.end_time)} onChange={(e) => { const value = new Date(e.target.value); if (Number.isFinite(value.getTime())) field("end_time", value.toISOString()); }} className={inputClass}/></label></div>
    <div className="grid gap-2 sm:grid-cols-2"><label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Priority<select value={draft.priority ?? "normal"} onChange={(e) => field("priority", e.target.value)} className={inputClass}>{["low", "normal", "high", "urgent"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Category<select value={draft.category ?? "general"} onChange={(e) => field("category", e.target.value)} className={inputClass}>{["general", "meeting", "focus time", "client", "deadline", "personal"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label></div>
    <div className="grid gap-2 sm:grid-cols-2">{(["organization", "project", "location"] as const).map((key) => <label key={key} className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{key === "organization" ? "Organization / client" : key}<input value={draft[key] ?? ""} onChange={(e) => field(key, e.target.value)} className={inputClass}/></label>)}<label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Reminder<select value={draft.reminder_lead_minutes == null ? "default" : String(draft.reminder_lead_minutes)} onChange={(e) => field("reminder_lead_minutes", e.target.value === "default" ? null : Number(e.target.value))} className={inputClass}><option value="default">Account default</option><option value="0">At start</option><option value="5">5 minutes before</option><option value="15">15 minutes before</option><option value="30">30 minutes before</option><option value="60">1 hour before</option><option value="120">2 hours before</option><option value="1440">1 day before</option><option value="10080">1 week before</option></select></label></div>
    <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Notes<textarea rows={2} value={draft.description ?? ""} onChange={(e) => field("description", e.target.value)} className={inputClass}/></label>
    <p className="text-[10px] text-muted-foreground">Review or adjust any field before saving this event to your calendar.</p>
    <button disabled={disabled || !draft.title.trim()} onClick={() => onConfirm(draft)} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"><Check className="h-3.5 w-3.5"/>{disabled ? "Saving…" : buttonLabel}</button>
  </div></div>;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [lastAction, setLastAction] = useState<ChatAction>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  useEffect(() => {
    loadChatHistory();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    const hasProcessingRequest = messages.some((message) => message.role === "user" && message.metadata?.status === "processing");
    if (!hasProcessingRequest) return;
    const timer = window.setInterval(() => { void loadChatHistory(false); }, 2500);
    return () => window.clearInterval(timer);
  }, [messages]);

  async function loadChatHistory(showLoading = true) {
    if (showLoading) setInitialLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true })
        .limit(100);

      if (data && data.length > 0) {
        setMessages(data);
      }
    }
    if (showLoading) setInitialLoading(false);
  }

  async function handleSendMessage(textToSend?: string) {
    const text = textToSend || input;
    if (!text.trim() || loading) return;

    const tempUserMsg: ChatMessage = {
      id: "temp-" + Date.now(),
      user_id: "me",
      role: "user",
      content: text,
      metadata: null,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, tempUserMsg]);
    if (!textToSend) setInput("");
    setLoading(true);
    setLastAction(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
        keepalive: true,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not process your request.");

      if (data.action) {
        setLastAction(data.action);
      }

      const assistantMsg: ChatMessage = {
        id: "ai-" + Date.now(),
        user_id: "nudg-ai",
        role: "assistant",
        content: data.message || "I've handled that for you!",
        metadata: data.action || null,
        created_at: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      console.error(err);
      const errMsg: ChatMessage = {
        id: "err-" + Date.now(),
        user_id: "nudg-ai",
        role: "assistant",
        content: "Sorry, I had trouble processing that request. Please try again!",
        metadata: null,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setLoading(false);
    }
  }

  async function confirmEvent(messageId: string, confirmationId: string, event: ChatEventDraft) {
    if (confirmingId) return;
    setConfirmingId(messageId);
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmEvent: event, confirmationId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not add event.");
      const assistantMsg: ChatMessage = { id: `ai-${Date.now()}`, user_id: "nudg-ai", role: "assistant", content: data.message, metadata: data.action || null, created_at: new Date().toISOString() };
      setMessages((previous) => previous.map((message) => message.id === messageId ? { ...message, metadata: { type: "event_created", confirmation_id: confirmationId, event: { title: event.title } } } : message));
      setMessages((previous) => [...previous, assistantMsg]);
      setLastAction(data.action);
    } catch (error) {
      const assistantMsg: ChatMessage = { id: `err-${Date.now()}`, user_id: "nudg-ai", role: "assistant", content: error instanceof Error ? error.message : "Could not add event.", metadata: null, created_at: new Date().toISOString() };
      setMessages((previous) => [...previous, assistantMsg]);
    } finally { setConfirmingId(null); }
  }

  async function confirmEventEdit(messageId: string, confirmationId: string, event: ChatEventDraft) {
    if (confirmingId) return;
    setConfirmingId(messageId);
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmEventEdit: event, confirmationId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update event.");
      setMessages((previous) => previous.map((message) => message.id === messageId ? { ...message, metadata: { ...(message.metadata || {}), confirmation_status: "confirmed" } } : message));
      setMessages((previous) => [...previous, { id: `ai-${Date.now()}`, user_id: "nudg-ai", role: "assistant", content: data.message, metadata: data.action || null, created_at: new Date().toISOString() }]);
    } catch (error) {
      setMessages((previous) => [...previous, { id: `err-${Date.now()}`, user_id: "nudg-ai", role: "assistant", content: error instanceof Error ? error.message : "Could not update event.", metadata: null, created_at: new Date().toISOString() }]);
    } finally { setConfirmingId(null); }
  }

  async function confirmEventDelete(messageId: string, confirmationId: string) {
    if (confirmingId) return;
    setConfirmingId(messageId);
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmEventDelete: true, confirmationId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not delete event.");
      setMessages((previous) => previous.map((message) => message.id === messageId ? { ...message, metadata: { ...(message.metadata || {}), confirmation_status: "confirmed" } } : message));
      setMessages((previous) => [...previous, { id: `ai-${Date.now()}`, user_id: "nudg-ai", role: "assistant", content: data.message, metadata: data.action || null, created_at: new Date().toISOString() }]);
    } catch (error) {
      setMessages((previous) => [...previous, { id: `err-${Date.now()}`, user_id: "nudg-ai", role: "assistant", content: error instanceof Error ? error.message : "Could not delete event.", metadata: null, created_at: new Date().toISOString() }]);
    } finally { setConfirmingId(null); }
  }

  async function confirmBulkDelete(messageId: string, confirmationId: string) {
    if (confirmingId) return;
    setConfirmingId(messageId);
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmEventBulkDelete: true, confirmationId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not delete the events.");
      setMessages((previous) => previous.map((message) => message.id === messageId ? { ...message, metadata: { ...(message.metadata || {}), confirmation_status: "confirmed" } } : message));
      setMessages((previous) => [...previous, { id: `ai-${Date.now()}`, user_id: "nudg-ai", role: "assistant", content: data.message, metadata: data.action || null, created_at: new Date().toISOString() }]);
    } catch (error) {
      setMessages((previous) => [...previous, { id: `err-${Date.now()}`, user_id: "nudg-ai", role: "assistant", content: error instanceof Error ? error.message : "Could not delete the events.", metadata: null, created_at: new Date().toISOString() }]);
    } finally { setConfirmingId(null); }
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] md:h-screen flex-col bg-background text-foreground">
      {/* ── Chat Header ── */}
      <header className="flex h-16 items-center justify-between border-b border-border px-6 bg-card">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white font-bold text-xs">
            N
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-foreground flex items-center gap-2">
              Nudg Intelligence
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            </h1>
            <p className="text-[11px] text-muted-foreground font-mono">
              Conversational schedule assistant with persistent memory
            </p>
          </div>
        </div>
        <button
          onClick={() => void loadChatHistory()}
          className="btn-press rounded-lg border border-border p-2 text-muted-foreground hover:bg-secondary hover:text-foreground transition"
          title="Refresh history"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </header>

      {/* ── Message Thread ── */}
      <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-4 max-w-4xl mx-auto w-full">
        {initialLoading ? (
          <div className="flex h-full items-center justify-center text-xs font-mono text-muted-foreground">
            Loading context memory...
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center p-6 max-w-md mx-auto">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-card text-accent mb-4">
              <Bot className="h-6 w-6" />
            </div>
            <h2 className="text-base font-bold text-foreground">
              Nudg Assistant Ready
            </h2>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Tell me about any upcoming plans in plain English, or ask questions about your schedule.
            </p>

            {/* Prompt Suggestions */}
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => handleSendMessage(prompt)}
                  className="rounded-lg border border-border bg-card p-3 text-left text-xs font-mono text-muted-foreground hover:border-foreground/30 hover:text-foreground transition group"
                >
                  <span className="line-clamp-2">&ldquo;{prompt}&rdquo;</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.role === "user";
            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn("flex gap-3", isUser ? "justify-end" : "justify-start")}
              >
                {!isUser && (
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-accent text-white text-[10px] font-bold">
                    N
                  </div>
                )}
                <div
                  className={cn(
                    "max-w-[85%] md:max-w-xl rounded-xl px-4 py-3 text-xs sm:text-sm leading-relaxed",
                    isUser
                      ? "bg-primary text-primary-foreground font-medium"
                      : "border border-border bg-card text-foreground"
                  )}
                >
                  {isUser ? <p className="whitespace-pre-wrap">{msg.content}</p> : <AssistantMessage content={msg.content} />}
                  {isUser && msg.metadata?.status === "processing" && <p className="mt-2 text-[10px] text-primary">Nudg is still working on this request…</p>}
                  {!isUser && msg.metadata && (msg.metadata as unknown as ChatInteraction).type === "clarify_event" && (() => {
                    const interaction = msg.metadata as unknown as Extract<ChatInteraction, { type: "clarify_event" }>;
                    return <div className="mt-3 rounded-xl border border-border bg-secondary/40 p-3"><p className="mb-2 text-xs font-semibold">{interaction.question}</p><div className="flex flex-wrap gap-2">{interaction.options.map((option) => <button key={option} disabled={loading} onClick={() => option.toLowerCase().includes("another") ? setInput("Use this time: ") : void handleSendMessage(option)} className="rounded-lg border border-primary/25 bg-card px-3 py-2 text-xs font-medium text-foreground transition hover:border-primary hover:text-primary disabled:opacity-50">{option}</button>)}</div></div>;
                  })()}
                  {!isUser && msg.metadata && (msg.metadata as unknown as ChatInteraction).type === "select_event" && (() => {
                    const interaction = msg.metadata as unknown as Extract<ChatInteraction, { type: "select_event" }>;
                    return <div className="mt-3 rounded-xl border border-border bg-secondary/40 p-3"><p className="mb-2 text-xs font-semibold">{interaction.question}</p><div className="flex flex-wrap gap-2">{interaction.options.map((option) => <button key={option.id} disabled={loading} onClick={() => void handleSendMessage(`I mean “${option.label}” (event ID: ${option.id}). Please continue with my request.`)} className="rounded-lg border border-primary/25 bg-card px-3 py-2 text-xs font-medium text-foreground transition hover:border-primary hover:text-primary disabled:opacity-50">{option.label}</button>)}</div></div>;
                  })()}
                  {!isUser && msg.metadata && (msg.metadata as unknown as ChatInteraction).type === "confirm_event" && (() => {
                    const interaction = msg.metadata as unknown as Extract<ChatInteraction, { type: "confirm_event" }>;
                    return <EventConfirmationCard event={interaction.event} disabled={confirmingId !== null || loading || interaction.confirmation_status !== "pending"} onConfirm={(event) => void confirmEvent(msg.id, interaction.confirmation_id, event)} />;
                  })()}
                  {!isUser && msg.metadata && (msg.metadata as unknown as ChatInteraction).type === "confirm_event_edit" && (() => {
                    const interaction = msg.metadata as unknown as Extract<ChatInteraction, { type: "confirm_event_edit" }>;
                    return <EventConfirmationCard event={interaction.event} disabled={confirmingId !== null || loading || interaction.confirmation_status !== "pending"} buttonLabel="Confirm and save changes" onConfirm={(event) => void confirmEventEdit(msg.id, interaction.confirmation_id, event)} />;
                  })()}
                  {!isUser && msg.metadata && (msg.metadata as unknown as ChatInteraction).type === "confirm_event_delete" && (() => {
                    const interaction = msg.metadata as unknown as Extract<ChatInteraction, { type: "confirm_event_delete" }>;
                    const date = new Date(interaction.event.start_time);
                    return <div className="mt-3 rounded-xl border border-destructive/20 bg-destructive/[0.035] p-3"><p className="text-xs font-semibold">{interaction.event.title}</p><p className="mt-1 text-[11px] text-muted-foreground">{Number.isFinite(date.getTime()) ? format(date, "EEEE, MMMM d · p") : "Calendar event"}</p><button disabled={confirmingId !== null || loading || interaction.confirmation_status !== "pending"} onClick={() => void confirmEventDelete(msg.id, interaction.confirmation_id)} className="mt-3 rounded-lg bg-destructive px-3 py-2 text-xs font-semibold text-destructive-foreground disabled:opacity-50">{confirmingId === msg.id ? "Deleting…" : interaction.confirmation_status === "pending" ? "Confirm deletion" : "Deletion confirmed"}</button></div>;
                  })()}
                  {!isUser && msg.metadata && (msg.metadata as unknown as ChatInteraction).type === "confirm_event_bulk_delete" && (() => {
                    const interaction = msg.metadata as unknown as Extract<ChatInteraction, { type: "confirm_event_bulk_delete" }>;
                    return <div className="mt-3 rounded-xl border border-destructive/20 bg-destructive/[0.035] p-3"><p className="text-xs font-semibold">Events on {interaction.date}</p><ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-[11px] text-muted-foreground">{interaction.events.map((event) => <li key={event.id} className="flex justify-between gap-3"><span className="truncate">{event.title}</span><span className="shrink-0">{format(new Date(event.start_time), "p")}</span></li>)}</ul><button disabled={confirmingId !== null || loading || interaction.confirmation_status !== "pending"} onClick={() => void confirmBulkDelete(msg.id, interaction.confirmation_id)} className="mt-3 rounded-lg bg-destructive px-3 py-2 text-xs font-semibold text-destructive-foreground disabled:opacity-50">{confirmingId === msg.id ? "Deleting…" : interaction.confirmation_status === "pending" ? `Confirm deletion of ${interaction.events.length} event${interaction.events.length === 1 ? "" : "s"}` : "Deletion confirmed"}</button></div>;
                  })()}
                  <div
                    className={cn(
                      "mt-1.5 text-[10px] font-mono",
                      isUser ? "text-primary-foreground/60 text-right" : "text-muted-foreground"
                    )}
                  >
                    {format(new Date(msg.created_at), "p")}
                  </div>
                </div>
              </motion.div>
            );
          })
        )}

        {/* Loading Bubble */}
        {loading && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-white text-[10px] font-bold">
              N
            </div>
            <div className="rounded-xl border border-border bg-card px-4 py-2.5 text-xs text-muted-foreground font-mono flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-accent animate-ping" />
              <span>Parsing intent & schedule...</span>
            </div>
          </motion.div>
        )}

        {/* Action Confirmation Banner */}
        {lastAction && lastAction.type === "event_created" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mx-auto flex max-w-md items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-600 dark:text-emerald-400 font-mono"
          >
            <CalendarCheck className="h-4 w-4 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <span className="font-bold">Scheduled:</span> {lastAction.event.title}
            </div>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input Bar ── */}
      <div className="border-t border-border bg-card p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="mx-auto flex max-w-3xl items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type 'Doctor appointment next Friday 3pm' or ask a question..."
            className="flex-1 rounded-xl border border-border bg-secondary/40 px-4 py-2.5 text-xs sm:text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="btn-press flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground hover:opacity-90 transition disabled:opacity-40"
          >
            <CornerDownLeft className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
