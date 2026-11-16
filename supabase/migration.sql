-- Supabase SQL Migration for Nudg
-- Run this in your Supabase SQL editor

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Profiles table (extends Supabase auth.users)
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  full_name text,
  avatar_url text,
  timezone text default 'UTC',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Calendar events
create table public.events (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  title text not null,
  description text,
  start_time timestamptz not null,
  end_time timestamptz not null,
  all_day boolean default false,
  color text default '#6366f1',
  location text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Reminder channels (email, telegram, discord, whatsapp)
create table public.reminder_channels (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  channel_type text not null check (channel_type in ('email', 'telegram', 'discord', 'whatsapp')),
  channel_config jsonb default '{}',
  is_active boolean default true,
  created_at timestamptz default now()
);

-- Reminders
create table public.reminders (
  id uuid default uuid_generate_v4() primary key,
  event_id uuid references public.events(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  channel_id uuid references public.reminder_channels(id) on delete cascade not null,
  remind_at timestamptz not null,
  status text default 'pending' check (status in ('pending', 'sent', 'failed')),
  created_at timestamptz default now()
);

-- Chat messages (conversation memory)
create table public.chat_messages (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  metadata jsonb,
  created_at timestamptz default now()
);

-- Conversation memory summaries (for long-term context)
create table public.conversation_memory (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null unique,
  summary text default '',
  key_facts jsonb default '[]',
  updated_at timestamptz default now()
);

-- Indexes
create index idx_events_user_id on public.events(user_id);
create index idx_events_start_time on public.events(start_time);
create index idx_reminders_remind_at on public.reminders(remind_at);
create index idx_reminders_status on public.reminders(status);
create index idx_chat_messages_user_id on public.chat_messages(user_id);
create index idx_chat_messages_created_at on public.chat_messages(created_at);

-- Row Level Security
alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.reminder_channels enable row level security;
alter table public.reminders enable row level security;
alter table public.chat_messages enable row level security;
alter table public.conversation_memory enable row level security;

-- RLS Policies
create policy "Users can view own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);
create policy "Users can insert own profile" on public.profiles for insert with check (auth.uid() = id);

create policy "Users can CRUD own events" on public.events for all using (auth.uid() = user_id);
create policy "Users can CRUD own channels" on public.reminder_channels for all using (auth.uid() = user_id);
create policy "Users can CRUD own reminders" on public.reminders for all using (auth.uid() = user_id);
create policy "Users can CRUD own messages" on public.chat_messages for all using (auth.uid() = user_id);
create policy "Users can CRUD own memory" on public.conversation_memory for all using (auth.uid() = user_id);

-- Function to auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

-- Trigger to auto-create profile
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
