// Korobeiniki ("The Peddlers"): the Russian folk song, after Nikolay
// Nekrasov's 1861 poem, whose tune the world now knows from Tetris. This
// arrangement takes only the folk melody; the harmony part, bass and the
// broken-chord variation are ours. It speeds up for the last verse, as
// the song does when it's danced.

const M = `
  E5:4 B4:8 C5:8 D5:4 C5:8 B4:8 | A4:4 A4:8 C5:8 E5:4 D5:8 C5:8 |
  B4:4. C5:8 D5:4 E5:4 | C5:4 A4:4 A4:2 |
  D5:4. F5:8 A5:4 G5:8 F5:8 | E5:4. C5:8 E5:4 D5:8 C5:8 |
  B4:4 B4:8 C5:8 D5:4 E5:4 | C5:4 A4:4 A4:2 |`

// A second voice, mostly a third under the tune.
const H = `
  C5:4 G#4:8 A4:8 B4:4 A4:8 G#4:8 | E4:4 E4:8 A4:8 C5:4 B4:8 A4:8 |
  G#4:4. A4:8 B4:4 B4:4 | A4:4 E4:4 C4:2 |
  A4:4. D5:8 F5:4 E5:8 D5:8 | C5:4. A4:8 C5:4 B4:8 A4:8 |
  G#4:4 G#4:8 A4:8 B4:4 G#4:4 | A4:4 E4:4 C4:2 |`

// The variation: broken chords, eighth notes.
const V = `
  [A5 E5 C5 E5]2 | [B5 E5 G#5 E5]2 | [C6 A5 E5 A5]2 | [D6 A5 F5 A5]2 |
  E6 C6 A5 C6 F6 D6 A5 D6 | [E6 B5 G#5 B5]2 | A5 C6 B5 A5 G#5 A5 B5 G#5 | A5:2 r:2 |`
const VH = 'A4:1 | G#4:1 | A4:1 | A4:1 | A4:2 A4:2 | G#4:1 | E4:2 E4:2 | E4:2 r:2 |'

const M_BASS = '[A2 A3]2 [E2 E3]2 | [A2 A3]4 | [E2 E3]4 | [A2 A3]4 | [D2 D3]4 | [C3 C4]2 [A2 A3]2 | [E2 E3]4 | [A2 A3]4 |'
const V_BASS = '[A2 A3]4 | [E2 E3]4 | [A2 A3]4 | [D2 D3]4 | [A2 A3]2 [D2 D3]2 | [E2 E3]4 | [A2 A3]2 [E2 E3]2 | A2:2 r:2 |'

export default {
  title: 'Korobeiniki',
  composer: 'Russian folk song (trad.)',
  arranger: 'Exo Cafe (Claude)',
  license: 'public domain',
  // Intro 2 bars, verse, verse with harmony, variation, verse again faster, last hit: 35 bars.
  tempo: [[0, 144], [104, 160], [120, 176]],
  channels: {
    p1: `@l8 r:1 r:1 @e:lead @d2 @v11 ${M} @d1 ${M} @e:pluck @d1 @v10 ${V} @e:lead @d2 @v12 ${M} A5:4 r:2.`,
    p2: `@l8 [r:1]10 @e:lead @d0 @v7 ${H} @e:pad @d2 @v6 ${VH} @e:lead @d0 @v8 ${H} E5:4 r:2.`,
    tri: `@l8 @q6 @v15 [A2 A3]8 ${M_BASS} ${M_BASS} ${V_BASS} ${M_BASS} A2:4 r:2.`,
    noise: `@v7 [K:8 H:8 S:8 H:8]68 @v10 X:4 r:2.`,
  },
}
