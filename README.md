# Exo Cafe

**A Tron bar on the NMI pad of a running 6502.** The first live instance of
Cloud City, a platform by Freality Metaverse Construction (FMC), prototyped
by the community that gathers at [exo.cafe](https://exo.cafe).

![Inside Exo Cafe: a voxel avatar at the bar, the Life wall behind it, data-bus light tubes on the walls](docs/img/bar.png)

- **The street is the chip, at its true size.** Walk out the door and
  you're on a metal trace of a MOS 6502, laid out from
  [visual6502](http://www.visual6502.org)'s netlist. The scene's unit is
  the micrometre: the die is its real 3.9 × 4.3 mm, and you're about 8 µm
  tall, the size of its smallest features. Zoom out and the city is the
  whole die; every polygon is lit by its node's voltage. The die sits at
  0° N 0° E, where Earth-scale maps like NetMap will meet it.
- **The chip is really running, time-shared.** A switch-level simulation
  of all 3,510 transistors runs in a Web Worker, and on it a small
  preemptive kernel in 6502 assembly ([vcpu.js](src/chip/vcpu.js))
  time-slices the bar's jobs: Conway's Game of Life
  ([life.js](src/chip/life.js)), the Art Car's light show, and Max
  Pablo's mind, which picks his next aphorism.
- **The bar follows the buses.** Eight light tubes are the data bus, sixteen
  across the ceiling are the address bus, and the counter's edge is the
  clock. The wall behind the bar is the Life board in RAM, lit cell by cell
  as the CPU writes it. Click a cell to poke memory.
- **Every place keeps its own time.** The chip runs at a few kHz against its
  native 1 MHz, about 1 : 500 in bar time. Through the arch in the west wall
  is Pablo's abode, where the sky turns 600 times faster than the bar's.
  [cosmic.js](src/cosmic/frames.js) does the reprojection between frames.
- **A gift economy of compute.** The vCPU dashboard is a process table:
  what the world runs for everyone (system), and what you donate on top,
  as a share of a core, by tapping a job's chip token in the world. A
  donation is literally more time on the 6502: it raises that job's
  share in the kernel's scheduler. Each frame a job computes comes with
  a receipt (cycles, your share, hashes of input and output); Life's
  verify in microseconds in JS, and the generations you powered carry
  your name. With no donations, jobs run on their system share.
- **Rez is earned, and shared.** Guests rez in voxels, the minecrafty
  body. Every cycle you donate re-voxelizes you finer, until you're
  smooth. Others see your rez only if you share it with them (on by
  default, for people near you).
- **Pull up a stool.** E sits you at the bar, in first person (or third:
  the View toggle, V, or scroll): look around and your head, torso and
  hips follow; your elbows prop you on the counter on the side away from
  where you look. In third person, come round to the front and your avatar
  looks ahead, so you can see its face. A POS terminal rises out of the counter with the menu
  and your tab; order, and Max waits at the pad on the counter while a
  glass rezzes in, fetches the bottle, sets the glass in front of you and
  pours. Empties go back to the pad to de-rez. Click the glass to drink: you raise it and drink a sixth
  of it (elbows and all), and the sip goes on your tab, which your compute pays to his
  mind. Leave it unfinished and your terminal and your stool wait for you.
- **Max Pablo tends bar.** He shuffles between the taps, the sink, the
  shelf and the till, splits his time between chores and customers,
  thinks his aphorisms aloud, and in conversation he's
  [ELIZA](src/npc/eliza.js) with a bartender's script.
- **The bar remembers.** Your glass, the bottles, your tab and what you
  told Max stay in your browser; the vCPU is saved to OPFS and resumes
  exactly where it left off. `?fresh` starts it from power-on.
- **The jukebox** in the corner plays 8-bit tracks on an NES-style synth
  in Web Audio: public-domain classics (Korobeiniki, Grieg, Joplin,
  Beethoven, Bach) and originals like the trance anthem *Non-Maskable*.
  J plays, N skips, M mutes ([credits](src/audio/CREDITS.md)).
- **The Art Car** outside the bar runs its light show on a 6502 of its own
  and drives as fast as that chip computes. Press E to ride.
- **Your face, your avatar.** *Mirror my face* runs MediaPipe's face,
  pose and hand landmarkers in your browser: your face on the visor, your
  head turning its head, your arms raising its arms, your hands (thumbs
  up, peace, OK, fists) as light skeletons. Video never leaves your
  machine.
- **Pablo's abode** is through the arch, at human scale: the portal
  carries a real 224,000× magnification. Its sky is ready to come from
  [celestiary](https://celestiary.org) through NetGL once celestiary's
  layer page has a sky mode; until then it's procedural.
- **Out the door, the Grid.** A gate on the street jacks you into
  [NetMap](https://pablo-mayrgundter.github.io/netmap/), maps of the
  internet you can travel.

| The street, from 100 m | The die, from orbit | Pablo's abode |
|---|---|---|
| ![The bar on the NMI pad, with chip traces in neon](docs/img/street.png) | ![The whole 6502 die as a city](docs/img/die.png) | ![The abode: a temple, a spiral tree of light, candles](docs/img/abode.png) |

The original fever dream, and the principles behind it, are in
[docs/VISION.md](docs/VISION.md). What's built and what's next, organized
as Initiative › Epic › Story › Task with cross-cutting Technology Tracks, is
in [docs/PLAN.md](docs/PLAN.md).

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # assembler, chips (one Life generation, ~15 s), frames, ledger
npm run build      # → dist/, deployable as static files
```

Controls: WASD or arrows to walk, Shift to run, drag to look, wheel or
pinch to zoom out over the die. On touch screens, drag the left half to walk.
Enter chats; E at the gate jacks into NetMap. `?fx=0` turns off bloom,
`?enter` skips the intro, and `?debug` exposes `window.exo` for poking at
the scene from the console.

Pushes to `main` deploy to [exo.cafe](https://exo.cafe) from the `gh-pages`
branch; each pull request gets a preview at
`https://exo.cafe/pr-preview/pr-<n>/`. The domain is set in the repo's
Pages settings, not in this repo.

Open two tabs to see presence: they share a room over `BroadcastChannel`
until the Synchronizer (Matrix and murmur) replaces it.

## Layout

| Path | What |
|---|---|
| [src/chip/](src/chip) | the 6502: switch-level sim (`sim.js`), assembler, Life and light-show programs, worker |
| [src/world/](src/world) | the chip as a city floor, the bar, the abode, portals, textures |
| [src/avatar/](src/avatar) | voxel and smooth avatars, face tracking |
| [src/cosmic/](src/cosmic) | frames of space and time, real units (`units.js`) |
| [src/mist/](src/mist) | the gift economy: scheduler, dashboard, receipts, rez ledger |
| [src/net/](src/net) | presence, behind a transport interface |
| [src/audio/](src/audio) | the jukebox: an NES-style synth, a song format, the playlist |
| [src/npc/](src/npc) | Max: the bartender's state machine, ELIZA and his script |
| [public/chip/6502.json](public/chip) | the netlist and layout, from `scripts/import-visual6502.mjs` |
| [docs/](docs) | vision and plan |

## Credits and licenses

Code: MIT ([LICENSE](LICENSE)). The simulator is a port of visual6502's
MIT-licensed `chipsim.js` and agrees with it node for node.

The 6502 layout and netlist are © 2010 Greg James, Brian Silverman and
Barry Silverman, under **CC BY-NC-SA 3.0**
([public/chip/LICENSE.md](public/chip/LICENSE.md)): fine for this
non-commercial art demo, but anything commercial built on Cloud City needs
another chip or their permission (see the plan's open questions).

The bar's look borrows the palette and type of
[pablo-mayrgundter.github.io](https://pablo-mayrgundter.github.io), with
nods to Tron, Neal Stephenson's Metaverse and Ready Player One.
