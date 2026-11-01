// Voice: talk to the people near you, in your own voice or an 8-bit one.
//
// The mic is off until you turn it on. In 8-bit mode your voice goes
// through ChipVoice (an AudioWorklet) before it's sent, so only the
// chiptune version leaves your machine; in real mode it's sent as it is,
// with the browser's echo cancellation and noise suppression. Either way
// it goes to each peer over the WebRTC connections presence already has.
//
// Others' voices play from their avatars: an HRTF panner at each one, so
// they come from where they stand and fade with distance. A level meter
// on every voice (yours too) moves the avatars' visor mouths.
import workletUrl from './worklet.js?worker&url'

/**
 * The voices you can send: 8-bit ones (pitch and formants shifted, in
 * semitones, so you're harder to recognize) and your own.
 */
export const VOICES = {
  chip: { label: '8-bit', shift: 3, formant: 2 },
  high: { label: '8-bit high', shift: 9, formant: 5 },
  low: { label: '8-bit low', shift: -7, formant: -4 },
  real: { label: 'Real voice' },
}
const isChip = (m) => VOICES[m]?.shift !== undefined

/**
 * @param {{transport: {addStream: Function, removeStream: Function, onStream: Function} | null, id: string}} o
 */
export function makeVoice({ transport, id }) {
  let ctx = null
  let mic = null // MediaStream from getUserMedia
  let src = null, chip = null, out = null, meter = null
  let mode = 'chip'
  let on = false
  let starting = null
  const remotes = new Map() // presence id → { el, source, gain, panner, meter, data }
  const data = new Float32Array(512)

  function context() {
    if (!ctx) {
      ctx = new AudioContext({ latencyHint: 'interactive' })
      ctx.listener.positionX && (ctx.listener.positionX.value = 0)
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    return ctx
  }

  function route() {
    if (!src) return
    try { src.disconnect() } catch { /* not connected */ }
    try { chip?.disconnect() } catch { /* not connected */ }
    if (chip && isChip(mode)) chip.port.postMessage({ shift: VOICES[mode].shift, formant: VOICES[mode].formant })
    const head = isChip(mode) && chip ? chip : src
    if (head === chip) src.connect(chip)
    head.connect(out)
    head.connect(meter)
  }

  async function start() {
    const c = context()
    mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    })
    src = c.createMediaStreamSource(mic)
    try {
      await c.audioWorklet.addModule(workletUrl)
      const v = VOICES[isChip(mode) ? mode : 'chip']
      chip = new AudioWorkletNode(c, 'chip-voice', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
        processorOptions: { shift: v.shift, formant: v.formant },
      })
    } catch (e) {
      console.warn('exo: the 8-bit voice is unavailable here; sending your own', e)
      chip = null
      mode = 'real'
    }
    out = c.createMediaStreamDestination()
    meter = c.createAnalyser()
    meter.fftSize = 512
    route()
    transport?.addStream(out.stream, { id, voice: true })
    on = true
  }

  function stop() {
    if (out) transport?.removeStream(out.stream)
    mic?.getTracks().forEach((t) => t.stop())
    for (const n of [src, chip, meter]) try { n?.disconnect() } catch { /* fine */ }
    mic = src = chip = out = meter = null
    on = false
  }

  function levelOf(analyser) {
    analyser.getFloatTimeDomainData(data)
    let s = 0
    for (let i = 0; i < data.length; i++) s += data[i] * data[i]
    return Math.sqrt(s / data.length)
  }

  // Others' voices, from their avatars.
  transport?.onStream((stream, who) => {
    if (!who || who === id) return
    const c = context()
    drop(who)
    // Chrome plays a remote WebRTC stream through Web Audio only if a media
    // element holds it too; a muted one does.
    const el = new Audio()
    el.muted = true
    el.srcObject = stream
    el.play().catch(() => {})
    const source = c.createMediaStreamSource(stream)
    const gain = c.createGain()
    const panner = new PannerNode(c, {
      panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1.2, maxDistance: 40, rolloffFactor: 1.6,
    })
    const m = c.createAnalyser()
    m.fftSize = 512
    source.connect(gain).connect(panner).connect(c.destination)
    source.connect(m)
    remotes.set(who, { el, source, gain, panner, meter: m, stream })
  })

  function drop(who) {
    const r = remotes.get(who)
    if (!r) return
    for (const n of [r.source, r.gain, r.panner, r.meter]) try { n.disconnect() } catch { /* fine */ }
    r.el.srcObject = null
    remotes.delete(who)
  }

  return {
    get on() { return on },
    get mode() { return mode },
    /** Turns the mic on or off. Resolves when it's done (a permission prompt may come first). */
    async set(want) {
      if (want === on) return on
      if (!want) { stop(); return false }
      starting ??= start().catch((e) => { stop(); throw e }).finally(() => { starting = null })
      await starting
      return on
    },
    /** One of VOICES: 'chip', 'high', 'low' (8-bit) or 'real'. */
    setMode(m) {
      if (!VOICES[m]) return
      if (isChip(m) && on && !chip) return // no worklet here
      mode = m
      route()
    },
    /** Lets audio start: browsers allow it only after a gesture on the page. */
    unlock() { if (ctx || remotes.size) context() },
    /** Your voice's level (0..~0.5), for your visor's mouth. */
    level() { return meter ? levelOf(meter) : 0 },
    /** A remote voice's level, for its avatar's mouth. */
    levelFor(who) { const r = remotes.get(who); return r ? levelOf(r.meter) : 0 },
    /**
     * Places the listener (you: position, and the direction you face) and
     * each voice (at its avatar), in metres; a voice in another place, or
     * gone, is silent.
     */
    place(listener, forward, voices) {
      if (!ctx) return
      const L = ctx.listener, t = ctx.currentTime
      if (L.positionX) {
        L.positionX.setTargetAtTime(listener.x, t, 0.05); L.positionY.setTargetAtTime(listener.y, t, 0.05); L.positionZ.setTargetAtTime(listener.z, t, 0.05)
        L.forwardX.setTargetAtTime(forward.x, t, 0.05); L.forwardY.setTargetAtTime(forward.y, t, 0.05); L.forwardZ.setTargetAtTime(forward.z, t, 0.05)
        L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0
      } else {
        L.setPosition(listener.x, listener.y, listener.z)
        L.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0)
      }
      for (const [who, r] of remotes) {
        const v = voices.get(who)
        r.gain.gain.setTargetAtTime(v ? 1 : 0, t, 0.1)
        if (!v) continue
        r.panner.positionX.setTargetAtTime(v.x, t, 0.05)
        r.panner.positionY.setTargetAtTime(v.y, t, 0.05)
        r.panner.positionZ.setTargetAtTime(v.z, t, 0.05)
      }
    },
    /** Forgets someone's voice (they left). */
    drop,
    get speakers() { return [...remotes.keys()] },
    /** A remote voice's stream (debugging and tests). */
    streamFor(who) { return remotes.get(who)?.stream ?? null },
  }
}
