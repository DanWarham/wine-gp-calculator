-- Stage 5: Pricing Configurations, immutable snapshots, and Current-promotion history.
-- Additive: does not drop legacy gp_settings / pricing_policy.
-- Preflight (live): 2 auth users, each with exactly one gp_settings + pricing_policy; no orphans.

-- ---------------------------------------------------------------------------
-- 0. Preflight guards (fail migration if live data is not 1:1)
-- ---------------------------------------------------------------------------
do $$
declare
  bad_users integer;
  orphan_gp integer;
  orphan_policy integer;
begin
  select count(*) into bad_users
  from auth.users u
  where (select count(*) from public.gp_settings g where g.user_id = u.id) <> 1
     or (select count(*) from public.pricing_policy p where p.user_id = u.id) <> 1;

  if bad_users > 0 then
    raise exception
      'Stage 5 preflight failed: % auth user(s) lack exactly one gp_settings and pricing_policy row',
      bad_users;
  end if;

  select count(*) into orphan_gp
  from public.gp_settings g
  left join auth.users u on u.id = g.user_id
  where u.id is null;

  select count(*) into orphan_policy
  from public.pricing_policy p
  left join auth.users u on u.id = p.user_id
  where u.id is null;

  if orphan_gp > 0 or orphan_policy > 0 then
    raise exception
      'Stage 5 preflight failed: orphan rows (gp_settings=%, pricing_policy=%)',
      orphan_gp, orphan_policy;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. pricing_configurations
-- ---------------------------------------------------------------------------
create table "public"."pricing_configurations" (
  "id" uuid not null default gen_random_uuid(),
  "user_id" uuid not null default auth.uid(),
  "name" text not null,
  "is_current" boolean not null default false,
  "status" text not null default 'active',
  "rules" jsonb not null default '[]'::jsonb,
  "vat_rate" numeric not null default 0.20,
  "btg_bottle_discount" numeric not null default 0.05,
  "bottle_rounding_increment" numeric not null default 1.00,
  "pour_rounding_increment" numeric not null default 0.50,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  constraint "pricing_configurations_pkey" primary key ("id"),
  constraint "pricing_configurations_user_id_fkey"
    foreign key ("user_id") references auth.users ("id") on delete cascade,
  constraint "pricing_configurations_status_check"
    check (status in ('active', 'archived')),
  constraint "pricing_configurations_name_check"
    check (trim(name) <> ''),
  constraint "pricing_configurations_current_must_be_active_check"
    check (not is_current or status = 'active'),
  constraint "pricing_configurations_vat_rate_check"
    check (vat_rate >= 0),
  constraint "pricing_configurations_btg_bottle_discount_check"
    check (btg_bottle_discount >= 0 and btg_bottle_discount < 1),
  constraint "pricing_configurations_bottle_rounding_increment_check"
    check (bottle_rounding_increment > 0),
  constraint "pricing_configurations_pour_rounding_increment_check"
    check (pour_rounding_increment > 0),
  constraint "pricing_configurations_rules_is_array_check"
    check (jsonb_typeof(rules) = 'array')
);

comment on table "public"."pricing_configurations" is
  'Editable Pricing Configuration: GP Rules + Pricing Policy. Exactly one Current (is_current) per user.';

comment on column "public"."pricing_configurations"."is_current" is
  'Status flag: Calculator and future Pricing Review always use the Current configuration.';

comment on column "public"."pricing_configurations"."status" is
  'active | archived. Archived configs are excluded from normal selection; Current cannot be archived.';

comment on column "public"."pricing_configurations"."rules" is
  'GP rule set JSONB (canonical Rule model). Empty array is allowed for blank alternatives / new-user Main Pricing.';

-- At most one Current per user
create unique index "pricing_configurations_one_current_per_user"
  on "public"."pricing_configurations" ("user_id")
  where (is_current = true);

-- Case/whitespace-insensitive unique names across active + archived
create unique index "pricing_configurations_user_name_key"
  on "public"."pricing_configurations" ("user_id", lower(trim("name")));

create index "pricing_configurations_user_status_idx"
  on "public"."pricing_configurations" ("user_id", "status");

