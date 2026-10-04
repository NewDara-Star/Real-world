# 02 — Networking, Proximity Voice & Chat Moderation for a Shared-World Lagos Game

*Research date: October 2026. Prices change often; every figure below is a planning estimate, not a quote. Items marked **(verify)** come from memory or secondary sources and should be confirmed before committing.*

**Target:** a browser game (low-end Android Chrome first) with thousands of concurrent players in one shared Lagos, walking and driving, with automatic **proximity text chat** (group forms from nearby players, bubbles over heads) and optional **proximity voice** (volume falls off with distance). Players are on flaky 3G/4G, and data costs them money.

---

## 0. TL;DR

1. **"One shared city" means one *world* split into many *cells*, not one process.** Split Lagos into a spatial grid. Each server process owns a group of cells. Each client subscribes to the 3×3 cells around it (area of interest, AOI). Dense hotspots such as Balogun Market or a Lekki beach party get **layers** (parallel copies of a cell, as WoW does). The lagoon and the bridges (Third Mainland, Carter, Eko, Lekki–Ikoyi link) are **natural shard seams**.
2. **Transport:** use a binary protocol over **WebSocket (wss:443)** now, behind a transport abstraction so **WebTransport datagrams** can be added later. WebTransport has worked on Android Chrome since v97 and became Baseline when Safari 26.4 shipped it in March 2026. Don't make WebRTC data channels (geckos.io) your primary transport: mobile CGNAT and the need for TURN make it fragile, and it complicates a browser game.
3. **Budget about 20–30 kbps down and 5–8 kbps up per player** for 30 visible players, using quantized binary deltas and distance-based update rates. Naive JSON at 20 Hz is about 350 kbps, more than 10× worse. One hour of play is roughly 12–15 MB, about ₦3–12 at 2026 Nigerian bundle prices.
4. **Voice:** use an SFU with **selective subscription** (each listener hears only the nearest 3–6 speakers). Client-side **Web Audio GainNode/PannerNode** handles distance falloff. Use **Opus mono at 10–16 kbps with DTX and in-band FEC, 40–60 ms ptime**. Best fits: **Cloudflare Realtime SFU** ($0.05/GB after 1 TB free; anycast, so it has a Lagos PoP) or **self-hosted LiveKit** (Apache-2.0; Hyperfy v2 uses it). Per-minute vendors (LiveKit Cloud, Agora) get expensive above about 5k CCU.
5. **Hosting reality:** the only hyperscaler compute *in* Lagos is the **AWS Local Zone (af-south-1-los-1)**, which has a limited set of instance types. Local providers include Rack Centre, Layer3, Whogohost and OADC/Equinix LG1. Cheap European hosts (Hetzner/OVH) add about 90–130 ms RTT. That is **acceptable for a social/driving game with interpolation**, and they cost a fraction of af-south-1 egress ($0.154/GB). A practical plan: start with EU or Lagos colo, put Cloudflare in front so TLS/WebSocket terminates at the Lagos PoP, and measure from MTN/Airtel/Glo SIMs.
6. **Moderation:** use a 3-tier text pipeline. Tier 1 is deterministic regex: anti-scam for Nigerian phone numbers, 10-digit NUBAN account numbers, bank/fintech names, and links. Tier 2 is a cheap classifier: OpenAI `omni-moderation` (free), or a self-hosted AfroXLMR/AfriBERTa fine-tuned on AfriHate/NaijaHate. Tier 3 sends only escalations and user reports to an LLM such as **Claude Haiku 4.5 ($1/$5 per MTok)**, with Pidgin-aware prompts, plus Nigerian human moderators. **Perspective API shuts down on 31 Dec 2026, so do not build on it.** Real-time voice moderation (ToxMod, 10–15¢ per voice-hour) does not fit this budget and does not cover Nigerian languages. Use **report-triggered** review of a rolling client audio buffer instead.
7. **Rough monthly infra cost (recommended stack, ex-salaries):** about **$300–700 at 1k CCU**, about **$3k–7k at 10k CCU**, about **$15k–35k at 50k CCU**. Hosting in Lagos with AWS egress roughly doubles or triples the networking line. Section 7 has the full tables.

---

## 1. Game-server networking options

### 1.1 Comparison table

