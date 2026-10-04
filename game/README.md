# Eko World (working title): Yaba test build

A walkable, multiplayer slice of real Yaba, Lagos, in the browser. No download, no sign-up.

- **World:** 14,082 real buildings, 1,402 road/rail segments and 152 street names from Overture Maps / OpenStreetMap / Google Open Buildings, baked into a 283 KB (gzipped) file.
- **Multiplayer:** one Cloudflare Durable Object per zone layer (`yaba-1`, `yaba-2`, …, 120 players each). Movement is relayed only to players within 120 m, batched every 100 ms. Chat reaches players within 30 m.
- **Join by link:** "Invite padi" makes a link that spawns your friend right next to you.
- **Safety:** server-side filter blocks phone numbers, bank details, links and off-platform lures; chat cooldown.
- **Low-end first:** unlit vertex-coloured chunks, about 15–20 draw calls, fog-limited draw distance, automatic resolution scaling.

## Run locally

```sh
cd game
npm install
npm run build          # typecheck + bundle into dist/
npx wrangler dev       # serves dist/ and the multiplayer server on http://127.0.0.1:8787
```

Open `http://127.0.0.1:8787/` in two browser windows. Add `?debug=1` for FPS, draw calls and network use.

Load test: `node tools/bots.mjs 150 30` (150 bots for 30 seconds against the local server).

## Rebuild the map

```sh
python3 ../tools/bake/bake_world.py --name yaba --bbox 3.362 6.494 3.384 6.520
```

Needs `duckdb`, `shapely`, `numpy`, `rasterio` and the Overture extracts in `research/data/`.

## Deploy (Cloudflare free plan)

Needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment.

```sh
npm run deploy
```

## Layout

```
src/shared/   protocol (binary movement + JSON messages), chat moderation
src/server/   Worker entry + Zone Durable Object
src/client/   three.js client: world builder, avatars, input, networking, UI
public/world/ baked map tiles
tools/        load-test bots
```
