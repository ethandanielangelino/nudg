import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { scheduleEventReminders } from "@/lib/reminders";

const FALLBACK_MODELS = ["gemini-3.8-flash"];

function requestedLocalDate(message: string, timezone: string, now: Date) {
  const lower = message.toLowerCase();
  let year: number, month: number, day: number;
  const relative = lower.match(/\b(today|tomorrow|yesterday)\b/);
  if (relative) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const localToday = new Date(Number(values.year), Number(values.month) - 1, Number(values.day));
    localToday.setDate(localToday.getDate() + (relative[1] === "tomorrow" ? 1 : relative[1] === "yesterday" ? -1 : 0));
    year = localToday.getFullYear(); month = localToday.getMonth() + 1; day = localToday.getDate();
  } else {
    const months: Record<string, number> = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
    const monthDay = lower.match(/\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/) || lower.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)(?:\s+(\d{4}))?\b/);
    const numeric = lower.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?\b/);
    const nowParts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric" }).formatToParts(now);
    const currentYear = Number(nowParts.find((part) => part.type === "year")?.value || now.getUTCFullYear());
    if (monthDay) {
      const monthFirst = /^[a-z]/.test(monthDay[1]);
      month = months[monthDay[monthFirst ? 1 : 2]];
      day = Number(monthDay[monthFirst ? 2 : 1]);
      year = Number(monthDay[monthFirst ? 3 : 4] || currentYear);
    } else if (numeric) {
      month = Number(numeric[1]); day = Number(numeric[2]); year = Number(numeric[3] || currentYear);
    } else return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const [y, m, d] = [year, month, day];
  const startGuess = Date.UTC(y, m - 1, d);
  const offsetMinutes = (instant: number) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant));
    const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
    return (Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second) - instant) / 60_000;
  };
  const startMs = startGuess - offsetMinutes(startGuess) * 60_000;
  const nextGuess = Date.UTC(y, m - 1, d + 1);
  const endMs = nextGuess - offsetMinutes(nextGuess) * 60_000;
  return { dateKey, start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() };
}

function dateKeyInTimezone(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getGeminiStatus(error: unknown) {
  if (error && typeof error === "object" && "status" in error && typeof error.status === "number") {
    return error.status;
  }
  const rawMessage = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(rawMessage) as { error?: { code?: number } };
    return parsed.error?.code;
  } catch {
    return undefined;
  }
}

function shouldTryFallback(error: unknown) {
  const status = getGeminiStatus(error);
  const rawMessage = error instanceof Error ? error.message : String(error);
  return status === 404 || /model .*not available|model .*not found|no longer available/i.test(rawMessage);
}

