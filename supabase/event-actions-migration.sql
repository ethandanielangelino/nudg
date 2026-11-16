-- Run in the Supabase SQL Editor after the Nudg base migrations.
-- Event state lets reminder links safely mark work complete or cancel it.

alter table public.events
  add column if not exists status text not null default 'scheduled';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'events_status_check') then
    alter table public.events add constraint events_status_check
      check (status in ('scheduled', 'attended', 'completed', 'cancelled'));
  end if;
end $$;

create index if not exists events_user_status_start_idx
  on public.events(user_id, status, start_time);

alter table public.reminders
  add column if not exists sent_at timestamptz;
