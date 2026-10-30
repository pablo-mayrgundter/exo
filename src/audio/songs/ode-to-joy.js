// Ode to Joy: the theme of the finale of Beethoven's Ninth Symphony
// (1824). Once plain, once with a second voice and drums, and once more a
// whole tone up.

const A1 = 'E5 E5 F5 G5 | G5 F5 E5 D5 | C5 C5 D5 E5 | E5:4. D5:8 D5:2 |'
const A2 = 'E5 E5 F5 G5 | G5 F5 E5 D5 | C5 C5 D5 E5 | D5:4. C5:8 C5:2 |'
const B = 'D5 D5 E5 C5 | D5 E5:8 F5:8 E5 C5 | D5 E5:8 F5:8 E5 D5 | C5 D5 G4:2 |'

const H1 = 'C5 C5 D5 E5 | E5 D5 C5 B4 | A4 A4 B4 C5 | C5:4. B4:8 B4:2 |'
const H2 = 'C5 C5 D5 E5 | E5 D5 C5 B4 | A4 A4 B4 C5 | B4:4. G4:8 E4:2 |'
const HB = 'B4:2 G4:2 | B4:2 C5:2 | B4:2 G4:2 | E4 F4 B3:2 |'

// Oom-pah bass.
const BA1 = 'C3 G2 C3 G2 | G2 D3 G2 D3 | C3 G2 C3 G2 | G2 D3 G2:2 |'
const BA2 = 'C3 G2 C3 G2 | G2 D3 G2 D3 | C3 G2 C3 G2 | G2 D3 C3:2 |'
const BB = 'G2 D3 G2 D3 | G2 D3 C3 G2 | G2 D3 G2 D3 | C3 G2 G2:2 |'

const BEAT = '[K:4 H:4 S:4 H:4]4'

export default {
  title: 'Ode to Joy',
  composer: 'Ludwig van Beethoven (1824)',
  arranger: 'Exo Cafe (Claude)',
  license: 'public domain',
  tempo: 120,
  // 8 bars plain, 16 with harmony and drums, 16 a tone up, and a last bar: 41 bars.
  channels: {
    p1: `@l4 @e:lead @d2 @v11 ${A1} ${A2} @d1 ${A1} ${A2} ${B} ${A2} @k2 @d2 @v12 ${A1} ${A2} ${B} ${A2} C5:4 r:2.`,
    p2: `@l4 [r:1]8 @e:lead @d0 @v7 ${H1} ${H2} ${HB} ${H2} @k2 @v8 ${H1} ${H2} ${HB} ${H2} {C4 E4 G4}:4 r:2.`,
    tri: `@l4 @q6 @v15 ${BA1} ${BA2} ${BA1} ${BA2} ${BB} ${BA2} @k2 ${BA1} ${BA2} ${BB} ${BA2} C2 r:2.`,
    noise: `@v6 [r:1]8 ${BEAT} ${BEAT} ${BEAT} ${BEAT} @v7 ${BEAT} ${BEAT} ${BEAT} ${BEAT} @v9 X:4 r:2.`,
  },
}
