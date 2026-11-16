import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { scheduleEventReminders } from "@/lib/reminders";
import type { CalendarEvent } from "@/lib/types";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  let query = supabase
    .from("events")
    .select("*")
    .eq("user_id", user.id)
    .order("start_time", { ascending: true });

  if (start) {
    query = query.gte("start_time", start);
  }
  if (end) {
    query = query.lte("end_time", end);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Optional workflow fields are added by a later migration. Do not let a missing
  // reminder delivery column make the entire calendar disappear.
  const visibleEvents = (data ?? []).filter((event) => event.status !== "cancelled");
  const eventIds = visibleEvents.map((event) => event.id);
  if (!eventIds.length) return NextResponse.json({ events: [] });
  const { data: reminders, error: reminderError } = await supabase.from("reminders")
    .select("event_id,channel_id,status,remind_at,sent_at").eq("user_id", user.id).in("event_id", eventIds);
  if (reminderError) {
    console.warn("Reminder delivery details are unavailable; returning calendar events:", reminderError.message);
    return NextResponse.json({ events: visibleEvents.map((event) => ({ ...event, reminder_deliveries: [] })) });
  }
  const channelIds = [...new Set((reminders ?? []).map((reminder) => reminder.channel_id))];
  const { data: channels, error: channelError } = channelIds.length
    ? await supabase.from("reminder_channels").select("id,channel_type").eq("user_id", user.id).in("id", channelIds)
    : { data: [], error: null };
  if (channelError) {
    console.warn("Reminder channel labels are unavailable; returning calendar events:", channelError.message);
    return NextResponse.json({ events: visibleEvents.map((event) => ({ ...event, reminder_deliveries: [] })) });
  }
  const channelNames = new Map((channels ?? []).map((channel) => [channel.id, channel.channel_type]));
  const deliveriesByEvent = new Map<string, NonNullable<CalendarEvent["reminder_deliveries"]>>();
  for (const reminder of reminders ?? []) {
    const deliveries = deliveriesByEvent.get(reminder.event_id) ?? [];
    deliveries.push({ channel_type: channelNames.get(reminder.channel_id) ?? "notification", status: reminder.status, remind_at: reminder.remind_at, sent_at: reminder.sent_at });
    deliveriesByEvent.set(reminder.event_id, deliveries);
  }
  return NextResponse.json({ events: visibleEvents.map((event) => ({ ...event, reminder_deliveries: deliveriesByEvent.get(event.id) ?? [] })) });
}

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
    const { title, description, start_time, end_time, all_day, color, location,
      priority = "normal", category = "general", organization, project, reminder_lead_minutes } = body;

    if (!title || !start_time || !end_time) {
      return NextResponse.json(
        { error: "Title, start time, and end time are required" },
        { status: 400 }
      );
    }

    if (!new Date(start_time).getTime() || !new Date(end_time).getTime() || new Date(end_time) <= new Date(start_time)) {
      return NextResponse.json({ error: "End time must be after start time." }, { status: 400 });
    }
    if (!["low", "normal", "high", "urgent"].includes(priority)) {
      return NextResponse.json({ error: "Choose a valid priority." }, { status: 400 });
    }
    const lead = reminder_lead_minutes === "default" || reminder_lead_minutes === "" || reminder_lead_minutes == null
      ? null : Number(reminder_lead_minutes);
    if (lead !== null && (!Number.isInteger(lead) || lead < 0 || lead > 10080)) {
      return NextResponse.json({ error: "Reminder time must be between 0 minutes and 7 days." }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("events")
      .insert({
        user_id: user.id,
        title,
        description: description || null,
        start_time,
        end_time,
        all_day: Boolean(all_day),
        color: color || "#6366f1",
        location: location || null,
        priority,
        category: String(category || "general").trim().slice(0, 60),
        organization: organization?.trim() || null,
        project: project?.trim() || null,
        reminder_lead_minutes: lead,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let reminderWarning: string | null = null;
    try {
      await scheduleEventReminders(supabase, user.id, data);
    } catch (reminderError) {
      reminderWarning = reminderError instanceof Error ? reminderError.message : "Could not schedule reminders.";
      console.error("Reminder scheduling failed after event creation:", reminderError);
    }
    return NextResponse.json({ event: data, reminderWarning });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not create event." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const { id, title, description, start_time, end_time, all_day, color, location,
      priority = "normal", category = "general", organization, project, reminder_lead_minutes } = body;
    if (!id || !title || !start_time || !end_time) return NextResponse.json({ error: "Event ID, title, start, and end are required." }, { status: 400 });
    const start = new Date(start_time), end = new Date(end_time);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return NextResponse.json({ error: "End time must be after start time." }, { status: 400 });
    if (!["low", "normal", "high", "urgent"].includes(priority)) return NextResponse.json({ error: "Choose a valid priority." }, { status: 400 });
    const lead = reminder_lead_minutes === "default" || reminder_lead_minutes === "" || reminder_lead_minutes == null ? null : Number(reminder_lead_minutes);
    if (lead !== null && (!Number.isInteger(lead) || lead < 0 || lead > 10080)) return NextResponse.json({ error: "Reminder time must be between 0 minutes and 7 days." }, { status: 400 });
    const { data, error } = await supabase.from("events").update({
      title: String(title).trim(), description: description || null, start_time, end_time,
      all_day: Boolean(all_day), color: color || "#6366f1", location: location || null,
      priority, category: String(category || "general").trim().slice(0, 60),
      organization: organization?.trim() || null, project: project?.trim() || null,
      reminder_lead_minutes: lead, updated_at: new Date().toISOString(),
    }).eq("id", id).eq("user_id", user.id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    let reminderWarning: string | null = null;
    try { await scheduleEventReminders(supabase, user.id, data, true); }
    catch (err) { reminderWarning = err instanceof Error ? err.message : "Could not update reminders."; }
    return NextResponse.json({ event: data, reminderWarning });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not update event." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Event ID is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("events")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
