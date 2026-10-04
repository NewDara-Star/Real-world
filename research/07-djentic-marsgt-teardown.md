# 07: Teardown of drive.djentic.ai and mars-gt.vercel.app

Date: 2026-10-04. Read-only analysis of the shipped bundles. **No code was copied into the project.**
Neither site states a licence and both bundles are proprietary, so we take
techniques only (owner's rule). Quoted text is limited to identifiers and short strings.

## Method

- Fetched with a generic research User-Agent (downloads not kept in the repo).
  Both hosts were reachable and no asset host was blocked, because neither app loads external assets.
- Pretty-printed with esbuild (`*.pretty.js`). **Line hints below refer to those pretty files.**
- Source maps: `*.js.map` and `*.css.map` return 404 on both sites, so there are none.
- Files:
  - djentic: `index.html` (17.8 KB, which holds an inline boot loader with `__BOOT_ENTRY`),
    `assets/index-Bd3cxzfe.js` (1.75 MB), `assets/index-BhllEQl7.css`,
    `assets/terrain.worker-DGKzxdjv.js` (29 KB), plus Google Fonts (Geist) for the UI only.
  - Mars GT: `index.html` (2.3 KB), `assets/index-tCWmFcHl.js` (1.22 MB), and
    `assets/module-D8V_xHmf.js` (293 KB, loaded with a dynamic `import()` at line 23288). That module is
    the **PostHog** analytics SDK (`browser-common` 0.9.1), not game code.
- **Neither app loads any glTF, KTX2, HDR, image texture, audio file or wasm.** Everything
  (world, cars, textures, sky, sound) is generated in code at runtime. There are no
  Draco/meshopt/KTX2 decoders, no physics engine library and no React.

Both apps are **three.js r186** (`__THREE__` = `186`): djentic on `WebGLRenderer`, Mars GT on
`WebGPURenderer` with a WebGL2 fallback (`data-engine` = "three.js r186 webgpu", line 21305).
Mars GT is therefore almost exactly our stack.

---

## 1. drive.djentic.ai, "Endless Driving"

An endless, procedurally generated scenic drive (biomes: Coastal Highway, Alpine Pass, Red
Desert, Metropolis and others; see the `terrain.worker` strings). The car auto-drives along a
spline. It is a mood piece, not a simulator.

### What makes it look and feel good (ranked)

1. **A real HDR pipeline with eye adaptation.** Lighting uses physical-ish intensities, and
   a custom auto-exposure pass meters log-average luminance, centre-weighted toward the
   road and with highlights clamped at 50. It adapts fast to bright (tau 0.3 s) and slow to
   dark (1.4 s), with key 0.18 and an exposure clamp of 0.1 to 3 (`px` class, about lines 23090-23170).
   Tunnels and night "just work" because of this.
2. **A time-of-day colour grade.** Lift, gain, saturation and contrast keyframes are indexed
   by sun elevation (`dx` table, line 23080) and blended toward an overcast grade by weather.
   The final pass (`vx`, lines 23260-23340) runs custom ACES (the Hill RRT/ODT fit), then
   the grade in display space, sRGB, contrast, an elliptical vignette, and luminance-weighted
   grain plus 1/255 dither.
3. **A physically based sky.** Single scattering with Rayleigh, Mie and ozone (constants `BR`, `BMs`,
   `BO`, Earth radius 6360 km, Mie g 0.78; line 21040) is baked into a **192×108 sky
   LUT** (`Ly`/`Ry`, line 21171) and sampled by a dome shader. The dome adds cumulus via a
   ray-plane at about 1.6 km with silver lining and powder effect, cirrus, sun limb darkening, moon phase,
   stars, Milky Way, a light-pollution dome, a rainbow, aurora, lightning and storm cells (lines 21200-21455).
4. **Dynamic IBL from that sky.** The sky dome is rendered into a cube **one face per frame**,
   then `PMREMGenerator.fromCubemap` produces `scene.environment` (`_envStep`, lines 21732-21746).
   It only re-renders when the sun direction, cloud cover or urban mix changes (`_skyChanged`).
   Car paint and glass therefore always reflect the current sky.
5. **Aerial-perspective fog.** It patches `fog_vertex` and `fog_fragment` (lines 21760-21830):
   height-integrated density, **chromatic extinction** (`exp(-od*vec3(0.8,1.0,1.28))`, so
   distance turns blue) and sun-direction in-scatter lobes (pow 6 and pow 40). Distant terrain layers instead of greying out.
6. **Cloud shadows on the ground.** `lights_fragment_begin` is patched so the sun's
   `directLight.color *= cloudShadow(wp)`, using the same noise as the sky clouds (line 21836).
7. **Night "light pools".** Up to 24 nearest street-lamp, shopfront and signal emitters
   are passed as uniform arrays and added to **indirect irradiance** in every material with a
   cubic falloff and soft saturation. There are no real point lights, so the cost is flat
   (`xb` class and the `lightPools()` chunk, lines 21840-21900).
8. **Post effects.** Karis-weighted 4-mip bloom (threshold 2.2 HDR, strength about 0.07; `hx`),
   screen-space god rays from the sun (`_x`, 28 taps), a sun-occlusion-tested **lens flare**
   (ghosts, halo, anamorphic streak; inside `vx`) and a rain **wet-road streak
   reflection** pass (`gx`) that smears bright pixels downward with ripple and masks out the
   player's car box.
9. **Weather on materials.** `onBeforeCompile` adds wetness, puddles and snow cover (`zz`, line
   35746). On up-facing surfaces it darkens albedo, clamps roughness to ≤0.28, adds noise-masked
   puddles at roughness 0.03, and flattens the normal map inside puddles.
10. **Fake body dynamics for feel** (see Physics), a handheld-noise chase camera with
    speed-driven FOV, skid marks, wheel-blur discs, glowing brake discs, and grime and dirt on the
    paint by biome and weather.

### Stack
- three r186 `WebGLRenderer`, `antialias` off on mobile, DPR ≤ 2, `PCFSoftShadowMap`
  (`shadowMap.type = 1`, line 37471), `toneMapping` 0 (none) because tone mapping is done in the final pass.
- three addons: `EffectComposer` and `RenderPass`, `GTAOPass` (only with `?ao=1`, radius 0.8,
  12 samples, blend 0.8; line 23352), FXAA, `PMREMGenerator`.
- Everything else is custom GLSL injected via `ShaderChunk` (`Vf.*`) and `onBeforeCompile`.
- A terrain Web Worker using simplex noise.
- Procedural audio from oscillators, filters and a compressor (engine profiles `flat6`, `v12`,
  `turbo4`, `ev`, each with idle and redline rpm and gear count; lines 24236-24351 and 27305 onward).

### Rendering details worth noting
- **Shadows:** a custom `SunLightShadow` with **2 cascades** (`Yy = 2`, line 21467),
  `bias -2e-4`, `normalBias 0.04`, `radius 2`. Shadow map size comes from the quality tier
  `[2048, 1536, 1024, 768]`. `shadowMap.autoUpdate` is turned off when the sun is under 0.02 intensity.
  Distant props get **blob shadows** (instanced decals: rounded-box contact for cars,
  ellipse for cast shadows, line 21592). Trees use impostors past 15 m and only cast shadows inside 55 m
  (`treeimpostor` and `treeshadow`, line 32836). Low-poly `shadow-proxy` meshes cast in place of
  detailed ones (line 23917).
- **Adaptive quality director** (`sx` class, lines 22990-23075). It measures p75 and p90 frame
  time over 2 s windows. Over budget, it steps down resolution [1 … 0.6], effects
  scale [1, 0.82, 0.58, 0.25] and shadow size, in that order. It probes upward after 20 s
  of headroom and rolls back if the probe fails. An initial guess comes from pixels × DPR², core count,
  `deviceMemory` and software-renderer detection (`ox`). Bloom, rays and wet passes run at
  `effectsScale` resolution.
- **Car materials:** `MeshPhysicalMaterial` paint with metalness 0.3, roughness 0.36,
  **clearcoat 1, clearcoatRoughness 0.03**, envMapIntensity 0.8, and a generated flake normal map
  (line 23966). Glass: roughness 0.03, clearcoat 1, opacity 0.62.
- **Textures:** 33 `canvas` generators (signage, facades, carpet, grime, flake), so there are no files.

### Physics and AI
- **There is no vehicle physics.** The hero car follows the track spline (`s`, `laneOffset`;
  `Ew.update`, line 25426). "Feel" comes from a **3-channel spring-damper body
  rig** driven by kinematics (`_dynamics`, lines 25440-25470):
  - heave target from vertical curvature (`-v²·kv·4e-3`) plus two octaves of road noise;
  - pitch target `accel·8e-3` (clamped from -0.04 to 0.03 rad);
  - roll target `-v²·k·0.011` (clamped ±0.075 rad);
  - spring and damper constants: heave k 90 / c 9, pitch 55 / 6, roll 45 / 5.5, sub-stepped.
  - Steering animation: `atan(wheelBase·k)·1.6` plus yaw and slip terms. There is also a touchdown
    impulse after jumps.
- **Traffic** runs on rails along lanes with per-car `pace` multipliers (0.62 to 1.12 of the base speed),
  and highway merges come from lane `gap` (lines 26920-27045). There is no IDM.
- **Pedestrians** (`peds-v5`), cyclists, birds and boats are instanced and animated in shaders.
- **Chase camera:** critically damped springs for distance, lateral offset, height, look and FOV.
  FOV is `clamp(52 + v·0.42, 52, 82)` plus a boost, distance is `7.2 + v·0.055 + accel·0.35`, and
  noise shake scales with speed (line 25949). Cockpit FOV is 68 to 76.

### Data
Fully procedural and seeded: road spline, biomes, towns (`town:buildings`, `town:lamp-poles` and so on),
bridges and landmarks. There is no real-world map data and no AI-generated assets anywhere in the bundle [inferred].

---

## 2. mars-gt.vercel.app, "MARS GT"

By @AndreiProvkin (credits in `index.html`). It is a single hand-authored valley: a canyon road
that descends to villages, farms, a canal and towers, with an Earth/Mars gravity toggle.
Every number lives in one config object `q` (line 21938).

### What makes it look and feel good (ranked)

1. **A heavy, art-directed grade on WebGPU and TSL** (`Yz`, lines 23140-23225):
   - **Hue-selective grading in Oklab** (custom linear→Oklab and back, line 23131): three
     bands (red 35°, green 130°, sky 245°), each with hue, width, lightness, saturation and shift
     settings, plus a separate shadow shift.
   - lift `#121414`, gamma 0.74, **split toning** (shadows teal `#1f8a8a` at 0.04,
     highlights peach `#ffa38a` at 0.1, balance 0.45), contrast 1.12, saturation 1.15.
   - vignette 0.25, grain 0.02 (lighter in highlights), `SharpenNode` at 0.7.
   - **"Clarity"**: local contrast computed as log(luma / blurred luma) from a quarter-res
     `GaussianBlurNode`, clamped to ±0.7 and faded in with distance from 40 to 250 m. Distant
     cliffs pop and near surfaces stay clean.
2. **AO applied only to ambient light.** The scene pass writes an MRT `velocity` target whose
   `.z` holds the *ambient fraction*: hemi luminance divided by (hemi + sun × shadow × N·L). A
   custom `getShadow` context captures each fragment's sun shadow (lines 23150-23165). GTAO
   (half res, radius 2, 16 samples, intensity 0.8, faded out by 3 km) is then
   `mix(1, ao, intensity × ambientFraction)`. **Sunlit faces get no AO and shaded faces
   get full AO**, which is physically right and removes the "dirty halo" look.
3. **TRAA** (three `TRAANode`, with depth and velocity) as the anti-aliaser. FXAA is used only on mobile.
   The grain and sharpen after it keep the image crisp.
4. **Exponential height fog in TSL** (`scene.fogNode`, line 25752): analytic integral of
   `exp(-(y-baseY)·falloff)` along the view ray, density 1.6e-4, start 1500 m, max 0.92. The
   fog colour is **the sky colour in the view direction**, so fog and sky match exactly.
   The sky is only an analytic gradient (zenith, horizon, sun glow pow 6/64/2000) as `backgroundNode`.
5. **CSM with staggered refresh.** three's `CSMShadowNode` uses 3 cascades, custom splits
   `[0.012, 0.16, 1]` of 3.2 km, and **cascade refresh every [1, 4, 24] frames**
   (`shadow.autoUpdate=false`, `needsUpdate` set per cascade, line 25785). Per-cascade bias,
   normal bias scaled by texel size, and a custom 3×3 PCF `filterNode` (`mU`, line 25734).
   Shadow map 2048 (1024 on low and mobile).
6. **Dense near-field vegetation.** Instanced grass blades (256 per side at 0.12 m spacing, 6 LOD
   rings, wind with gusts, fade from 110 to 185 m) sample a terrain-height texture. Back-lit
   translucency is faked as `emissive = albedo·sunColor·pow(V·L)·0.35`. Procedural branching
   trees use leaf cards plus "blob" impostors at distance, with the same translucency trick.
7. **Canal water with SSR** (WebGPU only; 26 steps, 5 refinement steps) plus ripple and gust normals.
8. **Car reflections from a matched env cube.** Instead of the sky, a 128 px cube is painted
   on the CPU to contain *the canyon itself* (lit and shaded wall colours, jagged wall top, field,
   road; `vW`, line 26952) and then PMREM'd. Reflections are added through `emissiveNode` at a set
   roughness (paint 0.12, glass 0.04), plus a "fill" term. A radial-gradient **contact
   shadow** quad sits under the car with polygon offset (line 23925).
9. **Physics with load transfer and saturating tyres** (below). This is why it "feels" right
   although it is a single-track model.
10. **Engine sound from a harmonic spectrum.** `setPeriodicWave` is built from 48 engine-order
    levels in dB (`audio.engine.orders`), then roar, rasp and hiss filters with load-dependent
    cutoff. Tyre squeal is a band-pass at 980 Hz with Q 10. Surface roll and gravel noise are also synthesised.

### Stack
- three r186 `WebGPURenderer({antialias:false})` with WebGL2 fallback (`forceWebGL`), TSL
  `RenderPipeline` (`cI`), `toneMapping` ACES (`Xz` map: aces 4, agx 6, neutral 7),
  `PCFSoftShadowMap`, `outputColorTransform=false` on the pipeline. The pipeline does the conversion itself.
- three TSL addons identified by `getType()` strings: `GTAONode`, `TRAANode`, `BloomNode`
  (strength 0.35, radius 0.4, threshold 1), `GaussianBlurNode`, `SharpenNode`, `FXAANode`, and
  `CSMShadowNode` (from `examples/jsm/csm`). All of these ship in our `three@0.186.1`.
- No physics library. There is a custom vehicle integrator at **120 Hz** (`pH = 1/120`).
- PostHog analytics, lazy-loaded.
- **Quality:** presets set a **pixel budget** rather than a DPR (`WR`, line 22589): low 0.92 MP,
  medium 2.07 MP (1080p) with DPR ≤ 1.5 and 2048 shadows, high 3.69 MP. Desktop is
  **capped at 40 fps** (`loop.fpsCap 40`), mobile at 60. Dynamic resolution steps down 10% and up 5%
  around 50 and 57 fps, with a minimum scale of 0.5 to 0.85. The mobile overrides turn off bloom, AO, clarity,
  TRAA and SSR.

### Assets
Everything is procedural. The car is a code-built wedge with panel gaps, door lines, DRL
slots and glass areas drawn as **shader masks on one mesh** (`colorNode` built from
`rV.doorY`, `hoodZ` and similar, line 23897). Wheels are a lathe with rim, spoke, lip and brake parts
selected through an `aPart` attribute. Terrain colours, road markings, ruts and paving are all
shader-side. There are no texture files.

### Physics and AI (`wH`, lines 24749-24830)
A planar **single-track (bicycle) model with weight transfer** plus a kinematic
ground follower:
- `mass 1250`, `frontShare 0.5`, `cgHeight 0.5`, wheelbase 2.52, track 1.64, wheel radius 0.35;
  yaw inertia `m·(a²+b²)·0.6`.
- Engine: torque 340 N·m peaking at 4800 rpm (falling off by `1-1.1·x²`, never below 30%), idle 900, max 7200,
  5 gears `[3.3, 2.15, 1.55, 1.18, 0.94]`, final drive 3.83, auto shift up at 6600 and down at 2900,
  0.22 s shift cut, engine braking 900 N, brake 13 kN, drag coefficient 0.42·v².
- **Axle loads:** `Fz_front = m·g·b/L − m·aLong·h/L` and the mirror for the rear, floored at 15% of `m·g`.
- **Tyre:** lateral force `μ·Fz·tanh(−Cα·atan(slip)/(μ·Fz))` with `cornering 85e3` N/rad,
  rear stiffness ×1.2, `grip 1.15` × `lateralGrip 1.5`. This is a smooth saturating curve (no
  Pacejka peak or fall-off). Slip angles use the speed floored at `lowSpeed 3` m/s.
  - **Friction circle on the driven rear:** `Fy_max·sqrt(max(0.15, 1 − 0.5·(Fx/Fx_max)²))`.
  - Handbrake: rear forces become velocity-proportional sliding at `handbrakeGrip 0.8`.
- **Steering limit by speed:** `steerMax = min(32°, atan(L·μ·g·steerGrip/v²))`. The wheel can't ask
  for more yaw than the tyres can deliver. Steer rate 150°/s, return 200°/s.
- **Stability assist:** a yaw moment `2.5·Iz·(r − r_target)` toward the kinematic yaw rate,
  ramped in over 0 to 10 m/s.
- Surfaces: road grip 1 / rolling resistance 0.015, dirt 0.85 / 0.03, grass 0.7 / 0.06, with camera shake per surface.
- Ground: height sampled at the 4 wheel contacts gives pitch and roll, and gravity acts along the slope.
  Airborne state is ballistic with nose-follow. Landing kicks the heave and pitch springs.
- **Visual body motion:** a separate spring at **1.6 Hz with damping ratio 0.55** driven by
  `aLong·6e-3` (pitch) and `aLat·9e-3` (roll).
- Collisions: two circles (radius 1 m, ±1.2 m along the car) against a spatial hash of props,
  restitution 0.25, yaw rate ×0.7 on impact.
- **Camera:** follow 10, yaw follow 2.5, look into slip 0.5, FOV 55 (+ `fovSpeed` 14),
  slope-aware, with a minimum ground clearance of 0.8.
- **Traffic:** 3 scripted cars at fixed speeds along the road spline. There are no pedestrians.

### Data
A hand-authored world in config: a road polyline (`world.road`), valley cross-sections
(`terrain.valley`: floor, wall, talus by z), village centres, canal and bridges. The terrain is a
quadtree LOD (root 16 km, minimum 128 m, 64 segments, skirts, 6 ms build budget per frame).
There is no real-world map data and no AI-generated assets [inferred].

---

## 3. Comparison with our stack

| Area | Ours (`game/src/client/graphics.ts`) | djentic | Mars GT | Gap |
|---|---|---|---|---|
| Renderer | WebGPURenderer, TSL `RenderPipeline` | WebGL + EffectComposer | WebGPURenderer, TSL | Mars GT is the same; its nodes drop straight in |
| Exposure | fixed 0.95 (+0.6 at night) | **auto-exposure, eye adaptation** | fixed 1 | We have no adaptation: tunnels, night and underpasses look wrong |
| Tone map / grade | ACES only | ACES + lift/gain/sat/con by sun elevation | ACES + Oklab hue grade, split tone, clarity, sharpen | **Biggest visual gap.** We have no grade at all |
| AA | SMAA | FXAA / MSAA | **TRAA** | SMAA can't fix shader aliasing on facades and markings. TRAA can |
| AO | GTAO applied to all lighting | GTAO opt-in | **GTAO × ambient fraction** | Our AO darkens sunlit walls |
| Sky | `SkyMesh` (Preetham) | **PB sky LUT + clouds + stars** | analytic gradient | We are fine by day. Clouds and night sky are missing |
| IBL | none (hemi only) | **sky→cube→PMREM, incremental** | painted env cube for the car only | **Car paint and glass have nothing to reflect** |
| Fog | linear `THREE.Fog` 180-900 m | height + chromatic aerial | analytic height fog in sky colour | Our fog is flat and doesn't match the sky |
| Shadows | 1 directional, 4096², 180 m box, texel-snapped | 2-cascade custom + blob + proxies | **CSM 3 cascades, staggered refresh** | Our far shadows are absent or soft. CSM is free in r186 |
| Night lights | emissive + bloom | **24 light pools in irradiance** | emissive glow | Our streets don't light the road at night |
| Wet roads | none | roughness, puddle and normal patch + streak pass | none | Matters for Irish weather |
| Car physics | bicycle → Rapier + raycast + Pacejka (`08-vehicle-physics.md`) | on rails | bicycle + load transfer + tanh tyre + stability | Ours will be more correct. Mars GT shows the feel layer |
| Body motion | from physics (planned) | spring rig 90/55/45 | 1.6 Hz ζ 0.55 spring | Useful for cabin-cam comfort even with Rapier |
| Traffic / peds | IDM + SUMO rules, SUMO footpaths | lane rails + pace | 3 scripted cars | **Ours is far ahead.** Nothing to take |
| World | real OSM/Overture + SUMO | procedural | hand-authored | Ours is the only one tied to real places |
| Quality scaling | 3 fixed presets by DPR | **p75/p90 director with probe and rollback** | pixel budget + dynres, 40 fps cap | We have no adaptive scaling |
| Audio | (see drive.ts) | oscillator synthesis per engine profile | **engine-order periodic wave** | Technique only; we need a Polo 1.0 TSI 3-cylinder profile |

Honest read: **neither site has better assets than ours.** They have zero textures and zero
models. The realism comes almost entirely from **(a) lighting coherence** (IBL from the sky,
fog in sky colour, AO only in shade, auto-exposure), **(b) a deliberate colour grade**, and
**(c) temporal AA plus sharpening**. Our CC0 Poly Haven textures and real geometry should
look better than either once the lighting and grade are fixed.

---

## 4. Techniques to adopt, prioritised

All libraries named are in **three.js r186 (MIT)**, which is already a dependency. There are no new packages.

1. **Environment lighting from our sky** (high value, low cost). Render `SkyMesh` into a
   `CubeRenderTarget` (one face per frame or on time change) → `PMREMGenerator` →
   `scene.environment`. Keep `HemisphereLight` small or drop it. Car paint becomes
   `MeshPhysicalMaterial` with clearcoat 1 and clearcoatRoughness about 0.03 (djentic's values). In TSL
   we can do this with `pmremTexture` (MIT, three).
2. **A colour grade node after tone mapping** (high value). Set `outputColorTransform=false` and
   write a TSL `Fn` for lift/gamma/gain, split-tone and saturation, and later Oklab hue bands. Keyframe it by sun elevation
   and by weather (djentic's `dx` approach). Tune it against real Finglas photos we are allowed to use
   (our own or CC-BY; never Street View). Alternative: `Lut3DNode` with a .cube LUT we author.
3. **Switch SMAA → `TRAANode` + `SharpenNode`** (MIT, three). This needs a `velocity` MRT on the
   scene pass. Keep SMAA as the low-tier fallback.
4. **AO only in shadowed or ambient light** (Mars GT trick). Write the ambient fraction into a spare MRT
   channel and multiply GTAO by it, instead of `builtinAOContext` on all lighting. Cheap, and it removes the halo look.
5. **Height fog in TSL whose colour is the sky radiance in the view direction** (`scene.fogNode`).
   Add djentic's chromatic extinction `exp(-od·(0.8,1,1.28))` for haze depth. This replaces `THREE.Fog`.
6. **`CSMShadowNode`** (three `examples/jsm/csm`, MIT): 3 cascades, near split about 12 m, mid
   about 160 m, refresh cadence [1, 4, 24] frames. This replaces our single 180 m box.
7. **Auto-exposure** (djentic `px`): log-average luminance on a 64² mip chain, centre-weighted,
   highlights clamped, asymmetric adaptation (0.3 s up, 1.4 s down). It is essential for the
   Finglas underpasses, night and the transition into the test centre car park. There is no three addon for it, so we write it in TSL.
8. **Night light pools** in irradiance: up to about 24 nearest lamps as uniform arrays.
   Our SUMO and OSM data already has lamp and signal positions. It is far cheaper than 24 `PointLight`s.
9. **Wet-road material layer** (darker albedo, roughness to ≤0.28 on up-facing surfaces, noise
   puddles at 0.03, flattened normals) and later `SSRNode` (three, MIT) for puddles. It matters for Dublin.
10. **An adaptive quality director**: p75/p90 frame-time windows that step resolution, then effects,
    then shadows, with an upward probe and rollback. Size presets by a **pixel budget** (Mars GT `WR`)
    rather than DPR, because the owner's Mac is a retina machine.
11. **Contact shadow under each car** (radial-gradient quad with polygon offset) for traffic
    beyond the CSM range, and blob shadows for distant props (djentic).
12. **Clarity (local contrast) by distance** using `GaussianBlurNode` at quarter resolution.
    This is optional and should come last; it is easy to overdo.

### Vehicle physics notes for `08-vehicle-physics.md`
Mars GT is a useful **sanity reference and fallback**, not a replacement for Rapier with Pacejka:
- Its tyre is `μFz·tanh(Cα·α/μFz)`, a saturating curve with no peak. It is forgiving and
  arcade-stable. Our Pacejka B 10, C 1.3 (lateral) will have a peak-then-drop, which is more
  honest for a learner car.
- Ideas worth taking, all of which are compatible with Rapier:
  - **Speed-limited steering:** `δmax = min(32°, atan(L·μ·g·k/v²))`. This is for keyboard
    and pad only; never for the G29, where the wheel angle must be literal.
  - **Low-speed slip floor** of 3 m/s (we use relaxation length; keep ours).
  - **Friction ellipse on the driven axle** (`sqrt(1 − 0.5·(Fx/Fxmax)²)`).
  - **Load transfer** with `h = 0.5`. Rapier gives us this for free through the suspension.
  - **Yaw-rate assist** `2.5·Iz·(r − r_kin)`. Use it as an ESC model that defaults off,
    because the examiner shouldn't be fooled by assists.
  - Surface table (grip / rolling resistance): road 1 / 0.015, dirt 0.85 / 0.03, grass 0.7 / 0.06.
- Their parameters (1250 kg, 340 N·m, 5-speed) are a sporty fantasy car. Keep our Polo DSG numbers.
- Body-motion springs for the **camera only** (Mars GT 1.6 Hz / ζ 0.55; djentic roll k 45 c 5.5)
  can smooth the cabin camera if Rapier's chassis motion feels harsh on a monitor.

### Not worth taking
Their traffic and pedestrians (scripted or on rails; ours is far better), their procedural
worlds, and their car meshes (ours is a real glTF).
