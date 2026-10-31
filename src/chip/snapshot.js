// Saving the vCPU between visits: the chip's snapshot (sim.js) plus the
// host's few words of state, packed into one binary blob and kept in the
// browser's origin-private file system (OPFS). A snapshot names the
// program it was taken with; a different program (a new deploy) starts
// fresh rather than resume someone else's RAM.

const FIELDS = ['state', 'pullup', 'pulldown', 'tOn', 'memory']
const MAGIC = 'exo.vcpu/1'

/** FNV-1a over the program image, so a snapshot only loads into the same code. */
export function programId(program) {
  let h = 0x811c9dc5
  for (const [a, b] of program) { h ^= a & 0xff; h = Math.imul(h, 0x01000193); h ^= (a >> 8) ^ b; h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(16)
}

/** Packs a chip snapshot and host state ({json}) into an ArrayBuffer. */
export function encode(snap, host, program) {
  const head = JSON.stringify({
    magic: MAGIC, program: programId(program), halfCycles: snap.halfCycles, host,
    lengths: FIELDS.map((f) => snap[f].length), saved: Date.now(),
  })
  const headBytes = new TextEncoder().encode(head)
  const body = FIELDS.reduce((n, f) => n + snap[f].length, 0)
  const out = new Uint8Array(4 + headBytes.length + body)
  new DataView(out.buffer).setUint32(0, headBytes.length)
  out.set(headBytes, 4)
  let at = 4 + headBytes.length
  for (const f of FIELDS) { out.set(snap[f], at); at += snap[f].length }
  return out.buffer
}

/** The inverse of encode, or null if it's not a snapshot of this program. */
export function decode(buf, program) {
  try {
    const bytes = new Uint8Array(buf)
    const n = new DataView(buf).getUint32(0)
    const head = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + n)))
    if (head.magic !== MAGIC || head.program !== programId(program)) return null
    const snap = { halfCycles: head.halfCycles }
    let at = 4 + n
    FIELDS.forEach((f, i) => { snap[f] = bytes.slice(at, at + head.lengths[i]); at += head.lengths[i] })
    return { snap, host: head.host, saved: head.saved }
  } catch {
    return null
  }
}

const FILE = 'vcpu.snap'

/** Writes to OPFS; false where it isn't available (private windows, old browsers). */
export async function save(buf) {
  try {
    const root = await navigator.storage.getDirectory()
    const fh = await root.getFileHandle(FILE, { create: true })
    if (fh.createWritable) {
      const w = await fh.createWritable()
      await w.write(buf)
      await w.close()
    } else {
      // Safari's workers have only sync access handles.
      const h = await fh.createSyncAccessHandle()
      h.truncate(0)
      h.write(new Uint8Array(buf), { at: 0 })
      h.flush()
      h.close()
    }
    return true
  } catch {
    return false
  }
}

export async function load() {
  try {
    const root = await navigator.storage.getDirectory()
    const fh = await root.getFileHandle(FILE)
    return await (await fh.getFile()).arrayBuffer()
  } catch {
    return null
  }
}

export async function forget() {
  try { await (await navigator.storage.getDirectory()).removeEntry(FILE) } catch { /* nothing to forget */ }
}
