#!/bin/bash

GEOJSON_DIR=$1

for geojson_file in $(find $GEOJSON_DIR -name *.geojson); do
  filename=$(basename $geojson_file)
  location=$(echo $filename | sed 's|-ski-features.geojson||')
  woods_file=${GEOJSON_DIR}/${location}-woods.geojson
  if [[ ! -f ${woods_file} ]]; then
    pnpm diorama-woods build $geojson_file $woods_file
  fi
done
