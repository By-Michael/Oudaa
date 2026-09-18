// Ethiopian calendar utilities. Internal API/storage dates remain ISO/Gregorian;
// this module converts only at the presentation/input boundary so existing
// backend data contracts remain stable.

export const CALENDAR_OPTIONS = [
  { id: 'gregorian', label: 'Gregorian' },
  { id: 'ethiopian', label: 'የኢትዮጵያ ዘመን አቆጣጠር' },
]

export const ETHIOPIAN_MONTHS = [
  'መስከረም',
  'ጥቅምት',
  'ኅዳር',
  'ታኅሣሥ',
  'ጥር',
  'የካቲት',
  'መጋቢት',
  'ሚያዝያ',
  'ግንቦት',
  'ሰኔ',
  'ሐምሌ',
  'ነሐሴ',
  'ጳጉሜ',
]

export const ETHIOPIAN_WEEKDAYS = ['ሰኞ', 'ማክሰኞ', 'ረቡዕ', 'ሐሙስ', 'ዓርብ', 'ቅዳሜ', 'ዕሁድ']
const ETHIOPIAN_EPOCH_JDN = 1724221
const ETHIOPIAN_REVERSE_EPOCH_JDN = 1723856
const CALENDAR_STORAGE_KEY = 'oudaa-calendar'

function mod(value, divisor) {
  return value - divisor * Math.floor(value / divisor)
}

function gregorianToJdn(year, month, day) {
  const a = Math.floor((14 - month) / 12)
  const y = year + 4800 - a
  const m = month + 12 * a - 3
  return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045
}

function jdnToGregorian(jdn) {
  const a = jdn + 32044
  const b = Math.floor((4 * a + 3) / 146097)
  const c = a - Math.floor((146097 * b) / 4)
  const d = Math.floor((4 * c + 3) / 1461)
  const e = c - Math.floor((1461 * d) / 4)
  const m = Math.floor((5 * e + 2) / 153)
  return {
    year: 100 * b + d - 4800 + Math.floor(m / 10),
    month: m + 3 - 12 * Math.floor(m / 10),
    day: e - Math.floor((153 * m + 2) / 5) + 1,
  }
}

export function isEthiopianLeapYear(year) {
  return mod(year, 4) === 3
}

export function daysInEthiopianMonth(year, month) {
  if (month >= 1 && month <= 12) return 30
  if (month === 13) return isEthiopianLeapYear(year) ? 6 : 5
  return 0
}

export function ethiopianToJdn(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) throw new Error('Invalid Ethiopian date')
  const max = daysInEthiopianMonth(year, month)
  if (max === 0 || day < 1 || day > max) throw new Error('Invalid Ethiopian date')
  return ETHIOPIAN_EPOCH_JDN + 365 * (year - 1) + Math.floor(year / 4) + 30 * (month - 1) + day - 1
}

export function ethiopianToGregorian(ethiopian) {
  const jdn = ethiopianToJdn(ethiopian.year, ethiopian.month, ethiopian.day)
  return jdnToGregorian(jdn)
}

export function gregorianToEthiopian(gregorian) {
  const jdn = gregorianToJdn(gregorian.year, gregorian.month, gregorian.day)
  const r = mod(jdn - ETHIOPIAN_REVERSE_EPOCH_JDN, 1461)
  const n = mod(r, 365) + 365 * Math.floor(r / 1460)
  const year = 4 * Math.floor((jdn - ETHIOPIAN_REVERSE_EPOCH_JDN) / 1461) + Math.floor(r / 365) - Math.floor(r / 1460)
  const month = Math.floor(n / 30) + 1
  const day = mod(n, 30) + 1
  return { year, month, day }
}

function parseDateParts(value) {
  if (!value) return null
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (match) return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
  }
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }
}

export function toEthiopian(value) {
  const parts = parseDateParts(value)
  return parts ? gregorianToEthiopian(parts) : null
}

export function toGregorian(value) {
  if (!value) return null
  if (value instanceof Date || typeof value === 'string') {
    const parts = parseDateParts(value)
    return parts
  }
  return ethiopianToGregorian(value)
}

export function isoDateFromParts(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function ethiopianToIsoDate(year, month, day) {
  const g = ethiopianToGregorian({ year, month, day })
  return isoDateFromParts(g.year, g.month, g.day)
}

export function isoDateToEthiopian(value) {
  const e = toEthiopian(value)
  return e ? e : null
}

export function getCalendarPreference() {
  try {
    return localStorage.getItem(CALENDAR_STORAGE_KEY) === 'ethiopian' ? 'ethiopian' : 'gregorian'
  } catch {
    return 'gregorian'
  }
}

export function setCalendarPreference(calendar) {
  try { localStorage.setItem(CALENDAR_STORAGE_KEY, calendar) } catch { /* optional */ }
}

export function formatEthiopianDate(value, { includeEra = true } = {}) {
  const e = toEthiopian(value)
  if (!e) return '—'
  return `${ETHIOPIAN_MONTHS[e.month - 1]} ${e.day}, ${e.year}${includeEra ? ' ዓ.ም.' : ''}`
}

export function formatEthiopianShortDate(value) {
  const e = toEthiopian(value)
  if (!e) return '—'
  return `${e.day} ${ETHIOPIAN_MONTHS[e.month - 1]} ${e.year} ዓ.ም.`
}

export function formatMonthKey(key, calendar = getCalendarPreference(), { short = false, yearDigits = 'full' } = {}) {
  if (!key) return '—'
  const [y, m] = String(key).split('-').map(Number)
  if (!y || !m) return '—'
  if (calendar === 'ethiopian') {
    // Storage month keys are Gregorian. The first Gregorian day maps to the
    // Ethiopian month used for that bucket, preserving existing backend keys.
    const e = gregorianToEthiopian({ year: y, month: m, day: 1 })
    const monthName = short ? ETHIOPIAN_MONTHS[e.month - 1].slice(0, 3) : ETHIOPIAN_MONTHS[e.month - 1]
    return `${monthName} ${yearDigits === '2' ? String(e.year).slice(-2) : e.year}`
  }
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const monthName = short ? names[m - 1].slice(0, 3) : names[m - 1]
  return `${monthName} ${yearDigits === '2' ? String(y).slice(-2) : y}`
}

export function formatDate(value, calendar = getCalendarPreference()) {
  if (!value) return '—'
  if (calendar === 'ethiopian') return formatEthiopianShortDate(value)
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatDateTime(value, calendar = getCalendarPreference()) {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  const datePart = formatDate(d, calendar)
  const timePart = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `${datePart}, ${timePart}`
}

export function calendarYearForGregorianYear(year, calendar = getCalendarPreference()) {
  if (calendar !== 'ethiopian') return year
  const e = gregorianToEthiopian({ year, month: 9, day: 1 })
  return e.year
}


export function formatCurrentMonthLabel(value = new Date(), calendar = getCalendarPreference()) {
  if (calendar === 'ethiopian') {
    const e = toEthiopian(value)
    return e ? `${ETHIOPIAN_MONTHS[e.month - 1]} ${e.year} ዓ.ም.` : '—'
  }
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

export function getCalendarDateParts(value, calendar = getCalendarPreference()) {
  if (calendar === 'ethiopian') return toEthiopian(value)
  return parseDateParts(value)
}

export function weekdayMondayFirst(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day))
  return (d.getUTCDay() + 6) % 7
}

export function currentCalendarDate(calendar = getCalendarPreference()) {
  const now = new Date()
  if (calendar === 'ethiopian') return toEthiopian(now)
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }
}
