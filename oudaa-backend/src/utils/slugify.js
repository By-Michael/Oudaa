const prisma = require('../config/prisma');

// Turns a community name (or an explicitly-requested handle) into a
// lowercase, hyphenated, URL-and-DNS-safe slug — this becomes the
// subdomain the community is reached at (e.g. "Bole Ridge Villas" ->
// "bole-ridge-villas" -> bole-ridge-villas.oudaa.app).
function baseSlug(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63) || 'community';
}

// Appends -2, -3, ... until the slug is free. Sequential by design (a
// community is created rarely enough that the extra round trip per
// collision is a non-issue) — favors predictable, short slugs over a
// random suffix.
async function generateUniqueSlug(input) {
  const base = baseSlug(input);
  let candidate = base;
  let n = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await prisma.community.findUnique({ where: { slug: candidate } });
    if (!existing) return candidate;
    candidate = `${base}-${n}`;
    n += 1;
  }
}

const RESERVED_SLUGS = new Set([
  'www', 'app', 'api', 'admin', 'mail', 'ftp', 'staging', 'dev', 'test',
  'assets', 'static', 'cdn', 'blog', 'help', 'support', 'status', 'docs',
]);

module.exports = { baseSlug, generateUniqueSlug, RESERVED_SLUGS };
