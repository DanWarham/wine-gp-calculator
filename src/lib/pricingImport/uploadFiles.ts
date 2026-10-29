export interface PricingImportUploadBuffers {
  fnbshopRecipeDetail: Uint8Array
  microsMenuItemMaster: Uint8Array
  microsMenuItemDefinition: Uint8Array
  microsMenuItemPrice: Uint8Array
  filenames: {
    fnbshopRecipeDetail: string
    microsMenuItemMaster: string
    microsMenuItemDefinition: string
    microsMenuItemPrice: string
  }
}

const MAX_FILE_BYTES = 15 * 1024 * 1024

const FIELD_MAP = {
  fnbshopRecipeDetail: {
    acceptExt: ['.xlsx'],
    label: 'FnbShop Recipe Detail',
  },
  microsMenuItemMaster: {
    acceptExt: ['.csv'],
    label: 'Micros Menu Item Master',
  },
  microsMenuItemDefinition: {
    acceptExt: ['.csv'],
    label: 'Micros Menu Item Definition',
  },
  microsMenuItemPrice: {
    acceptExt: ['.csv'],
    label: 'Micros Menu Item Price',
  },
} as const

type FieldKey = keyof typeof FIELD_MAP

function extensionOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

async function readRequiredFile(
  form: FormData,
  key: FieldKey
): Promise<{ ok: true; file: File; bytes: Uint8Array } | { ok: false; error: string }> {
  const value = form.get(key)
  if (!value || !(value instanceof File)) {
    return { ok: false, error: `Missing required file: ${FIELD_MAP[key].label}.` }
  }
  if (value.size <= 0) {
    return { ok: false, error: `${FIELD_MAP[key].label} is empty.` }
  }
  if (value.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      error: `${FIELD_MAP[key].label} exceeds the maximum upload size (15MB).`,
    }
  }
  const ext = extensionOf(value.name)
  const accepted: readonly string[] = FIELD_MAP[key].acceptExt
  if (!accepted.includes(ext)) {
    return {
      ok: false,
      error: `${FIELD_MAP[key].label} must be a ${FIELD_MAP[key].acceptExt.join(' or ')} file.`,
    }
  }
  const buffer = new Uint8Array(await value.arrayBuffer())
  return { ok: true, file: value, bytes: buffer }
}

export async function readPricingImportFormData(
  form: FormData
): Promise<{ ok: true; data: PricingImportUploadBuffers } | { ok: false; error: string }> {
  const keys = Object.keys(FIELD_MAP) as FieldKey[]
  const collected: Partial<PricingImportUploadBuffers> = { filenames: {} as PricingImportUploadBuffers['filenames'] }

  for (const key of keys) {
    const result = await readRequiredFile(form, key)
    if (!result.ok) return result
    ;(collected as Record<string, unknown>)[key] = result.bytes
    collected.filenames![key] = result.file.name
  }

  return { ok: true, data: collected as PricingImportUploadBuffers }
}
