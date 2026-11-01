# Project conventions for AI assistants

Working norms for agents contributing to exo.cafe. `CLAUDE.md` is a symlink
to this file. Keep it current when you learn something the next session
would otherwise rediscover.

## Where to look

| Working on | Read first |
|---|---|
| What this is and why | [README.md](./README.md), [docs/VISION.md](./docs/VISION.md) |
| What to build next, and where it fits | [docs/PLAN.md](./docs/PLAN.md): initiatives, epics, stories, tracks |
| The chip | `src/chip/sim.js` (port of visual6502's chipsim; keep it node-for-node equal), `life.js`, `asm.js` |
| Portals between apps | [pablo-mayrgundter/portal](https://github.com/pablo-mayrgundter/portal) (NetGL) |
| Maps of the internet | [pablo-mayrgundter/netmap](https://github.com/pablo-mayrgundter/netmap) |

## Working efficiently

- `npm test` runs one Life generation on the transistor-level chip (~15 s);
  `npx vitest run test/asm.test.js` and friends are instant.
- The sim must stay equal to visual6502's original. If you change
  `sim.js`, check the golden values in `test/sim.test.js`; to regenerate
  them, run the original `chipsim.js` + `macros.js` in a Node `vm` with DOM
  stubs and compare `stateString()` per half-step.
- **Long runs.** The sim does billions of group walks an hour. Anything
  counted per walk must survive 2^32: generation marks in `Uint32Array`s
  once wrapped after about an hour and the walk recursed forever (`test/sim.test.js`,
  "wrap"). Test long-run behaviour by starting counters near their limit.
- **6502 read-modify-write.** `INC`/`DEC`/shifts on memory write the old
  value back before the new one. Anything triggered by writes (frame
  counters, receipts) must act on a change of value, not on every write.
- **Rates from the worker's clock.** Under SwiftShader the main thread lags
  and worker messages arrive in bursts; time things (frames per second)
  with timestamps from the worker, not on arrival.
- **Browser checks: headless Chromium on SwiftShader.** Launch Playwright
  with `--use-angle=swiftshader --enable-unsafe-swiftshader`; don't run
  `playwright install` in cloud sessions. Use `?enter&debug` and drive
  `window.exo` (avatar, controls, ledger, …) with `page.evaluate` rather
  than replaying input. Hide `.panel,.chat,.hint` for clean screenshots.
- **Face tracking in tests:** Chromium's `--use-fake-device-for-media-stream
  --use-fake-ui-for-media-stream --use-file-for-fake-video-capture=face.y4m`
  with a still of a face (ffmpeg: `-loop 1 -i face.png -t 3 -pix_fmt yuv420p face.y4m`).
  The models come from storage.googleapis.com, so pass the session proxy to
  Chromium as `proxy: { server: process.env.HTTPS_PROXY }`; its port changes
  between sessions, so don't hard-code it. To test arm aiming without a
  camera, set `exo.face` to `{running: true, poll() {}, arms: {L: [0, 1, 0], …}}`.
- **Mocap test stills.** Crop poses into y4m stills (as for the face) and
  run them through `?enter&debug` with *Mirror my face*; `exo.face.hands`
  and `.arms` say what was seen. MediaPipe tasks-vision 1.2 labels hands
  as the person's own on our unmirrored video (the right hand is "Right"),
  despite older docs saying labels assume a mirrored image; hands are
  matched to the pose's wrists first anyway. The main loop sets the
  avatar's heading every frame, so a screenshot "from the front" set via
  `rotation.y` is really from behind.
- **Phones in Playwright.** Use `devices['iPhone 13']` / `['Pixel 7']`
  (its viewport is 390×664, the browser chrome taken off; pass
  `viewport` for 390×844 or landscape) and `page.touchscreen.tap`. For
  drags and pinches send raw touches over CDP
  (`Input.dispatchTouchEvent`, touchStart/Move/End with `id`s for two
  fingers): they drive `controls` and scroll panels, and a pinch on the
  page shows whether it zooms (`visualViewport.scale`).
  `Input.synthesizeScrollGesture`/`PinchGesture` do nothing headless.
  `?touch` gives a desktop the touch HUD. To tap something in the world,
  project it: `v.project(exo.camera)` → `((x+1)/2·innerWidth, (1−y)/2·innerHeight)`,
  and let a first-person head settle (~1 s) after a look before tapping.
- **Raycasts and lines.** three picks lines within
  `raycaster.params.Line.threshold` world units, and the world unit is a
  micrometre (22 cm at the bar's scale); main.js narrows it. Give
  anything tappable a mesh to hit, not just neon edges.
- **Restart `vite preview` after a rebuild** (stop its background task,
  start a new one): a rebuild replaces `dist/` and renames the hashed
  assets under a running server.
- **Saved state between runs.** The vCPU resumes from OPFS and the bar
  from localStorage; tests that need a known start use `?fresh` (the
  chip from power-on) or a new browser context. `exo.sitDown(i)`,
  `exo.barLife.order(id)` and `exo.barLife.bartender.task` (its `kind`,
  `phase` and pad `job`) drive and read the bar; `exo.barLife.state` is
  the saved state (`gulp(seat)` empties a glass a sixth at a time).
- **Freezing a moment for a screenshot.** Animations run on
  `exo.clock`; set `exo.clock.getDelta = () => 0` to hold a pose (a sip
  started with `barLife.sip(exo.clock.elapsedTime - t)` is `t` seconds
  in), then restore it.
- **Element ids are global.** The canvas is `#view` (and styled full
  screen); a control named the same quietly becomes the canvas. Check
  `index.html` before naming a new element.
- Don't `pkill -f "vite preview"` from a command that itself contains that
  text: it kills its own shell. Run the preview server as a background task.
- **Colours in shaders are linear.** Hex colours through `THREE.Color` are
  converted for you; literals in GLSL are not, and sRGB-looking values come
  out washed out after the OutputPass.
- **Additive layers blow out at distance.** The chip floor's fills use normal
  blending in layer order; only edges are additive, faded by distance and
  grazing angle. Keep it that way or the die turns white from orbit.

## Verification and reporting

- Rendering changes need screenshots: the bar, the street at ~100 m, the
  die from orbit, and the abode through the arch. Every PR also gets a live
  preview at `https://exo.cafe/pr-preview/pr-<n>/`
  (`.github/workflows/pr-preview.yml`); name what to check there.
- Deploys go to the `gh-pages` branch: main at the root, previews under
  `pr-preview/`. The custom domain (exo.cafe) is set in the repo's Pages
  settings, and GitHub writes `CNAME` to the `gh-pages` branch itself. The
  repo has no `CNAME` and shouldn't get one; the main deploy's
  `clean-exclude` keeps GitHub's `CNAME` and the previews. Drop either
  entry and a deploy deletes it (losing the domain or every preview).
- Report what you couldn't verify (a real camera, a phone, real GPUs).

## Pull requests

- Subscribe to PR activity after opening one; merge only when the user says so.
- Keep docs/PLAN.md honest: tick tasks you finish, add ones you discover.
