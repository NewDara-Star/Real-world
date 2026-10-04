# 3D assets to build in Blender (with a local Claude + BlenderMCP)

How to use this: open Claude Code on the Mac in the repo folder, with BlenderMCP
connected. Paste the **prompt** below, then work through the asset list one at a
time. Look at reference photos while you model (your own, or Geograph,
Wikimedia Commons, Panoramax; never Google), but don't keep them: `reference/`
only commits each asset's `preview.png`. Finished files go in
`game/public/models/` under the exact names below, then get committed and pushed.

## Prompt to paste

> You're building game-ready 3D assets in Blender (via BlenderMCP) for a
> realistic driving simulator set in Finglas, Dublin. Read
> `docs/blender-assets.md` in this repo and build the asset I name, following
> its spec and the global rules exactly. Look at reference photos for what it
> looks like (don't save them in the repo). Model real-world dimensions in metres.
> Use PBR materials (Principled BSDF: base colour, roughness, metallic, normal).
> Prefer CC0 textures from Poly Haven (BlenderMCP can fetch them); otherwise
> paint or procedurally bake textures into images. No brand logos, badges,
> licence plates with real numbers, or trademarked liveries. When it's done:
> apply all transforms, check the dimensions against the spec, export glTF
> binary (.glb) with the settings below to `game/public/models/<file>`, render
> a quick preview to `reference/<asset-id>/preview.png`, then list the triangle
> count and the node names. Ask me before you deviate from the spec.

## Global rules (all assets)

- **Real-life look first.** Every surface uses photo-scanned PBR materials
  (Poly Haven, ambientCG: CC0) at real-world scale: base colour, roughness,
  normal (and AO/height where they help), mapped so a brick is a brick's size
  (about 512 px per metre on walls, 1024 on things you see up close in the
  car). Add the wear real things have: dirt at the base of walls, streaks under
  sills, faded paint, chipped kerbs. Bake small details (mortar depth, panel
  gaps, weathering) into the normal and AO maps instead of adding triangles.
  Check against reference photos side by side before exporting.
- **Credits are enforced.** A commit adding a file under `game/public/models/`
  is refused unless `game/public/models/CREDITS.md` names it with each
  texture's source, author and licence. A commit changing code needs a
  `Story:` paragraph, and pushes are reviewed by a second Claude
  (see `CLAUDE.md`, "Checks and hooks").
- **Reference photos (owner's decision, 2026-10-04):** your own photos first.
  Open photo sites (Geograph Ireland, Wikimedia Commons, Panoramax) may be
  looked at to make the model, never stored, traced or used as textures. Never
  Google Maps, Street View or Earth.
- **Nothing that identifies a place or person.** Model what a building looks
  like (shape, materials, windows, shopfront layout), not who it is: no logos
  or shop names even for chains (Lidl, Aldi, Spar, Tesco), no real house
  numbers, plates or people.

- **Units and axes:** metres. glTF export with +Y up (Blender's default
  exporter converts Z-up for you). The model's front faces **+Z** in glTF
  (in Blender: the front faces -Y).
- **Origin:** on the ground, at the centre of the footprint (for cars: midway
  between the axles, at road level).
- **Apply transforms.** Scale 1, rotation 0 on every object before export.
- **Export:** glTF Binary (.glb), +Y up, include custom properties, materials
  "Export", images "Automatic", compression off. The game converts to its own
  formats.
- **Textures:** 2048 px maximum (1024 for small props), power-of-two sizes.
- **Names matter:** the game finds parts by node name. Use the exact names below.
- **No logos or trademarks.** Generic badging only.
- **Budgets:** triangle counts are maximums; fewer is fine if it still looks real.

## Asset list (in priority order)

### 1. `car_hatch_player.glb`: the player's car (with interior)
- A generic modern 5-door automatic hatchback of the kind used for Irish driving
  tests (Toyota Yaris / VW Polo / Hyundai i20 class), but unbranded.
- **Right-hand drive.**
- Dimensions: about 4.05 m long, 1.75 m wide (body, without mirrors), 1.47 m
  tall, 2.55 m wheelbase. Tyres 185/65 R15 (radius 0.31 m).
- Exterior: body, glass (separate material named `Glass`), headlights
  (`Headlight`), tail lights (`Brakelight`), indicators (`Signallight`; one mesh
  per corner named `IndicatorFL/FR/RL/RR`), reverse lights (`Reverselight`).
- Interior: dashboard with a speedo and fuel gauge, automatic gear lever with
  P R N D, steering wheel, seats, pedals (two: accelerator and brake), rear-view
  mirror, door cards, sun visors.
- Node names: `SteeringWheel` (pivot at the hub, rotating about its column
  axis), `WheelFL`, `WheelFR`, `WheelRL`, `WheelRR` (pivot at the wheel centre,
  axle along X), `DoorFL/FR/RL/RR` (pivot at the hinge), `MirrorL`, `MirrorR`,
  `MirrorRearView` (each with a flat child named `…Glass` for the mirror
  surface), `PedalAccel`, `PedalBrake`, `GearLever`.
- Add an empty named `DriverEye` at the driver's eye position (seated, RHD).
- Budget: 150k triangles.

### 2. `bus_dublin_dd.glb`: double-decker city bus
- A modern two-axle low-floor double-decker in yellow and dark blue, *like* a
  Dublin city bus, without logos or the real livery graphics.
- About 10.9 m long, 2.55 m wide, 4.4 m tall.
- Node names: `WheelFL/FR`, `WheelRL/RR`, plus lights named as for the car.
  Destination display: a mesh named `DestinationBlind` with its own material
  so the game can draw route text on it.
- Budget: 60k triangles. A simple interior (seats visible through the windows)
  is enough.

### 3. Traffic cars (`car_traffic_<n>.glb`, n = 1…5)
- Generic, unbranded: (1) small hatchback, (2) saloon, (3) estate, (4) compact
  SUV, (5) small panel van.
- Real-world sizes for each class. Wheels named as for the player car, plus the
  light materials. No interior beyond dark glass and seat shapes.
- Budget: 25k triangles each.

### 4. Street furniture (Finglas)
- `lamp_post_led.glb`: a modern Dublin LED street lamp, 8 m pole, single arm.
  Add an empty `LampHead` at the light source.
- `traffic_signal_head.glb`: an Irish traffic signal head: three aspects (red,
  amber, green) on a black body with a backboard. Lenses as separate meshes
  named `LensRed`, `LensAmber`, `LensGreen` so the game can light them. Plus
  `traffic_signal_pole.glb`.
- `post_box_pillar.glb`: a green Irish pillar post box (no crest or words).
- `bus_stop_pole.glb`: a bus stop pole with a blank flag, plus
  `bus_shelter.glb`: a glass bus shelter.
- `wheelie_bin.glb` (green, brown and black variants as materials),
  `bollard_steel.glb`, `telecom_cabinet.glb` (green roadside cabinet).
- `garden_wall_pier.glb` and `garden_wall_section_1m.glb`: the low brick or
  rendered front-garden wall with piers, common in Finglas estates (~0.9 m tall),
  so the game can line the front gardens.
- Budget: 5k triangles each (traffic signal 8k).

### 5. Trees and hedges
- `tree_ash.glb`, `tree_sycamore.glb`, `tree_cherry.glb`: street-tree sizes
  (6–12 m), leaves as alpha-cut cards with a separate `Leaves` material, trunk
  `Bark`. Budget: 30k triangles.
- `hedge_privet_1m.glb`: a 1 m long, 1.2 m tall privet hedge section that tiles
  end to end.

### 6. House-type kits (the world's buildings)

The game will build every house from these kits by type and size, so the
streets look like the real place without copying anyone's house. Each kit is a
set of modular pieces with **no identifying features**: no house numbers, no
names, no unique details from a single real house. Build them from the common
look of the type.

Kit pieces (one `.glb` per kit, each piece a separate node, pivot at its
bottom-left front corner, front facing +Z, sizes exact so pieces snap):
- `Wall_Bay_Ground`, `Wall_Bay_Upper`: one window bay, 2.7 m wide, 2.7 m storey
  height, window set back 10 cm into the wall (real reveals and sills).
- `Wall_Door_Ground`: a bay with the front door and its step.
- `Wall_Plain_Ground`, `Wall_Plain_Upper`: no opening (for side walls).
- `Corner_Ground`, `Corner_Upper`: the corner trim where two walls meet.
- `Roof_Hip_Section`, `Roof_Gable_Section`, `Roof_Gable_End`: 2.7 m sections
  plus ends; ridge, eaves with fascia and gutter, downpipe as its own node.
- `Porch_Canopy`, `Chimney_Stack`, `Front_Wall_1m`, `Front_Wall_Pier`,
  `Gate_Pedestrian`.
- Materials named so the game can swap colours: `Render_Upper`,
  `Brick_Lower`, `RoofTile`, `Door`, `WindowFrame`, `Glass`.

Kits, in priority order:
1. `kit_dublin_corp_terrace.glb`: Finglas's 1950s–70s Dublin Corporation
   two-storey terraced and semi-detached houses. Pebbledash or smooth render
   upstairs, brick or render downstairs, concrete tile roofs (hipped and
   gabled), small porch canopies, uPVC windows, low front garden walls with
   piers. This one kit covers most of Finglas.
2. `kit_shop_parade.glb`: a local shopping parade (one or two storeys, flat
   roof with parapet, shutters). The fascia sign board is a separate node
   named `Fascia` with its own material, left blank: the game paints the real
   shop name from OpenStreetMap onto it.
3. `kit_low_rise_flats.glb`: three- to four-storey brick or rendered flats and
   maisonettes with external stairs and balconies.
4. `kit_lagos_compound.glb`: for Yaba later: one- to three-storey rendered
   blocks with burglar bars, corrugated or tiled roofs, perimeter wall and
   gate.

Budget: 3k triangles per piece; the whole kit under 60k. Textures 2048 px
maximum, shared across the kit (one material set per kit).

