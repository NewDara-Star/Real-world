# 01 — Existing open-world / GTA-style / social-3D projects we can learn from, lift from, or fork

*Research date: 2026-10-04. Goal: a browser-based, GTA-Online-style social game set in real Lagos (OSM-derived walkable city, many concurrent players, missions, proximity chat, low-end Android).*

## How this was researched (and its limits)

- **GitHub:** `gh search` / `gh api` are blocked in this sandbox: the session is bound to one repo and search endpoints return 403. Instead I used the GitHub MCP search with about 40 queries covering every term in the brief, plus some extra ones. Exact star counts, last-push dates and GitHub-detected licenses came from `repo:` batch queries.
- **License verification:** for every project that could be forked or lifted, and for every repo whose license GitHub reported as `NOASSERTION` or missing, I shallow-cloned the repo (`git clone --depth 1 --filter=blob:none`) and **read the LICENSE file myself**. These rows are marked **(file)**. Rows marked **(API)** use GitHub's own LICENSE-file detection, which is reliable for standard licenses.
- **npm:** I also checked the npm registry for latest versions and publish dates of the key libraries.
- **Web, itch.io, Reddit, HN and X:** WebFetch is egress-blocked for nearly every site, including itch.io, discourse.threejs.org, colyseus.io and vibej.am. Coverage of these sources therefore comes from web-search summaries only. Treat items marked *(web-search only)* as leads, not verified facts.
- **Star counts and dates** are as of 2026-10-04. "Last push" means the last commit pushed to GitHub.

---

## TL;DR — Top 10 picks

