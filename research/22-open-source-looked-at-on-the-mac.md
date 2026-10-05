# 22: Open-source city and driving projects, run on the Mac and read

Date: 2026-10-05. Question: which open-source projects that do what we do
(a real place, rebuilt from open map data, seen from the ground) can actually
run on the owner's Mac, how do they look next to World Drive at the same
spot, and what did they do that we should learn from? Techniques only;
nothing here is to be copied into our code or assets.

## What runs on macOS

Checked with Homebrew and the projects' release pages:

- Run: **Streets GL** (browser, streets.gl; source github.com/StrandedKitty/streets-gl,
  MIT, last commit 2025-08-21), SuperTuxKart (arcade karting), esmini
  (OpenSCENARIO player, macOS zip on its GitHub releases).
- Don't run here: Speed Dreams, VDrift, TORCS, Rigs of Rods, Stunt Rally
  (no macOS packages), CARLA (no macOS build; Homebrew's "carla" is an audio
  plugin host). BeamNG isn't open source.

SuperTuxKart and esmini aren't about how a real place looks, so the useful
comparison is Streets GL, the only one that builds a real city from OSM.

## Streets GL at Finglas, next to us

Captured in an Electron window at the business park and at the Saint
Margaret's Road gardens (the spot of happy-medium/019), from the air and at
eye height (OSM data frozen September 2023).

- **From the air it's polished:** soft cascaded shadows, clean colour, roof
  clutter (HVAC units, skylights) from OSM tags, crisp road markings.
- **At street level it's plain:** every building a white box with a window
  band, flat grass to the kerb, no front gardens, no facade materials. Ours
  is ahead where a driver looks: brick and render facades, roofs, garden
  walls, piers and hedges, textured road.
- **Trees are where it's clearly better.** Real-looking crowns that hold up
  from the ground, where ours are faceted low-poly blobs.

## How their trees work (read in src/resources/shaders/tree.*, InstancedTree.ts)

- The mesh (`tree.glb`) is 1.5 KB: a few crossed planes. All the look is in
  the textures.
- Per species (beech, fir, two lindens, oak) a 512 px **cut-out photo** of a
  whole tree (alpha-tested at 0.5) plus its **normal map**, in one texture
  array; the species is picked per instance.
- A shared **"volume normal"** texture (a sphere-like normal map over the
  card) is blended with the leaf normal map by **RNM** (reoriented normal
  mapping), so a flat card shades like a round crown; back faces flip the
  normal.
- Instanced: position, scale, rotation about the trunk and the species per
  instance; a separate depth material for shadows.
- Their tree textures have no stated source or licence in the repo, so we
  take the technique only.

## What we take

1. **Trees as baked cards (impostors)**, our own: grow Irish street-tree
   species (ash, sycamore, cherry, lime) in Blender, leaves from ambientCG's
   CC0 leaf sets, then render each to colour, normal and alpha cards; place
   them as crossed planes with a volume normal and RNM blend, instanced.
   These are the distance LOD; `docs/blender-assets.md` §5's full trees
   (30k triangles, leaf cards) stay as the near model, and §5 now asks for
   both.
2. **Roof clutter from OSM tags** for flat-roofed shops and the business
   park, later.
3. Their shadows and colour are on our roadmap already (items 11-12).

## The owner's links and a GitHub sweep (2026-10-05)

Run on the Mac in an Electron window unless noted; licences from each
repo's LICENSE file.

- **teleoperator.mindblown.ai**: closed source (teardown in research 06).
  Still the street-level realism bar: real car models, photographic city.
  Its cars are real brands, which we can't ship.
- **hanakawa-boat-game.vercel.app**: stylised and illustrative; the lesson
  is one consistent palette and light, not a technique.
- **noxellab/nagi-ocean-sim** (MIT, three.js WebGL2): FFT spectral ocean we
  don't need, but its sky is a CC0 Poly Haven HDRI (Kloofendal 48d, Greg
  Zaal and Jarod Guest) shipped as two JPEGs, a normal-range photo plus a
  gain map, decoded to HDR in the shader, and prefiltered for rough
  reflections. That's how to get photographic sky reflections (car paint,
  glass, wet roads; roadmap 11) in a few MB. A photo sky has its sun baked
  in, so it would carry clouds and reflections while our sun stays physical.
- **dgreenheck/ez-tree** (MIT, npm `@dgreenheck/ez-tree`, eztree.dev):
  procedural trees with an "Ash Medium" preset that looks right from the
  ground (~20k triangles, LOD1/LOD2 built in, exportable). Our street trees
  start here: ash, plus presets tuned towards sycamore, cherry and lime,
  then baked to cards for distance. Check its leaf and bark textures'
  licence before shipping them; otherwise use ambientCG CC0 sets.
- **esc5221/drive-game** (MIT, drive-game.pages.dev): OSM-built tracks,
  240 Hz physics with raycast suspension and Pacejka combined slip, wet
  grip, an AudioWorklet engine. The closest project to ours for physics and
  engine sound; opened to its menu only so far.
- **takram-design-engineering/three-geospatial** (MIT): precomputed
  atmospheric scattering (sky, sun, aerial perspective) with a WebGPU/TSL
  port, and volumetric clouds. The next step for the sky, now that the sun
  follows the real path (`sun.ts`).

From the sweep, to read when their item comes up: OSM2World (MIT now; tag
rules for street furniture, kerbs, roofs), osm2streets (Apache-2.0;
junction and marking geometry), agargaro/octahedral-impostor and
instanced-mesh (MIT; impostors and per-instance culling), sweriko/Horde
(MIT; pedestrian impostors), JoltPhysics.js (MIT; vehicle benchmark),
norio/three-gtvbao (licence "other", read it first; visibility-bitmask AO),
ranjian0/building_tools (MIT; Blender facade modules). Avoid reading the
code of GPL/AGPL/unlicensed ones (movsim, shapeml, Blosm, 3DStreet,
Streetmix); their demos are fine to look at.
