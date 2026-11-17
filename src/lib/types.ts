// Database types for Nudg

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export interface CalendarEvent {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  all_day: boolean;
  color: string;
  location: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  category: string;
  organization: string | null;
  project: string | null;
  reminder_lead_minutes: number | null;
  status?: "scheduled" | "attended" | "attended_late" | "completed" | "cancelled";
  reminder_deliveries?: Array<{
    channel_type: string;
    status: "pending" | "processing" | "sent" | "failed";
    remind_at: string;
    sent_at: string | null;
    repeat_until_action?: boolean;
  }>;
  created_at: string;
  updated_at: string;
}

export interface ReminderChannel {
  id: string;
  user_id: string;
  channel_type: "email" | "telegram" | "discord" | "whatsapp";
  channel_config: Record<string, string>;
  is_active: boolean;
  created_at: string;
}

export interface Reminder {
  id: string;
  event_id: string;
  user_id: string;
  channel_id: string;
  remind_at: string;
  status: "pending" | "sent" | "failed";
  created_at: string;
}

export interface ChatMessage {
  id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface ConversationMemory {
  id: string;
  user_id: string;
  summary: string;
  key_facts: string[];
  updated_at: string;
}
