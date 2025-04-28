'use client'

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"

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

export default function GPSetupPage() {
  const router = useRouter()

  const [rules, setRules] = useState<Rule[]>([])
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [tempRule, setTempRule] = useState<Partial<Rule> | null>(null)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingRules, setLoadingRules] = useState(true)

  useEffect(() => {
    const fetchRules = async () => {
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        router.push('/welcome')
        return
      }

      const { data, error } = await supabase
        .from('gp_settings')
        .select('rules')
        .eq('user_id', session.user.id)
        .single()

      if (error || !data) {
        setRules([])
      } else {
        setRules(data.rules || [])
      }

      setLoadingRules(false)
    }

    fetchRules()
  }, [router])

  const startEditing = (index: number) => {
    setEditingIndex(index)
    setTempRule({ ...rules[index] })
  }

  const cancelEditing = () => {
    setEditingIndex(null)
    setTempRule(null)
  }

  const saveEdit = () => {
    if (tempRule) {
      const updated = [...rules]
      updated[editingIndex!] = tempRule as Rule
      setRules(updated)
      setEditingIndex(null)
      setTempRule(null)
    }
  }

  const deleteRule = (index: number) => {
    if (!confirm("Are you sure you want to delete this rule?")) return
    const updated = [...rules]
    updated.splice(index, 1)
    setRules(updated)
  }

  const addRule = (type: Rule['type']) => {
    if (type === 'all_gp' && rules.length > 0) return
    if (rules.find(r => r.type === 'all_gp')) return
    if (type === 'less_than' && rules.find(r => r.type === 'less_than')) return
    if (type === 'greater_than' && rules.find(r => r.type === 'greater_than')) return

    const newRule: Rule =
      type === 'less_than' ? { type: 'less_than', max: 0, gp: 0 } :
      type === 'greater_than' ? { type: 'greater_than', min: 0, gp: 0 } :
      type === 'between' ? { type: 'between', min: 0, max: 0, start_gp: 0, end_gp: 0 } :
      { type: 'all_gp', gp: 70 }

    setRules([...rules, newRule])
  }

  const validateRules = () => {
    if (!rules.length) {
      setError("You must have at least one rule.")
      return false
    }

    const sorted = [...rules].sort((a, b) => {
      if (a.type === 'less_than' && b.type === 'between') return a.max - b.min
      if (a.type === 'between' && b.type === 'between') return a.min - b.min
      if (a.type === 'between' && b.type === 'greater_than') return a.max - b.min
      if (a.type === 'less_than' && b.type === 'greater_than') return a.max - b.min
      return 0
    })

    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i]
      const next = sorted[i + 1]
      if (
        current.type !== 'greater_than' &&
        next.type !== 'less_than' &&
        'max' in current &&
        'min' in next &&
        (current as any).max > (next as any).min
      ) {
        setError("Validation failed: overlapping or invalid ranges.")
        return false
      }
    }

    return true
  }

  const saveRules = async () => {
    if (!validateRules()) return

    setSaving(true)
    setSuccess(false)
    setError(null)

    const { data: { session } } = await supabase.auth.getSession()

    if (!session) {
      setError("Not logged in.")
      setSaving(false)
      return
    }

    const { data: existing, error: fetchError } = await supabase
      .from('gp_settings')
      .select('id')
      .eq('user_id', session.user.id)
      .single()

    if (fetchError || !existing) {
      const { error: insertError } = await supabase
        .from('gp_settings')
        .insert([{ user_id: session.user.id, rules }])

      if (insertError) {
        setError(insertError.message)
        setSaving(false)
        return
      }
    } else {
      const { error: updateError } = await supabase
        .from('gp_settings')
        .update({ rules })
        .eq('user_id', session.user.id)

      if (updateError) {
        setError(updateError.message)
        setSaving(false)
        return
      }
    }

    setSaving(false)
    setSuccess(true)
    setTimeout(() => router.push('/'), 1000)
  }

  if (loadingRules) return null

  return (
    <main className="p-6 max-w-2xl mx-auto flex flex-col justify-center min-h-screen">
      <Card className="shadow-md">
        <CardContent className="space-y-8 py-8">
          <h1 className="text-2xl font-bold text-center mb-6">Setup Your GP Rules</h1>

          {success && <p className="text-green-600 text-center">✅ Rules saved successfully!</p>}
          {error && <p className="text-red-600 text-center">{error}</p>}

          {rules.map((rule, index) => (
            <div
              key={index}
              className={`p-4 mb-4 border rounded-md space-y-2 transition ${editingIndex === index ? 'bg-blue-50' : 'bg-white'}`}
            >
              {editingIndex === index ? (
                <div className="space-y-2">
                  {rule.type === 'less_than' && (
                    <>
                      <p>If cost is less than:</p>
                      <Input
                        type="number"
                        placeholder="Max £"
                        value={String((tempRule as LessThanRule)?.max ?? '')}
                        onChange={(e) => setTempRule({ ...(tempRule as LessThanRule), max: parseFloat(e.target.value.trim()) })}
                      />
                      <p>Then GP is:</p>
                      <Input
                        type="number"
                        placeholder="GP %"
                        value={String((tempRule as LessThanRule)?.gp ?? '')}
                        onChange={(e) => setTempRule({ ...(tempRule as LessThanRule), gp: parseFloat(e.target.value.trim()) })}
                      />
                    </>
                  )}

                  {rule.type === 'between' && (
                    <>
                      <p>If cost is between:</p>
                      <Input
                        type="number"
                        placeholder="Min £"
                        value={String((tempRule as BetweenRule)?.min ?? '')}
                        onChange={(e) => setTempRule({ ...(tempRule as BetweenRule), min: parseFloat(e.target.value.trim()) })}
                      />
                      <p>and</p>
                      <Input
                        type="number"
                        placeholder="Max £"
                        value={String((tempRule as BetweenRule)?.max ?? '')}
                        onChange={(e) => setTempRule({ ...(tempRule as BetweenRule), max: parseFloat(e.target.value.trim()) })}
                      />
                      <p>GP scales from:</p>
                      <Input
                        type="number"
                        placeholder="Start GP%"
                        value={String((tempRule as BetweenRule)?.start_gp ?? '')}
                        onChange={(e) => setTempRule({ ...(tempRule as BetweenRule), start_gp: parseFloat(e.target.value.trim()) })}
                      />
                      <p>to</p>
                      <Input
                        type="number"
                        placeholder="End GP%"
                        value={String((tempRule as BetweenRule)?.end_gp ?? '')}
                        onChange={(e) => setTempRule({ ...(tempRule as BetweenRule), end_gp: parseFloat(e.target.value.trim()) })}
                      />
                    </>
                  )}

                  {rule.type === 'greater_than' && (
                    <>
                      <p>If cost is greater than:</p>
                      <Input
                        type="number"
                        placeholder="Min £"
                        value={String((tempRule as GreaterThanRule)?.min ?? '')}
                        onChange={(e) => setTempRule({ ...(tempRule as GreaterThanRule), min: parseFloat(e.target.value.trim()) })}
                      />
                      <p>Then GP is:</p>
                      <Input
                        type="number"
                        placeholder="GP %"
                        value={String((tempRule as GreaterThanRule)?.gp ?? '')}
                        onChange={(e) => setTempRule({ ...(tempRule as GreaterThanRule), gp: parseFloat(e.target.value.trim()) })}
                      />
                    </>
                  )}

                  {rule.type === 'all_gp' && (
                    <>
                      <p>Universal GP % for all wines:</p>
                      <Input
                        type="number"
                        placeholder="GP %"
                        value={String((tempRule as AllGpRule)?.gp ?? '')}
                        onChange={(e) => setTempRule({ ...(tempRule as AllGpRule), gp: parseFloat(e.target.value.trim()) })}
                      />
                    </>
                  )}

                  <div className="flex gap-2 pt-4">
                    <Button onClick={saveEdit}>Save</Button>
                    <Button variant="outline" onClick={cancelEditing}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {rule.type === 'less_than' && <p>If cost is less than £{rule.max} ➔ GP: {rule.gp}%</p>}
                  {rule.type === 'between' && <p>If cost is between £{rule.min} and £{rule.max} ➔ GP scales {rule.start_gp}% ➔ {rule.end_gp}%</p>}
                  {rule.type === 'greater_than' && <p>If cost is greater than £{rule.min} ➔ GP: {rule.gp}%</p>}
                  {rule.type === 'all_gp' && <p>Universal GP: {rule.gp}%</p>}
                  <div className="flex gap-2 pt-2">
                    <Button size="sm" onClick={() => startEditing(index)}>Edit</Button>
                    <Button size="sm" variant="outline" onClick={() => deleteRule(index)}>Delete</Button>
                  </div>
                </div>
              )}
            </div>
          ))}

          <div className="space-y-6 pt-8">
            {!rules.length && (
              <div className="flex flex-col gap-2">
                <h2 className="text-lg font-bold">Apply Universal Rule</h2>
                <Button variant="outline" onClick={() => addRule('all_gp')}>+ Add Universal GP Rule</Button>
              </div>
            )}
            {!rules.some(r => r.type === 'all_gp') && (
              <div className="flex flex-col gap-2">
                <h2 className="text-lg font-bold pt-6">Apply Custom Rules</h2>
                <Button variant="outline" onClick={() => addRule('less_than')}>+ Add Less Than Rule</Button>
                <Button variant="outline" onClick={() => addRule('between')}>+ Add Between Rule</Button>
                <Button variant="outline" onClick={() => addRule('greater_than')}>+ Add Greater Than Rule</Button>
              </div>
            )}
          </div>

          <div className="pt-8 space-y-2">
            <Button onClick={saveRules} disabled={saving} className="w-full">
              {saving ? "Saving..." : "Save All Rules"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
