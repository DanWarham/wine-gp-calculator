-- Stage 6A: Pricing data import — canonical immutable snapshots from Lime Wood
-- FnbShop + Micros source files. Writes only via SECURITY DEFINER RPC.

-- ---------------------------------------------------------------------------
-- 1. pricing_items (persistent external identity for this import integration)
-- ---------------------------------------------------------------------------
create table "public"."pricing_items" (
  "id" uuid not null default gen_random_uuid(),
  "user_id" uuid not null default auth.uid(),
  "external_plu" text not null,
  "created_at" timestamp with time zone not null default now(),
  constraint "pricing_items_pkey" primary key ("id"),
  constraint "pricing_items_user_id_fkey"
    foreign key ("user_id") references auth.users ("id") on delete cascade,
  constraint "pricing_items_external_plu_check"
    check (trim(external_plu) <> ''),
  constraint "pricing_items_user_external_plu_key"
    unique ("user_id", "external_plu")
);

comment on table "public"."pricing_items" is
  'Persistent pricing item identity. external_plu is the join key for the current Lime Wood / Micros source integration, not a universal application identity.';

comment on column "public"."pricing_items"."external_plu" is
  'External PLU/ObjectNumber from the current source integration.';

create index "pricing_items_user_id_idx"
  on "public"."pricing_items" ("user_id");

-- ---------------------------------------------------------------------------
-- 2. pricing_data_imports (immutable completed import events)
-- ---------------------------------------------------------------------------
create table "public"."pricing_data_imports" (
  "id" uuid not null default gen_random_uuid(),
  "user_id" uuid not null default auth.uid(),
  "imported_at" timestamp with time zone not null default now(),
  "status" text not null,
  "source_system" text not null default 'lime_wood_v1',
  "source_filenames" jsonb not null default '{}'::jsonb,
  "fnbshop_wine_recipe_count" integer not null default 0,
  "full_bottle_count" integer not null default 0,
  "partial_serve_count" integer not null default 0,
  "matched_count" integer not null default 0,
  "excluded_exception_count" integer not null default 0,
  "ignored_micros_only_count" integer not null default 0,
  "informational_issue_count" integer not null default 0,
  constraint "pricing_data_imports_pkey" primary key ("id"),
  constraint "pricing_data_imports_user_id_fkey"
    foreign key ("user_id") references auth.users ("id") on delete cascade,
  constraint "pricing_data_imports_status_check"
    check (status in ('completed')),
  constraint "pricing_data_imports_source_system_check"
    check (trim(source_system) <> ''),
  constraint "pricing_data_imports_source_filenames_object_check"
    check (jsonb_typeof(source_filenames) = 'object'),
  constraint "pricing_data_imports_counts_nonneg_check"
    check (
      fnbshop_wine_recipe_count >= 0
      and full_bottle_count >= 0
      and partial_serve_count >= 0
      and matched_count >= 0
      and excluded_exception_count >= 0
      and ignored_micros_only_count >= 0
      and informational_issue_count >= 0
    )
);

comment on table "public"."pricing_data_imports" is
  'Immutable pricing data import events. Only completed imports are persisted; structural failures are not stored.';

comment on column "public"."pricing_data_imports"."source_filenames" is
  'Original uploaded filenames and related source metadata (not raw file contents).';

create index "pricing_data_imports_user_imported_at_idx"
  on "public"."pricing_data_imports" ("user_id", "imported_at" desc);

