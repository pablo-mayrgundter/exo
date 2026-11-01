// The glass rezzer: a pad on the back edge of the counter where glasses rez
// in when Max needs one and de-rez when he brings an empty back. A beam
// stands over it while it works.
import * as THREE from 'three'

const REZ_SECONDS = 1.6, DEREZ_SECONDS = 1.2

export function makeRezPad(bar) {
  const at = bar.rezPad
  const group = new THREE.Group()
  group.position.copy(at)
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x6beaf2, toneMapped: false, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.075, 0.095, 32), ringMat)
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.002
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.075, 32),
    new THREE.MeshBasicMaterial({ color: 0x0a2a4a, toneMapped: false, side: THREE.DoubleSide }))
  disc.rotation.x = -Math.PI / 2
  disc.position.y = 0.001
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0x6beaf2, toneMapped: false, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  })
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.5, 24, 1, true), beamMat)
  beam.position.y = 0.25
  group.add(disc, ring, beam)
  bar.group.add(group)

  const jobs = [] // { glass, dir, t, dur, done }
  let shown = false
  return {
    group,
    /** Rezzes a glass in on the pad. Watch the returned job's `done`. */
    rez(glass) {
      glass.group.position.copy(at)
      glass.group.quaternion.identity()
      glass.setLevel(0)
      glass.setRez(0)
      bar.group.add(glass.group)
      const job = { glass, dir: 1, t: 0, dur: REZ_SECONDS, done: false }
      jobs.push(job)
      return job
    },
    /** De-rezzes a glass on the pad, and disposes of it. */
    derez(glass) {
      glass.group.position.copy(at)
      glass.group.quaternion.identity()
      if (glass.group.parent !== bar.group) bar.group.add(glass.group)
      const job = { glass, dir: -1, t: 0, dur: DEREZ_SECONDS, done: false }
      jobs.push(job)
      return job
    },
    get busy() { return jobs.length > 0 || shown },
    /** Lights the beam for a job the host's Max is doing (on a puppet's bar). */
    show(on) { shown = on },
    update(dt, time) {
      for (const j of jobs) {
        j.t += dt
        const f = Math.min(1, j.t / j.dur)
        j.glass.setRez(j.dir > 0 ? f : 1 - f)
        if (f >= 1) {
          j.done = true
          if (j.dir < 0) j.glass.dispose()
        }
      }
      for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].done) jobs.splice(i, 1)
      const want = jobs.length || shown ? 0.35 + 0.15 * Math.sin(time * 18) : 0
      beamMat.opacity += (want - beamMat.opacity) * (1 - Math.exp(-dt * 8))
      beam.visible = beamMat.opacity > 0.01
      ringMat.opacity = 0.55 + 0.25 * Math.sin(time * (jobs.length || shown ? 9 : 1.3))
    },
  }
}
