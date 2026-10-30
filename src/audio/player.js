// The jukebox's engine: a playlist, an APU on a lazily made AudioContext
// (browsers allow sound only after a gesture, so nothing is made until
// play()), a lookahead scheduler, an analyser for the level meter, and
// gains for distance and mute.
import { APU, Scheduler } from './apu.js'
import { sequence } from './song.js'
import { PLAYLIST } from './songs/index.js'

const GAP = 1.5 // seconds of quiet between tracks

export class Player {
  /** @param {{songs?: object[], volume?: number}} [opts] */
  constructor({ songs = PLAYLIST, volume = 0.3 } = {}) {
    this.songs = songs
    this.volume = volume
    this.track = 0
    this.playing = false
    this.muted = false
    this.ctx = null
    this.seq = new Map() // song → sequence(song), parsed once
    this.pausedAt = 0
    this.onChange = () => {}
    this.timer = 0
  }

  get song() { return this.songs[this.track] }

  sequenced(song = this.song) {
    if (!this.seq.has(song)) this.seq.set(song, sequence(song))
    return this.seq.get(song)
  }

  /** Makes the audio graph. Call from a user gesture. */
  ensure() {
    if (this.ctx) return this.ctx
    const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext
    if (!AC) throw new Error('no Web Audio in this browser')
    const ctx = this.ctx = new AC({ latencyHint: 'playback' })
    this.master = new GainNode(ctx, { gain: this.volume })
    this.analyser = new AnalyserNode(ctx, { fftSize: 1024, smoothingTimeConstant: 0.6 })
    this.space = new GainNode(ctx, { gain: 1 }) // distance from the jukebox
    this.mute = new GainNode(ctx, { gain: this.muted ? 0 : 1 })
    this.master.connect(this.analyser) // the meter shows the music even when muted
    this.master.connect(this.space).connect(this.mute).connect(ctx.destination)
    this.apu = new APU(ctx, { destination: this.master })
    this.scheduler = new Scheduler({
      now: () => ctx.currentTime,
      onEvent: (ev, t) => this.apu.note(ev.ch, ev, t),
    })
    this.freq = new Uint8Array(this.analyser.frequencyBinCount)
    this.wave = new Float32Array(this.analyser.fftSize)
    return ctx
  }

  play(track = this.track) {
    const ctx = this.ensure()
    ctx.resume?.()
    track = ((track % this.songs.length) + this.songs.length) % this.songs.length
    if (track !== this.track) this.pausedAt = 0
    const fresh = this.pausedAt === 0
    this.track = track
    const { events } = this.sequenced()
    this.apu.silence()
    this.scheduler.start(events, { at: ctx.currentTime + 0.08, offset: this.pausedAt })
    this.playing = true
    this.endsAt = 0
    clearInterval(this.timer)
    // The pump: a coarse timer; the notes themselves sit on the audio clock.
    // Hidden tabs throttle timers to ~1 s, so look further ahead then.
    this.timer = setInterval(() => this.pump(), 25)
    this.pump()
    this.onChange(fresh ? 'track' : 'play')
  }

  pump() {
    if (!this.playing) return
    const hidden = typeof document !== 'undefined' && document.hidden
    this.scheduler.pump(hidden ? 1.5 : 0.15)
    if (!this.scheduler.done) return
    // The last note is out: move on once it and a gap have passed.
    const end = this.scheduler.t0 + this.sequenced().duration + GAP
    if (this.ctx.currentTime >= end) this.next()
  }

  pause() {
    if (!this.playing) return
    this.pausedAt = Math.max(0, Math.min(this.scheduler.position, this.sequenced().duration))
    this.playing = false
    clearInterval(this.timer)
    this.scheduler.stop()
    this.apu.silence()
    // Let the release finish, then let the audio thread sleep.
    setTimeout(() => { if (!this.playing) this.ctx.suspend?.() }, 250)
    this.onChange('pause')
  }

  toggle() { if (this.playing) this.pause(); else this.play() }

  next() {
    this.pausedAt = 0
    this.play(this.track + 1)
  }

  setMuted(m = !this.muted) {
    this.muted = m
    if (this.mute) this.mute.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.03)
    this.onChange('mute')
  }

  /** 0–1: how much of the music reaches the listener (distance, walls). */
  setSpace(g) {
    if (!this.space) return
    if (Math.abs(this.space.gain.value - g) < 0.01) return
    this.space.gain.setTargetAtTime(g, this.ctx.currentTime, 0.15)
  }

  /** Seconds into the current track. */
  get position() {
    if (!this.ctx) return 0
    return this.playing ? Math.max(0, this.scheduler.position) : this.pausedAt
  }

  get duration() { return this.sequenced().duration }

  /** Spectrum (0–255 per bin), or null before audio starts. */
  spectrum() {
    if (!this.analyser) return null
    this.analyser.getByteFrequencyData(this.freq)
    return this.freq
  }

  /** RMS of the output, 0–1. */
  level() {
    if (!this.analyser || !this.playing) return 0
    this.analyser.getFloatTimeDomainData(this.wave)
    let s = 0
    for (const v of this.wave) s += v * v
    return Math.sqrt(s / this.wave.length)
  }

  dispose() {
    clearInterval(this.timer)
    this.apu?.dispose()
    this.ctx?.close?.()
  }
}

/**
 * Renders a song offline, for checks and for export: every event scheduled
 * up front on an OfflineAudioContext.
 * @returns {Promise<AudioBuffer>}
 */
export async function renderSong(song, { sampleRate = 22050, volume = 0.3, tail = 0.5 } = {}) {
  const { events, duration } = sequence(song)
  const ctx = new OfflineAudioContext(1, Math.ceil((duration + tail) * sampleRate), sampleRate)
  const master = new GainNode(ctx, { gain: volume })
  master.connect(ctx.destination)
  const apu = new APU(ctx, { destination: master })
  for (const ev of events) apu.note(ev.ch, ev, ev.time)
  return ctx.startRendering()
}
