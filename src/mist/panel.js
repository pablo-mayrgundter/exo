// The Mist dashboard: a process table for the vCPU. What your machine
// already spends being here (system), what you donate on top (donation),
// each job's memory, the cycles it's getting, and the frames you powered.
// Plus the chip tokens that sit on jobs in the world.
import * as THREE from 'three'

const pct = (x) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const hz = (c) => c >= 1000 ? `${(c / 1000).toFixed(1)}k` : `${Math.round(c)}`
const bytes = (n) => n >= 1024 ? `${(n / 1024).toFixed(1)} KiB` : `${n} B`

/** A small DIP chip, as inline SVG, for buttons and labels. */
export const CHIP_ICON = '<svg class="chip-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="12" height="16" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6 8H3M6 12H3M6 16H3M18 8h3M18 12h3M18 16h3" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="7" r="1.1" fill="currentColor"/></svg>'

/** @param {import('./scheduler.js').Mist} mist @param {HTMLElement} el */
export function makeMistPanel(mist, el) {
  el.innerHTML = `
    <div class="mist-head"><span class="label">${CHIP_ICON} vCPU · MOS 6502 · time-shared</span><button type="button" class="x" data-close="mist" aria-label="Close">×</button></div>
    <div id="mist-vcpu" class="value small"></div>
    <label class="budget">Your donation <span id="mist-budget-v"></span>
      <input id="mist-budget" type="range" min="0" max="60" step="5">
    </label>
    <table class="jobs" aria-label="Jobs on the vCPU">
      <thead><tr><th>Job</th><th>Mem</th><th>System</th><th>Donated</th><th>Rate</th><th></th></tr></thead>
      <tbody id="mist-jobs"></tbody>
    </table>
    <div class="label">Host · your machine</div>
    <div id="mist-host" class="rows"></div>
    <div class="label">Frames you powered</div>
    <div id="mist-receipts" class="rows small"></div>
    <p class="muted small">Tap a job's chip token in the world to donate cycles to it. With no donations, a job runs on its system share. (The GPU's share isn't measured.)</p>`
  const budget = el.querySelector('#mist-budget')
  budget.addEventListener('input', () => mist.setBudget(budget.value / 100))
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-give],button[data-take]')
    if (!b) return
    if (b.dataset.give) mist.give(b.dataset.give)
    else mist.take(b.dataset.take)
    render()
  })

  function render() {
    budget.value = Math.round(mist.budget * 100)
    el.querySelector('#mist-budget-v').textContent = `${pct(mist.budget)} of a core`
    const a = mist.accounts()
    const totalShares = mist.jobs.reduce((n, j) => n + j.share.system + j.share.donated, 0) || 1
    el.querySelector('#mist-vcpu').textContent =
      `${hz(mist.vcpuHz)} cycles/s (1 MHz native) · kernel ${bytes(mist.kernelBytes ?? 0)}`
    el.querySelector('#mist-jobs').innerHTML = mist.jobs.map((j) => {
      const sys = j.share.system / totalShares, don = j.share.donated / totalShares
      const state = j.state === 'queued' ? '<span class="muted">queued</span>' : don ? pct(don) : '—'
      return `<tr class="${j.state}">
        <td>${esc(j.name)}<br><span class="small muted">${esc(j.place)}</span></td>
        <td>${bytes(j.bytes)}</td>
        <td>${pct(sys)}</td>
        <td>${state}</td>
        <td>${hz(j.hz)}/s<br><span class="small muted">${j.receipts.length ? `${hz(j.receipts[0].halfCycles / 2)} / ${esc(j.unit)}` : ''}</span></td>
        <td class="give"><button type="button" data-take="${j.id}" aria-label="Take back a donation from ${esc(j.name)}"${j.gifts ? '' : ' disabled'}>−</button><button type="button" data-give="${j.id}" aria-label="Donate to ${esc(j.name)}">${CHIP_ICON}</button></td>
      </tr>`
    }).join('')
    el.querySelector('#mist-host').innerHTML = [
      row('Main thread: scripts, draw calls, the connection', `${pct(a.main)} · measured`),
      row('vCPU · system', pct(a.system)),
      row('vCPU · your donation', `${pct(a.donated)}${mist.order.length > mist.slots ? ' · some queued' : ''}`),
      row('Total', `${pct(a.total)} of a core`),
    ].join('')
    el.querySelector('#mist-receipts').innerHTML = mist.mine.slice(0, 6).map((r) => row(
      `${esc(r.name)} · ${esc(r.frame)} <span class="muted">${new Date(r.t).toLocaleTimeString()}</span>`,
      `${hz(r.halfCycles / 2)} cycles · ${pct(r.share)} yours · ${esc(r.output)}${r.verified === true ? ' ✓' : r.verified === false ? ' ✗' : ''}`,
    )).join('') || '<div class="row muted">None yet.</div>'
  }
  mist.onChange(render)
  render()
  setInterval(() => { if (!el.hidden) render() }, 1000)
  return { render }
}

function row(a, b) { return `<div class="row"><span>${a}</span><span>${b}</span></div>` }

/**
 * A floating chip token: a little DIP package with glowing pins. Tap it to
 * donate cycles to its job (`userData.job`); it lights while you are.
 */
export function makeChipToken(job, color = '#6beaf2') {
  const group = new THREE.Group()
  const c = new THREE.Color(color)
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.52), new THREE.MeshBasicMaterial({ color: 0x050a1f, toneMapped: false }))
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry), new THREE.LineBasicMaterial({ color: c, toneMapped: false }))
  const pinMat = new THREE.MeshBasicMaterial({ color: c, toneMapped: false })
  const pins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.03, 0.04), pinMat, 8)
  const m = new THREE.Matrix4()
  for (let i = 0; i < 8; i++) {
    const side = i < 4 ? -1 : 1
    m.makeTranslation(side * 0.22, -0.02, -0.18 + (i % 4) * 0.12)
    pins.setMatrixAt(i, m)
  }
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.03, 12), pinMat)
  dot.rotation.x = -Math.PI / 2
  dot.position.set(0, 0.051, -0.18)
  group.add(body, edge, pins, dot)
  group.rotation.x = 0.6 // tilted toward the viewer
  // A larger, invisible box makes it easy to tap.
  const hit = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.8), new THREE.MeshBasicMaterial({ visible: false }))
  group.add(hit)
  group.userData.job = job
  let lit = false
  group.userData.setLit = (on) => {
    if (on === lit) return
    lit = on
    body.material.color.set(on ? c : 0x050a1f).multiplyScalar(on ? 0.6 : 1)
    pinMat.color.copy(c).multiplyScalar(on ? 1.6 : 1)
  }
  return group
}
