# Exo's parts as portal guests, and one way to composite them

*2026-11-04. Written with the map under the chip, the first thing composited
in place in exo's own street. A review of each part of exo: whether it should
be its own app, drawn into exo through NetGL (portal-netgl), and how exo
should put them all together.*

## What exo composites today

| Part | Where it comes from | How it's put in the frame |
|---|---|---|
| 1. Exo Cafe (the bar, Max, the avatars) | exo's own scene graph | drawn by exo, the host |
| 2. The abode | exo's own scene graph, another scene | rendered into a texture for the doorway's surface (`portal.js`), or drawn directly once you're through |
| 3. The abode's sky | celestiary's `sky.html`, a NetGL guest | **in place**: replayed into the abode's framebuffer, under the abode (`inplace-guest.js`, `celestiary-sky.js`) |
| 4. The chip | exo's own: the 6502 in a worker (`chip/sim.js`), its floor (`chipfloor.js`) | drawn by exo, the street's ground |
| 5. NetMap over the chip's horizon | netmap's `map.html`, a NetGL guest | **in place**: replayed into the street's framebuffer, under the street (`netmap-ground.js`) |
| 6. NetMap framed at the gate | netmap's `map.html` again, a second guest | replayed into a render target, a texture on the gate's window (`netmap-window.js`) |

Two of the six (3 and 5) now go through one path. For each frame:
1. exo sends the guest the camera it draws that scene with, as a matrix view
   in a frame they agree on: the equator of date for the sky, ECEF for the map;
2. it holds the frame until that camera's frame is in (at most 250 ms);
3. it replays the frame into the framebuffer the scene is being drawn into;
4. it draws the scene over it with depth cleared.

The guest writes linear colour and exo encodes it at the end. Until its
first frame, exo shows its own background (black for the sky, the void for
the map), and then the guest fades in. This is the path the rest should
converge on.

## Part by part

### 1. Exo Cafe: the host, not a guest

The cafe is exo itself: the visitor's body and controls, presence and chat,
Max, the ledger. Everything else is composited round it, so it is the host.

It would only be a guest if another app embedded exo: the cafe drawn on
netmap's globe at Null Island, or in celestiary. That is worth keeping
possible, and the way to do it is the contract below. The cafe's drawing
would then be one more in-place layer, in metres, for a camera it is given,
with depth it shares. No split now.

### 2. The abode: exo's, but composited like a guest

