// The Mist dashboard: your budget, what your machine already spends just
// being here (implicit), what you're giving to (explicit), what's queued,
// and the frames you've powered. Plus the $ coins that sit on things in
// the world.
import * as THREE from 'three'
import { FONT_DISPLAY } from '../world/textures.js'

const pct = (x) => `${Math.round(x * 100)}%`
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/** @param {import('./scheduler.js').Mist} mist @param {HTMLElement} el */
export function makeMistPanel(mist, el) {
  el.innerHTML = `
    <div class="mist-head"><span class="label">Mist · gift economy</span><button type="button" class="x" data-close="mist" aria-label="Close">×</button></div>
    <label class="budget">Your gift budget <span id="mist-budget-v"></span>
      <input id="mist-budget" type="range" min="0" max="100" step="5">
    </label>
    <div class="label">Implicit · just being here</div>
    <div id="mist-implicit" class="rows"></div>
    <div class="label">Explicit · your gifts</div>
    <div id="mist-running" class="rows"></div>
    <div class="label">Frames you powered</div>
    <div id="mist-receipts" class="rows small"></div>
    <p class="muted small">Click the <b>$</b> on things in the world to give them cycles. With nobody giving, they drop back to implicit. (The GPU's share isn't measured.)</p>`
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
    const sims = [...mist.sims.values()]
    el.querySelector('#mist-implicit').innerHTML = [
      row('Main thread: scripts, draw calls, the connection', `${pct(a.main)} · measured`),
      ...sims.map((s) => row(`${esc(s.name)} · baseline`, pct(s.implicit))),
    ].join('')
    el.querySelector('#mist-running').innerHTML = sims.map((s) => {
      const rate = `${(s.hz / 2000).toFixed(1)} kHz`
      const status = s.state === 'running' ? `${pct(s.explicit)} · ${rate}` : s.state === 'queued' ? 'queued · no free slot' : `implicit · ${rate}`
      return `<div class="row ${s.state}">
        <span>${esc(s.name)} <span class="muted">· ${esc(s.place)}</span><br><span class="small muted">${status}${s.gifts ? ` · ${s.gifts} gift${s.gifts > 1 ? 's' : ''}` : ''}</span></span>
        <span class="give"><button type="button" data-take="${s.id}" aria-label="Take back a gift from ${esc(s.name)}"${s.gifts ? '' : ' disabled'}>−</button><button type="button" data-give="${s.id}" aria-label="Give to ${esc(s.name)}">$</button></span>
      </div>`
    }).join('') + `<div class="row small muted"><span>Slots: ${mist.slots} · total here ${pct(a.total)} of a core</span></div>`
    el.querySelector('#mist-receipts').innerHTML = mist.mine.slice(0, 6).map((r) => row(
      `${esc(r.name)} · ${r.frame === undefined ? '' : `#${r.frame}`} <span class="muted">${new Date(r.t).toLocaleTimeString()}</span>`,
      `${Math.round(r.halfCycles / 2000)}k cycles · ${pct(r.share)} yours · ${r.output}${r.verified === true ? ' ✓' : r.verified === false ? ' ✗' : ''}`,
    )).join('') || '<div class="row muted">None yet.</div>'
  }
  mist.onChange(render)
  render()
  setInterval(() => { if (!el.hidden) render() }, 1000)
  return { render }
}

function row(a, b) { return `<div class="row"><span>${a}</span><span>${b}</span></div>` }

/** A floating, clickable $ coin. `userData.sim` names what it gives to. */
export function makeCoin(sim, color = '#f5c842') {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 128
  const g = cv.getContext('2d')
  const draw = (lit) => {
    g.clearRect(0, 0, 128, 128)
    g.shadowColor = color
    g.shadowBlur = lit ? 24 : 10
    g.strokeStyle = color
    g.lineWidth = 6
    g.beginPath(); g.arc(64, 64, 50, 0, Math.PI * 2); g.stroke()
    g.fillStyle = lit ? color : 'rgba(5,10,31,0.7)'
    g.fill()
    g.fillStyle = lit ? '#050a1f' : color
    g.font = `64px ${FONT_DISPLAY}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText('$', 64, 70)
    tex.needsUpdate = true
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, toneMapped: false, depthWrite: false }))
  sp.scale.setScalar(0.7)
  sp.userData.sim = sim
  sp.renderOrder = 5
  draw(false)
  let lit = false
  sp.userData.setLit = (on) => { if (on !== lit) { lit = on; draw(on) } }
  return sp
}