-- ---------------------------------------------------------------------------
-- 3. pricing_observations (per-item state within one import)
-- ---------------------------------------------------------------------------
create table "public"."pricing_observations" (
  "id" uuid not null default gen_random_uuid(),
  "import_id" uuid not null,
  "pricing_item_id" uuid not null,
  "user_id" uuid not null,
  "external_plu" text not null,
  "fnbshop_description" text,
  "micros_description" text,
  "cost_ex_vat" numeric,
  "selling_price_inc_vat" numeric,
  "fnbshop_selling_price_inc_vat" numeric,
  "recipe_volume_ml" numeric,
  "package_volume_ml" numeric,
  "item_type" text,
  "micros_main_menu_level" text,
  "ingredient_description" text,
  "included_for_pricing" boolean not null default false,
  "created_at" timestamp with time zone not null default now(),
  constraint "pricing_observations_pkey" primary key ("id"),
  constraint "pricing_observations_import_id_fkey"
    foreign key ("import_id")
    references "public"."pricing_data_imports" ("id")
    on delete cascade,
  constraint "pricing_observations_pricing_item_id_fkey"
    foreign key ("pricing_item_id")
    references "public"."pricing_items" ("id")
    on delete restrict,
  constraint "pricing_observations_user_id_fkey"
    foreign key ("user_id") references auth.users ("id") on delete cascade,
  constraint "pricing_observations_external_plu_check"
    check (trim(external_plu) <> ''),
  constraint "pricing_observations_item_type_check"
    check (item_type is null or item_type in ('full_bottle', 'partial_serve')),
  constraint "pricing_observations_import_item_key" unique ("import_id", "pricing_item_id")
);

comment on table "public"."pricing_observations" is
  'Immutable observed pricing state for one item in one import. Cost from FnbShop; selling price from Micros.';

comment on column "public"."pricing_observations"."included_for_pricing" is
  'False when the row is retained for history/diagnostics but excluded from Pricing Review calculations (item exception).';

comment on column "public"."pricing_observations"."fnbshop_selling_price_inc_vat" is
  'Diagnostic only. Authoritative selling price is selling_price_inc_vat from Micros.';

create index "pricing_observations_import_id_idx"
  on "public"."pricing_observations" ("import_id");

create index "pricing_observations_user_plu_idx"
  on "public"."pricing_observations" ("user_id", "external_plu");

create index "pricing_observations_pricing_item_id_idx"
  on "public"."pricing_observations" ("pricing_item_id");

-- ---------------------------------------------------------------------------
-- 4. pricing_import_issues
-- ---------------------------------------------------------------------------
create table "public"."pricing_import_issues" (
  "id" uuid not null default gen_random_uuid(),
  "import_id" uuid not null,
  "user_id" uuid not null,
  "external_plu" text,
  "severity" text not null,
  "issue_type" text not null,
  "message" text not null,
  "created_at" timestamp with time zone not null default now(),
  constraint "pricing_import_issues_pkey" primary key ("id"),
  constraint "pricing_import_issues_import_id_fkey"
    foreign key ("import_id")
    references "public"."pricing_data_imports" ("id")
    on delete cascade,
  constraint "pricing_import_issues_user_id_fkey"
    foreign key ("user_id") references auth.users ("id") on delete cascade,
  constraint "pricing_import_issues_severity_check"
    check (severity in ('item_exception', 'informational')),
  constraint "pricing_import_issues_issue_type_check"
    check (trim(issue_type) <> ''),
  constraint "pricing_import_issues_message_check"
    check (trim(message) <> '')
);

comment on table "public"."pricing_import_issues" is
  'Persisted import issues. Structural blocking failures are not stored (import is not created).';

create index "pricing_import_issues_import_id_idx"
  on "public"."pricing_import_issues" ("import_id");

create index "pricing_import_issues_user_id_idx"
  on "public"."pricing_import_issues" ("user_id");

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------
alter table "public"."pricing_items" enable row level security;
alter table "public"."pricing_data_imports" enable row level security;
alter table "public"."pricing_observations" enable row level security;
alter table "public"."pricing_import_issues" enable row level security;

create policy "pricing_items_select_own"
on "public"."pricing_items"
as permissive
for select
to authenticated
using (auth.uid() = user_id);

create policy "pricing_data_imports_select_own"
on "public"."pricing_data_imports"
as permissive
for select
to authenticated
using (auth.uid() = user_id);

create policy "pricing_observations_select_own"
on "public"."pricing_observations"
as permissive
for select
to authenticated
using (auth.uid() = user_id);

