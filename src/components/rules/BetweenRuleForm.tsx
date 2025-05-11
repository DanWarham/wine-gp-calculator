import { Input } from "@/components/ui/input"
import { BetweenRule } from "@/types/rules"
import { safeParse, validateInput, sanitizeInput } from "@/lib/gpRules"
import { ChangeEvent, useState, useEffect, useRef } from "react"

export default function BetweenRuleForm({
  tempRule,
  setTempRule,
  setHasError,
}: {
  tempRule: Partial<BetweenRule> | null
  setTempRule: (rule: Partial<BetweenRule>) => void
  setHasError: (hasError: boolean) => void
}) {
  const [errors, setErrors] = useState<{
    min?: string
    max?: string
    start_gp?: string
    end_gp?: string
  }>({})
  const [inputValues, setInputValues] = useState({
    min: tempRule?.min?.toString() ?? '',
    max: tempRule?.max?.toString() ?? '',
    start_gp: tempRule?.start_gp?.toString() ?? '',
    end_gp: tempRule?.end_gp?.toString() ?? ''
  })
  const minInputRef = useRef<HTMLInputElement>(null)
  const maxInputRef = useRef<HTMLInputElement>(null)
  const startGpInputRef = useRef<HTMLInputElement>(null)
  const endGpInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setHasError(!!errors.min || !!errors.max || !!errors.start_gp || !!errors.end_gp)
  }, [errors, setHasError])

  useEffect(() => {
    if ((tempRule?.min === undefined || tempRule?.min?.toString() === "") && minInputRef.current) {
      minInputRef.current.focus()
      setInputValues(prev => ({ ...prev, min: "" }))
    }
  }, [tempRule])

  const handleMinChange = (e: ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value
    const sanitized = sanitizeInput(rawValue, false)
    
    setInputValues(prev => ({ ...prev, min: sanitized }))
    
    if (!validateInput(sanitized, false)) {
      setErrors(prev => ({ ...prev, min: "Please enter a non-negative number" }))
      return
    }
    
    setErrors(prev => ({ ...prev, min: undefined }))
    const parsed = safeParse(sanitized, false)
    if (parsed !== undefined) {
      setTempRule({
        ...(tempRule as BetweenRule),
        min: parsed,
      })
    }
  }

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
        ...(tempRule as BetweenRule),
        max: parsed,
      })
    }
  }

  const handleStartGpChange = (e: ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value
    const sanitized = sanitizeInput(rawValue, true)
    
    setInputValues(prev => ({ ...prev, start_gp: sanitized }))
    
    if (!validateInput(sanitized, true)) {
      setErrors(prev => ({ ...prev, start_gp: "Please enter a number between 1 and 100" }))
      return
    }
    
    setErrors(prev => ({ ...prev, start_gp: undefined }))
    const parsed = safeParse(sanitized, true)
    if (parsed !== undefined) {
      setTempRule({
        ...(tempRule as BetweenRule),
        start_gp: parsed,
      })
    }
  }

  const handleEndGpChange = (e: ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value
    const sanitized = sanitizeInput(rawValue, true)
    
    setInputValues(prev => ({ ...prev, end_gp: sanitized }))
    
    if (!validateInput(sanitized, true)) {
      setErrors(prev => ({ ...prev, end_gp: "Please enter a number between 1 and 100" }))
      return
    }
    
    setErrors(prev => ({ ...prev, end_gp: undefined }))
    const parsed = safeParse(sanitized, true)
    if (parsed !== undefined) {
      setTempRule({
        ...(tempRule as BetweenRule),
        end_gp: parsed,
      })
    }
  }

  return (
    <>
      <p>If cost is between:</p>
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">£</label>
        <Input
          ref={minInputRef}
          className={`w-24 ${errors.min ? 'border-red-500' : ''}`}
          type="text"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={inputValues.min}
          onChange={handleMinChange}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              maxInputRef.current?.focus();
            }
          }}
        />
      </div>
      {errors.min && <p className="text-sm text-red-500 mt-1">{errors.min}</p>}
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
              startGpInputRef.current?.focus();
            }
          }}
        />
      </div>
      {errors.max && <p className="text-sm text-red-500 mt-1">{errors.max}</p>}
      <p>GP scales from:</p>
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">Start GP%</label>
        <Input
          ref={startGpInputRef}
          className={`w-24 ${errors.start_gp ? 'border-red-500' : ''}`}
          type="text"
          inputMode="decimal"
          min="1"
          max="100"
          step="0.1"
          value={inputValues.start_gp}
          onChange={handleStartGpChange}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              endGpInputRef.current?.focus();
            }
          }}
        />
      </div>
      {errors.start_gp && <p className="text-sm text-red-500 mt-1">{errors.start_gp}</p>}
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">End GP%</label>
        <Input
          ref={endGpInputRef}
          className={`w-24 ${errors.end_gp ? 'border-red-500' : ''}`}
          type="text"
          inputMode="decimal"
          min="1"
          max="100"
          step="0.1"
          value={inputValues.end_gp}
          onChange={handleEndGpChange}
        />
      </div>
      {errors.end_gp && <p className="text-sm text-red-500 mt-1">{errors.end_gp}</p>}
    </>
  )
} 