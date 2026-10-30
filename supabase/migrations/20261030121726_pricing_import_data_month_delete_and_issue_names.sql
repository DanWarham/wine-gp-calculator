-- Stage 6C follow-up: data_month, safe import deletion, issue item names.

-- ---------------------------------------------------------------------------
-- 1. pricing_data_imports.data_month (first day of the calendar month)
-- ---------------------------------------------------------------------------
alter table "public"."pricing_data_imports"
  add column if not exists "data_month" date;

update "public"."pricing_data_imports"
set data_month = date_trunc('month', imported_at at time zone 'UTC')::date
where data_month is null;

alter table "public"."pricing_data_imports"
  alter column "data_month" set not null;

alter table "public"."pricing_data_imports"
  drop constraint if exists "pricing_data_imports_data_month_month_start_check";

alter table "public"."pricing_data_imports"
  add constraint "pricing_data_imports_data_month_month_start_check"
  check (data_month = date_trunc('month', data_month::timestamp)::date);

comment on column "public"."pricing_data_imports"."data_month" is
  'Calendar month the pricing dataset represents (stored as the first day of that month). Distinct from imported_at audit timestamp.';

create index if not exists "pricing_data_imports_user_data_month_imported_at_idx"
  on "public"."pricing_data_imports" ("user_id", "data_month" desc, "imported_at" desc);

-- ---------------------------------------------------------------------------
-- 2. pricing_import_issues.item_name
-- ---------------------------------------------------------------------------
alter table "public"."pricing_import_issues"
  add column if not exists "item_name" text;

comment on column "public"."pricing_import_issues"."item_name" is
  'Display name at import time: prefer FnbShop description, else Micros description.';

