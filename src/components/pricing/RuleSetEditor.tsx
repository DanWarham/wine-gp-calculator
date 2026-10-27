'use client'

import { forwardRef, useImperativeHandle, useState } from 'react'
import { Dialog } from '@headlessui/react'
import { Button } from '@/components/ui/button'
import AllGpRuleForm from '@/components/rules/AllGpRuleForm'
import GreaterThanRuleForm from '@/components/rules/GreaterThanRuleForm'
import LessThanRuleForm from '@/components/rules/LessThanRuleForm'
import BetweenRuleForm from '@/components/rules/BetweenRuleForm'
import { validateRuleSetForPricing } from '@/lib/pricing'
import type {
  AllGpRule,
  BetweenRule,
  GreaterThanRule,
  LessThanRule,
  Rule,
} from '@/types/rules'

function findOverlappingRules(
  rules: Rule[]
): { i: number; j: number; a: Rule; b: Rule } | null {
  const relevant = rules.filter((r) => r.type !== 'all_gp')
  const getMin = (r: Rule) =>
    r.type === 'less_than' ? 0 : r.type === 'greater_than' ? (r as GreaterThanRule).min : (r as BetweenRule).min
  const getMax = (r: Rule) =>
    r.type === 'less_than'
      ? (r as LessThanRule).max
      : r.type === 'greater_than'
        ? Infinity
        : (r as BetweenRule).max
  const sorted = relevant.slice().sort((a, b) => getMin(a) - getMin(b))
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const aMin = getMin(a)
    const aMax = getMax(a)
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]
      const bMin = getMin(b)
      const bMax = getMax(b)
      if (aMax > bMin && aMin < bMax) {
        return { i, j, a, b }
      }
    }
  }
  return null
}

function sortRules(rules: Rule[]): Rule[] {
  const lessThan = rules.find((r) => r.type === 'less_than')
  const greaterThan = rules.find((r) => r.type === 'greater_than')
  const allGp = rules.find((r) => r.type === 'all_gp')
  const between = rules
    .filter((r) => r.type === 'between')
    .sort((a, b) => (a as BetweenRule).min - (b as BetweenRule).min)
  const result: Rule[] = []
  if (lessThan) result.push(lessThan)
  result.push(...between)
  if (greaterThan) result.push(greaterThan)
  if (allGp) result.push(allGp)
  return result
}

