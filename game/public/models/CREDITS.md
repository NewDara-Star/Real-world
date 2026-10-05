# 3D models

- `car_concept.glb`: "CarConcept" from the Khronos glTF Sample Assets
  (https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept).
  Model and textures © 2024 Eric Chadwick / Darmstadt Graphics Group GmbH,
  licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), based on
  the public-domain "Free Concept Car 004" by Unity Fan. Khronos and 3D Commerce
  logos are hidden in the game. Modified at load time: driver controls moved
  to the driver's side.

Street furniture (`lamp_post_led`, `traffic_signal_head`, `traffic_signal_pole`,
`post_box_pillar`, `bus_stop_pole`, `bus_shelter`, `wheelie_bin`,
`bollard_steel`, `telecom_cabinet`, `garden_wall_pier`,
`garden_wall_section_1m`): modelled for this project by
`tools/assets/build_street_furniture.py`. No third-party content: the walls
and cabinet plinth embed no textures, only `extras.surface` naming the CC0 set
in `public/tex/` the game draws them with (credited there).

People (`humans/`: the `*.glb` characters, `humans/clips/` animations and
`humans/people.json`): converted from **Microsoft Rocketbox**
(https://github.com/microsoft/Microsoft-Rocketbox) by
`tools/assets/people/build_people.mjs`: textures resized, a lower-detail mesh
added, geometry quantised, clips cut down to bone rotations. MIT licence:

> Copyright (c) 2020 Microsoft
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

Rocketbox asks that work using it cite: Gonzalez-Franco M. et al., "The
Rocketbox Library and the Utility of Freely Available Rigged Avatars",
Frontiers in Virtual Reality (2020), DOI 10.3389/frvir.2020.561558.

`bus_dublin_dd.glb`: modelled for this project by `tools/assets/build_bus.py`,
in the shape of Dublin's Wright Gemini double-deckers (proportions from CC
photos on Wikimedia Commons, looked at and not stored). No third-party
geometry or textures, no logos or livery graphics.

`car_traffic_1.glb` (hatchback), `car_traffic_2.glb` (saloon),
`car_traffic_3.glb` (estate), `car_traffic_4.glb` (compact SUV),
`car_traffic_5.glb` (small panel van): based on "Generic passenger car pack"
(https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5)
by Comrade1280 (https://sketchfab.com/comrade1280), licensed CC-BY-4.0
(http://creativecommons.org/licenses/by/4.0/). Modified by
`tools/assets/build_traffic_cars.py`: turned and scaled to real class lengths,
wheels renamed and re-pivoted, lights split into the game's materials, the
minivan's rear glass painted over as a panel van.

Street trees near the player (`game/src/client/trees.ts`): generated at run
time by ez-tree (https://github.com/dgreenheck/ez-tree, npm
`@dgreenheck/ez-tree`) by Daniel Greenheck, MIT. Its bundled bark textures
come from Poly Haven (bark_brown_02, bark_willow_02; CC0) and TextureCan
(CC0); its leaf textures ship in the MIT package.
