# Data tools

Command-line tools that fetch, build and explore the data behind the prototypes. They're
TypeScript run directly by Node's type stripping, so shared code in `src/lib` uses relative
imports with `.ts` extensions. They're type-checked with the app by `pnpm check`.

| Command                    | Prototype          | What it does                                                           |
| -------------------------- | ------------------ | ---------------------------------------------------------------------- |
| `pnpm ev-jp`               | EV Charging Japan  | builds charger, distance-grid and route data from the source           |
| `pnpm japan-train-lines`   | Japan Train Lines  | downloads railway data, builds region polygons and line index          |
| `pnpm tokyo-outline`       | Tokyo Outline      | builds tokyo's coastline, borders and municipal shapes from the source |
| `pnpm diorama-scene`       | Snow Diorama       | fetches woods, water, buildings, roads and car parks for a ski resort  |
| `pnpm diorama-glb`         | Mountain Diorama   | exports the diorama GLB for a features file, without a browser         |
| `pnpm tessera-classifier`  | Tessera Classifier | trains a classifier of tessera embeddings, maps a scene's woods        |
| `pnpm snowboard-locations` | Snowboard Sim      | lists the ids of the locations with terrain data, for the sim's picker |
| `pnpm odpt`                | transit            | ODPT GTFS feeds and API (see `docs/TRANSIT.md`)                        |
| `pnpm ekispert`            | transit            | 駅すぱあと API (see `docs/TRANSIT.md`)                                 |

Run any of them with `help` for their subcommands.

`diorama-glb` runs code written for the browser (`packages/diorama`, the terrain tile client),
so it starts Node with `--import ./tools/node-env.ts`, which resolves `$lib/` and the package's
`.js` imports to the sources and fills in the few browser globals three.js needs. Any new tool
that reaches into that code should do the same.

## ev-jp

```sh
pnpm ev-jp build      # tools/ev-jp/source → src/lib/ev/data/ (bundled) + data/ev-jp/ (gis exports)
pnpm ev-jp waypoints  # towns and capes, distance to the nearest fast charger
pnpm ev-jp isolated   # fast chargers furthest from their neighbours
pnpm ev-jp summary    # remotest land, access flags, site types
pnpm ev-jp inspect    # raw placemarks from the kml
```

Sources in `tools/ev-jp/source/`:

- `hokkaido-chargers.kml`: 北海道のEV・PHV充電器マップ, 一般社団法人北海道開発技術センター,
  <https://decnet.or.jp/hokkaido_evphv>, data current as of 2026-06-01, extracted 2026-08-28 from
  the Google My Map's KML export. No formal licence; the publisher asks for attribution and
  disclaims accuracy.
