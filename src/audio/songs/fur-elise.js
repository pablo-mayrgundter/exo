// Für Elise: Beethoven's Bagatelle No. 25 in A minor (1810, published
// 1867). The A section, the C-major episode and the return, in 3/8. The
// second pulse plays the tune a dotted eighth late and quiet: the echo
// trick NES composers used when they had no reverb.

const PICKUP = 'E5 D#5'
const A = `
  E5 D#5 E5 B4 D5 C5 | A4:8 r C4 E4 A4 | B4:8 r E4 G#4 B4 | C5:8 r E4 E5 D#5 |
  E5 D#5 E5 B4 D5 C5 | A4:8 r C4 E4 A4 | B4:8 r E4 C5 B4 |`
const FIRST = 'A4:8 r:8 E5 D#5 |'
const SECOND = 'A4:8 r B4 C5 D5 |'
const B = `
  E5:8. G4 F5 E5 | D5:8. F4 E5 D5 | C5:8. E4 D5 C5 | B4:8 r E4 E5 r |
  r E5 E6 r r D#5 | E5 r r D#5 E5 D#5 |`
const LAST = 'A4:4. |'

// The left hand: a rising broken chord at the start of each bar.
const LA = 'r:4. | A2 E3 A3 r:8. | E2 E3 G#3 r:8. | A2 E3 A3 r:8. | r:4. | A2 E3 A3 r:8. | E2 E3 G#3 r:8. |'
const L_END = 'A2 E3 A3 r:8. |'
const LB = 'C3 G3 C4 r:8. | G2 G3 B3 r:8. | A2 E3 A3 r:8. | E2 E3 E4 r:8. | r:4. | r:4. |'

const TUNE = `${PICKUP} ${A} ${FIRST} ${A} ${SECOND} ${B} ${A} ${SECOND} ${B} ${A}`

export default {
  title: 'Für Elise',
  composer: 'Ludwig van Beethoven (1810)',
  arranger: 'Exo Cafe (Claude)',
  license: 'public domain',
  tempo: [[0, 72], [54.5, 64]], // a little broader for the last return (bar 37)
  channels: {
    p1: `@l16 @e:pluck @d2 @v11 ${TUNE} ${LAST}`,
    p2: `@l16 r:8. @e:pluck @d0 @v4 ${TUNE} ${LAST}`,
    tri: `@l16 @q7 @v13 r:8 ${LA} ${L_END} ${LA} ${L_END} ${LB} ${LA} ${L_END} ${LB} ${LA} A2:4.`,
  },
}