create policy "pricing_import_issues_select_own"
on "public"."pricing_import_issues"
as permissive
for select
to authenticated
using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 6. Grants (no anon; authenticated SELECT only; writes via RPC)
-- ---------------------------------------------------------------------------
revoke all on table "public"."pricing_items" from "anon";
revoke all on table "public"."pricing_items" from "authenticated";
revoke all on table "public"."pricing_data_imports" from "anon";
revoke all on table "public"."pricing_data_imports" from "authenticated";
revoke all on table "public"."pricing_observations" from "anon";
revoke all on table "public"."pricing_observations" from "authenticated";
revoke all on table "public"."pricing_import_issues" from "anon";
revoke all on table "public"."pricing_import_issues" from "authenticated";

grant select on table "public"."pricing_items" to "authenticated";
grant select on table "public"."pricing_data_imports" to "authenticated";
grant select on table "public"."pricing_observations" to "authenticated";
grant select on table "public"."pricing_import_issues" to "authenticated";

grant select, insert, update, delete on table "public"."pricing_items" to "service_role";
grant select, insert, update, delete on table "public"."pricing_data_imports" to "service_role";
grant select, insert, update, delete on table "public"."pricing_observations" to "service_role";
grant select, insert, update, delete on table "public"."pricing_import_issues" to "service_role";

-- ---------------------------------------------------------------------------
-- 7. commit_pricing_data_import — atomic completed import write
-- ---------------------------------------------------------------------------
create or replace function "public"."commit_pricing_data_import"(
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_import public.pricing_data_imports%rowtype;
  v_obs jsonb;
  v_issue jsonb;
  v_plu text;
  v_item_id uuid;
  v_summary jsonb;
  v_filenames jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid import payload' using errcode = '22023';
  end if;

  v_summary := coalesce(p_payload->'summary', '{}'::jsonb);
  v_filenames := coalesce(p_payload->'source_filenames', '{}'::jsonb);

  if jsonb_typeof(v_filenames) <> 'object' then
    raise exception 'source_filenames must be an object' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_payload->'observations', '[]'::jsonb)) <> 'array' then
    raise exception 'observations must be an array' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_payload->'issues', '[]'::jsonb)) <> 'array' then
    raise exception 'issues must be an array' using errcode = '22023';
  end if;

  insert into public.pricing_data_imports (
    user_id,
    status,
    source_system,
    source_filenames,
    fnbshop_wine_recipe_count,
    full_bottle_count,
    partial_serve_count,
    matched_count,
    excluded_exception_count,
    ignored_micros_only_count,
    informational_issue_count
  ) values (
    v_uid,
    'completed',
    coalesce(nullif(trim(p_payload->>'source_system'), ''), 'lime_wood_v1'),
    v_filenames,
    coalesce((v_summary->>'fnbshop_wine_recipe_count')::integer, 0),
    coalesce((v_summary->>'full_bottle_count')::integer, 0),
    coalesce((v_summary->>'partial_serve_count')::integer, 0),
    coalesce((v_summary->>'matched_count')::integer, 0),
    coalesce((v_summary->>'excluded_exception_count')::integer, 0),
    coalesce((v_summary->>'ignored_micros_only_count')::integer, 0),
    coalesce((v_summary->>'informational_issue_count')::integer, 0)
  )
  returning * into v_import;

  for v_obs in
    select value from jsonb_array_elements(coalesce(p_payload->'observations', '[]'::jsonb))
  loop
    v_plu := trim(v_obs->>'external_plu');
    if v_plu is null or v_plu = '' then
      raise exception 'Observation missing external_plu' using errcode = '22023';
    end if;

    insert into public.pricing_items (user_id, external_plu)
    values (v_uid, v_plu)
    on conflict (user_id, external_plu)
    do update set external_plu = excluded.external_plu
    returning id into v_item_id;

    -- ON CONFLICT DO UPDATE is required to RETURNING on conflict; no-op update keeps identity.
    if v_item_id is null then
      select id into v_item_id
      from public.pricing_items
      where user_id = v_uid and external_plu = v_plu;
    end if;

    insert into public.pricing_observations (
      import_id,
      pricing_item_id,
      user_id,
      external_plu,
      fnbshop_description,
      micros_description,
      cost_ex_vat,
      selling_price_inc_vat,
      fnbshop_selling_price_inc_vat,
      recipe_volume_ml,
      package_volume_ml,
      item_type,
      micros_main_menu_level,
      ingredient_description,
      included_for_pricing
    ) values (
      v_import.id,
      v_item_id,
      v_uid,
      v_plu,
      nullif(v_obs->>'fnbshop_description', ''),
      nullif(v_obs->>'micros_description', ''),
      nullif(v_obs->>'cost_ex_vat', '')::numeric,
      nullif(v_obs->>'selling_price_inc_vat', '')::numeric,
      nullif(v_obs->>'fnbshop_selling_price_inc_vat', '')::numeric,
      nullif(v_obs->>'recipe_volume_ml', '')::numeric,
      nullif(v_obs->>'package_volume_ml', '')::numeric,
      nullif(v_obs->>'item_type', ''),
      nullif(v_obs->>'micros_main_menu_level', ''),
      nullif(v_obs->>'ingredient_description', ''),
      coalesce((v_obs->>'included_for_pricing')::boolean, false)
    );
  end loop;

  for v_issue in
    select value from jsonb_array_elements(coalesce(p_payload->'issues', '[]'::jsonb))
  loop
    insert into public.pricing_import_issues (
      import_id,
      user_id,
      external_plu,
      severity,
      issue_type,
      message
    ) values (
      v_import.id,
      v_uid,
      nullif(trim(v_issue->>'external_plu'), ''),
      v_issue->>'severity',
      v_issue->>'issue_type',
      v_issue->>'message'
    );
  end loop;

  return jsonb_build_object(
    'import_id', v_import.id,
    'imported_at', v_import.imported_at,
    'status', v_import.status,
    'summary', jsonb_build_object(
      'fnbshop_wine_recipe_count', v_import.fnbshop_wine_recipe_count,
      'full_bottle_count', v_import.full_bottle_count,
      'partial_serve_count', v_import.partial_serve_count,
      'matched_count', v_import.matched_count,
      'excluded_exception_count', v_import.excluded_exception_count,
      'ignored_micros_only_count', v_import.ignored_micros_only_count,
      'informational_issue_count', v_import.informational_issue_count
    )
  );
