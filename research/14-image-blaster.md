# 14: image-blaster (neilsonnn/image-blaster), what it is and what we can use

Date: 2026-10-04. Repo: https://github.com/neilsonnn/image-blaster (MIT).

## What it is

A set of Claude Code skills and sub-agents (`.claude/skills`, `.claude/agents`)
that turn one image into a 3D scene by calling paid generation APIs, plus a
React Three Fiber viewer:

- **Environment:** World Labs Marble turns the image into a Gaussian splat
  (`.spz`) plus a rough collision mesh. The viewer draws it with Spark
  (`@sparkjsdev/spark`) and walks on it with Rapier.
- **Objects:** each movable object is cut out of the photo by an image-edit
  model (nano-banana or gpt-image-2), then made into a textured `.glb` by
  Hunyuan 3D (default) or Meshy, through FAL. Default 50k faces, PBR on.
- **Sound:** ElevenLabs sound effects (ambient loop and per-object sounds).
- Keys live in `.env`; a hook checks setup before running.

## Fit for us

| Part | Useful? | Why |
|---|---|---|
| Splat environments | No, for the drivable world | Marble imagines a world from one picture. It isn't the real street geometry, has no lanes or rules, is static and heavy, and its lighting is baked in. A real-photo splat of one spot (the test centre forecourt, from our own photos) is possible later but would clash with our lighting and weather. |
| Photo → 3D object | Yes, for props | Fast way to get a wheelie bin, Irish post box, bus shelter or signal head from our own photos, instead of modelling them in Blender. The output needs checking: real scale, triangle count, no logos, clean pivots and node names (`docs/blender-assets.md`). Not good enough for the player car (needs a real interior, wheel and door nodes). |
| AI sound effects | Some | Fine for ambience (birds, distant traffic, rain). The engine has to be real recorded samples by rpm and load (see research 09/10). |
| Skills + sub-agents pipeline | Yes, as a pattern | A good template for an asset pipeline the local Claude can run: one forked agent per asset, a JSON intent file per object, resumable jobs. |

## Licence catch

Hunyuan 3D, the default 3D model, is under the Tencent Hunyuan Community
Licence, which **does not apply in the EU, UK or South Korea**
([licence text](https://huggingface.co/tencent/Hunyuan3D-2/blob/main/LICENSE),
[summary](https://scancode-licensedb.aboutcode.org/tencent-hunyuan-3d-2.0-cla.html)).
The owner is in Ireland. Whether that reaches outputs made through FAL's API is
unclear; the safe choice is the Meshy provider (the repo supports
`--provider meshy`; Meshy's paid plans give the user the outputs) and to check
FAL's and World Labs' terms first.

AI-generated assets are also a new category for our asset rule (CC0/CC-BY/MIT,
credited). That's the owner's decision: if allowed, record the tool, source
photo (own photos only, never Street View) and plan in `public/models/CREDITS.md`.
