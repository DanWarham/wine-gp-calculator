-- Stage 6B: Cost Change Review — persisted reviews against completed pricing imports.

-- ---------------------------------------------------------------------------
-- 1. pricing_reviews
-- ---------------------------------------------------------------------------
create table "public"."pricing_reviews" (
  "id" uuid not null default gen_random_uuid(),
  "user_id" uuid not null default auth.uid(),
  "review_type" text not null,
  "current_import_id" uuid not null,
  "previous_import_id" uuid not null,
  "pricing_configuration_snapshot_id" uuid not null,
  "tolerance_gp_points" numeric not null,
  "status" text not null,
  "presence_summary" jsonb not null default '{"new_items":[],"missing_items":[]}'::jsonb,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  "completed_at" timestamp with time zone,
  constraint "pricing_reviews_pkey" primary key ("id"),
  constraint "pricing_reviews_user_id_fkey"
    foreign key ("user_id") references auth.users ("id") on delete cascade,
  constraint "pricing_reviews_current_import_id_fkey"
    foreign key ("current_import_id")
    references "public"."pricing_data_imports" ("id")
    on delete restrict,
  constraint "pricing_reviews_previous_import_id_fkey"
    foreign key ("previous_import_id")
    references "public"."pricing_data_imports" ("id")
    on delete restrict,
  constraint "pricing_reviews_snapshot_id_fkey"
    foreign key ("pricing_configuration_snapshot_id")
    references "public"."pricing_configuration_snapshots" ("id")
    on delete restrict,
  constraint "pricing_reviews_review_type_check"
    check (review_type in ('cost_change')),
  constraint "pricing_reviews_status_check"
    check (status in ('draft', 'completed')),
  constraint "pricing_reviews_tolerance_check"
    check (tolerance_gp_points >= 0),
  constraint "pricing_reviews_imports_distinct_check"
    check (current_import_id <> previous_import_id),
  constraint "pricing_reviews_presence_summary_object_check"
    check (jsonb_typeof(presence_summary) = 'object'),
  constraint "pricing_reviews_completed_at_check"
    check (
      (status = 'draft' and completed_at is null)
      or (status = 'completed' and completed_at is not null)
    )
);

comment on table "public"."pricing_reviews" is
  'Persisted Pricing Reviews. Stage 6B supports cost_change; Full Pricing Review is deferred.';

comment on column "public"."pricing_reviews"."tolerance_gp_points" is
  'GP percentage-point tolerance captured on the review for reproducibility.';

comment on column "public"."pricing_reviews"."presence_summary" is
  'New / missing items relative to the previous import (not ordinary cost-change rows).';

create index "pricing_reviews_user_created_at_idx"
  on "public"."pricing_reviews" ("user_id", "created_at" desc);

create index "pricing_reviews_user_status_idx"
  on "public"."pricing_reviews" ("user_id", "status");

create unique index "pricing_reviews_one_draft_per_import_pair"
  on "public"."pricing_reviews" ("user_id", "current_import_id", "previous_import_id")
  where status = 'draft';

-- ---------------------------------------------------------------------------
-- 2. pricing_review_items
-- ---------------------------------------------------------------------------
create table "public"."pricing_review_items" (
  "id" uuid not null default gen_random_uuid(),
  "review_id" uuid not null,
  "user_id" uuid not null,
  "pricing_item_id" uuid not null,
  "external_plu" text not null,
  "description" text,
  "bottle_size_ml" numeric not null,
  "previous_cost_ex_vat" numeric not null,
  "current_cost_ex_vat" numeric not null,
  "current_selling_price_inc_vat" numeric not null,
  "old_gp" numeric not null,
  "current_gp" numeric not null,
  "target_gp" numeric not null,
  "recommended_price_inc_vat" numeric not null,
  "system_status" text not null,
  "decision" text,
  "proposed_price_inc_vat" numeric,
  "resulting_gp" numeric,
  "previous_change_price_pending" boolean not null default false,
  "previous_proposed_price_inc_vat" numeric,
  "previous_delist_pending" boolean not null default false,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  constraint "pricing_review_items_pkey" primary key ("id"),
  constraint "pricing_review_items_review_id_fkey"
    foreign key ("review_id")
    references "public"."pricing_reviews" ("id")
    on delete cascade,
  constraint "pricing_review_items_user_id_fkey"
    foreign key ("user_id") references auth.users ("id") on delete cascade,
  constraint "pricing_review_items_pricing_item_id_fkey"
    foreign key ("pricing_item_id")
    references "public"."pricing_items" ("id")
    on delete restrict,
  constraint "pricing_review_items_external_plu_check"
    check (trim(external_plu) <> ''),
  constraint "pricing_review_items_bottle_size_check"
    check (bottle_size_ml > 0),
  constraint "pricing_review_items_system_status_check"
    check (system_status in ('requires_attention', 'no_action_required')),
  constraint "pricing_review_items_decision_check"
    check (decision is null or decision in ('change_price', 'delist', 'no_action')),
  constraint "pricing_review_items_change_price_fields_check"
    check (
      decision is distinct from 'change_price'
      or (
        proposed_price_inc_vat is not null
        and proposed_price_inc_vat > 0
        and resulting_gp is not null
      )
    ),
  constraint "pricing_review_items_review_item_key"
    unique ("review_id", "pricing_item_id")
);

