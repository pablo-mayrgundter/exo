// Overclock Meadow: a bouncy overworld theme in F major, for the platformer
// that runs on the bar's 6502 in some other timeline. A bouncing octave
// bass, offbeat chord shimmer on the second pulse, and a hopping lead.

const A = `
  C5:8 F5:8 r:8 A5:8 r:8 G5:8 F5:4 | D5:8 F5:8 r:8 A5:8 G5:4 F5:8 E5:8 |
  F5:8 D5:8 Bb4:8 D5:8 F5:4 Bb5:4 | A5:8 G5:8 r:8 E5:8 r:8 C5:8 G5:4 |
  C5:8 F5:8 r:8 A5:8 r:8 C6:8 A5:4 | Bb5:8 A5:8 G5:8 F5:8 D5:8 F5:8 A5:4 |
  G5:8 Bb5:8 A5:8 G5:8 E5:8 G5:8 C6:8 Bb5:8 | A5:4 F5:8 F5:8 F5:4 r:4 |`

const B = `
  F5:4. D5:8 Bb4:8 D5:8 F5:4 | G5:4. E5:8 C5:8 E5:8 G5:4 |
  A5:8 C6:8 r:8 A5:8 E5:8 A5:8 C6:4 | D6:4 C6:8 A5:8 F5:4 D5:4 |
  Bb5:8 A5:8 Bb5:8 D6:8 r:8 Bb5:8 G5:4 | C6:8 Bb5:8 C6:8 E6:8 r:8 C6:8 G5:4 |
  A5:4 F5:4 F#5:4 A5:4 | Bb5:8 G5:8 D5:8 G5:8 C6:4 r:4 |`

// Bass bars: root, octave, fifth, octave; halves for two-chord bars.
const bass = (r, o, f) => `${r} ${o} ${f} ${o} ${r} ${o} ${f} ${o}`
const half = (r1, o1, r2, o2) => `${r1} ${o1} ${r1} ${o1} ${r2} ${o2} ${r2} ${o2}`
const BASS_A = [bass('F2', 'F3', 'C3'), bass('D2', 'D3', 'A2'), bass('Bb1', 'Bb2', 'F2'), bass('C2', 'C3', 'G2'),
  bass('F2', 'F3', 'C3'), bass('D2', 'D3', 'A2'), half('G2', 'G3', 'C2', 'C3'), bass('F2', 'F3', 'C3')].join(' | ')
const BASS_B = [bass('Bb1', 'Bb2', 'F2'), bass('C2', 'C3', 'G2'), bass('A2', 'A3', 'E3'), bass('D2', 'D3', 'A2'),
  bass('G2', 'G3', 'D3'), bass('C2', 'C3', 'G2'), half('F2', 'F3', 'D2', 'D3'), half('G2', 'G3', 'C2', 'C3')].join(' | ')

// Offbeat chords, arpeggiated a frame at a time.
const CH = { F: 'F4 A4 C5', Dm: 'D4 F4 A4', Bb: 'D4 F4 Bb4', C: 'E4 G4 C5', Gm: 'D4 G4 Bb4', C7: 'E4 G4 Bb4', Am: 'E4 A4 C5', D7: 'D4 F#4 C5' }
const off = (c) => `r:8 {${CH[c]}}:8 `.repeat(4)
const off2 = (a, b) => `r:8 {${CH[a]}}:8 `.repeat(2) + `r:8 {${CH[b]}}:8 `.repeat(2)
const CHORDS_A = [off('F'), off('Dm'), off('Bb'), off('C'), off('F'), off('Dm'), off2('Gm', 'C7'), off('F')].join(' | ')
const CHORDS_B = [off('Bb'), off('C'), off('Am'), off('Dm'), off('Gm'), off('C7'), off2('F', 'D7'), off2('Gm', 'C7')].join(' | ')

const BEAT = 'K:8 H:8 S:8 H:8 K:8 H:8 S:8 H:8'
const FILL = 'K:8 H:8 S:8 H:8 S:16 S:16 S:16 S:16 S:8 S:8'

export default {
  title: 'Overclock Meadow',
  composer: 'Exo Cafe (Claude)',
  arranger: 'Exo Cafe (Claude)',
  license: 'original, MIT',
  tempo: 160,
  // Intro 2, then A B A B A', and a two-bar ending: 44 bars.
  channels: {
    p1: `@l8 @e:lead @v11 @d2 r:1 r:1 [ ${A} ${B} ]2 @d1 ${A}
      A5:8 C6:8 F6:4 E6:8 C6:8 G5:4 | F6:2 r:2`,
    p2: `@l8 @e:stab @q6 @d0 @v7 ${off('F')} ${off('C')} [ ${CHORDS_A} ${CHORDS_B} ]2 ${CHORDS_A}
      ${off2('F', 'C7')} {F4 A4 C5}:2 r:2`,
    tri: `@l8 @q5 @v15 ${bass('F2', 'F3', 'C3')} ${bass('C2', 'C3', 'G2')} [ ${BASS_A} ${BASS_B} ]2 ${BASS_A}
      ${half('F2', 'F3', 'C2', 'C3')} F2:2 r:2`,
    noise: `@v8 ${BEAT} ${BEAT} [ [${BEAT}]7 ${FILL} ]5 ${BEAT} X:2 r:2`,
  },
}
