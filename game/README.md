# World Drive

A driving simulator set in real places rebuilt from open map data: a driving
school for the Irish test (Finglas, Dublin) plus a world explorer (Yaba, Lagos,
and more places as they're baked). three.js r186 (WebGPU, WebGL2 fallback) in
Electron or the browser. See `../CLAUDE.md` for how the project works and
`../ROADMAP.md` for the running order.

- **World:** buildings, roads and places from Overture Maps and OpenStreetMap;
  the road network (lanes, roundabouts, signals, crossings) built with SUMO.
- **Driving:** a rigid-body car (Rapier) with Pacejka tyres and an automatic
  gearbox, force feedback on a Logitech G29/G923, cockpit with mirrors.
- **Traffic and people:** rule-following AI cars, human pedestrians, and an
  examiner marking RSA-style faults.

## Controls

Wheel, pad and keyboard are all supported; the full list is in the pause menu
(Esc, or Options on the wheel). Keyboard basics: W gas, S brake (Shift+S for an
emergency stop), A/D steer, X/Z move the gear selector toward D/P (foot on the
brake to leave P), B parking brake, C camera, F get in or out, M map.

**G29/G923:** click **🎮 Connect wheel** (Chrome, Edge or the desktop app). The
game drives the wheel directly over WebHID: rotation set to the car's steering,
force feedback from the tyres, rev lights. Wheel check (top right) shows what
the game reads and holds the force feedback settings.

## Run it

```sh
cd game
npm install
npm run desktop        # build and open the desktop app
# or, in a browser:
npm run build && npx wrangler dev   # http://127.0.0.1:8787
```

URL options: `?city=finglas`, `?time=13` (hour of day), `?debug=1` (frame
rate, draw calls, and the `__car`, `__traffic`, `__me` handles).

## Autodrive and screenshots (dev)

`?autodrive=happy|sad|idiot|tragedy` puts a robot in the car on sat-nav routes
(`src/client/autodrive.ts`); a label at the top says what it's doing and why.

- **happy:** a careful learner (limits, lights, give way, indicators, mirrors).
- **sad:** missed turns (reroutes), a street with no way in, stuck in a queue, parking.
- **idiot:** speeding, no indicators, some red lights and give-ways, the kerb, R at speed.
- **tragedy:** the farthest places and the map edges, for as long as it runs.

Screenshot mode in the desktop app (real GPU), for checking how places look:

```sh
npm run build
WORLD_AUTODRIVE=happy WORLD_SHOTS=shots/happy npx electron .
# options: WORLD_CITY=finglas WORLD_SHOT_EVERY=15 WORLD_SHOT_COUNT=40
#          WORLD_TIME=21 (hour) WORLD_TIMESCALE=60 (an hour a minute)
```

Each `NNN.png` has an `NNN.json` beside it: where (street, x/z), speed, what
the driver is doing and why, destination, examiner faults, frame rate.

## Checks

```sh
npm run check          # typecheck + every test in tests/ (about 25 s)
npm test physics       # one test file
```

Commits and pushes go through the repo's git hooks (credits, privacy, a
`Story:` paragraph, the checks, and a second-Claude review); see `../CLAUDE.md`.

## Add a place

```sh
python3 ../tools/bake/add_place.py finglas            # rebuild a place
python3 ../tools/bake/add_place.py --help             # add a new one
```

## Layout

```
src/client/   the game (see ../CLAUDE.md "Layout")
src/server/   Worker entry + Zone Durable Object (multiplayer)
src/shared/   protocol and chat moderation
public/       baked worlds, textures, models (each folder has CREDITS.md)
tests/        headless pass/fail tests
tools/        load-test bots
```
