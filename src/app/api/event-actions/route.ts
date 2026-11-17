import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyEventActionToken } from "@/lib/event-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Server database credentials are not configured.");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token") || "";
    const claims = verifyEventActionToken(token);
    if (!claims) return NextResponse.json({ error: "This event link is invalid or expired." }, { status: 401 });
    const { data, error } = await adminClient().from("events")
      .select("id,title,description,start_time,end_time,location,priority,category,organization,project,status")
      .eq("id", claims.eventId).eq("user_id", claims.userId).maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "This event is no longer available." }, { status: 404 });
    const supabase = adminClient();
    const { data: reminders, error: reminderError } = await supabase.from("reminders")
      .select("channel_id,status,remind_at,sent_at,attempts")
      .eq("event_id", claims.eventId).eq("user_id", claims.userId).order("remind_at", { ascending: true });
    if (reminderError) throw reminderError;
    const channelIds = [...new Set((reminders ?? []).map((reminder) => reminder.channel_id))];
    const { data: channels, error: channelError } = channelIds.length
      ? await supabase.from("reminder_channels").select("id,channel_type").in("id", channelIds).eq("user_id", claims.userId)
      : { data: [], error: null };
    if (channelError) throw channelError;
    const channelNames = new Map((channels ?? []).map((channel) => [channel.id, channel.channel_type]));
    return NextResponse.json({ event: data, reminders: (reminders ?? []).map((reminder) => ({ ...reminder, channel_type: channelNames.get(reminder.channel_id) ?? "notification" })) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load event." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const claims = verifyEventActionToken(typeof body.token === "string" ? body.token : "");
    const status = body.status;
    if (!claims) return NextResponse.json({ error: "This event link is invalid or expired." }, { status: 401 });
    if (!["attended", "completed", "cancelled"].includes(status)) return NextResponse.json({ error: "Choose a valid event action." }, { status: 400 });
    const supabase = adminClient();
    const { data: current, error: currentError } = await supabase.from("events").select("id,user_id,title,start_time,status")
      .eq("id", claims.eventId).eq("user_id", claims.userId).maybeSingle();
    if (currentError) throw currentError;
    if (!current) return NextResponse.json({ error: "This event is no longer available." }, { status: 404 });
    const effectiveStatus = status === "attended" && Date.now() > new Date(current.start_time).getTime() ? "attended_late" : status;
    const { data, error } = await supabase.from("events").update({ status: effectiveStatus, updated_at: new Date().toISOString() })
      .eq("id", claims.eventId).eq("user_id", claims.userId).eq("status", "scheduled")
      .select("id,status,title").maybeSingle();
    if (error) throw error;
    if (!data) {
      const { data: existing, error: readError } = await supabase.from("events").select("id,status,title")
        .eq("id", claims.eventId).eq("user_id", claims.userId).maybeSingle();
      if (readError) throw readError;
      if (!existing) return NextResponse.json({ error: "This event is no longer available." }, { status: 404 });
      if (existing.status !== effectiveStatus) return NextResponse.json({ error: "This event has already been updated." }, { status: 409 });
      return NextResponse.json({ event: existing });
    }
    const { error: repeatError } = await supabase.from("reminders").update({ repeat_until_action: false })
      .eq("event_id", claims.eventId).eq("user_id", claims.userId);
    if (repeatError) console.error("Could not stop repeated reminders for updated event:", repeatError.message);
    const { error: reminderError } = await supabase.from("reminders").update({ status: "failed", locked_at: null, last_error: `Event ${effectiveStatus.replaceAll("_", " ")}.` })
      .eq("event_id", claims.eventId).eq("user_id", claims.userId).in("status", ["pending", "processing"]);
    if (reminderError) console.error("Could not cancel queued reminders for updated event:", reminderError.message);
    return NextResponse.json({ event: data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update event." }, { status: 500 });
  }
}
