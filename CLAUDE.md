# World Drive: driving simulator in real places

A desktop driving simulator (three.js r186 WebGPU in Electron) set in real
places rebuilt from open map data. The first place is Finglas, Dublin, where the
owner is preparing for the Irish driving test (automatic, Finglas test centre);
Yaba (Lagos) is the second. Hardware: Mac plus a Logitech G29/G923 wheel in PC mode.
The game in one line: a driving school plus a real-world explorer.

Read `ROADMAP.md` for the running order and `research/15-what-it-takes.md` for
the map of every system. Research notes live in `research/`.

## Working agreements (from the owner)

- Research how the industry does something (sims, engines, published data)
  before writing it; fix the standard only if it's messy.
- Honest critique, no flattery. Ask before a decision that boxes the project in.
- Don't chat like an AI. Keep the running order in `ROADMAP.md` current.
- Licences: CC0/CC-BY/MIT assets only, credited in the `CREDITS.md` of their
  folder (`public/tex`, `public/models`, `public/globe`). Never Google Street
  View imagery. Never copy code from other sites; techniques only. 3D models
  come from the owner's local Claude in Blender (`docs/blender-assets.md`); no
  AI-generated meshes.
- Reference photos (Geograph, Wikimedia, Panoramax, the owner's own) are for
  looking at while modelling; never stored (`reference/` keeps previews only)
  and never textures. Models carry no logos, shop names, real house numbers
  or plates, even for chains like Lidl or Tesco.
- Never put personal data (the owner's email, name) in code, commits or request
  headers. Keys live in environment variables (e.g. `MAPILLARY_TOKEN`); never
  ask for them in chat and never print them.

## There's probably a repo for that

Before writing any system from scratch (a crowd of humans, a city importer, a
tyre model, a weather effect), assume someone has already built it and look
first: GitHub, published datasets, cities' open data, game-dev write-ups. Study
the best two or three, read their code and licences, then write our own
version from what they teach (techniques, never copied code). Write the
findings into `research/` and say which repo the idea came from. The many
open city digital twins (research 17, 19) are the model for this: we import,
we don't hand-build.

## Every line has a reference

Every line of code added or changed in `game/src`, `game/desktop` and
`tools/` carries a reference comment saying where it came from: the
standard and clause (`TSM 9.4.14`), the open project, file and licence
(`Autoware static_obstacle_avoidance.param.yaml th_stopped_time,
Apache-2.0`), the paper, the dataset, or our own measurement and how it was
made (`measured: research/28, Tailte Éireann Ways, median of 1,048 ways`).
A block may share one reference when every line in it follows from that
source; say so at the top of the block. Plumbing that only wires existing
pieces together cites the API it uses (`three.js r186 InstancedMesh docs`).
No source, no line: research first (`research/`), then write. The game
code is being rewritten module by module under this rule (ROADMAP.md).

## Solve the real problem

- **First principles, not patches.** Find why something is wrong before
  touching it. If the model underneath is wrong, rebuild the model. Deleting
  and rewriting messy code is always on the table.
- **One source of truth.** If two things can disagree, one of them shouldn't
  exist. Examples here: road and footpath heights live in `roadrender.ts` and
  the physics reads them; the wheel's rotation range comes from the car's
  steering ratio (`wheelRangeDeg` in `carphysics.ts`), not a hard-coded 900.
- **Delete what's dead.** Unused code, files and stale comments go in the same
  change that finds them; git keeps history. If a deletion needs permission,
  ask in one line and do it once approved.
- **Names say what things are.** Rename the old thing rather than inventing
  `name2` or `newX`.
- **Measure, don't assume.** Read real numbers before deciding (published car
  figures, the real network, what the owner's wheel reports). Say what you
  checked. Read the owner's screen recordings at 12+ frames a second (24 for
  fast moves) and say the rate.
- **Check before you claim.** Nothing is "fixed" until it's been tried on the
  thing it's for. Untested on the real wheel or GPU means say so.

## Fix every cascade

A change isn't done until everything it touches is fixed in the same change.
To find what it touches:
1. **The compiler first.** Change the types to the new model, then run the
   typecheck; every dependent line shows up.
2. **Then the untyped edges:** the baked files (`.bin`, `.net.bin`,
   `places.json`) and the Python bake that writes them, localStorage keys
   (wheel calibration, force feedback, field of view), the multiplayer
   protocol, strings in HTML.
3. **Then what's already out there:** worlds baked by an older pipeline, and
   the owner's saved settings on the Mac.

Everything raised goes in `ROADMAP.md`, in order, and stays current.

## Testing: four paths

Every change is tested down four paths:
1. **Happy:** it does what it's for (drive a lap, pass a junction).
2. **Sad:** things go wrong the normal way: the wheel unplugs mid-drive, the
   physics fails to load, a place has no road network, a fetch fails.
3. **Idiot-proof:** someone does the unexpected: R at 50 km/h, both pedals,
   alt-tab mid-corner, every button at once.
4. **Tragedy:** slow disasters with time or scale: a three-hour session
   (memory, collider counts, the game clock past midnight), clock changes once
   weather uses real time, precision far from the origin, a 21,000-building
   city, old baked worlds.

A test for a bug reproduces the bug first. Test names say the rule in plain
words. Tests live in `game/tests/*.test.mts` (pass/fail, `tests/check.ts`).

## What the change does, as the driver lives it

- **Tell their story** before building a change in behaviour and again before
  shipping: what they do, what they expect, what they'll actually see or feel.
  If those differ, the change is wrong. It goes in the commit message as a
  `Story:` paragraph, including anything untested.
- **Words mean what they mean:** P/R/N/D, "parking brake", "Reverse force
  feedback", the examiner's fault names. If the model can't do what the word
  says, change the model or the word.
- **Nothing behind their back.** Anything the game does on its own (the
  parking brake releasing on throttle, a fault marked, the car reset) is shown
  where they'll see it, with the reason.
- **Two passes in one:** fixing something on a screen includes a pass over that
  screen's states (gears, indicators, night, cockpit and chase, the Mac's size).

