// Which page a NetGL guest comes from. A guest's GL calls replay into our
// context, so where they may come from is a security decision: each guest
// has a fixed page and an allow-list of origins, and a `?<name>_src=`
// override counts only on a page served from loopback (or a dev server),
// and only for a loopback or allowed origin. Shared by the abode's sky
// (celestiary-sky.js) and the NetMap gate (netmap-window.js).

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
 * override, is allowed.
 * @returns {{src: string, origin: string, rejected: string|null}}
 */
export function resolveGuestSrc({ src, origins, param = null, pageOrigin, dev = false }) {
  const fallback = { src, origin: new URL(src).origin, rejected: null }
  if (!param) return fallback
  const local = dev || isLocalOrigin(pageOrigin)
  let u = null
  try { u = new URL(param) } catch { /* rejected below */ }
  const ok = local && u && !u.username && !u.password &&
    (u.protocol === 'https:' || (u.protocol === 'http:' && isLocalOrigin(u.origin))) &&
    (origins.includes(u.origin) || isLocalOrigin(u.origin))
  if (ok) return { src: u.href, origin: u.origin, rejected: null }
  return { ...fallback, rejected: param }
}
