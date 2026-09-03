-- ============================================================
--  Centrala — schema captured from the live Supabase project
--  (project ref inbxjztezjfrbnidzofy) on 2026-09-02.
--
--  Read out of the catalogue in the Supabase SQL Editor, because no machine
--  with the Supabase CLI was to hand. A very good backup, but NOT a byte-exact
--  dump.
--
--  KNOWN TO BE MISSING — capture these with `supabase db pull` when you can:
--    * triggers
--    * sequences and identity columns
--    * grants, roles and ownership
--    * view options, notably `security_invoker` on article_stock and on the
--      team_members / entry_authors views (see README.md — this one matters)
--    * anything outside the `public` schema (auth, storage, cron, extensions)
--    * extension installs; the push schedule needs pg_cron and pg_net, and
--      the stays exclusion constraint below needs btree_gist
--
--  Replay order is tables, constraints, indexes, views, functions, then RLS
--  and policies, so it runs top to bottom into an empty project.
-- ============================================================


-- ============================================================
--  TABLES (37)
-- ============================================================

create table accounts (
  id uuid not null default gen_random_uuid(),
  name text not null,
  opening_balance numeric not null default 0,
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamp with time zone default now(),
  payout_delay_days integer not null default 0
);

create table apartments (
  id uuid not null default gen_random_uuid(),
  name text not null,
  address text,
  size_m2 numeric,
  notes text,
  active boolean default true,
  created_at timestamp with time zone default now(),
  opening_balance numeric not null default 0,
  nightly_rate numeric,
  checkout_time time without time zone,
  feed_token text,
  keybox_code text,
  alarm_code text,
  wifi_name text,
  wifi_pass text,
  access_note text,
  cleaning_cost numeric not null default 0
);

create table app_settings (
  key text not null,
  value jsonb not null
);

create table apt_expenses (
  id uuid not null default gen_random_uuid(),
  apartment_id uuid,
  spent_on date not null default CURRENT_DATE,
  category text not null default 'other'::text,
  description text not null,
  amount numeric not null default 0,
  account_id uuid,
  note text,
  created_at timestamp with time zone default now(),
  created_by uuid default auth.uid()
);

create table article_images (
  article_id uuid not null,
  data text not null
);

create table article_prices (
  id uuid not null default gen_random_uuid(),
  article_id uuid not null,
  price numeric not null,
  qty numeric,
  supplier text,
  doc_no text,
  purchase_id uuid,
  bought_on date not null default CURRENT_DATE,
  created_at timestamp with time zone default now()
);

create table articles (
  id uuid not null default gen_random_uuid(),
  code text,
  name text not null,
  category text not null default 'CCTV'::text,
  unit text not null default 'ком'::text,
  min_stock numeric default 0,
  purchase_price numeric default 0,
  sell_price numeric default 0,
  supplier text,
  specs text,
  active boolean default true,
  low_alerted_on date,
  created_at timestamp with time zone default now(),
  image_thumb text,
  vat_rate numeric not null default 18,
  supplier_code text
);

create table bills (
  id uuid not null default gen_random_uuid(),
  apartment_id uuid not null,
  month date not null,
  type text not null,
  amount numeric not null default 0,
  paid boolean not null default false,
  paid_on date,
  created_at timestamp with time zone default now(),
  created_by uuid default auth.uid(),
  account_id uuid
);

create table clients (
  id uuid not null default gen_random_uuid(),
  name text not null,
  contact text,
  note text,
  created_at timestamp with time zone default now(),
  phone text,
  email text,
  address text,
  active boolean not null default true
);

create table document_files (
  document_id uuid not null,
  data text not null,
  created_at timestamp with time zone default now()
);

create table documents (
  id uuid not null default gen_random_uuid(),
  kind text not null default 'испратница'::text,
  doc_no text,
  doc_date date not null default CURRENT_DATE,
  direction text not null default 'out'::text,
  client_id uuid,
  supplier text,
  offer_id uuid,
  amount numeric not null default 0,
  note text,
  file_thumb text,
  file_type text,
  created_at timestamp with time zone default now(),
  created_by uuid default auth.uid()
);

create table elaks_cash (
  id uuid not null default gen_random_uuid(),
  amount numeric not null,
  note text,
  movement_id uuid,
  created_at timestamp with time zone default now(),
  offer_id uuid,
  payment_id uuid,
  purchase_id uuid,
  created_by uuid default auth.uid()
);

create table ical_feeds (
  id uuid not null default gen_random_uuid(),
  apartment_id uuid not null,
  source text not null default 'Booking.com'::text,
  url text not null,
  active boolean not null default true,
  last_sync timestamp with time zone,
  last_status text,
  created_at timestamp with time zone default now()
);

create table installations (
  id uuid not null default gen_random_uuid(),
  client_id uuid,
  article_id uuid,
  offer_id uuid,
  name text not null,
  serial text,
  location text,
  installed_on date not null default CURRENT_DATE,
  warranty_months integer not null default 24,
  notes text,
  created_at timestamp with time zone default now(),
  created_by uuid default auth.uid(),
  warranty_until date default ((installed_on + make_interval(months => warranty_months)))::date,
  site_id uuid
);

create table invoices (
  id uuid not null default gen_random_uuid(),
  number text not null,
  invoice_date date not null default CURRENT_DATE,
  due_date date,
  client_id uuid,
  offer_id uuid,
  job_id uuid,
  items jsonb not null default '[]'::jsonb,
  total numeric not null default 0,
  net numeric not null default 0,
  vat numeric not null default 0,
  paid_on date,
  paid_method text,
  note text,
  cancelled boolean not null default false,
  created_at timestamp with time zone default now(),
  created_by uuid default auth.uid()
);

