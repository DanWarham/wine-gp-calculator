import { Input } from "@/components/ui/input"
import { LessThanRule } from "@/types/rules"
import { safeParse, validateInput, sanitizeInput } from "@/lib/gpRules"
import { ChangeEvent, useState, useEffect, useRef } from "react"

export default function LessThanRuleForm({
  tempRule,
  setTempRule,
  setHasError,
}: {
  tempRule: Partial<LessThanRule> | null
  setTempRule: (rule: Partial<LessThanRule>) => void
  setHasError: (hasError: boolean) => void
}) {
  const [errors, setErrors] = useState<{ max?: string; gp?: string }>({})
  const [inputValues, setInputValues] = useState({
    max: tempRule?.max?.toString() ?? '',
    gp: tempRule?.gp?.toString() ?? ''
  })
  const maxInputRef = useRef<HTMLInputElement>(null)
  const gpInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setHasError(!!errors.max || !!errors.gp)
  }, [errors, setHasError])

  useEffect(() => {
    if ((tempRule?.max === undefined || tempRule?.max?.toString() === "") && maxInputRef.current) {
      maxInputRef.current.focus()
      setInputValues(prev => ({ ...prev, max: "" }))
    }
  }, [tempRule])

  const handleMaxChange = (e: ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value
    const sanitized = sanitizeInput(rawValue, false)
    
    setInputValues(prev => ({ ...prev, max: sanitized }))
    
    if (!validateInput(sanitized, false)) {
      setErrors(prev => ({ ...prev, max: "Please enter a non-negative number" }))
      return
    }
    
    setErrors(prev => ({ ...prev, max: undefined }))
    const parsed = safeParse(sanitized, false)
    if (parsed !== undefined) {
      setTempRule({
        ...(tempRule as LessThanRule),
        max: parsed,
      })
    }
  }

  const handleGpChange = (e: ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value
    const sanitized = sanitizeInput(rawValue, true)
    
    setInputValues(prev => ({ ...prev, gp: sanitized }))
    
    if (!validateInput(sanitized, true)) {
      setErrors(prev => ({ ...prev, gp: "Please enter a number between 1 and 100" }))
      return
    }
    
    setErrors(prev => ({ ...prev, gp: undefined }))
    const parsed = safeParse(sanitized, true)
    if (parsed !== undefined) {
      setTempRule({
        ...(tempRule as LessThanRule),
        gp: parsed,
      })
    }
  }

  return (
    <>
      <p>If cost is less than:</p>
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">£</label>
        <Input
          ref={maxInputRef}
          className={`w-24 ${errors.max ? 'border-red-500' : ''}`}
          type="text"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={inputValues.max}
          onChange={handleMaxChange}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              gpInputRef.current?.focus();
            }
          }}
        />
      </div>
      {errors.max && <p className="text-sm text-red-500 mt-1">{errors.max}</p>}

      <p>Then GP is:</p>
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">GP %</label>
        <Input
          ref={gpInputRef}
          className={`w-24 ${errors.gp ? 'border-red-500' : ''}`}
          type="text"
          inputMode="decimal"
          min="1"
          max="100"
          step="0.1"
          value={inputValues.gp}
          onChange={handleGpChange}
        />
      </div>
      {errors.gp && <p className="text-sm text-red-500 mt-1">{errors.gp}</p>}
    </>
  )
}
