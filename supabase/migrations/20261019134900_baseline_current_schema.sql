-- Stage 3A baseline: source-controlled representation of the existing live
-- Wine GP Calculator application schema.
--
-- This migration describes objects that already exist on the linked remote
-- project. It must be recorded as applied via supported migration-history
-- repair tooling and must NOT be executed against the existing live database.
--
-- Intentionally preserves current reality (including no FK from user_id to
-- auth.users, and the existing policy name/semantics).

create table "public"."gp_settings" (
  "id" uuid not null default gen_random_uuid(),
  "user_id" uuid not null,
  "rules" jsonb,
  "created_at" timestamp without time zone not null default now()
);

alter table "public"."gp_settings" enable row level security;

create unique index gp_settings_pkey on public.gp_settings using btree (id);

create unique index gp_settings_user_id_key on public.gp_settings using btree (user_id);

alter table "public"."gp_settings"
  add constraint "gp_settings_pkey" primary key using index "gp_settings_pkey";

alter table "public"."gp_settings"
  add constraint "gp_settings_user_id_key" unique using index "gp_settings_user_id_key";

comment on table "public"."gp_settings" is 'User defines their GP Settings';

create policy "Policy with security definer functions"
on "public"."gp_settings"
as permissive
for all
to public
using ((auth.uid() = user_id))
with check ((auth.uid() = user_id));

grant delete, insert, references, select, trigger, truncate, update on table "public"."gp_settings" to "anon";
grant delete, insert, references, select, trigger, truncate, update on table "public"."gp_settings" to "authenticated";
grant delete, insert, references, select, trigger, truncate, update on table "public"."gp_settings" to "service_role";