create table job_photos (
  id uuid not null default gen_random_uuid(),
  job_id uuid not null,
  data text not null,
  thumb text,
  sort integer not null default 0,
  created_at timestamp with time zone default now()
);

create table jobs (
  id uuid not null default gen_random_uuid(),
  title text not null,
  offer_id uuid,
  client_id uuid,
  site_id uuid,
  address text,
  scheduled_on date,
  scheduled_time time without time zone,
  assigned_to uuid,
  status text not null default 'scheduled'::text,
  started_at timestamp with time zone,
  done_at timestamp with time zone,
  note text,
  created_at timestamp with time zone default now(),
  created_by uuid default auth.uid()
);

create table movements (
  id uuid not null default gen_random_uuid(),
  article_id uuid not null,
  type text not null,
  qty numeric not null,
  note text,
  ref text,
  created_at timestamp with time zone default now(),
  created_by uuid default auth.uid()
);

create table offer_payments (
  id uuid not null default gen_random_uuid(),
  offer_id uuid not null,
  amount numeric not null,
  method text not null default 'cash'::text,
  paid_on date not null default CURRENT_DATE,
  note text,
  created_at timestamp with time zone default now()
);

create table offers (
  id uuid not null default gen_random_uuid(),
  number text not null,
  title text not null,
  system text,
  client_id uuid,
  offer_date date default CURRENT_DATE,
  validity integer default 7,
  status text not null default 'draft'::text,
  items jsonb not null default '[]'::jsonb,
  total_note text,
  grand_total numeric default 0,
  stock_deducted boolean default false,
  created_at timestamp with time zone default now(),
  followup_sent date,
  paid_at date,
  paid_method text,
  paid_amount numeric,
  created_by uuid default auth.uid()
);

create table policies (
  id uuid not null default gen_random_uuid(),
  holder_name text not null,
  policy_no text,
  kind text,
  insurer text,
  client_id uuid,
  phone text,
  start_date date not null default CURRENT_DATE,
  end_date date,
  amount numeric not null default 0,
  note text,
  active boolean not null default true,
  created_at timestamp with time zone default now(),
  created_by uuid default auth.uid(),
  reminded_days integer[] not null default '{}'::integer[],
  photo_thumb text,
  commission numeric not null default 0,
  has_green_card boolean not null default false,
  green_card_no text,
  green_card_end date,
  gc_reminded_days integer[] not null default '{}'::integer[],
  renewed_from uuid,
  green_card_price numeric not null default 0,
  remit_statement_id uuid,
  comm_statement_id uuid,
  gc_commission numeric not null default 0,
  plate text
);

create table policy_payments (
  id uuid not null default gen_random_uuid(),
  policy_id uuid not null,
  amount numeric not null,
  method text not null default 'cash'::text,
  paid_on date not null default CURRENT_DATE,
  note text,
  created_at timestamp with time zone default now(),
  created_by uuid default auth.uid()
);

create table policy_photos (
  policy_id uuid not null,
  data text not null,
  created_at timestamp with time zone default now(),
  id uuid not null default gen_random_uuid(),
  thumb text,
  sort integer not null default 0
);

create table purchases (
  id uuid not null default gen_random_uuid(),
  supplier text not null,
  doc_no text,
  doc_date date not null default CURRENT_DATE,
  due_date date,
  items jsonb not null default '[]'::jsonb,
  total numeric not null default 0,
  note text,
  received_at date,
  paid_at date,
  paid_method text,
  paid_amount numeric,
  created_at timestamp with time zone default now(),
  expected_date date,
  created_by uuid default auth.uid()
);

create table push_subscriptions (
  id uuid not null default gen_random_uuid(),
  endpoint text not null,
  sub jsonb not null,
  created_at timestamp with time zone default now(),
  user_id uuid
);

create table secrets (
  name text not null,
  value text not null,
  updated_at timestamp with time zone default now()
);

create table sites (
  id uuid not null default gen_random_uuid(),
  client_id uuid,
  name text not null,
  address text,
  recorder text,
  channels integer,
  camera_count integer,
  hdd_tb numeric,
  hdd_installed_on date,
  access_user text,
  access_pass text,
  remote_app text,
  remote_id text,
  network_note text,
  note text,
  active boolean not null default true,
  created_at timestamp with time zone default now(),
  created_by uuid default auth.uid()
);

create table statement_items (
  id uuid not null default gen_random_uuid(),
  statement_id uuid not null,
  policy_id uuid not null,
  amount numeric not null default 0,
  created_at timestamp with time zone default now()
);

create table statements (
  id uuid not null default gen_random_uuid(),
  insurer text not null,
  kind text not null,
  period text not null,
  amount numeric not null default 0,
  due_date date,
  paid_on date,
  method text,
  note text,
  created_at timestamp with time zone default now(),
  created_by uuid default auth.uid()
);

create table stay_payments (
  id uuid not null default gen_random_uuid(),
  stay_id uuid not null,
  amount numeric not null,
  method text not null default 'cash'::text,
  account_id uuid,
  paid_on date not null default CURRENT_DATE,
  note text,
  created_at timestamp with time zone default now(),
  created_by uuid default auth.uid()
);

create table stays (
  id uuid not null default gen_random_uuid(),
  apartment_id uuid not null,
  guest_name text not null,
  check_in date not null,
  check_out date not null,
  amount numeric not null default 0,
  notes text,
  created_at timestamp with time zone default now(),
  source text,
  external_uid text,
  feed_id uuid,
  created_by uuid default auth.uid(),
  account_id uuid,
  arrived_at timestamp with time zone,
  commission numeric not null default 0,
  cleaning_cost numeric not null default 0
);

