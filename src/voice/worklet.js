// The 8-bit voice in the audio thread: ChipVoice on each 128-sample block.
import { ChipVoice } from './chipvoice.js'

class ChipVoiceProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.voice = new ChipVoice(sampleRate, options?.processorOptions ?? {})
    // Settings from the page (shift, for instance) apply as they come.
    this.port.onmessage = (e) => { if (e.data && typeof e.data === 'object') Object.assign(this.voice, e.data) }
  }

  process(inputs, outputs) {
    const out = outputs[0]
    if (!out?.[0]) return true
    const input = inputs[0]?.[0]
    if (!input) out[0].fill(0)
    else this.voice.process(input, out[0])
    for (let c = 1; c < out.length; c++) out[c].set(out[0])
    return true
  }
}

registerProcessor('chip-voice', ChipVoiceProcessor)
