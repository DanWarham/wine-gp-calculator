-- Stage 3B: user-owned Pricing Policy (additive; does not alter gp_settings).
-- Rates stored as decimal fractions (0.20 = 20% VAT). Rounding increments in £.

create table "public"."pricing_policy" (
  "id" uuid not null default gen_random_uuid(),
  "user_id" uuid not null,
  "vat_rate" numeric not null default 0.20,
  "btg_bottle_discount" numeric not null default 0.05,
  "bottle_rounding_increment" numeric not null default 1.00,
  "pour_rounding_increment" numeric not null default 0.50,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

alter table "public"."pricing_policy"
  add constraint "pricing_policy_pkey" primary key ("id");

alter table "public"."pricing_policy"
  add constraint "pricing_policy_user_id_key" unique ("user_id");

alter table "public"."pricing_policy"
  add constraint "pricing_policy_user_id_fkey"
  foreign key ("user_id") references auth.users ("id") on delete cascade;

alter table "public"."pricing_policy"
  add constraint "pricing_policy_vat_rate_check"
  check (vat_rate >= 0);

alter table "public"."pricing_policy"
  add constraint "pricing_policy_btg_bottle_discount_check"
  check (btg_bottle_discount >= 0 and btg_bottle_discount < 1);

alter table "public"."pricing_policy"
  add constraint "pricing_policy_bottle_rounding_increment_check"
  check (bottle_rounding_increment > 0);

alter table "public"."pricing_policy"
  add constraint "pricing_policy_pour_rounding_increment_check"
  check (pour_rounding_increment > 0);

comment on table "public"."pricing_policy" is
  'Current commercial pricing policy per user (VAT, BTG bottle discount, rounding).';

comment on column "public"."pricing_policy"."vat_rate" is
  'VAT as a decimal fraction (e.g. 0.20 = 20%).';

comment on column "public"."pricing_policy"."btg_bottle_discount" is
  'Discount applied only to the full-bottle line when BTG (e.g. 0.05 = 5%).';

comment on column "public"."pricing_policy"."bottle_rounding_increment" is
  'Commercial bottle-price rounding increment in pounds (e.g. 1.00).';

comment on column "public"."pricing_policy"."pour_rounding_increment" is
  'Commercial pour/glass-price rounding increment in pounds (e.g. 0.50).';

alter table "public"."pricing_policy" enable row level security;

create policy "pricing_policy_select_own"
on "public"."pricing_policy"
as permissive
for select
to authenticated
using ((auth.uid() = user_id));

create policy "pricing_policy_insert_own"
on "public"."pricing_policy"
as permissive
for insert
to authenticated
with check ((auth.uid() = user_id));

create policy "pricing_policy_update_own"
on "public"."pricing_policy"
as permissive
for update
to authenticated
using ((auth.uid() = user_id))
with check ((auth.uid() = user_id));

grant select, insert, update on table "public"."pricing_policy" to "authenticated";
grant select, insert, update, delete on table "public"."pricing_policy" to "service_role";

-- Seed defaults for existing Auth users without overwriting any pre-existing row.
insert into "public"."pricing_policy" ("user_id")
select id from auth.users
on conflict ("user_id") do nothing;