create table suppliers (
  id uuid not null default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  address text,
  note text,
  active boolean not null default true,
  created_at timestamp with time zone default now(),
  created_by uuid default auth.uid()
);

create table task_completions (
  id uuid not null default gen_random_uuid(),
  task_id uuid not null,
  done_on date not null,
  done_by uuid,
  created_at timestamp with time zone default now(),
  skipped boolean not null default false
);

create table task_photos (
  task_id uuid not null,
  data text not null
);

create table task_templates (
  id uuid not null default gen_random_uuid(),
  name text not null,
  context text not null default 'work'::text,
  checklist jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamp with time zone default now()
);

create table tasks (
  id uuid not null default gen_random_uuid(),
  title text not null,
  context text not null,
  due_date date,
  due_time time without time zone,
  recurrence text,
  recur_dow integer,
  recur_dom integer,
  remind boolean default false,
  reminded_on date,
  done boolean default false,
  last_done date,
  notes text,
  created_at timestamp with time zone default now(),
  checklist jsonb,
  assigned_to uuid,
  recur_days integer[],
  recur_every integer not null default 1,
  recur_from date,
  recur_until date,
  priority boolean not null default false,
  client_id uuid,
  apartment_id uuid,
  offer_id uuid,
  photo_thumb text,
  stay_id uuid,
  owner_uid uuid default auth.uid(),
  created_by uuid default auth.uid(),
  assigned_notified_to uuid
);

create table user_roles (
  user_id uuid not null,
  role text not null,
  display_name text,
  task_contexts text[] not null default '{}'::text[],
  see_elaks boolean not null default false,
  see_apts boolean not null default false,
  see_insurance boolean not null default false,
  hide_tabs text[] not null default '{}'::text[],
  personal_access uuid[] not null default '{}'::uuid[]
);


-- ============================================================
--  KEYS, FOREIGN KEYS, UNIQUE, CHECK AND EXCLUSION CONSTRAINTS (106)
-- ============================================================

alter table accounts add constraint accounts_pkey PRIMARY KEY (id);

alter table apartments add constraint apartments_pkey PRIMARY KEY (id);

alter table app_settings add constraint app_settings_pkey PRIMARY KEY (key);

alter table apt_expenses add constraint apt_expenses_apartment_id_fkey FOREIGN KEY (apartment_id) REFERENCES apartments(id) ON DELETE CASCADE;

alter table apt_expenses add constraint apt_expenses_pkey PRIMARY KEY (id);

alter table apt_expenses add constraint apt_expenses_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;

alter table article_images add constraint article_images_pkey PRIMARY KEY (article_id);

alter table article_images add constraint article_images_article_id_fkey FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE;

alter table article_prices add constraint article_prices_article_id_fkey FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE;

alter table article_prices add constraint article_prices_pkey PRIMARY KEY (id);

alter table article_prices add constraint article_prices_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE SET NULL;

alter table articles add constraint articles_unit_check CHECK ((unit = ANY (ARRAY['ком'::text, 'm'::text])));

alter table articles add constraint articles_pkey PRIMARY KEY (id);

alter table bills add constraint bills_type_check CHECK ((type = ANY (ARRAY['electricity'::text, 'water'::text, 'internet'::text, 'building'::text, 'heating'::text, 'booking'::text])));

alter table bills add constraint bills_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;

alter table bills add constraint bills_pkey PRIMARY KEY (id);

alter table bills add constraint bills_apartment_id_month_type_key UNIQUE (apartment_id, month, type);

alter table bills add constraint bills_apartment_id_fkey FOREIGN KEY (apartment_id) REFERENCES apartments(id) ON DELETE CASCADE;

alter table clients add constraint clients_pkey PRIMARY KEY (id);

alter table document_files add constraint document_files_pkey PRIMARY KEY (document_id);

alter table document_files add constraint document_files_document_id_fkey FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE;

alter table documents add constraint documents_pkey PRIMARY KEY (id);

alter table documents add constraint documents_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE SET NULL;

alter table documents add constraint documents_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;

alter table elaks_cash add constraint elaks_cash_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE SET NULL;

alter table elaks_cash add constraint elaks_cash_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES offer_payments(id) ON DELETE SET NULL;

alter table elaks_cash add constraint elaks_cash_pkey PRIMARY KEY (id);

alter table elaks_cash add constraint elaks_cash_movement_id_fkey FOREIGN KEY (movement_id) REFERENCES movements(id) ON DELETE SET NULL;

alter table elaks_cash add constraint elaks_cash_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE SET NULL;

alter table ical_feeds add constraint ical_feeds_apartment_id_fkey FOREIGN KEY (apartment_id) REFERENCES apartments(id) ON DELETE CASCADE;

alter table ical_feeds add constraint ical_feeds_pkey PRIMARY KEY (id);

alter table installations add constraint installations_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE SET NULL;

alter table installations add constraint installations_pkey PRIMARY KEY (id);

alter table installations add constraint installations_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE SET NULL;

alter table installations add constraint installations_article_id_fkey FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE SET NULL;

alter table installations add constraint installations_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;

alter table invoices add constraint invoices_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;

alter table invoices add constraint invoices_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL;

alter table invoices add constraint invoices_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE SET NULL;

alter table invoices add constraint invoices_pkey PRIMARY KEY (id);

alter table job_photos add constraint job_photos_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;

alter table job_photos add constraint job_photos_pkey PRIMARY KEY (id);

alter table jobs add constraint jobs_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;

alter table jobs add constraint jobs_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE SET NULL;

alter table jobs add constraint jobs_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE SET NULL;

