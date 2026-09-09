// The app is served from a single host (e.g. cfms-1-vcat.onrender.com),
// with each community reachable at its own PATH rather than its own
// subdomain — https://<host>/<community-slug> — because Render's free
// static-site hosting doesn't give every community its own subdomain.
// App.jsx's "/:communitySlug" route reads the slug straight from the URL
// via useParams(), which is the primary mechanism now (see Login.jsx).
//
// APP_BASE_DOMAIN / currentCommunitySlug() below are kept only for a
// possible future move to real per-community subdomains on a custom
// domain — currentCommunitySlug() returns null on the current onrender.com
// path-based setup (the hostname never ends with APP_BASE_DOMAIN), so it's
// inert today and safe to leave in place.
export const APP_BASE_DOMAIN = import.meta.env.VITE_APP_BASE_DOMAIN || 'oudaa.app'

export function currentCommunitySlug() {
  if (typeof window === 'undefined') return null
  const host = window.location.hostname

  if (host === 'localhost' || /^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return null
  if (!host.endsWith(APP_BASE_DOMAIN)) return null

  const prefix = host.slice(0, -APP_BASE_DOMAIN.length).replace(/\.$/, '')
  if (!prefix || prefix === 'www' || prefix === 'app') return null

  return prefix
}

// Builds this community's permanent login link: <current origin>/<slug>.
// Uses window.location.origin (not a hardcoded domain) so this is correct
// whether the app is running on cfms-1-vcat.onrender.com, a future custom
// domain, or localhost during development — and matches exactly what
// App.jsx's "/:communitySlug" route and the backend's registerCommunity
// welcome email both point at.
export function communityUrl(slug) {
  if (typeof window === 'undefined') return `/${slug}`
  return `${window.location.origin}/${slug}`
}

// Path segments that are never a community slug, because a real route is
// already mounted there (see App.jsx) — a community named e.g. "admin"
// already can't be created (RESERVED_SLUGS on the backend covers the
// platform-route collisions), but this keeps the frontend's own routing
// unambiguous regardless.
export const RESERVED_PATH_SLUGS = new Set([
  'login', 'signup', 'privacy', 'terms', 'forgot-password', 'reset-password',
  'admin', 'resident',
])
