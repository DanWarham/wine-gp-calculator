import JSZip from 'jszip'

/**
 * Minimal first-sheet OOXML reader for FnbShop Recipe Detail exports.
 * Avoids the vulnerable SheetJS `xlsx` package; only supports the needed
 * shared-string / inline cell shapes used by the Lime Wood report.
 */
export async function readFirstSheetRows(
  buffer: ArrayBuffer | Buffer | Uint8Array
): Promise<unknown[][]> {
  const zip = await JSZip.loadAsync(buffer)
  const sharedStrings = await readSharedStrings(zip)
  const sheetPath = await resolveFirstSheetPath(zip)
  const sheetXml = await zip.file(sheetPath)?.async('string')
  if (!sheetXml) {
    throw new Error('Workbook sheet could not be read.')
  }
  return parseSheetRows(sheetXml, sharedStrings)
}

async function readSharedStrings(zip: JSZip): Promise<string[]> {
  const file = zip.file('xl/sharedStrings.xml')
  if (!file) return []
  const xml = await file.async('string')
  const strings: string[] = []
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g
  let siMatch: RegExpExecArray | null
  while ((siMatch = siRe.exec(xml)) !== null) {
    const texts: string[] = []
    const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g
    let tMatch: RegExpExecArray | null
    while ((tMatch = tRe.exec(siMatch[1])) !== null) {
      texts.push(decodeXmlEntities(tMatch[1]))
    }
    strings.push(texts.join(''))
  }
  return strings
}

async function resolveFirstSheetPath(zip: JSZip): Promise<string> {
  const workbookXml = await zip.file('xl/workbook.xml')?.async('string')
  if (!workbookXml) throw new Error('Workbook.xml missing.')

  const sheetMatch =
    /<sheet\b[^>]*\br:id="([^"]+)"[^>]*\/?>/.exec(workbookXml) ??
    /<sheet\b[^>]*\brId="([^"]+)"[^>]*\/?>/.exec(workbookXml)
  if (!sheetMatch) throw new Error('No worksheet declared in workbook.')

  const relsXml = await zip.file('xl/_rels/workbook.xml.rels')?.async('string')
  if (!relsXml) throw new Error('Workbook relationships missing.')

  const rid = sheetMatch[1]
  const relRe = new RegExp(
    `<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"[^>]*/>`
  )
  const relMatch = relRe.exec(relsXml)
  if (!relMatch) throw new Error('Worksheet relationship missing.')

  const target = relMatch[1].replace(/^\//, '')
  return target.startsWith('xl/') ? target : `xl/${target}`
}

function parseSheetRows(sheetXml: string, sharedStrings: string[]): unknown[][] {
  const rows: unknown[][] = []
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g
  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowRe.exec(sheetXml)) !== null) {
    const cells = new Map<number, unknown>()
    let maxCol = -1
    // Self-closing empty cells must be matched first; otherwise `[^>]*>` can
    // swallow the trailing `/` of `<c …/>` and steal the next cell's body.
    const cellRe = /<c\b([^>]*?)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g
    let cellMatch: RegExpExecArray | null
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      const selfClosing = cellMatch[1] != null
      const attrs = selfClosing ? cellMatch[1] : (cellMatch[2] ?? '')
      const body = selfClosing ? '' : (cellMatch[3] ?? '')
      const refMatch = /\br="([A-Z]+)(\d+)"/.exec(attrs)
      if (!refMatch) continue
      const col = columnToIndex(refMatch[1])
      maxCol = Math.max(maxCol, col)
      if (selfClosing) {
        cells.set(col, null)
        continue
      }
      const typeMatch = /\bt="([^"]+)"/.exec(attrs)
      const type = typeMatch?.[1]
      const vMatch = /<v>([\s\S]*?)<\/v>/.exec(body)
      const isMatch = /<is>[\s\S]*?<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(body)
      let value: unknown = null
      if (type === 'inlineStr' && isMatch) {
        value = decodeXmlEntities(isMatch[1])
      } else if (vMatch) {
        const raw = decodeXmlEntities(vMatch[1])
        if (type === 's') {
          const idx = Number(raw)
          value = Number.isFinite(idx) ? sharedStrings[idx] ?? raw : raw
        } else if (type === 'b') {
          value = raw === '1'
        } else if (raw !== '' && !Number.isNaN(Number(raw))) {
          value = Number(raw)
        } else {
          value = raw
        }
      }
      cells.set(col, value)
    }
    const row: unknown[] = []
    for (let c = 0; c <= maxCol; c++) {
      row.push(cells.has(c) ? cells.get(c) : null)
    }
    rows.push(row)
  }
  return rows
}

function columnToIndex(col: string): number {
  let n = 0
  for (const ch of col) {
    n = n * 26 + (ch.charCodeAt(0) - 64)
  }
  return n - 1
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}
