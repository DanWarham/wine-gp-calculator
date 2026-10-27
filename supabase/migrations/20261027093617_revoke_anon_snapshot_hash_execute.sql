-- Stage 5 follow-up: hash helper is identity/dedup only, but anon must not execute it.
revoke all on function "public"."pricing_configuration_snapshot_content_hash"(
  uuid, text, jsonb, numeric, numeric, numeric, numeric
) from public;
revoke all on function "public"."pricing_configuration_snapshot_content_hash"(
  uuid, text, jsonb, numeric, numeric, numeric, numeric
) from anon;

grant execute on function "public"."pricing_configuration_snapshot_content_hash"(
  uuid, text, jsonb, numeric, numeric, numeric, numeric
) to authenticated;
grant execute on function "public"."pricing_configuration_snapshot_content_hash"(
  uuid, text, jsonb, numeric, numeric, numeric, numeric
) to service_role;
