create extension if not exists pgcrypto;

create table if not exists public.app_state (
  key text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_state (key, state)
values (
  'home_parking',
  jsonb_build_object(
    'settings', jsonb_build_object(
      'lotName', '何家月租停車場',
      'reminderDays', 30,
      'familyRentDefault', 0
    ),
    'tenants', '[]'::jsonb,
    'payments', '[]'::jsonb
  )
)
on conflict (key) do nothing;