-- ---------------------------------------------------------------------------
-- 3. commit_pricing_data_import — accept data_month + issue item_name
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
  v_data_month date;
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

  begin
    v_data_month := (p_payload->>'data_month')::date;
  exception when others then
    raise exception 'data_month must be a valid date (first day of month)' using errcode = '22023';
  end;

  if v_data_month is null then
    raise exception 'data_month is required' using errcode = '22023';
  end if;

  if v_data_month <> date_trunc('month', v_data_month::timestamp)::date then
    raise exception 'data_month must be the first day of a calendar month' using errcode = '22023';
  end if;

  insert into public.pricing_data_imports (
    user_id,
    status,
    source_system,
    source_filenames,
    data_month,
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
    v_data_month,
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
      item_name,
      severity,
      issue_type,
      message
    ) values (
      v_import.id,
      v_uid,
      nullif(trim(v_issue->>'external_plu'), ''),
      nullif(trim(v_issue->>'item_name'), ''),
      v_issue->>'severity',
      v_issue->>'issue_type',
      v_issue->>'message'
    );
  end loop;

  return jsonb_build_object(
    'import_id', v_import.id,
    'imported_at', v_import.imported_at,
    'data_month', v_import.data_month,
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
  'Atomically persist a completed pricing data import with data_month, observations and issues.';

-- ---------------------------------------------------------------------------
-- 4. Previous import by previous data month (latest upload in that month)
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
  v_prev_month date;
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

  select max(data_month) into v_prev_month
  from public.pricing_data_imports
  where user_id = v_uid
    and status = 'completed'
    and data_month < v_current.data_month;

  if v_prev_month is null then
    return null;
  end if;

  -- Latest completed import within the previous available data month.
  select * into v_previous
  from public.pricing_data_imports
  where user_id = v_uid
    and status = 'completed'
    and data_month = v_prev_month
  order by imported_at desc
  limit 1;

  if not found then
    return null;
  end if;

  return v_previous;
end;
$$;

comment on function "public"."get_previous_completed_pricing_data_import"(uuid) is
  'Returns the latest completed import from the previous available data month for the same user, or null.';

-- ---------------------------------------------------------------------------
-- 5. delete_pricing_data_import — safe deletion
-- ---------------------------------------------------------------------------
-- Behaviour:
-- - Blocked when any COMPLETED pricing_review references the import
--   as current_import_id or previous_import_id.
-- - Draft reviews that reference the import are deleted with the import
--   (review items cascade from pricing_reviews).
-- - Observations and issues cascade from pricing_data_imports.
-- - Orphaned user-owned pricing_items (no remaining observations/review items)
--   are removed when safe.
create or replace function "public"."delete_pricing_data_import"(
  p_import_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_import public.pricing_data_imports%rowtype;
  v_completed_refs integer;
  v_draft_deleted integer;
  v_items_deleted integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_import
  from public.pricing_data_imports
  where id = p_import_id
    and user_id = v_uid
  for update;

  if not found then
    raise exception 'Pricing data import not found' using errcode = 'P0002';
  end if;

  select count(*) into v_completed_refs
  from public.pricing_reviews
  where user_id = v_uid
    and status = 'completed'
    and (
      current_import_id = p_import_id
      or previous_import_id = p_import_id
    );

  if v_completed_refs > 0 then
    raise exception
      'Cannot delete this import because % completed Pricing Review(s) depend on it. Completed review history is preserved.',
      v_completed_refs
      using errcode = '22023';
  end if;

  delete from public.pricing_reviews
  where user_id = v_uid
    and status = 'draft'
    and (
      current_import_id = p_import_id
      or previous_import_id = p_import_id
    );
  get diagnostics v_draft_deleted = row_count;

  delete from public.pricing_data_imports
  where id = p_import_id
    and user_id = v_uid;

  -- Orphaned pricing items for this user with no remaining observations or review rows.
  with orphans as (
    select pi.id
    from public.pricing_items pi
    where pi.user_id = v_uid
      and not exists (
        select 1 from public.pricing_observations o where o.pricing_item_id = pi.id
      )
      and not exists (
        select 1 from public.pricing_review_items ri where ri.pricing_item_id = pi.id
      )
  )
  delete from public.pricing_items pi
  using orphans
  where pi.id = orphans.id;
  get diagnostics v_items_deleted = row_count;

  return jsonb_build_object(
    'import_id', p_import_id,
    'deleted', true,
    'draft_reviews_deleted', v_draft_deleted,
    'orphaned_pricing_items_deleted', v_items_deleted
  );
end;
$$;

comment on function "public"."delete_pricing_data_import"(uuid) is
  'Delete a pricing data import when no completed Pricing Review depends on it. Draft reviews referencing the import are removed; completed reviews block deletion.';

revoke all on function "public"."delete_pricing_data_import"(uuid) from public;
revoke all on function "public"."delete_pricing_data_import"(uuid) from anon;
grant execute on function "public"."delete_pricing_data_import"(uuid) to authenticated;
grant execute on function "public"."delete_pricing_data_import"(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. append_pricing_review_items — batch insert for large Full Reviews
-- ---------------------------------------------------------------------------
create or replace function "public"."append_pricing_review_items"(
  p_review_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_review public.pricing_reviews%rowtype;
  v_item jsonb;
  v_inserted integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be an array' using errcode = '22023';
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
    raise exception 'Items can only be appended to draft reviews' using errcode = '22023';
  end if;

  for v_item in
    select value from jsonb_array_elements(p_items)
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
      coalesce(
        nullif(v_item->>'previous_cost_ex_vat', '')::numeric,
        (v_item->>'current_cost_ex_vat')::numeric
      ),
      (v_item->>'current_cost_ex_vat')::numeric,
      (v_item->>'current_selling_price_inc_vat')::numeric,
      coalesce(
        nullif(v_item->>'old_gp', '')::numeric,
        (v_item->>'current_gp')::numeric
      ),
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
    v_inserted := v_inserted + 1;
  end loop;

  update public.pricing_reviews
  set updated_at = now()
  where id = v_review.id;

  return jsonb_build_object(
    'review_id', v_review.id,
    'inserted', v_inserted
  );
end;
$$;

comment on function "public"."append_pricing_review_items"(uuid, jsonb) is
  'Append calculated review items to a draft Pricing Review in batches (avoids oversized single payloads).';

revoke all on function "public"."append_pricing_review_items"(uuid, jsonb) from public;
revoke all on function "public"."append_pricing_review_items"(uuid, jsonb) from anon;
grant execute on function "public"."append_pricing_review_items"(uuid, jsonb) to authenticated;
grant execute on function "public"."append_pricing_review_items"(uuid, jsonb) to service_role;