-- ---------------------------------------------------------------------------
-- 2. pricing_configuration_snapshots (immutable)
-- ---------------------------------------------------------------------------
create table "public"."pricing_configuration_snapshots" (
  "id" uuid not null default gen_random_uuid(),
  "user_id" uuid not null,
  "source_configuration_id" uuid not null,
  "source_configuration_name" text not null,
  "rules" jsonb not null,
  "vat_rate" numeric not null,
  "btg_bottle_discount" numeric not null,
  "bottle_rounding_increment" numeric not null,
  "pour_rounding_increment" numeric not null,
  "content_hash" text not null,
  "created_at" timestamp with time zone not null default now(),
  constraint "pricing_configuration_snapshots_pkey" primary key ("id"),
  constraint "pricing_configuration_snapshots_user_id_fkey"
    foreign key ("user_id") references auth.users ("id") on delete cascade,
  -- Preserve historical snapshots if a configuration were ever physically removed
  constraint "pricing_configuration_snapshots_source_configuration_id_fkey"
    foreign key ("source_configuration_id")
    references "public"."pricing_configurations" ("id")
    on delete restrict,
  constraint "pricing_configuration_snapshots_name_check"
    check (trim(source_configuration_name) <> ''),
  constraint "pricing_configuration_snapshots_rules_is_array_check"
    check (jsonb_typeof(rules) = 'array'),
  constraint "pricing_configuration_snapshots_vat_rate_check"
    check (vat_rate >= 0),
  constraint "pricing_configuration_snapshots_btg_bottle_discount_check"
    check (btg_bottle_discount >= 0 and btg_bottle_discount < 1),
  constraint "pricing_configuration_snapshots_bottle_rounding_increment_check"
    check (bottle_rounding_increment > 0),
  constraint "pricing_configuration_snapshots_pour_rounding_increment_check"
    check (pour_rounding_increment > 0),
  constraint "pricing_configuration_snapshots_content_hash_check"
    check (trim(content_hash) <> '')
);

comment on table "public"."pricing_configuration_snapshots" is
  'Immutable captured Pricing Configuration state for reproducibility (Pricing Review / Scenario / Make Current).';

comment on column "public"."pricing_configuration_snapshots"."content_hash" is
  'Deterministic fingerprint of source id + captured name + rules + policy for deduplication (not cryptographic auth).';

comment on column "public"."pricing_configuration_snapshots"."source_configuration_name" is
  'Configuration name at capture time; survives independently of later renames.';

-- Dedup: same source configuration + identical captured state → one snapshot
create unique index "pricing_configuration_snapshots_source_hash_key"
  on "public"."pricing_configuration_snapshots" ("source_configuration_id", "content_hash");

create index "pricing_configuration_snapshots_user_id_idx"
  on "public"."pricing_configuration_snapshots" ("user_id");

-- ---------------------------------------------------------------------------
-- 3. pricing_current_events (immutable promotion history)
-- ---------------------------------------------------------------------------
create table "public"."pricing_current_events" (
  "id" uuid not null default gen_random_uuid(),
  "user_id" uuid not null,
  "previous_configuration_id" uuid not null,
  "previous_snapshot_id" uuid not null,
  "new_configuration_id" uuid not null,
  "new_snapshot_id" uuid not null,
  "changed_at" timestamp with time zone not null default now(),
  constraint "pricing_current_events_pkey" primary key ("id"),
  constraint "pricing_current_events_user_id_fkey"
    foreign key ("user_id") references auth.users ("id") on delete cascade,
  constraint "pricing_current_events_previous_configuration_id_fkey"
    foreign key ("previous_configuration_id")
    references "public"."pricing_configurations" ("id")
    on delete restrict,
  constraint "pricing_current_events_new_configuration_id_fkey"
    foreign key ("new_configuration_id")
    references "public"."pricing_configurations" ("id")
    on delete restrict,
  constraint "pricing_current_events_previous_snapshot_id_fkey"
    foreign key ("previous_snapshot_id")
    references "public"."pricing_configuration_snapshots" ("id")
    on delete restrict,
  constraint "pricing_current_events_new_snapshot_id_fkey"
    foreign key ("new_snapshot_id")
    references "public"."pricing_configuration_snapshots" ("id")
    on delete restrict,
  constraint "pricing_current_events_distinct_configs_check"
    check (previous_configuration_id <> new_configuration_id)
);

comment on table "public"."pricing_current_events" is
  'Immutable record of Make Current promotions. Not a general effective-dating system.';

create index "pricing_current_events_user_changed_at_idx"
  on "public"."pricing_current_events" ("user_id", "changed_at" desc);

-- ---------------------------------------------------------------------------
-- 4. Migrate existing Current Pricing → Main Pricing (exact copy; no snapshots/events)
-- ---------------------------------------------------------------------------
insert into "public"."pricing_configurations" (
  "user_id",
  "name",
  "is_current",
  "status",
  "rules",
  "vat_rate",
  "btg_bottle_discount",
  "bottle_rounding_increment",
  "pour_rounding_increment",
  "created_at",
  "updated_at"
)
select
  g.user_id,
  'Main Pricing',
  true,
  'active',
  coalesce(g.rules, '[]'::jsonb),
  p.vat_rate,
  p.btg_bottle_discount,
  p.bottle_rounding_increment,
  p.pour_rounding_increment,
  now(),
  now()