function analyzeGaps(rules: Rule[]): { min: number; max: number }[] {
  const filtered = rules
    .filter((r) => r.type !== 'all_gp')
    .sort((a, b) => {
      if (a.type === 'less_than' && b.type === 'between')
        return (a as LessThanRule).max - (b as BetweenRule).min
      if (a.type === 'between' && b.type === 'between')
        return (a as BetweenRule).min - (b as BetweenRule).min
      if (a.type === 'between' && b.type === 'greater_than')
        return (a as BetweenRule).max - (b as GreaterThanRule).min
      if (a.type === 'less_than' && b.type === 'greater_than')
        return (a as LessThanRule).max - (b as GreaterThanRule).min
      return 0
    })
  if (!filtered.length) return []
  const result: { min: number; max: number }[] = []
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

export function prepareRulesForSave(
  rules: Rule[],
  options: { allowEmpty?: boolean; editingIndex: number | null; tempRule: Partial<Rule> | null }
): { ok: true; rules: Rule[] } | { ok: false; error: string; gaps?: { min: number; max: number }[] } {
  let rulesToCheck = rules
  if (options.editingIndex !== null && options.tempRule) {
    rulesToCheck = [...rules]
    rulesToCheck[options.editingIndex] = { ...options.tempRule } as Rule
  }

  const overlap = findOverlappingRules(rulesToCheck)
  if (overlap) {
    return {
      ok: false,
      error: `Rule for £${'min' in overlap.a ? overlap.a.min : 0}–£${'max' in overlap.a ? overlap.a.max : '∞'} overlaps with rule for £${'min' in overlap.b ? overlap.b.min : 0}–£${'max' in overlap.b ? overlap.b.max : '∞'}`,
    }
  }

  const foundGaps = analyzeGaps(rulesToCheck)
  if (foundGaps.length > 0) {
    return { ok: false, error: 'Missing rules detected.', gaps: foundGaps }
  }

  if (rulesToCheck.length === 0 && options.allowEmpty) {
    return { ok: true, rules: rulesToCheck }
  }

  const pricingValidationError = validateRuleSetForPricing(rulesToCheck)
  if (pricingValidationError) {
    return { ok: false, error: pricingValidationError.message }
  }

  return { ok: true, rules: rulesToCheck }
}

export interface RuleSetEditorHandle {
  /** Validate + return rules ready to persist, or null if blocked (gap modal / error). */
  prepareForSave: () => Rule[] | null
}

export interface RuleSetEditorProps {
  rules: Rule[]
  onChange: (rules: Rule[]) => void
  /** When true, empty rules are allowed (blank alternative). */
  allowEmpty?: boolean
  disabled?: boolean
  error?: string | null
  onError?: (message: string | null) => void
}

export const RuleSetEditor = forwardRef<RuleSetEditorHandle, RuleSetEditorProps>(
  function RuleSetEditor(
    { rules, onChange, allowEmpty = false, disabled = false, error, onError },
    ref
  ) {
    const [editingIndex, setEditingIndex] = useState<number | null>(null)
    const [tempRule, setTempRule] = useState<Partial<Rule> | null>(null)
    const [formHasError, setFormHasError] = useState(false)
    const [gapModalOpen, setGapModalOpen] = useState(false)
    const [gaps, setGaps] = useState<{ min: number; max: number }[]>([])

    const setError = (message: string | null) => {
      onError?.(message)
    }

    useImperativeHandle(ref, () => ({
      prepareForSave: () => {
        const result = prepareRulesForSave(rules, {
          allowEmpty,
          editingIndex,
          tempRule,
        })
        if (!result.ok) {
          if (result.gaps) {
            setGaps(result.gaps)
            setGapModalOpen(true)
            setError(null)
          } else {
            setError(result.error)
          }
          return null
        }
        setError(null)
        return result.rules
      },
    }))

    const startEditing = (index: number) => {
      if (disabled) return
      setEditingIndex(index)
      setTempRule({ ...rules[index] })
    }

    const cancelEditing = () => {
      setEditingIndex(null)
      setTempRule(null)
    }

    const saveEdit = () => {
      if (!tempRule || editingIndex === null) return
      const ruleToSave = { ...tempRule } as Rule
      const updated = [...rules]
      updated[editingIndex] = ruleToSave
      const overlap = findOverlappingRules(updated)
      if (overlap) {
        setError(
          `Rule for £${'min' in overlap.a ? overlap.a.min : 0}–£${'max' in overlap.a ? overlap.a.max : '∞'} overlaps with rule for £${'min' in overlap.b ? overlap.b.min : 0}–£${'max' in overlap.b ? overlap.b.max : '∞'}`
        )
        return
      }
      onChange(updated)
      setEditingIndex(null)
      setTempRule(null)
      setError(null)

      if (
        (ruleToSave as Rule).type === 'less_than' &&
        !rules.some((r) => r.type === 'greater_than')
      ) {
        const newGreater: GreaterThanRule = { type: 'greater_than', min: 0, gp: 0 }
        const next = [...updated, newGreater]
        onChange(next)
        setEditingIndex(next.length - 1)
        setTempRule(newGreater)
      }
      if (
        (ruleToSave as Rule).type === 'greater_than' &&
        !rules.some((r) => r.type === 'between')
      ) {
        const lessThan = rules.find((r) => r.type === 'less_than') as LessThanRule
        const greaterThan = ruleToSave as GreaterThanRule
        if (lessThan && greaterThan) {
          const defaultBetween: BetweenRule = {
            type: 'between',
            min: lessThan.max,
            max: greaterThan.min,
            start_gp: lessThan.gp,
            end_gp: greaterThan.gp,
          }
          const withoutGreater = updated.filter((r) => r.type !== 'greater_than')
          onChange([...withoutGreater, defaultBetween, greaterThan])
        }
      }
    }

    const addBetweenRule = () => {
      if (disabled) return
      const betweenRules = rules
        .filter((r) => r.type === 'between')
        .sort((a, b) => (a as BetweenRule).min - (b as BetweenRule).min)
      const lessThan = rules.find((r) => r.type === 'less_than') as LessThanRule | undefined
      const greaterThan = rules.find((r) => r.type === 'greater_than') as GreaterThanRule | undefined
      let prevMax = lessThan ? lessThan.max : 0
      const nextMin = greaterThan ? greaterThan.min : Infinity
      let insertIndex = rules.findIndex((r) => r.type === 'greater_than')
      let newMin = prevMax
      let newMax = nextMin
      let newStartGp = lessThan ? lessThan.gp : 0
      let newEndGp = greaterThan ? greaterThan.gp : 0
      for (let i = 0; i < betweenRules.length; i++) {
        const br = betweenRules[i] as BetweenRule
        if (br.min > prevMax) {
          newMax = br.min
          newEndGp = br.start_gp
          insertIndex = rules.findIndex((r) => r === br)
          break
        }
        prevMax = br.max
        newStartGp = br.end_gp
      }
      if (insertIndex === -1) insertIndex = rules.length
      if (betweenRules.length && prevMax < nextMin) {
        newMin = prevMax
        newMax = nextMin
        newStartGp = betweenRules.length
          ? betweenRules[betweenRules.length - 1].end_gp
          : newStartGp
        newEndGp = greaterThan ? greaterThan.gp : newEndGp
      }
      const newBetween: BetweenRule = {
        type: 'between',
        min: newMin,
        max: newMax,
        start_gp: newStartGp,
        end_gp: newEndGp,
      }
      const updated = [...rules.slice(0, insertIndex), newBetween, ...rules.slice(insertIndex)]
      const sorted = sortRules(updated)
      const newIndex = sorted.findIndex((r) => r === newBetween)
      onChange(sorted)
      setEditingIndex(newIndex)
      setTempRule(newBetween)
    }

    const deleteRule = (index: number) => {
      if (disabled) return
      if (!confirm('Are you sure you want to delete this rule?')) return
      const updated = [...rules]
      updated.splice(index, 1)
      onChange(updated)
    }

    const addUniversalRule = () => {
      if (disabled) return
      if (rules.length > 0 || rules.some((r) => r.type === 'all_gp')) return
      onChange([{ type: 'all_gp', gp: 70 }])
    }

    const startCustomRuleSet = () => {
      if (disabled) return
      if (
        rules.length > 0 &&
        !confirm('Starting a new custom rule set will discard existing rules. Continue?')
      ) {
        return
      }
      const newLessThan: LessThanRule = { type: 'less_than', max: 0, gp: 0 }
      onChange([newLessThan])
      setEditingIndex(0)
      setTempRule(newLessThan)
    }

    const handleAddAllMissingRules = () => {
      let newRules = [...rules]
      const sorted = sortRules(newRules)
      gaps.forEach((gap) => {
        const prev = sorted.filter((r) => {
          if (r.type === 'less_than') return (r as LessThanRule).max === gap.min
          if (r.type === 'between') return (r as BetweenRule).max === gap.min
          return false
        })[0]
        const next = sorted.filter((r) => {
          if (r.type === 'between') return (r as BetweenRule).min === gap.max
          if (r.type === 'greater_than') return (r as GreaterThanRule).min === gap.max
          return false
        })[0]
        let start_gp = 0
        let end_gp = 0
        if (prev) {
          if (prev.type === 'less_than' || prev.type === 'greater_than')
            start_gp = (prev as LessThanRule | GreaterThanRule).gp
          else if (prev.type === 'between') start_gp = (prev as BetweenRule).end_gp
        }
        if (next) {
          if (next.type === 'greater_than' || next.type === 'less_than')
            end_gp = (next as LessThanRule | GreaterThanRule).gp
          else if (next.type === 'between') end_gp = (next as BetweenRule).start_gp
        }
        newRules.push({
          type: 'between',
          min: gap.min,
          max: gap.max,
          start_gp,
          end_gp,
        } as BetweenRule)
      })
      newRules = sortRules(newRules)
      onChange(newRules)
      setGapModalOpen(false)
      setGaps([])
    }

    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">GP Rules</h3>
          <p className="text-xs text-gray-600 mt-1">
            GP rule cost bands use the equivalent acquisition cost of a 750ml bottle. Half bottles,
            magnums and custom sizes are normalised automatically when pricing.
          </p>
          {allowEmpty && rules.length === 0 && (
            <p className="text-sm text-amber-700 mt-2">
              Incomplete: add GP rules before this configuration can be made Current.
            </p>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <Dialog
          open={gapModalOpen}
          onClose={() => setGapModalOpen(false)}
          className="fixed z-50 inset-0 overflow-y-auto"
        >
          <div className="fixed inset-0 bg-black opacity-30" aria-hidden="true" />
          <div className="flex items-center justify-center min-h-screen">
            <Dialog.Panel className="relative bg-white rounded-lg shadow-lg p-8 w-full max-w-md z-10">
              <Dialog.Title className="text-lg font-bold mb-4">Missing Rules Detected</Dialog.Title>
              <div className="space-y-4">
                {gaps.map((gap, idx) => (
                  <div key={idx} className="p-4 border rounded-md bg-yellow-50 flex flex-col gap-2">
                    <span className="font-medium">
                      Missing rule for £{gap.min} to £{gap.max}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="self-end"
                      onClick={() => {
                        const newGaps = gaps.filter((_, i) => i !== idx)
                        setGaps(newGaps)
                        if (newGaps.length === 0) setGapModalOpen(false)
                      }}
                    >
                      Dismiss
                    </Button>
                  </div>
                ))}
              </div>
              <div className="my-6 border-t border-gray-200" />
              <div className="flex gap-2 pt-6">
                <Button onClick={handleAddAllMissingRules} className="w-full">
                  Add All Missing Rules
                </Button>
                <Button variant="outline" onClick={() => setGapModalOpen(false)} className="w-full">
                  Cancel
                </Button>
              </div>
            </Dialog.Panel>
          </div>
        </Dialog>

        {rules.map((rule, index) => (
          <div
            key={index}
            className={`p-4 border rounded-md space-y-2 transition ${
              editingIndex === index ? 'bg-blue-50' : 'bg-white'
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
                  <Button onClick={saveEdit} disabled={formHasError || disabled}>
                    Save
                  </Button>
                  <Button variant="outline" onClick={cancelEditing} disabled={disabled}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {rule.type === 'less_than' && (
                  <p>
                    If cost is less than £{rule.max} ➔ GP: {rule.gp}%
                  </p>
                )}
                {rule.type === 'between' && (
                  <p>
                    If cost is between £{rule.min} and £{rule.max} ➔ GP scales {rule.start_gp}% ➔{' '}
                    {rule.end_gp}%
                  </p>
                )}
                {rule.type === 'greater_than' && (
                  <p>
                    If cost is greater than £{rule.min} ➔ GP: {rule.gp}%
                  </p>
                )}
                {rule.type === 'all_gp' && <p>Universal GP: {rule.gp}%</p>}
                <div className="flex gap-2 pt-2">
                  <Button size="sm" onClick={() => startEditing(index)} disabled={disabled}>
                    Edit
                  </Button>
                  {(rule.type === 'between' || rule.type === 'all_gp') && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => deleteRule(index)}
                      disabled={disabled}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        <div className="space-y-3 pt-2">
          {rules.some((r) => r.type !== 'all_gp') && (
            <Button variant="outline" onClick={addBetweenRule} disabled={disabled}>
              + Add Another Between Rule
            </Button>
          )}
          {!rules.length && (
            <div className="flex flex-col gap-2">
              <Button variant="outline" onClick={addUniversalRule} disabled={disabled}>
                + Add Universal GP Rule
              </Button>
              <Button variant="outline" onClick={startCustomRuleSet} disabled={disabled}>
                + Create Custom Rule Set
              </Button>
            </div>
          )}
          {rules.length > 0 && rules.some((r) => r.type !== 'all_gp') && (
            <Button
              variant="destructive"
              className="w-full"
              disabled={disabled}
              onClick={() => {
                if (disabled) return
                onChange([])
                setEditingIndex(null)
                setTempRule(null)
              }}
            >
              Delete All Custom Rules
            </Button>
          )}
        </div>
      </div>
    )
  }
)
