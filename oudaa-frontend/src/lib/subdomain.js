// The production app is served from subdomains of one base domain —
// acme.oudaa.app, beta.oudaa.app, etc. Configure the base domain via
// VITE_APP_BASE_DOMAIN (e.g. "oudaa.app"); defaults to a value that makes
// the preview links in the signup wizard readable even before that's set.
export const APP_BASE_DOMAIN = import.meta.env.VITE_APP_BASE_DOMAIN || 'oudaa.app'

// Returns the community slug the app is currently being served from, or
// null when there isn't one — localhost, an IP, the bare base domain
// itself, or a "www" host all count as "no subdomain" so local
// development and the marketing/apex domain both keep working exactly as
// before.
export function currentCommunitySlug() {
  if (typeof window === 'undefined') return null
  const host = window.location.hostname

  if (host === 'localhost' || /^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return null
  if (!host.endsWith(APP_BASE_DOMAIN)) return null

  const prefix = host.slice(0, -APP_BASE_DOMAIN.length).replace(/\.$/, '')
  if (!prefix || prefix === 'www' || prefix === 'app') return null

  return prefix
}

export function communityUrl(slug) {
  return `https://${slug}.${APP_BASE_DOMAIN}`
}
