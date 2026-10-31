// The Entertainer: Scott Joplin's rag (1902). Its intro and first strain,
// twice, in 2/4: stride bass on the triangle, the left hand's offbeat
// chords on the second pulse. Not fast, as Joplin wrote on his rags.

const INTRO = `
  D6 E6 C6 A5:8 B5 G5:8 | D5 E5 C5 A4:8 B4 G4:8 |
  D4 E4 C4 A3 B3 A3 G#3 G3 | G3:8 r:8 r:8 D4 D#4 |`

// The strain, after its pickup (D4 D#4). The tune ties over the bar lines.
const STRAIN = `
  E4 C5:8 E4 C5:8 E4 C5 | ~:4 C5 D5 D#5 E5 | C5 D5 E5:8 B4 D5:8 C5 | ~:4 r:8 D4 D#4 |
  E4 C5:8 E4 C5:8 E4 C5 | ~:4 A4 G4 F#4 A4 | C5 E5:8 D5 C5 A4 D5:8 | ~:4 r:8 D4 D#4 |
  E4 C5:8 E4 C5:8 E4 C5 | ~:4 C5 D5 D#5 E5 | C5 D5 E5:8 B4 D5:8 C5 | ~:4 C5 D5 E5 C5 |
  D5 E5:8 C5 D5 C5 E5 C5 | D5 E5:8 C5 D5 C5 E5 C5 | D5 E5:8 B4 D5:8 C5:8 |`
const AGAIN = '~:4 r:8 D4 D#4 |'
const END = '~:4 r:4 | C5:8 r:8 {C4 E4 G4 C5}:8 r:8 |'

// Stride: bass on the beat (triangle), chord on the offbeat (pulse 2).
const B = { C: 'C3 r G2 r', GC: 'G2 r C3 r', D7: 'D3 r A2 r', G: 'G2 r D3 r' }
const K = {
  C: 'r {G3 C4 E4} r {G3 C4 E4}', GC: 'r {G3 B3 D4} r {G3 C4 E4}',
  D7: 'r {F#3 C4 D4} r {F#3 C4 D4}', G: 'r {G3 B3 D4} r {G3 B3 D4}',
}
const BARS = ['C', 'C', 'GC', 'C', 'C', 'D7', 'D7', 'G', 'C', 'C', 'GC', 'C', 'C', 'C', 'GC', 'C']
const bass = BARS.map((c) => B[c]).join(' | ')
const chords = BARS.map((c) => K[c]).join(' | ')

export default {
  title: 'The Entertainer',
  composer: 'Scott Joplin (1902)',
  arranger: 'Exo Cafe (Claude)',
  license: 'public domain',
  tempo: 84,
  // Intro 4 bars (2/4), the strain twice (16 each), a last bar: 37 bars of 2 beats.
  channels: {
    p1: `@l16 @e:pluck @d2 @v11 ${INTRO} ${STRAIN} ${AGAIN} @d1 @v12 ${STRAIN} ${END}`,
    p2: `@l16 @e:pluck @d2 @v6 ${down(INTRO)} @l8 @e:stab @d0 @q6 @v6 ${chords} ${chords} {G3 C4 E4}:8 r:8 r:4`,
    tri: `@l16 r:2 r:2 r:2 G2:8 r:8 r:4 @l8 @q6 @v15 ${bass} ${bass} C2:8 r:8 r:4`,
    noise: `@l16 r:2 r:2 r:2 r:2 [r:2]16 @v5 [H:8 H:8 H:8 H:8]16 X:8 r:8 r:4`,
  },
}

function down(s) { return s.replace(/([A-G][#b]?)(\d)/g, (_, n, o) => n + (Number(o) - 1)) }
