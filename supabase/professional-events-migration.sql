-- Run once in Supabase SQL Editor after migration.sql and settings-migration.sql.
-- Adds professional event metadata and per-event reminder timing.

alter table public.events
  add column if not exists priority text not null default 'normal',
  add column if not exists category text not null default 'general',
  add column if not exists organization text,
  add column if not exists project text,
  add column if not exists reminder_lead_minutes integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'events_priority_check') then
    alter table public.events add constraint events_priority_check
      check (priority in ('low', 'normal', 'high', 'urgent'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_reminder_lead_minutes_check') then
    alter table public.events add constraint events_reminder_lead_minutes_check
      check (reminder_lead_minutes is null or reminder_lead_minutes between 0 and 10080);
  end if;
end $$;

create index if not exists events_user_priority_idx
  on public.events(user_id, priority);
create index if not exists events_user_category_idx
  on public.events(user_id, category);
