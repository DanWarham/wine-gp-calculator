-- Stage 6C: Full Pricing Review support on existing pricing_reviews model.
-- Action Documents are generated from completed review rows (no new tables).

-- ---------------------------------------------------------------------------
-- 1. Allow review_type = full; previous_import optional for full reviews
-- ---------------------------------------------------------------------------
alter table "public"."pricing_reviews"
  drop constraint "pricing_reviews_review_type_check";

alter table "public"."pricing_reviews"
  drop constraint "pricing_reviews_imports_distinct_check";

alter table "public"."pricing_reviews"
  alter column "previous_import_id" drop not null;

alter table "public"."pricing_reviews"
  add constraint "pricing_reviews_review_type_check"
  check (review_type in ('cost_change', 'full'));

alter table "public"."pricing_reviews"
  add constraint "pricing_reviews_imports_by_type_check"
  check (
    (
      review_type = 'cost_change'
      and previous_import_id is not null
      and current_import_id <> previous_import_id
    )
    or (
      review_type = 'full'
      and previous_import_id is null
    )
  );

comment on table "public"."pricing_reviews" is
  'Persisted Pricing Reviews: cost_change (import pair) and full (latest import).';

comment on column "public"."pricing_reviews"."previous_import_id" is
  'Required for cost_change reviews; null for full reviews (latest import only).';

-- ---------------------------------------------------------------------------
-- 2. Draft uniqueness per review type
-- ---------------------------------------------------------------------------
drop index if exists "public"."pricing_reviews_one_draft_per_import_pair";

create unique index "pricing_reviews_one_draft_cost_change_per_import_pair"
  on "public"."pricing_reviews" ("user_id", "current_import_id", "previous_import_id")
  where status = 'draft' and review_type = 'cost_change';

create unique index "pricing_reviews_one_draft_full_per_import"
  on "public"."pricing_reviews" ("user_id", "current_import_id")
  where status = 'draft' and review_type = 'full';

-- ---------------------------------------------------------------------------
-- 3. commit_full_pricing_review — atomic draft create for Full Pricing Review
-- ---------------------------------------------------------------------------
create or replace function "public"."commit_full_pricing_review"(
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

  if coalesce(p_payload->>'review_type', '') <> 'full' then
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
    'full',
    v_current.id,
    null,
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
      -- Full Review has no previous cost; store current cost for NOT NULL columns.
      (v_item->>'current_cost_ex_vat')::numeric,
      (v_item->>'current_cost_ex_vat')::numeric,
      (v_item->>'current_selling_price_inc_vat')::numeric,
      -- old_gp unused for Full Review display; store current_gp for NOT NULL.
      (v_item->>'current_gp')::numeric,
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

comment on function "public"."commit_full_pricing_review"(jsonb) is
  'Atomically persist a draft Full Pricing Review with calculated items for the calling user.';

revoke all on function "public"."commit_full_pricing_review"(jsonb) from public;
revoke all on function "public"."commit_full_pricing_review"(jsonb) from anon;
grant execute on function "public"."commit_full_pricing_review"(jsonb) to authenticated;
grant execute on function "public"."commit_full_pricing_review"(jsonb) to service_role;
