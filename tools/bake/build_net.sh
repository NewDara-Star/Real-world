#!/bin/sh
# Build a SUMO road network (lanes, right-of-way, signal programs, footpaths,
# crossings) from the Overture-derived OSM file.
# usage: tools/bake/build_net.sh research/data/finglas/finglas.osm research/data/finglas/finglas.net.xml
set -e
SH=$(python3 -c "import sumo;print(sumo.SUMO_HOME)")
"$SH/bin/netconvert" --osm-files "$1" \
  --type-files "$SH/data/typemap/osmNetconvert.typ.xml,$SH/data/typemap/osmNetconvertPedestrians.typ.xml" \
  --lefthand true \
  --geometry.remove --roundabouts.guess --ramps.guess --junctions.join --junctions.corner-detail 6 \
  --junctions.right-before-left.speed-threshold 0 \
  --tls.guess-signals --tls.discard-simple --tls.join --tls.yellow.time 3 \
  --sidewalks.guess --sidewalks.guess.max-speed 22.3 --crossings.guess --walkingareas \
  --osm.crossings true --no-turnarounds.except-deadend --remove-edges.isolated \
  --keep-edges.by-vclass passenger,pedestrian \
  --output.street-names --output.original-names \
  -o "$2"
