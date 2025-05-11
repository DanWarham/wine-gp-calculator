import { Input } from "@/components/ui/input"
import { GreaterThanRule } from "@/types/rules"
import { safeParse, validateInput, sanitizeInput } from "@/lib/gpRules"
import { ChangeEvent, useState, useEffect } from "react"

export default function GreaterThanRuleForm({
  tempRule,
  setTempRule,
  setHasError,
}: {
  tempRule: Partial<GreaterThanRule> | null
  setTempRule: (rule: Partial<GreaterThanRule>) => void
  setHasError: (hasError: boolean) => void
}) {
  const [errors, setErrors] = useState<{ min?: string; gp?: string }>({})
  const [inputValues, setInputValues] = useState({
    min: tempRule?.min?.toString() ?? '',
    gp: tempRule?.gp?.toString() ?? ''
  })

  useEffect(() => {
    setHasError(!!errors.min || !!errors.gp)
  }, [errors, setHasError])

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
        ...(tempRule as GreaterThanRule),
        min: parsed,
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
        ...(tempRule as GreaterThanRule),
        gp: parsed,
      })
    }
  }

  return (
    <>
      <p>If cost is greater than:</p>
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">£</label>
        <Input
          className={`w-24 ${errors.min ? 'border-red-500' : ''}`}
          type="text"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={inputValues.min}
          onChange={handleMinChange}
        />
      </div>
      {errors.min && <p className="text-sm text-red-500 mt-1">{errors.min}</p>}
      <p>Then GP is:</p>
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">GP %</label>
        <Input
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