import type { PricingImportIssue } from '@/types/pricingDataImport'

/** Prefer FnbShop description, else Micros, else null. */
export function resolveImportItemName(
  fnbshopDescription: string | null | undefined,
  microsDescription: string | null | undefined
): string | null {
  const fnb = fnbshopDescription?.trim()
  if (fnb) return fnb
  const micros = microsDescription?.trim()
  if (micros) return micros
  return null
}

export function issueDisplayName(issue: Pick<PricingImportIssue, 'itemName' | 'externalPlu'>): string {
  const name = issue.itemName?.trim()
  if (name) return name
  if (issue.externalPlu) return `PLU ${issue.externalPlu}`
  return 'Unknown item'
}

export function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/** CSV: PLU, Wine, Severity, Issue Type, Message */
export function buildImportIssuesCsv(
  issues: Array<
    Pick<PricingImportIssue, 'externalPlu' | 'itemName' | 'severity' | 'issueType' | 'message'>
  >
): string {
  const header = ['PLU', 'Wine', 'Severity', 'Issue Type', 'Message']
  const lines = [header.join(',')]
  for (const issue of issues) {
    lines.push(
      [
        escapeCsvField(issue.externalPlu ?? ''),
        escapeCsvField(issueDisplayName(issue)),
        escapeCsvField(issue.severity),
        escapeCsvField(issue.issueType),
        escapeCsvField(issue.message),
      ].join(',')
    )
  }
  return `${lines.join('\n')}\n`
}
