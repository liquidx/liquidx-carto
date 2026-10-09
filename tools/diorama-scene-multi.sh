#!/bin/bash

# Build the scene file for every ski features file in a directory that lacks one.

GEOJSON_DIR=$1

for geojson_file in $(find $GEOJSON_DIR -name '*-ski-features.geojson'); do
  filename=$(basename $geojson_file)
  location=$(echo $filename | sed 's|-ski-features.geojson||')
  scene_file=${GEOJSON_DIR}/${location}-scene.geojson
  if [[ ! -f ${scene_file} ]]; then
    pnpm diorama-scene build $geojson_file $scene_file
  fi
done