alter table jobs add constraint jobs_pkey PRIMARY KEY (id);

alter table movements add constraint movements_pkey PRIMARY KEY (id);

alter table movements add constraint movements_type_check CHECK ((type = ANY (ARRAY['in'::text, 'out'::text, 'corr'::text])));

alter table movements add constraint movements_article_id_fkey FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE;

alter table offer_payments add constraint offer_payments_amount_check CHECK ((amount <> (0)::numeric));

alter table offer_payments add constraint offer_payments_pkey PRIMARY KEY (id);

alter table offer_payments add constraint offer_payments_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE;

alter table offers add constraint offers_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id);

alter table offers add constraint offers_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'accepted'::text, 'rejected'::text])));

alter table offers add constraint offers_pkey PRIMARY KEY (id);

alter table policies add constraint policies_pkey PRIMARY KEY (id);

alter table policies add constraint policies_comm_statement_id_fkey FOREIGN KEY (comm_statement_id) REFERENCES statements(id) ON DELETE SET NULL;

alter table policies add constraint policies_remit_statement_id_fkey FOREIGN KEY (remit_statement_id) REFERENCES statements(id) ON DELETE SET NULL;

alter table policies add constraint policies_renewed_from_fkey FOREIGN KEY (renewed_from) REFERENCES policies(id) ON DELETE SET NULL;

alter table policies add constraint policies_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;

alter table policy_payments add constraint policy_payments_amount_check CHECK ((amount <> (0)::numeric));

alter table policy_payments add constraint policy_payments_pkey PRIMARY KEY (id);

alter table policy_payments add constraint policy_payments_policy_id_fkey FOREIGN KEY (policy_id) REFERENCES policies(id) ON DELETE CASCADE;

alter table policy_photos add constraint policy_photos_pkey PRIMARY KEY (id);

alter table policy_photos add constraint policy_photos_policy_id_fkey FOREIGN KEY (policy_id) REFERENCES policies(id) ON DELETE CASCADE;

alter table purchases add constraint purchases_pkey PRIMARY KEY (id);

alter table push_subscriptions add constraint push_subscriptions_endpoint_key UNIQUE (endpoint);

alter table push_subscriptions add constraint push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table push_subscriptions add constraint push_subscriptions_pkey PRIMARY KEY (id);

alter table secrets add constraint secrets_pkey PRIMARY KEY (name);

alter table sites add constraint sites_pkey PRIMARY KEY (id);

alter table sites add constraint sites_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;

alter table statement_items add constraint statement_items_statement_id_policy_id_key UNIQUE (statement_id, policy_id);

alter table statement_items add constraint statement_items_policy_id_fkey FOREIGN KEY (policy_id) REFERENCES policies(id) ON DELETE CASCADE;

alter table statement_items add constraint statement_items_pkey PRIMARY KEY (id);

alter table statement_items add constraint statement_items_statement_id_fkey FOREIGN KEY (statement_id) REFERENCES statements(id) ON DELETE CASCADE;

alter table statements add constraint statements_pkey PRIMARY KEY (id);

alter table statements add constraint statements_kind_check CHECK ((kind = ANY (ARRAY['remittance'::text, 'commission'::text])));

alter table stay_payments add constraint stay_payments_pkey PRIMARY KEY (id);

alter table stay_payments add constraint stay_payments_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;

alter table stay_payments add constraint stay_payments_amount_check CHECK ((amount <> (0)::numeric));

alter table stay_payments add constraint stay_payments_stay_id_fkey FOREIGN KEY (stay_id) REFERENCES stays(id) ON DELETE CASCADE;

alter table stays add constraint stays_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;

alter table stays add constraint stays_pkey PRIMARY KEY (id);

alter table stays add constraint stays_apartment_id_fkey FOREIGN KEY (apartment_id) REFERENCES apartments(id) ON DELETE CASCADE;

alter table stays add constraint stays_no_overlap EXCLUDE USING gist (apartment_id WITH =, daterange(check_in, check_out, '[)'::text) WITH &&);

alter table stays add constraint stays_feed_id_fkey FOREIGN KEY (feed_id) REFERENCES ical_feeds(id) ON DELETE SET NULL;

alter table suppliers add constraint suppliers_pkey PRIMARY KEY (id);

alter table task_completions add constraint task_completions_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;

alter table task_completions add constraint task_completions_done_by_fkey FOREIGN KEY (done_by) REFERENCES auth.users(id);

alter table task_completions add constraint task_completions_task_id_done_on_key UNIQUE (task_id, done_on);

alter table task_completions add constraint task_completions_pkey PRIMARY KEY (id);

alter table task_photos add constraint task_photos_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;

alter table task_photos add constraint task_photos_pkey PRIMARY KEY (task_id);

alter table task_templates add constraint task_templates_pkey PRIMARY KEY (id);

alter table tasks add constraint tasks_pkey PRIMARY KEY (id);

alter table tasks add constraint tasks_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;

alter table tasks add constraint tasks_context_check CHECK ((context = ANY (ARRAY['work'::text, 'elaks'::text, 'personal'::text, 'apts'::text])));

alter table tasks add constraint tasks_recurrence_check CHECK ((recurrence = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text])));

alter table tasks add constraint tasks_stay_id_fkey FOREIGN KEY (stay_id) REFERENCES stays(id) ON DELETE CASCADE;

alter table tasks add constraint tasks_apartment_id_fkey FOREIGN KEY (apartment_id) REFERENCES apartments(id) ON DELETE SET NULL;

alter table tasks add constraint tasks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id);

alter table tasks add constraint tasks_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE SET NULL;

