-- Migration 0001 — profiles
-- Per amended plan §"Data Model additions" + §"Decision Reversals R3" (5/week refill)

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- profiles: 1:1 with auth.users
create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text not null,
  name            text,
  avatar_url      text,
  credits_balance int  not null default 0 check (credits_balance >= 0),
  free_used_this_week  int not null default 0 check (free_used_this_week >= 0 and free_used_this_week <= 5),
  free_week_starts_at  timestamptz not null default date_trunc('week', now()),
  referral_code        text unique not null default encode(gen_random_bytes(6), 'hex'),
  referred_by          uuid references public.profiles(id) on delete set null,
  bonus_credits_earned int not null default 0 check (bonus_credits_earned >= 0 and bonus_credits_earned <= 50),
  push_subscription    jsonb,
  deleted_at           timestamptz,
  created_at           timestamptz not null default now()
);

create index profiles_referral_code_idx on public.profiles(referral_code);
create index profiles_referred_by_idx   on public.profiles(referred_by);
create index profiles_deleted_at_idx    on public.profiles(deleted_at) where deleted_at is null;

-- Auto-create profile on auth.users insert
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name'),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS
alter table public.profiles enable row level security;

-- Users can read their own row; hide soft-deleted
create policy "profiles_self_read" on public.profiles
  for select using (auth.uid() = id and deleted_at is null);

-- Users can update their own non-sensitive fields (block credit/quota manipulation)
create policy "profiles_self_update" on public.profiles
  for update using (auth.uid() = id and deleted_at is null)
  with check (
    auth.uid() = id
    and deleted_at is null
  );

-- Service role bypasses RLS for backend operations (credit grant, quota increment, etc.)
