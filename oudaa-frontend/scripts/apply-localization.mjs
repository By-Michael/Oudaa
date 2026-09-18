import fs from 'node:fs'
import path from 'node:path'
import XLSX from 'xlsx'

const workbookPath = process.argv[2] || '../../Oudaa_Localization_Audit.xlsx'
const resolved = path.resolve(process.cwd(), workbookPath)
const workbook = XLSX.readFile(resolved)
const sheet = workbook.Sheets.Localization
if (!sheet) throw new Error('Localization sheet not found.')
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })
const header = rows[0]
const index = Object.fromEntries(header.map((h, i) => [String(h), i]))
for (const field of ['English Text', 'Amharic Translation', 'Suggested Key']) {
  if (index[field] === undefined) throw new Error(`Missing column: ${field}`)
}

const am = {}
const problems = []
const placeholders = (value) => String(value || '').match(/\$\{[^}]+\}|\{[A-Za-z0-9_.-]+\}/g) || []
const sameMultiset = (a, b) => a.slice().sort().join('\u0000') === b.slice().sort().join('\u0000')

for (let r = 1; r < rows.length; r += 1) {
  const row = rows[r]
  const text = row[index['English Text']]
  const translation = row[index['Amharic Translation']]
  const key = row[index['Suggested Key']]
  const id = row[index['ID']]
  if (!text || !key || !translation) continue
  const englishTokens = placeholders(text)
  const amharicTokens = placeholders(translation)
  if (!sameMultiset(englishTokens, amharicTokens)) {
    problems.push(`ID ${id}: placeholder mismatch for ${key}`)
    continue
  }
  am[String(key)] = String(translation)
}

if (problems.length) {
  console.error(problems.slice(0, 50).join('\n'))
  if (problems.length > 50) console.error(`...and ${problems.length - 50} more.`)
  process.exit(2)
}

const out = path.resolve('src/localization/am.json')
// Preserve supplemental/rescan translations already present in the runtime catalog.
let existing = {}
if (fs.existsSync(out)) {
  try { existing = JSON.parse(fs.readFileSync(out, 'utf8')) } catch { existing = {} }
}
for (const [key, translation] of Object.entries(existing)) {
  if (!(key in am) && translation) am[key] = translation
}
fs.writeFileSync(out, JSON.stringify(am, null, 2) + '\n')
console.log(`Applied ${Object.keys(am).length} Amharic translations to ${out}`)