alter table user_roles add constraint user_roles_pkey PRIMARY KEY (user_id);

alter table user_roles add constraint user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table user_roles add constraint user_roles_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'employee'::text, 'assistant'::text])));


-- ============================================================
--  INDEXES (the ones no constraint already builds) (46)
-- ============================================================

CREATE UNIQUE INDEX apartments_feed_token_idx ON public.apartments USING btree (feed_token);

CREATE INDEX apt_expenses_apt_idx ON public.apt_expenses USING btree (apartment_id, spent_on DESC);

CREATE INDEX article_prices_article_idx ON public.article_prices USING btree (article_id, bought_on DESC);

CREATE INDEX articles_supplier_code_idx ON public.articles USING btree (supplier_code);

CREATE INDEX clients_active_idx ON public.clients USING btree (active);

CREATE INDEX documents_no_idx ON public.documents USING btree (lower(doc_no));

CREATE INDEX documents_date_idx ON public.documents USING btree (doc_date DESC);

CREATE INDEX documents_client_idx ON public.documents USING btree (client_id);

CREATE INDEX ical_feeds_apt_idx ON public.ical_feeds USING btree (apartment_id);

CREATE INDEX installations_client_idx ON public.installations USING btree (client_id);

CREATE INDEX installations_warranty_idx ON public.installations USING btree (warranty_until);

CREATE INDEX installations_serial_idx ON public.installations USING btree (serial);

CREATE INDEX installations_site_idx ON public.installations USING btree (site_id);

CREATE INDEX invoices_client_idx ON public.invoices USING btree (client_id);

CREATE INDEX invoices_date_idx ON public.invoices USING btree (invoice_date DESC);

CREATE UNIQUE INDEX invoices_number_idx ON public.invoices USING btree (number) WHERE (cancelled = false);

CREATE INDEX job_photos_job_idx ON public.job_photos USING btree (job_id, sort);

CREATE INDEX jobs_when_idx ON public.jobs USING btree (scheduled_on);

CREATE INDEX jobs_status_idx ON public.jobs USING btree (status);

CREATE INDEX jobs_offer_idx ON public.jobs USING btree (offer_id);

CREATE INDEX offer_payments_offer_idx ON public.offer_payments USING btree (offer_id);

CREATE INDEX offer_payments_date_idx ON public.offer_payments USING btree (paid_on);

CREATE UNIQUE INDEX offers_number_key ON public.offers USING btree (number);

CREATE INDEX policies_remit_idx ON public.policies USING btree (remit_statement_id);

CREATE INDEX policies_renewed_idx ON public.policies USING btree (renewed_from);

CREATE INDEX policies_plate_idx ON public.policies USING btree (upper(plate));

CREATE INDEX policies_holder_idx ON public.policies USING btree (lower(holder_name));

CREATE INDEX policies_end_idx ON public.policies USING btree (end_date);

CREATE INDEX policies_comm_idx ON public.policies USING btree (comm_statement_id);

CREATE INDEX policy_payments_policy_idx ON public.policy_payments USING btree (policy_id);

CREATE INDEX policy_photos_policy_idx ON public.policy_photos USING btree (policy_id, sort);

CREATE INDEX purchases_date_idx ON public.purchases USING btree (doc_date);

CREATE INDEX purchases_due_idx ON public.purchases USING btree (due_date);

CREATE INDEX sites_client_idx ON public.sites USING btree (client_id);

CREATE INDEX statement_items_stmt_idx ON public.statement_items USING btree (statement_id);

CREATE INDEX statement_items_policy_idx ON public.statement_items USING btree (policy_id);

CREATE INDEX statements_insurer_idx ON public.statements USING btree (insurer, period);

CREATE INDEX stay_payments_stay_idx ON public.stay_payments USING btree (stay_id);

CREATE INDEX stay_payments_date_idx ON public.stay_payments USING btree (paid_on DESC);

CREATE UNIQUE INDEX stays_external_uid_idx ON public.stays USING btree (external_uid) WHERE (external_uid IS NOT NULL);

CREATE UNIQUE INDEX suppliers_name_idx ON public.suppliers USING btree (lower(name));

CREATE INDEX task_completions_date_idx ON public.task_completions USING btree (done_on);

CREATE INDEX task_completions_task_idx ON public.task_completions USING btree (task_id);

CREATE INDEX tasks_stay_idx ON public.tasks USING btree (stay_id);

CREATE INDEX tasks_assigned_idx ON public.tasks USING btree (assigned_to) WHERE (done = false);

CREATE INDEX tasks_owner_idx ON public.tasks USING btree (owner_uid) WHERE (context = 'personal'::text);


-- ============================================================
--  VIEWS (5)
-- ============================================================

create view apt_cash_total as  SELECT (((COALESCE(( SELECT sum(p.amount) AS sum
           FROM stay_payments p), (0)::numeric) + COALESCE(( SELECT sum(a.opening_balance) AS sum
           FROM apartments a
          WHERE a.active), (0)::numeric)) - COALESCE(( SELECT sum(b.amount) AS sum
           FROM bills b
          WHERE b.paid), (0)::numeric)) - COALESCE(( SELECT sum(e.amount) AS sum
           FROM apt_expenses e), (0)::numeric)) AS balance;

create view article_stock as  SELECT a.id,
    a.code,
    a.name,
    a.category,
    a.unit,
    a.min_stock,
    a.purchase_price,
    a.sell_price,
    a.supplier,
    a.specs,
    a.active,
    a.low_alerted_on,
    a.created_at,
    a.image_thumb,
    a.vat_rate,
    COALESCE(sum(
        CASE m.type
            WHEN 'in'::text THEN m.qty
            WHEN 'out'::text THEN (- m.qty)
            ELSE m.qty
        END), (0)::numeric) AS stock
   FROM (articles a
     LEFT JOIN movements m ON ((m.article_id = a.id)))
  GROUP BY a.id;