comment on table "public"."pricing_review_items" is
  'Cost-change rows within a Pricing Review. Historical values remain fixed after creation.';

comment on column "public"."pricing_review_items"."old_gp" is
  'GP from previous cost + CURRENT Micros selling price (isolates cost movement).';

comment on column "public"."pricing_review_items"."decision" is
  'User decision for Requires Attention rows. Null until decided; auto no-action rows may remain null.';

create index "pricing_review_items_review_id_idx"
  on "public"."pricing_review_items" ("review_id");

create index "pricing_review_items_user_plu_idx"
  on "public"."pricing_review_items" ("user_id", "external_plu");

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
alter table "public"."pricing_reviews" enable row level security;
alter table "public"."pricing_review_items" enable row level security;

create policy "pricing_reviews_select_own"
on "public"."pricing_reviews"
as permissive
for select
to authenticated
using (auth.uid() = user_id);

create policy "pricing_reviews_update_own_draft"
on "public"."pricing_reviews"
as permissive
for update
to authenticated
using (auth.uid() = user_id and status = 'draft')
with check (auth.uid() = user_id and status = 'draft');

create policy "pricing_review_items_select_own"
on "public"."pricing_review_items"
as permissive
for select
to authenticated
using (auth.uid() = user_id);

create policy "pricing_review_items_update_own_draft"
on "public"."pricing_review_items"
as permissive
for update
to authenticated
using (
  auth.uid() = user_id
  and exists (
    select 1 from public.pricing_reviews r
    where r.id = review_id
      and r.user_id = auth.uid()
      and r.status = 'draft'
  )
)
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.pricing_reviews r
    where r.id = review_id
      and r.user_id = auth.uid()
      and r.status = 'draft'
  )
);

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------
revoke all on table "public"."pricing_reviews" from "anon";
revoke all on table "public"."pricing_reviews" from "authenticated";
revoke all on table "public"."pricing_review_items" from "anon";
revoke all on table "public"."pricing_review_items" from "authenticated";

grant select on table "public"."pricing_reviews" to "authenticated";
grant update (
  tolerance_gp_points,
  updated_at
) on table "public"."pricing_reviews" to "authenticated";

grant select on table "public"."pricing_review_items" to "authenticated";
grant update (
  system_status,
  decision,
  proposed_price_inc_vat,
  resulting_gp,
  updated_at
) on table "public"."pricing_review_items" to "authenticated";

grant select, insert, update, delete on table "public"."pricing_reviews" to "service_role";
grant select, insert, update, delete on table "public"."pricing_review_items" to "service_role";

