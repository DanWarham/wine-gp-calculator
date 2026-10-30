import { describe, expect, it } from 'vitest'
import {
  buildImportIssuesCsv,
  issueDisplayName,
  resolveImportItemName,
} from './issueDisplay'

describe('issue display / CSV', () => {
  it('prefers FnbShop description over Micros', () => {
    expect(resolveImportItemName('Fnb Name', 'Micros Name')).toBe('Fnb Name')
    expect(resolveImportItemName(null, 'Micros Name')).toBe('Micros Name')
    expect(resolveImportItemName('  ', null)).toBeNull()
  })

  it('builds CSV with PLU, Wine, Severity, Issue Type, Message', () => {
    const csv = buildImportIssuesCsv([
      {
        externalPlu: '5000001',
        itemName: 'Picq Chablis',
        severity: 'item_exception',
        issueType: 'missing_micros_price',
        message: 'Missing price',
      },
      {
        externalPlu: null,
        itemName: null,
        severity: 'informational',
        issueType: 'micros_only_active',
        message: 'Note, with comma',
      },
    ])
    expect(csv).toContain('PLU,Wine,Severity,Issue Type,Message')
    expect(csv).toContain('5000001,Picq Chablis,item_exception,missing_micros_price,Missing price')
    expect(csv).toContain('Unknown item')
    expect(csv).toContain('"Note, with comma"')
  })

  it('falls back wine label to PLU when unnamed', () => {
    expect(issueDisplayName({ itemName: null, externalPlu: '5000999' })).toBe('PLU 5000999')
  })
})