create view elaks_cash_total as  SELECT COALESCE(sum(amount), (0)::numeric) AS balance
   FROM elaks_cash;

create view entry_authors as  SELECT user_id,
    display_name
   FROM user_roles;

create view team_members as  SELECT user_id,
    display_name,
    role
   FROM user_roles;


-- ============================================================
--  FUNCTIONS (11)
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_apts()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select coalesce((select see_apts from user_roles where user_id = auth.uid()), false) $function$
;

CREATE OR REPLACE FUNCTION public.can_elaks()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select coalesce((select see_elaks from user_roles where user_id = auth.uid()), false) $function$
;

CREATE OR REPLACE FUNCTION public.can_insurance()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select role = 'owner' or see_insurance
                     from user_roles where user_id = auth.uid()), false);
                     $function$
;

CREATE OR REPLACE FUNCTION public.clear_secret(p_name text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
                        begin
                          if coalesce(my_role(), 'none') <> 'owner' then
                              raise exception 'Not allowed — your role is %', coalesce(my_role(), 'not signed in');
                                end if;
                                  delete from secrets where name = p_name;
                                    insert into app_settings (key, value) values ('ai_key_set', '"no"')
                                      on conflict (key) do update set value = '"no"';
                                        return 'removed';
                                        end $function$
;

CREATE OR REPLACE FUNCTION public.merge_articles(p_from uuid, p_to uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
                        declare
                          moved int;
                            newest numeric;
                            begin
                              if coalesce(my_role(), 'none') <> 'owner' and not can_elaks() then
                                  raise exception 'Not allowed';
                                    end if;
                                      if p_from = p_to then raise exception 'Those are the same article'; end if;
                                        if not exists (select 1 from articles where id = p_from) then raise exception 'Article not found'; end if;
                                          if not exists (select 1 from articles where id = p_to)   then raise exception 'Target article not found'; end if;

                                            -- stock movements carry over, so the quantity is the sum of both
                                              update movements set article_id = p_to where article_id = p_from;
                                                get diagnostics moved = row_count;

                                                  -- so does the price history
                                                    update article_prices set article_id = p_to where article_id = p_from;

                                                      -- the surviving article keeps the most recent purchase price
                                                        select price into newest from article_prices
                                                           where article_id = p_to order by bought_on desc, created_at desc limit 1;
                                                             if newest is not null then
                                                                 update articles set purchase_price = newest where id = p_to;
                                                                   end if;

                                                                     -- give the survivor a photo and a supplier code if it has none
                                                                       insert into article_images (article_id, data)
                                                                         select p_to, data from article_images where article_id = p_from
                                                                           on conflict (article_id) do nothing;
                                                                             delete from article_images where article_id = p_from;

                                                                               update articles t set
                                                                                   supplier_code = coalesce(t.supplier_code, f.supplier_code),
                                                                                       image_thumb   = coalesce(t.image_thumb, f.image_thumb),
                                                                                           specs         = coalesce(nullif(t.specs, ''), f.specs),
                                                                                               code          = coalesce(nullif(t.code, ''), f.code)
                                                                                                 from articles f where t.id = p_to and f.id = p_from;

                                                                                                   -- the duplicate is retired rather than deleted, so old offers that
                                                                                                     -- point at it keep making sense
                                                                                                       update articles set active = false, min_stock = 0,
                                                                                                                name = left(name, 90) || ' [merged]'
                                                                                                                   where id = p_from;

                                                                                                                     return moved::text;
                                                                                                                     end $function$
;

CREATE OR REPLACE FUNCTION public.merge_suppliers(p_from uuid, p_to uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  from_name text; to_name text; moved int; total int := 0;
begin
  if coalesce(my_role(), 'none') <> 'owner' and not can_elaks() then
    raise exception 'Not allowed';
  end if;
  if p_from = p_to then raise exception 'Those are the same supplier'; end if;
  select name into from_name from suppliers where id = p_from;
  select name into to_name   from suppliers where id = p_to;
  if from_name is null or to_name is null then raise exception 'Supplier not found'; end if;

  update articles set supplier = to_name where supplier = from_name;
  get diagnostics moved = row_count; total := total + moved;

  update purchases set supplier = to_name where supplier = from_name;
  get diagnostics moved = row_count; total := total + moved;

  if to_regclass('public.article_prices') is not null then
    update article_prices set supplier = to_name where supplier = from_name;
    get diagnostics moved = row_count; total := total + moved;
  end if;

  -- keep any contact detail the survivor is missing
  update suppliers t set
    phone   = coalesce(nullif(t.phone, ''),   f.phone),
    email   = coalesce(nullif(t.email, ''),   f.email),
    address = coalesce(nullif(t.address, ''), f.address),
    note    = coalesce(nullif(t.note, ''),    f.note)
  from suppliers f where t.id = p_to and f.id = p_from;

  delete from suppliers where id = p_from;
  return total::text;
end $function$
;

CREATE OR REPLACE FUNCTION public.my_personal_access()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select personal_access from user_roles where user_id = auth.uid()), '{}'::uuid[]);
$function$
;

CREATE OR REPLACE FUNCTION public.my_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select coalesce((select role from user_roles where user_id = auth.uid()), 'employee') $function$
;

CREATE OR REPLACE FUNCTION public.my_task_ctx()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select coalesce((select task_contexts from user_roles where user_id = auth.uid()), '{}') $function$
;

CREATE OR REPLACE FUNCTION public.rename_supplier(p_id uuid, p_name text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare old_name text;
begin
  if coalesce(my_role(), 'none') <> 'owner' and not can_elaks() then
    raise exception 'Not allowed';
  end if;
  select name into old_name from suppliers where id = p_id;
  if old_name is null then raise exception 'Supplier not found'; end if;
  if trim(p_name) = '' then raise exception 'A supplier needs a name'; end if;

  update suppliers set name = trim(p_name) where id = p_id;
  update articles  set supplier = trim(p_name) where supplier = old_name;
  update purchases set supplier = trim(p_name) where supplier = old_name;
  if to_regclass('public.article_prices') is not null then
    update article_prices set supplier = trim(p_name) where supplier = old_name;
  end if;
  return 'renamed';
end $function$
;

CREATE OR REPLACE FUNCTION public.set_secret(p_name text, p_value text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
      begin
        if coalesce(my_role(), 'none') <> 'owner' then
            raise exception 'Not allowed — your role is %', coalesce(my_role(), 'not signed in');
              end if;
                insert into secrets (name, value, updated_at) values (p_name, p_value, now())
                  on conflict (name) do update set value = excluded.value, updated_at = now();
                    insert into app_settings (key, value) values ('ai_key_set', '"yes"')
                      on conflict (key) do update set value = '"yes"';
                        return 'saved';
                        end $function$
;


-- ============================================================
--  ROW LEVEL SECURITY (37)
-- ============================================================

alter table accounts enable row level security;

alter table apartments enable row level security;

alter table app_settings enable row level security;

alter table apt_expenses enable row level security;

alter table article_images enable row level security;

alter table article_prices enable row level security;

alter table articles enable row level security;

alter table bills enable row level security;

alter table clients enable row level security;

alter table document_files enable row level security;

alter table documents enable row level security;

alter table elaks_cash enable row level security;

alter table ical_feeds enable row level security;

alter table installations enable row level security;

alter table invoices enable row level security;

alter table job_photos enable row level security;

alter table jobs enable row level security;

alter table movements enable row level security;

alter table offer_payments enable row level security;

alter table offers enable row level security;

alter table policies enable row level security;

alter table policy_payments enable row level security;

alter table policy_photos enable row level security;

alter table purchases enable row level security;

alter table push_subscriptions enable row level security;

alter table secrets enable row level security;

alter table sites enable row level security;

alter table statement_items enable row level security;

alter table statements enable row level security;

alter table stay_payments enable row level security;

alter table stays enable row level security;

alter table suppliers enable row level security;

alter table task_completions enable row level security;

alter table task_photos enable row level security;

alter table task_templates enable row level security;

alter table tasks enable row level security;

alter table user_roles enable row level security;


-- ============================================================
--  POLICIES (39)
-- ============================================================

create policy "accounts by perm" on accounts as PERMISSIVE for ALL to authenticated using (((my_role() = 'owner'::text) OR can_apts() OR can_elaks())) with check (((my_role() = 'owner'::text) OR can_apts() OR can_elaks()));

create policy "apts by perm" on apartments as PERMISSIVE for ALL to authenticated using (((my_role() = 'owner'::text) OR can_apts())) with check (((my_role() = 'owner'::text) OR can_apts()));

create policy "settings owner" on app_settings as PERMISSIVE for ALL to authenticated using ((my_role() = 'owner'::text)) with check ((my_role() = 'owner'::text));

create policy "apt expenses by perm" on apt_expenses as PERMISSIVE for ALL to authenticated using (((my_role() = 'owner'::text) OR can_apts())) with check (((my_role() = 'owner'::text) OR can_apts()));

create policy "images by perm" on article_images as PERMISSIVE for ALL to authenticated using (((my_role() = 'owner'::text) OR can_elaks())) with check (((my_role() = 'owner'::text) OR can_elaks()));

create policy "prices by perm" on article_prices as PERMISSIVE for ALL to authenticated using (((my_role() = 'owner'::text) OR can_elaks())) with check (((my_role() = 'owner'::text) OR can_elaks()));

create policy "articles by perm" on articles as PERMISSIVE for ALL to authenticated using (((my_role() = 'owner'::text) OR can_elaks())) with check (((my_role() = 'owner'::text) OR can_elaks()));

create policy "bills by perm" on bills as PERMISSIVE for ALL to authenticated using (((my_role() = 'owner'::text) OR can_apts())) with check (((my_role() = 'owner'::text) OR can_apts()));

create policy "clients by perm" on clients as PERMISSIVE for ALL to authenticated using (((my_role() = 'owner'::text) OR can_elaks())) with check (((my_role() = 'owner'::text) OR can_elaks()));

create policy "document files by perm" on document_files as PERMISSIVE for ALL to authenticated using (((my_role() = 'owner'::text) OR can_elaks())) with check (((my_role() = 'owner'::text) OR can_elaks()));

create policy "documents by perm" on documents as PERMISSIVE for ALL to authenticated using (((my_role() = 'owner'::text) OR can_elaks())) with check (((my_role() = 'owner'::text) OR can_elaks()));

create policy "cash by perm" on elaks_cash as PERMISSIVE for ALL to authenticated using (((my_role() = 'owner'::text) OR can_elaks())) with check (((my_role() = 'owner'::text) OR can_elaks()));

create policy "feeds by perm" on ical_feeds as PERMISSIVE for ALL to authenticated using (((my_role() = 'owner'::text) OR can_apts())) with check (((my_role() = 'owner'::text) OR can_apts()));

create policy "installations by perm" on installations as PERMISSIVE for ALL to authenticated using (((my_role() = 'owner'::text) OR can_elaks())) with check (((my_role() = 'owner'::text) OR can_elaks()));

create policy "invoices by perm" on invoices as PERMISSIVE for ALL to authenticated using (((my_role() = 'owner'::text) OR can_elaks())) with check (((my_role() = 'owner'::text) OR can_elaks()));

create policy "job photos by perm" on job_photos as PERMISSIVE for ALL to authenticated using (((my_role() = 'owner'::text) OR can_elaks())) with check (((my_role() = 'owner'::text) OR can_elaks()));

create policy "jobs by perm" on jobs as PERMISSIVE for ALL to authenticated using (((my_role() = 'owner'::text) OR can_elaks())) with check (((my_role() = 'owner'::text) OR can_elaks()));

create policy "movements by perm" on movements as PERMISSIVE for ALL to authenticated using (((my_role() = 'owner'::text) OR can_elaks())) with check (((my_role() = 'owner'::text) OR can_elaks()));

create policy "offer payments by perm" on offer_payments as PERMISSIVE for ALL to authenticated using (((my_role() = 'owner'::text) OR can_elaks())) with check (((my_role() = 'owner'::text) OR can_elaks()));

create policy "offers by perm" on offers as PERMISSIVE for ALL to authenticated using (((my_role() = 'owner'::text) OR can_elaks())) with check (((my_role() = 'owner'::text) OR can_elaks()));

create policy "policies by perm" on policies as PERMISSIVE for ALL to authenticated using (can_insurance()) with check (can_insurance());

create policy "policy payments by perm" on policy_payments as PERMISSIVE for ALL to authenticated using (can_insurance()) with check (can_insurance());

create policy "policy photos by perm" on policy_photos as PERMISSIVE for ALL to authenticated using (can_insurance()) with check (can_insurance());

create policy "purchases by perm" on purchases as PERMISSIVE for ALL to authenticated using (((my_role() = 'owner'::text) OR can_elaks())) with check (((my_role() = 'owner'::text) OR can_elaks()));

create policy "own subscriptions" on push_subscriptions as PERMISSIVE for ALL to authenticated using ((user_id = auth.uid())) with check ((user_id = auth.uid()));

create policy "sites by perm" on sites as PERMISSIVE for ALL to authenticated using (((my_role() = 'owner'::text) OR can_elaks())) with check (((my_role() = 'owner'::text) OR can_elaks()));

create policy "statement items by perm" on statement_items as PERMISSIVE for ALL to authenticated using (can_insurance()) with check (can_insurance());

create policy "statements by perm" on statements as PERMISSIVE for ALL to authenticated using (can_insurance()) with check (can_insurance());

create policy "stay payments by perm" on stay_payments as PERMISSIVE for ALL to authenticated using (((my_role() = 'owner'::text) OR can_apts())) with check (((my_role() = 'owner'::text) OR can_apts()));

create policy "stays by perm" on stays as PERMISSIVE for ALL to authenticated using (((my_role() = 'owner'::text) OR can_apts())) with check (((my_role() = 'owner'::text) OR can_apts()));

create policy "suppliers by perm" on suppliers as PERMISSIVE for ALL to authenticated using (((my_role() = 'owner'::text) OR can_elaks())) with check (((my_role() = 'owner'::text) OR can_elaks()));

create policy "completions by perm" on task_completions as PERMISSIVE for ALL to authenticated using ((EXISTS ( SELECT 1
   FROM tasks t
  WHERE (t.id = task_completions.task_id)))) with check ((EXISTS ( SELECT 1
   FROM tasks t
  WHERE (t.id = task_completions.task_id))));

create policy "task photos by perm" on task_photos as PERMISSIVE for ALL to authenticated using (((my_role() = 'owner'::text) OR (EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = task_photos.task_id) AND (t.context = ANY (my_task_ctx()))))))) with check (((my_role() = 'owner'::text) OR (EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = task_photos.task_id) AND (t.context = ANY (my_task_ctx())))))));