## Layout

- `game/`: the app (Vite + TypeScript). `npm run desktop` builds and opens Electron.
  - `src/client/main.ts`: game loop, HUD, driving, sat-nav, pause, force feedback.
  - `world.ts`: loads the baked world (`public/world/<place>.bin/.json`) and builds chunks.
  - `facade.ts`: the one city material (TSL); surface codes in its header comment.
  - `textures.ts`: CC0 texture sets packed into two atlases (16-texture shader limit!).
  - `roadnet.ts`, `roadrender.ts`, `roadsigns.ts`: SUMO lane network, streets, signals and signs.
  - `trafficnet.ts`: IDM traffic, junction right-of-way, pedestrians, player reactions.
  - `rules.ts`: the examiner (RSA grade 1/2/3 faults). `nav.ts`, `map.ts`: sat-nav and maps.
  - `carphysics.ts`: Rapier rigid body, Pacejka tyres, automatic gearbox; car specs (`HATCH_AUTO`, `DANFO`).
  - `drive.ts`: the player vehicle around the physics (controls, lamps, cabin, mirrors, driver's head). `carmodel.ts`: the glTF car.
  - `wheel.ts`, `g29.ts`: input (keyboard, pads, the wheel over WebHID with force feedback).
  - `globe.ts`: the world-map launcher (`globe.html`).
- `game/tests/`: headless pass/fail tests (physics, force feedback, traffic, examiner, repo rules).
- `tools/bake/`: data pipeline. `add_place.py <name> …` fetches Overture, bakes
  the world, builds the SUMO network (`build_net.sh`, `bake_net.py`) and
  registers the place on the globe.
- `tools/assets/fetch_textures.py`: downloads the CC0 texture sets.

## Checks and hooks

- `cd game && npm run check` runs the typecheck and every test (~25 s). It
  must pass before code is committed or pushed. `npm test physics` runs one file.
- **Git hooks** (`.githooks/`, switched on by `core.hooksPath`; the Claude
  session-start hook sets it, or run `git config core.hooksPath .githooks`):
  - `pre-commit`: refuses new assets missing from their `CREDITS.md`, personal
    email addresses, and things that look like keys; runs `npm run check` when
    code changed (skipped if it already passed on that exact tree).
  - `commit-msg`: a commit touching `game/src`, `game/tests`, `game/desktop`,
    the HTML, `package.json` or `tools/` needs a `Story:` paragraph.
  - `pre-push`: the checks on what's pushed, then `review.sh`: a second Claude
    reads this file, the commit messages and the diff, and blocks the push
    with findings when a rule here is broken. Fix what it finds; if a finding
    is wrong, answer it in a commit message line starting `Review:`. Never work
    around it; if it's stuck, tell the owner. Pushes take 1–2 minutes: give
    the shell command a long timeout.
- **Claude hooks** (`.claude/settings.json`, scripts in `.claude/hooks/`):
  - Session start switches the git hooks on and installs `game/node_modules`.
  - Commits and pushes can't skip the git hooks (`--no-verify`, `-n`,
    `core.hooksPath` changes, skipping the review are refused).
  - Outgoing requests: Google Street View URLs, an email address in a request
    header or user agent, and printing a secret are refused.
  - Ending a turn with changed code that fails `npm run check` sends Claude
    back to fix it.

## Testing in this environment

- Headless browser screenshots via Playwright (Chromium at /opt/pw-browsers):
  WebGL2 via SwiftShader works but runs at a few frames a second, so drive the
  game through the debug handles (`__car`, `__traffic`) rather than key timing.
  Software WebGPU crashes on big scenes, and its WebGL2 allows 32 textures
  where real GPUs allow 16: count samplers.
- Simulation logic runs headless: the tests load `public/world/*.net.bin` directly.
- wrangler dev serves `dist/` and goes stale after rebuilds: restart it.

## Talking to the owner

- Be honest. Critique the work on its merits, whoever built it.
- Recommend one option. Don't list options you wouldn't choose.
- Plain words; say what was tested and what wasn't.
