import { Input } from "@/components/ui/input"
import { AllGpRule } from "@/types/rules"
import { safeParse, validateInput, sanitizeInput } from "@/lib/gpRules"
import { ChangeEvent, useState, useEffect } from "react"

export default function AllGpRuleForm({
  tempRule,
  setTempRule,
  setHasError,
}: {
  tempRule: Partial<AllGpRule> | null
  setTempRule: (rule: Partial<AllGpRule>) => void
  setHasError: (hasError: boolean) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState<string>(tempRule?.gp?.toString() ?? '')

  useEffect(() => {
    setHasError(!!error)
  }, [error, setHasError])

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value
    const sanitized = sanitizeInput(rawValue, true)
    
    // Update the input value with sanitized version
    setInputValue(sanitized)
    
    if (!validateInput(sanitized, true)) {
      setError("Please enter a number between 1 and 100")
      return
    }
    
    setError(null)
    const parsed = safeParse(sanitized, true)
    if (parsed !== undefined) {
      setTempRule({
        ...(tempRule as AllGpRule),
        gp: parsed,
      })
    }
  }

  return (
    <>
      <p>Universal GP % for all wines:</p>
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">GP %</label>
        <Input
          className={`w-24 ${error ? 'border-red-500' : ''}`}
          type="text"
          inputMode="decimal"
          min="1"
          max="100"
          step="0.1"
          value={inputValue}
          onChange={handleChange}
        />
      </div>
      {error && <p className="text-sm text-red-500 mt-1">{error}</p>}
    </>
  )
} 