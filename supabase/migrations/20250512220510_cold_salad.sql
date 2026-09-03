-- Users table to extend auth.users
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name text,
  role text not null check (role in ('traveler', 'agency', 'admin')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.users enable row level security;

create policy "Users can read own data"
  on public.users
  for select
  to authenticated
  using (auth.uid() = id);

create policy "Users can update own data"
  on public.users
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Agencies table
create table if not exists public.agencies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  description text,
  logo text,
  contact_email text not null,
  contact_phone text,
  website text,
  rating decimal(3,2) check (rating >= 0 and rating <= 5),
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.agencies enable row level security;

create policy "Agencies are readable by everyone"
  on public.agencies
  for select
  to public
  using (true);

create policy "Agencies can update own profile"
  on public.agencies
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Tours table
create table if not exists public.tours (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  name text not null,
  destination text not null,
  description text not null,
  category text not null,
  price decimal(10,2) not null check (price >= 0),
  deposit_percentage int not null check (deposit_percentage between 0 and 100),
  image_url text not null,
  gallery text[],
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  max_travelers int check (max_travelers > 0),
  is_featured boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.tours enable row level security;

create policy "Tours are readable by everyone"
  on public.tours
  for select
  to public
  using (true);

create policy "Agencies can manage own tours"
  on public.tours
  for all
  to authenticated
  using (
    exists (
      select 1 from public.agencies
      where agencies.id = tours.agency_id
      and agencies.user_id = auth.uid()
    )
  );

-- Bookings table
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  tour_id uuid not null references public.tours(id) on delete cascade,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  deposit_amount decimal(10,2) not null check (deposit_amount >= 0),
  commission_amount decimal(10,2) not null check (commission_amount >= 0),
  total_price decimal(10,2) not null check (total_price >= 0),
  status text not null check (status in ('pending', 'confirmed', 'completed', 'cancelled')),
  booking_date date not null,
  travelers_count int not null check (travelers_count > 0),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.bookings enable row level security;

create policy "Users can read own bookings"
  on public.bookings
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Agencies can read own tour bookings"
  on public.bookings
  for select
  to authenticated
  using (
    exists (
      select 1 from public.agencies
      where agencies.id = bookings.agency_id
      and agencies.user_id = auth.uid()
    )
  );

create policy "Users can create bookings"
  on public.bookings
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Reviews table
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  tour_id uuid not null references public.tours(id) on delete cascade,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  comment text not null,
  reply text,
  is_visible boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.reviews enable row level security;

create policy "Reviews are readable by everyone"
  on public.reviews
  for select
  to public
  using (is_visible = true);

create policy "Users can create reviews for booked tours"
  on public.reviews
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.bookings
      where bookings.tour_id = reviews.tour_id
      and bookings.user_id = auth.uid()
      and bookings.status = 'completed'
    )
  );

create policy "Users can update own reviews"
  on public.reviews
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Functions and Triggers
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger users_updated_at
  before update on public.users
  for each row
  execute function update_updated_at();

create trigger agencies_updated_at
  before update on public.agencies
  for each row
  execute function update_updated_at();

create trigger tours_updated_at
  before update on public.tours
  for each row
  execute function update_updated_at();

create trigger bookings_updated_at
  before update on public.bookings
  for each row
  execute function update_updated_at();

create trigger reviews_updated_at
  before update on public.reviews
  for each row
  execute function update_updated_at();
