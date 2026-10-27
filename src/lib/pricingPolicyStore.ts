/**
 * @deprecated Stage 5 — Pricing Policy is part of Pricing Configurations.
 * Conversion helpers remain here for existing test imports; runtime authority is
 * `pricingConfigurationStore` / `public.pricing_configurations`.
 */
export {
  percentToRate,
  rateToPercent,
  rowToPricingPolicy,
  PROVISIONING_DEFAULTS,
} from '@/lib/pricingConfigurationStore'
