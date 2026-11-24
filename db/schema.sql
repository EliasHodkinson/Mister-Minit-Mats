-- Mister Minit Mat Builder – Neon (Postgres) schema. Safe to run more than once: node scripts/migrate.js

-- One row per signed-in customer (WorkOS user). Business details are filled in on first sign-in (onboarding)
-- and are what the Xero contact and every invoice use.
create table if not exists customers (
  id               text primary key,                -- WorkOS user id (user_…)
  email            text not null,
  first_name       text not null default '',
  last_name        text not null default '',
  legal_name       text not null default '',
  trading_name     text not null default '',
  abn              text not null default '',
  phone            text not null default '',
  billing          jsonb not null default '{}'::jsonb,   -- { street, suburb, state, postcode }
  delivery_same    boolean not null default true,
  delivery         jsonb not null default '{}'::jsonb,
  xero_contact_id  text,
  xero_error       text,
  onboarded_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists customers_email_idx on customers (lower(email));

-- A mat design. Drafts are edited in the builder; once ordered, the design is locked and becomes
-- something the customer can reorder (changes are then priced against it, not the template).
create table if not exists designs (
  id               uuid primary key default gen_random_uuid(),
  customer_id      text not null references customers(id) on delete cascade,
  name             text not null default '',
  status           text not null default 'draft',       -- draft | ordered
  state            jsonb not null,                      -- { stores, sections, notes, ui }
  base_design_id   uuid references designs(id) on delete set null,   -- the ordered design a reorder started from
  base_sections    jsonb,                               -- that design's sections at the time (null = the template)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists designs_customer_idx on designs (customer_id, updated_at desc);

create sequence if not exists order_number_seq start 1001;

create table if not exists orders (
  id               uuid primary key default gen_random_uuid(),
  number           text not null unique default ('MM-' || nextval('order_number_seq')),
  customer_id      text not null references customers(id) on delete cascade,
  design_id        uuid references designs(id) on delete set null,
  status           text not null default 'requested',
  snapshot         jsonb not null,                      -- the brief as submitted: stores, sections (with status), changes, notes
  customer         jsonb not null,                      -- business details at the time of ordering
  change_count     integer not null default 0,
  is_reorder       boolean not null default false,
  quote            jsonb not null,                      -- priced lines, totals
  total            numeric(10,2) not null default 0,
  xero_kind        text,
  xero_id          text,
  xero_number      text,
  pay_url          text,
  due_date         date,
  xero_error       text,
  history          jsonb not null default '[]'::jsonb,  -- [{ status, at, by, note }]
  admin_note       text not null default '',
  tracking         text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists orders_customer_idx on orders (customer_id, created_at desc);
create index if not exists orders_status_idx on orders (status, created_at desc);

alter table orders add column if not exists email_error text;
