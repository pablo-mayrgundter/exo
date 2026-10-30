// Toccata and Fugue in D minor, BWV 565, attributed to J. S. Bach (before
// 1750): the opening only. The mordent and its fall, three times down the
// octaves; the diminished chord rolled up over a low D; then a pedal-point
// toccata passage (our own, in the style) and a last run down.

// The opening's two figures, in whatever octave is current (set with @o).
const S1 = 'A:32 G:32 A:2 r:4 G:32 F:32 E:32 D:32 C#:8 D:2 r:4'
const S2 = 'A:32 G:32 A:2 r:4 E:32 F:32 C#:32 D:2 r:4'
const OPENING = (o) => `@o${o} ${S1} @o${o - 1} ${S2} @o${o - 2} ${S1}`

// The toccata passage: a pedal note against a line that walks down and up.
const F = `
  A4 G4 A4 F4 A4 E4 A4 D4 A4 C#4 A4 D4 A4 E4 A4 F4 |
  Bb4 A4 Bb4 G4 Bb4 F4 Bb4 E4 Bb4 D4 Bb4 E4 Bb4 F4 Bb4 G4 |
  A4 G4 A4 F4 A4 E4 A4 D4 A4 C#4 A4 E4 A4 G4 A4 F4 |
  E4 F4 G4 A4 Bb4 C#5 D5 E5 F5 E5 D5 C#5 D5:4 |`
const RUN = 'D6 C6 Bb5 A5 G5 F5 E5 D5 C#5 Bb4 A4 G4 F4 E4 D4 C#4 |'
const up = (s) => s.replace(/([A-G][#b]?)(\d)/g, (_, n, o) => n + (Number(o) + 1))
const down = (s) => s.replace(/([A-G][#b]?)(\d)/g, (_, n, o) => n + (Number(o) - 1))

export default {
  title: 'Toccata in D minor (BWV 565)',
  composer: 'J. S. Bach (attr., before 1750)',
  arranger: 'Exo Cafe (Claude)',
  license: 'public domain',
  // The opening is 21.125 beats, the roll 12; the passage runs 36 more.
  tempo: [[0, 56], [33.125, 96], [69.125, 50]],
  channels: {
    p1: `@e:organ @d2 @v12 ${OPENING(5)}
      r:2 {C#4 E4 G4 Bb4}:2 | {C#5 E5 G5 Bb5}:2 {D5 F5 A5}:2 | @e:pad {D4 F4 A4 D5}:1 |
      @e:organ @l16 @v11 ${F} @v12 ${up(F)} ${RUN} @l4 @e:pad {D4 F4 A4 D5}:1 ~:2`,
    p2: `@e:organ @d1 @v9 ${OPENING(4)}
      C#3:8 E3:8 G3:8 Bb3:8 C#4:8 E4:8 G4:8 Bb4:8 | C#5:2 D5:2 | @e:pad D4:1 |
      @e:organ @l16 @v8 D4:1 D4:1 C#4:1 A3:2 D4:2 ${F} ${down(RUN)} @e:pad {A3 D4 F4}:1 ~:2`,
    tri: `@e:organ @v0 @o3 ${S1} @o2 ${S2} @v15 @o1 ${S1}
      D2:1 ~:1 ~:1 |
      D2:1 G2:1 A2:1 A2:2 D2:2 | D2:1 G2:1 A2:1 A2:2 D2:2 | D2:1 | D2:1 ~:2`,
    noise: '[r:1]6 r:4 r:32 @v6 X:1 [r:1]10 @v8 X:1', // crashes on the roll's top and the last chord
  },
}