| # | Project | ★ | Last push | License | Verdict |
|---|---|---|---|---|---|
| 1 | [iErcann/NotBlox](https://github.com/iErcann/NotBlox) | 184 | 2026-06-07 | MIT + "no blockchain/crypto" rider **(file)** | **Fork candidate for netcode/ECS skeleton** |
| 2 | [pmndrs/ecctrl](https://github.com/pmndrs/ecctrl) v2.0.2 | 804 | 2026-09-06 | MIT **(file)** | **Use as dependency / lift** (if React Three Fiber) |
| 3 | [swift502/Sketchbook](https://github.com/swift502/Sketchbook) | 1,755 | 2024-10 (archived) | MIT **(file)** | **Lift parts** (character + vehicle state machines) |
| 4 | [depixeled-chris/gta7](https://github.com/depixeled-chris/gta7) | 20 | 2026-06-01 | MIT **(file)** | **Lift parts** (arcade car, carjack, wanted, touch UI) |
| 5 | [donmutti/gta](https://github.com/donmutti/gta) (Luxembourg from OSM) | 1 | 2026-10-01 | **None (all rights reserved)** **(file: no LICENSE)** | **Learn only** (best real-city OSM → GTA reference; ask the author for a license) |
| 6 | [a-b-street/osm2streets](https://github.com/a-b-street/osm2streets) + [abstreet](https://github.com/a-b-street/abstreet) | 158 / 8,186 | 2025-10 / 2025-09 | Apache-2.0 (API) | **Lift / use as offline pipeline** (OSM → lane-accurate roads + junctions; traffic sim) |
| 7 | [StrandedKitty/streets-gl](https://github.com/StrandedKitty/streets-gl) | 1,098 | 2025-08-21 | MIT (API) | **Lift parts** (OSM building/roof/road mesh generation, tile pipeline) |
| 8 | [colyseus/colyseus](https://github.com/colyseus/colyseus) (+ example [tech-leads-club/nj-mmo](https://github.com/tech-leads-club/nj-mmo)) | 7,334 | 2026-10-03 | MIT (API) | **Use as dependency** (room server, state sync, matchmaking) |
| 9 | [livekit/livekit](https://github.com/livekit/livekit) | 21,274 | 2026-10-04 | Apache-2.0 (API) | **Use as dependency** (spatial/proximity voice via SFU) |
| 10 | [mml-io/3d-web-experience](https://github.com/mml-io/3d-web-experience) | 16 | 2026-06-05 | MIT **(file)** (Improbable) | **Learn from / lift** (multi-user Three.js world: character controller, position networking, chat, auth flow) |

**Honorable mentions:**
- **[bridge-mind/leonida](https://github.com/bridge-mind/leonida)** (MIT, Three.js + Rapier). The most feature-complete GTA systems: missions, a 6-star wanted system, peds, casino, save/load. It is desktop-only.
- **[brunosimon/folio-2025](https://github.com/brunosimon/folio-2025)** (MIT, 1.9k★). A Three.js WebGPU/TSL driveable world with Blender sources included.
- **[pmndrs/viverse](https://github.com/pmndrs/viverse)** (MIT). A BVH character controller plus mobile and XR input.
- **[Mugen87/yuka](https://github.com/Mugen87/yuka)** (MIT). Game AI for traffic and peds.
- **[isaac-mason/recast-navigation-js](https://github.com/isaac-mason/recast-navigation-js)** (MIT). Navmesh pathfinding for peds and police.
- **[Kenney](https://kenney.nl) City Kits + Car Kit** (CC0). Art assets.

### The top 10 in detail

#### 1. NotBlox — iErcann/NotBlox
- **URL / demo:** https://github.com/iErcann/NotBlox · https://www.notblox.online/ (test world, obby, football; car video on YouTube)
- **Stack:** TypeScript monorepo (`front` / `back` / `shared`), vanilla Three.js, Rapier.js on the **server** (server-authoritative), custom ECS with a `NetworkComponent` for replication, uWebSockets.js, interpolation, trimesh colliders, **cars**. Ships Docker and Caddy configs.
- **What it does well:**
  - It is the closest existing open architecture to "multiplayer GTA in the browser". The README literally says *"Multiplayer GTA-like? I'm thinking about creating a GTA-like game with this engine … Inspiration: Sketchbook."*
  - Shared server/client code.
  - Explicit low-end focus (`PERFORMANCE.md`: shadow hierarchy, draw-call monitoring).
  - Small assets and fast load.
- **Gaps:** no client-side prediction (the README admits it feels laggy far from the server), delta compression is "needs rework", only about 184★, and it is a one-person project.
- **License (read the file):** MIT, **plus an added restriction: it may not be used for any blockchain, crypto or DLT purpose.** This is fine for us unless we add a token economy. Keep the notice.
- **Verdict:** **Fork, or lift heavily, for the server-authoritative ECS + Rapier + WebSocket skeleton.** Budget time to add client prediction and reconciliation, interest management (area-of-interest), and real delta compression before it can scale to "many concurrent players".

#### 2. ecctrl v2 — pmndrs/ecctrl
- **URL / demo:** https://github.com/pmndrs/ecctrl · https://ecctrl.app/ · sibling [pmndrs/BVHEcctrl](https://github.com/pmndrs/BVHEcctrl) (MIT, 140★, https://bvhecctrl.vercel.app)
- **Stack:** React Three Fiber 9.4+, three 0.184+, @react-three/rapier 2.2+.
- **What it does well:** version 2.0 (Sept 2026) grew beyond a character controller. It now includes:
  - a ShapeCast character controller
  - **torque-driven cars with ShapeCast wheels**
  - drones and custom gravity
  - **touch input** (mobile joystick)
  - an animation state machine
  - curve look-up tables (LUTs) and a Leva tuning editor
  - performance notes

  It is the most actively maintained "walk + drive" controller in the JS ecosystem. Example animations use Quaternius CC0.
- **License (file):** MIT (NOTICE: keep the copyright notice).
- **Verdict:** **Use directly if we choose R3F.** If we go vanilla Three.js or PlayCanvas, **lift the algorithms** (shapecast wheel model, float-spring character, touch input), since the code is MIT.

#### 3. Sketchbook — swift502/Sketchbook
- **URL / demo:** https://github.com/swift502/Sketchbook · https://jblaha.art/sketchbook/latest
- **Stack:** TypeScript, three.js, cannon.js (old), webpack.
- **What it does well:** it is *the* reference for third-person GTA-style mechanics on the web:
  - a character state machine (idle/walk/sprint/jump/fall/drop-roll)
  - **entering and exiting vehicles via seats and doors**
  - cars, airplanes and helicopters
  - a raycast character controller with capsule collision
  - simple character AI
  - variable timescale

  Nearly every newer project (NotBlox, many vibe-coded GTA clones) cites it.
- **Gaps:** **archived Feb 2023** ("no more interest"). It uses legacy cannon.js and old three.js, and has no multiplayer and no mobile controls.
- **License (file):** MIT.
- **Verdict:** **Lift parts.** Port the character/vehicle state machines and the seat/door entry logic to Rapier. Don't fork the whole thing.

#### 4. GTA 7 (vertical slice) — depixeled-chris/gta7
- **URL / demo:** https://github.com/depixeled-chris/gta7 · https://depixeled-chris.github.io/gta7/ (also a "zero-shot" original build)
- **Stack:** TypeScript + Three.js + Vite. The sim core is pure and **unit-tested** (vehicle physics, city gen, collision, RNG), with headless-Chromium render tests.
- **What it does well:**
  - Procedural night city.
  - Velocity-vector arcade handling with handbrake drift.
  - **Carjack any car** (traffic, parked or spawn).
  - Traffic that brakes for you.
  - Peds that panic.
  - Wanted level with steering-behaviour cops.
  - Synthesized engine audio and a car radio.
  - Minimap.
  - **Mobile: on-screen analog stick + buttons, auto-detected, with GPU quality scaled down for phones.**
- **Gaps:** single-player, procedural grid (not real map data), tiny community (20★). It came from a Reddit "dare" thread and was AI-built in one session.
- **License (file):** MIT.
- **Verdict:** **Lift parts:** arcade car model, carjack flow, wanted/police steering AI, mobile touch layer and quality scaler, plus its testing approach.

#### 5. Luxembourg GTA from OSM — donmutti/gta
- **URL / demo:** https://github.com/donmutti/gta · https://gta-murex.vercel.app
- **Stack:** plain JS + Three.js + Vite. `tools/fetch-city.mjs` pulls one slice of Luxembourg from Overpass into a committed `city.json`. The slice has 1,667 roads, 6,196 buildings with real heights, 285 traffic signals, 739 crossings and 2,467 trees.
- **What it does well:** it is **exactly our problem at small scale** and documents the real pitfalls of turning raw OSM into a drivable game world:
  - OSM has no road widths, so widths are invented per highway class. A 12 m carriageway painted on a real 7 m street "swallows" buildings, so 1,845 footprints were pushed apart.
  - **T-junctions:** OSM joins side roads mid-polyline, so naive endpoint welding leaves the network in disconnected stubs.
  - 270 of 285 `traffic_signals` nodes sit *in* the carriageway and must be relocated.
  - Decor clearance, and dead ends treated as "places".
  - Deterministic traffic-light phase computed from clock + junction id (no stored state, so it syncs for free; great for multiplayer).
  - Instanced debris (3 draw calls), 340 instanced 16-part pedestrians with ragdoll, and police pursuit tiers.
  - Traffic on curved lane paths that respects one-ways, lights and yielding.
  - The forest "edge of world" trick.
- **License (file):** **no LICENSE file → all rights reserved.** Created Sept 2026, 1★.
- **Verdict:** **Learn only.** Read its README, `INTERFACES.md` and `src/world/model.js` approach, then implement our own. **Worth contacting the author** about an MIT/Apache license, since this is the single most on-target codebase found.

#### 6. osm2streets + A/B Street — a-b-street
- **URLs:** https://github.com/a-b-street/osm2streets (demo: https://a-b-street.github.io/osm2streets) · https://github.com/a-b-street/abstreet
- **Stack:** Rust, with WASM builds for the web.
- **What it does well:**
  - osm2streets turns OSM into a **street network with detailed geometry**: per-lane widths from tags, intersection polygons and merged dual carriageways. This is precisely the "OSM has no widths / broken junctions" problem donmutti/gta solved by hand.
  - A/B Street adds a full **traffic simulation** on OSM: lanes, turns, signals and agents.
- **License (API):** Apache-2.0 (patent grant included; commercial OK).
- **Verdict:** **Use osm2streets in our offline map-build pipeline** (Rust/WASM CLI → our own compact binary tiles). **Learn from A/B Street's** traffic-sim design for ambient danfo/okada traffic. Note that both are slowing down (last push Sep–Oct 2025).

#### 7. Streets GL — StrandedKitty/streets-gl
- **URL / demo:** https://github.com/StrandedKitty/streets-gl · https://streets.gl
- **Stack:** TypeScript and a custom WebGL2 render graph, with workers building OSM vector-tile geometry.
- **What it does well:** the best open-source **OSM → 3D buildings** generator on the web. It handles roof shapes, building parts, roads, terrain LOD, atmosphere and PBR.
- **Gaps:** eye-candy focused (TAA, SSAO, SSR), so far too heavy for low-end Android as-is. It is a renderer, not a game, and is "early development".
- **License (API):** MIT.
- **Verdict:** **Lift the geometry-generation code** (building and roof triangulation, tag interpretation) into our offline pipeline or a web worker. Render with our own cheap shaders.

#### 8. Colyseus — colyseus/colyseus
- **URL:** https://github.com/colyseus/colyseus (npm `colyseus` 0.18.9, 2026-09-30)
- **What it does well:**
  - Node.js authoritative rooms with binary schema state sync (delta-encoded) and matchmaking.
  - Reconnection.
  - Scales horizontally with Redis presence.
  - Web search: in Cursor Vibe Jam 2026, 48 of 945 entries used Colyseus (about 15% of online-multiplayer entries) *(web-search only)*.
  - Example: [tech-leads-club/nj-mmo](https://github.com/tech-leads-club/nj-mmo) (MIT (API), 28★) is an authoritative Colyseus + Three.js browser MMORPG with a SQLite/Drizzle persistence layer. *Caveat: nj-mmo seeds its data from L2J (Lineage 2) and is AI-generated, so don't copy its data.*
- **License (API):** MIT.
- **Verdict:** **Use as the room/session layer.** For a seamless open city we still need our own **spatial sharding / area-of-interest** on top. Colyseus rooms map naturally to "districts" (e.g. Ikeja, Yaba, VI, Lekki) or to instanced missions.

#### 9. LiveKit — livekit/livekit
- **URL:** https://github.com/livekit/livekit (client `livekit-client` 2.22.3)
- **What it does well:** a production WebRTC SFU (Go) with selective subscription, so clients only receive tracks from nearby players. That is the standard way to build proximity voice. WorkAdventure, the best-known open proximity-chat app, ships a `docker-compose.livekit.yaml`.
- **License (API):** Apache-2.0.
- **Verdict:** **Use.** Drive subscriptions from the game server's area-of-interest, and do spatial attenuation client-side with Web Audio `PannerNode`. [versatica/mediasoup](https://github.com/versatica/mediasoup) (ISC, 7.4k★) is the lower-level alternative if we need more control.

#### 10. MML 3D Web Experience — mml-io/3d-web-experience
- **URL:** https://github.com/mml-io/3d-web-experience · spec https://github.com/mml-io/mml (MIT, 138★) · community fork [TheCodeTherapy/3d-web-experience](https://github.com/TheCodeTherapy/3d-web-experience) (44★)
- **Stack:** Three.js client and Node server packages: `3d-web-client-core` (controls, rendering), `3d-web-user-networking` (WebSocket position sync), `3d-web-avatar`, plus text chat and a session-token auth flow.
- **What it does well:** a clean, modular, **commercially backed** (Improbable) reference for a many-user walkable 3D world in the browser, with an MML scripting model for interactive objects.
- **License (file):** MIT (© Improbable MV Ltd).
- **Verdict:** **Learn from / lift** the user-networking and character-controller packages. Activity is slowing (last push June 2026; npm core 0.28.0 is from March 2026). Don't build on it as a platform.

---

## Foundational libraries / engines (what we'd actually build on)

| Project | ★ | Last push / npm | License | Role | Notes for low-end Android |
|---|---|---|---|---|---|
| [mrdoob/three.js](https://github.com/mrdoob/three.js) | 116,203 | 2026-10-04 / r186 (0.186.1) | MIT (API) | Renderer | Huge ecosystem; WebGL2 + WebGPU/TSL. Performance is entirely on us (instancing, LOD, no shadows on low tier). |
| [pmndrs/react-three-fiber](https://github.com/pmndrs/react-three-fiber) + [drei](https://github.com/pmndrs/drei) | 32,708 / 9,912 | 2026-10 | MIT (API) | React renderer for three | Makes ecctrl/viverse/uikit usable; adds React overhead on weak CPUs. |
| [playcanvas/engine](https://github.com/playcanvas/engine) | 16,979 | 2026-10-03 / 2.23.0 | MIT (API) | Engine runtime | Best-in-class small runtime and mobile focus; batching/LOD built in. |
| [playcanvas/editor](https://github.com/playcanvas/editor) | 1,329 | 2026-10-03 | MIT (API) | Visual editor frontend | Editor frontend now open source; the hosted editor/cloud remains a proprietary SaaS. |
| [playcanvas/react](https://github.com/playcanvas/react) | 535 | 2026-09-28 | MIT (API) | React bindings | — |
| [BabylonJS/Babylon.js](https://github.com/BabylonJS/Babylon.js) | 26,126 | 2026-10-02 / 9.29.0 | Apache-2.0 (API) | Full engine | Havok physics plugin (`@babylonjs/havok` MIT, 1.3.14) has vehicle demos that run on phones (web-search: "Playing with BJS6 + Havok", Babylon Toolkit "Blakefield/Parkcity" Havok vehicle demos). Heavier bundle than PlayCanvas. |
| [godotengine/godot](https://github.com/godotengine/godot) | 118,115 | 2026-10-02 | MIT (API) | Engine (web export) | Web export is WASM, large to download and slow on low-end Android (web-search: a mid-range Android Godot 4 web game went 31 → 60 fps only after heavy asset-pipeline work). **Not recommended** as the primary target. |
| [dimforge/rapier](https://github.com/dimforge/rapier) (JS bindings now in-repo; old [rapier.js](https://github.com/dimforge/rapier.js) archived) | 5,814 | 2026-09-27 / `@dimforge/rapier3d-compat` 0.21.0 (2026-09-25) | Apache-2.0 (API) | Physics (WASM) | Deterministic mode, `DynamicRayCastVehicleController`, KinematicCharacterController. **Can run server-side in Node**, which is what NotBlox does. |
| [jrouwe/JoltPhysics.js](https://github.com/jrouwe/JoltPhysics.js) | 576 | 2026-08 / `jolt-physics` 1.1.0 | MIT (API) | Physics (WASM) | Full wheeled-vehicle constraint (better car feel than raycast); bigger WASM. |
| pmndrs/cannon-es | n/a | npm 0.20.0 (**2022-08**) | MIT (file) | Physics (JS) | Stale. Fine for prototypes and RaycastVehicle, but don't build on it. |
| [kripken/ammo.js](https://github.com/kripken/ammo.js) | 4,575 | 2026-09 | zlib (file) | Bullet port | Legacy; used by enable3d. |
| [lo-th/phy](https://github.com/lo-th/phy) | 742 | 2026-07-30 | MIT (API) | Wrapper over Rapier/Jolt/Ammo/Havok/PhysX | Good for benchmarking engines side-by-side (vehicles included). Demo https://lo-th.github.io/phy/ |
| [gkjohnson/three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) | 3,503 | 2026-09-30 | MIT (API) | Raycast/collision acceleration | Used by Messenger (abeto) and BVHEcctrl. Lets the *character* collide against city meshes without a physics engine. |
| [isaac-mason/recast-navigation-js](https://github.com/isaac-mason/recast-navigation-js) | 430 | 2026-07 | MIT (API) | Navmesh + crowd | Peds, police on foot. |
| [donmccurdy/three-pathfinding](https://github.com/donmccurdy/three-pathfinding) | 1,371 | 2026-10 | MIT (API) | Simple navmesh pathing | Lighter alternative. |
| [Mugen87/yuka](https://github.com/Mugen87/yuka) | 1,373 | 2026-10 | MIT (API) | Game AI (steering, FSM, perception) | Traffic and ped behaviours, police pursuit. |
| [NASA-AMMOS/3DTilesRendererJS](https://github.com/NASA-AMMOS/3DTilesRendererJS) | 2,478 | 2026-10-03 | Apache-2.0 (API) | 3D Tiles streaming for three/Babylon/R3F | Use if we bake Lagos into 3D Tiles for streaming. Google Photorealistic tiles have restrictive ToS and are not suitable for a game. |
| [tentone/geo-three](https://github.com/tentone/geo-three) | 952 | 2026-04 | MIT (API) | Map-tile terrain/basemap in three | Minimap/overview rendering. |
| [maplibre/maplibre-gl-js](https://github.com/maplibre/maplibre-gl-js) | 11,800 | 2026-10-04 | BSD-3-Clause (file) | 2D/2.5D vector maps | In-game phone map / GPS UI. |
| [protomaps/PMTiles](https://github.com/protomaps/PMTiles) | 3,068 | 2026-09 | BSD-3 (file) | Single-file tile archive on static/CDN storage | Ideal for serving pre-baked Lagos city chunks from a CDN with HTTP range requests. |
| [NateTheGreatt/bitECS](https://github.com/NateTheGreatt/bitECS) / [pmndrs/koota](https://github.com/pmndrs/koota) / [hmans/miniplex](https://github.com/hmans/miniplex) | 1,515 / 746 / 1,055 | 2026 | MPL-2.0 / ISC / MIT (API) | ECS | bitECS's typed-array layout is well suited to network serialization. MPL is file-level copyleft: using it unmodified is fine. |
| [geckosio/geckos.io](https://github.com/geckosio/geckos.io) + [snapshot-interpolation](https://github.com/geckosio/snapshot-interpolation) | 1,490 / 318 | 2026-03 / 2025-02 | BSD-3 (API) | UDP-like WebRTC datachannels; interpolation lib | Unreliable/unordered transport matters on Nigerian mobile networks (avoids TCP head-of-line blocking). |
| [heroiclabs/nakama](https://github.com/heroiclabs/nakama) | 13,469 | 2026-09-28 | Apache-2.0 (API) | Game backend: accounts, friends, chat, parties, leaderboards, storage, matchmaking | Strong fit for the "Online" meta-layer (crews, chat, economy) alongside a custom realtime sim server. |
| [colyseus/colyseus](https://github.com/colyseus/colyseus) | 7,334 | 2026-10-03 | MIT (API) | Rooms/state sync | See Top-10 #8. |
| [livekit/livekit](https://github.com/livekit/livekit) / [versatica/mediasoup](https://github.com/versatica/mediasoup) | 21,274 / 7,386 | 2026-10 | Apache-2.0 / ISC (API) | Voice SFU | See Top-10 #9. |
| [lance-gg/lance](https://github.com/lance-gg/lance) | 1,716 | 2024-05 | Apache-2.0 (API) | Client prediction + server reconciliation for JS | Stale, but a readable reference implementation of prediction/extrapolation. |
| [rameshvarun/netplayjs](https://github.com/rameshvarun/netplayjs) | 576 | 2024-10 | ISC (API) | P2P rollback netcode | Not for an MMO; good for small P2P mini-games/races inside the world. |
| [pixiv/three-vrm](https://github.com/pixiv/three-vrm) | 2,197 | 2026-10 | MIT (API) | VRM avatars | Open avatar format; relevant because **Ready Player Me shut down on 2026-01-31** after its Netflix acquisition (web-search). |

---

## Everything else (long table)

Legend: **Fork** = start from it · **Lift** = copy specific modules (license permitting) · **Learn** = read only · **Ignore** = not useful or not usable.

### A. GTA-style browser games / vertical slices (mostly 2026, many AI-built)

| Project | ★ | Last push | License | Stack | Strengths | Demo | Verdict |
|---|---|---|---|---|---|---|---|
| [bridge-mind/leonida](https://github.com/bridge-mind/leonida) | 4 | 2026-09-02 | MIT (file) | TS, Three.js, Rapier, Vite, Vitest | Most complete GTA feature set: 2×2 km 6-district city, 9 vehicle archetypes, damage→fire, carjacking, instanced crowds with ragdoll, 6 weapons + weapon wheel, 6-star wanted (cops, SWAT, helis, roadblocks), 8 missions with cutscenes, phone, GPS routing, save/load; per-system debug actions | https://bridge-mind.github.io/leonida/ | **Lift** mission/wanted/system-registry patterns. Desktop only; "GTA VI fan project" naming is a trademark risk, so don't reuse names/content. |
| [wangjialiang678/3d-game-kit](https://github.com/wangjialiang678/3d-game-kit) | 1 | 2026-07-09 | MIT (file) | TS, Three.js, Rapier, custom Entity-Component, FSM; npm workspaces | Reusable engine package + "gta-sandbox" demo (drive, wanted, police, 3-step mission chain); "AI-native content pipeline" (headless editor layer) | local only | **Learn** (architecture of shared engine + demos). |
| [pranshuparmar/neon-mayhem](https://github.com/pranshuparmar/neon-mayhem) | 5 | 2026-10-04 | Apache-2.0 (API) | Vanilla Three.js, no build, offline | Steal cars, police, races, deliveries, rampage | https://pranshuparmar.github.io/neon-mayhem/ | **Learn** / small lifts. |
| [shubhransh-gupta/courier-city](https://github.com/shubhransh-gupta/courier-city) | 2 | 2026-09-30 | MIT (API) | Three.js + cannon-es | Walk/drive/fly; real Indian landmarks (Bangalore Silk Board, etc.) — a "Global South city" precedent | https://shubhransh-gupta.github.io/courier-city/ | **Learn**. |
| [noamsmall18/sunset-bay](https://github.com/noamsmall18/sunset-bay) | 1 | 2026-09-07 | **None** (file: no LICENSE) | Single-file Three.js build | ~2 km procedural coastal city, freeway, railway, planes/helis/boats; **good mobile touch layer** (floating stick, context-sensitive right cluster) + `#quality=auto/low/medium/high` adaptive budget | — | **Learn only** (no license). |
| [nullspawn/gta7-web](https://github.com/nullspawn/gta7-web) | 0 | 2026-08 | not checked | TS, Three.js | "AI-driven GTA7 for web"; nullspawn markets itself as an open-source browser game studio *(web-search)* | — | **Ignore** for now (empty traction). |
| [joaonetovhc/grand-theg-auto-i](https://github.com/joaonetovhc/grand-theg-auto-i), [25nyak/Gta-Clone](https://github.com/25nyak/Gta-Clone), [Faizankhan17623/OpenCity](https://github.com/Faizankhan17623/OpenCity), [Liyucheng1997/90_game-GTA6](https://github.com/Liyucheng1997/90_game-GTA6), [SuperCarryDoinb-1/gta-s](https://github.com/SuperCarryDoinb-1/gta-s), [kevinrss01/GTA-VIBE](https://github.com/kevinrss01/GTA-VIBE), [RVVDev/bayside-heat](https://github.com/RVVDev/bayside-heat), [nl2992/neon-city-demo](https://github.com/nl2992/neon-city-demo), [Yuchenhui/PIXEL-CITY-CRIME-3D](https://github.com/Yuchenhui/PIXEL-CITY-CRIME-3D), [appleweiping/overdrive-city](https://github.com/appleweiping/overdrive-city), [YUZAKIxNASA/City-Drive-Simulator](https://github.com/YUZAKIxNASA/City-Drive-Simulator), [alexdevmotion/grand-theft-austerity](https://github.com/alexdevmotion/grand-theft-austerity), [CodingFreeze/Fable_GTA](https://github.com/CodingFreeze/Fable_GTA), [sumitaich1998/ai-game-engine](https://github.com/sumitaich1998/ai-game-engine), [peugeot308debadre/gta-3d-open-world](https://github.com/peugeot308debadre/gta-3d-open-world) | 0–4 each | 2026 | mostly unchecked | Three.js / R3F, mostly single-file, mostly AI-generated | Procedural grid cities, wanted systems, police AI; a few have touch controls | various GH Pages | **Ignore** individually. They show that a "GTA slice in Three.js" is now commodity and that the hard parts (real map data, netcode, mobile performance, content) are where value lies. |
| PigCity / "Pigopoli" | — | — | unknown | Three.js r160+, Rapier (capsule controller, kinematic vehicles), Vite; Stripe IAP + rewarded ads | Claims 60 fps on entry-level laptops *(web-search only, Contra post)* | — | **Learn** (monetization precedent). |
| Cinevva "open world in the browser" blog series + arcade titles (City Rush 2, Cityline Stories, WANTED) | — | 2026-02/03 | proprietary | Three.js, ACES tone mapping, no shadows in the first spike | Write-up on risk-first open-world browser development, including a validated "mobile quality profile" *(web-search only; site blocked)* | app.cinevva.com | **Learn** (read the blog manually). |

### B. Real-map / OSM / geo projects

| Project | ★ | Last push | License | Stack | Strengths | Verdict |
|---|---|---|---|---|---|---|
| [RRG314/WorldExplorer3D](https://github.com/RRG314/WorldExplorer3D) | 24 | 2026-10-04 | **Source-available, All Rights Reserved** (file: "World Explorer 3D Source-Available License 1.0") | JS, Three.js, Firebase/Firestore, OSM (Shortbread vector tiles), ESA WorldCover, Quaternius CC0 | Pick any city on a globe → walk/drive/drone; **multiplayer rooms tied to real locations**; very thorough `DATA_SOURCES.md` on attribution/licensing of geo data. Live: https://worldexplorer3d.io | **Learn only** (cannot reuse code commercially). Read its data-sources doc. |
| [Glavin001/open-world](https://github.com/Glavin001/open-world) | 31 | 2018-01 | none (API) | JS | "Multiplayer GTA clone from OpenStreetMap" — the original idea, abandoned | **Ignore** (dead, unlicensed). |
| [louis-e/arnis](https://github.com/louis-e/arnis) | 18,141 | 2026-10-03 | Apache-2.0 (API) | Rust | Real-world location → Minecraft world; very mature OSM tag → block/structure interpretation, landuse, roads, buildings | **Learn / lift** OSM-interpretation rules (data-mapping logic, not rendering). |
| [tordanik/OSM2World](https://github.com/tordanik/OSM2World) | 783 | 2026-10-01 | MIT (API) | Java | OSM → 3D models (glTF), incl. street furniture, roof shapes, lanes | **Lift / use offline** to pre-bake Lagos chunks to glTF. |
| [OSMBuildings/OSMBuildings](https://github.com/OSMBuildings/OSMBuildings) | 1,009 | 2020-10 | BSD-2-style (file) | JS/WebGL | 2.5D building extrusion viewer | **Learn** (stale). |
| [vvoovv/blosm](https://github.com/vvoovv/blosm) | 2,130 | 2025-10 | **no root LICENSE file** (file); Blender add-ons are generally GPL | Python (Blender) | Imports OSM + terrain (+ Google 3D cities) into Blender, good for hand-authoring hero districts (e.g. Balogun Market, CMS, Third Mainland Bridge) | **Use as a tool** (outputs are ours); don't ship its code. |
| [CesiumGS/cesium](https://github.com/CesiumGS/cesium) | 15,797 | 2026-10-03 | Apache-2.0 (API) | Globe engine | 3D Tiles, terrain | **Ignore for the game client** (too heavy); fine for internal map tools. |
| [clement-igonet/threejs-maplibre](https://github.com/clement-igonet/threejs-maplibre) | 1 | 2026-10-04 | none yet | Three.js + MapLibre interop for OSM ("game-grade 3D", NLnet-funded) | **Watch** (new, funded). |
| [Ps23102004/homeground](https://github.com/Ps23102004/homeground) | 1 | 2026-09 | MIT (API) | Three.js/WebGPU | Type an address → ride a longboard down your street (OSM) | **Learn**. |
| [egore/openstreetmap-racer](https://github.com/egore/openstreetmap-racer) | 3 | 2026-09 | not checked | Godot 4 | OSM rendered dynamically as a driving world | **Learn**. |
| [mitchelltrout/3d-game](https://github.com/mitchelltrout/3d-game), [willtwilson/vibedrive-je](https://github.com/willtwilson/vibedrive-je), [AllStreets/Chicago-Open-World](https://github.com/AllStreets/Chicago-Open-World), [mcanning818/tulane-sim](https://github.com/mcanning818/tulane-sim), [realgauravvyas/iitg-3d-campus](https://github.com/realgauravvyas/iitg-3d-campus), [Poglavar/station3d](https://github.com/Poglavar/station3d), [matrixxx1/AlternativeReality](https://github.com/matrixxx1/AlternativeReality), [Aakif9866/WildCity](https://github.com/Aakif9866/WildCity), [GrizzlyCmaster/brisbane-rush](https://github.com/GrizzlyCmaster/brisbane-rush), [drwjkirkpatrick-web/ascii-city](https://github.com/drwjkirkpatrick-web/ascii-city) (real **Nairobi** OSM), [LumenHelixLab/raceGPS](https://github.com/LumenHelixLab/raceGPS), [chungkn1400/freewebcar_chung](https://github.com/chungkn1400/freewebcar_chung) | 0–19 | 2025–26 | mostly unchecked | Three.js/R3F/Godot/C# | Many "real city from OSM" driving toys — confirms the trend; none at production quality | **Ignore** individually (skim Chicago-Open-World for data-sourcing ideas). |
| [blaze33/droneWorld](https://github.com/blaze33/droneWorld) | 333 | 2023-01 | MIT (API) | Three.js | Real terrain tiles as a playground | **Learn** (terrain streaming). |
| [ProbableTrain/MapGenerator](https://github.com/ProbableTrain/MapGenerator) | 1,431 | 2024-05 | LGPL-3.0 (API) | TS | Procedural city road/building generator (tensor-field streets) | **Learn** — useful for filling gaps where OSM in Lagos is sparse (outer districts); LGPL makes lifting awkward. |
| [jstrait/city-tour](https://github.com/jstrait/city-tour), [jeromeetienne/threex.proceduralcity](https://github.com/jeromeetienne/threex.proceduralcity), [MHillier98/…CityGenerator](https://github.com/MHillier98/IntroToComputerGraphics-CityGenerator), [photonlines/Procedural-City-Generator](https://github.com/photonlines/Procedural-City-Generator), [StarKnightt/night-street](https://github.com/StarKnightt/night-street) | 46–146 | various | MIT (API) for city-tour, night-street; others unchecked | Three.js | Procedural cities / streets (night-street: photoreal procedural street, zero assets) | **Learn** (shader-only facades are a good low-memory trick). |
| [asdfghj1237890/mini-macau](https://github.com/asdfghj1237890/mini-macau) | 634 | 2026 | not checked | React + MapLibre | Schedule-driven transit sim on OSM | **Learn** for danfo/BRT route simulation UI. |

### C. Multiplayer Three.js games & templates

| Project | ★ | Last push | License | Notes | Verdict |
|---|---|---|---|---|---|
| [tech-leads-club/nj-mmo](https://github.com/tech-leads-club/nj-mmo) | 28 | 2026-07 | MIT (API) | Authoritative Colyseus + Three.js MMORPG; Nx monorepo; SQLite/Drizzle; `@colyseus/testing` room tests | **Learn** (do not reuse its L2J-derived data). |
| [aasumitro/bbmvc](https://github.com/aasumitro/bbmvc) | 1 | 2026-09-30 | MIT (API) | Multiplayer car combat: React + Three.js + Rapier, **authoritative Node server with prediction + lag compensation**, matchmaking, bots | **Learn / lift** prediction code (small but on-target). |
| [EndPx/Rocket-Arena](https://github.com/EndPx/Rocket-Arena) | 1 | 2026-08 | MIT (API) | Colyseus + Rapier + Three.js authoritative car-ball | **Learn** (Rapier-on-server with Colyseus). |
| [kamalesh404/velocity.io](https://github.com/kamalesh404/velocity.io), [dammafra/overfloor](https://github.com/dammafra/overfloor), [luckeyfaraday/pastel-nuketown](https://github.com/luckeyfaraday/pastel-nuketown), [stevedmitchell2-sketch/Project-Photon](https://github.com/stevedmitchell2-sketch/Project-Photon), [Mohammad-Umar7/breachpoint](https://github.com/Mohammad-Umar7/breachpoint), [TomarJatin/threejs-game-template](https://github.com/TomarJatin/threejs-game-template) | 0–46 | 2026 | unchecked | Small authoritative/P2P Three.js shooters & templates | **Ignore** individually. |
| [juniorxsound/THREE.Multiplayer](https://github.com/juniorxsound/THREE.Multiplayer) / [R3F.Multiplayer](https://github.com/juniorxsound/R3F.Multiplayer) | 226 / 146 | 2022 | unchecked / none | Socket.io boilerplates | **Ignore** (naive broadcast). |
| [simondevyoutube/Quick_3D_MMORPG](https://github.com/simondevyoutube/Quick_3D_MMORPG) + [ThirdPersonCamera](https://github.com/simondevyoutube/ThreeJS_Tutorial_ThirdPersonCamera) / [CharacterController](https://github.com/simondevyoutube/ThreeJS_Tutorial_CharacterController) | 487 / 65 / 99 | 2020–22 | MIT (API) | Classic tutorials (spatial hash grid for AOI, third-person camera) | **Learn** (the spatial hash grid AOI pattern is exactly what we need). |
| [wass08/r3f-sims-online-final](https://github.com/wass08/r3f-sims-online-final) | 45 | 2023 | none | Wawa Sensei R3F multiplayer Sims-like (socket.io) | **Learn** (tutorial value). |
| [JohansenJunias20/portofolio](https://github.com/JohansenJunias20/portofolio) | 221 | 2023 | none | P2P WebRTC multiplayer 3D site | **Ignore**. |
| [ertugrulcetin/herfi](https://github.com/ertugrulcetin/herfi), [Lallassu/wizardwarz](https://github.com/Lallassu/wizardwarz), [maxscharwath/toonks-game](https://github.com/maxscharwath/toonks-game), [iErcann/enari-engine](https://github.com/iErcann/enari-engine) | 42–308 | various | unchecked | Older multiplayer WebGL games | **Ignore**. |
| [Kevin-Liu-01/Claude-of-Tanks](https://github.com/Kevin-Liu-01/Claude-of-Tanks) | 447 | 2026-10-04 | MIT (API) | Pure Three.js, desktop + **mobile**, 20 destructible maps; multi-agent AI-built | **Learn** (mobile perf + AI-agent production pipeline). |
| [majidmanzarpour/threejs-game-skills](https://github.com/majidmanzarpour/threejs-game-skills) | 2,421 | 2026-09-28 | MIT (API) | Agent "skills" for building Three.js games (gameplay, graphics, QA) | **Use** as tooling for our AI-assisted workflow. |
| [vibe-stack/ggez](https://github.com/vibe-stack/ggez) | 238 | 2026-04 | MIT (API) | Small Three.js game framework | **Ignore**. |
| [hh-hang/three-player-controller](https://github.com/hh-hang/three-player-controller) | 296 | 2026-09-22 | MIT (API) | Vanilla three.js first/third-person controller (BVH) | **Lift** if we go vanilla three (non-React ecctrl alternative). Demo https://hh-hang.github.io/three-player-controller/ |
| [pmndrs/viverse](https://github.com/pmndrs/viverse) | 131 | 2026-10 | MIT (file; GitHub shows NOASSERTION because the file also includes third-party notices) | `@react-three/viverse`: `<SimpleCharacter/>`, BVH physics, mobile/XR input | **Lift** (MIT). |
| [pmndrs/racing-game](https://github.com/pmndrs/racing-game) | 2,222 | 2023-02 | MIT (API) | R3F + cannon raycast vehicle racing | **Learn** (stale; https://racing.pmnd.rs/). |
| [brunosimon/folio-2019](https://github.com/brunosimon/folio-2019) / [folio-2025](https://github.com/brunosimon/folio-2025) | 4,749 / 1,909 | 2024-05 / 2026-04 | MIT (file) | Three.js driveable worlds; 2025 version uses **WebGPU + TSL**, physics, weather, vegetation, day/night; Blender files included; sounds CC0 | **Learn / lift** (shaders, polish). WebGPU-first is risky on low-end Android today. |
| [EvanBacon/Expo-Crossy-Road](https://github.com/EvanBacon/Expo-Crossy-Road) | 1,156 | 2026 | unchecked | Three.js in React Native/Expo | **Learn** if we want a native Android wrapper later. |

### D. Metaverse / social-3D platforms

| Project | ★ | Last push | License | Notes | Verdict |
|---|---|---|---|---|---|
| [hyperfy-xyz/hyperfy](https://github.com/hyperfy-xyz/hyperfy) | 304 | default branch 2025-12-18 (repo push 2026-04) | **GPL-3.0** (file) | Self-hostable persistent worlds, in-world building, JS app system, **PhysX** physics, WebXR. Still "alpha" per its docs; crypto-adjacent community | **Learn only.** GPL-3.0 means any distributed client code must be GPL; fine to study its networking/app sandbox. |
| [Hubs-Foundation/hubs](https://github.com/Hubs-Foundation/hubs) (+ [reticulum](https://github.com/Hubs-Foundation/reticulum), [Spoke](https://github.com/Hubs-Foundation/Spoke), [hubs-cloud](https://github.com/Hubs-Foundation/hubs-cloud)) | 2,217 | 2026-08-23 | MPL-2.0 (file) | Mozilla shut down hosted Hubs on 2024-05-31; the community Hubs Foundation maintains a Kubernetes "Community Edition". A-Frame + Elixir/Phoenix + mediasoup voice with spatial audio | **Learn** (spatial voice + room architecture). Too meeting-oriented and heavy to fork. |
| [webaverse/app](https://github.com/webaverse/app) | 376 | 2022-12-20 | MIT (file) | Ambitious Three.js metaverse client (avatars, Yjs, WebRTC) | **Dead end** (dead since 2022). |
| [matrix-org/thirdroom](https://github.com/matrix-org/thirdroom) | 647 | 2023-08-30 | Apache-2.0 (API) | Matrix-based worlds, multithreaded ECS + WASM scripting | **Dead end** (funding ended 2023). Its multithreaded renderer design is still worth reading. |
| [ir-engine/ir-engine](https://github.com/ir-engine/ir-engine) (ex-Ethereal Engine; [archive](https://github.com/ir-engine/etherealengine-archive)) | 104 (+704 archive) | 2025-07-17 | **CPAL-1.0** (file) | Full-stack Three.js MMO-ish toolkit with Agones, WebRTC, avatars | **Ignore.** CPAL attribution and network-use clauses, stalled since mid-2025. |
| [mml-io/mml](https://github.com/mml-io/mml) | 138 | 2026-03 | MIT (API) | Metaverse Markup Language (live-scripted 3D docs over WebSocket) | **Learn**. |
| [vircadia/vircadia-web](https://github.com/vircadia/vircadia-web) / [overte-org/overte](https://github.com/overte-org/overte) | 76 / 276 | 2025-12 / 2026-10 | Apache-2.0 (file, Overte) | High Fidelity descendants (Babylon web client; native C++ server) | **Ignore** (desktop/VR focus). |
| [jbaicoianu/janusweb](https://github.com/jbaicoianu/janusweb) | 202 | 2026-09 | MIT (API) | JanusVR in browser | **Ignore**. |
| [takahirox/tiny-web-metaverse](https://github.com/takahirox/tiny-web-metaverse) | 143 | 2024-02 | MIT (API) | Small ECS + Elixir web-metaverse framework | **Learn**. |
| [webspace-sdk/webspace-engine](https://github.com/webspace-sdk/webspace-engine) | 66 | 2026-10 | MPL-2.0 (API) | Multiplayer worlds as HTML files, P2P | **Ignore**. |
| [aframevr/aframe](https://github.com/aframevr/aframe) | 17,645 | 2026-10 | MIT | WebXR framework | **Ignore** (VR focus). |
| [decentraland/explorer](https://github.com/decentraland/explorer) (web, archived) / [unity-explorer](https://github.com/decentraland/unity-explorer) / [bevy-explorer](https://github.com/decentraland/bevy-explorer) | 79 / 23 / 28 | 2021 / 2026 / 2026 | Apache-2.0 (API) | Web client archived; current clients are desktop Unity and Rust/Bevy. Scene/parcel streaming model is instructive | **Learn** (parcel-based content streaming); **ignore** as a base. |
| [AmbientRun/Ambient](https://github.com/AmbientRun/Ambient) | 3,906 | 2025-01 | Apache-2.0 (API) | Rust/WASM multiplayer engine | **Dead end** (abandoned). |
| [7185/lemuria](https://github.com/7185/lemuria) | 27 | 2026-09 | unchecked | ActiveWorlds revival in Three.js | **Ignore**. |

### E. Voxel / MMO-in-browser

| Project | ★ | Last push | License | Notes | Verdict |
|---|---|---|---|---|---|
| [voxelize/voxelize](https://github.com/voxelize/voxelize) (+ [shaoruu/mine.js](https://github.com/shaoruu/mine.js)) | 684 / 331 | 2026-09 / 2024-03 | MIT (API) | Full-stack multiplayer voxel engine (Rust server, Three.js client, chunk streaming) | **Learn** chunk streaming + Rust server patterns. |
| [fenomas/noa](https://github.com/fenomas/noa) | 689 | 2023-07 | MIT (API) | Babylon-based voxel engine | **Ignore**. |
| [hexianWeb/Third-Person-MC](https://github.com/hexianWeb/Third-Person-MC) | 194 | 2026 | unchecked | Three.js third-person Minecraft | **Ignore**. |
| [mozilla/BrowserQuest](https://github.com/mozilla/BrowserQuest) → [Kaetram/Kaetram-Open](https://github.com/Kaetram/Kaetram-Open) | 9,372 / 738 | 2023 (archived) / 2026-10 | MPL-2.0 code, CC-BY-SA content | Classic 2D HTML5 MMO; Kaetram is the maintained successor (zones, quests, persistence) | **Learn** MMO server structure (quests/missions, persistence). |
| [RSamaium/RPG-JS](https://github.com/RSamaium/RPG-JS) | 1,664 | 2026-09 | MIT (API) | Same code for RPG or MMORPG in browser (2D) | **Learn** (quest/event scripting model). |
| [clockworklabs/SpacetimeDB](https://github.com/clockworklabs/SpacetimeDB) | 25,253 | 2026-10 | **BSL 1.1** (file) | Database-as-game-server (powers BitCraft MMO) | **Learn**; BSL restricts offering it as a hosted DB service. Using it for our own game is generally allowed, but needs legal read. |
| [workadventure/workadventure](https://github.com/workadventure/workadventure) | 5,825 | 2026-10-02 | **AGPL-3.0 + Commons Clause** (file) | 2D virtual office with **proximity video/voice bubbles** (LiveKit), Matrix chat | **Learn only** (Commons Clause forbids selling it; AGPL). Best UX reference for proximity chat. |
| [ottomated/CrewLink](https://github.com/ottomated/CrewLink) / [BetterCrewLink](https://github.com/OhMyGuus/BetterCrewLink), [Mindgamesnl/OpenAudioMc](https://github.com/Mindgamesnl/OpenAudioMc) | 3,286 / 1,100 / 402 | 2026 | GPL-3.0 (CrewLink) / others unchecked | Proximity-voice mods (WebRTC P2P mesh + position-driven gain) | **Learn** (P2P mesh breaks down past ~8 peers; use an SFU). |
| [billmei/every-proximity-chat-app](https://github.com/billmei/every-proximity-chat-app) | 245 | 2026 | — | Curated list of proximity-chat products | **Learn** (market scan). |

### F. GTA-engine re-implementations & GTA multiplayer mods (architecture lessons only)

| Project | ★ | Last push | License | Notes | Verdict |
|---|---|---|---|---|---|
| [multitheftauto/mtasa-blue](https://github.com/multitheftauto/mtasa-blue) | 1,862 | 2026-10-03 | GPL-3.0 (API) | MTA:SA — 20 years of GTA multiplayer: Lua resources, server-side element sync, streaming, anti-cheat | **Learn** server scripting/resource model for missions. |
| [openmultiplayer/open.mp](https://github.com/openmultiplayer/open.mp) | 647 | 2026-09 | MPL-2.0 (API) | SA-MP replacement; Pawn scripting; RP-server culture | **Learn** (roleplay-server game design is closest to "GTA Online social"). |
| [citizenfx/fivem](https://github.com/citizenfx/fivem) | 4,272 | 2026-09-30 | **Proprietary** — "© Take-Two … Rockstar Games Creator Platform License" (file) | FiveM/RedM; OneSync entity ownership & population culling | **Learn from docs only.** |
| [openfw-game/OpenLiberty](https://github.com/openfw-game/OpenLiberty) | 463 | 2026-09-13 | MIT (file) | Godot 4 open-world game that loads GTA III-era assets | **Ignore** (needs Rockstar assets; Godot web unsuitable). |
| [rwengine/openrw](https://github.com/rwengine/openrw) | 2,234 | 2025-06 | GPL-3.0 (API) | GTA III re-implementation | **Ignore**. |
| [Lolendor/reVCDOS](https://github.com/Lolendor/reVCDOS) | 381 | 2026-05-29 | MIT (file) for the wrapper; game code/assets are Rockstar IP (reVC decompilation) | GTA Vice City in browser via WASM, assets from DOS.Zone CDN | **Dead end / legal hazard.** Only proves that a GTA-scale world can run in WASM. |
| [jackal1337/DFF-Loader](https://github.com/jackal1337/DFF-Loader), [luckeyfaraday/gta4-webmap](https://github.com/luckeyfaraday/gta4-webmap), [CustomSeif/GTASA3DSkins](https://github.com/CustomSeif/GTASA3DSkins), [kewka/sa-skins](https://github.com/kewka/sa-skins) | 3–25 | 2026 | — | GTA asset viewers in Three.js | **Ignore** (IP). |

### G. Lagos / Nigeria-specific projects (competitive landscape / potential collaborators)

| Project | ★ | Last push | License | Notes |
|---|---|---|---|---|
| [okoliken/light-off](https://github.com/okoliken/light-off) | 0 | 2026-10-04 (created 2026-10-02) | none | "Light-Off: A Bolaji Story" — **3D open-world street game set in Lagos (Three.js + TS)**. Live: https://light-off-wine.vercel.app. Very early; a direct thematic neighbour. Watch it, or reach out. |
| [jikeokwu/lagos-stories](https://github.com/jikeokwu/lagos-stories) | 2 | 2026-07 | none | AI-first life simulation set in Lagos (Godot/GDScript). |
| [AdetomiwaOgundiran/Ole-Game](https://github.com/AdetomiwaOgundiran/Ole-Game) | 0 | 2025-12 | unchecked | "Ole — The Lagos Hustle", 3D endless runner in Three.js. |
| [Hezekiah01/LX-Street-Racing](https://github.com/Hezekiah01/LX-Street-Racing) | 1 | 2025-10 | unchecked | 2D canvas taxi racing through Lagos danfo traffic. |
| [destinyy00/lagos_traffic_tycoon](https://github.com/destinyy00/lagos_traffic_tycoon), [codebydolapo/super_emeka](https://github.com/codebydolapo/super_emeka), [lolaiccy/street-hustle-lagos-life](https://github.com/lolaiccy/street-hustle-lagos-life), [Gilgamessy/Lagos-money-adventure](https://github.com/Gilgamessy/Lagos-money-adventure), [abbabandey/Mafia-Empire-Lagos](https://github.com/abbabandey/Mafia-Empire-Lagos), [twisstosin/DroneHustle](https://github.com/twisstosin/DroneHustle) | 0–1 | 2017–2026 | unchecked | Small Lagos-themed games/prototypes. |
| [collinsakoh75-lgtm/street-life-3d-](https://github.com/collinsakoh75-lgtm/street-life-3d-) | 1 | 2026-10 | unchecked | "Street Life 3D", an open-world street-action APK made in Port Harcourt. Shows local appetite for the genre on Android. |

**Takeaway:** nobody has built a serious, real-map, multiplayer Lagos open world. The space is open.

### H. Assets (CC0 / permissive)

| Source | License | Use |
|---|---|---|
| Kenney **City Kit (Roads)** v2.1 (90 objects incl. traffic lights/signs), City Kit Commercial / Suburban / Industrial, **Car Kit** (40+ vehicles, glTF) — kenney.nl / [itch](https://kenney-assets.itch.io/car-kit) | CC0 (web-search, confirmed on OpenGameArt pages) | Prototype city kit, traffic vehicles (re-skin as danfo/keke/okada later). |
| Quaternius (Ultimate Modular Men, Universal Animation Library — used by ecctrl examples, nature packs used by WorldExplorer3D) | CC0 | Characters, animations, vegetation. |
| [ToxSam/open-source-3D-assets](https://github.com/ToxSam/open-source-3D-assets) (991+ GLB) / [osa-gallery](https://github.com/ToxSam/osa-gallery) (4,260+ VRM avatars) | CC0 (per repo descriptions; not file-verified) | Props, avatar base meshes. |
| Mixamo | Adobe ToS (free use, no redistribution as raw assets) | Animations — fine in-game, but don't ship as a standalone pack. |

---

## Proprietary engines / services worth knowing (not open source)

| Name | What | Relevance |
|---|---|---|
| **PlayCanvas Editor/Cloud** | Hosted collaborative editor + publishing (engine and editor front-end are MIT) | Strong option if we pick PlayCanvas: best low-end mobile track record (Let's Craft: a 3.93 MB voxel game for Messenger). |
| **Hyperfy (hosted worlds)** | Commercial ecosystem around the GPL engine | Not a fit (crypto-adjacent, GPL). |
| **Needle Engine** ([support repo](https://github.com/needle-tools/needle-engine-support), 609★) | Unity/Blender → three.js exporter + runtime; commercial license above revenue thresholds | Possible content pipeline if artists use Unity; licence cost. |
| **Wonderland Engine** | WASM/WebGL engine tuned for low-end/Quest; proprietary with revenue share | Performance reference; lock-in. |
| **Rune** ([rune/rune](https://github.com/rune/rune), 425★ SDK) / **PlayroomKit** | Hosted multiplayer for casual web games | Too small-room/casual for an open city. |
| **Photon (Fusion/Realtime)** | Commercial netcode SaaS | Possible, but CCU pricing hurts at scale in a low-ARPU market. |
| **Slow Roads** (anslo) | Best-in-class procedural browser driving; JS; **not open source** ("possibly open-sourcing" is only a long-term goal) | Learn from its talks/videos only. |
| **Messenger** (abeto, Sept 2025) | Three.js + three-mesh-bvh + Node WebSockets multiplayer tiny-planet game | Proof that a polished, light, *social* Three.js world is viable; closed source. |
| **fly.pieter.com** (levelsio) + **Vibe Jam 2026** | Vibe-coded Three.js MMO flight sim; the 2026 jam had 945 entries, "Three.js recommended" | Market signal; closed source. |
| **Cinevva arcade** | Hosted Three.js open-world titles + dev blog | Read the blog (site blocked here). |
| **World Explorer 3D** (worldexplorer3d.io) | Source-available, non-commercial | See table B. |
| **Ready Player Me** | **Shut down 2026-01-31** after the Netflix acquisition | Don't depend on hosted avatar SaaS; own our avatar system (VRM/glTF). |
| **Google Photorealistic 3D Tiles** | Paid API with restrictive ToS | Not usable as a game world. |

---

## Dead ends (and why)

1. **Forking a metaverse platform** (Webaverse, Third Room, Ethereal/iR Engine, Hubs, Hyperfy, Decentraland). They are dead (2022–2023), license-encumbered (CPAL, GPL-3.0) or architected for VR meetings and crypto parcels. None targets low-end Android or vehicle gameplay.
2. **Anything built on Rockstar assets or decompilations** (reVC/reVCDOS, re3, OpenRW, OpenLiberty, DFF loaders). This is a legal hazard. FiveM's code is under a Take-Two license.
3. **Godot web export and Unity WebGL as the primary client.** Both have large WASM downloads, memory pressure and poor low-end Android performance. Native Android exports are fine, but that is not the brief.
4. **Unlicensed or source-available gems** (donmutti/gta, sunset-bay, WorldExplorer3D, Glavin001/open-world). Read them, but don't copy code without a license from the author.
5. **Copyleft or "fair-code" infrastructure for a commercial product:**
   - WorkAdventure is AGPL plus Commons Clause, so it cannot be sold.
   - Hyperfy is GPL-3.0.
   - enable3d is LGPL-3.0.
   - ProbableTrain/MapGenerator is LGPL-3.0.
   - SpacetimeDB is BSL 1.1 (read the terms first).
   - CrewLink is GPL-3.0.
6. **cannon.js / cannon-es / ammo.js** as the physics base. They are stale or legacy. Rapier (or Jolt) is the 2026 default and can also run server-side.
7. **P2P mesh voice** (CrewLink-style) at scale. It does not scale beyond a handful of peers, so use an SFU such as LiveKit or mediasoup.
8. **The ~20 one-shot "GTA in Three.js" AI demos.** They are good for spot ideas but carry no maintenance, licensing clarity, multiplayer or real map data.
9. **Hosted avatar SaaS (Ready Player Me).** It shut down in January 2026, which is a cautionary tale for any third-party avatar dependency.

---

## Key takeaways for the Lagos project

1. **No open-source project already does our whole job.** No project combines a real-map city with multiplayer, missions and mobile support. The closest pieces are:
   - NotBlox: authoritative multiplayer with Rapier and cars
   - donmutti/gta: an OSM real city turned into GTA, unlicensed
   - gta7 and Leonida: GTA gameplay systems, MIT
   - ecctrl and Sketchbook: walk and drive controllers, MIT
   - osm2streets and Streets GL: OSM geometry, Apache/MIT
   - Colyseus, Nakama and LiveKit: backend and voice, MIT/Apache

   Assemble these rather than fork one monolith.
2. **Recommended stack shape, based on what the survivors use:**
   - **Renderer:** Three.js (vanilla, or R3F if we want ecctrl/viverse/uikit), or PlayCanvas if low-end Android is the overriding constraint. Both are MIT.
   - **Physics:** **Rapier** on both client and Node server.
   - **Server:** authoritative, with an ECS shared between client and server.
   - **Map:** an **offline OSM → game-chunk pipeline** (osm2streets for roads, Streets-GL/OSM2World-style building generation) served as static tiles from a CDN (PMTiles-style).
   - **Realtime:** Colyseus rooms per district plus a spatial-hash area-of-interest. Use geckos.io/WebRTC datachannels if TCP head-of-line blocking hurts on mobile data.
   - **Voice:** LiveKit for proximity voice.
   - **Meta layer:** Nakama for accounts, crews, chat and economy.
3. **The OSM gotchas are now documented by others.** In particular, see donmutti/gta's README:
   - road widths are missing
   - T-junctions are not welded
   - traffic-signal nodes sit in the carriageway
   - widened roads crush buildings

   Plan for these from day one. Lagos OSM data will be patchier than Luxembourg's, so we will need gap-filling: procedural fill (MapGenerator-style) plus open building datasets. Lagos coverage of those datasets has not been verified in this pass.
4. **Make mobile a first-class quality tier from the start.** Every project that runs on phones does the same things:
   - auto-detects touch
   - has a context-sensitive on-screen control cluster (sunset-bay, gta7)
   - drops shadows and post-processing (NotBlox guide, Cinevva)
   - uses instancing everywhere (one draw call per prop type)
   - uses shader-only facades instead of textures (night-street, donmutti)
   - synthesizes audio procedurally to cut downloads
5. **Get multiplayer-friendly determinism for free where possible.** For example, compute traffic-light phase from clock + junction id, as donmutti/gta does. Ambient traffic and peds can then be simulated client-side from shared seeds, and only player-affected entities need to be server-owned.
6. **License hygiene:** keep NotBlox's anti-crypto clause and all MIT notices. Avoid GPL/AGPL/CPAL/Commons-Clause code in the client. Assets should come from CC0 sources (Kenney, Quaternius) until custom Lagos art (danfo, keke, okada, BRT) exists.
7. **People to contact:**
   - donmutti, to ask for an MIT license on the Luxembourg OSM GTA
   - iErcann (NotBlox author), who has said he wants to build a GTA-like
   - okoliken (Light-Off, a Lagos Three.js game started this week), as a possible collaborator or competitor
