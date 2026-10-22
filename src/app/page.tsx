'use client'

import { useState, useEffect, useMemo, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { sanitizeInput, validateInput } from '@/lib/gpRules'
import type { Rule } from '@/types/rules'
import type { ServingSize } from '@/types/servingSizes'
import {
  isValidGp,
  isValidPositiveMl,
  priceWithGp,
  resolveTargetGp,
  type PricingPolicy,
} from '@/lib/pricing'
import { getOrCreatePricingPolicy } from '@/lib/pricingPolicyStore'
import { listServingSizes, servingSizesForCalculator } from '@/lib/servingSizeStore'
import { WINE_TYPE_OPTIONS, wineTypeToCategory, type WineTypeValue } from '@/lib/wineCategories'

/** Display-only GP formatting. Does not alter the value passed into pricing. */
function formatGpDisplay(gp: number): string {
  if (!Number.isFinite(gp)) return '—'
  // One decimal place for readability; calculation state retains full precision.
  const display = Math.round(gp * 10) / 10
  return Number.isInteger(display) ? String(display) : display.toFixed(1)
}

function resolveBottleSizeMl(
  bottleSize: string,
  customBottleSizeInput: string
): number | null {
  if (bottleSize === 'Half') return 375
  if (bottleSize === 'Bottle') return 750
  if (bottleSize === 'Magnum') return 1500
  const parsed = parseFloat(customBottleSizeInput)
  if (!isValidPositiveMl(parsed)) return null
  return parsed
}

export default function Page() {
  const router = useRouter()

  const [costPriceInput, setCostPriceInput] = useState<string>("")
  const [wineType, setWineType] = useState<WineTypeValue>("Dry")
  const [isBTG, setIsBTG] = useState<boolean>(false)
  const [gp, setGp] = useState<number>(75)
  const [suggestedGp, setSuggestedGp] = useState<number>(75)
  const [gpError, setGpError] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [rules, setRules] = useState<Rule[]>([])
  const [rulesError, setRulesError] = useState<string | null>(null)
  const [pricingPolicy, setPricingPolicy] = useState<PricingPolicy | null>(null)
  const [policyError, setPolicyError] = useState<string | null>(null)
  const [servingSizes, setServingSizes] = useState<ServingSize[] | null>(null)
  const [servingSizesError, setServingSizesError] = useState<string | null>(null)
  const [loadingSession, setLoadingSession] = useState(true)
  const [showSetupModal, setShowSetupModal] = useState(false)
  const [costPriceError, setCostPriceError] = useState<string | null>(null)

  const costPrice = costPriceInput === '' ? NaN : parseFloat(costPriceInput)

  const [bottleSize, setBottleSize] = useState<string>("Bottle")
  const [customBottleSizeInput, setCustomBottleSizeInput] = useState<string>("")

  const baseBottleMl = resolveBottleSizeMl(bottleSize, customBottleSizeInput)

  const bottleLabel = bottleSize === "Other"
    ? (customBottleSizeInput ? `${customBottleSizeInput}ml` : "Custom bottle")
    : bottleSize === "Half" ? "Half Bottle"
    : bottleSize === "Bottle" ? "Bottle"
    : "Magnum"

  const category = wineTypeToCategory(wineType)
  const enabledServings = useMemo(() => {
    if (!servingSizes || !category) return []
    return servingSizesForCalculator(servingSizes, category)
  }, [servingSizes, category])

  useEffect(() => {
    const fetchSettings = async () => {
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        router.push("/welcome")
        return
      }

      const user = session.user

      const policyResult = await getOrCreatePricingPolicy(user.id)
      if (!policyResult.ok) {
        setPolicyError(policyResult.error)
        setPricingPolicy(null)
      } else {
        setPolicyError(null)
        setPricingPolicy(policyResult.policy)
      }

      const servingsResult = await listServingSizes(user.id)
      if (!servingsResult.ok) {
        setServingSizesError(servingsResult.error)
        setServingSizes(null)
      } else {
        setServingSizesError(null)
        setServingSizes(servingsResult.data)
      }

      const { data, error } = await supabase
        .from('gp_settings')
        .select('*')
        .eq('user_id', user.id)
        .single()

      // .single() reports PGRST116 when the user has no gp_settings row yet.
      if (error && error.code !== 'PGRST116') {
        setRulesError(error.message || 'Pricing rules could not be loaded. Prices cannot be calculated.')
        setRules([])
        setShowSetupModal(false)
      } else if (!data?.rules || data.rules.length === 0) {
        setRulesError(null)
        setRules([])
        setShowSetupModal(true)
      } else {
        setRulesError(null)
        setRules(data.rules)
        setShowSetupModal(false)
      }

      setLoadingSession(false)
    }

    fetchSettings()
  }, [router])

  useEffect(() => {
    setLoading(true)
    const timeout = setTimeout(() => {
      if (showSetupModal || rules.length === 0) {
        setGpError(null)
        setLoading(false)
        return
      }

      if (baseBottleMl === null) {
        setGpError('Enter a valid custom bottle size in ml.')
        setLoading(false)
        return
      }

      if (!Number.isFinite(costPrice) || costPrice < 0) {
        setGpError(null)
        setLoading(false)
        return
      }

      const resolved = resolveTargetGp({
        actualCostExVat: costPrice,
        bottleSizeMl: baseBottleMl,
        rules,
      })

      if (!resolved.ok) {
        setGpError(resolved.error.message)
        setLoading(false)
        return
      }

      setGpError(null)
      setSuggestedGp(resolved.targetGp)
      setGp(resolved.targetGp)
      setLoading(false)
    }, 200)

    return () => clearTimeout(timeout)
  }, [costPrice, baseBottleMl, rules, showSetupModal])

  const handleNudge = (delta: number) => {
    setGp((prev) => {
      const next = prev + delta
      return isValidGp(next) ? next : prev
    })
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push("/welcome")
  }

  if (loadingSession) {
    return (
      <main className="p-4 md:p-8 max-w-2xl mx-auto">
        <p className="text-gray-500">Loading configuration…</p>
      </main>
    )
  }

  if (policyError || !pricingPolicy) {
    return (
      <main className="p-4 md:p-8 max-w-2xl mx-auto space-y-4">
        <p className="text-red-600">
          {policyError ?? 'Pricing policy is not available. Prices cannot be calculated.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => router.push('/gp-setup')}>
            Pricing Rules
          </Button>
          <Button variant="outline" onClick={() => router.push('/settings')}>
            Settings
          </Button>
          <Button
            onClick={handleLogout}
            variant="outline"
            className="text-red-600 border-red-400 hover:bg-red-50"
          >
            Logout
          </Button>
        </div>
      </main>
    )
  }

  if (servingSizesError || servingSizes === null) {
    return (
      <main className="p-4 md:p-8 max-w-2xl mx-auto space-y-4">
        <p className="text-red-600">
          {servingSizesError ?? 'Serving sizes could not be loaded. Pour prices are unavailable.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => router.push('/gp-setup')}>
            Pricing Rules
          </Button>
          <Button variant="outline" onClick={() => router.push('/settings')}>
            Settings
          </Button>
          <Button
            onClick={handleLogout}
            variant="outline"
            className="text-red-600 border-red-400 hover:bg-red-50"
          >
            Logout
          </Button>
        </div>
      </main>
    )
  }

  if (rulesError) {
    return (
      <main className="p-4 md:p-8 max-w-2xl mx-auto space-y-4">
        <p className="text-red-600">{rulesError}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => router.push('/gp-setup')}>
            Pricing Rules
          </Button>
          <Button variant="outline" onClick={() => router.push('/settings')}>
            Settings
          </Button>
          <Button
            onClick={handleLogout}
            variant="outline"
            className="text-red-600 border-red-400 hover:bg-red-50"
          >
            Logout
          </Button>
        </div>
      </main>
    )
  }

  return (
    <main className="p-4 md:p-8 max-w-2xl mx-auto">
      <div className="flex flex-wrap gap-2 justify-between mb-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled>
            Calculator
          </Button>
          <Button
            onClick={() => router.push('/gp-setup')}
            variant="outline"
            className="border-blue-400 text-blue-600 hover:bg-blue-50"
          >
            Pricing Rules
          </Button>
          <Button
            onClick={() => router.push('/settings')}
            variant="outline"
            className="border-blue-400 text-blue-600 hover:bg-blue-50"
          >
            Settings
          </Button>
        </div>

        <Button
          onClick={handleLogout}
          variant="outline"
          className="text-red-600 border-red-400 hover:bg-red-50"
        >
          Logout
        </Button>
      </div>

      <Card className="shadow-md">
        <CardContent className="space-y-8 py-8">
          <div className="space-y-4">
            <label className="block text-sm font-semibold text-gray-700">Cost Price (ex VAT):</label>
            <Input
              type="text"
              inputMode="decimal"
              className={costPriceError ? 'border-red-500' : ''}
              value={costPriceInput}
              onChange={(e) => {
                const rawValue = e.target.value
                const sanitized = sanitizeInput(rawValue, false)
                if (!validateInput(sanitized, false)) {
                  setCostPriceError('Please enter a non-negative number')
                } else {
                  setCostPriceError(null)
                }
                setCostPriceInput(sanitized)
              }}
              placeholder="Enter cost price"
            />
            {costPriceError && <p className="text-sm text-red-500 mt-1">{costPriceError}</p>}
          </div>

          <div className="space-y-4">
            <label className="block text-sm font-semibold text-gray-700">Wine Type:</label>
            <select
              value={wineType}
              onChange={(e) => setWineType(e.target.value as WineTypeValue)}
              className="w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {WINE_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-4">
            <label className="block text-sm font-semibold text-gray-700">Bottle Size:</label>
            <select
              value={bottleSize}
              onChange={(e) => setBottleSize(e.target.value)}
              className="w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="Half">Half Bottle (375ml)</option>
              <option value="Bottle">Bottle (750ml)</option>
              <option value="Magnum">Magnum (1500ml)</option>
              <option value="Other">Other</option>
            </select>

            {bottleSize === "Other" && (
              <Input
                type="text"
                inputMode="numeric"
                placeholder="Enter custom bottle size in ml (e.g., 3000)"
                value={customBottleSizeInput}
                onChange={(e) => setCustomBottleSizeInput(e.target.value)}
              />
            )}
          </div>

          <div className="flex">
            <Button
              variant={isBTG ? "default" : "outline"}
              onClick={() => setIsBTG(!isBTG)}
              className="w-full"
            >
              {isBTG ? "Selling By the Glass" : "Selling By the Bottle"}
            </Button>
          </div>

          <div className="flex flex-wrap gap-4 justify-center">
            <Button className="w-24" size="sm" onClick={() => handleNudge(-1)}>-1%</Button>
            <div className="font-semibold text-gray-700 self-center">GP: {formatGpDisplay(gp)}%</div>
            <Button className="w-24" size="sm" onClick={() => handleNudge(1)}>+1%</Button>
            <Button
              className="w-28"
              size="sm"
              variant="outline"
              onClick={() => {
                if (isValidGp(suggestedGp)) setGp(suggestedGp)
              }}
            >
              Reset GP
            </Button>
          </div>

          <div className="pt-6">
            <div className="border-t pt-4">
              <h2 className="text-lg font-bold text-gray-800 mb-2">Price Suggestions:</h2>

              {loading ? (
                <div className="text-center py-10 text-gray-500">Calculating prices...</div>
              ) : gpError ? (
                <div className="text-center py-10 text-red-600">{gpError}</div>
              ) : baseBottleMl === null || !Number.isFinite(costPrice) || costPrice < 0 || !isValidGp(gp) ? (
                <div className="text-center py-10 text-gray-500">
                  Enter a valid cost and bottle size to see prices.
                </div>
              ) : (
                <table className="w-full table-auto border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="border p-2 text-center">Size</th>
                      <th className="border p-2 text-center">Price (£)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const bottlePriced = priceWithGp({
                        actualCostExVat: costPrice,
                        bottleSizeMl: baseBottleMl,
                        gp,
                        pricingPolicy,
                        saleContext: { kind: 'bottle', applyBtgDiscount: isBTG },
                      })
                      const bottleDisplay = !bottlePriced.ok
                        ? '—'
                        : `£${bottlePriced.roundedSalePrice}`

                      const rows: ReactNode[] = [
                        <tr key="bottle" className="hover:bg-gray-100">
                          <td className="border p-2 text-center">{bottleLabel}</td>
                          <td className="border p-2 text-center">{bottleDisplay}</td>
                        </tr>,
                      ]

                      if (isBTG) {
                        for (const serving of enabledServings) {
                          const priced = priceWithGp({
                            actualCostExVat: costPrice,
                            bottleSizeMl: baseBottleMl,
                            gp,
                            pricingPolicy,
                            saleContext: { kind: 'pour', pourMl: serving.volumeMl },
                          })
                          const displayPrice = !priced.ok
                            ? '—'
                            : `£${priced.roundedSalePrice.toFixed(2)}`
                          rows.push(
                            <tr key={serving.id} className="hover:bg-gray-100">
                              <td className="border p-2 text-center">
                                {serving.label} · {serving.volumeMl}ml
                              </td>
                              <td className="border p-2 text-center">{displayPrice}</td>
                            </tr>
                          )
                        }
                      }

                      return rows
                    })()}
                  </tbody>
                </table>
              )}
              {!loading && !gpError && isBTG && baseBottleMl !== null && Number.isFinite(costPrice) && costPrice >= 0 && isValidGp(gp) && enabledServings.length === 0 && (
                <p className="text-sm text-gray-600 text-center mt-3">
                  No serving sizes are enabled for this wine type.
                </p>
              )}
            </div>
          </div>

        </CardContent>
      </Card>

      {showSetupModal && (
        <div className="fixed inset-0 bg-black bg-opacity-30 flex justify-center items-center">
          <div className="bg-white rounded-lg p-6 space-y-4 shadow-lg">
            <h2 className="text-xl font-bold text-gray-900">No GP Rules Found</h2>
            <p className="text-gray-700">You must create a rule set to continue.</p>
            <div className="flex justify-end gap-4 pt-4">
              <Button onClick={() => router.push("/gp-setup")}>Create Rules</Button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
