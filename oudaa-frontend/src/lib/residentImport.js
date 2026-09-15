import * as XLSX from 'xlsx'

// Single source of truth for the bulk-import spreadsheet's shape — the
// template generator, the in-app "what goes in each column" legend, and
// the upload parser all read from this instead of three separate lists
// that could drift out of sync with each other.
//
// `required` here mirrors what the backend actually enforces
// (residentController.bulkImportResidents / createResident): Full Name,
// Email, and Unit / House Number are the only columns a resident record
// can't exist without. Everything else is genuinely nullable — leaving it
// blank does not fail the import.
export const RESIDENT_IMPORT_COLUMNS = [
  { key: 'fullName', header: 'Full Name*', required: true, width: 24, note: 'Required.' },
  { key: 'email', header: 'Email*', required: true, width: 28, note: 'Required. Must be unique — no two residents can share an email.' },
  { key: 'unitNumber', header: 'Unit / House Number*', required: true, width: 20, note: 'Required. Must be unique within your community.' },
  { key: 'phone', header: 'Phone*', required: true, width: 18, note: 'Required. Must be unique.' },
  { key: 'idNumber', header: 'ID Number*', required: true, width: 18, note: 'Required. National/resident ID. Must be unique.' },
  { key: 'address', header: 'Address', required: false, width: 28, note: 'Optional.' },
  { key: 'ownerType', header: 'Owner or Tenant*', required: true, width: 16, note: 'Required — write "Owner" or "Tenant".' },
]

const EXAMPLE_ROW_MARKER = 'EXAMPLE — DELETE THIS ROW'

// Normalizes a header cell ("Full Name*", " full name ", "full_name") down
// to a bare comparable key so the parser doesn't care about the asterisk,
// casing, or minor spacing differences someone might introduce while
// editing the template.
function normalizeHeader(text) {
  return String(text || '')
    .replace(/\*/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const HEADER_ALIASES = {
  'full name': 'fullName',
  'name': 'fullName',
  'email': 'email',
  'unit house number': 'unitNumber',
  'unit number': 'unitNumber',
  'house number': 'unitNumber',
  'unit': 'unitNumber',
  'phone': 'phone',
  'phone number': 'phone',
  'id number': 'idNumber',
  'id': 'idNumber',
  'address': 'address',
  'owner or tenant': 'ownerType',
  'owner tenant': 'ownerType',
  'owner type': 'ownerType',
}

/**
 * Builds and downloads the .xlsx bulk-import template. The first several
 * rows are a plain-language legend (which columns are required vs.
 * optional) rather than relying on the header row's asterisks alone —
 * the person filling this out often isn't the person who read this
 * feature's instructions, so the "why" needs to travel with the file
 * itself, not just live in a tooltip in the app.
 */
export function downloadResidentImportTemplate() {
  const wb = XLSX.utils.book_new()

  const legend = [
    ['Hivee — Bulk Resident Import Template'],
    [],
    ['Fill in one resident per row below the header row. Do not rename, reorder, or delete columns.'],
    ['Columns marked with * are required — a row missing one of these will be skipped and reported back to you.'],
    ['All other columns are optional and can be left blank.'],
    [],
    ['Column', 'Required?', 'Notes'],
    ...RESIDENT_IMPORT_COLUMNS.map((c) => [c.header.replace('*', ''), c.required ? 'Required' : 'Optional', c.note]),
    [],
    ['Each resident is created with a system-generated temporary password and emailed their login details automatically —'],
    ['do not add a password column.'],
    [],
  ]

  const header = RESIDENT_IMPORT_COLUMNS.map((c) => c.header)
  const exampleRow = [
    EXAMPLE_ROW_MARKER, 'example.resident@email.com', 'A-204', '0911223344', 'ID-00123', 'Bole, Addis Ababa', 'Owner',
  ]

  const aoa = [...legend, header, exampleRow]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = RESIDENT_IMPORT_COLUMNS.map((c) => ({ wch: c.width }))

  const headerRowIdx = legend.length
  RESIDENT_IMPORT_COLUMNS.forEach((_, i) => {
    const ref = XLSX.utils.encode_cell({ r: headerRowIdx, c: i })
    if (ws[ref]) ws[ref].s = { font: { bold: true } }
  })
  if (ws['A1']) ws['A1'].s = { font: { bold: true, sz: 14 } }

  XLSX.utils.book_append_sheet(wb, ws, 'Residents')
  XLSX.writeFile(wb, 'hivee-resident-import-template.xlsx')
}

/**
 * Reads an uploaded .xlsx/.csv file and returns { rows, skippedExample }.
 * `rows` is an array of { fullName, email, unitNumber, phone, idNumber,
 * address, ownerType } objects with blank cells normalized to undefined —
 * ready to hand straight to DataContext.bulkImportResidents. Per-field
 * validation (required-ness, uniqueness) intentionally happens server-side
 * so every row gets a precise, authoritative reason if it's rejected,
 * rather than this function silently guessing.
 *
 * Finds the real header row by content (looks for the "Full Name" column)
 * instead of assuming a fixed row number, so it still works if someone
 * adds/removes a line from the legend above it.
 */
export async function parseResidentImportFile(file) {
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) throw new Error('That file has no readable sheet.')

  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false })

  const headerRowIndex = grid.findIndex((row) =>
    row.some((cell) => normalizeHeader(cell) in HEADER_ALIASES && HEADER_ALIASES[normalizeHeader(cell)] === 'fullName')
  )
  if (headerRowIndex === -1) {
    throw new Error("Couldn't find the header row (looking for a \"Full Name\" column) — please use the provided template without renaming its columns.")
  }

  const headerRow = grid[headerRowIndex]
  const fieldByColumn = headerRow.map((cell) => HEADER_ALIASES[normalizeHeader(cell)] || null)

  let skippedExample = false
  const rows = []
  for (const rawRow of grid.slice(headerRowIndex + 1)) {
    const record = {}
    fieldByColumn.forEach((field, i) => {
      if (!field) return
      const value = rawRow[i]
      const str = value === undefined || value === null ? '' : String(value).trim()
      if (str) record[field] = str
    })
    if (Object.keys(record).length === 0) continue // fully blank row
    if (record.fullName === EXAMPLE_ROW_MARKER) { skippedExample = true; continue }
    rows.push(record)
  }

  return { rows, skippedExample }
}
