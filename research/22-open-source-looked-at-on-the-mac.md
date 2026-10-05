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