| Option | What it is | License / self-host | Scaling model | Cost signal | Fit for us |
|---|---|---|---|---|---|
| **Colyseus** | Node.js authoritative room framework; `@colyseus/schema` binary delta sync; per-client filtering (`StateView` in 0.16) | MIT, self-host or Colyseus Cloud | Room-per-process, Redis presence/driver across nodes; you build cell handoff | Cloud from **$15/mo**, no CCU caps, compute-plan priced ([pricing](https://www.colyseus.io/pricing), [billing docs](https://docs.colyseus.io/cloud/pricing-billing)) | Good for districts/interiors (rooms ≈ cells). Fastest path in TS. Single-threaded Node limits big rooms. |
| **Nakama (Heroic Labs)** | Go game backend: auth, friends, groups, **built-in realtime chat**, storage, leaderboards, authoritative matches (Go/TS/Lua) | Apache-2.0, self-host (Postgres/Cockroach) or Heroic Cloud | Cluster; each authoritative match is one loop goroutine | Heroic Cloud is CPU-core priced, **no CCU/MAU limits**; numbers not public ([pricing](https://heroiclabs.com/pricing)) | Strong "everything except the world sim" backend. Use matches as cells; chat channels for group chat. |
| **uWebSockets.js** | Very fast C++ WebSocket server with JS bindings, built-in pub/sub topics | Apache-2.0, self-host | You build everything | Infra only | Best raw Node throughput. Topics map to cells. Recommended core if TS. |
| **Socket.io** | WS with HTTP long-poll fallback, rooms, reconnection | MIT | Redis adapter | Infra only | Polling fallback helps with hostile proxies, but JSON plus overhead is heavy. Fine for chat/lobby, not position streams. |
| **Geckos.io** | Server↔client **WebRTC data channels** (UDP-like, unordered/unreliable) on Node | BSD-3; active (pushes Mar 2026) ([repo](https://github.com/geckosio/geckos.io)) | Single process; you scale | Infra only | Avoids TCP head-of-line blocking, but ICE/TURN on CGNAT mobile is brittle. Superseded by WebTransport for our purposes. |
| **WebTransport** (protocol, not a product) | HTTP/3/QUIC streams + **unreliable datagrams** from the browser | Servers: `webtransport-go` (quic-go), `wtransport` (Rust), Node libs | — | — | **Chrome 97+ (incl. Android), Firefox 114+, Safari 26.4+ → Baseline 2026** ([webrtc.ventures](https://webrtc.ventures/2026/04/webtransport-is-now-baseline-what-it-means-for-real-time-media/), [websocket.org](https://websocket.org/comparisons/webtransport/)). Implementations still differ; **keep a WS fallback** (UDP/443 is blocked on some networks). |
| **PartyKit / Cloudflare Durable Objects** | Stateful single-threaded actors at the edge with WebSockets (PartyKit was acquired by Cloudflare; now `partyserver` on DOs) | Proprietary platform; JS/TS | One DO per cell/room; unlimited DOs | $0.15/M requests (**20 inbound WS msgs = 1 request**), $12.50/M GB-s duration; **hibernation** stops duration billing only when idle ([DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing)) | Zero ops, no egress fees. But a cell ticking at 10 Hz never hibernates. **DO placement in Africa is limited** (`afr` hint exists but availability is footnoted) ([data location](https://developers.cloudflare.com/durable-objects/reference/data-location/)), so state may live in Europe even though WS terminates in Lagos. |
| **SpacetimeDB** | Database plus server: logic runs as "reducers" inside the DB; clients **subscribe to SQL queries** (spatial subscriptions) | **BSL 1.1 → AGPLv3 with linking exception** after the change date; self-host standalone or Maincloud | Single-node per database; BitCraft splits the world across region databases **(verify detail)** | Maincloud Free (2,500 TeV ≈ 3M reducer calls), Pro $25/mo, Team $250/mo ([pricing blog](https://spacetimedb.com/blog/all-new-spacetimedb-pricing)) | Proven by **BitCraft Online** (whole backend in SpacetimeDB). Elegant AOI via subscription queries. Risks: young tech, BSL, Rust/C#/TS modules, need to self-host in/near Lagos. |
| **Hathora** | Managed game-server orchestration | — | — | **Wound down in 2025** after acquisition by Fireworks AI; customers moved to Nitrado GameFabric ([GamesBeat](https://gamesbeat.com/?p=318174), [TechSpot](https://www.techspot.com/news/111969-stormgate-servers-go-dark-following-ai-focused-hosting.html)) | **Avoid.** It is a cautionary tale about vendor risk. |
| **Rivet** | Open-source "actors" (long-lived stateful processes) + orchestration | **Apache-2.0**, fully self-hostable ([rivet.dev](https://www.rivet.dev/docs/actors/http-api)) | Actor per room/cell | Usage-based: 128 MB actor ≈ $4.29/mo, $0.05/GB beyond pooled bandwidth; Hobby $5, Team $200 ([changelog](https://rivet.dev/changelog/2024-02-12-usage-pricing-update/)) | Interesting DO-like model you can self-host in a Lagos colo. Smaller community. |
| **Photon (Realtime / Fusion)** | Proprietary relay cloud; Fusion is Unity-centric | Proprietary; Photon Server self-host is licensed | Rooms (typically 16–200 players) | 100 CCU free; **$125/500, $250/1,000, $500/2,000 CCU**, ~3 GB/CCU traffic included ([crux](https://crux.supercraft.host/blog/photon-fusion-pricing-2026/), [Photon docs](https://doc.photonengine.com/photon/current/pricing)) | Unity WebGL builds are too heavy for low-end Android. Room model isn't a seamless world. **Not recommended.** |
| **Elixir / Phoenix Channels** | BEAM pub/sub, **Phoenix Presence** (CRDT), millions of sockets per cluster | MIT | Distributed PubSub across nodes, very robust to flaky clients | Infra only | **Excellent for chat, presence, social graph, and group-chat fan-out.** Less natural for 20 Hz physics loops but workable. |
| **Custom Go / Rust** | e.g. Go `coder/websocket` + `quic-go`; Rust `tokio` + `wtransport` | Your code | Cell servers + gateway + message bus (NATS) | Infra only | Highest CPU efficiency (~2–5× Node per core). Best long-term for 50k CCU. |
| **Convex** (Lagos Tycoon uses it) | Reactive DB/backend | Proprietary cloud (open-source backend available) | Function-call based | Billed per function call/bandwidth | Fine for economy/tycoon state. Not designed for 10–20 Hz position streams for thousands. |

### 1.2 What the competitors' choices tell us

- **Lagos Life (~6-player venue rooms, WS + HTTP polling fallback):** cheap and robust, but the "city" is not shared. The polling fallback shows that some Nigerian users really do fail on WebSockets (proxies, captive portals, Opera/data-saver modes).
- **GTA-like Lagos (~40-player WS rooms):** this is the classic FiveM/Roblox-style instance. The ~40 figure matches what one naive broadcast room handles before O(n²) fan-out hurts.
- **Our differentiator, "thousands in one city", requires AOI plus spatial sharding** (Section 2). Each client should still only ever *see* about 20–50 players. That keeps data cost the same as in a 40-player room.

### 1.3 Mobile/flaky-network specifics

- Always use **wss on 443**, because transparent proxies on port 80 break WS upgrades. Keep a **long-poll/SSE degraded mode** (as Lagos Life does) for the roughly 1–3% who can't hold a WS **(estimate)**.
- **Session resume:** the server keeps the player's entity and sequence number for 30–60 s after a drop. The client reconnects with a resume token and gets a fresh snapshot, so there is no "you were kicked" when the train enters Third Mainland Bridge traffic.
- **Adaptive rate:** the client reports RTT/loss. The server drops that client from 15 Hz to 5 Hz and shrinks its AOI under bad conditions. A **"Data saver" toggle** sets 5 Hz, at most 15 visible players and no voice.
- On TCP, avoid head-of-line stalls by **never queueing stale position snapshots.** Keep only the newest unsent snapshot per client (drop-oldest backpressure, `bufferedAmount` checks on uWS).

---

## 2. Interest management & spatial sharding

### 2.1 How others do it

| System | Technique |
|---|---|
| **Classic MMOs (WoW, Albion, EVE)** | Zones/servers per region. WoW added **layering** (parallel copies of a zone, capped by population) and **sharding**. Albion uses hard zone boundaries with loading. EVE runs single-shard star systems per node with **time dilation** under load. |
| **Improbable SpatialOS** | Workers own spatial regions; clients get entities via **query-based interest** (subscription queries such as "entities within radius r with component C") ([patent](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10579434)). Public SpatialOS is **effectively discontinued**. The lesson: dynamic load balancing across workers was hard and expensive. Static grids are simpler. |
| **SpacetimeDB / BitCraft** | Clients subscribe to SQL queries over chunk/region coordinates. The DB pushes row deltas. AOI is a query you rewrite as the player moves ([SpacetimeDB](https://spacetimedb.com/pricing)). |
| **Roblox** | Per-server instance caps (typically 50–100 players, up to ~700). **StreamingEnabled** streams world parts only within a radius around the player. Each server is a separate copy of the world, so it is not one shared city. |
| **Hytopia** | Server-authoritative TS SDK. The engine handles networking/prediction. Worlds are instances ([SDK README](https://app.unpkg.com/hytopia@0.7.1/files/README.md)). |
| **Hyperfy v2** | Single authoritative Node/Fastify server per world over WebSocket. **LiveKit for voice** (`LIVEKIT_WS_URL` in `.env.example`) ([repo](https://github.com/hyperfy-xyz/hyperfy), [DeepWiki](https://deepwiki.com/hyperfy-xyz/hyperfy)). |
| **Mozilla Hubs** | Rooms of ~25–50. Networking moved from Janus to the **mediasoup-based "Dialog" SFU (verify)**. Spatial audio uses Web Audio PannerNode. Mozilla shut Hubs down on 31 May 2024. **Hubs Community Edition** continues on Kubernetes ([Mozilla](https://hubs.mozilla.com/labs/sunset)). |
| **GTA RP / FiveM (OneSync)** | One server of up to ~2,048 slots. Entities are culled to a **~424 m "scope" radius** per player **(verify)**. Voice uses grid channels (below). |

### 2.2 Recommended design for Lagos

- **Grid:** fixed cells (start at 128–256 m). Each client subscribes to its **3×3 neighbourhood**. Use **hysteresis**: subscribe when inside 1.0× radius, unsubscribe at 1.3× radius, so walking along a border doesn't thrash.
- **Cell → process assignment:** a static map from districts to processes, rebalanced offline. Examples: Yaba/Surulere/Ikeja on Mainland nodes; Lagos Island/Ikoyi/VI on another; Lekki/Ajah on another. Bridges are seams, and a player in a car crossing Third Mainland Bridge gets a **handoff** (state transfer through a NATS/Redis bus; client keeps one socket via a **gateway** that re-routes).
- **Layers for hotspots:** cap a cell at about 80–120 players per layer. Overflow players go to layer 2 of the same cell, with friends and party members kept together. Chat and voice are per-layer. This bounds the worst case in Balogun or at Detty December concerts.
- **Priority accumulator / LOD**, following Gaffer on Games ([State Synchronization](https://gafferongames.com/post/state_synchronization/)):
  - nearest ~10 players at 10–15 Hz;
  - players 30–100 m away at 3–5 Hz;
  - beyond that, counts/"crowd impostors" only;
  - parked cars and idle players: event-driven only.
- **Snapshot interpolation** on the client with a 100–150 ms buffer ([Gaffer: snapshot interpolation](https://gafferongames.com/post/snapshot_interpolation/)), plus client-side prediction for the local player only. For a social/driving game, **150–250 ms RTT is perfectly playable**, so hosting doesn't have to be in Lagos on day 1.
- **Delta against acked baseline** (Quake 3 model, [Fabien Sanglard](https://fabiensanglard.net/quake3/network.php)), quantization and bit-packing (below).

### 2.3 Bandwidth math

**Per-entity update (quantized binary):**

| Field | Encoding | Bytes |
|---|---|---|
| Entity slot (per-client local index ≤ 255) | u8 | 1 |
| Position x,y within the 3×3 AOI window | 2× u16 at ~1.2 cm (768 m / 65,536 ≈ 1.2 cm) | 4 |
| Height / floor | u8 | 1 |
| Heading | u8 (1.4°) | 1 |
| Anim/state flags (walk/run/drive/emote/talking) | u8 | 1 |
| **Total full update** | | **8 B** |
| Delta (only changed fields + 1-byte mask) | | ~4–6 B |

**Per-packet overhead (server→client over WS/TLS/TCP/IP):** about 2–6 B for the WS frame, about 22–29 B for the TLS record, and 40 B for TCP/IP (IPv4, plus 12 B more with TCP timestamps), so **≈ 70 B per packet**. The ACK traffic going the other way costs uplink too.

**Estimates (download, server → one client):**

| Scenario | Payload | Overhead | **Total** |
|---|---|---|---|
| 30 visible × 8 B @ **10 Hz** | 2,400 B/s | 700 B/s | **≈ 25 kbps** |
| 30 visible × 8 B @ **20 Hz** | 4,800 B/s | 1,400 B/s | **≈ 50 kbps** |
| LOD mix: 10 near @ 15 Hz + 20 far @ 4 Hz, 15 packets/s | 1,840 B/s | 1,050 B/s | **≈ 23 kbps** |
| Same with deltas and ~50% of players idle | ~1,000 B/s | 1,050 B/s | **≈ 16 kbps** |
| Naive JSON (`{"id":"…","x":123.456,…}` ≈ 70 B) × 30 @ 20 Hz | 42,000 B/s | 1,400 B/s | **≈ 350 kbps** |

**Upload (client → server):** input/state at 10 Hz is about 10–14 B payload plus about 70 B overhead, roughly **6–7 kbps**. Overhead dominates, so **don't send above 10 Hz**. Send on change, and batch with chat/acks.

**Takeaways**

- **Header overhead is about 30–50% of a well-packed stream.** Lowering the *packet* rate (15 Hz packets carrying both near and far updates) matters as much as shrinking entities.
- `permessage-deflate` helps little on small binary frames and costs server CPU and memory. Disable it for the position channel. It can be useful for chat/history payloads.
- **Data cost to the player:** about 25 kbps down plus 7 up ≈ **14 MB/hour**. At about ₦800/GB (standard 1 GB bundle) that is about ₦11/hour. On best-value bundles (~₦200/GB) it is about ₦3/hour ([2026 data prices](https://www.androidpols.com.ng/2026/01/1gb-data-price-nigeria-2026-updated.html), [awajis](https://awajis.com/cheapest-data-plans-nigeria/); NCC approved a 50% tariff rise in Jan 2025). Voice adds about 10–25 MB/hour (Section 3). **Assets (map tiles, GLBs) will dwarf all of this**, so cache aggressively with a Service Worker and version the assets.
- **Server egress per *peak* CCU:** at 25 kbps sustained, 8.1 GB per CCU-month. At an assumed 50% average-to-peak ratio, **about 4 GB per peak CCU per month.**

### 2.4 Proximity text chat (auto group)

- The server computes **chat clusters** every 1 s: players within R (say 15–20 m, configurable per venue), linked transitively with union-find and capped (for example 25 members), with **hysteresis** (join at 15 m, leave at 25 m).
- A message is delivered to the sender's current cluster, which is the same set of entities the client already sees, so it is cheap. The client renders **bubbles over heads** plus a transient "nearby chat" panel. Cluster membership changes are sent as small events so the UI can show "Tunde joined the conversation".
- Persist messages (sender, cluster member IDs, cell, timestamp) asynchronously for **reports and moderation evidence**. Retain for 30–90 days (NDPA 2023 data-minimisation, **verify** with counsel).
- Chat goes through the moderation pipeline (Section 4) **before fan-out**. Tier 1 is synchronous (<1 ms) and tiers 2–3 are async with retroactive hide. A Phoenix or Nakama chat layer is a good fit if the world server is separate.

---

## 3. Proximity voice

### 3.1 Architecture patterns

| Pattern | How | Pros / cons |
|---|---|---|
| **P2P mesh** | Each player sends a stream to each nearby peer | Uplink scales O(n): 5 peers × 16 kbps is fine, 15 is not. CGNAT on Nigerian mobile means heavy **TURN** use, so you pay relay costs anyway. **Only for ≤4–5 players.** |
| **SFU + selective subscription** (recommended) | Each speaker publishes 1 stream. The game server tells each client which ≤N tracks to subscribe to (nearest/loudest within radius). The client applies distance gain/pan. | Uplink is constant (1 stream). Downlink is bounded by N. Spatialization is client-side and free. The SFU never decodes. |
| **Server-side mixing (MCU) / Mumble-style** | Server forwards per-target audio; Mumble clients do positional mixing | Mumble's positional audio is what **FiveM uses natively**. **pma-voice** wraps it with **grid channels** (map split into Mumble channels; you listen to your grid plus neighbours) and per-mode ranges (whisper/normal/shout) ([pma-voice guide](https://xgamingserver.com/blog/fivem-voice-chat-pma-voice-guide/), [fork](https://github.com/Fox-Lua-Source/pma-voice)). **SaltyChat** and **TokoVoip** do the same over TeamSpeak 3 plugins. Not browser-native, but the **grid-channel idea maps directly to "one SFU room per voice cell"**. |

**Others:**

- **Gather.town:** audio/video fade by avatar distance. Historically P2P for small groups and SFU at scale **(verify)**.
- **Mozilla Hubs:** SFU (Janus, then mediasoup Dialog) with PannerNode falloff and per-room audio settings.
- **VRChat:** per-avatar 3D audio with near/far falloff and a cap on simultaneous audible voices **(verify)**.
- **Rec Room:** proximity voice with Junior-account restrictions **(verify)**.
- **Hyperfy v2:** LiveKit.
- **Vivox:** the voice service behind many AAA games. It has positional channels with audible distance and rolloff curves, but **no first-class web SDK**, so it doesn't suit a browser game **(verify)**.

### 3.2 Recommended voice design

1. **Voice is off by default.** Opt in after age gate and phone verification. **Push-to-talk on mobile** by default, which also saves battery and data.
2. **One SFU room per voice cell** (for example 64–128 m), mirroring pma-voice grids. A client joins its cell's room plus neighbours with **autoSubscribe off**.
3. The **game server picks up to 4–6 audible tracks per listener**: nearest speaking players within ~25 m (shout ~50 m), with "talking" flags from the world stream. The client subscribes and unsubscribes accordingly.
4. **Web Audio:** `MediaStreamSource → GainNode (distance curve) → StereoPanner` (cheaper than `PannerNode` HRTF on low-end phones) `→ destination`. Use a linear or inverse rolloff to zero at max range. Mute beyond range so you also *unsubscribe*.
   - *Pitfall:* on Android Chrome, remote WebRTC audio may need to be attached to a muted `<audio>` element for Web Audio processing to start. Test early on cheap Tecno/Infinix/itel devices.
5. **Opus settings:**
   - mono, 16 kHz (wideband);
   - **10–16 kbps** target (8 kbps is intelligible but rough);
   - `usedtx=1` so silence costs almost nothing;
   - `useinbandfec=1` for lossy 3G;
   - **ptime 40–60 ms**. At 20 ms, RTP/UDP/IP/SRTP overhead (~40 B × 50 pps ≈ 16 kbps) is larger than the payload. At 60 ms it is about 5 kbps.
   - RED (redundant audio) roughly doubles bitrate. Enable it only on good networks or high-loss links.
6. **Per-listener bandwidth:**
   - each audible stream at 12 kbps Opus + 60 ms ptime ≈ 17 kbps on the wire;
   - with DTX and about 3 simultaneous talkers, **≈ 30–50 kbps down while in a lively group**, much less in quiet ones;
   - own uplink ≈ 17 kbps only while talking;
   - **≈ 10–25 MB per voice-hour.**

### 3.3 Voice infrastructure options

| Option | License / model | Pricing | Notes |
|---|---|---|---|
| **LiveKit (self-host)** | Apache-2.0 Go SFU, selective subscription, data channels, good JS SDK | Infra only. Benchmark: **10 publishers + 3,000 subscribers on 16 cores at 80% CPU (≈190 participants/core, audio-only)** ([LiveKit benchmark](https://docs.livekit.io/transport/self-hosting/benchmark/)) | Best overall OSS choice. Run it in a Lagos colo or the AWS Local Zone, or in the EU. |
| **LiveKit Cloud** | Managed | Ship $50 (150k participant-min), **Scale $500 (1.5M min)**, overage **~$0.0004–0.0005/participant-min** ([trtc summary](https://trtc.io/blog/details/livekit-pricing-2026), [LiveKit guide](https://livekit.com/field-guides/guide/estimating-pricing-video-conference-livestream)) | Billed per *minute*, not per byte, so it is expensive for always-on proximity rooms. |
| **Cloudflare Realtime SFU (+TURN)** | Proprietary, anycast across 300+ cities **including Lagos** | **$0.05/GB egress, first 1,000 GB/month free**, SFU + TURN combined ([pricing](https://developers.cloudflare.com/realtime/sfu/pricing)) | Raw SFU API: you manage sessions/tracks yourself, which suits game-driven subscription. Users connect to the Lagos PoP. **Best price/latency for us.** |
| **mediasoup** | ISC, Node/C++ SFU library | Infra only | Very efficient, but you build signalling, scaling and TURN. Hubs' choice. |
| **Janus** | GPL-3.0, C | Infra only | Mature but GPL. AudioBridge plugin can do server mixing. |
| **Agora** | Proprietary | **$0.99 per 1,000 voice participant-min**, 10k min free, volume discounts ([Agora](https://www.agora.io/en/pricing/voice-calling)) | Has spatial-audio extension and good emerging-markets SD-RTN. Per-minute cost explodes at scale. |
| **Daily** | Proprietary | Per participant-minute (audio-only cheaper) **(verify)** | Same per-minute economics. |
| **100ms** | Proprietary (India-based) | Per-minute **(verify)** | Same. |
| **Dolby.io Communications** | — | **Retired** (repos archived Aug 2024) ([apis.io](https://apis.io/providers/voxeet/)) | Avoid. |

### 3.4 Server locations & latency from Lagos

| Location | Infra | Typical RTT from Lagos (fixed line; **add 30–100 ms for 3G/4G radio**) |
|---|---|---|
| **Lagos** | **AWS Local Zone af-south-1-los-1** (t3, c5, m5, r5, g4dn; launched Jan 2023) ([AWS](https://go.aws/3XZcGZn), [aws-pricing](https://aws-pricing.com/af-south-1-los-1.html)). **Cloudflare PoP** (since 2018, peered at IXPN/WAF-IX) ([tech.africa](https://tech.africa/cloudflare-lagos-nigeria)). **AWS CloudFront edge.** Colo/VPS: Rack Centre, Equinix LG1 (ex-MainOne), OADC, Layer3, Whogohost (VPS from ~₦11k/mo, "unmetered"), Lineserve ([Whogohost](https://www.whtop.com/plans/whogohost.com/132418), [Lineserve survey](https://www.lineserve.net/blog/vps-hosting-nigeria)) | ~5–25 ms in-city **(verify per carrier: MTN/Airtel/Glo peering at IXPN varies)** |
| **Johannesburg / Cape Town** | AWS af-south-1 (egress **$0.154/GB**) ([pricing ref](https://www.stormit.cloud/blog/aws-data-transfer-pricing-how-to-reduce-costs/)), Azure South Africa North, GCP Johannesburg, Oracle | ~100–150 ms when routed directly over WACS/Equiano/2Africa. **Often >200 ms when traffic "trombones" via Europe (verify with RIPE Atlas)** |
| **Europe (London, Marseille, Lisbon, Frankfurt)** | Hetzner/OVH/Scaleway (cheap flat bandwidth), all hyperscalers | ~90–130 ms (most Nigerian transit lands in Europe) **(verify)** |
| **Cairo** | No major hyperscaler compute region yet **(verify)** | Usually routed via Europe, so no win |

Research note: African clients mostly reach CDN/cloud nodes *outside* the continent, and in-Africa CDN nodes give **up to 87% lower latency** ([UCT, Measuring Cloud Latency in Africa](https://pubs.cs.uct.ac.za/id/eprint/1704/)). This favours **terminating connections at the Cloudflare/AWS Lagos edge** even when game logic runs elsewhere.

**Action item:** before choosing hosting, run a one-week latency/loss probe from 3–4 Android phones on MTN, Airtel, Glo and 9mobile/T2 against Lagos Local Zone, Lagos colo, af-south-1, eu-west-2 and Hetzner. Use WebSocket echo plus a Cloudflare Realtime test.

---

## 4. Chat moderation at scale

### 4.1 Text moderation options

| Option | Cost | Nigerian-language reality |
|---|---|---|
| **OpenAI `omni-moderation-latest`** | **Free** (tier rate limits); text + image; 13 categories ([OpenAI](https://openai.com/index/upgrading-the-moderation-API-with-our-new-multimodal-moderation-model/)) | Improved on 40 languages incl. low-resource ones. Pidgin is likely OK-ish because it is English-lexified. **Yoruba/Igbo/Hausa unmeasured (verify with your own eval set).** Categories don't include scams/solicitation. |
| **Google Perspective API** | Free | **Sunsetting: service ends 31 Dec 2026, no new quota after Feb 2026** ([perspectiveapi.com](https://perspectiveapi.com/), [alternatives write-up](https://perspectiveai.xyz/google-perspective-api-sunset-alternatives-2026/)). **Do not adopt.** |
| **Claude Haiku 4.5** (`claude-haiku-4-5`) | **$1 / $5 per MTok in/out**; prompt-cache the policy prompt | Handles Pidgin, code-switching, slang ("419", "yahoo", "maga", "runs", "pay small small") and *context* (scam funnels, grooming patterns) far better than keyword classifiers. Use for escalations, reports and appeals, not for every message. |
| **Mistral moderation, Azure AI Content Safety, Google Cloud NL moderation** | Per-call | General multilingual. Same low-resource caveat. |
| **Open-source classifiers** | Self-host CPU/GPU | Fine-tune **AfroXLMR / AfriBERTa / Serengeti** on **AfriHate** (15 African languages incl. **Hausa, Igbo, Yoruba, Nigerian Pidgin**; hate/abusive/neutral) ([arXiv 2501.08284](https://arxiv.org/abs/2501.08284)), the Hausa/Yoruba/Igbo offensive-language dataset ([arXiv 2406.02169](https://arxiv.org/pdf/2406.02169)) and **NaijaHate** (Nigerian Twitter, **verify**). AfriHate authors note performance "highly depends on the language". Plan your own labelled game-chat data. |
| **Detoxify / unitary toxic-bert, LlamaGuard-class models** | Self-host | English-centric. Weak on Yoruba/Igbo/Hausa. |

**Known issues with Nigerian languages**

- **Code-switching** within one message, e.g. "Abeg send your acct, I go pay you double sharp sharp".
- **Pidgin false positives:** "I go kill am" (laughing), "you dey craze", "ode", "mumu" — banter vs abuse.
- **Diacritics dropped** in Yoruba, so homographs collide.
- **Ethno-religious slurs** that general classifiers don't know: tribal insults, "aboki" used pejoratively depending on context.
- **Political flashpoints** (elections, #EndSARS) need policy, not just classifiers.
- **Hire Nigerian moderators** fluent in each language. Budget for them more than for APIs.

### 4.2 Anti-scam rules (Tier 1, deterministic, synchronous)

Normalise first: lower-case, strip spaces, dots and dashes, map look-alikes (`o→0, l/i→1, s→5`), convert digit words ("zero eight one", "oh-eight", Pidgin and Yoruba numerals e.g. "ọ̀kan, èjì…") to digits, and remove emoji digits. Then:

- **Nigerian mobile numbers:** `(?:\+?234|0)[789][01]\d{8}` after normalisation. **Split-message detection:** keep a per-sender 60 s sliding window and join digits across messages.
- **Bank account (NUBAN): exactly 10 digits** near bank/fintech words: GTB/GTCO, Access, Zenith, UBA, First Bank, Fidelity, Sterling, Wema/ALAT, **OPay, PalmPay, Moniepoint, Kuda**, Paga.
- **Off-platform funnels:** "whatsapp", "wa.me", "t.me", "telegram", "dm me", "IG", "snap".
- **Money-flip/investment patterns:** "double your money", "invest", "crypto", "forex", "MMM", "recharge card PIN", "BVN", "OTP", "NIN".
- **URLs:** allow-list your own domains only.
- **Actions:**
  - mask the content (`***`) for everyone except the sender, which avoids teaching evasion;
  - add a risk score to the account;
  - new accounts (<24 h or <2 h playtime) **cannot send digits/links at all**;
  - repeated hits shadow-mute and queue for human review;
  - show in-game **safety tips** ("Real Lagos Life staff will never ask for your BVN or OTP").
- **Rate limits:** per-sender messages per 10 s; duplicate-message suppression across clusters (spam bots blasting every group).

### 4.3 Voice moderation

- **Modulate ToxMod:** Starter $2,000 setup + **15¢/hour**. Booster $2,500/mo (20k hrs, 13.5¢). Epic $5,000/mo (50k hrs, 12¢). Legendary $20,000/mo (200k hrs, 10¢). **18 languages on top tiers** ([Modulate pricing](https://modulate.ai/toxmod-pricing)). Nigerian Pidgin, Yoruba, Igbo and Hausa are **almost certainly not covered (verify)**. At 10k peak CCU with about 1,250 concurrent voice users (≈ 900k voice-hours/month) it would cost **~$90k–135k/month, so it is not viable.**
- **Recommended instead:**
  1. Voice only for verified 18+ accounts.
  2. Per-player mute/block (client-side unsubscribe, instant).
  3. **Report-triggered evidence:** each client keeps a rolling **30–60 s ring buffer of *received* audio per speaker**, disclosed in ToS/consent. Uploading a report sends the clip. Run ASR on it (Whisper-large-v3 is weak on Yoruba/Igbo/Hausa; evaluate Nigerian/African ASR vendors such as Intron or Spitch **(verify)**), then LLM triage, then a human.
  4. Repeat-offender heuristics: report counts and mutes per hour.
  5. Optional later: sampled ASR on "hot" public cells (concert venues).
- **Legal:** Nigeria Data Protection Act 2023 (consent, retention). The NITDA Code of Practice for Interactive Computer Service Platforms applies to large platforms (local representative, takedown timelines) **(verify thresholds with counsel)**. Children's safety: age gate, and no voice and no DMs for under-18s.

### 4.4 Moderation pipeline

```
client → world server
  ├─ T1 sync (<1 ms): normalise → blocklists/regex/scam rules → rate limits → mask or pass
  ├─ fan-out to proximity cluster (bubbles)
  └─ async queue (NATS/Redis stream)
        ├─ T2: OpenAI omni-moderation (free) and/or self-hosted AfroXLMR classifier → score
        │       └─ high score → retroactively hide bubble + strike
        ├─ T3: Claude Haiku 4.5 on (a) T2 borderline, (b) every user report with ±10 msgs context,
        │       (c) scam-risk accounts → JSON verdict {category, severity, action, rationale}
        └─ Human queue (Nigerian moderators) for T3 "uncertain", appeals, bans
```

---

## 5. Recommended architecture

### Option A — **Recommended: custom cell servers + edge termination + Cloudflare Realtime voice**

```
Android Chrome (PWA, Service-Worker-cached assets)
  │  wss:443 binary (WebTransport datagrams later)
  ▼
Cloudflare (Lagos PoP: TLS/WS termination, DDoS, WAF)   ← "terminate close, compute where cheap"
  ▼
Gateway (Go or uWS.js) — auth (JWT), session resume, routes to cell owners, no game logic
  ▼                                 NATS bus (handoff, cross-cell chat, events)
Cell servers (Go, or uWS.js TS) — spatial hash, AOI 3×3, layers, priority/LOD, delta snapshots,
                                  proximity-chat clustering, T1 moderation, voice-subscription hints
  ▼
Postgres (accounts, economy) + Redis (presence, rate limits) + object storage (chat logs, reports)
Social/chat services: Nakama (friends, groups, DMs, persistence) OR Phoenix (presence, DMs)
Voice: Cloudflare Realtime SFU (anycast incl. Lagos) — game server issues track subscriptions
       (fallback/alt: self-hosted LiveKit in Lagos colo / AWS Local Zone)
Moderation: T1 in-process, T2 OpenAI moderation + self-hosted classifier, T3 Claude Haiku 4.5, human queue
```

- **Where to run cell servers:**
  - **Phase 1 (≤10k CCU):** Hetzner/OVH in Europe, or a Lagos colo if probes show a big win. Cloudflare in front terminates sockets in Lagos. EU hosting gives flat-rate bandwidth (Hetzner includes ~20 TB per server, about €1/TB beyond **(verify)**).
  - **Phase 2:** move hot districts to **AWS Lagos Local Zone** or **Rack Centre/Layer3 colo** with committed transit once revenue covers it.
  - **Check Cloudflare's ToS and plan limits for heavy long-lived WebSocket traffic** (Enterprise or Spectrum may be needed at scale) **(verify)**.
- **Why:** you control bytes on the wire, which is where both player data cost and server cost come from. There's no per-CCU or per-minute vendor tax. Each piece is replaceable. The transport abstraction is ready for WebTransport.
- **Costs:** you build AOI/handoff/layers yourself (≈2–3 engineer-months for a solid v1), and you run ops (k8s or Nomad, monitoring).

### Option B — **Serverless edge: Cloudflare Durable Objects (PartyServer) + Cloudflare Realtime**

- One DO per cell (or per cell-layer). The client opens WebSockets to the 1–4 DOs it overlaps, or uses a gateway Worker that multiplexes. Chat lives in the same DOs. D1/Postgres (Hyperdrive) holds persistence.
- **Pros:**
  - near-zero ops and no egress charges;
  - edge in Lagos for TLS;
  - scales to many cells automatically;
  - TS everywhere.
- **Cons:**
  - Each DO is single-threaded, so a crowded cell has to be split into layers sooner.
  - **Ticking cells never hibernate**, so you pay duration on every active cell: ~$4/month per always-on 128 MB DO, which is small. The inbound message count is the bigger cost: 20 msgs = 1 request at $0.15/M, about $1.9k/month at 10k sustained CCU × 10 msg/s.
  - **DO placement in Africa is limited**, so state may sit in Europe anyway.
  - No UDP/WebTransport.
  - Vendor lock-in.
- **Best for:** a fast MVP with a small team, or if Option A's ops burden is unacceptable.

### Option C — **Off-the-shelf backend: Nakama (or Colyseus) with district/cell "matches"**

- Nakama authoritative matches = cells (or Colyseus rooms with `StateView` filtering). Built-in chat channels, groups, friends, auth, storage and leaderboards. A custom handoff module moves players between matches at cell borders. Voice comes from LiveKit self-hosted.
- **Pros:** the most features out of the box (social graph, chat persistence, economy APIs); Apache-2.0/MIT; self-hostable in Lagos.
- **Cons:** the match/room model fights a seamless world, because there is no built-in AOI across matches. Colyseus's Node single-thread caps cell density. Nakama's Go runtime is efficient, but TS/Lua runtimes are slower.
- **Hybrid (often best):** Option A's custom cell servers for movement plus **Nakama for everything social/persistent.**

### Option D (watch-list) — **SpacetimeDB**

- The whole world is a DB module. AOI comes from subscription queries. BitCraft proves it at MMO scale.
- Adopt only after a spike that tests self-hosting in or near Lagos, BSL licensing comfort, and 10–20 Hz movement-reducer throughput.

---

## 6. Phased rollout

1. **MVP (≤1k CCU):**
   - one Go or uWS.js process (spatial hash, AOI, proximity chat) behind Cloudflare;
   - T1 + OpenAI moderation;
   - Cloudflare Realtime voice for verified users;
   - Postgres/Redis.
   - Hosting: Hetzner/OVH or a Lagos VPS.
2. **Growth (1k–10k):**
   - split into gateway + N cell servers + NATS;
   - layers;
   - Nakama for social;
   - self-hosted Tier-2 classifier;
   - Claude Haiku Tier-3;
   - Lagos-region probes, then move compute to Lagos if justified.
3. **Scale (10k–50k):**
   - Go/Rust cell servers;
   - WebTransport datagrams for movement (WS fallback);
   - multi-site (Lagos + EU failover);
   - dedicated moderation team plus tooling.

---

## 7. Rough monthly cost estimates (USD)

**Assumptions:**

- Figures are for *peak* CCU, with average concurrency at 50% of peak.
- World stream is 25 kbps down per player, about 4 GB egress per peak-CCU per month.
- 1 vCPU (Go) per about 750 concurrent players, plus 2× headroom.
- 25% of players opt into voice. A voice user listens at about 45 kbps average, about 14.6 GB per concurrent voice user per month.
- Chat averages 0.5 msgs per active player per minute.
- Escalation share for LLM moderation is 1–3%. Claude Haiku costs ≈ $0.0005–0.0008 per escalation (cached ~800-token policy, ~300 tokens context, ~60 tokens output).
- Salaries are excluded, and so are human moderators. Human moderation is the real cost: budget **at least** 1 moderator per ~2–5k peak CCU, in shifts.

### 7.1 Option A (recommended), EU/colo compute + Cloudflare Realtime voice

| Line item | 1k CCU | 10k CCU | 50k CCU |
|---|---|---|---|
| World egress | ~4 TB | ~40 TB | ~200 TB |
| Cell + gateway compute | $100–200 (2–3 servers) | $600–1,200 (~8–12 servers) | $3k–6k (~40–60 servers) |
| Bandwidth (flat-rate EU / colo transit) | ~$0–50 | $100–1,500 | $1k–8k |
| Postgres + Redis + NATS + storage | $50–150 | $300–800 | $1.5k–3k |
| Nakama/Phoenix social services (self-hosted) | incl. above | $200–500 | $1k–2k |
| Cloudflare (Pro/Business; Enterprise likely at 50k) | $25–250 | $250–2k | $2k–5k+ (negotiated) |
| **Voice: Cloudflare Realtime** (1.8 / 18 / 91 TB) | **~$40** | **~$860** | **~$4.5k** |
| Moderation APIs (OpenAI free + Haiku escalations + self-host classifier) | $10–50 | $300–1,000 | $1.5k–5k |
| **Total infra** | **≈ $300–700** | **≈ $3k–7k** | **≈ $15k–35k** |

### 7.2 Sensitivity: same traffic, different hosting / vendors

| Variant | 1k | 10k | 50k |
|---|---|---|---|
| World egress on **AWS af-south-1 at $0.154/GB** (Lagos Local Zone egress likely similar, **verify**) | +$600 | +$6k | +$25–30k (tiered) |
| **Option B:** Cloudflare DO inbound msgs (10 msg/s/player, 50% duty) + duration | ~$100–200 | ~$1k–1.5k | ~$5k–8k (no egress fees; plus Workers Paid plan) |
| Voice via **LiveKit Cloud** (5.4M / 54M / 270M participant-min) | ~$2k | ~$21k | ~$100k+ (negotiate) |
| Voice via **Agora** ($0.59–0.99 per 1k min) | ~$3–5k | ~$32–50k | $160k+ |
| Voice via **self-hosted LiveKit** (EU flat bandwidth; ~190 participants/core) | ~$50 | ~$300–600 | ~$1.5–3k |
| **ToxMod** real-time voice moderation (12–15¢/voice-hour) | ~$9–13k | ~$90–135k | not viable |
| **Photon** CCU pricing for the world sim (if it fit) | $250 | ~$2.5k (2,000-CCU tier = $500, scaled; **verify** enterprise pricing) | custom |
| Claude Haiku on **every** message instead of 1–3% escalations (108M msgs at 10k) | ~$500 | ~$5k+ | ~$25k+ |

**Reading the tables:**

- Bytes on the wire decide the bill. That is the same lever as players' data cost, so binary deltas, AOI and LOD pay twice.
- **Never use per-minute voice vendors for always-on proximity voice.** Price voice per GB (Cloudflare Realtime) or self-host it.
- Voice moderation should be report-driven. Text moderation should be tiered.

---

## 8. Open questions / next research steps

1. Latency/loss probe on MTN, Airtel, Glo and T2 against Lagos Local Zone, Lagos colos, af-south-1 and EU (Section 3.4 action item).
2. Get quotes for **AWS Lagos Local Zone egress** and for **Lagos IP transit per Mbps** (Rack Centre, Layer3, MainOne/Equinix).
3. Check whether Cloudflare's WebSocket proxy suits a sustained ~250 Mbps game stream at 10k CCU on Business vs Enterprise.
4. Build a **500-message labelled Nigerian game-chat eval set** (Pidgin, Yoruba, Igbo, Hausa, code-switched, scams). Score OpenAI moderation, Haiku 4.5 and a fine-tuned AfroXLMR on it before choosing T2.
5. Prototype the Android Chrome Web Audio + WebRTC path on ₦60–90k devices (Tecno Spark, Infinix Hot, itel). Measure CPU, battery and data with 4 audible speakers.
6. Spike WebTransport (`webtransport-go`) vs WS on the same 3G link. Measure the stall rate under 3–5% loss.

---

## Sources

- Colyseus pricing: https://www.colyseus.io/pricing · https://docs.colyseus.io/cloud/pricing-billing
- Heroic Labs / Nakama pricing: https://heroiclabs.com/pricing · https://heroiclabs.com/heroic-cloud/
- Geckos.io: https://github.com/geckosio/geckos.io
- WebTransport Baseline 2026: https://webrtc.ventures/2026/04/webtransport-is-now-baseline-what-it-means-for-real-time-media/ · https://websocket.org/comparisons/webtransport/
- Cloudflare Durable Objects pricing: https://developers.cloudflare.com/durable-objects/platform/pricing · data location/hints: https://developers.cloudflare.com/durable-objects/reference/data-location/
- Cloudflare Realtime SFU/TURN pricing: https://developers.cloudflare.com/realtime/sfu/pricing
- Cloudflare Lagos PoP: https://tech.africa/cloudflare-lagos-nigeria · https://ppc.land/cloudflare-opens-a-new-data-center-in-lagos/
- SpacetimeDB pricing/licence/BitCraft: https://spacetimedb.com/blog/all-new-spacetimedb-pricing · https://spacetimedb.com/pricing
- Hathora wind-down: https://gamesbeat.com/?p=318174 · https://www.techspot.com/news/111969-stormgate-servers-go-dark-following-ai-focused-hosting.html · https://gameye.com/blog/game-server-shake-up-2026
- Rivet: https://www.rivet.dev/docs/actors/http-api · https://rivet.dev/changelog/2024-02-12-usage-pricing-update/
- Photon pricing: https://doc.photonengine.com/photon/current/pricing · https://crux.supercraft.host/blog/photon-fusion-pricing-2026/
- SpatialOS query-based interest patent: https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10579434
- Hytopia SDK: https://app.unpkg.com/hytopia@0.7.1/files/README.md
- Hyperfy: https://github.com/hyperfy-xyz/hyperfy (`.env.example` LiveKit vars) · https://deepwiki.com/hyperfy-xyz/hyperfy
- Mozilla Hubs sunset: https://hubs.mozilla.com/labs/sunset
- Gaffer on Games (state sync, snapshot interpolation): https://gafferongames.com/post/state_synchronization/ · https://gafferongames.com/post/snapshot_interpolation/
- Quake 3 network model: https://fabiensanglard.net/quake3/network.php
- LiveKit benchmark: https://docs.livekit.io/transport/self-hosting/benchmark/ · LiveKit pricing summaries: https://trtc.io/blog/details/livekit-pricing-2026 · https://livekit.com/field-guides/guide/estimating-pricing-video-conference-livestream
- Agora voice pricing: https://www.agora.io/en/pricing/voice-calling
- Dolby.io Communications retirement: https://apis.io/providers/voxeet/
- pma-voice / FiveM Mumble: https://xgamingserver.com/blog/fivem-voice-chat-pma-voice-guide/ · https://github.com/Fox-Lua-Source/pma-voice
- AWS Lagos Local Zone: https://go.aws/3XZcGZn · https://aws-pricing.com/af-south-1-los-1.html · https://www.connectingafrica.com/cloud-networking/lagos-launches-first-aws-local-zone-in-africa
- AWS af-south-1 egress: https://www.stormit.cloud/blog/aws-data-transfer-pricing-how-to-reduce-costs/
- Cloud latency in Africa (UCT): https://pubs.cs.uct.ac.za/id/eprint/1704/
- Nigerian VPS/colo: https://www.lineserve.net/blog/vps-hosting-nigeria · https://www.whtop.com/plans/whogohost.com/132418
- Nigerian data prices 2026: https://www.androidpols.com.ng/2026/01/1gb-data-price-nigeria-2026-updated.html · https://awajis.com/cheapest-data-plans-nigeria/
- OpenAI omni-moderation: https://openai.com/index/upgrading-the-moderation-API-with-our-new-multimodal-moderation-model/
- Perspective API sunset: https://perspectiveapi.com/ · https://perspectiveai.xyz/google-perspective-api-sunset-alternatives-2026/
- AfriHate: https://arxiv.org/abs/2501.08284 · Hausa/Yoruba/Igbo offensive dataset: https://arxiv.org/pdf/2406.02169
- Modulate ToxMod pricing: https://modulate.ai/toxmod-pricing
- Claude Haiku 4.5 pricing ($1/$5 per MTok): Anthropic API model table (claude-api reference, cached 2026-09-25)