-- ---------------------------------------------------------------------------
-- 5. commit_cost_change_review — atomic draft create
-- ---------------------------------------------------------------------------
create or replace function "public"."commit_cost_change_review"(
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_review public.pricing_reviews%rowtype;
  v_current public.pricing_data_imports%rowtype;
  v_previous public.pricing_data_imports%rowtype;
  v_snapshot public.pricing_configuration_snapshots%rowtype;
  v_item jsonb;
  v_tolerance numeric;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid review payload' using errcode = '22023';
  end if;

  if coalesce(p_payload->>'review_type', '') <> 'cost_change' then
    raise exception 'Unsupported review_type' using errcode = '22023';
  end if;

  v_tolerance := (p_payload->>'tolerance_gp_points')::numeric;
  if v_tolerance is null or v_tolerance < 0 then
    raise exception 'tolerance_gp_points must be a non-negative number' using errcode = '22023';
  end if;

  select * into v_current
  from public.pricing_data_imports
  where id = (p_payload->>'current_import_id')::uuid
    and user_id = v_uid
    and status = 'completed';
  if not found then
    raise exception 'Current import not found' using errcode = 'P0002';
  end if;

  select * into v_previous
  from public.pricing_data_imports
  where id = (p_payload->>'previous_import_id')::uuid
    and user_id = v_uid
    and status = 'completed';
  if not found then
    raise exception 'Previous import not found' using errcode = 'P0002';
  end if;

  if v_current.id = v_previous.id then
    raise exception 'Current and previous imports must differ' using errcode = '22023';
  end if;

  if v_previous.imported_at >= v_current.imported_at then
    raise exception 'Previous import must be earlier than current import' using errcode = '22023';
  end if;

  select * into v_snapshot
  from public.pricing_configuration_snapshots
  where id = (p_payload->>'pricing_configuration_snapshot_id')::uuid
    and user_id = v_uid;
  if not found then
    raise exception 'Pricing configuration snapshot not found' using errcode = 'P0002';
  end if;

  if jsonb_typeof(coalesce(p_payload->'items', '[]'::jsonb)) <> 'array' then
    raise exception 'items must be an array' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_payload->'presence_summary', '{}'::jsonb)) <> 'object' then
    raise exception 'presence_summary must be an object' using errcode = '22023';
  end if;

  insert into public.pricing_reviews (
    user_id,
    review_type,
    current_import_id,
    previous_import_id,
    pricing_configuration_snapshot_id,
    tolerance_gp_points,
    status,
    presence_summary
  ) values (
    v_uid,
    'cost_change',
    v_current.id,
    v_previous.id,
    v_snapshot.id,
    v_tolerance,
    'draft',
    coalesce(p_payload->'presence_summary', '{"new_items":[],"missing_items":[]}'::jsonb)
  )
  returning * into v_review;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb))
  loop
    insert into public.pricing_review_items (
      review_id,
      user_id,
      pricing_item_id,
      external_plu,
      description,
      bottle_size_ml,
      previous_cost_ex_vat,
      current_cost_ex_vat,
      current_selling_price_inc_vat,
      old_gp,
      current_gp,
      target_gp,
      recommended_price_inc_vat,
      system_status,
      decision,
      proposed_price_inc_vat,
      resulting_gp,
      previous_change_price_pending,
      previous_proposed_price_inc_vat,
      previous_delist_pending
    ) values (
      v_review.id,
      v_uid,
      (v_item->>'pricing_item_id')::uuid,
      trim(v_item->>'external_plu'),
      nullif(v_item->>'description', ''),
      (v_item->>'bottle_size_ml')::numeric,
      (v_item->>'previous_cost_ex_vat')::numeric,
      (v_item->>'current_cost_ex_vat')::numeric,
      (v_item->>'current_selling_price_inc_vat')::numeric,
      (v_item->>'old_gp')::numeric,
      (v_item->>'current_gp')::numeric,
      (v_item->>'target_gp')::numeric,
      (v_item->>'recommended_price_inc_vat')::numeric,
      v_item->>'system_status',
      nullif(v_item->>'decision', ''),
      nullif(v_item->>'proposed_price_inc_vat', '')::numeric,
      nullif(v_item->>'resulting_gp', '')::numeric,
      coalesce((v_item->>'previous_change_price_pending')::boolean, false),
      nullif(v_item->>'previous_proposed_price_inc_vat', '')::numeric,
      coalesce((v_item->>'previous_delist_pending')::boolean, false)
    );
  end loop;

  return jsonb_build_object(
    'review_id', v_review.id,
    'status', v_review.status,
    'created_at', v_review.created_at,
    'tolerance_gp_points', v_review.tolerance_gp_points
  );
end;
$$;

comment on function "public"."commit_cost_change_review"(jsonb) is
  'Atomically persist a draft Cost Change Review with calculated items for the calling user.';

revoke all on function "public"."commit_cost_change_review"(jsonb) from public;
revoke all on function "public"."commit_cost_change_review"(jsonb) from anon;
grant execute on function "public"."commit_cost_change_review"(jsonb) to authenticated;
grant execute on function "public"."commit_cost_change_review"(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 6. complete_pricing_review
-- ---------------------------------------------------------------------------
create or replace function "public"."complete_pricing_review"(
  p_review_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_review public.pricing_reviews%rowtype;
  v_undecided integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_review
  from public.pricing_reviews
  where id = p_review_id
    and user_id = v_uid
  for update;

  if not found then
    raise exception 'Pricing review not found' using errcode = 'P0002';
  end if;

  if v_review.status <> 'draft' then
    raise exception 'Only draft reviews can be completed' using errcode = '22023';
  end if;

  select count(*) into v_undecided
  from public.pricing_review_items
  where review_id = v_review.id
    and system_status = 'requires_attention'
    and decision is null;

  if v_undecided > 0 then
    raise exception 'All Requires Attention rows must have a decision before completion'
      using errcode = '22023';
  end if;

  update public.pricing_reviews
  set
    status = 'completed',
    completed_at = now(),
    updated_at = now()
  where id = v_review.id
  returning * into v_review;

  return jsonb_build_object(
    'review_id', v_review.id,
    'status', v_review.status,
    'completed_at', v_review.completed_at
  );
end;
$$;

comment on function "public"."complete_pricing_review"(uuid) is
  'Complete a draft Pricing Review once every Requires Attention row has a decision.';

revoke all on function "public"."complete_pricing_review"(uuid) from public;
revoke all on function "public"."complete_pricing_review"(uuid) from anon;
grant execute on function "public"."complete_pricing_review"(uuid) to authenticated;
grant execute on function "public"."complete_pricing_review"(uuid) to service_role;
