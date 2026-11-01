// Notifications in the browser tab: for a visitor who keeps exo.cafe open
// in the background (donating compute) and looks in now and then.
//
// Sources (chat today; receipts, orders, mentions later) each report a
// count of what's waiting; the tab shows the total, as "(3) Exo Cafe" in
// its title and as a badge on its icon, and goes back to plain when
// everything's been seen.

/** The title for a total of pending notifications. */
export function titleFor(base, total) {
  return total > 0 ? `(${total > 99 ? '99+' : total}) ${base}` : base
}

/** The badge's text: a count, capped. */
export function badgeText(total) {
  return total > 9 ? '9+' : String(total)
}

/**
 * @param {{doc?: Document, base?: string}} o
 */
export function makeNotifier({ doc = document, base = doc.title } = {}) {
  const counts = new Map()
  let shown = -1
  const link = doc.querySelector('link[rel="icon"]') ?? doc.head.appendChild(Object.assign(doc.createElement('link'), { rel: 'icon' }))
  const icons = new Map() // badge text → data URL

  function icon(total) {
    const key = total > 0 ? badgeText(total) : ''
    if (!icons.has(key)) icons.set(key, drawIcon(doc, key))
    return icons.get(key)
  }

  function render() {
    const total = [...counts.values()].reduce((a, b) => a + b, 0)
    if (total === shown) return
    shown = total
    doc.title = titleFor(base, total)
    const href = icon(total)
    if (href) link.href = href
  }

  render()
  return {
    /** Sets how many notifications a source has waiting. */
    set(source, n) {
      counts.set(source, Math.max(0, n | 0))
      render()
    },
    get total() { return Math.max(0, shown) },
  }
}

/** The tab icon: the chip on the bar's colours, with a badge when something's waiting. */
function drawIcon(doc, badge) {
  const cv = doc.createElement('canvas')
  cv.width = cv.height = 64
  const g = cv.getContext?.('2d')
  if (!g) return null
  g.fillStyle = '#050A1F'
  g.beginPath()
  g.roundRect ? g.roundRect(0, 0, 64, 64, 12) : g.rect(0, 0, 64, 64)
  g.fill()
  // The chip: a body and its pins, in the bar's orange.
  g.strokeStyle = '#FF5A3C'
  g.lineWidth = 5
  g.strokeRect(18, 12, 28, 40)
  for (const y of [21, 32, 43]) {
    g.beginPath(); g.moveTo(8, y); g.lineTo(18, y); g.stroke()
    g.beginPath(); g.moveTo(46, y); g.lineTo(56, y); g.stroke()
  }
  if (badge) {
    g.fillStyle = '#6BEAF2'
    g.beginPath()
    g.arc(46, 18, 18, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#050A1F'
    g.font = `bold ${badge.length > 1 ? 20 : 26}px sans-serif`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(badge, 46, 19)
  }
  return cv.toDataURL('image/png')
}
