-- Create destinations table
create table if not exists public.destinations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.destinations enable row level security;

create policy "Destinations are readable by everyone"
  on public.destinations
  for select
  to public
  using (true);

create policy "Agencies can create destinations"
  on public.destinations
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.users
      where users.id = auth.uid()
      and users.role = 'agency'
    )
  );

-- Add tour_destinations junction table
create table if not exists public.tour_destinations (
  tour_id uuid references public.tours(id) on delete cascade,
  destination_id uuid references public.destinations(id) on delete cascade,
  primary key (tour_id, destination_id)
);

alter table public.tour_destinations enable row level security;

create policy "Tour destinations are readable by everyone"
  on public.tour_destinations
  for select
  to public
  using (true);

create policy "Agencies can manage tour destinations"
  on public.tour_destinations
  for all
  to authenticated
  using (
    exists (
      select 1 from public.tours
      inner join public.agencies on tours.agency_id = agencies.id
      where tour_destinations.tour_id = tours.id
      and agencies.user_id = auth.uid()
    )
  );

-- Add itinerary to tours table
alter table public.tours 
add column if not exists itinerary text;