The abode has its own clock (×600), its own scale (metres, against the
street's micrometres) and its own sky. It is Pablo's place, and could well
become its own app, in its own repository, served as a guest one day. What
it needs from exo, the visitor's body drawn in it and the way back, is the
same as what any guest place would need. So the protocol should carry that
first.

For now it stays a scene in exo's page. Its doorway is the one piece of
compositing that still goes through a texture: the other side is rendered
into a target, sampled on the door's surface by screen position, with an
oblique near plane.

The texture should go. Instead:
- draw the door's shape into the stencil buffer;
- draw the other side straight into the frame inside it, with its own
  in-place layers (its sky);
- clear depth inside the stencil.

That is the same screen policy portal-netgl applies to a guest drawn
through a door (`stencil: {ref}`). It drops a full-screen target and a
resample, and the abode through the door then composes exactly as the
abode around you.

The camera crossing on its own side (`viewSide`) and the avatar's ghost
while straddling the door stay as they are.

### 3. The abode's sky: a guest, as it is

celestiary is a separate app, by a separate team, and heavy: the whole app
runs, with its own exposure. Being a guest is right.

Drawn under the abode at infinity, it needs no depth from exo, and none
from it. The one thing to add is a depth contract for what it may one day
draw nearer than infinity. Its clouds, for instance, could pass in front of
the abode's roofs, which would need shared depth.

### 4. The chip: exo's, rendered as a layer

The 6502 and its floor could be an app of their own, visual6502 as a walkable
city. But exo is built on it:
- the bar sits on its NMI pad;
- the vCPU's jobs (Life, the Art Car's show, Max's mind) run on it, paid for
  by the ledger;
- the HUD reads the node under your feet;
- the avatars stand on it and occlude it, and it occludes them.

As a guest, every one of those would cross the wire. In particular it would
need shared depth with exo's own drawing every frame.

So keep the simulation in exo. Treat its floor as a layer with the same
contract as a guest's (a camera in metres in, a frame with depth out), so
that a page showing the chip alone, or a host embedding it, could reuse it.
No split now.

### 5. NetMap over the horizon: a guest, in place

netmap is a separate app with its own data (megabytes of AS-level network)
and its own renderer (deck.gl), so being a guest is right.

It is drawn under the street at true scale: the die at 0° N 0° E on deck's
sphere (its hello declares the radius). Below about 30 km netmap uses a flat
Web Mercator viewport centred under the camera, with deck's float64 offsets,
so it holds from 1 cm up (`matrixView.js` in netmap). Above that, a globe,
out to orbit: exo's zoom now reaches the whole Earth.

Next:
- **Shared depth.** The map draws under everything, its depth cleared. That
  holds while the street is in front of it. Once links arc over the bar, or
  you stand in the map after the drop through the gate, the map and exo's
  drawing need one depth: the map writing exo's depth convention, or one
  depth range split between them.
- **One netmap, not two.** Today netmap is loaded twice: here, and for the
  gate's window (6). See below.
- **Its projections.** geo now; cyber and hybrid are netmap's layouts on the
  same surface, a parameter of the view.

### 6. NetMap framed at the gate: the same guest, a second view

The gate's window is meant to be a picture: a framed map, a screen in the
world. So a texture is the right composition for it, unlike the doorway. It
is a second view of the same app as part 5, though, and it loads a second
copy of netmap (a second deck, a second network download).

It should be one guest with two views. portal-netgl's parts already allow
this: several draws for one view, each to its own target, with `part` on the
frame-end and `beforeFrame` on the receiver.
- The in-place map is drawn every frame, for the camera.
- The gate's globe is drawn at its own pace, into its target.

One guest also makes the drop through the gate simple. The globe you pick a
spot on and the map you fall into are the same netmap, with the same data
and the same time.

## One way to composite

What exo should converge on:

1. **Every part is a layer of a scene, with one contract.** A layer is drawn
   for a camera given as a matrix view in metres, in a frame the layer
   declares:
   - the street's micrometres, through `units.js`;
   - ECEF for the map;
   - the equator of date for the sky.

   Into the frame being drawn, it writes linear colour, premultiplied. It
   also declares its depth:
   - **none**: the sky, at infinity;
   - **under**: the map's far field, depth cleared after it;
   - **shared**: the chip, the cafe, the map up close.

   exo's own drawing (the cafe, the chip, the abode) and NetGL guests (the
   sky, the map) differ only in where the drawing comes from.
2. **A scene is drawn by drawing its layers**: under-layers first, then
   exo's scene graph and shared-depth layers.
3. **A portal is a stencil, not a texture.** Its other side is drawn into
   the same frame, inside its mask, with that scene's layers, for the
   doorway's virtual camera, recursively. The camera's own side is where it
   is (`viewSide`).
4. **A frame is held once for all its guests**: each guest the frame draws
   gets its camera, and the frame waits for all of them (`main.js` does this
   now). That's sync for everything in view, and nothing asked for what
   isn't drawn (`portal.visible`).
5. **A framed view is a layer drawn into a target** (the gate's window, a
   window in the bar). It's the only kind that is a texture, and it can run
   at its own pace.
6. **The same behaviour for every guest:**
   - loaded on demand;
   - nothing of it shown until its first frame, then faded in;
   - its own fallback if it can't come;
   - one console line for any failure.

   `inplace-guest.js` is that now.

Steps, in order:
- netmap as one guest with two views (5 and 6);
- the doorway by stencil, the abode's layers drawn into the frame;
- shared depth for the map, which the drop through the gate needs;
- the chip's floor and the cafe behind the same layer interface.
