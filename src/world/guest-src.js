// Which page a NetGL guest comes from. A guest's GL calls replay into our
// context, so where they may come from is a security decision: each guest
// has a fixed page and an allow-list of origins. A `?<name>_src=`
// override may name another page on an allowed origin (https) from any
// page: the guest apps' own PR previews (celestiary.org/web/pr-preview/…,
// pablo-mayrgundter.github.io/netmap/pr-preview/…), so a change that spans
// exo and a guest can be tried on the previews before either merges. A
// loopback guest counts only on a page served from loopback (or a dev
// server). Shared by the abode's sky (celestiary-sky.js) and the NetMap
// gate (netmap-window.js).

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Whether `origin` is a loopback origin, any port. */
export function isLocalOrigin(origin) {
  try {
    const u = new URL(origin)
    return (u.protocol === 'http:' || u.protocol === 'https:') && LOCAL_HOSTS.has(u.hostname)
  } catch {
    return false
  }
}

/**
 * The guest page to load: `src` (on one of `origins`) unless `param`, the
 * override, is allowed: an https page on one of `origins` from any page,
 * or a loopback page from a loopback page.
 * @returns {{src: string, origin: string, rejected: string|null}}
 */
export function resolveGuestSrc({ src, origins, param = null, pageOrigin, dev = false }) {
  const fallback = { src, origin: new URL(src).origin, rejected: null }
  if (!param) return fallback
  const local = dev || isLocalOrigin(pageOrigin)
  let u = null
  try { u = new URL(param) } catch { /* rejected below */ }
  const clean = u && !u.username && !u.password
  // Another page on an allowed origin, from anywhere; a loopback guest only from loopback.
  const allowed = clean && u.protocol === 'https:' && origins.includes(u.origin)
  const loopback = clean && local && (u.protocol === 'http:' || u.protocol === 'https:') && isLocalOrigin(u.origin)
  const ok = allowed || loopback
  if (ok) return { src: u.href, origin: u.origin, rejected: null }
  return { ...fallback, rejected: param }
}
