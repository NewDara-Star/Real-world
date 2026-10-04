#!/bin/sh
# Build a SUMO road network (lanes, right-of-way, signal programs, footpaths,
# crossings) from an OSM file: real OSM when it could be fetched (lanes, turn
# lanes, roundabouts, sidewalk tags), else the Overture-derived rebuild.
# usage: tools/bake/build_net.sh <in.osm> <out.net.xml> [left|right]   (side traffic keeps to)
set -e
SH=$(python3 -c "import sumo;print(sumo.SUMO_HOME)")
"$SH/bin/netconvert" --osm-files "$1" \
  --type-files "$SH/data/typemap/osmNetconvert.typ.xml,$SH/data/typemap/osmNetconvertPedestrians.typ.xml" \
  --lefthand "$( [ "${3:-left}" = left ] && echo true || echo false )" \
  --geometry.remove --roundabouts.guess --ramps.guess --junctions.join --junctions.corner-detail 6 \
  --junctions.right-before-left.speed-threshold 0 \
  --tls.guess-signals --tls.discard-simple --tls.join --tls.yellow.time 3 \
  --sidewalks.guess --sidewalks.guess.max-speed 22.3 --crossings.guess --walkingareas \
  --osm.crossings true --osm.turn-lanes true --osm.sidewalks true \
  --no-turnarounds.except-deadend --remove-edges.isolated \
  --keep-edges.by-vclass passenger,pedestrian \
  --output.street-names --output.original-names \
  -o "$2"
# Second pass: mini-roundabouts become give-way-to-the-right junctions.
patch="${2%.net.xml}.mini.nod.xml"
python3 "$(dirname "$0")/mini_roundabouts.py" "$1" "$2" "$patch"
if grep -q "<node " "$patch"; then
  "$SH/bin/netconvert" -s "$2" -n "$patch" --lefthand "$( [ "${3:-left}" = left ] && echo true || echo false )" -o "$2.tmp"
  mv "$2.tmp" "$2"
fi
