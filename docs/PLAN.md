# Plan

How FMC builds Cloud City, starting from exo.cafe. Work is organized the way
Bldrs projects are:

- **Initiative**: an outcome we want in the world (I1, I2, …).
- **Epic**: a shippable chunk of an initiative (E1.1, …).
- **Story**: something a person can do when it's done, written from their
  side (S1.1.1, …).
- **Task**: the work, as checkboxes.
- **Technology Tracks** cut across all of it (T1, T2, …): each track owns a
  body of tech, and its tasks show up under whichever stories need them.
  Some tracks already live in other repos.

Status: ✅ shipped in the first scene · 🔜 next · 💭 later.

## Who

| | Role |
|---|---|
| **Freality Metaverse Construction (FMC)** | the org: a camp business for group minds, distributed, burner principles |
| **Cloud City** | the platform FMC builds: places joined by portals, people kept in sync, resources from the Mist |
| **exo.cafe** | the community prototyping it, and Cloud City's first instance |

## Technology Tracks

| Track | Owns | Where it lives | Status |
|---|---|---|---|
| **T1 Grid rendering** | three.js scenes, the Tron look (bloom, neon edges), LOD, WebGPU later | this repo, `src/world/` | ✅ first scene |
| **T2 Chip simulation** | switch-level 6502, its programs, speed, other chips | this repo, `src/chip/`; data from [visual6502](https://github.com/trebonian/visual6502) | ✅ sim + Life |
| **T3 Avatars and mocap** | voxel and smooth bodies, face, then body pose | this repo, `src/avatar/` | ✅ face |
| **T4 Portals and NetGL** | doors between places; GL-level links between apps | [portal](https://github.com/pablo-mayrgundter/portal) (NetGL on npm) and `src/world/portal.js` | ✅ same-page portal; NetGL in production elsewhere |
| **T5 Synchronizer** | presence, chat, voice, rooms; Matrix and murmur | `src/net/` now; shared with Bldrs Collab | 🔜 |
| **T6 cosmic.js** | frames of space and time, reprojection, floating origin, orbits | `src/cosmic/` now, its own package later | ✅ frames and clocks |
| **T7 NetMap** | maps of the internet; GeoNetMap; travel along real routes | [netmap](https://github.com/pablo-mayrgundter/netmap) | ✅ live, linked |
| **T8 Mist runtime** | donated resources, identity, local-first data, self-hosting | `src/mist/` | ✅ ledger; 🔜 shared compute |
| **T9 Celestiary** | the sky: stars, planets, orbit.js | [celestiary](https://github.com/celestiary/web) | 💭 |
| **T10 Platform and ops** | hosting, domain, CI, budgets, licenses | this repo, `.github/` | ✅ Pages |

## I1 · Exo Cafe: the first live Cloud City

*A place worth showing up to: a bar you can walk into, a street that's a
real computer, a bartender, and other people.*

### E1.1 The bar ✅ (T1)
- **S1.1.1** As a visitor, I can walk into a Tron bar built on a circuit board. ✅
  - [x] Walls of procedural PCB inside and out; door, arch, counter, stools, tables, back bar
  - [x] Facades hide while you're inside so the camera always sees in
  - [x] Collisions with walls and furniture
- **S1.1.2** As a visitor, I can see the chip's activity in the bar's lights. ✅ (T2)
  - [x] db0–7 as wall tubes, ab0–15 across the ceiling, clk0 on the counter edge
  - [x] Each light follows its line's average voltage over a 50 ms window, eased
  - [ ] 🔜 Map more of the chip into the room: the ALU's bus as the bar top, the register file as bottles
- **S1.1.3** As a visitor, I can read what this place is. ✅
  - [x] The original TODO scrolls on the east wall; the Menu has it and the Mist principles
- **S1.1.4** As a visitor on a phone, I can get around. 🔜
  - [x] Touch: drag left half to walk, right half to look, pinch to zoom
  - [ ] On-screen buttons for interact and chat; check on real devices

### E1.2 The street is a 6502 ✅ (T1, T2, T6)
- **S1.2.1** As a visitor, I can walk out the door onto a trace and zoom out to see the whole die. ✅
  - [x] All 8,233 polygons at 0.1 m/unit, layered diffusion → poly → metal, lit by node voltage
  - [x] Edges fade with distance and grazing angle so the die reads from orbit
  - [x] HUD names the street after its node (`NMI St`, `DB3 St`) and gives chip coordinates
- **S1.2.2** As a visitor, I can watch the computer compute. ✅
  - [x] Life on a 16×16 torus, in 6502 assembly; a glider drops in every 32 generations
  - [x] The Life wall shows RAM as it's written, cursor on the cell being computed
  - [x] Click a cell to poke RAM
  - [ ] 🔜 Highlight the streets an instruction uses as it runs (the "projection algorithm")
  - [ ] 💭 Projection lines from the die to the RAM "wafers" where the board lives
- **S1.2.3** As a visitor, I can feel the chip's timescale. ✅ (T6)
  - [x] HUD and the bar's CPU panel give kHz and τ against the native 1 MHz
  - [ ] 🔜 Slow-motion mode: step half-cycles and see one signal propagate

### E1.3 Max Pablo, bartender ✅ / 🔜
- **S1.3.1** As a visitor, I'm greeted and get the lay of the land. ✅
  - [x] Max greets you on approach; regulars by name, with "your usual?"
- **S1.3.2** As a visitor, I can talk with Max. ✅ (ELIZA, for now)
  - [x] ELIZA after Weizenbaum's DOCTOR and Emacs `doctor.el` (`npc/eliza.js`), with a bartender's script (`npc/max-script.js`): the bar, the menu, the Mist, the chip; a plain crisis-line answer to self-harm phrases
  - [x] What you tell him ("my …") comes back later, across visits
  - [x] Subtitles while seated, since his bubble is above a first-person frame
  - [ ] An AI Max, opt-in and rate-limited, with the docs as context
- **S1.3.3** As a visitor, I see Max work the bar. ✅
  - [x] He shuffles between stations (taps, sink, shelf, till) and leans in to each
  - [x] With customers he splits his time between chores and conversation; spells are longer with a drink in front of you
  - [x] Not in a conversation, he thinks aloud: his aphorisms, one per thought of his job on the vCPU
- **S1.3.4** As Pablo, I can tend bar as Max myself. 💭 (T3, T5)

### E1.7 Stools and drinks ✅ / 🔜 (T1, T3, T8)
- **S1.7.1** As a visitor, I can sit at the bar. ✅
  - [x] E on a stool, E to stand; first person while seated (zoom out for third)
  - [x] Looking turns the head, with the torso (20%) and hips (10%) following
  - [x] Arms prop you on the counter: looking right, on the left elbow; left, the right; ahead, one, the other or both, shifting; weight shifts on its own now and then
  - [x] Others see you seated, and where you look
  - [x] First or third person, a toggle in the status panel (V, or scroll), remembered for sitting and walking separately
  - [x] Key prompts show in the middle for 3 s, then dock in the status panel
- **S1.7.2** As a visitor, I can order a drink and watch it made. ✅
  - [x] Four 8-bit cocktails; order on the stool's POS terminal (tap a row, or 1–4) or by name ("a Carry Flag please")
  - [x] A terminal rises out of the counter when you sit and sinks when you leave, but stays up while your drink is unfinished: an open tab keeps your spot, and nobody else can take that stool
  - [x] The terminal shows the menu, your glass, your tab and your latest receipts
  - [x] Open drinks go out with presence, so everyone sees each other's glasses and terminals
  - [x] Max fetches a bottle of the drink's colour from the back bar, carries it, pours, and puts it back; bottles hold four pours, and he restocks empties at the shelf
  - [x] Orders interrupt his chores and conversation
- **S1.7.3** As a visitor, my drink is a donation. ✅
  - [x] A drink is drunk a sip at a time, by clicking your glass: for the sip (4 s) your budget is donated to Max's mind and the glass drops by what it donated (a drink holds ≈200k half-cycles); untouched, nothing is drunk or donated
  - [x] Your tab counts drinks and cycles; an empty glass gets "another?", and shorter conversations
  - [ ] Drinks for others: buy a round (a donation in their name)
- **S1.7.4** As a regular, the bar remembers. ✅ (in this browser)
  - [x] Glasses on the counter, bottle levels, your tab and Max's memory of you in localStorage
  - [x] The vCPU itself, saved to OPFS every 20 s and on leaving, resumes exactly (Life carries on from its generation)
  - [ ] Shared bar state for everyone in the room (with E2.2 and E4.1)

### E1.4 More streets and buildings 💭 (T1, T2)
- **S1.4.1** As a builder, I can put up a building on a pad.
  - [ ] Pads as lots; a building format (glTF + a manifest); placement rules
- **S1.4.2** As a visitor, I can visit other chips' cities. (visual6502's repo also has the 6800 and Z80)

### E1.6 The jukebox ✅ / 🔜 (T1)
- **S1.6.1** As a visitor, I can play 8-bit music in the bar. ✅
  - [x] An NES-style APU in Web Audio (two pulses, triangle, noise), a song text format, eight tracks: public-domain classics and originals (`src/audio/CREDITS.md`)
  - [x] A jukebox cabinet with a spectrum screen; J play, N next, M mute; the music fades with distance
  - [ ] Tap or click the cabinet to play (touch screens have no J key)
  - [ ] A 6502 job that drives the APU's registers (`apu.poke($4000…)`), so the music runs on the vCPU too

### E1.5 Art cars ✅ / 🔜 (T1, T2, T8)
- **S1.5.1** As a visitor, I can ride an art car that comes to life when someone gives it cycles. ✅
  - [x] The Art Car: a 32-LED arch whose light show is a program on its own nested 6502 (`chip/lightshow.js`, ~700 cycles a frame), checked frame for frame against a JS reference
  - [x] It drives a loop at a speed set by its chip's frames per second: a crawl on the implicit baseline, rolling when given to
  - [x] E to board and to step off
- **S1.5.2** As a builder, I can bring my own art car: a body (glTF), a 6502 program, and what its RAM drives. 💭
- **S1.5.3** As riders, we steer it along streets (chip traces) rather than a fixed loop. 💭

## I2 · Mist: give resources, get rez

*Material is limited by memory and motion by compute, and both come from
participants, not a landlord.*

### E2.0 The gift economy ✅ / 🔜 (T8, T2)
*Being here already costs something; giving is on top of that, by choice,
to the things you want to see alive.*
- **S2.0.1** As a visitor, I can see what my machine spends here. ✅
  - [x] Mist dashboard: implicit (main thread, measured; each simulation's baseline) and explicit (my gifts), as shares of a core
  - [ ] Measure the GPU's share too (EXT_disjoint_timer_query where there is one)
- **S2.0.2** As a visitor, I set a gift budget and give it to things by clicking their $. ✅
  - [x] Budget as a share of one core; split among the things given to, in proportion to gifts
  - [x] Slots (cores to spare, up to 4); gifts beyond them queue
  - [x] Nobody giving: a thing drops back to its implicit rate
- **S2.0.3** As a giver, my frames carry my name, and anyone can check the work. ✅
  - [x] A receipt per frame: cycles, the share given, and hashes of the frame's input and output
  - [x] Life's receipts verify in JS (one generation: ~73k cycles on the nested 6502, microseconds in JS)
  - [x] The Life wall's caption names who powered the generation (a quarter or more of its cycles)
  - [ ] Receipts signed with the giver's key and posted to the room, so others see the names too (with E2.2, E2.3)

- **S2.1.1** As a guest, I spawn into an allocated voxel region and rez in, minecrafty. ✅
  - [x] Allocation shown as a box; voxels fill in bottom up
  - [x] One body definition (capsules and spheres) sampled at 0.16, 0.08, 0.04 m, or smooth
- **S2.1.2** As a visitor, I can give compute and watch myself sharpen. ✅
  - [x] Every cycle given through the Mist is credit; four tiers, GUEST → RESIDENT → BUILDER → MIST
  - [x] Credit persists in the browser
  - [ ] Battery: lower the budget on battery power, where the Battery API says so

### E2.2 Shared compute 🔜 (T2, T5, T8)
*Today every visitor runs their own copy of the chip; the credit is honest
but nobody else benefits.*
- **S2.2.1** As visitors in the same room, we see the same chip state.
  - [ ] Treat the 6502 as a deterministic replicated state machine: every peer runs it; RAM pokes are events, ordered by the room (Matrix event order); state hashes every N cycles detect divergence
  - [ ] Checkpoints (node states + RAM, ~66 KiB) so latecomers join without replaying
- **S2.2.2** As a donor, my cycles move the shared clock.
  - [ ] Donors run ahead and publish signed checkpoints; slower peers fast-forward to them
  - [ ] Credit for checkpoints others accepted, not just for cycles run locally
- **S2.2.3** As a visitor, the chip runs faster than one CPU.
  - [ ] WASM or bit-parallel sim (T2); split by clock phase or by netlist partition across workers

### E2.3 Identity and data ownership 💭 (T5, T8)
- **S2.3.1** As a participant, my identity is mine: a key pair or Matrix ID, not an account here.
- **S2.3.2** As a participant, what I build is stored where I choose (local-first, CRDTs), and others get access on my terms.
- **S2.3.3** As a participant, I can host part of Cloud City from my phone (the phone-as-data-center experiment).

## I3 · Cyberspace travel: portals between places

*You usually have to portal between Cloud Cities; travel is how you learn
the shape of the net.*

### E3.1 The abode ✅ (T1, T4, T6)
- **S3.1.1** As a visitor, I can look through the arch into Pablo's abode and walk through. ✅
  - [x] Render-target portal with an oblique near plane; avatar and camera carried through the link
  - [x] The abode: temple plaza, a cyan spiral tree in the cobbles, candles on spirals, a dusk sky
  - [x] Its clock runs ×600: the stars wheel round about every 2.4 minutes
- **S3.1.2** As Pablo, my abode is my own app on my own site, linked in. 🔜 (T4)
  - [ ] Move the abode to pablo-mayrgundter.github.io; link it with NetGL as a cross-origin guest
  - [ ] Recursion: see the bar through the abode's arch through the bar's arch

### E3.2 The Grid: NetMap 🔜 (T7, T4)
- **S3.2.1** As a visitor, I can jack into NetMap from the street. ✅ (a link, for now)
- **S3.2.2** As a visitor, I can ride a LightSail along the internet's links. 🔜 (contracts in [portal#56](https://github.com/pablo-mayrgundter/portal/issues/56), RFC 0004)
  - [ ] NetMap as a NetGL guest layer in exo: a guest page (`map.html`) whose deck.gl drawing is recorded and replayed into exo's scene, on an agreed frame (ECEF metres; exo's die at 0° N 0° E)
  - [ ] NetMap publishes its links and routes as path anchors (RFC 0004 §4); exo subscribes
  - [ ] The LightSail, exo's own Tron asset at µm scale, flies those paths by exo's clock; the rider is your avatar
  - [ ] portal-netgl: a second deck guest must survive the first one detaching (RFC 0004 §6)
  - [ ] Traceroute from the visitor (or their AS from the browser's IP, server-side) to exo's host
- **S3.2.3** As a visitor, I see NetMap through a window in the bar, live. (NetGL guest; NetMap is deck.gl)
- **S3.2.4** As a group, we pick where our room's server runs, on GeoNetMap, for least latency. (T5)

### E3.3 The sky: Celestiary 💭 (T9, T4, T6)
- **S3.3.1** As a visitor in the abode, I see the real sky for my place and time, through Celestiary.
  - [x] Host side (`src/world/celestiary-sky.js`): celestiary's `layer.html` in a cross-origin iframe draws six cube faces in the equator of date at the abode's ×600 time into an atlas, and the dome samples it under the dusk glow and turns it by sidereal time. A guest whose `layer:hello` lacks kind `sky` is let go, with the procedural sky kept
  - [ ] celestiary: a sky mode for `layer.html` (`?sky=1`: stars, planets, Sun and Moon; hello `kinds: ['sky'], frames: ['equator-of-date']`). Today's layer draws orbits only, so production stays procedural
  - [ ] portal-netgl: `frame: 'equator-of-date'` and `observer` in `NetGLLayerView` (its type only names `'ecef'`)
- **S3.3.2** As a visitor, I can step out of the bar into the solar system (a door, like portal's Celestiary demo).

## I4 · Presence: together in the same place

*Multi-person presence chat on top of the Synchronizer, with Max Pablo.*

### E4.1 Presence protocol ✅ / 🔜 (T5)
- **S4.1.1** As a visitor, I see others' avatars move, at their rez. ✅ (between tabs of one browser)
  - [x] Presence over a transport interface; BroadcastChannel transport; state at 10 Hz
- **S4.1.2** As a visitor, I see people from anywhere. 🔜
  - [ ] Matrix transport: a room per Cloud City place; state as ephemeral events, chat as messages
  - [ ] Interest management: only people near you, at a rate that falls with distance
- **S4.1.3** As a visitor, my mocap reaches others. 🔜
  - [x] Arms: MediaPipe Pose aims each arm shoulder to wrist; raise your hands and the avatar does; arm directions go out with presence
  - [x] While the camera's on, a CAM light in the status panel; the video preview is hidden unless you ask for it
  - [ ] Send head pose and ~50 blendshape weights, not landmarks (a few hundred bytes a frame)
  - [ ] Draw the visor from blendshapes, so the face survives the network
  - [ ] Elbows: split the arm in two and use the elbow landmark

### E4.2 Voice 🔜 (T5)
- **S4.2.1** As a visitor, I can talk to people near me, spatially.
  - [ ] murmur (Mumble) per room, with positional audio; or WebRTC SFU — decide with Bldrs Collab
  - [ ] The Synch Master deploys murmur containers on demand, one per room group, reused across users
- **S4.2.2** As a group, our voice server runs near us. (S3.2.4)

### E4.3 Chat ✅ / 🔜 (T5)
- [x] Speech bubbles over avatars; Enter to talk
- [ ] Chat history from the Matrix room; moderation tools for hosts

## I5 · Cosmography: knowing where (and when) we are

*cosmic.js: a library for cosmography, to know where we are in the cosmos.*

### E5.0 Real units ✅ / 🔜 (T6, T7, T4)
*Everything in real units with each place's scale declared (portal RFC
0001 §6.1), so portals between places line up.*
- **S5.0.1** As a visitor, I'm at true scale on a true-size chip. ✅
  - [x] The street's scene unit is the micrometre (`cosmic/units.js`); the die is its real ~3.9 × 4.3 mm (0.447 µm per layout unit)
  - [x] Visitors and the bar keep their proportions: ~4.47 µm per body unit, so you're ~8 µm tall, about the 6502's 8 µm design rule
  - [x] The HUD gives positions on the die in µm and mm, and your height
  - [x] The abode stays at human scale in metres; the portal's link carries the ~224,000× magnification
- **S5.0.2** As a developer, the die has a place on Earth: 0° N 0° E, sea level (`sceneToEcef`). ✅
- **S5.0.3** As a developer, Earth-scale guests (NetMap) compose with the µm street without float32 trouble. 🔜 ([portal#56](https://github.com/pablo-mayrgundter/portal/issues/56): declared units, `view.eye`, magnifying portals)
  - [ ] A global scene scale and nested frames, composed in doubles, relative to the eye

### E5.1 Frames ✅ (T6)
- **S5.1.1** As a developer, I can place a scene in a frame with its own scale, orientation and clock, and map points and durations between frames. ✅
  - [x] `Frame`, `reproject`, `reprojectDuration`, live clock rates; tests
- **S5.1.2** As a developer, I can build worlds bigger than float32. 🔜
  - [ ] Floating origin per frame; camera-relative rendering
- **S5.1.3** As a developer, I can publish cosmic.js on its own. 💭
  - [ ] Package it; orbit.js refactored out of Celestiary as a plugin
  - [ ] Plugins: relativistic coordinates, Wolfram branchial coordinates, gauge symmetry

## I6 · Research 💭

- **soliton-ai.js**: study library for the thesis — systems of ODEs for
  solitonic physics (standing magnetic fields), a cyclical neural-net
  solver, GPU realtime display that renders the outside world's reflection
  on a sample plane in the field.
- **Solitonic hardware**: further out, visually recapitulate it, as the bar
  recapitulates the 6502.

## Epic × Track

| | T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8 | T9 | T10 |
|---|---|---|---|---|---|---|---|---|---|---|
| E1.1 Bar | ● | ○ | | | | | | | | |
| E1.2 Street | ● | ● | | | | ○ | | | | |
| E1.3 Max | | | ○ | | ○ | | | | | |
| E2.1 Rez | | | ● | | | | | ● | | |
| E2.2 Shared compute | | ● | | | ● | | | ● | | |
| E3.1 Abode | ● | | | ● | | ● | | | | |
| E3.2 Grid | | | | ● | ○ | | ● | | | |
| E3.3 Sky | | | | ● | | ● | | | ● | |
| E4.x Presence | | | ● | | ● | | | ○ | | |
| E5.1 Frames | | | | ○ | | ● | | | ○ | |

● leads · ○ contributes

## Next up

1. **NetMap as a guest, and the LightSail** (S3.2.2), once [portal#56](https://github.com/pablo-mayrgundter/portal/issues/56) (RFC 0004) has been reviewed.
2. **Matrix presence** (E4.1): the first time two people meet at the bar. Coordinate with Bldrs Collab on Matrix vs. WebRTC and on murmur.
3. **Replicated chip** (E2.2): one chip for the room; donations that help everyone.
4. **Faster chip** (T2): WASM or bit-parallel; Life in fewer cycles (it's ~73k a generation).
5. **Abode as its own app** (S3.1.2): the first NetGL link between two Cloud City places.

## Open questions

- **Chip data license.** visual6502's layout is CC BY-NC-SA 3.0. Fine for
  exo.cafe as an art demo; not for anything FMC sells. Options: ask the
  authors, use a chip with open layout data, or generate our own layout.
- **Who runs the clock?** In a replicated chip, which peer's checkpoints
  are canonical: the fastest, a quorum, or the room's host?
- **What does donation measure?** Cycles run is honest locally. Shared, it
  should be useful work others accepted.
- **Face privacy.** Blendshapes over the network reveal less than video
  but still identify; make it opt-in per room.
- **Hosting.** GitHub Pages is a cloud; Mist would self-host. Which parts
  go peer-to-peer first? (The MediaPipe runtime is already served from
  exo.cafe rather than a CDN; the face model still comes from Google.)
