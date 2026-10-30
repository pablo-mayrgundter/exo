# Vision

Exo Cafe began as a fever dream during COVID, posted at exo.cafe as a TODO
list. This page keeps that text, the principles it came from, and how the
first scene interprets them.

## Who's who

- **Freality Metaverse Construction (FMC)**: the org. Originally X Co, but
  that name has since been taken by another hacker. A next-generation camp
  business to help group minds function, on burner principles and
  cybernetic theories of AI, with a distributed business model, looking for
  the benevolent and charming futurists of the world. Think Weyland-Yutani,
  if Weyland-Yutani were a theme camp.
- **Cloud City**: the platform. Really a Technology Showcase as a Platform
  (TSaaP), trying to glean where we're going. A Cloud City is a region where
  the Synchronizer is deployed; you travel between them by portal, and they
  sit on real clusters of people, as the GeoNetMap layer shows.
- **exo.cafe**: the community, and the first live instance of Cloud City.
  Max Pablo is bartending.

## The world

A grid world, after Tron, Neal Stephenson's Metaverse and Ready Player One:

- The coordinate frame is unlimited, but **material is limited by memory**
  and **motion is limited by compute**.
- Spawning allocates a bounding voxel region for your body. Web guests get
  a minecrafty experience. **Donate resources (with Mist) and get more rez.**
- The bar is built on a PCB/wafer schematic, laid out with cosmic.js, in a
  corner of Pablo's CPU. Its lights follow the voltages on the chip's lines,
  and everything in it runs on its own timescale; cosmic.js and Portal do
  the space and time reprojection that connects it to other places in
  cyberspace, such as Pablo's abode.
- Out on the Grid you shoot around the cyberlandscape, the internet itself,
  as NetMap draws it. That's the original Tron idea, made functionally meta.
- Your avatar is Tron-suited and wears your face, by camera mocap.

## Mist computing

From Pablo's [Mist Computing](https://goo.gl/sXvtj1) (2015, updated 2023):

> The cloud is up in the sky, severe and remote from us.
> The mists are down here, friendly, surrounding us.

- **I am the locus of my cybernetic self**: the source, owner and
  controller of my data and compute. My data center should be as close as
  my pocket, as secure and private as my home. Access to my data is
  granted on my terms, for limited interactions with meaning and context.
- **My social network is my default computing context**, trustee and
  insurer of my cybernetic self. Our computing architecture, not just its
  applications, should grow social bonds, not deplete them. Compute should
  be closely coupled with cooperation: many mobiles make for fast compute.
- **Learn with others, do it yourself. Think globally, act locally.** Share
  code; build ecosystems where proximity, diversity and redundancy are the
  keys to utility and beauty.

Designs it points to: the phone as data center, CRDTs over OT, Sandstorm's
federated hosting, and Matrix as an open, decentralized pub/sub layer. So
we play with art and physics to move from the Cloud to the Mist.

> Our protocols have withered as the giant walled gardens took over. We need
> more decentralized approaches again. … From User Generated Content to
> Participant Built Community.

## How the first scene reads this

| Dream | In the scene now |
|---|---|
| Building is a PCB schematic in a corner of Pablo's CPU | The bar's walls are circuit board; it sits on the 6502's top-left pad, NMI, the one interrupt you can't ignore |
| Lights fade with voltage changes on the circuit's lines | Light tubes follow db0–7 and ab0–15, the counter edge clk0, each line's average voltage over 50 ms |
| A street that's really a chip trace | The die at 0.1 m per unit; the HUD names the street after its node (`NMI St`, `DB3 St`, …) |
| Simulate it running Life | Life in 6502 assembly, on a transistor-level sim; the Life wall shows RAM as it's written |
| Different timescales, reprojected | cosmic.js frames: bar ×1, chip ~1 : 500, abode ×600 |
| Portal to Pablo's abode | A render-target portal in the west wall; the abode is a temple plaza after the photo of the glowing tree |
| Guests are minecrafty; donate for rez | Voxel bodies at 0.16 / 0.08 / 0.04 m, then smooth; donated cycles buy the tiers |
| Avatar morphs with your face | MediaPipe face landmarks drawn on the visor; head pose drives the head |
| Shoot around the Grid with NetMap | A gate on the street jacks into NetMap (a link for now; NetGL later) |
| Presence chat with Max Pablo | Max greets you and talks shop; tabs share a room; Matrix and murmur next |

Still a dream: cosmic.js plugins (relativistic, branchial, gauge), orbit.js
from Celestiary, soliton-ai.js, and a projection that maps calculations to
where they happen on the die. They're in the [plan](PLAN.md).
