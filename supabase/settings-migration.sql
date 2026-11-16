-- Run once in the Supabase SQL editor after migration.sql.
-- Adds persisted reminder preferences and guarantees one row per user/channel.

alter table public.profiles
  add column if not exists reminder_lead_minutes integer not null default 15;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_reminder_lead_minutes_check'
  ) then
    alter table public.profiles
      add constraint profiles_reminder_lead_minutes_check
      check (reminder_lead_minutes in (5, 15, 30, 60, 1440));
  end if;
end $$;

-- Keep the oldest record if a user already has duplicate channel rows.
with ranked_channels as (
  select id,
    row_number() over (
      partition by user_id, channel_type
      order by created_at asc, id asc
    ) as row_number
  from public.reminder_channels
)
delete from public.reminder_channels as channels
using ranked_channels
where channels.id = ranked_channels.id
  and ranked_channels.row_number > 1;

create unique index if not exists reminder_channels_user_type_unique
  on public.reminder_channels(user_id, channel_type);

alter table public.reminders
  add column if not exists attempts integer not null default 0,
  add column if not exists last_error text,
  add column if not exists locked_at timestamptz;

alter table public.reminders
  drop constraint if exists reminders_status_check;
alter table public.reminders
  add constraint reminders_status_check
  check (status in ('pending', 'processing', 'sent', 'failed'));

create index if not exists reminders_due_pending_idx
  on public.reminders(remind_at)
  where status = 'pending';

-- Collapse duplicate reminder rows before enforcing one per event/channel.
with ranked_reminders as (
  select id,
    row_number() over (
      partition by event_id, channel_id
      order by created_at asc, id asc
    ) as row_number
  from public.reminders
)
delete from public.reminders as reminders
using ranked_reminders
where reminders.id = ranked_reminders.id
  and ranked_reminders.row_number > 1;

create unique index if not exists reminders_event_channel_unique
  on public.reminders(event_id, channel_id);
