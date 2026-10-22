// Sanitizes input to only allow valid characters
export const sanitizeInput = (value: string, isGpField: boolean = false): string => {
  // Remove any non-numeric characters except decimal point
  let sanitized = value.replace(/[^\d.]/g, '')
  
  // Ensure only one decimal point
  const parts = sanitized.split('.')
  if (parts.length > 2) {
    sanitized = parts[0] + '.' + parts.slice(1).join('')
  }
  
  // For GP fields, limit to 1 decimal place
  if (isGpField && parts.length > 1) {
    sanitized = parts[0] + '.' + parts[1].slice(0, 1)
  }
  
  // For price fields, limit to 2 decimal places
  if (!isGpField && parts.length > 1) {
    sanitized = parts[0] + '.' + parts[1].slice(0, 2)
  }
  
  return sanitized
}

// Validates input as it's being typed
export const validateInput = (value: string, isGpField: boolean = false): boolean => {
  // Allow empty string for better UX
  if (value === '') return true
  
  // Check if it's a valid number format
  if (!/^\d*\.?\d*$/.test(value)) return false
  
  const parsed = parseFloat(value)
  if (isNaN(parsed)) return false
  
  // GP form fields: keep existing lower bound of 1; reject GP >= 100 (zero denominator).
  if (isGpField && (parsed < 1 || parsed >= 100)) return false
  
  // For price fields, ensure the value is non-negative
  if (!isGpField && parsed < 0) return false
  
  return true
}

// Parses the final value
export const safeParse = (value: string, isGpField: boolean = false): number | undefined => {
  if (value === '') return undefined
  
  const parsed = parseFloat(value)
  if (isNaN(parsed)) return undefined
  
  // GP form fields: keep existing lower bound of 1; reject GP >= 100.
  if (isGpField && (parsed < 1 || parsed >= 100)) return undefined
  
  // For price fields, ensure the value is non-negative
  if (!isGpField && parsed < 0) return undefined
  
  return parsed
}
