# 3D assets to build in Blender (with a local Claude + BlenderMCP)

How to use this: open Claude Code on the Mac in the repo folder, with BlenderMCP
connected. Paste the **prompt** below, then work through the asset list one at a
time. Put reference photos in `reference/<asset-id>/` (your own photos or ones
you're allowed to use; never Google Street View). Finished files go in
`game/public/models/` under the exact names below, then get committed and pushed.

## Prompt to paste

> You're building game-ready 3D assets in Blender (via BlenderMCP) for a
> realistic driving simulator set in Finglas, Dublin. Read
> `docs/blender-assets.md` in this repo and build the asset I name, following
> its spec and the global rules exactly. Use reference photos in
> `reference/<asset-id>/` if present. Model real-world dimensions in metres.
> Use PBR materials (Principled BSDF: base colour, roughness, metallic, normal).
> Prefer CC0 textures from Poly Haven (BlenderMCP can fetch them); otherwise
> paint or procedurally bake textures into images. No brand logos, badges,
> licence plates with real numbers, or trademarked liveries. When it's done:
> apply all transforms, check the dimensions against the spec, export glTF
> binary (.glb) with the settings below to `game/public/models/<file>`, render
> a quick preview to `reference/<asset-id>/preview.png`, then list the triangle
> count and the node names. Ask me before you deviate from the spec.

## Global rules (all assets)

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
