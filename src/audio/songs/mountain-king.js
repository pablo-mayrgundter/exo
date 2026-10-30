// In the Hall of the Mountain King, from Edvard Grieg's music for Ibsen's
// Peer Gynt (1875). The theme creeps in on staccato pulses and doubles,
// climbs a fifth and an octave, and speeds up every four bars until it
// runs away, as Grieg's does.

// The theme in B minor, and the same a fifth up, in F# minor.
const T = 'B3 C#4 D4 E4 F#4 D4 F#4:4 | E#4 C#4 E#4:4 E4 C4 E4:4 | B3 C#4 D4 E4 F#4 D4 F#4 B4 | A4 F#4 D4 F#4 A4:2 |'
const T5 = 'F#4 G#4 A4 B4 C#5 A4 C#5:4 | B#4 G#4 B#4:4 B4 G4 B4:4 | F#4 G#4 A4 B4 C#5 A4 C#5 F#5 | E5 C#5 A4 C#5 E5:2 |'
const up = (s) => s.replace(/([A-G][#b]?)(\d)/g, (_, n, o) => n + (Number(o) + 1))
const down = (s) => s.replace(/([A-G][#b]?)(\d)/g, (_, n, o) => n + (Number(o) - 1))

// Pizzicato bass, a quarter at a time.
const TB = 'B2 F#2 B2 F#2 | C#3 C#3 C3 C3 | B2 F#2 B2 F#2 | D3 A2 D3 A2 |'
const T5B = 'F#2 C#3 F#2 C#3 | G#2 G#2 G2 G2 | F#2 C#3 F#2 C#3 | A2 E2 A2 E2 |'

const MARCH = '[K:8 H:8 S:8 H:8]8'

export default {
  title: 'In the Hall of the Mountain King',
  composer: 'Edvard Grieg (1875)',
  arranger: 'Exo Cafe (Claude)',
  license: 'public domain',
  // Ten four-bar statements, then a two-bar ending; faster from statement 5.
  tempo: [[0, 100], [64, 116], [80, 132], [96, 150], [112, 170], [128, 190], [144, 212]],
  channels: {
    p1: `@l8 @q4 @e:pluck @d2 @v9 ${T} ${T} ${T5} @v11 ${T5}
      @v12 @d1 ${up(T)} ${up(T)} ${T5} ${up(T5)} @d2 ${up(T)} @v13 ${up(T)}
      F#4 F#4 B4:4 r:2 | {B4 D5 F#5}:4 r:4 B4:4 r:4`,
    p2: `@l8 @q4 @e:pluck @d0 [r:1]4 @v6 ${up(T)} ${up(T5)} @v8 ${up(T5)}
      ${T} ${T} @v9 ${down(T5)} ${T5} ${T} ${T}
      F#3 F#3 B3:4 r:2 | {F#3 B3 D4}:4 r:4 B3:4 r:4`,
    tri: `@l4 @q3 @v15 ${TB} ${TB} ${T5B} ${T5B} ${TB} ${TB} ${T5B} ${T5B} ${TB}
      @q6 ${TB} B2:8 B2:8 B2:4 r:2 | B1 r B1 r`,
    noise: `@v4 [r:1]8 [H:4]32 @v8 ${MARCH} ${MARCH} @v9 ${MARCH} ${MARCH} @v10 ${MARCH} ${MARCH}
      K:8 K:8 S:4 r:2 | X:4 r:4 X:4 r:4`,
  },
}
