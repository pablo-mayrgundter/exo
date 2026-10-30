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
- **Browser checks: headless Chromium on SwiftShader.** Launch Playwright
  with `--use-angle=swiftshader --enable-unsafe-swiftshader`; don't run
  `playwright install` in cloud sessions. Use `?enter&debug` and drive
  `window.exo` (avatar, controls, ledger, …) with `page.evaluate` rather
  than replaying input. Hide `.panel,.chat,.hint` for clean screenshots.
- **Face tracking in tests:** Chromium's `--use-fake-device-for-media-stream
  --use-fake-ui-for-media-stream --use-file-for-fake-video-capture=face.y4m`
  with a still of a face (ffmpeg: `-loop 1 -i face.png -t 3 -pix_fmt yuv420p face.y4m`).
  The model comes from storage.googleapis.com, so pass the session proxy to
  Chromium (`proxy: { server: $HTTPS_PROXY }`).
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
  `pr-preview/`. The main deploy's `clean-exclude` keeps the previews; keep
  it there, and keep `public/CNAME`, or exo.cafe falls off the site.
- Report what you couldn't verify (a real camera, a phone, real GPUs).

## Pull requests

- Subscribe to PR activity after opening one; merge only when the user says so.
- Keep docs/PLAN.md honest: tick tasks you finish, add ones you discover.
