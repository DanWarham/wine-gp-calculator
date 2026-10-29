/**
 * Pure helper for Stage 6B: identify the previous completed import for a user.
 * Ordering is by importedAt ascending chronologically; "previous" means the
 * latest completed import strictly before the reference import.
 */

export interface ImportChronologyRow {
  id: string
  userId: string
  importedAt: string
  status: 'completed'
}

export function selectPreviousCompletedImport(
  imports: ImportChronologyRow[],
  referenceImportId: string
): ImportChronologyRow | null {
  const reference = imports.find((row) => row.id === referenceImportId)
  if (!reference || reference.status !== 'completed') return null

  const candidates = imports
    .filter(
      (row) =>
        row.userId === reference.userId &&
        row.status === 'completed' &&
        row.id !== reference.id &&
        Date.parse(row.importedAt) < Date.parse(reference.importedAt)
    )
    .sort((a, b) => Date.parse(b.importedAt) - Date.parse(a.importedAt))

  return candidates[0] ?? null
}
