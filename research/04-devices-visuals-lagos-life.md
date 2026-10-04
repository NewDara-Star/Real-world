# 04 — Devices, Visual Direction & Real Lagos Life

Research date: 2026-10-04. Scope: a browser-only, no-download, guest-first open-world social life game set in real Lagos.

> **Method note.** This environment's egress proxy blocked direct page fetches for almost every source (StatCounter, Opensignal, techcabal, web.dev, threejs forum, Wikipedia, etc.). The figures below come from search-engine result extracts of those pages. They are cited, but treat exact numbers as "verify before quoting externally". Anything I estimated myself is marked **[estimate]**.

---

## PART A — Device benchmark

### A1. What Nigerians actually carry

**Brand share (web-traffic based)**

| Source / period | Tecno | Infinix | itel | Samsung | Apple | Xiaomi | Other |
|---|---|---|---|---|---|---|---|
| StatCounter via Intelpoint, Feb 2025 | 23.6% | 21.7% | 5.4% | 12.4% | 9.4% | 7.2% | Huawei 4.3% |
| StatCounter, ~Jun 2026 (search extract) | 17.2% | 15.1% | n/a | 16.3% | 17.2% | 7.8% | "Unknown" 11.7% |

- Transsion (Tecno, Infinix, itel) held about **56% of Nigerian smartphone sales in Q1 2025** and **51% of Africa in Q2 2025** (Canalys). Samsung had 18%, Xiaomi 14%. ([intelpoint](https://intelpoint.co/insights/tecno-has-the-highest-share-among-phone-brands-in-nigeria-at-23-55-as-of-february-2025/), [telecomlead](https://telecomlead.com/latest-news/africa-emerges-as-the-fastest-growing-smartphone-market-in-2025-what-buyers-need-to-know-122255), [intelpoint Africa](https://intelpoint.co/blogs/mobile-phone-market-share-in-africa-by-region/))
- **81% of smartphones shipped in Africa and Nigeria in 2025 cost under $200** (Omdia). Nigeria's market grew 25% in Q4 2025. ([techcabal](https://techcabal.com/2026/02/25/in-2025-four-in-five-smartphones-sold-in-africa-cost-under-200/))
- Smartphone ownership is about 75% (2025, KPMG): **73% urban and 39% rural**. Nigeria had 147.5M mobile internet connections in Dec 2025 (GSMA). ([nairametrics](https://nairametrics.com/2026/09/26/nigerias-smartphone-ownership-rises-to-75-as-digital-use-expands-report/), [techcabal](https://techcabal.com/?p=167676))
- Apple's ~17% traffic share is real and comes mostly from used and imported iPhones (XR, 11, 12). Safari/iOS is a first-class target, not an afterthought.
- Samsung Galaxy A06 (Helio G85) was the **world's #1 4G phone in Q1 2025**, driven by MEA and LatAm. ([Counterpoint](https://www.counterpointresearch.com/insight/global-smartphone-sales-top-10-best-sellers))

**Android versions in Nigeria (StatCounter, mid-2026 extract):** A13 17.7%, A12 16.5%, A11 13.0%, A14 12.4%, A15 11.7%, A10 9.7%. **About 26%+ are on Android ≤11**, which matters for WebGPU (see below). ([statcounter](https://gs.statcounter.com/android-version-market-share/mobile-tablet/nigeria))

**Browsers in Nigeria (mobile+tablet, Jul 2026):** Chrome 64.2%, **Opera 19.9%**, Safari 12.7%, Samsung Internet 1.0%, UC 0.7%. ([statcounter](https://gs.statcounter.com/browser-market-share/mobile-tablet/nigeria))
- About 1 in 5 users are on Opera. Opera for Android is Chromium and supports WebGL. **Opera Mini in "Extreme" savings mode renders on a server and will not run WebGL.** You need detection plus an "Open in Chrome" fallback screen. ([dev.opera.com](https://dev.opera.com/articles/browsers-modes-engines), [Opera help](https://help.opera.com/en/?p=3839))
- **Phoenix Browser** (Transsion) comes pre-installed on Tecno and Infinix phones and has its own data-saver compression. Test it explicitly. ([techradar](https://www.techradar.com/pro/phoenix-browser))
- Chrome version lag: in comparable West African markets, StatCounter shows stale versions such as Chrome 118 at 6–12% share. Ship a transpiled build that targets about **Chrome 100+** and don't rely on bleeding-edge APIs. ([statcounter BF example](https://gs.statcounter.com/browser-version-market-share/android/burkina-faso))

### A2. Named models and their silicon

| Model (2024–26 sellers) | Chipset | GPU | RAM | Screen | Notes |
|---|---|---|---|---|---|
| itel A70 / A80 | Unisoc T603 | PowerVR GE8322 | 3–4 GB | 720p, 60/120 Hz | Absolute floor. A80 ships Android 14 ([gsmarena A80](https://m.gsmarena.com/itel_a80-13343.php), [91mobiles A70](https://www.91mobiles.com/itel-a70-price-in-india?ty=specs)) |
| Redmi A3x | Unisoc T603 | PowerVR GE8322 | 3–4 GB | 720p | Featured in Jumia deals ([smartprix](https://us.smartprix.com/mobiles/samsung_galaxy_a06_vs_xiaomi_redmi_a3x-cpd1bnusdypb_pd17cdt8vml.php)) |
| itel A90 | Unisoc T7100 | (PowerVR-class) | 3–4 GB | 720p | ([91mobiles](https://www.91mobiles.com/compare/POCO/C71/vs/Itel/A90.html)) |
| Infinix Smart 8 | Unisoc T606 | Mali-G57 MP1 | 3–4 GB | 720p 90 Hz | Launched in Nigeria ([mysmartprice](https://www.mysmartprice.com/gear/infinix-smart-8-launched-nigeria-price-specifications/)) |
| Infinix Smart 10 / Tecno Pop 10 | Unisoc T7250 (T615) | Mali-G57 MP1 | 3–6 GB | 720p 120 Hz | ([notebookcheck](https://www.notebookcheck.net/Infinix-Smart-10.1178778.0.html), [mobiledokan](https://www.mobiledokan.com/mobile/tecno-pop-10/specification)) |
| Tecno Spark 30C / Spark 40 | Helio G81 | Mali-G52 MC2 | 4–8 GB* | 720p 120 Hz | *Often "8 GB" = 4 GB + 4 GB virtual ([gsmarena 30C](https://m.gsmarena.com/tecno_spark_30c-13310.php), [gsmarena 40](https://m.gsmarena.com/tecno_spark_40_4g-13984.php)) |
| Samsung Galaxy A06 / A05 | Helio G85 | Mali-G52 MC2 | 4–6 GB | 720p | ([gsmarena](https://m.gsmarena.com/samsung_galaxy_a06-review-2743p4.php)) |
| Redmi 14C | Helio G81-Ultra | Mali-G52 MC2 | 4–8 GB | 720p | |
| Infinix Hot 50 4G / Hot 50 Pro | Helio G100 | Mali-G57 MC2 | 6–8 GB | 1080p 120 Hz | ([gsmarena](https://m.gsmarena.com/infinix_hot_50_4g_unveiled_with_helio_g100_chipset_678_fhd_ips_lcd-news-64728.php)) |
| Samsung A15/A16, Redmi Note 13/14, Tecno Camon 30/40 | Helio G99 / Dimensity 6000-series | Mali-G57 MC2 / G615 | 6–8 GB | 1080p | Upper-mass-market |
| Used iPhone XR / 11 / 12 | A12–A14 | Apple | 3–4 GB | | Strong GPU, Safari memory limits are strict |

**Key takeaways**
- The **Mali-G52 MC2 at 720p with 4 GB RAM** (Helio G81/G85/G88) is the single most common GPU class to design for.
- The **PowerVR GE8322 and Mali-G57 MP1** (Unisoc) are the floor. They are fill-rate-starved, so the floor tier must render below native resolution.
- Most mass-market panels are **720×1600**. Rendering at native 720p with a DPR cap of 1.0 is already the "high-res" option for most players.
- Advertised "8 GB" often includes virtual RAM. Physical RAM is usually 3–4 GB, and Android Chrome will kill a heavy background tab, or even the foreground tab, well before that.

### A3. Graphics API support
- **WebGL 2:** effectively universal on these chipsets. Mali-G52, G57 and PowerVR GE8322 all expose GLES 3.2. Web3DSurvey parameter tables show about 99.9% of Android WebGL2 clients meeting common limits such as MAX_TEXTURE_SIZE 4096. ([web3dsurvey](https://web3dsurvey.com/webgl2/parameters/MAX_TEXTURE_SIZE)) **Baseline = WebGL2, with a WebGL1 fallback not worth the cost.**
- **WebGPU:** Chrome 121 shipped Android WebGPU for **Android 12+ on Qualcomm/ARM GPUs** ([Chrome blog](https://developer.chrome.com/blog/new-in-webgpu-121)). Secondary sources claim about 70–78% coverage of Chrome Android users globally in 2026, and Chrome 146 reportedly added a "compatibility mode" on GLES 3.1 to widen reach ([cinevva](https://app.cinevva.com/news/2026-03-10-chrome-146-webgpu-compatibility), [enterno](https://enterno.io/en/s/research-webgpu-adoption-browsers-2026), all unverified). In Nigeria, about 26% of devices are Android ≤11, PowerVR on Unisoc is uncertain, and Opera Mini and Phoenix are unknowns. **Conclusion: WebGPU is an optional enhancement path only; ship on WebGL2.** Three.js `WebGPURenderer` with WebGL2 fallback, or Babylon/PlayCanvas, makes this cheap.
- iOS Safari supports WebGL2. WebGPU arrived in Safari 26 (2025), but iOS tabs get killed quickly above a few hundred MB.

### A4. Network and data cost
- **Price:** the NCC approved a 50% tariff increase in Jan 2025. MTN 1 GB went from ₦200 to ₦350, Airtel from ₦350 to ₦500, Glo to ₦750 (1.1 GB). **The average realized price in 2025 was ₦575/GB (about $0.38–0.42).** Nigerians spent about ₦20.9B per day on data in 2025. ([techcabal](https://techcabal.com/2026/02/09/how-nigerians-spent-%E2%82%A620-87billion-daily-on-data-in-2025/), [thecondia](https://thecondia.com/mtn-nigeria-data-price-hike-2025/))
- **Speed:** Ookla's median mobile download was 18.9 Mbps in early 2025 and **44.1 Mbps by Dec 2025** (Nigeria ranked 85th). Opensignal (Apr–Jun 2025) puts MTN download experience at about **20 Mbps**, Airtel about 15, Glo about 10, with MTN 4G availability at 95%. Opensignal also reports congestion-driven 4G slowness. ([BusinessDay](https://businessday.ng/technology/article/nigeria-slips-to-85th-in-global-internet-speed-rankings-as-peers-pull-ahead/), [Opensignal](https://insights.opensignal.com/reports/2025/07/nigeria/mobile-network-experience), [Guardian](https://guardian.ng/technology/congestion-slows-4g-user-experience-in-nigeria-others/))
- **Design implication:** plan for a realistic p25 user at **3–5 Mbps with 150–300 ms RTT and frequent drops**. At 4 Mbps, 6 MB takes about 12 s. Users also notice "data finishing fast" (MTN complaint coverage), so show an in-game data meter as a trust feature.
- **Cost of play [estimate]:** at ₦575/GB, 15 MB/hour costs about ₦9/hour, and a 25 MB first load costs about ₦14. That is affordable, but advertise it: "Plays on less than 20 MB per hour."

### A5. Real engine performance reports on Mali-G52-class hardware
Hard public benchmarks for three.js, Babylon or PlayCanvas on Mali-G52 are scarce. Here is what exists:
- Three.js community threads ("Why android device is not good for webgl", "WebGL performance in all devices") consistently report that cheap Android GPUs collapse on **fill rate** (full-DPR canvases, transparency, post-processing, real-time shadows) rather than on triangles. The standard fixes are `setPixelRatio(1)` or lower, no shadow maps, no MSAA, and no post-processing. ([threejs forum 1](https://discourse.threejs.org/t/why-android-device-is-not-good-for-webgl/20878), [threejs forum 2](https://discourse.threejs.org/t/webgl-performance-in-all-devices/22234))
- Mobile-fallback guidance lists the **Mali-G52 as a known weak WebGL chipset** and proposes about **≤50 draw calls and ≤100k triangles on mobile**, a locked 30 fps, and tiered capability detection (full, reduced, minimal, static). ([skills.sh three-mobile-fallback](https://www.skills.sh/avnehsbhatia/ultraui/three-mobile-fallback-strategy))
- For Babylon on mobile, `engine.setHardwareScalingLevel(2)` cuts pixel count to 25%, and the Scene Optimizer handles adaptive quality. Babylon defaults to `powerPreference: high-performance`, which iOS punishes. ([Babylon forum](https://forum.babylonjs.com/t/reducing-memory-consumption-in-babylonjs-apps/53242), [abratabia](https://abratabia.com/babylonjs/mobile-browser.php))
- PlayCanvas recommends batch groups, static batching, compressed textures and lightmaps. It is the engine historically tuned hardest for low-end mobile web. ([PlayCanvas guidelines](https://developer.playcanvas.com/user-manual/optimization/guidelines/))
- **Slow Roads** (a procedural browser driving game) is the reference for streamed open-world rendering in a browser. Its web.dev case study covers adaptive resolution, chunked terrain, fog-limited view distance and GPU tiering. ([web.dev](https://web.dev/case-studies/slow-roads))
- **Proof of market:** Lagos Run (three-lane danfo browser game) reached about 90k players in 5 days. Lagos Life passed 100k users. Lightweight browser games clearly run on the Nigerian device base. The open question is how much 3D you can afford.

**Action:** run your own benchmark scene in week 1 on a **Tecno Spark 30C/40 and an itel A70/A80**, bought locally. Measure frame time at 0.75 and 1.0 render scale with 50, 100 and 150 draw calls, and 100k and 200k triangles.

### A6. Proposed benchmark tiers and budgets

Budgets are **[estimates]** derived from the sources above plus standard mobile practice. Validate them on hardware.

| Budget | **LOW / floor** | **TARGET (design to this)** | **HIGH** |
|---|---|---|---|
| Reference phones | itel A70/A80, Redmi A3x, Infinix Smart 8/10, Tecno Pop 10 | Tecno Spark 30C/40, Samsung A06/A05, Redmi 14C, Infinix Hot 40i | Infinix Hot 50/Pro, Samsung A15/A16, Redmi Note 13/14, Tecno Camon 30, iPhone XR–12 |
| GPU class | PowerVR GE8322 / Mali-G57 MP1 | Mali-G52 MC2 | Mali-G57 MC2 / G615 / Apple A12+ |
| Physical RAM | 3 GB | 4 GB | 6–8 GB |
| Render resolution | 0.6–0.7 × 720p (about 480p internal), DPR capped at 1 | 0.85–1.0 × 720p | Native up to 1080p, DPR ≤1.5 |
| Target FPS | 30 locked (accept 25 in crowds) | 30 locked, 60 in menus | 60 (30 fallback) |
| **Initial download to first playable** | ≤ 5 MB (JS ≤ 1.5 MB gz plus starter district) | ≤ 8 MB | ≤ 12 MB |
| First session total (streamed) | ≤ 20 MB | ≤ 35 MB | ≤ 60 MB |
| Total tab memory (JS heap + GPU) | ≤ 300 MB | ≤ 450 MB | ≤ 700 MB (≤ 400 MB on iOS) |
| JS heap | ≤ 80 MB | ≤ 120 MB | ≤ 200 MB |
| Draw calls per frame | ≤ 50 | ≤ 100 | ≤ 200 |
| Triangles on screen | ≤ 60k | ≤ 150k | ≤ 400k |
| Texture memory (GPU) | ≤ 24 MB | ≤ 64 MB | ≤ 128 MB |
| Visible characters (NPC + players) | ≤ 15 full plus impostor crowd | ≤ 30 full | ≤ 60 full |
| Shadows | Blob decals only | Blob, plus baked AO | One real-time cascade near player |
| Post-FX | None | Tonemap and color grade in the main pass only | Bloom (half-res), FXAA |
| View distance (fog) | 120 m plus skyline impostor | 250 m | 500 m |
| **Networking** | ≤ 8 MB/hour | ≤ 15 MB/hour | ≤ 25 MB/hour |

**Networking math [estimate]:** about 10 Hz snapshots, with area-of-interest limited to about 20 visible players at around 10 bytes each after quantized delta compression, plus about 40 bytes of header. That is about 2.4 KB/s down, or roughly 9 MB per hour, plus about 1 MB per hour up. Reference points: PUBG uses about 80 MB/hour and Fortnite about 100 MB/hour ([gamingscan](https://www.gamingscan.com/how-much-data-does-online-gaming-use/)), so 15 MB/hour is a credible marketing claim. Techniques: delta compression, interest management, distance-based update rates, binary protocol (no JSON), and WebSocket permessage-deflate off for small binary frames. ([bugnet](https://bugnet.io/blog/how-to-reduce-bandwidth-in-a-multiplayer-game))

**Engineering rules that fall out of this**
1. Pick the quality tier at boot: read `WEBGL_debug_renderer_info` (renderer string such as "Mali-G52"), `navigator.deviceMemory` (Chrome) and `hardwareConcurrency`, then run a 2-second micro-benchmark. Keep an adaptive resolution scaler running continuously.
2. Use KTX2/Basis **ETC1S** for colour textures (UASTC costs 8–16 bytes per texel of VRAM) and **meshopt** for geometry (fast decode). Never apply both Draco and meshopt to the same asset. ([hontran](https://www.hontran.dev/blog/three-js-performance-optimization))
3. Use InstancedMesh and BatchedMesh for props, cars, danfos and buildings. Merge static city chunks per material.
4. Use a service worker with cache-first for assets, since repeat sessions should cost about 0 MB. Version assets by content hash.
5. Detect Opera Mini and blocked WebGL, and show a lightweight 2D fallback or an "Open in Chrome" deep link.
6. Handle `webglcontextlost` gracefully by auto-restoring. Low-RAM Androids lose contexts on app-switch, for example to answer a WhatsApp message.

---

## PART B — Visual direction that looks great and runs on a Mali-G52

### B1. Survey of relevant styles

| Reference | Look | Why it is cheap | Lesson for us |
|---|---|---|---|
| **Kenney** city kits ([City Kit Suburban](https://opengameart.org/content/city-kit-suburban), [Commercial](https://opengameart.org/content/city-kit-commercial)) | Clean low-poly, flat colours, CC0 | Tiny meshes, palette textures, glTF ready | Great for prototyping and placeholders |
| **Synty POLYGON** ([City](https://syntystore.com/products/polygon-city-pack), [Town](https://syntystore.com/products/polygon-town-pack), [Construction](https://syntystore.com/products/polygon-construction-pack)) | Chunky low-poly with a single shared **colour atlas texture** | One material for nearly everything, so batching is easy | The "atlas palette" workflow is the industry standard. Licence terms need checking for web redistribution |
| **Crossy Road** | Voxel, saturated, toy-like | Very few verts, no textures, simple lights. "Runs on almost any smart device" ([games.gg](https://games.gg/crossy-road/)) | Readable silhouettes beat detail on 720p screens |
| **Townscaper** ([wiki](https://en.wikipedia.org/wiki/Townscaper)) | Muted watercolour palette, procedural architecture | Procedural modules plus soft lighting | Procedural Lagos building "kits" (face-me-I-face-you, duplexes, high-rises) from modules |
| **Monument Valley** | Flat pastel, light side vs. dark side | Shading by face direction (3–6 fixed colours), Y-gradient, no real lights ([shader breakdown](https://visionvortex.artstation.com/blog/zDar/monument-valley-shader-for-unity-3d)) | A "directional flat" shader is nearly free and looks designed |
| **Bruno Simon portfolio** | Toy diorama, matcaps, baked shading | **No lights in the scene. Matcaps and baked textures** ([interview](https://www.mux.com/blog/3d-web-development-and-beyond-a-chat-with-bruno-simon)) | Baked lighting is the best quality-per-millisecond on the web ([svilenkovic bake guide](https://svilenkovic.com/3d/how-to-bake-lighting-for-web), [mesh-baked-material](https://npmjs.com/package/mesh-baked-material)) |
| **Slow Roads** ([web.dev](https://web.dev/case-studies/slow-roads)) | Atmospheric, fog and sky-driven | Fog hides streaming, LOD and adaptive resolution | Use atmosphere (haze, rain) as both art and optimization |
| **Animal Crossing / Roblox** | Toon, soft, avatar-first | Simple materials. Roblox scales down to very low-end phones | Players forgive simple worlds if avatars and clothing are expressive. Owambe fashion is our avatar hook |
| **Lagos Life** (competitor) | Reported as an **illustrated 2D map** with venues | Effectively free to render | Our differentiator is a walkable, drivable 3D Lagos that still loads instantly |

### B2. Technique toolbox
- **Palette or gradient-atlas texturing:** UV every face into a tiny palette texture (for example 256×256), giving one material, one draw call per merged chunk and almost no VRAM. Tools: PaletteGrid (Blender), Dynamic Color Palette. ([PaletteGrid](https://superhivemarket.com/products/palettegrid), [itch](https://fwdotcom.itch.io/dynamic-color-palette), [Unity thread](https://discussions.unity.com/t/using-one-material-for-nearly-the-whole-world/682877))
- **Vertex colours:** bake AO and a gradient into vertex colours with no texture fetch at all. This suits the floor tier.
- **Baked lighting:** per-district lightmap atlases (ETC1S), or AO only in vertex colours. Handle day and night by blending two bakes, or by tinting with a sun/ambient uniform.
- **Fake shadows:** blob-shadow decals under people, cars and danfos, and baked contact shadows under buildings.
- **Fog:** exponential fog coloured per time of day and season. **Harmattan haze (Dec–Feb) and rainy-season murk become a Lagos signature and a draw-distance limiter at the same time.**
- **Impostors and billboards:** distant skyline (Eko Atlantic towers, Lekki-Ikoyi Link Bridge, Third Mainland) as camera-facing cards, plus crowd impostors at markets.
- **Instancing:** danfos, kekes, okadas, palm trees, street lights, kiosks, umbrellas, generators and canopy tents. ([three.js best-practice summaries](https://skills.sh/oakoss/agent-skills/threejs))
- **HLOD per city block:** near uses full modules, mid uses one merged mesh, far uses one impostor card.
- **Texture strategy:** one shared palette atlas, plus a few "signage" atlases for Lagos text: bus-stop names, church banners, "This house is not for sale", "Pure water", POS umbrellas.

### B3. Three recommended directions

**Direction 1 — "Gidi Flat" (low-poly palette toon). RECOMMENDED BASE**
- Look: Synty/Kenney-style chunky low-poly. A saturated Lagos palette (danfo yellow #F7C600 with black stripes, BRT blue, POS-umbrella MTN yellow / Moniepoint blue, ankara patterns as small decals) under a Monument-Valley-style directional-flat shader with vertex-colour AO and blob shadows.
- Pros: cheapest option. Hits the floor tier. Easy to build with modular kits and outsourcing. Lagos signage and colour carry the identity. Instancing-friendly.
- Cons: can look generic or "asset store" if signage, props and people are not specific. Needs a strong art director.
- Refs: Synty POLYGON City, Kenney City Kits, Crossy Road, Monument Valley shader.

**Direction 2 — "Toy Lagos Diorama" (baked/matcap, Bruno Simon and Townscaper inspired)**
- Look: miniature-city feel with soft baked AO and bounce light, rounded forms, slightly exaggerated proportions (tall thin buildings, oversized danfos) and a watercolour palette. Very shareable on TikTok and Instagram.
- Pros: the most beautiful per millisecond. Distinctive. Screenshots double as marketing. Matcaps are nearly free.
- Cons: needs a bake pipeline. Lightmap textures add download size (each district adds roughly 0.5–1 MB in ETC1S). Dynamic day/night is harder. Weaker for "real" city scale.
- Use it for hero districts (Lagos Island, Yaba, Lekki Phase 1) and interiors (owambe hall, viewing centre).

**Direction 3 — "Harmattan Haze" (atmospheric gradient, Slow Roads inspired)**
- Look: simple geometry carried by **sky gradients, fog and colour grading**: dusty orange harmattan mornings, purple-grey rainy-season storms, sodium-orange nights with generator glow, and a golden-hour Third Mainland skyline. Silhouettes and impostors do the heavy lifting.
- Pros: makes very low-poly geometry feel cinematic. Fog limits draw distance, so it is a performance feature too. Time and season become gameplay (rain floods, NEPA cuts).
- Cons: fog-heavy scenes can feel samey. Needs careful UI contrast. Fewer "detail" moments.

**Recommendation:** use **Direction 1 as the production base, layer Direction 3's atmosphere system on every tier, and apply Direction 2's bakes only to hero zones and interiors on the target and high tiers.** That gives one art kit with three scalability levers.

---

## PART C — Real Lagos life (design research)

### C1. Transport
- **Danfo:** yellow minibuses with black stripes. A conductor (often hanging out of the door) shouts clipped bus-stop names: "Shodi! Shodi!" (Oshodi), "Obalende! Obalende! Wole pelu change e!" ("Enter with your change!"). Conductor language is studied academically as its own register ("Carry go"). It deletes syllables and stretches vowels. ([UNILAG study](https://ir.unilag.edu.ng/handle/123456789/3065), [Arbitrer paper](https://arbitrer.fib.unand.ac.id/index.php/arbitrer/article/view/272), [Kolawole](https://michaelkolawole.substack.com/p/the-prehensile-and-mind-reading-skills)) Other common lines: "Owa o!" (passenger: "I'm getting down here!"), "Wait first!", "Hold your change," "Enter with change," "Shift!", "Conductor, my change!", "Na four-four for back seat."
  - The state has repeatedly announced plans to replace old danfos with new, regulated buses over 2–5 years, and drivers fear bans. ([techeconomy](https://www.techeconomy.ng/lagos-to-scrap-old-danfo-buses-private-vehicles-in-next-5-years), [Guardian](https://guardian.ng/news/fear-grips-danfo-drivers-ahead-of-proposed-ban/)) This is a good tension for the story.
- **Agberos / NURTW:** touts in union colours collect "tickets" from every danfo, keke and okada. Drivers reportedly pay about ₦3,000 a day, and there is a state "consolidated" ₦800 daily levy collected via touts. MC Oluomo chairs the Parks Management Committee. Drivers have struck over extortion. ([Guardian](https://guardian.ng/news/nigeria/touts-untamed-monsters-that-rule-lagos-roads/), [ICIR](https://www.icirnigeria.org/nurtw-mc-oluomo-dares-lagos-govt-national-body-as-icir-report-stirs-reawakening-part-1/), [Global Voices](https://globalvoices.org/2022/07/18/nigerias-lagos-gangs-terrorize-citizens-extort-transport-workers-and-wreak-havoc/))
- **Okada ban:** banned from June 2022 in Eti-Osa, Ikeja, Surulere, Lagos Island, Lagos Mainland and Apapa. Extended from Sept 2022 to Kosofe, Oshodi-Isolo, Somolu and Mushin plus several LCDAs. Keke are restricted on highways under the 2018 Transport Sector Reform Law. Bike-hailing (Gokada, ORide, OPay) was shut down in 2020. ([ICIR](https://www.icirnigeria.org/lagos-state-government-extends-okada-ban-to-four-lgas-five-lcdas/), [Channels](https://www.channelstv.com/2022/05/20/law-that-bans-okada-also-bans-keke-lagos-threatens-full-enforcement/)) In practice okadas still run in back streets and the outskirts, which is good chase and risk gameplay.
- **BRT** (blue and red buses, dedicated lanes), **Blue Line rail** (Marina to Mile 2, 5 stations, about 13 km, ₦750 end to end with 25% off-peak discount) and **Red Line** (Agbado to Oyingbo via Ikeja, Oshodi, Mushin and Yaba, ₦500–1,000 by zone). All use the **Cowry card** tap-in/tap-out system. ([bento.travel](https://www.bento.travel/nigeria/transit))
- **Ferries (LAGFERRY):** Ikorodu to Falomo, Ikorodu to Ebute Ero and Marina (CMS). Boats from Marina or Tarzan jetty to **Tarkwa Bay** cost roughly ₦3–10k. ([Guardian](https://guardian.ng/?p=1110206))
- **Go-slow:** on Third Mainland Bridge, island-bound traffic crawls from about 7am (build-up from 4am). The evening peak runs 4–8pm the other way. ([BusinessDay](https://businessday.ng/transport/article/third-mainland-bridge-closure-spreads-traffic-gridlock-on-lagos-roads/)) Hawkers work the traffic, selling pure water, gala, plantain chips, phone chargers and newspapers.
- **LASTMA** (traffic officers in maroon and yellow): offences include one-way driving, BRT-lane use, illegal parking, seatbelts and dropping passengers at undesignated stops. The minimum fine is reportedly ₦20k, and 38k offences were recorded in 3 months of 2026. ([SaharaReporters](https://saharareporters.com/2026/07/13/lastma-says-agency-recorded-38000-traffic-offences-lagos-three-months), [LAMATA BRT regs](https://www.lamata-ng.com/wp-content/uploads/2019/09/BRT-REGULATIONS.pdf))
- **Ride-hailing:** Uber, Bolt and inDrive. Drivers strike over 20–30% commissions and fuel costs, and CNG conversion is a hot topic. ([TheCable](https://thecable.ng/were-struggling-to-survive-bolt-uber-drivers-begin-strike-over-low-fares-25-commission-rate), [techpoint](https://techpoint.africa/guide/nigeria-petrol-tax-ride-hailing-drivers/))

### C2. Work and hustle
- **Computer Village (Ikeja):** West Africa's phone and electronics market, with repairers, "UK-used" sellers, screen fixers and accessory hawkers. Relocation to the Katangowa ICT park has been announced for a phased 2025–26 move, after 15+ years of stalled plans. ([techeconomy](https://techeconomy.ng/computer-village-relocation-ikeja-katangowa-ict-park), [Radio Nigeria](https://radionigerialagos.gov.ng/?p=30845))
- **Balogun / Idumota (Lagos Island):** fabrics (ankara, lace, aso-oke), gele, ready-mades and tailors in one of West Africa's largest market clusters. The atmosphere is a "cacophony of hawkers' cries, horns, diesel". **Tejuosho (Yaba)** is a multi-level, more organised market. **Mile 12** is the foodstuff hub. ([DiscoverLagos](https://www.discoverlagos.ng/post/balogun-market-the-heartbeat-of-lagos-commerce), [Daily Trust](https://dailytrust.com/inside-lagos-markets/))
- **POS agents:** umbrella stands in front of banks and on every street. Fees run ₦100–200 per ₦5k and up to ₦3k per ₦100k. Cash scarcity and empty ATMs are common. ([techcabal](https://techcabal.com/2025/01/08/how-much-nigerians-pay-pos-agents/), [techpoint](https://techpoint.africa/insight/pos-withdrawal-charges-rise-as-agents-lament-cash-scarcity-and-rising-costs/))
- **Yaba ("Yabacon Valley"):** CcHub, UNILAG, Yaba Tech, laptops at cafés. Many startups have moved to Lekki and VI. ([techpoint](https://techpoint.africa/insight/future-yabacon-valley/), [BusinessDay](https://businessday.ng/technology/article/why-yaba-struggles-to-be-nigerias-tech-valley/))
- Other hustles: site work (labourers, "bricklayer and mason," cement trucks), tailors, barbers and salons, okada and keke riders, Uber/Bolt drivers, food vendors, pure-water sellers, generator repairmen ("Gen man"), vulcanizers, and "aboki" kiosk owners selling everything at 2am.

### C3. Social life
- **Owambe:** Yoruba party culture with **aso ebi** (matching fabric for guests), gele, live bands or DJ, jollof, small chops, souvenirs, MCs hyping people, and **spraying money** on dancers. Spraying is technically illegal under CBN Act s.21(3), with up to 5 years for "spraying, dancing or matching on" naira. People do it anyway, and "money doublers" hand out mint notes. ([Leadership](https://leadership.ng/398076-2/), [BusinessDay](https://businessday.ng/news/article/new-naira-notes-scarce-in-banks-abundant-at-parties/)) **Game note:** use a fictional "party currency," dollars, or tokens to avoid modelling an illegal act literally. It can also be satire: a "CBN raid" mini-event.
- **Detty December:** IJGBs ("I Just Got Back" diaspora returnees), Flytime Fest (Eko Convention Centre; Flavour, Olamide, Asake, Davido on Dec 22–25, 2025), Rhythm Unplugged (Rema), a 96-hour AfroXela DJ marathon at Nautica Beach, Eko Fiesta at Muri Okunola Park, beach raves and rooftop fairs. It reportedly brings in $71M+ in ticket economy. ([notjustok](https://notjustok.com/article/detty-december-2025-all-events-fans-shouldnt-miss-in-lagos/), [BusinessDay](https://businessday.ng/bd-weekender/article/20-events-that-will-make-your-detty-december-in-lagos-absolutely-unforgettable/))
- **New Afrika Shrine (Ikeja) and Felabration** (mid-October; 2025 theme "SHAKARA"; Femi Kuti and Made Kuti; 2026 edition Oct 12–18). ([BD Africa](https://www.businessdailyafrica.com/bd/lifestyle/music/fela-kuti-s-spirit-lives-on-as-felabration-thrills-lagos-5241788), [Rio Times](https://www.riotimesonline.com/felabration-lagos-new-afrika-shrine-october-12-18-2026/))
- **Beaches:** Elegushi (gate about ₦2–3k; sleepy in the day, a rave at night and on weekends with suya, drinks and dancing) and **Tarkwa Bay** (boat from Marina or Tarzan jetty, huts for rent). ([afktravel](https://afktravel.com/57265/guide-beaches-of-lagos/), [Ikeja Record](https://ikejarecord.com/discover-tarkwa-bay-cheapest-beach-in-lagos/))
- **Viewing centres:** more than 3,000 registered in Lagos, with 50–100 patrons each. Entry is about ₦100–300 per match (more after subsidy removal) or a flat rate for a three-game Saturday, run on generator plus DStv. The atmosphere is stadium-like banter and heated analysis, and the World Cup drives huge spikes. ([OkayAfrica](https://www.okayafrica.com/nigerias-viewing-centers-are-the-countrys-most-alive-social-spaces/1434018), [Nairametrics](https://nairametrics.com/2021/04/18/the-football-viewing-centre-experience/))
- **Church and mosque:** all-night vigils and crusades (Redemption Camp traffic on the Lagos–Ibadan Expressway), Sunday-best fashion, Friday Jumat, Ramadan iftar, and Eid ram markets.
- **Food:** mama put and **bukas** (amala with ewedu and gbegiri, "abula", from about ₦1–3k depending on protein at places like Iya Moria), Amala Shitta, suya spots at night, boli and groundnut, puff-puff, agege bread with ewa agoyin, and roadside corn and pear (ube) in the rainy season. ([Guardian bukkas](https://guardian.ng/life/travel-and-places/seven-popular-bukkas-in-lagos/), [BusinessDay mama put](https://businessday.ng/bd-weekender/culinary-delights-bd-weekender/article/mama-put-chef-of-the-people/))

### C4. City realities (systems material)
- **NEPA / "light":** Band A promises 20+ hours of supply but only about 40% of Band A customers get it (NERC Q2 2025). Tariffs are about ₦160–209/kWh. Every street has generator hum ("I better pass my neighbour"), and solar is rising. Petrol costs about ₦1,400–1,530 per litre (2026). ([AllAfrica](https://allafrica.com/stories/202507220089.html), [Nairametrics](https://nm-stag.nairametrics.com/petrol-price-jumps-19-to-n1533-litre-in-april-nbs/)) A neighbourhood shout of **"UP NEPA!" when power returns** is a must-have audio event.
- **Flooding:** the rainy season runs April–October (2025 ran long). Lekki, VI, Ikoyi, Ajegunle, Surulere and Alimosho flood, and cars get submerged. ([TheCable](https://thecable.ng/lagos-issues-excess-rainfall-alert-warns-of-possible-flooding), [Guardian](https://guardian.ng/news/fg-predicts-five-day-heavy-rainfall-flooding-in-14-states/))
- **Rent and agents:** landlords historically demand 1–2 years upfront, with agent fees of 10%+, legal fees, caution fees and "inspection fees." The **Lagos Tenancy Bill 2025** proposes a 5% agent-fee cap, a 1-year advance cap for new tenants, LASRERA registration, and fines up to ₦1M or 2 years in prison for agents who overcharge. ([Leadership](https://leadership.ng/lagos-caps-commission-at-5-in-new-tenancy-bill-to-rein-in-estate-agents/), [Guardian](https://guardian.ng/features/how-agents-shut-young-people-out-of-affordable-housing-in-lagos-with-illegal-commissions/))
- **Area boys / agberos / "owo ise":** demands for "settlement" at construction sites (omo onile, "land owners' children") and at parties. Handle it as social-pressure gameplay, not glorified crime.
- **Japa:** emigration wave. "Japa" entered the Oxford English Dictionary alongside "agbero," "419" and "eba." ([Prime Business](https://www.primebusiness.africa/?p=203716)) Friends leaving makes good narrative and system material (NPC farewells, an airport send-off).

### C5. Language and slang (for UI, barks and radio)
Sources: [Zikoko 2025 slang guide](https://www.zikoko.com/pop/nigerian-slangs-their-meaning-2025/), [DiscoverLagos](https://www.discoverlagos.ng/post/the-language-of-lagos-understanding-pidgin-slang-and-the-local-lexicon), [Vanguard](https://www.vanguardngr.com/2016/08/5-slangs-make-confirmed-lagosian/amp/)
- Greetings and fillers: *How far?*, *Wetin dey?*, *I dey o*, *Omo!*, *Abeg*, *Ehn*, *Ah ahn!*, *Na wa o*, *Shey you dey alright?*
- Money: *Sapa* (broke), *Wetin be the last price?*, *Drop something* (pay up), *Shishi* (nothing), *Ego*, *Mint*, *Settle me*, *Find me something*, *Kpali* (job or certificate).
- Vibes: *E choke*, *Gbas gbos*, *Wahala*, *No wahala*, *Japa*, *Gbe body e*, *Soft life*, *Odogwu*, *Big man*, *Shayo*, *Owambe*, *Ajebo* vs *Ajepako*.
- Transport: *Owa o!* (my stop), *Wole!* (enter), *Change dey?*, *O ya, shift!*, *Driver, abeg slow down*, *Na one chance* (fake bus robbery; usable as a safety-warning mechanic).
- Yoruba-inflected: *E kaaro* (good morning), *E ku ise* (well done at work), *Mo gbo* (I heard), *Oya!*

### C6. Music and radio
- Afrobeats (Davido, Wizkid, Burna Boy, Rema, Tems), **street-pop / street-hop** (Asake, Seyi Vibez, Shallipopi, Olamide, Bella Shmurda), **amapiano log drums** layered onto Afro drums, plus fuji, apala and Benin highlife influences. ([Afrocritik](https://afrocritik.com/10-artistes-expanding-the-soundscape-of-street-pop-in-nigeria-today/), [Mixmag](https://mixmag.net/feature/new-age-of-nigeria-electronic-dance-pop-afropop-music-lagos), [Native](https://thenativemag.com/asake-seyi-vibez-rivalry/))
- Real stations to riff on (using fictionalized names): **Wazobia FM 95.1** (first pidgin station), Cool FM 96.9, The Beat 99.9, **Lagos Traffic Radio 96.1** (traffic reports). ([Wikipedia](https://en.wikipedia.org/wiki/List_of_radio_stations_in_Lagos))
- Licensing: commission indie Lagos producers and run an in-game "upload your beat" contest. Never stream unlicensed hits.

### C7. Seasons and events (live-ops calendar)
| When | Event | Game use |
|---|---|---|
| Jan–Feb | Harmattan haze | Fog palette, dusty sky |
| Easter | **Fanti Carnival**, Lagos Island (Afro-Brazilian; roots in 1890; parade Old Defence Rd to JK Randle Centre) ([Native](https://thenativemag.com/fanti-carnival-returns-to-lagos-this-easter-with-a-vibrant-celebration-of-afro-brazilian-culture/), [Channels](https://www.channelstv.com/2026/04/06/fanti-festival-paints-lagos-in-vibrant-colours/)) | Costume parade event |
| Apr–Oct | Rainy season, floods | Dynamic floods, canoe shortcuts, umbrella hawkers |
| Ramadan / Eid | Iftar, ram markets | Ram-delivery job |
| Mid-Oct | Felabration at the Shrine | Concert night, saxophone busker |
| Dec | Detty December: Flytime, Rhythm Unplugged, beach raves, IJGBs, Eko Fiesta | Season pass, concert venues, price surge |
| Occasional (last: Dec 27, 2025) | **Eyo Festival**: white-robed masquerades on Lagos Island. **No shoes, no headwear or umbrellas, no smoking, no "suku" hairstyle.** ([BellaNaija](https://www.bellanaija.com/2025/12/eyo-festival-2025-guide-lagos/), [Guardian](https://guardian.ng/life/culture-lifestyle/eyo-festival-what-the-colours-mean-and-how-to-behave/)) | Rare event. Rules enforced as gameplay (remove your footwear, or Eyo staffs tap you). **Consult Isale Eko custodians before depicting it** |
| Christmas | Owambe peak, church services, travelling "to the village" (empty-Lagos week) | Quiet-city mode |

### C8. Competitors and how to differentiate

| Product | What it does (as reported) | Gap we exploit |
|---|---|---|
| **Lagos Life** (Shalom Rayhamen; Sims-3-inspired; 100k+ users) | Browser social sim on an **illustrated map**: homes, jobs, money, relationships, private chat. Venues include Amala Shitta, CcHub, i-Fitness, The Palms, General Hospital, Mama Bisi's Salon, beach and nightlife. The brief also mentions Quilox and governor elections. ([isakaba](https://www.isakaba.com/lagos-life-crosses-100-000-users/), [site](https://lagoslife.eliysites.com/)) | No real-time 3D movement or driving. Our hook is "actually ride the danfo to the party" plus shared live spaces |
| **Lagos Run** (Opeyemi Adeniran, Berlin; about 90k players in 5 days, Sept 2026) | Swipe-steer danfo runner on Ojuelegba to Yaba routes. Load passengers, dodge okadas, upgrades, in-game radio, leaderboard, no login. ([techcabal](https://techcabal.com/2026/09/29/how-a-berlin-based-developer-turned-lagos-traffic-into-a-viral-game/), [technext](https://technext24.com/reviews/lagos-run-danfo-game-review-nigeria/)) | Single-player arcade. We make danfo driving a **job inside a persistent social city** with real passengers (other players) |
| **Surviving Nigeria** (Koha; gta.koha.wtf) | GTA-style browser game: drive, shoot, steal cars. "Divide the National Cake" means collect 7 Ghana-Must-Go bags to become **Big Man**, then others hunt your bounty. Has free roam, a **protest mode**, and AI NPCs ("JEV" model). ([isakaba](https://www.isakaba.com/surviving-nigeria-is-a-gta-style-game-set-in-lagos/), [site](https://gta.koha.wtf/)) | Violence-centred. We are **non-violent social life**: status through hustle, style and community, not guns |
| **Lagos Tycoon** (per brief) | Land, rent, markets, "barons" economy | I couldn't find public coverage. Related products: **Landlord Go** (AR real-property trading; about 13.6k Lagos players) and CcHub's old **Street Tinz** (₦50k startup sim). ([ITEdge](https://www.itedgenews.africa/new-augmented-reality-game-lets-players-buy-and-sell-real-world-properties/), [techcabal](https://techcabal.com/2015/01/22/co-creation-hub-releases-role-playing-game-street-tinz/)) We keep property light (rent a room, then upgrade) and make it social |
| Older: Danfo Reloaded, Gidi Run (bribe-the-cop runner) | Mobile 2D/3D runners ([techpoint](https://techpoint.africa/2015/11/10/4-nigerian-made-apps-to-keep-you-company-in-lagos-traffic/)) | — |

**Positioning:** "The only place you can live a full Lagos day with other real people, in 3D, on a ₦90k phone, for less than ₦10 of data an hour."

### C9. About 30 missions, activities and side-jobs

**Solo hustles (repeatable jobs)**
1. **Danfo Conductor:** hang from the door and shout the route correctly ("Shodi! Shodi!"). Collect fares, give the right change under time pressure, handle the "my change!" dispute. Rhythm and memory mini-game.
2. **Danfo Driver shift (Ojuelegba to CMS):** pay the agbero ticket or negotiate it, avoid the BRT lane (LASTMA), maximize passengers before the go-slow.
3. **Keke route outside the ban zones:** the map shows restricted LGAs, with a risk/reward choice to take shortcuts.
4. **Okada "one more drop":** back-street deliveries with impound risk in banned LGAs.
5. **Computer Village repair:** a phone-screen-swap puzzle, haggling with buyers over "UK-used" goods, spotting fakes.
6. **POS Agent:** set up an umbrella stand, manage float during cash scarcity, set your fee, handle "failed transaction but debited" customers.
7. **Balogun fabric runner:** fetch the exact aso-ebi shade for a client across crowded stalls. Weave and route through crowds.
8. **Bolt/Uber driver:** pick up players and NPCs, rate and be rated, with fuel-price surges and a CNG conversion upgrade.
9. **Gen Man:** fix generators around the street during a NEPA outage. A diagnostics mini-game, and you earn a reputation.
10. **Mama Put kitchen rush:** serve amala, ewedu and gbegiri orders at lunch hour (a Cooking Mama/Overcooked-style tap game).
11. **Suya spot night shift:** slice, spice, wrap in newspaper, upsell.
12. **Site labourer to foreman:** carry blocks, then manage crews. Deal with the "omo onile" demand for settlement (negotiate, call a community leader, or pay).
13. **Ferry deckhand on Ikorodu to CMS:** a time-of-day schedule, plus life-jacket safety checks.

**Crew and friends (2–6 players)**
14. **Owambe Planner:** one runs the DJ booth, one the jollof pot, one the gele tying, one the MC mic. Party quality is scored. The host earns rep, and guests spray party tokens.
15. **Detty December Concert Night:** a group mission to get tickets, beat Lekki traffic and arrive before the headliner. Rides, outfits and connections all matter.
16. **Moving House:** rent a truck, carry furniture up a face-me-I-face-you staircase, dodge the agent's surprise "agreement fee."
17. **Flood Rescue:** in rainy season, canoe or keke-ferry stranded NPCs through flooded Lekki streets. Co-op only.
18. **Market Day Supply Run:** Mile 12 tomatoes to a buka before noon. One drives, one haggles, one guards the load from the "pothole of doom."
19. **Tarkwa Bay Trip:** charter a boat from Tarzan Jetty, beach games (football, volleyball), sunset photo mode.
20. **Startup Pitch at the Yaba hub:** a co-op quiz and slide mini-game. Win "funding" for a cosmetic office, or "japa" the founder as a joke ending.

**Social: make strangers meet**
21. **Viewing Centre Match Night:** live in-game screenings of real fixture schedules (licence-safe abstracted scores). Strangers pick sides and banter with emotes. The gen goes off at 85', and everyone chips in for fuel.
22. **Danfo shared rides:** players' avatars ride the same bus. Proximity chat with emote presets ("Driver, abeg!"). The conductor (a player) earns from real passengers.
23. **Aso Ebi drops:** weekly community fabric. Wear it to that week's public owambe. Strangers become "family" for the event, with group photos.
24. **Church/mosque choir and Jumat greeters:** a light, respectful community event where people show up, sing or greet, and get a "community" badge. Avoid parody of worship.
25. **Felabration open mic at the Shrine:** player-driven rhythm game performance, crowd voting.
26. **Elegushi Night Rave:** a dance-off with emotes. The DJ is a player using a curated licensed playlist.
27. **Street Football at Lekki/Surulere:** drop-in 3v3 that matches strangers.
28. **"How far?" street vendors:** players can run kiosks that other players buy from. Real micro-economy.
29. **Eyo Day (rare event):** follow the rules (shoes off, no caps) to join the procession. Breaking them gets you comically "tapped." Shared screenshots.
30. **Area Council Elections (light civic play):** players campaign for "Street Chairman" by fixing gutters, organizing clean-ups and throwing parties. The winner gets to set the street's playlist and decorations. This differentiates from Lagos Life's governor elections by staying hyper-local and non-partisan.
31. **Japa Send-off:** when a friend goes inactive or "japas," crew members throw a Murtala Muhammed Airport farewell party (an ironic, warm retention hook that lets returning players have a "IJGB" homecoming).

### C10. Ambient world details

**NPC behaviours**
- Hawkers converge on stationary cars in go-slow and sprint alongside slow traffic (pure water, gala, chargers, newspapers, plantain chips).
- Conductors bang the danfo side twice to signal "go." Passengers squeeze "four-four" on benches.
- Agberos stand at bus stops collecting tickets. Drivers hand money out of the window without stopping.
- LASTMA officers in maroon and yellow wave down one-way drivers. NPCs make U-turns to dodge them.
- People shelter under bridges when the rain starts. Umbrella hawkers appear instantly.
- POS agents' umbrellas line bank walls. Queues form when "network is down."
- Generators kick on area-wide when NEPA cuts out. Kids shout "UP NEPA!" when it returns, and fans and lights flick on in a ripple.
- Aboki kiosk men sleep on mats at night. Suya smoke glows red under bulbs.
- Okada riders gather at junctions just outside ban zones. They scatter when task-force trucks appear.
- Evangelists preach on BRT buses. A "Jesus is Lord" sticker sits on every other danfo windscreen. The Muslim call to prayer drifts at dawn and dusk.
- Football kickabouts in side streets stop for passing cars, then resume.
- Wedding convoys with hazard lights and horns crawl through traffic on Saturdays.

**Soundscape**
- Conductor calls (record real Lagos voice actors), horns in rhythm, keke two-stroke rattle, generator drone layered by neighbourhood (quiet in Ikoyi, roaring in Mushin), Third Mainland wind, ferry horns, market bargaining loops, church drums and tambourines, fuji at owambes, the call to prayer, rain on zinc roofs, "UP NEPA!"

**Radio (fictional stations, original music)**
- **Gidi Gist 95.x** (pidgin talk and street-pop): hosts react to in-game events ("Una see that flood for Lekki?").
- **Traffic FM**: live in-game congestion reports driven by actual player density. Useful *and* funny ("Third Mainland don hold. Stay for house!").
- **Shrine Radio**: Afrobeat and highlife.
- **Amapiano Night**: DJ mixes with a log-drum focus.
- **Owambe FM**: fuji, juju, apala.
- Ads: parody brands (hair relaxer, "Pure water with original sachet," a betting app spoof that warns about gambling, japa visa agents).

---

## Key risks and open questions
1. **Opera Mini and data-saver browsers:** about 20% of Nigerian mobile traffic is Opera. Measure the Opera Mini vs Opera for Android split with your own analytics on day 1.
2. **Hardware truth:** buy a Tecno Spark 40, Samsung A06 and itel A80 in Lagos for the QA lab. Emulators and desktop throttling will mislead you.
3. **Licensing:** Synty licences (web redistribution), music, football (no real club or league marks), real venue names (Quilox, Shrine, Amala Shitta). Use parody names or partnerships.
4. **Cultural sensitivity:** Eyo, religion and masquerades need consultation. Agberos and police need satire without endorsing extortion. Do not model naira spraying literally (CBN law).
5. **Data verification:** several figures came from search-engine extracts because direct page fetches were blocked. Re-check StatCounter, Opensignal and NCC numbers before external use.