create policy "templates by perm" on task_templates as PERMISSIVE for ALL to authenticated using (((my_role() = 'owner'::text) OR (array_length(my_task_ctx(), 1) > 0))) with check (((my_role() = 'owner'::text) OR (array_length(my_task_ctx(), 1) > 0)));

create policy "tasks by perm" on tasks as PERMISSIVE for ALL to authenticated using (
CASE
    WHEN (context = 'personal'::text) THEN ((owner_uid = auth.uid()) OR (owner_uid = ANY (my_personal_access())))
    ELSE ((my_role() = 'owner'::text) OR (context = ANY (my_task_ctx())))
END) with check (
CASE
    WHEN (context = 'personal'::text) THEN ((COALESCE(owner_uid, auth.uid()) = auth.uid()) OR (COALESCE(owner_uid, auth.uid()) = ANY (my_personal_access())))
    ELSE ((my_role() = 'owner'::text) OR (context = ANY (my_task_ctx())))
END);

create policy "owner read all" on user_roles as PERMISSIVE for SELECT to authenticated using ((my_role() = 'owner'::text));

create policy "owner update" on user_roles as PERMISSIVE for UPDATE to authenticated using ((my_role() = 'owner'::text)) with check ((my_role() = 'owner'::text));

create policy "read own role" on user_roles as PERMISSIVE for SELECT to authenticated using ((user_id = auth.uid()));

create policy "self register empty" on user_roles as PERMISSIVE for INSERT to authenticated with check (((user_id = auth.uid()) AND (role = ANY (ARRAY['employee'::text, 'assistant'::text])) AND (COALESCE(task_contexts, '{}'::text[]) = '{}'::text[]) AND (see_elaks = false) AND (see_apts = false)));
