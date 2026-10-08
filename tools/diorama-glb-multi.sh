#!/bin/bash

GEOJSON_DIR=$1

for geojson_file in $(find $GEOJSON_DIR -name *.geojson); do
  filename=$(basename $geojson_file)
  location=$(echo $filename | sed 's|-ski-features.geojson||')
  glb_out_file=${GEOJSON_DIR}/${location}.glb
  if [[ ! -f ${glb_out_file} ]]; then
    pnpm diorama-glb build $geojson_file \
      --provider=gsi-1m \
      --rings=128 \
      --out=${glb_out_file}
  fi
done
