-- Run once. This is safe whether or not event-actions-migration.sql was previously applied.
-- Supports attendee feedback and shows the actual reminder delivery outcome per channel.

alter table public.events
  add column if not exists status text not null default 'scheduled';
alter table public.events
  drop constraint if exists events_status_check;
alter table public.events
  add constraint events_status_check
  check (status in ('scheduled', 'attended', 'completed', 'cancelled'));

alter table public.reminders
  add column if not exists sent_at timestamptz;