- `hokkaido-coastline.txt`: simplified from [dataofjapan/land](https://github.com/dataofjapan/land),
  delta-encoded.

The /ev-jp page credits both; keep `CREDITS.hokkaidoEv` in `src/lib/credits.ts` in step with the
data date.

`data/ev-jp/` (gitignored) gets the full-attribute exports: `hokkaido_chargers_all.geojson`,
`hokkaido_chademo_dc.geojson`, `hokkaido_chargers_all.csv` and `hokkaido_outline.geojson`.

## diorama-scene

```sh
pnpm diorama-scene build                      # static/diorama/appi-kogen-scene.geojson
pnpm diorama-scene build path/to/x.geojson    # another resort's features → x-scene.geojson beside it
pnpm diorama-scene build path/to/x.geojson out/scene.geojson   # … written to the given path instead
pnpm diorama-scene build-all dir/ [--force]   # every *-ski-features.geojson in dir without a scene (or all)
```

Reads the runs and lifts in a ski features file (exported by [snowline](https://snowline.jp)
from openskidata.org, OpenStreetMap data), fits the same circle around them as the
/diorama-snow page, and reads what OpenStreetMap maps there from
[Overture Maps](https://overturemaps.org), which republishes it monthly as Parquet on S3. One
GeoJSON file comes out, each feature with a `kind`:

| `kind`     | Overture                                | OpenStreetMap                       | Properties                                 |
| ---------- | --------------------------------------- | ----------------------------------- | ------------------------------------------ |
| `wood`     | `base/land` subtype `forest`            | `natural=wood`, `landuse=forest`    | `leafType`                                 |
| `water`    | `base/water` polygons                   | lakes, ponds, reservoirs, riverbeds | `waterType`, `name`, `intermittent`        |
| `waterway` | `base/water` lines                      | `waterway=river`, `stream`, `canal` | `waterType`, `name`, `intermittent`        |
| `building` | `buildings/building`                    | `building=*`, plus other footprints | `height`, `levels`, `buildingType`, `name` |
| `road`     | `transportation/segment` subtype `road` | `highway=*` except paths            | `roadClass`, `name`                        |
| `carpark`  | `base/infrastructure` class `parking`   | `amenity=parking`                   | `name`                                     |

Paths (footways, trails, steps, cycleways, bridleways, sidewalks, crossings and pedestrian
streets) are left out of the roads; tracks stay in. DuckDB (in-process, via `@duckdb/node-api`)
reads just the row groups overlapping the area, the layers in parallel, with no API or rate
limit in the way; its `httpfs` and `spatial` extensions are downloaded once into `~/.duckdb`.
Nearly all of a build's time goes on reading the footers of Overture's Parquet files (over a
minute for the 500-odd building files), not on the rows, so a lone `build` takes a minute or two
whatever the resort. `build-all` shares one DuckDB session with those footers cached across every
resort in the directory: the first is as slow as a lone build, each after that takes a few
seconds, four at a time. Resorts that already have a scene are skipped unless `--force` is given;
one that fails is reported at the end without stopping the rest. A features file whose runs and
lifts need a circle wider than 15 km in radius is skipped as well, and listed at the end: it mixes
two resorts of the same name far apart (snowline's export has done this for 井川 and 八森), and
the buildings between them would run the tool out of memory. The features are clipped to
the circle's square and simplified to 2 m (buildings keep every corner) and written beside the
features file. Rerun after changing the runs or lifts; bump `OVERTURE_RELEASE` in the tool for
newer mapping.

Source: © OpenStreetMap contributors, ODbL, via Overture Maps. Some building footprints are
Overture's own (Microsoft and Google), with no OpenStreetMap id.

## tessera-classifier

```sh
pnpm tessera-classifier train ~/Downloads/appi-kogen-tessera-labels.geojson [more.geojson …]
pnpm tessera-classifier train ~/Downloads/tessera-labels.geojson
pnpm tessera-classifier predict static/diorama/appi-kogen-scene.geojson
pnpm tessera-classifier predict https://content.snowline.jp/terrain/niseko-scene.geojson \
  --scene-out data/tessera-classifier/niseko-scene.geojson
pnpm tessera-classifier predict-all [appi-kogen niseko …]
```

[Tessera](https://geotessera.org) publishes a 128-number embedding for every 10 m pixel of land
each year, from a year of Sentinel-1 and -2 imagery; pixels that look and change alike through the
year sit close together, so a simple classifier trained on a few labelled areas tells kinds of
ground apart well. The tool runs `src/lib/tessera`, the code the /tessera-classifier page trains
and predicts with in the browser, so a model or prediction from either works in the other.

The classes are defined on the /tessera-classifier page (**edit classes**): `woods` and `open`
ground to start, with a name, a colour and, for one to be mapped, the scene `kind` its areas
become (`woods` as `kind: wood`, which the dioramas plant trees in); one without is there to be
told apart from the rest. The list is kept in the browser and written into every labels file
exported, as `metadata.classes`, which is where `train` reads it from; a label naming a class no
file defines gets one of its own, unmapped. Labels from before the rename, `trees`, are read as
`woods`.

1. Label on the /tessera-classifier page: areas (or points) of each class, at least two of each
   and spread over the scene, and export them. The labels file is GeoJSON with a `label` on each
   feature, which the geotessera `classify` examples read too. The page keeps each resort's
   labels apart; **export all _n_ resorts** writes them as one `tessera-labels.geojson`, each
   label marked with its `locationId`, and dropping that file back on the page returns each
   to its resort.
2. `train` reads the embedding of every pixel under each area (up to 400 an area, `--per-area`)
   and at each point, and fits logistic regression on them scaled to unit length, a class against
   the rest, for every class with labels. Its L2 penalty is picked from five by how well it does
   on labels held out a whole label at a time: the honest number, as pixels of one area are too
   alike to test each other. The model is a JSON file of 128 weights and a bias a class, with the
   classes it learned, `data/tessera-classifier/model.json` unless `-o` says otherwise. Train
   on the labels of several resorts at once, the file of all of them or several of one each,
   for one model that works across them all; the page's **train on _n_ resorts** does the same.
   Models aren't merged: a model is only as general as the labels it was trained on.
3. `predict` maps the chance of each class over the scene's square (its `metadata.bounds`),
   traces where a mapped class's crosses 0.5 (`--threshold`) with marching squares, drops areas
   and holes under 600 m² (`--min-area`), and writes the rest beside the scene as
   `<name>-tessera.geojson` (under `data/tessera-classifier/` for a URL): polygons of the class's
   `kind` with `source: "tessera"`, its `class`, an `areaM2` and a `confidence`, the chances as an
   image in the metadata, and how they compare with the scene's own features of that kind.
   `--scene-out` writes the scene with its features of the mapped kinds swapped for these, which
   the dioramas read unchanged.
4. `predict-all` runs `predict` over every resort the app lists (`static/terrain-locations.json`,
   or the ids given), reading `<id>-scene.geojson` from snowline's terrain files
   (`../snowline-data/terrain`, `--dir`) and writing `<id>-woods.geojson` beside each.
   Files already there are left alone unless `--force`, so a stopped run picks up where it
   left off; a resort that fails is listed at the end. The embeddings it reads, about 50 MB a
   resort, aren't kept unless `--cache`.
5. The Snow Diorama and the Snowboard Sim plant trees in a resort's `<id>-woods.geojson`, once
   uploaded, in place of its scene's woods; the Snow Diorama switches between the two to
   compare, and warns when the file was made over another square than the scene's. Its
   **load tessera woods** plants a prediction from disk instead, without uploading it; reload
   or change resort to drop it.
6. Drop the prediction on the /tessera-classifier page to see where it went wrong, label more
   there, and train again.

Embeddings are read with [zarrita](https://github.com/manzt/zarrita.js) straight from the public
Zarr stores geotessera's `GeoTesseraZarr` reads: Tessera 1.1 (`v1.1-dclimate`, the one it
recommends) for 2025 unless `train --version v1|v1.1|v2 --year …` says otherwise. Each release
is filled in a year at a time, so a place can have only a few years in one (Appi has 2018–2025
in 1.1, 2020–2024 in 1.0, 2017 and 2024 in the 2 beta); the page offers only the years at the
square, and keeps a model for each release and year to compare. A model remembers its release
and year and `predict` reads the same, as releases are not comparable. A scene's square is about
50 MB, kept in `data/tessera-classifier/zarr-cache` (safe to delete) and, on the page, by the
browser's Cache API. The scales that turn the int8 embeddings back into floats are only read for
where there is data, as a unit-length embedding doesn't change with them.

Source: Tessera, University of Cambridge EEG and dClimate, CC BY-SA.

## diorama-glb

```sh
pnpm diorama-glb build static/diorama/appi-kogen-ski-features.geojson
pnpm diorama-glb build x.geojson --provider=gsi --rings=320 --exaggeration=1.5 --contours=20
pnpm diorama-glb build x.geojson --out=path/to/model.glb
```

The GLB the Mountain Diorama page would export for the features in a GeoJSON file, built by
the same code without a browser: the circle is fitted around the runs and lifts (every feature
when the file has neither), terrain tiles are fetched from the chosen provider and the model
goes to `data/diorama/diorama_<lat>_<lon>_<radius>m.glb` (gitignored). The options and their
defaults are the page's; `help` lists them. Only providers that serve PNG tiles work here, as
Node has no WebP decoder.

Source: the terrain provider's, printed with the result.

## japan-train-lines

```sh
pnpm japan-train-lines download     # n02-19 railroad and station geojson → static/japan-train-lines/
pnpm japan-train-lines build        # prefectures, then index
pnpm japan-train-lines prefectures  # simplified prefecture boundaries → prefecture-polygons.json
pnpm japan-train-lines index        # company/line → region ids → line-region-index.json
```

Rerun `build` after changing the railroad GeoJSON or the regions in
`src/lib/train-lines/regions.js`; `index` reads both, plus the prefecture polygons.

Sources:

- `N02-19_RailroadSection.geojson`, `N02-19_Station.geojson`: 国土数値情報 鉄道データ (N02, 2019),
  国土交通省, <https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2019.html>, mirrored at
  content.liquidx.net.
- Prefecture boundaries: the `open-data-jp-prefectures-geojson` package (MIT), derived from
  国土数値情報 行政区域データ.
- `japan-outline.geojson` has no script: it was made with the
  [simplified-japan](https://observablehq.com/@liquidx/simplified-japan) notebook on Observable,
  derived from Simplified Earth, and carried over from liquidx-japan-train-lines.

## tokyo-outline

```sh
pnpm tokyo-outline build   # 国土数値情報 → src/lib/tokyo-outline/outline.json (bundled)
pnpm tokyo-outline dem     # 標高タイル → static/tokyo-outline/dem.bin and its dem.json
```

Downloads the 東京都 file of 国土数値情報 行政区域データ (N03, 2025), 国土交通省,
<https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2025.html>, into `data/tokyo-outline/`
(gitignored), then simplifies it to 20 m with [mapshaper](https://github.com/mbloch/mapshaper),
run through `pnpm dlx` so it isn't a dependency. mapshaper simplifies the shared topology, so
neighbouring municipalities keep one border between them.

The output has the mainland's coastline and internal borders, the coastline of the Izu
islands, and each municipality's own shape for filling and moving it separately. 小笠原村 and the uninhabited islets south of 青ヶ島 are left out.

`dem` bakes the elevation grid behind the page's contours and relief. It reads the 国土地理院
tiles through the `gsi-1m` provider of the shared terrain client, at z16 where the 1 m lidar
layer (dem1a) starts, falling back to 5 m and 10 m where that is unsurveyed, and averages them
into a 2048 × 1040 grid of 43 m cells over the mainland. Only the tiles with Tokyo under them
are fetched, about 7,900, which takes a few minutes; rerun it after `build` if the coastline
changes. `--zoom=15` or lower reads the coarser layers instead and is much quicker. The grid
is stored as 16-bit decimetres, row-delta encoded and deflated (see
`src/lib/tokyo-outline/dem.ts`).
