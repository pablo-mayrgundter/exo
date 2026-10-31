// Non-Maskable: the house anthem. A 138 bpm trance build over Am–F–C–G,
// with a syncopated 3-3-2 stab hook, rolling triangle bass under a
// triangle kick, offbeat open hats and a snare-roll breakdown. Named for
// the NMI line the bar sits on: the interrupt you can't ignore.

// The hook: four bars of 3-3-2 sixteenths, rising triad then falling.
const HOOK = `
  E5:8. A5:8. C6:8 B5:8. A5:8. E5:8 | F5:8. A5:8. C6:8 C6:8. A5:8. F5:8 |
  E5:8. G5:8. C6:8 B5:8. G5:8. E5:8 | D5:8. G5:8. B5:8 D6:8. C6:8. B5:8 |`

// The breakdown's long line over the same chords.
const LINE = `
  A5:2. B5:4 | C6:2 A5:2 | G5:2. A5:4 | B5:1 |
  A5:2. B5:4 | C6:2 E6:2 | D6:2. C6:4 | B5:1 |`

// Rolling bass: a triangle kick on the beat, two sixteenths of root after it.
const ROLL = '[K:8 A2 A2]4 [K:8 F2 F2]4 [K:8 C3 C3]4 [K:8 G2 G2]4'

// Hats on the offbeat, open hats and snare on 2 and 4.
const GROOVE = 'H:16 H:16 X:8 S:8 X:8 H:16 H:16 X:8 S:8 X:8'

export default {
  title: 'Non-Maskable',
  composer: 'Exo Cafe (Claude)',
  arranger: 'Exo Cafe (Claude)',
  license: 'original, MIT',
  tempo: 138,
  // 45 bars: intro 8, build 8, breakdown 8, drop 16, outro 4, last hit 1.
  channels: {
    p1: `@l16 [r:1]12 @e:lead @d2 @v7 ${HOOK}
      @e:lead @d2 @v9 ${LINE}
      @e:stab @q7 @v12 @d1 ${HOOK} ${HOOK} @d0 ${HOOK} ${HOOK}
      @q8 [r:1]4 @e:lead @v10 A5:1`,
    p2: `@l16 [r:1]8
      @e:pluck @d1 @v7 [ [A4 C5 E5 A5]4 [F4 A4 C5 F5]4 [E4 G4 C5 E5]4 [D4 G4 B4 D5]4 ]2
      @e:pad @d2 @v7 [ {A4 C5 E5}:1 {F4 A4 C5}:1 {E4 G4 C5}:1 {D4 G4 B4}:1 ]2
      @e:pluck @d0 @v8 [ [A4 E4 C4 E4]4 [A4 F4 C4 F4]4 [G4 E4 C4 E4]4 [G4 D4 B3 D4]4 ]4
      @v5 [A4 C5 E5 A5]4 [F4 A4 C5 F5]4 [E4 G4 C5 E5]4 [D4 G4 B4 D5]4
      @e:pad {A3 C4 E4}:1`,
    tri: `@l16 @q6 @v15 [ ${ROLL} ]4
      @q8 [A2:1 F2:1 C3:1 G2:1]2
      @q6 [ ${ROLL} ]5
      @q8 K:4 A1:2.`,
    noise: `@v9 [[r:8 H:8]4]8
      [${GROOVE}]7 S:16 S:16 S:16 S:16 [S:16]12
      [r:1]4 @v5 [S:4]4 @v7 [S:8]8 @v9 [S:16]16 @v12 [S:32]32
      @v10 X:8 X:8 S:8 X:8 H:16 H:16 X:8 S:8 X:8 [${GROOVE}]15
      @v8 [[r:8 H:8]4]4 @v10 X:1`,
  },
}
