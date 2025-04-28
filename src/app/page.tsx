'use client'

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"

const VAT_RATE = 0.2

const WINE_SIZES: Record<string, string[]> = {
  Dry: ["125", "175", "250", "500", "Bottle"],
  Sweet: ["75", "Bottle"],
  Sparkling: ["150", "Bottle"]
}

function calculateGP(cost: number, isBTG: boolean): number {
  if (isBTG) {
    if (cost < 20) return 75
    if (cost < 50) return 75 - ((cost - 20) / 30) * (75 - 68)
    return 68
  } else {
    if (cost < 13) return 75
    if (cost < 20) return 75 - ((cost - 13) / 7) * (75 - 72)
    if (cost < 50) return 72 - ((cost - 20) / 30) * (72 - 65)
    if (cost < 75) return 65 - ((cost - 50) / 25) * (65 - 58)
    if (cost < 100) return 58 - ((cost - 75) / 25) * (58 - 50)
    return 50
  }
}

function calculatePrice(cost: number, gp: number): number {
  return (cost * (1 + VAT_RATE)) / (1 - gp / 100)
}

export default function Page() {
  const [costPriceInput, setCostPriceInput] = useState<string>("")
  const [wineType, setWineType] = useState<string>("Dry")
  const [isBTG, setIsBTG] = useState<boolean>(false)
  const [gp, setGp] = useState<number>(75)
  const [suggestedGp, setSuggestedGp] = useState<number>(75)
  const [loading, setLoading] = useState<boolean>(false)

  // New states for Bottle Size
  const [bottleSize, setBottleSize] = useState<string>("Bottle")
  const [customBottleSizeInput, setCustomBottleSizeInput] = useState<string>("")

  const availableSizes = WINE_SIZES[wineType] || []
  const costPrice = parseFloat(costPriceInput) || 0

  // Calculate Base Bottle Volume
  const baseBottleMl = bottleSize === "Half" ? 375
    : bottleSize === "Bottle" ? 750
    : bottleSize === "Magnum" ? 1500
    : parseInt(customBottleSizeInput) || 750

  const bottleLabel = bottleSize === "Other"
    ? `${customBottleSizeInput}ml`
    : bottleSize === "Half" ? "Half Bottle"
    : bottleSize === "Bottle" ? "Bottle"
    : "Magnum"

  useEffect(() => {
    setLoading(true)
    const timeout = setTimeout(() => {
      const suggested = calculateGP(costPrice, isBTG)
      setSuggestedGp(Math.round(suggested))
      setGp(Math.round(suggested))
      setLoading(false)
    }, 200)

    return () => clearTimeout(timeout)
  }, [costPrice, isBTG])

  const handleNudge = (delta: number) => {
    setGp(prev => Math.min(100, Math.max(1, prev + delta)))
  }

  return (
    <main className="p-4 md:p-8 max-w-2xl mx-auto">
      <Card className="shadow-md">
        <CardContent className="space-y-8 py-8">
          <div className="space-y-4">
            <label className="block text-sm font-semibold text-gray-700">Cost Price (ex VAT):</label>
            <Input
              type="text"
              inputMode="decimal"
              value={costPriceInput}
              onChange={(e) => setCostPriceInput(e.target.value)}
              placeholder="Enter cost price"
            />
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

                        const price = ((basePrice / baseBottleMl) * ml).toFixed(2)

                        return (
                          <tr key={size} className="hover:bg-gray-100">
                            <td className="border p-2 text-center">{size === "Bottle" ? bottleLabel : `${size}ml`}</td>
                            <td className="border p-2 text-center">£{price}</td>
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
    </main>
  )
}
