'use client'

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Toggle } from "@/components/ui/toggle"

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
  const [debug, setDebug] = useState<boolean>(false)
  const [gp, setGp] = useState<number>(75)
  const [suggestedGp, setSuggestedGp] = useState<number>(75)

  const availableSizes = debug
    ? ["75", "125", "150", "175", "250", "375", "500", "Bottle"]
    : WINE_SIZES[wineType] || []

  const costPrice = parseFloat(costPriceInput) || 0

  useEffect(() => {
    const suggested = calculateGP(costPrice, isBTG)
    setSuggestedGp(Math.round(suggested))
    setGp(Math.round(suggested))
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

          <div className="flex items-center justify-between">
            <label className="text-sm font-semibold text-gray-700">By the Glass?</label>
            <Toggle pressed={isBTG} onPressedChange={() => setIsBTG(!isBTG)}>
              Toggle
            </Toggle>
          </div>

          <div className="flex items-center justify-between">
            <label className="text-sm font-semibold text-gray-700">Debug Show All Sizes</label>
            <Toggle pressed={debug} onPressedChange={() => setDebug(!debug)}>
              Toggle
            </Toggle>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <Button size="sm" onClick={() => handleNudge(-1)}>-1%</Button>
            <div className="font-semibold text-gray-700">GP: {gp}%</div>
            <Button size="sm" onClick={() => handleNudge(1)}>+1%</Button>
            <Button size="sm" variant="outline" onClick={() => setGp(suggestedGp)}>
              Reset GP
            </Button>
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-bold text-gray-800">Price Suggestions:</h2>
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
                    if (debug) return true
                    if (!isBTG) return size === "Bottle"
                    return true
                  })
                  .map((size) => {
                    const ml = size === "Bottle" ? 750 : parseInt(size)
                    let basePrice = calculatePrice(costPrice, gp)

                    if (isBTG && size === "Bottle") {
                      basePrice = basePrice * 0.95
                    }

                    const price = ((basePrice / 750) * ml).toFixed(2)

                    return (
                      <tr key={size} className="hover:bg-gray-100">
                        <td className="border p-2 text-center">{size === "Bottle" ? "Bottle" : `${size}ml`}</td>
                        <td className="border p-2 text-center">£{price}</td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
