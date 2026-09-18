const PLACEHOLDER_RE = /\$\{[^}]+\}|\{[A-Za-z0-9_.-]+\}/g

const CAPTURE_TRANSLATIONS = new Map([
  ['all time', 'ሁሉም ጊዜ'],
  ['now', 'አሁን'],
  ['any', 'ማንኛውም'],
  ['bank', 'ባንክ'],
  ['this fund', 'ይህ ፈንድ'],
  ['no account set', 'የመለያ ቁጥር አልተዘጋጀም'],
  ['no phone set', 'ስልክ አልተዘጋጀም'],
  ['A resident', 'ነዋሪ'],
  ['Payment', 'ክፍያ'],
  ['it', 'እሱን'],
  ['them', 'እነሱን'],
  ['s', ''],
  ['records', 'መዝገቦች'],
  ['record', 'መዝገብ'],
  ['pending', 'በመጠባበቅ ላይ'],
  ['verified', 'የተረጋገጠ'],
  ['rejected', 'ውድቅ የተደረገ'],
  ['approved', 'የጸደቀ'],
  ['January', 'ጃንዩወሪ'],
  ['February', 'ፌብሩወሪ'],
  ['March', 'ማርች'],
  ['April', 'ኤፕሪል'],
  ['May', 'ሜይ'],
  ['June', 'ጁን'],
  ['July', 'ጁላይ'],
  ['August', 'ኦገስት'],
  ['September', 'ሴፕቴምበር'],
  ['October', 'ኦክቶበር'],
  ['November', 'ኖቬምበር'],
  ['December', 'ዲሴምበር'],
])

const attrNames = ['placeholder', 'title', 'aria-label', 'aria-placeholder', 'alt']
const originalText = new WeakMap()
const originalAttrs = new WeakMap()
let observer = null
let applying = false
let currentLanguage = 'en'
let exactMap = new Map()
let normalizedExactMap = new Map()
let templates = []

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function translateCapture(value) {
  const trimmed = String(value ?? '')
  return CAPTURE_TRANSLATIONS.get(trimmed) ?? trimmed
}

function buildTemplateMatcher(source, translation) {
  const sourceTokens = source.match(PLACEHOLDER_RE) || []
  if (!sourceTokens.length) return null

  const parts = source.split(PLACEHOLDER_RE)
  let pattern = '^'
  for (let i = 0; i < parts.length; i += 1) {
    pattern += escapeRegex(parts[i])
    if (i < sourceTokens.length) pattern += '(.*?)'
  }
  pattern += '$'

  let matcher
  try {
    matcher = new RegExp(pattern, 's')
  } catch {
    return null
  }

  const replacementTokens = translation.match(PLACEHOLDER_RE) || []
  if (replacementTokens.length !== sourceTokens.length) return null
  return { matcher, translation, tokens: replacementTokens }
}

function rebuildCatalogs(en, am) {
  exactMap = new Map()
  normalizedExactMap = new Map()
  templates = []
  for (const key of Object.keys(en || {})) {
    const source = String(en[key] ?? '')
    const translation = String(am?.[key] ?? '')
    if (!translation || translation === source) continue
    if (source.match(PLACEHOLDER_RE)) {
      const item = buildTemplateMatcher(source, translation)
      if (item) templates.push(item)
      continue
    }
    const existing = exactMap.get(source)
    if (existing === undefined) exactMap.set(source, translation)
    else if (existing !== translation) exactMap.delete(source)

    const normalizedSource = normalizeWhitespace(source)
    if (normalizedSource) {
      const normalizedExisting = normalizedExactMap.get(normalizedSource)
      if (normalizedExisting === undefined) normalizedExactMap.set(normalizedSource, translation)
      else if (normalizedExisting !== translation) normalizedExactMap.delete(normalizedSource)
    }
  }
}

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function translateValue(value) {
  const text = String(value ?? '')
  if (currentLanguage !== 'am' || !text.trim()) return text
  const exact = exactMap.get(text)
  if (exact) return exact

  const normalized = normalizeWhitespace(text)
  const normalizedExact = normalizedExactMap.get(normalized)
  if (normalizedExact) {
    const leading = text.match(/^\s*/)?.[0] || ''
    const trailing = text.match(/\s*$/)?.[0] || ''
    return `${leading}${normalizedExact}${trailing}`
  }

  for (const item of templates) {
    const match = text.match(item.matcher)
    if (!match) continue
    let n = 0
    return item.translation.replace(PLACEHOLDER_RE, () => translateCapture(match[++n]))
  }

  return text
}

function shouldSkipTextNode(node) {
  const parent = node.parentElement
  if (!parent) return true
  const tag = parent.tagName?.toLowerCase()
  return ['script', 'style', 'noscript', 'textarea'].includes(tag) || parent.isContentEditable
}

function localizeTextNode(node) {
  if (shouldSkipTextNode(node)) return
  const now = node.nodeValue || ''
  if (!originalText.has(node)) originalText.set(node, now)
  else if (currentLanguage === 'am') {
    const oldOriginal = originalText.get(node)
    const oldLocalized = translateValue(oldOriginal)
    if (now !== oldOriginal && now !== oldLocalized) originalText.set(node, now)
  }

  const source = originalText.get(node) || ''
  const next = currentLanguage === 'am' ? translateValue(source) : source
  if (node.nodeValue !== next) node.nodeValue = next
}

function localizeElementAttributes(element) {
  for (const attr of attrNames) {
    if (!element.hasAttribute(attr)) continue
    if (!originalAttrs.has(element)) originalAttrs.set(element, {})
    const record = originalAttrs.get(element)
    const current = element.getAttribute(attr) || ''
    if (!(attr in record)) record[attr] = current
    else if (currentLanguage === 'am') {
      const oldOriginal = record[attr]
      const oldLocalized = translateValue(oldOriginal)
      if (current !== oldOriginal && current !== oldLocalized) record[attr] = current
    }
    const source = record[attr] || ''
    const next = currentLanguage === 'am' ? translateValue(source) : source
    if (current !== next) element.setAttribute(attr, next)
  }
}

function scanDocument() {
  if (typeof document === 'undefined') return
  // The marketing landing page is deliberately excluded from localization.
  if (window.location.pathname === '/') return

  const root = document.body
  if (!root) return

  applying = true
  try {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const nodes = []
    let node
    while ((node = walker.nextNode())) nodes.push(node)
    nodes.forEach(localizeTextNode)
    root.querySelectorAll('*').forEach(localizeElementAttributes)
  } finally {
    applying = false
  }
}

export function initializeRuntimeLocalization(en, am) {
  rebuildCatalogs(en, am)
  if (observer) observer.disconnect()
  observer = new MutationObserver((mutations) => {
    if (applying || !mutations.length) return
    scanDocument()
  })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: attrNames })
  scanDocument()
}

export function setRuntimeLanguage(language) {
  currentLanguage = language === 'am' ? 'am' : 'en'
  scanDocument()
}
