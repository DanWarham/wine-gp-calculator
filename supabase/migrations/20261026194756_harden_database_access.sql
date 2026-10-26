-- Stage 4B2: harden ownership integrity, table grants, and public default privileges.
-- Does not redesign RLS. Does not modify application row contents.

-- ---------------------------------------------------------------------------
-- 1. gp_settings ownership FK (orphan check performed before apply: 0 orphans)
-- ---------------------------------------------------------------------------
alter table "public"."gp_settings"
  add constraint "gp_settings_user_id_fkey"
  foreign key ("user_id") references auth.users ("id") on delete cascade;

-- ---------------------------------------------------------------------------
-- 2. Explicit least-privilege grants on current user-owned tables
-- Application operations (from repository inspection):
--   gp_settings:     SELECT, INSERT, UPDATE
--   pricing_policy:  SELECT, INSERT, UPDATE
--   serving_sizes:   SELECT, INSERT, UPDATE, DELETE
-- service_role privileges are left unchanged.
-- ---------------------------------------------------------------------------

revoke all on table "public"."gp_settings" from "anon";
revoke all on table "public"."gp_settings" from "authenticated";
grant select, insert, update on table "public"."gp_settings" to "authenticated";

revoke all on table "public"."pricing_policy" from "anon";
revoke all on table "public"."pricing_policy" from "authenticated";
grant select, insert, update on table "public"."pricing_policy" to "authenticated";

revoke all on table "public"."serving_sizes" from "anon";
revoke all on table "public"."serving_sizes" from "authenticated";
grant select, insert, update, delete on table "public"."serving_sizes" to "authenticated";

-- ---------------------------------------------------------------------------
-- 3. Default privileges: stop auto-granting broad table rights to anon /
-- authenticated on future public tables created by the migration owner.
-- Live evidence: all three application tables are owned by postgres, and
-- pg_default_acl includes FOR ROLE postgres on public tables. Migrations via
-- `supabase db push` apply as postgres.
--
-- There is also a supabase_admin default-ACL entry. ALTER DEFAULT PRIVILEGES
-- FOR ROLE supabase_admin requires membership of that role, which the
-- migration role does not have — documented as a residual platform default.
-- ---------------------------------------------------------------------------

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
