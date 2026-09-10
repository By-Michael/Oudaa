// Every signed-in URL in the app is prefixed with the user's own
// community slug — /<slug>/admin, /<slug>/admin/payments,
// /<slug>/resident, etc. — so which community's portal you're in is
// always visible in the address bar, not just inferred from the session.
//
// portalBase() is the one place that decides what that prefix is, so
// every page/nav link builds its URLs off it instead of hardcoding
// "/admin" or "/resident" directly. Falls back to the un-prefixed
// "/admin" / "/resident" path if a user object somehow has no
// communitySlug yet (shouldn't happen post-login since the backend
// always includes the community relation, but keeps old sessions/cached
// localStorage users from being routed somewhere broken).
export function portalBase(user) {
  if (!user) return ''
  const role = user.role === 'admin' ? 'admin' : 'resident'
  return user.communitySlug ? `/${user.communitySlug}/${role}` : `/${role}`
}
