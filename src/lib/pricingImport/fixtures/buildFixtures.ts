import JSZip from 'jszip'

/** Synthetic Lime Wood–shaped fixtures for automated tests (not production data). */

function colName(index: number): string {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export async function buildFnbShopRecipeDetailXlsx(recipes: Array<{
  plu: string
  name: string
  cost: number
  sell: number
  ingredientName: string
  measurement: string
  category?: string
}>): Promise<Uint8Array> {
  const rows: (string | number | null)[][] = [
    ['RECIPE LIST', '• Close Window'],
    ['Test Hotel > Beverage', '• Print This Page'],
    ['Printed by Test, 01/01/2026 00:00:00'],
    ['PLU Number', 'Menu Name', 'Measurement', 'Cost Price', 'Selling Price', 'GP', 'Target GP'],
    [],
  ]

  let lastCategory = ''
  for (const recipe of recipes) {
    const category = recipe.category ?? 'Beverage > Red Wine > Test'
    if (category !== lastCategory) {
      rows.push([category])
      rows.push([])
      lastCategory = category
    }
    rows.push([recipe.plu, recipe.name, null, recipe.cost, recipe.sell, 0.5, 0.7])
    rows.push([null, recipe.ingredientName, recipe.measurement, recipe.cost, null, null])
    rows.push([])
  }

  const shared: string[] = []
  const sharedIndex = new Map<string, number>()
  const intern = (text: string) => {
    const existing = sharedIndex.get(text)
    if (existing != null) return existing
    const idx = shared.length
    shared.push(text)
    sharedIndex.set(text, idx)
    return idx
  }

  const sheetRowsXml: string[] = []
  rows.forEach((row, rowIdx) => {
    const r = rowIdx + 1
    const cells: string[] = []
    row.forEach((value, colIdx) => {
      if (value == null) return
      const ref = `${colName(colIdx)}${r}`
      if (typeof value === 'number') {
        cells.push(`<c r="${ref}"><v>${value}</v></c>`)
      } else {
        const idx = intern(value)
        cells.push(`<c r="${ref}" t="s"><v>${idx}</v></c>`)
      }
    })
    sheetRowsXml.push(`<row r="${r}">${cells.join('')}</row>`)
  })

  const sharedXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">
${shared.map((s) => `<si><t>${escapeXml(s)}</t></si>`).join('\n')}
</sst>`

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>
${sheetRowsXml.join('\n')}
</sheetData>
</worksheet>`

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Recipe Detail" sheetId="1" r:id="rId1"/></sheets>
</workbook>`

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`

  const zip = new JSZip()
  zip.file('[Content_Types].xml', contentTypes)
  zip.file('_rels/.rels', rootRels)
  zip.file('xl/workbook.xml', workbookXml)
  zip.file('xl/_rels/workbook.xml.rels', workbookRels)
  zip.file('xl/sharedStrings.xml', sharedXml)
  zip.file('xl/worksheets/sheet1.xml', sheetXml)

  const buffer = await zip.generateAsync({ type: 'uint8array' })
  return buffer
}

export function buildMicrosCsvs(options: {
  masters: Array<{
    id: string
    objectNumber: string
    name: string
  }>
  definitions: Array<{
    id: string
    masterId: string
    firstName: string
    mainMenuLevel: string
  }>
  prices: Array<{
    id: string
    defId: string
    price: string
  }>
}): {
  master: Uint8Array
  definition: Uint8Array
  price: Uint8Array
} {
  const masterLines = [
    'Id,MasterName,ReportGroup,Status,MajorGroup,FamilyGroup,RecipeLink,MenuItemName,ObjectNumber,HierarchyId',
    ...options.masters.map(
      (m) =>
        `${m.id},${m.id},1,00000000\t,3,3000,,${csvEscape(m.name)},${m.objectNumber},4465`
    ),
  ]
  const definitionHeader = [
    'Id',
    'FirstName',
    'SecondName',
    'ThirdName',
    'SLUSort',
    'Surcharge',
    'DefinitionOptionBits',
    'SpecialCount',
    'Icon',
    'Tare',
    'PrepTime',
    'NLU',
    'MoveFlag',
    'NLUGroup',
    'SLU',
    'MobileSLU',
    'MainMenuLevel',
    'SubMenuLevel',
    'PrefixLevelOverride',
    'PrintClassOverride',
    'MenuItemClass',
    'LongDescriptor',
    'Quantity',
    'HierarchyId',
    'DefinitionSequence',
    'MenuItemMasterId',
    'ConsumerFacingDescription',
    'ConsumerFacingImageDetails',
    'ConsumerFacingName',
  ]
  const definitionLines = [
    definitionHeader.join(','),
    ...options.definitions.map((d) => {
      const row = Array(definitionHeader.length).fill('')
      row[0] = d.id
      row[1] = csvEscape(d.firstName)
      row[16] = d.mainMenuLevel
      row[23] = '4465'
      row[24] = '1'
      row[25] = d.masterId
      return row.join(',')
    }),
  ]
  const priceLines = [
    'Id,PriceOptionBits,Price,PrepCost,MenuLevel,TaxClass,ServiceChargeGroup,HierarchyId,PriceSequence,MenuItemDefID,EffectivityGroup',
    ...options.prices.map(
      (p) => `${p.id},00000000\t,${p.price},,,, ,4465,1,${p.defId},`
    ),
  ]

  return {
    master: encodeCp1252(masterLines.join('\n') + '\n'),
    definition: encodeCp1252(definitionLines.join('\n') + '\n'),
    price: new TextEncoder().encode(priceLines.join('\n') + '\n'),
  }
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function encodeCp1252(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

export async function standardFixtureSet() {
  const fnbshop = await buildFnbShopRecipeDetailXlsx([
    {
      plu: '5000001',
      name: 'Alpha Full Bottle',
      cost: 21,
      sell: 60,
      ingredientName: 'Alpha Wine, Btl750 ML',
      measurement: '750 ML',
    },
    {
      plu: '5000002',
      name: 'Beta Partial Serve',
      cost: 5,
      sell: 12,
      ingredientName: 'Beta Wine, Btl750 ML',
      measurement: '175 ML',
      category: 'Beverage > Red Wine > Glass & Carafe',
    },
    {
      plu: '5000003',
      name: 'Gamma Zero Cost',
      cost: 0,
      sell: 40,
      ingredientName: 'Gamma Wine, Btl750 ML',
      measurement: '750 ML',
    },
    {
      plu: '5000004',
      name: 'Delta Missing Micros',
      cost: 18,
      sell: 55,
      ingredientName: 'Delta Wine, Btl375 ML',
      measurement: '375 ML',
      category: 'Beverage > Red Wine > Halves',
    },
    {
      plu: '5000005',
      name: 'Epsilon Magnum',
      cost: 40,
      sell: 120,
      ingredientName: 'Epsilon Wine, Btl1500 ML',
      measurement: '1500 ML',
      category: 'Beverage > Red Wine > Magnum',
    },
    {
      plu: '5000006',
      name: 'Zeta Disabled Till',
      cost: 22,
      sell: 70,
      ingredientName: 'Zeta Wine, Btl750 ML',
      measurement: '750 ML',
    },
    {
      plu: '1050053',
      name: 'Cocktail Ignored',
      cost: 1,
      sell: 10,
      ingredientName: 'Spirit, Btl700 ML',
      measurement: '25 ML',
      category: 'Beverage > Cocktails > Classics',
    },
  ])

  const micros = buildMicrosCsvs({
    masters: [
      { id: '100', objectNumber: '5000001', name: 'Alpha Full Btl' },
      { id: '101', objectNumber: '5000002', name: 'Beta Partial Serve' },
      { id: '102', objectNumber: '5000003', name: 'Gamma Zero Cost' },
      { id: '104', objectNumber: '5000005', name: 'Epsilon Magnum' },
      { id: '105', objectNumber: '5000006', name: 'Zeta Disabled Till' },
      { id: '200', objectNumber: '5000100', name: '***WINE HEADING***' },
      { id: '201', objectNumber: '5000101', name: 'RC House Red' },
      { id: '202', objectNumber: '5000102', name: 'Old Disabled Wine' },
      { id: '203', objectNumber: '5000103', name: 'Active Micros Only Wine' },
    ],
    definitions: [
      { id: '1000', masterId: '100', firstName: 'Alpha Full Btl', mainMenuLevel: '11111111' },
      { id: '1001', masterId: '101', firstName: 'Beta Partial Serve', mainMenuLevel: '11111111' },
      { id: '1002', masterId: '102', firstName: 'Gamma Zero Cost', mainMenuLevel: '11111111' },
      { id: '1004', masterId: '104', firstName: 'Epsilon Magnum', mainMenuLevel: '11111111' },
      { id: '1005', masterId: '105', firstName: 'Zeta Disabled Till', mainMenuLevel: '00000000' },
      { id: '1200', masterId: '200', firstName: '***WINE HEADING***', mainMenuLevel: '00000000' },
      { id: '1201', masterId: '201', firstName: 'RC House Red', mainMenuLevel: '11111111' },
      { id: '1202', masterId: '202', firstName: 'Old Disabled Wine', mainMenuLevel: '00000000' },
      { id: '1203', masterId: '203', firstName: 'Active Micros Only Wine', mainMenuLevel: '11111111' },
    ],
    prices: [
      { id: '2000', defId: '1000', price: '65' },
      { id: '2001', defId: '1001', price: '12' },
      { id: '2002', defId: '1002', price: '40' },
      { id: '2004', defId: '1004', price: '120' },
      { id: '2005', defId: '1005', price: '70' },
      { id: '2200', defId: '1200', price: '' },
      { id: '2201', defId: '1201', price: '30' },
      { id: '2202', defId: '1202', price: '25' },
      { id: '2203', defId: '1203', price: '55' },
    ],
  })

  return {
    fnbshop,
    ...micros,
    filenames: {
      fnbshopRecipeDetail: 'Recipe Detail.xlsx',
      microsMenuItemMaster: 'MenuItemMaster.csv',
      microsMenuItemDefinition: 'MenuItemDefinition.csv',
      microsMenuItemPrice: 'MenuItemPrice.csv',
    },
  }
}