function describeGeminiError(error: unknown, model: string) {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const status = getGeminiStatus(error);
  if (status === 503 || /high demand|temporarily overloaded/i.test(rawMessage)) {
    return "Gemini is temporarily overloaded, including Nudg’s backup models. Please try again shortly. No event was created.";
  }
  if (status === 429) {
    return "Gemini’s request limit or quota has been reached across Nudg’s available models. Please check your AI Studio limits or try again later. No event was created.";
  }
  try {
    const parsed: unknown = JSON.parse(rawMessage);
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      const detail = (parsed as { error?: { message?: unknown } }).error?.message;
      if (typeof detail === "string") {
        if (/model .*not available|model .*not found|no longer available/i.test(detail)) {
          return `Gemini model “${model}” is unavailable for this API key. Choose a supported model in GEMINI_MODEL.`;
        }
        return detail;
      }
    }
  } catch {
    // SDK errors are usually plain text; keep that detail for actionable failures.
  }
  return rawMessage;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let persistedUserMessageId: string | null = null;
  try {
    const body = await request.json();

    if (body.confirmEventBulkDelete) {
      const confirmationId = typeof body.confirmationId === "string" ? body.confirmationId : "";
      if (!confirmationId) return NextResponse.json({ error: "This deletion confirmation is missing or expired." }, { status: 400 });
      const { data: source, error: sourceError } = await supabase.from("chat_messages").select("id,metadata").eq("user_id", user.id).contains("metadata", { confirmation_id: confirmationId }).maybeSingle();
      if (sourceError) throw sourceError;
      if (!source) return NextResponse.json({ error: "This deletion confirmation is no longer available." }, { status: 404 });
      const metadata = source.metadata as Record<string, unknown>;
      if (metadata.type !== "confirm_event_bulk_delete" || metadata.confirmation_status !== "pending") return NextResponse.json({ error: "This deletion is already being processed or has expired." }, { status: 409 });
      const { data: lock } = await supabase.from("chat_messages").update({ metadata: { ...metadata, confirmation_status: "processing" } }).eq("id", source.id).eq("user_id", user.id).contains("metadata", { confirmation_status: "pending" }).select("id").maybeSingle();
      if (!lock) return NextResponse.json({ error: "This deletion is already being processed. Refresh the chat to see its status." }, { status: 409 });
      const eventIds = Array.isArray(metadata.event_ids) ? metadata.event_ids.filter((id): id is string => typeof id === "string").slice(0, 100) : [];
      if (!eventIds.length) return NextResponse.json({ error: "There are no events to delete." }, { status: 400 });
      const { data: deleted, error } = await supabase.from("events").delete().eq("user_id", user.id).in("id", eventIds).select("id");
      if (error) {
        await supabase.from("chat_messages").update({ metadata: { ...metadata, confirmation_status: "pending" } }).eq("id", source.id).eq("user_id", user.id);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      const count = deleted?.length ?? 0;
      const message = `Deleted ${count} event${count === 1 ? "" : "s"} from your calendar.`;
      const action = { type: "event_bulk_deleted", count };
      await supabase.from("chat_messages").update({ metadata: { ...metadata, confirmation_status: "confirmed", deleted_count: count } }).eq("id", source.id).eq("user_id", user.id);
      await supabase.from("chat_messages").insert({ user_id: user.id, role: "assistant", content: message, metadata: action });
      return NextResponse.json({ message, action });
    }

    if (body.confirmEventEdit || body.confirmEventDelete) {
      const isDelete = Boolean(body.confirmEventDelete);
      const confirmationId = typeof body.confirmationId === "string" ? body.confirmationId : "";
      if (!confirmationId) return NextResponse.json({ error: "This event confirmation is missing or expired." }, { status: 400 });
      const { data: sourceMessage, error: sourceError } = await supabase.from("chat_messages")
        .select("id,metadata").eq("user_id", user.id).contains("metadata", { confirmation_id: confirmationId }).maybeSingle();
      if (sourceError) throw sourceError;
      if (!sourceMessage) return NextResponse.json({ error: "This event confirmation is no longer available." }, { status: 404 });
      const metadata = sourceMessage.metadata as Record<string, unknown>;
      const expectedType = isDelete ? "confirm_event_delete" : "confirm_event_edit";
      if (metadata.type !== expectedType) return NextResponse.json({ error: "This event confirmation does not match the requested action." }, { status: 400 });
      if (metadata.confirmation_status !== "pending") return NextResponse.json({ error: "This event action is already being processed or has expired." }, { status: 409 });
      const { data: lock } = await supabase.from("chat_messages").update({ metadata: { ...metadata, confirmation_status: "processing" } })
        .eq("id", sourceMessage.id).eq("user_id", user.id).contains("metadata", { confirmation_status: "pending" }).select("id").maybeSingle();
      if (!lock) return NextResponse.json({ error: "This event action is already being processed. Refresh the chat to see its status." }, { status: 409 });
      const eventId = typeof metadata.event_id === "string" ? metadata.event_id : "";
      const { data: existing, error: lookupError } = await supabase.from("events").select("*").eq("id", eventId).eq("user_id", user.id).maybeSingle();
      if (lookupError || !existing) {
        await supabase.from("chat_messages").update({ metadata: { ...metadata, confirmation_status: "pending" } }).eq("id", sourceMessage.id).eq("user_id", user.id);
        return NextResponse.json({ error: lookupError?.message || "That event could not be found on your calendar." }, { status: lookupError ? 500 : 404 });
      }
      let event = existing;
      if (isDelete) {
        const { error } = await supabase.from("events").delete().eq("id", eventId).eq("user_id", user.id);
        if (error) {
          await supabase.from("chat_messages").update({ metadata: { ...metadata, confirmation_status: "pending" } }).eq("id", sourceMessage.id).eq("user_id", user.id);
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
      } else {
        const pending = body.confirmEventEdit as Record<string, unknown>;
        const start = new Date(String(pending.start_time || ""));
        const end = new Date(String(pending.end_time || ""));
        if (typeof pending.title !== "string" || !pending.title.trim() || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
          await supabase.from("chat_messages").update({ metadata: { ...metadata, confirmation_status: "pending" } }).eq("id", sourceMessage.id).eq("user_id", user.id);
          return NextResponse.json({ error: "The event details are incomplete. Review the date, time, and title." }, { status: 400 });
        }
        const lead = pending.reminder_lead_minutes == null ? null : Number(pending.reminder_lead_minutes);
        if (lead !== null && (!Number.isInteger(lead) || lead < 0 || lead > 10080)) {
          await supabase.from("chat_messages").update({ metadata: { ...metadata, confirmation_status: "pending" } }).eq("id", sourceMessage.id).eq("user_id", user.id);
          return NextResponse.json({ error: "Invalid reminder timing." }, { status: 400 });
        }
        const { data: updated, error } = await supabase.from("events").update({
          title: pending.title.trim().slice(0, 160), description: typeof pending.description === "string" ? pending.description.slice(0, 2000) : null,
          start_time: start.toISOString(), end_time: end.toISOString(), all_day: Boolean(pending.all_day),
          color: typeof pending.color === "string" ? pending.color : existing.color || "#6366f1",
          location: typeof pending.location === "string" ? pending.location.slice(0, 200) : null,
          priority: ["low", "normal", "high", "urgent"].includes(String(pending.priority)) ? pending.priority : "normal",
          category: typeof pending.category === "string" ? pending.category.slice(0, 60) : "general",
          organization: typeof pending.organization === "string" ? pending.organization.slice(0, 120) : null,
          project: typeof pending.project === "string" ? pending.project.slice(0, 120) : null,
          reminder_lead_minutes: lead, updated_at: new Date().toISOString(),
        }).eq("id", eventId).eq("user_id", user.id).select().single();
        if (error) {
          await supabase.from("chat_messages").update({ metadata: { ...metadata, confirmation_status: "pending" } }).eq("id", sourceMessage.id).eq("user_id", user.id);
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
        event = updated;
        try { await scheduleEventReminders(supabase, user.id, event, true); }
        catch (reminderError) { console.error("Reminder scheduling failed after chat edit:", reminderError); }
      }
      const action = isDelete ? { type: "event_deleted", event: { id: eventId, title: existing.title } } : { type: "event_updated", event };
      const message = isDelete ? `Deleted “${existing.title}” from your calendar.` : `Updated “${event.title}” on your calendar.`;
      await supabase.from("chat_messages").update({ metadata: { ...metadata, confirmation_status: "confirmed" } }).eq("id", sourceMessage.id).eq("user_id", user.id);
      await supabase.from("chat_messages").insert({ user_id: user.id, role: "assistant", content: message, metadata: action });
      return NextResponse.json({ message, action });
    }

    if (body.confirmEvent) {
      const pending = body.confirmEvent;
      const confirmationId = typeof body.confirmationId === "string" ? body.confirmationId : "";
      if (!confirmationId) return NextResponse.json({ error: "This event confirmation is missing or expired." }, { status: 400 });
      const { data: sourceMessage, error: sourceError } = await supabase.from("chat_messages")
        .select("id,metadata").eq("user_id", user.id).contains("metadata", { confirmation_id: confirmationId }).maybeSingle();
      if (sourceError) throw sourceError;
      if (!sourceMessage) return NextResponse.json({ error: "This event draft is no longer available. Please ask Nudg to prepare it again." }, { status: 404 });
      const sourceMetadata = sourceMessage.metadata as Record<string, unknown>;
      if (sourceMetadata.confirmation_status === "confirmed" && typeof sourceMetadata.event_id === "string") {
        const { data: existingEvent } = await supabase.from("events").select("*").eq("id", sourceMetadata.event_id).eq("user_id", user.id).maybeSingle();
        if (existingEvent) return NextResponse.json({ message: `“${existingEvent.title}” is already on your calendar.`, action: { type: "event_created", event: existingEvent } });
      }
      if (sourceMetadata.confirmation_status !== "pending") return NextResponse.json({ error: "This event draft is already being saved or has expired." }, { status: 409 });
      const { data: lock } = await supabase.from("chat_messages")
        .update({ metadata: { ...sourceMetadata, confirmation_status: "processing" } })
        .eq("id", sourceMessage.id).eq("user_id", user.id).contains("metadata", { confirmation_status: "pending" }).select("id").maybeSingle();
      if (!lock) return NextResponse.json({ error: "This event draft is already being saved. Refresh the chat to see its status." }, { status: 409 });
      const start = new Date(pending.start_time);
      const end = new Date(pending.end_time);
      if (typeof pending.title !== "string" || !pending.title.trim() || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
        await supabase.from("chat_messages").update({ metadata: { ...sourceMetadata, confirmation_status: "pending" } }).eq("id", sourceMessage.id).eq("user_id", user.id);
        return NextResponse.json({ error: "The event details are incomplete. Please send the request again." }, { status: 400 });
      }
      const lead = pending.reminder_lead_minutes == null ? null : Number(pending.reminder_lead_minutes);
      if (lead !== null && (!Number.isInteger(lead) || lead < 0 || lead > 10080)) {
        await supabase.from("chat_messages").update({ metadata: { ...sourceMetadata, confirmation_status: "pending" } }).eq("id", sourceMessage.id).eq("user_id", user.id);
        return NextResponse.json({ error: "Invalid reminder timing." }, { status: 400 });
      }
      const { data: event, error } = await supabase.from("events").insert({
        user_id: user.id,
        title: pending.title.trim().slice(0, 160),
        description: typeof pending.description === "string" ? pending.description.slice(0, 2000) : null,
        start_time: start.toISOString(), end_time: end.toISOString(),
        all_day: Boolean(pending.all_day), color: typeof pending.color === "string" ? pending.color : "#6366f1",
        location: typeof pending.location === "string" ? pending.location.slice(0, 200) : null,
        priority: ["low", "normal", "high", "urgent"].includes(pending.priority) ? pending.priority : "normal",
        category: typeof pending.category === "string" ? pending.category.slice(0, 60) : "general",
        organization: typeof pending.organization === "string" ? pending.organization.slice(0, 120) : null,
        project: typeof pending.project === "string" ? pending.project.slice(0, 120) : null,
        reminder_lead_minutes: lead,
      }).select().single();
      if (error) {
        await supabase.from("chat_messages").update({ metadata: { ...sourceMetadata, confirmation_status: "pending" } }).eq("id", sourceMessage.id).eq("user_id", user.id);
        return NextResponse.json({ error: "Could not add that event to your calendar." }, { status: 500 });
      }
      try { await scheduleEventReminders(supabase, user.id, event); }
      catch (reminderError) { console.error("Reminder scheduling failed after chat confirmation:", reminderError); }
      const content = `Added “${event.title}” to your calendar.`;
      const action = { type: "event_created", event };
      await supabase.from("chat_messages").update({ metadata: { type: "event_created", confirmation_id: confirmationId, confirmation_status: "confirmed", event_id: event.id, event: { title: event.title } } }).eq("id", sourceMessage.id).eq("user_id", user.id);
      await supabase.from("chat_messages").insert({ user_id: user.id, role: "assistant", content, metadata: action });
      const { data: memory } = await supabase.from("conversation_memory").select("summary, key_facts").eq("user_id", user.id).maybeSingle();
      await supabase.from("conversation_memory").upsert({
        user_id: user.id,
        summary: `${memory?.summary || ""}\nNudg: ${content}`.trim().slice(-6000),
        key_facts: memory?.key_facts || [],
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      return NextResponse.json({ message: content, action });
    }

    const { message } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }
    const bulkDeleteIntent = /\b(delete|remove|cancel)\s+(?:(?:all)\s+)?(?:the\s+)?events?\s+(?:on|in|for)\b/i.test(message);

    // 1. Fetch recent and upcoming events so the assistant can identify edit/delete targets.
    const now = new Date();
    const { data: profile } = await supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle();
    const { data: savedMemory } = await supabase.from("conversation_memory").select("summary, key_facts").eq("user_id", user.id).maybeSingle();
    const userTimezone = profile?.timezone || "UTC";
    const userLocalNow = now.toLocaleString("en-US", { timeZone: userTimezone, dateStyle: "full", timeStyle: "long" });
    const sixtyDaysLater = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const { data: upcomingEvents } = await supabase
      .from("events")
      .select("*")
      .eq("user_id", user.id)
      .gte("start_time", thirtyDaysAgo.toISOString())
      .lte("start_time", sixtyDaysLater.toISOString())
      .order("start_time", { ascending: true })
      .limit(20);

    // 2. Fetch recent chat history
    const { data: recentHistory } = await supabase
      .from("chat_messages")
      .select("role, content")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(12);

    const reversedHistory = (recentHistory || []).reverse();
    const { data: persistedUserMessage, error: persistError } = await supabase.from("chat_messages")
      .insert({ user_id: user.id, role: "user", content: message.slice(0, 4000), metadata: { status: "processing" } }).select("id").single();
    if (persistError) throw persistError;
    persistedUserMessageId = persistedUserMessage.id;

    // 3. Check for GEMINI_API_KEY
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";

    let assistantReply = "";
    let actionResult = null;

    if (apiKey && apiKey !== "your_gemini_api_key" && !bulkDeleteIntent) {
      try {
        const ai = new GoogleGenAI({
          apiKey,
          // The SDK retries quota/overload errors five times by default, with backoff up to 60s.
          // Chat should return a clear retryable error promptly instead of appearing frozen.
          httpOptions: { timeout: 18_000, retryOptions: { attempts: 1 } },
        });

        const systemPrompt = `You are Nudg, an intelligent, personal scheduling assistant.
The current UTC time is: ${now.toISOString()}.
The user's timezone is ${userTimezone}; their current local date and time is ${userLocalNow}. Interpret date/time requests in that timezone and return event timestamps as ISO 8601 UTC.

Response style: Write concise, professional answers in plain language. Use normal Markdown only: short paragraphs, simple hyphen bullets for multiple events, and bold labels when useful. Never emit HTML entities, raw HTML, or escaped Markdown.

User's upcoming events:
${JSON.stringify(upcomingEvents || [], null, 2)}

Long-term conversation memory (saved for this user):
${(savedMemory?.summary || "No long-term notes have been saved yet.").slice(-2500)}
${JSON.stringify(savedMemory?.key_facts || [])}

Your capabilities:
1. Answering questions about their schedule, free time, or plans.
2. Helping users schedule events through an interactive confirmation.
3. Helping them edit or delete events through an interactive confirmation.
4. Helping them organize reminders.

When the user asks to schedule an event, collect the date and start time first. Do not invent a time. If an essential detail is missing or ambiguous, ask one short question and include a \`clarify_event\` action block with 2–5 short button choices. Include a partial draft object when possible. If all required information is present, infer a reasonable one-hour duration only when the user did not provide one, then show a concise event summary and include a \`confirm_event\` action block. Never create the event in the database yourself. The user must press the confirmation button. Use the user's timezone. Date-only requests such as “December 4” still need a start time; ask for it. Defaults: priority normal, category general, reminder timing account default.

Example clarification block (the only JSON, at the very end):
\`\`\`action
{
  "action": "clarify_event",
  "question": "What time should I schedule this for?",
  "options": ["9:00 AM", "1:00 PM", "Choose another time"],
  "draft": {"title": "Appointment with Bryan", "date": "2026-12-04"}
}
\`\`\`
For a complete request, use action \`confirm_event\` and provide an \`event\` object containing title, description, start_time, end_time, all_day, color, location, priority, category, organization, project, and reminder_lead_minutes (null means account default). Provide the readable summary before the block.`;

        const fullSystemPrompt = `${systemPrompt}

When asked to edit or delete an event, match it against the user's event list by title and date. Never guess an event ID. If multiple events could match, ask one short clarifying question and include a select_event action whose options are objects with exact event IDs and readable labels. For a unique match, summarize the proposed change and finish with an action block. For deletion use {"action":"confirm_event_delete","event_id":"<exact id>"}. For editing use {"action":"confirm_event_edit","event_id":"<exact id>","event":{...complete updated event fields...}}. Preserve fields the user did not ask to change. Nudg must wait for a confirmation button before changing the calendar. Treat cancellation of an event as deletion requiring confirmation.`;

        // Format contents for Gemini
        const contents = [
          ...reversedHistory.map((h) => ({
            role: h.role === "assistant" ? "model" : "user",
            parts: [{ text: h.content.slice(-1400) }],
          })),
          { role: "user", parts: [{ text: message }] },
        ];

        const models = [...new Set([model, ...FALLBACK_MODELS])].slice(0, 2);
        let responseText: string | undefined;
        let generationSucceeded = false;
        let lastModelError: unknown;

        for (const [index, candidateModel] of models.entries()) {
          try {
            const response = await ai.models.generateContent({
              model: candidateModel,
              contents: contents as Parameters<typeof ai.models.generateContent>[0]["contents"],
              config: { systemInstruction: fullSystemPrompt },
            });
            generationSucceeded = true;
            responseText = response.text;
            break;
          } catch (modelError) {
            lastModelError = modelError;
            if (!shouldTryFallback(modelError) || index === models.length - 1) throw modelError;
            console.warn(`Gemini model ${candidateModel} unavailable; trying a fallback model.`);
          }
        }

        if (!generationSucceeded && lastModelError) throw lastModelError;
        assistantReply = responseText || "I've processed your request!";
      } catch (geminiError) {
        console.error("Gemini API call failed:", geminiError);
        const errorMessage = describeGeminiError(geminiError, model);
        assistantReply = `I ran into an issue connecting to my AI brain: ${errorMessage}. Let me still assist you!`;
      }
    } else {
      // Never invent an event time when the AI provider is not configured.
      const lower = message.toLowerCase();
      if (lower.includes("schedule") || lower.includes("meeting") || lower.includes("call") || lower.includes("remind") || lower.includes("dinner") || lower.includes("appointment")) {
        assistantReply = "AI scheduling is not connected yet. Add a Gemini API key to enable natural-language scheduling, or use the New Event form to add this plan with an exact time.";
      } else if (lower.includes("what") || lower.includes("events") || lower.includes("today") || lower.includes("week")) {
        const count = upcomingEvents?.length || 0;
        assistantReply = `You currently have ${count} upcoming event${count === 1 ? "" : "s"} scheduled. Check the Calendar or Dashboard tab to see your full timeline!`;
      } else {
        assistantReply = `Hello! I'm Nudg, your personal AI schedule assistant. You can tell me things like "Schedule a team sync tomorrow at 3pm" or "What's on my calendar this week?" and I'll keep your schedule organized!`;
      }
    }

    // Parse the assistant's interactive follow-up or event preview.
    const actionMatch = assistantReply.match(/```action\s*([\s\S]*?)\s*```/);
    if (actionMatch && actionMatch[1]) {
      try {
        const actionData = JSON.parse(actionMatch[1]);
        if (actionData.action === "clarify_event" && typeof actionData.question === "string") {
          const options = Array.isArray(actionData.options) ? actionData.options.filter((option: unknown) => typeof option === "string").slice(0, 5) : [];
          actionResult = { type: "clarify_event", question: actionData.question.slice(0, 300), options: options.length ? options : ["9:00 AM", "1:00 PM", "Choose another time"] };
        }
        if ((actionData.action === "confirm_event" && actionData.event && typeof actionData.event === "object") || actionData.action === "create_event") {
          const candidate = actionData.event && typeof actionData.event === "object" ? actionData.event : actionData;
          const start = new Date(candidate.start_time);
          let end = new Date(candidate.end_time);
          if (!Number.isFinite(end.getTime()) && Number.isFinite(start.getTime())) end = new Date(start.getTime() + 60 * 60_000);
          if (typeof candidate.title === "string" && Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && end > start) {
            actionResult = { type: "confirm_event", confirmation_id: randomUUID(), confirmation_status: "pending", event: { ...candidate, start_time: start.toISOString(), end_time: end.toISOString() } };
          }
        }
        if (actionData.action === "select_event" && Array.isArray(actionData.options)) {
          const validEvents = new Map((upcomingEvents ?? []).map((event) => [event.id, event]));
          const options = actionData.options.filter((option: unknown) => option && typeof option === "object" && typeof (option as { id?: unknown }).id === "string" && validEvents.has((option as { id: string }).id)).slice(0, 5).map((option: { id: string; label?: string }) => ({ id: option.id, label: String(option.label || validEvents.get(option.id)?.title || "Choose event").slice(0, 180) }));
          if (options.length) actionResult = { type: "select_event", question: typeof actionData.question === "string" ? actionData.question.slice(0, 240) : "Which event did you mean?", options };
        }
        if ((actionData.action === "confirm_event_edit" || actionData.action === "confirm_event_delete") && typeof actionData.event_id === "string") {
          const { data: target } = await supabase.from("events").select("*").eq("id", actionData.event_id).eq("user_id", user.id).maybeSingle();
          if (target) {
            const confirmationId = randomUUID();
            if (actionData.action === "confirm_event_delete") {
              actionResult = { type: "confirm_event_delete", confirmation_id: confirmationId, confirmation_status: "pending", event_id: target.id, event: { title: target.title, start_time: target.start_time, end_time: target.end_time } };
            } else if (actionData.event && typeof actionData.event === "object") {
              const updated = { ...target, ...actionData.event, id: target.id };
              const start = new Date(updated.start_time), end = new Date(updated.end_time);
              if (typeof updated.title === "string" && updated.title.trim() && Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && end > start) {
                actionResult = { type: "confirm_event_edit", confirmation_id: confirmationId, confirmation_status: "pending", event_id: target.id, event: { ...updated, start_time: start.toISOString(), end_time: end.toISOString() } };
              }
            }
          }
        }
      } catch (parseErr) {
        console.error("Action parse error:", parseErr);
      }
    }

    let bulkDeleteFeedback: string | null = null;
    if (bulkDeleteIntent) {
      const requestedDate = requestedLocalDate(message, userTimezone, now);
      if (!requestedDate) {
        bulkDeleteFeedback = "Which date should I use? For example, “delete all events on November 15.”";
        actionResult = null;
      } else {
        const { data: matchingEvents, error: matchingError } = await supabase.from("events").select("*").eq("user_id", user.id).gte("start_time", requestedDate.start).lt("start_time", requestedDate.end).order("start_time", { ascending: true }).limit(100);
        if (matchingError) throw matchingError;
        const eventsForDate = (matchingEvents ?? []).filter((event) => event.status !== "cancelled" && dateKeyInTimezone(event.start_time, userTimezone) === requestedDate.dateKey);
        if (!eventsForDate.length) {
          bulkDeleteFeedback = `I couldn’t find any events on ${requestedDate.dateKey}. Nothing was deleted.`;
          actionResult = null;
        } else {
          const eventList = eventsForDate.map((event) => ({ id: event.id, title: event.title, start_time: event.start_time, end_time: event.end_time }));
          actionResult = { type: "confirm_event_bulk_delete", confirmation_id: randomUUID(), confirmation_status: "pending", date: requestedDate.dateKey, event_ids: eventList.map((event) => event.id), events: eventList };
          const eventLines = eventList.map((event) => `- **${event.title}** — ${new Date(event.start_time).toLocaleTimeString("en-US", { timeZone: userTimezone, hour: "numeric", minute: "2-digit" })}`).join("\n");
          bulkDeleteFeedback = `I found ${eventList.length} event${eventList.length === 1 ? "" : "s"} on ${requestedDate.dateKey}:\n\n${eventLines}\n\nReview the list and use the confirmation button below to delete them.`;
        }
      }
    }

    // Clean action block from assistant reply for display
    const cleanedReply = assistantReply.replace(/```action[\s\S]*?```/g, "").trim();

    // A schedule request is only successful when a confirmed event was saved.
    const wantsEvent = /\b(add|create|schedule|book|put|set up|edit|update|change|delete|remove|cancel|reschedule|move)\b/i.test(message) || /\b(i have|i've got|remind me about|remind me to)\b.{0,80}\b(appointment|meeting|call|lunch|dinner|event|dentist|interview)\b/i.test(message);
    const safeReply = bulkDeleteFeedback || (actionResult?.type === "confirm_event"
      ? "Review the event details below. Confirm the draft to add it to your calendar."
      : actionResult?.type === "confirm_event_edit"
        ? "Review the updated event details below. Confirm to save these changes."
        : actionResult?.type === "confirm_event_delete"
          ? "Review the event below. Confirm to delete it from your calendar."
          : actionResult?.type === "select_event"
            ? "Choose the event you mean below, and I’ll prepare the requested change."
      : wantsEvent && !actionResult
        ? "I haven’t changed your calendar yet. Please include the event date and start time so I can prepare a reviewable draft, or use the calendar form."
      : cleanedReply);
    await supabase.from("chat_messages").insert({ user_id: user.id, role: "assistant", content: safeReply, metadata: actionResult });
    await supabase.from("chat_messages").update({ metadata: { status: "received" } }).eq("id", persistedUserMessage.id).eq("user_id", user.id);
    const priorSummary = savedMemory?.summary || "";
    const nextSummary = `${priorSummary}\nUser: ${message}\nNudg: ${safeReply}`.trim().slice(-4000);
    const { error: memoryError } = await supabase.from("conversation_memory").upsert({
      user_id: user.id, summary: nextSummary, key_facts: savedMemory?.key_facts || [], updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (memoryError) console.error("Could not update long-term conversation memory:", memoryError.message);

    return NextResponse.json({
      message: safeReply,
      action: actionResult,
    });
  } catch (err) {
    console.error("Chat error:", err);
    if (persistedUserMessageId) {
      await supabase.from("chat_messages").update({ metadata: { status: "failed" } }).eq("id", persistedUserMessageId).eq("user_id", user.id);
      await supabase.from("chat_messages").insert({ user_id: user.id, role: "assistant", content: "I couldn’t finish processing that request. Your message is saved; please try again.", metadata: null });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Chat request failed." }, { status: 500 });
  }
}
