// The chat thread: everything said in the room, in order, for reading back.
//
// Entries are {kind, who, text, t, hue?, aside?}: kind is 'me', 'other',
// 'max' (the bartender) or 'note' (someone came in or left); `aside` marks
// Max thinking aloud rather than talking to you. The thread keeps the last
// `max` of them and saves itself through `save`, so a reload brings the
// conversation back.
//
// It also remembers where you last read (`lastRead`, a time, saved through
// `saveRead`): what came after it, from others or from Max talking to you,
// is unread, through reloads and while the tab sits in the background,
// until you look (markRead). Rendering is mountThread's.

export class Thread {
  /**
   * @param {{max?: number, load?: () => object[] | null, save?: (entries: object[]) => void}} o
   */
  constructor({ max = 200, load = null, save = null, loadRead = null, saveRead = null } = {}) {
    this.max = max
    this.save = save
    this.saveRead = saveRead
    this.entries = []
    this.open = false
    this.listeners = []
    try {
      const saved = load?.()
      if (Array.isArray(saved)) this.entries = saved.filter(valid).slice(-max)
    } catch { /* a bad save: start empty */ }
    // Never read before: what's already here counts as read.
    let read = null
    try { read = loadRead?.() } catch { /* none */ }
    this.lastRead = typeof read === 'number' ? read : (this.entries.at(-1)?.t ?? 0)
  }

  /** Lines that came after you last read, from others or Max talking to you. */
  get unread() {
    let n = 0
    for (let i = this.entries.length - 1; i >= 0 && this.entries[i].t > this.lastRead; i--) if (counts(this.entries[i])) n++
    return n
  }

  /** Where the unread lines start (an index into entries), or -1. */
  firstUnread() {
    let first = -1
    for (let i = this.entries.length - 1; i >= 0 && this.entries[i].t > this.lastRead; i--) if (counts(this.entries[i])) first = i
    return first
  }

  /** You've seen everything up to now. */
  markRead() {
    const t = this.entries.at(-1)?.t ?? 0
    if (t <= this.lastRead) return
    this.lastRead = t
    this.saveRead?.(t)
    this.listeners.forEach((f) => f(null))
  }

  /** Adds an entry; returns it, or null if it wasn't one. */
  add(e) {
    const entry = {
      kind: e.kind, who: String(e.who ?? ''), text: String(e.text ?? '').slice(0, 300), t: e.t ?? Date.now(),
      ...(e.hue != null ? { hue: e.hue } : {}), ...(e.aside ? { aside: true } : {}),
    }
    if (!valid(entry)) return null
    // The same line again from the same voice within a few seconds is one line.
    const last = this.entries.at(-1)
    if (last && last.kind === entry.kind && last.who === entry.who && last.text === entry.text && entry.t - last.t < 5000) return null
    this.entries.push(entry)
    if (this.entries.length > this.max) this.entries.splice(0, this.entries.length - this.max)
    this.save?.(this.entries)
    this.listeners.forEach((f) => f(entry))
    // Saying something means you've read what came before it.
    if (entry.kind === 'me') this.markRead()
    return entry
  }

  setOpen(open) {
    this.open = open
    this.listeners.forEach((f) => f(null))
  }

  onChange(f) { this.listeners.push(f) }
}

const KINDS = new Set(['me', 'other', 'max', 'note'])
/** Does a line count toward unread? Others' words, and Max's unless he's thinking aloud. */
export function counts(e) { return e.kind === 'other' || (e.kind === 'max' && !e.aside) }
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
    li.className = e.kind + (e.aside ? ' aside' : '')
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
  const lines = () => [...list.children].filter((li) => !li.classList.contains('divider'))
  return {
    scrollToEnd() { list.scrollTop = list.scrollHeight },
    /**
     * Marks where unread lines start (an index into the thread's entries)
     * with a divider, and brings it into view; -1 takes the divider away.
     */
    divider(index) {
      list.querySelector('.divider')?.remove()
      if (index < 0) return
      // The list holds the last entries; line up its end with the thread's.
      const all = lines()
      const li = all[all.length - (thread.entries.length - index)]
      if (!li) return
      const d = document.createElement('li')
      d.className = 'divider'
      d.textContent = 'New since you last read'
      li.before(d)
      list.scrollTop = Math.max(0, d.offsetTop - list.offsetTop - 8)
    },
  }
}