from public.gp_settings g
inner join public.pricing_policy p on p.user_id = g.user_id;

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------
alter table "public"."pricing_configurations" enable row level security;
alter table "public"."pricing_configuration_snapshots" enable row level security;
alter table "public"."pricing_current_events" enable row level security;

-- Configurations: own-row CRUD-ish (no physical delete via grants)
create policy "pricing_configurations_select_own"
on "public"."pricing_configurations"
as permissive
for select
to authenticated
using (auth.uid() = user_id);

create policy "pricing_configurations_insert_own"
on "public"."pricing_configurations"
as permissive
for insert
to authenticated
with check (
  auth.uid() = user_id
  and is_current = false
  and status = 'active'
);

create policy "pricing_configurations_update_own"
on "public"."pricing_configurations"
as permissive
for update
to authenticated
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  -- Current must remain active; archived cannot be current (also enforced by CHECK)
  and (not is_current or status = 'active')
);

-- Snapshots: SELECT own only
create policy "pricing_configuration_snapshots_select_own"
on "public"."pricing_configuration_snapshots"
as permissive
for select
to authenticated
using (auth.uid() = user_id);

-- Events: SELECT own only
create policy "pricing_current_events_select_own"
on "public"."pricing_current_events"
as permissive
for select
to authenticated
using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 6. Grants (Stage 4 pattern: no anon; least privilege; no physical DELETE on configs)
-- ---------------------------------------------------------------------------
revoke all on table "public"."pricing_configurations" from "anon";
revoke all on table "public"."pricing_configurations" from "authenticated";
revoke all on table "public"."pricing_configuration_snapshots" from "anon";
revoke all on table "public"."pricing_configuration_snapshots" from "authenticated";
revoke all on table "public"."pricing_current_events" from "anon";
revoke all on table "public"."pricing_current_events" from "authenticated";

-- Table-level SELECT for authenticated (RLS still applies)
grant select on table "public"."pricing_configurations" to "authenticated";
grant select on table "public"."pricing_configuration_snapshots" to "authenticated";
grant select on table "public"."pricing_current_events" to "authenticated";

-- Column-level INSERT: clients cannot set user_id, is_current, or status
-- (defaults: auth.uid(), false, 'active')
grant insert (
  "name",
  "rules",
  "vat_rate",
  "btg_bottle_discount",
  "bottle_rounding_increment",
  "pour_rounding_increment"
) on table "public"."pricing_configurations" to "authenticated";

-- Column-level UPDATE: clients cannot change user_id or is_current
grant update (
  "name",
  "status",
  "rules",
  "vat_rate",
  "btg_bottle_discount",
  "bottle_rounding_increment",
  "pour_rounding_increment",
  "updated_at"
) on table "public"."pricing_configurations" to "authenticated";

-- Snapshots / events: no authenticated INSERT/UPDATE/DELETE (created only via RPCs)
-- service_role retains full access by default on new tables in Supabase; be explicit:
grant select, insert, update, delete on table "public"."pricing_configurations" to "service_role";
grant select, insert, update, delete on table "public"."pricing_configuration_snapshots" to "service_role";
grant select, insert, update, delete on table "public"."pricing_current_events" to "service_role";

