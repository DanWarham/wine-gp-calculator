'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'

interface LessThanRule {
  type: 'less_than'
  max: number
  gp: number
}

interface GreaterThanRule {
  type: 'greater_than'
  min: number
  gp: number
}

interface BetweenRule {
  type: 'between'
  min: number
  max: number
  start_gp: number
  end_gp: number
}

export default function CustomRuleSetupPage() {
  const router = useRouter()

  const [lessThan, setLessThan] = useState<LessThanRule>({ type: 'less_than', max: 0, gp: 0 })
  const [greaterThan, setGreaterThan] = useState<GreaterThanRule>({ type: 'greater_than', min: 0, gp: 0 })
  const [betweenRules, setBetweenRules] = useState<BetweenRule[]>([])
  const [currentStep, setCurrentStep] = useState<'less_than' | 'greater_than' | 'between'>('less_than')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const safeParse = (value: string) => {
    const parsed = parseFloat(value)
    return isNaN(parsed) ? 0 : parsed
  }

  useEffect(() => {
    if (currentStep === 'between' && betweenRules.length === 0) {
      setBetweenRules([
        {
          type: 'between',
          min: lessThan.max,
          max: greaterThan.min,
          start_gp: lessThan.gp,
          end_gp: greaterThan.gp
        }
      ])
    }
  }, [currentStep, lessThan, greaterThan, betweenRules.length])

  const addBetweenRule = () => {
    const lastMax = betweenRules.length ? betweenRules[betweenRules.length - 1].max : lessThan.max
    setBetweenRules(prev => [
      ...prev,
      { type: 'between', min: lastMax, max: lastMax, start_gp: 0, end_gp: 0 }
    ])
  }

  const handleSave = async () => {
    setError(null)

    if (lessThan.max >= greaterThan.min) {
      setError('Less than price must be lower than greater than price.')
      return
    }

    const rulesToValidate = [...betweenRules]

    if (rulesToValidate.length === 0) {
      rulesToValidate.push({
        type: 'between',
        min: lessThan.max,
        max: greaterThan.min,
        start_gp: lessThan.gp,
        end_gp: greaterThan.gp
      })
    }

    const fullRules = [lessThan, ...rulesToValidate, greaterThan]

    const sorted = fullRules
      .filter(rule => rule.type !== 'less_than')
      .sort((a, b) => {
        const aMin = a.type === 'between' ? a.min : (a.type === 'greater_than' ? a.min : 0)
        const bMin = b.type === 'between' ? b.min : (b.type === 'greater_than' ? b.min : 0)
        return aMin - bMin
      })

    let expectedMin = lessThan.max

    for (const rule of sorted) {
      const ruleMin = rule.type === 'between' ? rule.min : (rule.type === 'greater_than' ? rule.min : 0)
      if (ruleMin !== expectedMin) {
        setError(`Gap detected between £${expectedMin} and £${ruleMin}. Please fix it.`)
        return
      }
      expectedMin = rule.type === 'between' ? rule.max : expectedMin
    }

    if (expectedMin !== greaterThan.min) {
      setError('Final gap does not match greater than minimum price. Please fix.')
      return
    }

    setSaving(true)

    const { data: { session } } = await supabase.auth.getSession()

    if (!session) {
      setError('Not logged in.')
      setSaving(false)
      return
    }

    const { error: upsertError } = await supabase
      .from('gp_settings')
      .upsert({ user_id: session.user.id, rules: fullRules }, { onConflict: 'user_id' })

    if (upsertError) {
      setError(upsertError.message)
      setSaving(false)
      return
    }

    setSaving(false)
    router.push('/')
  }

  return (
    <main className="p-6 max-w-xl mx-auto flex flex-col justify-center min-h-screen">
      <Card className="shadow-md">
        <CardContent className="space-y-8 py-8">
          <h1 className="text-2xl font-bold text-center mb-6">Custom GP Rule Setup</h1>
          {error && <p className="text-red-600 text-center">{error}</p>}

          {currentStep === 'less_than' && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Define Less Than Rule</h2>
              <Input
                type="number"
                placeholder="Max Price (£)"
                value={typeof lessThan.max === 'number' ? lessThan.max : ''}
                onChange={(e) => setLessThan({ ...lessThan, max: safeParse(e.target.value) })}
              />
              <Input
                type="number"
                placeholder="GP %"
                value={typeof lessThan.gp === 'number' ? lessThan.gp : ''}
                onChange={(e) => setLessThan({ ...lessThan, gp: safeParse(e.target.value) })}
              />
              <Button className="w-full" onClick={() => setCurrentStep('greater_than')}>
                Next: Greater Than Rule
              </Button>
            </div>
          )}

          {currentStep === 'greater_than' && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Define Greater Than Rule</h2>
              <Input
                type="number"
                placeholder="Min Price (£)"
                value={typeof greaterThan.min === 'number' ? greaterThan.min : ''}
                onChange={(e) => setGreaterThan({ ...greaterThan, min: safeParse(e.target.value) })}
              />
              <Input
                type="number"
                placeholder="GP %"
                value={typeof greaterThan.gp === 'number' ? greaterThan.gp : ''}
                onChange={(e) => setGreaterThan({ ...greaterThan, gp: safeParse(e.target.value) })}
              />
              <Button className="w-full" onClick={() => setCurrentStep('between')}>
                Next: Between Rules
              </Button>
            </div>
          )}

          {currentStep === 'between' && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold">Define Between Rules</h2>
              {betweenRules.map((rule, idx) => (
                <div key={idx} className="p-4 border rounded-md space-y-2">
                  <Input
                    type="number"
                    placeholder="Min £"
                    value={typeof rule.min === 'number' ? rule.min : ''}
                    onChange={(e) => {
                      const updated = [...betweenRules]
                      updated[idx].min = safeParse(e.target.value)
                      setBetweenRules(updated)
                    }}
                  />
                  <Input
                    type="number"
                    placeholder="Max £"
                    value={typeof rule.max === 'number' ? rule.max : ''}
                    onChange={(e) => {
                      const updated = [...betweenRules]
                      updated[idx].max = safeParse(e.target.value)
                      setBetweenRules(updated)
                    }}
                  />
                  <Input
                    type="number"
                    placeholder="Start GP%"
                    value={typeof rule.start_gp === 'number' ? rule.start_gp : ''}
                    onChange={(e) => {
                      const updated = [...betweenRules]
                      updated[idx].start_gp = safeParse(e.target.value)
                      setBetweenRules(updated)
                    }}
                  />
                  <Input
                    type="number"
                    placeholder="End GP%"
                    value={typeof rule.end_gp === 'number' ? rule.end_gp : ''}
                    onChange={(e) => {
                      const updated = [...betweenRules]
                      updated[idx].end_gp = safeParse(e.target.value)
                      setBetweenRules(updated)
                    }}
                  />
                </div>
              ))}
              <Button variant="outline" className="w-full" onClick={addBetweenRule}>
                + Add Another Between Rule
              </Button>
              <Button className="w-full" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save Final Rule Set'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
