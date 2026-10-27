-- Stage 5 cleanup: drop legacy tables superseded by pricing_configurations.
-- Preflight (Stage 5A + recheck): zero app runtime deps; zero FKs/views/triggers
-- onto these tables from other objects; migrated parity confirmed.
-- Does not alter pricing_configurations, snapshots, events, or serving_sizes.

drop table if exists "public"."gp_settings";
drop table if exists "public"."pricing_policy";
