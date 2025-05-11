'use client'

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { sanitizeInput, validateInput } from '@/lib/gpRules'

interface BaseRule {
  type: 'less_than' | 'between' | 'greater_than' | 'all_gp'
}

interface LessThanRule extends BaseRule {
  type: 'less_than'
  max: number
  gp: number
}

interface GreaterThanRule extends BaseRule {
  type: 'greater_than'
  min: number
  gp: number
}

interface BetweenRule extends BaseRule {
  type: 'between'
  min: number
  max: number
  start_gp: number
  end_gp: number
}

interface AllGpRule extends BaseRule {
  type: 'all_gp'
  gp: number
}

type Rule = LessThanRule | GreaterThanRule | BetweenRule | AllGpRule

export default function Page() {
  const router = useRouter()

  const [costPriceInput, setCostPriceInput] = useState<string>("")
  const [wineType, setWineType] = useState<string>("Dry")
  const [isBTG, setIsBTG] = useState<boolean>(false)
  const [gp, setGp] = useState<number>(75)
  const [suggestedGp, setSuggestedGp] = useState<number>(75)
  const [loading, setLoading] = useState<boolean>(false)
  const [rules, setRules] = useState<Rule[]>([])
  const [loadingSession, setLoadingSession] = useState(true)
  const [showSetupModal, setShowSetupModal] = useState(false)
  const [costPriceError, setCostPriceError] = useState<string | null>(null)

  const VAT_RATE = 0.2

  const WINE_SIZES: Record<string, string[]> = {
    Dry: ["125", "175", "250", "500", "Bottle"],
    Sweet: ["75", "Bottle"],
    Sparkling: ["150", "Bottle"]
  }

  const availableSizes = WINE_SIZES[wineType] || []
  const costPrice = parseFloat(costPriceInput) || 0

  const [bottleSize, setBottleSize] = useState<string>("Bottle")
  const [customBottleSizeInput, setCustomBottleSizeInput] = useState<string>("")

  const baseBottleMl = bottleSize === "Half" ? 375
    : bottleSize === "Bottle" ? 750
    : bottleSize === "Magnum" ? 1500
    : parseInt(customBottleSizeInput) || 750

  const bottleLabel = bottleSize === "Other"
    ? `${customBottleSizeInput}ml`
    : bottleSize === "Half" ? "Half Bottle"
    : bottleSize === "Bottle" ? "Bottle"
    : "Magnum"

  function calculateGP(cost: number, isBTG: boolean, rules: Rule[]): number {
    if (!rules.length) return 70

    const allGpRule = rules.find(rule => rule.type === 'all_gp')
    if (allGpRule) return allGpRule.gp

    for (const rule of rules) {
      if (rule.type === 'less_than' && cost < rule.max) {
        return rule.gp
      }
      if (rule.type === 'greater_than' && cost > rule.min) {
        return rule.gp
      }
      if (rule.type === 'between' && cost >= rule.min && cost <= rule.max) {
        const proportion = (cost - rule.min) / (rule.max - rule.min)
        return rule.start_gp - proportion * (rule.start_gp - rule.end_gp)
      }
    }

    return 70
  }

  function calculatePrice(cost: number, gp: number): number {
    return (cost * (1 + VAT_RATE)) / (1 - gp / 100)
  }

  useEffect(() => {
    const fetchSettings = async () => {
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        router.push("/welcome")
        return
      }

      const user = session.user
      const { data, error } = await supabase
        .from('gp_settings')
        .select('*')
        .eq('user_id', user.id)
        .single()

      if (error || !data || !data.rules || data.rules.length === 0) {
        setShowSetupModal(true)
      } else {
        setRules(data.rules)
      }

      setLoadingSession(false)
    }

    fetchSettings()
  }, [router])

  useEffect(() => {
    setLoading(true)
    const timeout = setTimeout(() => {
      const suggested = calculateGP(costPrice, isBTG, rules)
      setSuggestedGp(Math.round(suggested))
      setGp(Math.round(suggested))
      setLoading(false)
    }, 200)

    return () => clearTimeout(timeout)
  }, [costPrice, isBTG, rules])

  const handleNudge = (delta: number) => {
    setGp(prev => Math.min(100, Math.max(1, prev + delta)))
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push("/welcome")
  }

  if (loadingSession) {
    return null
  }

  return (
    <main className="p-4 md:p-8 max-w-2xl mx-auto">
      <div className="flex justify-between mb-4">
        <Button
          onClick={() => router.push('/gp-setup')}
          variant="outline"
          className="border-blue-400 text-blue-600 hover:bg-blue-50"
        >
          Edit GP Rules
        </Button>

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
          {/* INPUT FIELDS */}
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
              onChange={(e) => setWineType(e.target.value)}
              className="w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="Dry">Dry</option>
              <option value="Sweet">Sweet/Fortified</option>
              <option value="Sparkling">Sparkling</option>
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
            <div className="font-semibold text-gray-700 self-center">GP: {gp}%</div>
            <Button className="w-24" size="sm" onClick={() => handleNudge(1)}>+1%</Button>
            <Button className="w-28" size="sm" variant="outline" onClick={() => setGp(suggestedGp)}>
              Reset GP
            </Button>
          </div>

          <div className="pt-6">
            <div className="border-t pt-4">
              <h2 className="text-lg font-bold text-gray-800 mb-2">Price Suggestions:</h2>

              {loading ? (
                <div className="text-center py-10 text-gray-500">Calculating prices...</div>
              ) : (
                <table className="w-full table-auto border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="border p-2 text-center">Size</th>
                      <th className="border p-2 text-center">Price (£)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {availableSizes
                      .filter(size => {
                        if (!isBTG) return size === "Bottle"
                        return true
                      })
                      .map((size) => {
                        const ml = size === "Bottle" ? baseBottleMl : parseInt(size)
                        let basePrice = calculatePrice(costPrice, gp)

                        if (isBTG && size === "Bottle") {
                          basePrice = basePrice * 0.95
                        }

                        let price = (basePrice / baseBottleMl) * ml
                        let displayPrice: string

                        if (size === "Bottle") {
                          // Round to nearest pound
                          price = Math.round(price)
                          displayPrice = `£${price}`
                        } else {
                          // Round to nearest 50p
                          price = Math.round(price * 2) / 2
                          displayPrice = `£${price.toFixed(2)}`
                        }

                        return (
                          <tr key={size} className="hover:bg-gray-100">
                            <td className="border p-2 text-center">{size === "Bottle" ? bottleLabel : `${size}ml`}</td>
                            <td className="border p-2 text-center">{displayPrice}</td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
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
