'use client'

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import AllGpRuleForm from '@/components/rules/AllGpRuleForm'
import GreaterThanRuleForm from '@/components/rules/GreaterThanRuleForm'
import LessThanRuleForm from '@/components/rules/LessThanRuleForm'
import BetweenRuleForm from '@/components/rules/BetweenRuleForm'
import { Dialog } from '@headlessui/react'

import {
  Rule,
  LessThanRule,
  GreaterThanRule,
  BetweenRule,
  AllGpRule
} from '@/types/rules'

export default function GPSetupPage() {
  const router = useRouter()

  const [rules, setRules] = useState<Rule[]>([])
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [tempRule, setTempRule] = useState<Partial<Rule> | null>(null)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingRules, setLoadingRules] = useState(true)
  const [formHasError, setFormHasError] = useState(false)
  const [gapModalOpen, setGapModalOpen] = useState(false)
  const [gaps, setGaps] = useState<{ min: number, max: number }[]>([])

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

  // Helper to detect overlapping rules
  function findOverlappingRules(rules: Rule[]): { i: number, j: number, a: Rule, b: Rule } | null {
    // Only consider less_than, between, greater_than
    const relevant = rules.filter(r => r.type !== 'all_gp')
    // Sort by min (for less_than, min is 0; for greater_than, max is Infinity)
    const getMin = (r: Rule) => r.type === 'less_than' ? 0 : r.type === 'greater_than' ? (r as GreaterThanRule).min : (r as BetweenRule).min
    const getMax = (r: Rule) => r.type === 'less_than' ? (r as LessThanRule).max : r.type === 'greater_than' ? Infinity : (r as BetweenRule).max
    const sorted = relevant.slice().sort((a, b) => getMin(a) - getMin(b))
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i]
      const aMin = getMin(a)
      const aMax = getMax(a)
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j]
        const bMin = getMin(b)
        const bMax = getMax(b)
        // Overlap if ranges intersect (not just touch)
        if (aMax > bMin && aMin < bMax) {
          return { i, j, a, b }
        }
      }
    }
    return null
  }

  // Modified saveEdit to check for overlaps
  const saveEdit = () => {
    if (!tempRule) return
    const ruleToSave = { ...tempRule } as Rule
    const updated = [...rules]
    updated[editingIndex!] = ruleToSave
    // Check for overlaps
    const overlap = findOverlappingRules(updated)
    if (overlap) {
      setError(`Rule for £${'min' in overlap.a ? overlap.a.min : 0}–£${'max' in overlap.a ? overlap.a.max : '∞'} overlaps with rule for £${'min' in overlap.b ? overlap.b.min : 0}–£${'max' in overlap.b ? overlap.b.max : '∞'}`)
      return
    }
    setRules(updated)
    setEditingIndex(null)
    setTempRule(null)

    if ((ruleToSave as Rule).type === 'less_than' && !rules.some(r => r.type === 'greater_than')) {
      const newGreater: GreaterThanRule = { type: 'greater_than', min: 0, gp: 0 }
      setRules(current => {
        const updated = [...current, newGreater]
        setEditingIndex(updated.length - 1)
        setTempRule(newGreater)
        return updated
      })
    }
    if ((ruleToSave as Rule).type === 'greater_than' && !rules.some(r => r.type === 'between')) {
      const lessThan = rules.find(r => r.type === 'less_than') as LessThanRule
      const greaterThan = ruleToSave as GreaterThanRule
      if (lessThan && greaterThan) {
        const defaultBetween: BetweenRule = {
          type: 'between',
          min: lessThan.max,
          max: greaterThan.min,
          start_gp: lessThan.gp,
          end_gp: greaterThan.gp
        }
        setRules(current => {
          const withoutGreater = current.filter(r => r.type !== 'greater_than')
          const updated = [...withoutGreater, defaultBetween, greaterThan]
          return updated
        })
      }
    }
  }

  // Helper to sort rules in the correct order
  function sortRules(rules: Rule[]): Rule[] {
    const lessThan = rules.find(r => r.type === 'less_than')
    const greaterThan = rules.find(r => r.type === 'greater_than')
    const allGp = rules.find(r => r.type === 'all_gp')
    const between = rules.filter(r => r.type === 'between').sort((a, b) => (a as BetweenRule).min - (b as BetweenRule).min)
    const result: Rule[] = []
    if (lessThan) result.push(lessThan)
    result.push(...between)
    if (greaterThan) result.push(greaterThan)
    if (allGp) result.push(allGp)
    return result
  }

  // Improved addBetweenRule to pre-fill values and insert in the correct slot
  const addBetweenRule = () => {
    // Find all between rules, sorted
    const betweenRules = rules.filter(r => r.type === 'between').sort((a, b) => (a as BetweenRule).min - (b as BetweenRule).min)
    const lessThan = rules.find(r => r.type === 'less_than') as LessThanRule | undefined
    const greaterThan = rules.find(r => r.type === 'greater_than') as GreaterThanRule | undefined
    // Find the first available gap between rules
    let prevMax = lessThan ? lessThan.max : 0
    const nextMin = greaterThan ? greaterThan.min : Infinity
    // Find a gap between existing between rules
    let insertIndex = rules.findIndex(r => r.type === 'greater_than')
    let newMin = prevMax
    let newMax = nextMin
    let newStartGp = lessThan ? lessThan.gp : 0
    let newEndGp = greaterThan ? greaterThan.gp : 0
    for (let i = 0; i < betweenRules.length; i++) {
      const br = betweenRules[i] as BetweenRule
      if (br.min > prevMax) {
        // Found a gap before this between rule
        newMax = br.min
        newEndGp = br.start_gp
        insertIndex = rules.findIndex(r => r === br)
        break
      }
      prevMax = br.max
      newStartGp = br.end_gp
    }
    // If no gap found, place before greater_than
    if (insertIndex === -1) insertIndex = rules.length
    // If there are between rules, and prevMax < nextMin, fill that gap
    if (betweenRules.length && prevMax < nextMin) {
      newMin = prevMax
      newMax = nextMin
      newStartGp = betweenRules.length ? betweenRules[betweenRules.length - 1].end_gp : newStartGp
      newEndGp = greaterThan ? greaterThan.gp : newEndGp
    }
    const newBetween: BetweenRule = {
      type: 'between',
      min: newMin,
      max: newMax,
      start_gp: newStartGp,
      end_gp: newEndGp
    }
    // Insert the new rule at the correct index
    const updated = [...rules.slice(0, insertIndex), newBetween, ...rules.slice(insertIndex)]
    const sorted = sortRules(updated)
    // Find the index of the new rule in the sorted array
    const newIndex = sorted.findIndex(r => r === newBetween)
    setRules(sorted)
    setEditingIndex(newIndex)
    setTempRule(newBetween)
  }

  const deleteRule = (index: number) => {
    if (!confirm("Are you sure you want to delete this rule?")) return
    const updated = [...rules]
    updated.splice(index, 1)
    setRules(updated)
  }

  const addUniversalRule = () => {
    if (rules.length > 0 || rules.some(r => r.type === 'all_gp')) return
    const newRule: AllGpRule = { type: 'all_gp', gp: 70 }
    setRules([newRule])
  }

  const startCustomRuleSet = () => {
    if (rules.length > 0 && !confirm("Starting a new custom rule set will discard existing rules. Continue?")) {
      return
    }
    const newLessThan: LessThanRule = { type: 'less_than', max: 0, gp: 0 }
    setRules([newLessThan])
    setEditingIndex(0)
    setTempRule(newLessThan)
  }

  const validateRules = (): boolean => {
    if (!rules.length) {
      setError("You must have at least one rule.")
      return false
    }
  
    if (rules.length === 1 && rules[0].type === 'all_gp') {
      return true // ✅ Universal rule is valid on its own
    }
  
    const sorted = [...rules].filter(r => r.type !== 'all_gp').sort((a, b) => {
      if (a.type === 'less_than' && b.type === 'between') return (a as LessThanRule).max - (b as BetweenRule).min
      if (a.type === 'between' && b.type === 'between') return (a as BetweenRule).min - (b as BetweenRule).min
      if (a.type === 'between' && b.type === 'greater_than') return (a as BetweenRule).max - (b as GreaterThanRule).min
      if (a.type === 'less_than' && b.type === 'greater_than') return (a as LessThanRule).max - (b as GreaterThanRule).min
      return 0
    })
  
    let expectedMin = (sorted[0] as LessThanRule).max
  
    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i]
      if ('min' in current && current.min !== expectedMin) {
        return false
      }
      if ('max' in current) {
        expectedMin = current.max
      }
    }
  
    return true
  }

  const fillGaps = () => {
    let filled = false
    const sorted = [...rules].filter(r => r.type !== 'all_gp').sort((a, b) => {
      if (a.type === 'less_than') return -1
      if (b.type === 'less_than') return 1
      if (a.type === 'greater_than') return 1
      if (b.type === 'greater_than') return -1
      return (a as BetweenRule).min - (b as BetweenRule).min
    })

    let expectedMin = (sorted[0] as LessThanRule).max

    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i] as BetweenRule | GreaterThanRule
      if (current.min !== expectedMin) {
        const lessThan = rules.find(r => r.type === 'less_than') as LessThanRule
        const greaterThan = rules.find(r => r.type === 'greater_than') as GreaterThanRule
        const newRule: BetweenRule = {
          type: 'between',
          min: expectedMin,
          max: current.min,
          start_gp: lessThan.gp,
          end_gp: greaterThan.gp
        }
        sorted.splice(i, 0, newRule)
        filled = true
      }
      expectedMin = (current as BetweenRule).max || (current as GreaterThanRule).min
    }
    setRules(sorted)
    return filled
  }

  // Gap analysis function
  function analyzeGaps(rules: Rule[]): { min: number, max: number }[] {
    const filtered = rules.filter(r => r.type !== 'all_gp').sort((a, b) => {
      if (a.type === 'less_than' && b.type === 'between') return (a as LessThanRule).max - (b as BetweenRule).min
      if (a.type === 'between' && b.type === 'between') return (a as BetweenRule).min - (b as BetweenRule).min
      if (a.type === 'between' && b.type === 'greater_than') return (a as BetweenRule).max - (b as GreaterThanRule).min
      if (a.type === 'less_than' && b.type === 'greater_than') return (a as LessThanRule).max - (b as GreaterThanRule).min
      return 0
    })
    if (!filtered.length) return []
    const result: { min: number, max: number }[] = []
    let expectedMin = (filtered[0] as LessThanRule).max
    for (let i = 1; i < filtered.length; i++) {
      const current = filtered[i]
      if ('min' in current && current.min !== expectedMin) {
        result.push({ min: expectedMin, max: current.min })
      }
      if ('max' in current) {
        expectedMin = current.max
      }
    }
    return result
  }

  // Modified saveRules to check for overlaps
  const saveRules = async () => {
    let rulesToCheck = rules;
    if (editingIndex !== null && tempRule) {
      rulesToCheck = [...rules];
      const ruleToSave = { ...tempRule } as Rule;
      rulesToCheck[editingIndex] = ruleToSave;
    }
    // Check for overlaps
    const overlap = findOverlappingRules(rulesToCheck)
    if (overlap) {
      setError(`Rule for £${'min' in overlap.a ? overlap.a.min : 0}–£${'max' in overlap.a ? overlap.a.max : '∞'} overlaps with rule for £${'min' in overlap.b ? overlap.b.min : 0}–£${'max' in overlap.b ? overlap.b.max : '∞'}`)
      return
    }
    const foundGaps = analyzeGaps(rulesToCheck)
    if (foundGaps.length > 0) {
      setGaps(foundGaps)
      setGapModalOpen(true)
      return
    }
    if (!validateRules()) {
      if (!rules.length) return
      try {
        if (!fillGaps()) {
          setError("There are gaps in your rules and they cannot be auto-filled.")
          return
        }
        alert("Some gaps were filled automatically. Please review the generated rules.")
      } catch (e) {
        console.error("Gap filling failed:", e)
        setError("An error occurred while trying to auto-fill gaps.")
        return
      }
    }
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
        .insert([{ user_id: session.user.id, rules: rulesToCheck }])
      if (insertError) {
        setError(insertError.message)
        setSaving(false)
        return
      }
    } else {
      const { error: updateError } = await supabase
        .from('gp_settings')
        .update({ rules: rulesToCheck })
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

  // Update handleAddAllMissingRules to sort after adding
  const handleAddAllMissingRules = () => {
    let newRules = [...rules]
    const sorted = sortRules(newRules)
    gaps.forEach(gap => {
      // Find previous rule (ends at gap.min)
      const prev = sorted.filter(r => {
        if (r.type === 'less_than') return (r as LessThanRule).max === gap.min
        if (r.type === 'between') return (r as BetweenRule).max === gap.min
        return false
      })[0]
      // Find next rule (starts at gap.max)
      const next = sorted.filter(r => {
        if (r.type === 'between') return (r as BetweenRule).min === gap.max
        if (r.type === 'greater_than') return (r as GreaterThanRule).min === gap.max
        return false
      })[0]
      // Determine GP values
      let start_gp = 0
      let end_gp = 0
      if (prev) {
        if (prev.type === 'less_than' || prev.type === 'greater_than') start_gp = (prev as LessThanRule | GreaterThanRule).gp
        else if (prev.type === 'between') start_gp = (prev as BetweenRule).end_gp
      }
      if (next) {
        if (next.type === 'greater_than' || next.type === 'less_than') end_gp = (next as LessThanRule | GreaterThanRule).gp
        else if (next.type === 'between') end_gp = (next as BetweenRule).start_gp
      }
      newRules.push({
        type: 'between',
        min: gap.min,
        max: gap.max,
        start_gp,
        end_gp
      } as BetweenRule)
    })
    newRules = sortRules(newRules)
    setRules(newRules)
    setGapModalOpen(false)
    setGaps([])
  }

  if (loadingRules) return null

  return (
    <main className="p-6 max-w-2xl mx-auto flex flex-col justify-center min-h-screen">
      <Card className="shadow-md">
        <CardContent className="space-y-8 py-8">
          <h1 className="text-2xl font-bold text-center mb-6">Setup Your GP Rules</h1>

          {success && <p className="text-green-600 text-center">✅ Rules saved successfully!</p>}
          {error && <p className="text-red-600 text-center">{error}</p>}

          {/* Gap Modal */}
          <Dialog open={gapModalOpen} onClose={() => setGapModalOpen(false)} className="fixed z-50 inset-0 overflow-y-auto">
            <div className="fixed inset-0 bg-black opacity-30" aria-hidden="true" />
            <div className="flex items-center justify-center min-h-screen">
              <Dialog.Panel className="relative bg-white rounded-lg shadow-lg p-8 w-full max-w-md z-10">
                <Dialog.Title className="text-lg font-bold mb-4">Missing Rules Detected</Dialog.Title>
                <div className="space-y-4">
                  {gaps.map((gap, idx) => (
                    <div key={idx} className="p-4 border rounded-md bg-yellow-50 flex flex-col gap-2">
                      <span className="font-medium">Missing rule for £{gap.min} to £{gap.max}</span>
                      <Button size="sm" variant="outline" className="self-end" onClick={() => {
                        const newGaps = gaps.filter((_, i) => i !== idx);
                        setGaps(newGaps);
                        if (newGaps.length === 0) setGapModalOpen(false);
                      }}>Dismiss</Button>
                    </div>
                  ))}
                </div>
                <div className="my-6 border-t border-gray-200" />
                <div className="flex gap-2 pt-6">
                  <Button onClick={handleAddAllMissingRules} className="w-full">Add All Missing Rules</Button>
                  <Button variant="outline" onClick={() => setGapModalOpen(false)} className="w-full">Cancel</Button>
                </div>
              </Dialog.Panel>
            </div>
          </Dialog>

          {rules.map((rule, index) => (
            <div
              key={index}
              className={`p-4 mb-4 border rounded-md space-y-2 transition ${
                editingIndex === index
                  ? 'bg-blue-50'
                  : 'bg-white'
              }`}
            >
              {editingIndex === index ? (
                <div className="space-y-2">
                  {rule.type === 'less_than' && (
                    <LessThanRuleForm
                      tempRule={tempRule as Partial<LessThanRule>}
                      setTempRule={setTempRule}
                      setHasError={setFormHasError}
                    />
                  )}
                  {rule.type === 'between' && (
                    <BetweenRuleForm
                      tempRule={tempRule as Partial<BetweenRule>}
                      setTempRule={setTempRule}
                      setHasError={setFormHasError}
                    />
                  )}
                  {rule.type === 'greater_than' && (
                    <GreaterThanRuleForm
                      tempRule={tempRule as Partial<GreaterThanRule>}
                      setTempRule={setTempRule}
                      setHasError={setFormHasError}
                    />
                  )}
                  {rule.type === 'all_gp' && (
                    <AllGpRuleForm
                      tempRule={tempRule as Partial<AllGpRule>}
                      setTempRule={setTempRule}
                      setHasError={setFormHasError}
                    />
                  )}
                  <div className="flex gap-2 pt-4">
                    <Button onClick={saveEdit} disabled={formHasError}>Save</Button>
                    <Button variant="outline" onClick={cancelEditing}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {rule.type === 'less_than' && (
                    <p>If cost is less than £{rule.max} ➔ GP: {rule.gp}%</p>
                  )}
                  {rule.type === 'between' && (
                    <p>
                      If cost is between £{rule.min} and £{rule.max} ➔ GP scales {rule.start_gp}% ➔{' '}
                      {rule.end_gp}%
                    </p>
                  )}
                  {rule.type === 'greater_than' && (
                    <p>If cost is greater than £{rule.min} ➔ GP: {rule.gp}%</p>
                  )}
                  {rule.type === 'all_gp' && <p>Universal GP: {rule.gp}%</p>}
                  <div className="flex gap-2 pt-2">
                    <Button size="sm" onClick={() => startEditing(index)}>
                      Edit
                    </Button>
                    {rule.type === 'between' && (
                      <Button size="sm" variant="outline" onClick={() => deleteRule(index)}>
                        Delete
                      </Button>
                    )}
                    {rule.type === 'all_gp' && (
                      <Button size="sm" variant="outline" onClick={() => deleteRule(index)}>
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          <div className="space-y-6 pt-8">
            {rules.some((r) => r.type !== 'all_gp') && (
              <Button variant="outline" onClick={addBetweenRule}>
                + Add Another Between Rule
              </Button>
            )}
            {!rules.length && (
              <div className="flex flex-col gap-2">
                <Button variant="outline" onClick={addUniversalRule}>
                  + Add Universal GP Rule
                </Button>
                <Button variant="outline" onClick={startCustomRuleSet}>
                  + Create Custom Rule Set
                </Button>
              </div>
            )}
            {rules.length > 0 && rules.some((r) => r.type !== 'all_gp') && (
              <Button variant="destructive" className="w-full" onClick={() => {
                setRules([]);
                setEditingIndex(null);
                setTempRule(null);
              }}>
                Delete All Custom Rules
              </Button>
            )}
          </div>

          <div className="pt-8 space-y-2">
            <Button onClick={saveRules} disabled={saving} className="w-full">
              {saving ? 'Saving...' : 'Save All Rules'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
