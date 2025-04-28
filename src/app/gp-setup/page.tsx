'use client'

import { useState } from "react"
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
    const confirmed = window.confirm("Are you sure you want to delete this rule?")
    if (!confirmed) return

    const updated = [...rules]
    updated.splice(index, 1)
    setRules(updated)
  }

  const addRule = (type: Rule['type']) => {
    if (type === 'all_gp') {
      if (rules.length > 0) return
    }
    if (rules.find(r => r.type === 'all_gp')) return

    if (type === 'less_than' && rules.find(r => r.type === 'less_than')) return
    if (type === 'greater_than' && rules.find(r => r.type === 'greater_than')) return

    const newRule: Rule =
      type === 'less_than'
        ? { type: 'less_than', max: 0, gp: 0 }
        : type === 'greater_than'
          ? { type: 'greater_than', min: 0, gp: 0 }
          : type === 'between'
            ? { type: 'between', min: 0, max: 0, start_gp: 0, end_gp: 0 }
            : { type: 'all_gp', gp: 70 }

    setRules([...rules, newRule])
  }

  const validateRules = () => {
    const sorted = [...rules].sort((a, b) => {
      if (a.type === 'less_than' && b.type === 'between') return (a as LessThanRule).max - (b as BetweenRule).min
      if (a.type === 'between' && b.type === 'between') return (a as BetweenRule).min - (b as BetweenRule).min
      if (a.type === 'between' && b.type === 'greater_than') return (a as BetweenRule).max - (b as GreaterThanRule).min
      if (a.type === 'less_than' && b.type === 'greater_than') return (a as LessThanRule).max - (b as GreaterThanRule).min
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
        (current as LessThanRule | BetweenRule).max > (next as BetweenRule | GreaterThanRule).min
      ) {
        return false
      }
    }
    return true
  }

  const saveRules = async () => {
    setSaving(true)
    setSuccess(false)
    setError(null)

    if (!validateRules()) {
      setError("Validation failed: overlapping or invalid ranges.")
      setSaving(false)
      return
    }

    const { data: { session } } = await supabase.auth.getSession()

    if (!session) {
      setError("Not logged in.")
      setSaving(false)
      return
    }

    const user = session.user

    const { data: existing, error: fetchError } = await supabase
      .from('gp_settings')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (fetchError || !existing) {
      const { error: insertError } = await supabase
        .from('gp_settings')
        .insert([{ user_id: user.id, rules }])

      if (insertError) {
        setError(insertError.message)
        setSaving(false)
        return
      }
    } else {
      const { error: updateError } = await supabase
        .from('gp_settings')
        .update({ rules })
        .eq('user_id', user.id)

      if (updateError) {
        setError(updateError.message)
        setSaving(false)
        return
      }
    }

    setSaving(false)
    setSuccess(true)
    router.push("/")
  }

  const sortedRules = [...rules].sort((a, b) => {
    if (a.type === 'less_than' && b.type === 'between') return (a as LessThanRule).max - (b as BetweenRule).min
    if (a.type === 'between' && b.type === 'between') return (a as BetweenRule).min - (b as BetweenRule).min
    if (a.type === 'between' && b.type === 'greater_than') return (a as BetweenRule).max - (b as GreaterThanRule).min
    if (a.type === 'less_than' && b.type === 'greater_than') return (a as LessThanRule).max - (b as GreaterThanRule).min
    return 0
  })

  return (
    <main className="p-6 max-w-2xl mx-auto flex flex-col justify-center min-h-screen">
      <Card className="shadow-md">
        <CardContent className="space-y-6 py-8">
          <h1 className="text-2xl font-bold text-center">Setup Your GP Rules</h1>

          {/* Display Rules */}
          {sortedRules.map((rule, index) => (
            <div key={index} className="p-4 mb-4 border rounded-md space-y-2">
              {editingIndex === index ? (
                <div className="space-y-2">
                  {/* Editable Forms */}
                  {rule.type === 'less_than' && (
                    <>
                      <p>If cost is less than:</p>
                      <Input
                        type="number"
                        placeholder="Max £"
                        value={(tempRule as LessThanRule)?.max || ''}
                        onChange={(e) => setTempRule({ ...(tempRule as LessThanRule), max: parseFloat(e.target.value) })}
                      />
                      <p>Then GP is:</p>
                      <Input
                        type="number"
                        placeholder="GP %"
                        value={(tempRule as LessThanRule)?.gp || ''}
                        onChange={(e) => setTempRule({ ...(tempRule as LessThanRule), gp: parseFloat(e.target.value) })}
                      />
                    </>
                  )}
                  {rule.type === 'between' && (
                    <>
                      <p>If cost is between:</p>
                      <Input
                        type="number"
                        placeholder="Min £"
                        value={(tempRule as BetweenRule)?.min || ''}
                        onChange={(e) => setTempRule({ ...(tempRule as BetweenRule), min: parseFloat(e.target.value) })}
                      />
                      <p>and</p>
                      <Input
                        type="number"
                        placeholder="Max £"
                        value={(tempRule as BetweenRule)?.max || ''}
                        onChange={(e) => setTempRule({ ...(tempRule as BetweenRule), max: parseFloat(e.target.value) })}
                      />
                      <p>GP scales from</p>
                      <Input
                        type="number"
                        placeholder="Start GP%"
                        value={(tempRule as BetweenRule)?.start_gp || ''}
                        onChange={(e) => setTempRule({ ...(tempRule as BetweenRule), start_gp: parseFloat(e.target.value) })}
                      />
                      <p>to</p>
                      <Input
                        type="number"
                        placeholder="End GP%"
                        value={(tempRule as BetweenRule)?.end_gp || ''}
                        onChange={(e) => setTempRule({ ...(tempRule as BetweenRule), end_gp: parseFloat(e.target.value) })}
                      />
                    </>
                  )}
                  {rule.type === 'greater_than' && (
                    <>
                      <p>If cost is greater than:</p>
                      <Input
                        type="number"
                        placeholder="Min £"
                        value={(tempRule as GreaterThanRule)?.min || ''}
                        onChange={(e) => setTempRule({ ...(tempRule as GreaterThanRule), min: parseFloat(e.target.value) })}
                      />
                      <p>Then GP is:</p>
                      <Input
                        type="number"
                        placeholder="GP %"
                        value={(tempRule as GreaterThanRule)?.gp || ''}
                        onChange={(e) => setTempRule({ ...(tempRule as GreaterThanRule), gp: parseFloat(e.target.value) })}
                      />
                    </>
                  )}
                  {rule.type === 'all_gp' && (
                    <>
                      <p>Universal GP % for all cost prices:</p>
                      <Input
                        type="number"
                        placeholder="GP %"
                        value={(tempRule as AllGpRule)?.gp || ''}
                        onChange={(e) => setTempRule({ ...(tempRule as AllGpRule), gp: parseFloat(e.target.value) })}
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
                  {rule.type === 'less_than' && (
                    <p>If cost is less than £{rule.max} ➔ GP: {rule.gp}%</p>
                  )}
                  {rule.type === 'between' && (
                    <p>If cost is between £{rule.min} and £{rule.max} ➔ GP scales {rule.start_gp}% ➔ {rule.end_gp}%</p>
                  )}
                  {rule.type === 'greater_than' && (
                    <p>If cost is greater than £{rule.min} ➔ GP: {rule.gp}%</p>
                  )}
                  {rule.type === 'all_gp' && (
                    <p>Universal GP: {rule.gp}%</p>
                  )}
                  <div className="flex gap-2 pt-2">
                    <Button size="sm" onClick={() => startEditing(index)}>Edit</Button>
                    <Button size="sm" variant="outline" onClick={() => deleteRule(index)}>Delete</Button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Section Buttons */}
          <div className="space-y-4">
            {!rules.length && (
              <div className="flex flex-col gap-2">
                <h2 className="font-bold text-gray-800">Apply Universal Rule</h2>
                <Button variant="outline" onClick={() => addRule('all_gp')}>+ Add Universal Rule (Fixed GP%)</Button>
              </div>
            )}
            {!rules.some(r => r.type === 'all_gp') && (
              <div className="flex flex-col gap-2">
                <h2 className="font-bold text-gray-800 pt-4">Apply Custom Rules</h2>
                <Button variant="outline" onClick={() => addRule('less_than')}>+ Add Less Than Rule</Button>
                <Button variant="outline" onClick={() => addRule('between')}>+ Add Between Rule</Button>
                <Button variant="outline" onClick={() => addRule('greater_than')}>+ Add Greater Than Rule</Button>
              </div>
            )}
          </div>

          <div className="pt-4 space-y-2">
            <Button onClick={saveRules} disabled={saving} className="w-full">
              {saving ? "Saving..." : "Save All Rules"}
            </Button>
            {error && <p className="text-red-500 text-center pt-2">{error}</p>}
            {success && <p className="text-green-600 text-center pt-2">Saved successfully!</p>}
          </div>

        </CardContent>
      </Card>
    </main>
  )
}
