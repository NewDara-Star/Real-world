# Real World: driving simulator in real places

A desktop driving simulator (three.js r186 WebGPU in Electron) set in real
places rebuilt from open map data. The first place is Finglas, Dublin, where the
owner is preparing for the Irish driving test (automatic, Finglas test centre);
Yaba (Lagos) is the second. Hardware: Mac plus a Logitech G29/G923 wheel in PC mode.

Read `ROADMAP.md` for the running order. Research notes live in `research/`.

## Working agreements (from the owner)

- Research how the industry does something (sims, engines, published data)
  before writing it; fix the standard only if it's messy.
- Honest critique, no flattery. Ask before a decision that boxes the project in.
- Don't chat like an AI. Keep the running order in `ROADMAP.md` current.
- Licences: CC0/CC-BY/MIT assets only, credited (`public/tex/CREDITS.md`,
  `public/models/CREDITS.md`). Never Google Street View imagery. Never copy
  code from other sites; techniques only.

## Layout

- `game/`: the app (Vite + TypeScript). `npm run desktop` builds and opens Electron.
  - `src/client/main.ts`: game loop, HUD, driving, sat-nav, pause.
  - `world.ts`: loads the baked world (`public/world/<place>.bin/.json`) and builds chunks.
  - `facade.ts`: the one city material (TSL); surface codes in its header comment.
  - `textures.ts`: CC0 texture sets packed into two atlases (16-texture shader limit!).
  - `roadnet.ts`, `roadrender.ts`, `roadsigns.ts`: SUMO lane network, streets, signals and signs.
  - `trafficnet.ts`: IDM traffic, junction right-of-way, pedestrians, player reactions.
  - `rules.ts`: the examiner (RSA grade 1/2/3 faults). `nav.ts`, `map.ts`: sat-nav and maps.
  - `drive.ts`: the player car (physics, controls, lamps, cabin, mirrors). `carmodel.ts`: the glTF car.
  - `wheel.ts`, `g29.ts`: input (keyboard, pads, the wheel over WebHID with force feedback).
  - `globe.ts`: the world-map launcher (`globe.html`).
- `tools/bake/`: data pipeline. `add_place.py <name> …` fetches Overture, bakes
  the world, builds the SUMO network (`build_net.sh`, `bake_net.py`) and
  registers the place on the globe.
- `tools/assets/fetch_textures.py`: downloads the CC0 texture sets.

## Testing

- `cd game && npx tsc --noEmit` (typecheck), `npm run build`.
- Headless browser screenshots via Playwright (Chromium at /opt/pw-browsers):
  WebGL2 via SwiftShader works. Software WebGPU crashes on big scenes, and its
  WebGL2 allows 32 textures where real GPUs allow 16: count samplers.
- Simulation logic (traffic, examiner, routing) runs headless with
  `npx tsx` scripts that load `public/world/*.net.bin` directly.
- wrangler dev serves `dist/` and goes stale after rebuilds: restart it.
