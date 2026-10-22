-- Stage 3C: user-owned serving sizes (additive; does not alter gp_settings or pricing_policy).
-- Categories are fixed: dry | sparkling | sweet_fortified. Bottle is not a serving-size row.

create table "public"."serving_sizes" (
  "id" uuid not null default gen_random_uuid(),
  "user_id" uuid not null,
  "category" text not null,
  "label" text not null,
  "volume_ml" integer not null,
  "enabled" boolean not null default true,
  "display_order" integer not null,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

alter table "public"."serving_sizes"
  add constraint "serving_sizes_pkey" primary key ("id");

alter table "public"."serving_sizes"
  add constraint "serving_sizes_user_id_fkey"
  foreign key ("user_id") references auth.users ("id") on delete cascade;

alter table "public"."serving_sizes"
  add constraint "serving_sizes_category_check"
  check (category in ('dry', 'sparkling', 'sweet_fortified'));

alter table "public"."serving_sizes"
  add constraint "serving_sizes_label_check"
  check (trim(label) <> '');

alter table "public"."serving_sizes"
  add constraint "serving_sizes_volume_ml_check"
  check (volume_ml > 0);

alter table "public"."serving_sizes"
  add constraint "serving_sizes_display_order_check"
  check (display_order >= 0);

-- Unique labels per user+category (case/whitespace insensitive).
create unique index "serving_sizes_user_category_label_key"
  on "public"."serving_sizes" ("user_id", "category", lower(trim("label")));

create index "serving_sizes_user_category_order_idx"
  on "public"."serving_sizes" ("user_id", "category", "display_order");

comment on table "public"."serving_sizes" is
  'User-configured pour/carafe serving sizes by fixed wine category. Bottle is not stored here.';

comment on column "public"."serving_sizes"."category" is
  'Fixed category: dry | sparkling | sweet_fortified';

comment on column "public"."serving_sizes"."volume_ml" is
  'Serving volume in whole millilitres.';

alter table "public"."serving_sizes" enable row level security;

create policy "serving_sizes_select_own"
on "public"."serving_sizes"
as permissive
for select
to authenticated
using ((auth.uid() = user_id));

create policy "serving_sizes_insert_own"
on "public"."serving_sizes"
as permissive
for insert
to authenticated
with check ((auth.uid() = user_id));

create policy "serving_sizes_update_own"
on "public"."serving_sizes"
as permissive
for update
to authenticated
using ((auth.uid() = user_id))
with check ((auth.uid() = user_id));

create policy "serving_sizes_delete_own"
on "public"."serving_sizes"
as permissive
for delete
to authenticated
using ((auth.uid() = user_id));

grant select, insert, update, delete on table "public"."serving_sizes" to "authenticated";
grant select, insert, update, delete on table "public"."serving_sizes" to "service_role";

-- Seed product defaults for existing Auth users (conflict-safe).
insert into "public"."serving_sizes" ("user_id", "category", "label", "volume_ml", "enabled", "display_order")
select u.id, d.category, d.label, d.volume_ml, true, d.display_order
from auth.users u
cross join (
  values
    ('dry', 'Small glass', 125, 10),
    ('dry', 'Medium glass', 175, 20),
    ('dry', 'Large glass', 250, 30),
    ('dry', 'Carafe', 500, 40),
    ('sparkling', 'Coravin glass', 125, 10),
    ('sparkling', 'Standard glass', 150, 20),
    ('sweet_fortified', 'Small glass', 75, 10)
) as d(category, label, volume_ml, display_order)
on conflict do nothing;
