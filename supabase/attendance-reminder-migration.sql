-- Enables persistent Telegram attendance actions and five-minute follow-ups.
-- Run once in the Supabase SQL Editor after the existing Nudg migrations.

alter table public.events
  add column if not exists status text not null default 'scheduled';

alter table public.events
  drop constraint if exists events_status_check;

alter table public.events
  add constraint events_status_check
  check (status in ('scheduled', 'attended', 'attended_late', 'completed', 'cancelled'));

alter table public.reminders
  add column if not exists repeat_until_action boolean not null default false;

create index if not exists reminders_repeat_due_idx
  on public.reminders(status, remind_at)
  where repeat_until_action = true;
