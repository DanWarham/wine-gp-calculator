/**
 * Minimal CSV parser for Micros report exports (comma-separated, quoted fields).
 * Decodes buffers with UTF-8 first, falling back to Windows-1252 for £ / accented text.
 */

export function decodeCsvBuffer(buffer: ArrayBuffer | Buffer | Uint8Array): string {
  const bytes =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : buffer instanceof Buffer
        ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        : buffer

  try {
    const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return utf8
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const records = parseCsvRecords(text)
  if (records.length === 0) {
    return { headers: [], rows: [] }
  }
  const headers = records[0].map((h) => h.replace(/^\uFEFF/, '').trim())
  const rows: Record<string, string>[] = []
  for (let i = 1; i < records.length; i++) {
    const record = records[i]
    if (record.length === 1 && record[0].trim() === '') continue
    const row: Record<string, string> = {}
    for (let c = 0; c < headers.length; c++) {
      row[headers[c]] = (record[c] ?? '').trim()
    }
    rows.push(row)
  }
  return { headers, rows }
}

function parseCsvRecords(text: string): string[][] {
  const records: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false

  const pushField = () => {
    row.push(field)
    field = ''
  }
  const pushRow = () => {
    // Skip completely empty trailing line
    if (row.length === 1 && row[0] === '' && records.length > 0) {
      row = []
      return
    }
    records.push(row)
    row = []
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }

    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === ',') {
      pushField()
      continue
    }
    if (ch === '\n') {
      pushField()
      pushRow()
      continue
    }
    if (ch === '\r') {
      continue
    }
    field += ch
  }

  if (field.length > 0 || row.length > 0) {
    pushField()
    pushRow()
  }

  return records
}