-- ---------------------------------------------------------------------------
-- 7. Helper: deterministic snapshot content hash
-- ---------------------------------------------------------------------------
create or replace function "public"."pricing_configuration_snapshot_content_hash"(
  p_source_configuration_id uuid,
  p_source_configuration_name text,
  p_rules jsonb,
  p_vat_rate numeric,
  p_btg_bottle_discount numeric,
  p_bottle_rounding_increment numeric,
  p_pour_rounding_increment numeric
)
returns text
language sql
immutable
parallel safe
set search_path = public, extensions, pg_temp
as $$
  select encode(
    extensions.digest(
      convert_to(
        -- jsonb_build_object emits keys in sorted order; jsonb text form is deterministic
        jsonb_build_object(
          'source_configuration_id', p_source_configuration_id::text,
          'source_configuration_name', trim(p_source_configuration_name),
          'rules', coalesce(p_rules, '[]'::jsonb),
          'vat_rate', p_vat_rate,
          'btg_bottle_discount', p_btg_bottle_discount,
          'bottle_rounding_increment', p_bottle_rounding_increment,
          'pour_rounding_increment', p_pour_rounding_increment
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

comment on function "public"."pricing_configuration_snapshot_content_hash" is
  'Deterministic fingerprint for snapshot deduplication (identity, not authentication).';

revoke all on function "public"."pricing_configuration_snapshot_content_hash"(
  uuid, text, jsonb, numeric, numeric, numeric, numeric
) from public;
grant execute on function "public"."pricing_configuration_snapshot_content_hash"(
  uuid, text, jsonb, numeric, numeric, numeric, numeric
) to authenticated;
grant execute on function "public"."pricing_configuration_snapshot_content_hash"(
  uuid, text, jsonb, numeric, numeric, numeric, numeric
) to service_role;

-- ---------------------------------------------------------------------------
-- 8. ensure_current_pricing_configuration (first-use Current bootstrap)
-- ---------------------------------------------------------------------------
create or replace function "public"."ensure_current_pricing_configuration"()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_existing public.pricing_configurations%rowtype;
  v_inserted public.pricing_configurations%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_existing
  from public.pricing_configurations
  where user_id = v_uid
    and is_current = true;

  if found then
    return jsonb_build_object(
      'configuration', to_jsonb(v_existing),
      'created', false
    );
  end if;

  -- Genuine first Current: Main Pricing with empty rules + product policy defaults.
  begin
    insert into public.pricing_configurations (
      user_id,
      name,
      is_current,
      status,
      rules,
      vat_rate,
      btg_bottle_discount,
      bottle_rounding_increment,
      pour_rounding_increment
    ) values (
      v_uid,
      'Main Pricing',
      true,
      'active',
      '[]'::jsonb,
      0.20,
      0.05,
      1.00,
      0.50
    )
    returning * into v_inserted;

    return jsonb_build_object(
      'configuration', to_jsonb(v_inserted),
      'created', true
    );
  exception
    when unique_violation then
      -- Concurrent first-use: re-select the winner's Current (do not seed again).
      select * into v_existing
      from public.pricing_configurations
      where user_id = v_uid
        and is_current = true;

      if not found then
        raise exception
          'Failed to resolve Current pricing configuration after concurrent create'
          using errcode = 'P0002';
      end if;

      return jsonb_build_object(
        'configuration', to_jsonb(v_existing),
        'created', false
      );
  end;
end;
$$;

comment on function "public"."ensure_current_pricing_configuration"() is
  'Race-safe first-use provisioning of Current Main Pricing (empty rules + default policy).';

revoke all on function "public"."ensure_current_pricing_configuration"() from public;
revoke all on function "public"."ensure_current_pricing_configuration"() from anon;
grant execute on function "public"."ensure_current_pricing_configuration"() to authenticated;
grant execute on function "public"."ensure_current_pricing_configuration"() to service_role;

-- ---------------------------------------------------------------------------
-- 9. capture_pricing_configuration_snapshot (controlled; SECURITY DEFINER)
-- ---------------------------------------------------------------------------
create or replace function "public"."capture_pricing_configuration_snapshot"(
  p_configuration_id uuid
)
returns "public"."pricing_configuration_snapshots"
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_cfg public.pricing_configurations%rowtype;
  v_hash text;
  v_existing public.pricing_configuration_snapshots%rowtype;
  v_inserted public.pricing_configuration_snapshots%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_cfg
  from public.pricing_configurations
  where id = p_configuration_id
    and user_id = v_uid
  for share;

  if not found then
    raise exception 'Pricing configuration not found' using errcode = 'P0002';
  end if;

  if v_cfg.status <> 'active' then
    raise exception 'Only active pricing configurations can be captured' using errcode = '22023';
  end if;

  -- Blank / no-rule configurations are not capturable
  if v_cfg.rules is null
     or jsonb_typeof(v_cfg.rules) <> 'array'
     or jsonb_array_length(v_cfg.rules) = 0 then
    raise exception 'Cannot capture a pricing configuration with no GP rules' using errcode = '22023';
  end if;

  v_hash := public.pricing_configuration_snapshot_content_hash(
    v_cfg.id,
    v_cfg.name,
    v_cfg.rules,
    v_cfg.vat_rate,
    v_cfg.btg_bottle_discount,
    v_cfg.bottle_rounding_increment,
    v_cfg.pour_rounding_increment
  );

  select * into v_existing
  from public.pricing_configuration_snapshots
  where source_configuration_id = v_cfg.id
    and content_hash = v_hash;

  if found then
    return v_existing;
  end if;

  insert into public.pricing_configuration_snapshots (
    user_id,
    source_configuration_id,
    source_configuration_name,
    rules,
    vat_rate,
    btg_bottle_discount,
    bottle_rounding_increment,
    pour_rounding_increment,
    content_hash
  ) values (
    v_uid,
    v_cfg.id,
    trim(v_cfg.name),
    v_cfg.rules,
    v_cfg.vat_rate,
    v_cfg.btg_bottle_discount,
    v_cfg.bottle_rounding_increment,
    v_cfg.pour_rounding_increment,
    v_hash
  )
  returning * into v_inserted;

  return v_inserted;
exception
  when unique_violation then
    -- Concurrent capture of identical state: reuse the winner
    select * into v_existing
    from public.pricing_configuration_snapshots
    where source_configuration_id = v_cfg.id
      and content_hash = v_hash;
    if not found then
      raise;
    end if;
    return v_existing;
end;
$$;

comment on function "public"."capture_pricing_configuration_snapshot"(uuid) is
  'Atomically capture or reuse an immutable snapshot of an owned eligible Pricing Configuration.';

revoke all on function "public"."capture_pricing_configuration_snapshot"(uuid) from public;
revoke all on function "public"."capture_pricing_configuration_snapshot"(uuid) from anon;
grant execute on function "public"."capture_pricing_configuration_snapshot"(uuid) to authenticated;
grant execute on function "public"."capture_pricing_configuration_snapshot"(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 10. make_pricing_configuration_current (atomic promotion; SECURITY DEFINER)
-- ---------------------------------------------------------------------------
create or replace function "public"."make_pricing_configuration_current"(
  p_configuration_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_incoming public.pricing_configurations%rowtype;
  v_outgoing public.pricing_configurations%rowtype;
  v_prev_snap public.pricing_configuration_snapshots%rowtype;
  v_new_snap public.pricing_configuration_snapshots%rowtype;
  v_event public.pricing_current_events%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- Lock both rows in stable order to avoid deadlocks
  select * into v_incoming
  from public.pricing_configurations
  where id = p_configuration_id
    and user_id = v_uid
  for update;

  if not found then
    raise exception 'Pricing configuration not found' using errcode = 'P0002';
  end if;

  if v_incoming.status <> 'active' then
    raise exception 'Only active pricing configurations can be made Current' using errcode = '22023';
  end if;

  if v_incoming.is_current then
    raise exception 'Configuration is already Current' using errcode = '22023';
  end if;

  if v_incoming.rules is null
     or jsonb_typeof(v_incoming.rules) <> 'array'
     or jsonb_array_length(v_incoming.rules) = 0 then
    raise exception 'Cannot make Current a pricing configuration with no GP rules' using errcode = '22023';
  end if;

  select * into v_outgoing
  from public.pricing_configurations
  where user_id = v_uid
    and is_current = true
  for update;

  if not found then
    raise exception 'No Current pricing configuration exists to replace' using errcode = 'P0002';
  end if;

  if v_outgoing.id = v_incoming.id then
    raise exception 'Configuration is already Current' using errcode = '22023';
  end if;

  -- Capture both sides via the same controlled path (eligibility enforced inside)
  v_prev_snap := public.capture_pricing_configuration_snapshot(v_outgoing.id);
  v_new_snap := public.capture_pricing_configuration_snapshot(v_incoming.id);

  update public.pricing_configurations
  set is_current = false,
      updated_at = now()
  where id = v_outgoing.id
    and user_id = v_uid;

  update public.pricing_configurations
  set is_current = true,
      status = 'active',
      updated_at = now()
  where id = v_incoming.id
    and user_id = v_uid;

  insert into public.pricing_current_events (
    user_id,
    previous_configuration_id,
    previous_snapshot_id,
    new_configuration_id,
    new_snapshot_id
  ) values (
    v_uid,
    v_outgoing.id,
    v_prev_snap.id,
    v_incoming.id,
    v_new_snap.id
  )
  returning * into v_event;

  return jsonb_build_object(
    'previous_configuration_id', v_outgoing.id,
    'previous_snapshot_id', v_prev_snap.id,
    'new_configuration_id', v_incoming.id,
    'new_snapshot_id', v_new_snap.id,
    'event_id', v_event.id,
    'changed_at', v_event.changed_at
  );
end;
$$;

comment on function "public"."make_pricing_configuration_current"(uuid) is
  'Atomically promote an active alternative to Current: capture snapshots, switch is_current, record event.';

revoke all on function "public"."make_pricing_configuration_current"(uuid) from public;
revoke all on function "public"."make_pricing_configuration_current"(uuid) from anon;
grant execute on function "public"."make_pricing_configuration_current"(uuid) to authenticated;
grant execute on function "public"."make_pricing_configuration_current"(uuid) to service_role;