end;
$$;

comment on function "public"."commit_pricing_data_import"(jsonb) is
  'Atomically persist a completed pricing data import with observations and issues for the calling user.';

revoke all on function "public"."commit_pricing_data_import"(jsonb) from public;
revoke all on function "public"."commit_pricing_data_import"(jsonb) from anon;
grant execute on function "public"."commit_pricing_data_import"(jsonb) to authenticated;
grant execute on function "public"."commit_pricing_data_import"(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 8. Previous completed import helper (Stage 6B foundation)
-- ---------------------------------------------------------------------------
create or replace function "public"."get_previous_completed_pricing_data_import"(
  p_import_id uuid
)
returns "public"."pricing_data_imports"
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_current public.pricing_data_imports%rowtype;
  v_previous public.pricing_data_imports%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_current
  from public.pricing_data_imports
  where id = p_import_id
    and user_id = v_uid
    and status = 'completed';

  if not found then
    raise exception 'Pricing data import not found' using errcode = 'P0002';
  end if;

  select * into v_previous
  from public.pricing_data_imports
  where user_id = v_uid
    and status = 'completed'
    and imported_at < v_current.imported_at
  order by imported_at desc
  limit 1;

  if not found then
    return null;
  end if;

  return v_previous;
end;
$$;

comment on function "public"."get_previous_completed_pricing_data_import"(uuid) is
  'Returns the immediately previous completed pricing data import for the same user, or null.';

revoke all on function "public"."get_previous_completed_pricing_data_import"(uuid) from public;
revoke all on function "public"."get_previous_completed_pricing_data_import"(uuid) from anon;
grant execute on function "public"."get_previous_completed_pricing_data_import"(uuid) to authenticated;
grant execute on function "public"."get_previous_completed_pricing_data_import"(uuid) to service_role;
