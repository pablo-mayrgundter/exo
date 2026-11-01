// The chat thread: everything said in the room, in order, for reading back.
//
// Entries are {kind, who, text, t, hue?}: kind is 'me', 'other', 'max'
// (the bartender) or 'note' (someone came in or left). The thread keeps the
// last `max` of them, counts what arrived while it was closed (others' and
// Max's words, not your own or the notes), and saves itself through
// `save` so a reload brings the conversation back. Rendering is mountThread's.

export class Thread {
  /**
   * @param {{max?: number, load?: () => object[] | null, save?: (entries: object[]) => void}} o
   */
  constructor({ max = 200, load = null, save = null } = {}) {
    this.max = max
    this.save = save
    this.entries = []
    this.unread = 0
    this.open = false
    this.listeners = []
    try {
      const saved = load?.()
      if (Array.isArray(saved)) this.entries = saved.filter(valid).slice(-max)
    } catch { /* a bad save: start empty */ }
  }

  /** Adds an entry; returns it, or null if it wasn't one. */
  add(e) {
    const entry = { kind: e.kind, who: String(e.who ?? ''), text: String(e.text ?? '').slice(0, 300), t: e.t ?? Date.now(), ...(e.hue != null ? { hue: e.hue } : {}) }
    if (!valid(entry)) return null
    // The same line again from the same voice within a few seconds is one line.
    const last = this.entries.at(-1)
    if (last && last.kind === entry.kind && last.who === entry.who && last.text === entry.text && entry.t - last.t < 5000) return null
    this.entries.push(entry)
    if (this.entries.length > this.max) this.entries.splice(0, this.entries.length - this.max)
    if (!this.open && (entry.kind === 'other' || entry.kind === 'max')) this.unread++
    this.save?.(this.entries)
    this.listeners.forEach((f) => f(entry))
    return entry
  }

  setOpen(open) {
    this.open = open
    if (open) this.unread = 0
    this.listeners.forEach((f) => f(null))
  }

  onChange(f) { this.listeners.push(f) }
}

const KINDS = new Set(['me', 'other', 'max', 'note'])
function valid(e) {
  return e && KINDS.has(e.kind) && typeof e.text === 'string' && e.text.length > 0 && typeof e.t === 'number'
}

/** Clock time for a line, as HH:MM in the reader's locale. */
export function timeOf(t) {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * Draws a thread into a list element, and keeps it drawn. New lines scroll
 * into view unless you've scrolled up to read back.
 */
export function mountThread(list, thread) {
  const row = (e) => {
    const li = document.createElement('li')
    li.className = e.kind
    const time = document.createElement('time')
    time.dateTime = new Date(e.t).toISOString()
    time.textContent = timeOf(e.t)
    li.append(time)
    if (e.kind !== 'note') {
      const who = document.createElement('b')
      who.textContent = e.kind === 'me' ? 'you' : e.who
      if (e.hue != null) who.style.color = '#' + Number(e.hue).toString(16).padStart(6, '0')
      li.append(who)
    }
    const text = document.createElement('span')
    text.textContent = e.text
    li.append(text)
    return li
  }
  const atBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 24
  list.replaceChildren(...thread.entries.map(row))
  if (!thread.entries.length) list.dataset.empty = 'true'
  thread.onChange((e) => {
    if (!e) return
    const stick = atBottom()
    delete list.dataset.empty
    list.append(row(e))
    while (list.children.length > thread.max) list.firstChild.remove()
    if (stick || e.kind === 'me') list.scrollTop = list.scrollHeight
  })
  return { scrollToEnd() { list.scrollTop = list.scrollHeight } }
}
