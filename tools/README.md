# Data tools

Command-line tools that fetch, build and explore the data behind the prototypes. They're
TypeScript run directly by Node's type stripping, so shared code in `src/lib` uses relative
imports with `.ts` extensions. They're type-checked with the app by `pnpm check`.

| Command                    | Prototype         | What it does                                                          |
| -------------------------- | ----------------- | --------------------------------------------------------------------- |
| `pnpm ev-jp`               | EV Charging Japan | builds charger, distance-grid and route data from the source          |
| `pnpm japan-train-lines`   | Japan Train Lines | downloads railway data, builds region polygons and line index         |
| `pnpm diorama-scene`       | Snow Diorama      | fetches woods, water, buildings, roads and car parks for a ski resort |
| `pnpm diorama-glb`         | Mountain Diorama  | exports the diorama GLB for a features file, without a browser        |
| `pnpm snowboard-locations` | Snowboard Sim     | lists the locations with a scene file, for the sim's location picker  |
| `pnpm odpt`                | transit           | ODPT GTFS feeds and API (see `docs/TRANSIT.md`)                       |
| `pnpm ekispert`            | transit           | 駅すぱあと API (see `docs/TRANSIT.md`)                                |

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

`data/ev-jp/` (gitignored) gets the full-attribute exports: `hokkaido_chargers_all.geojson`,
`hokkaido_chademo_dc.geojson`, `hokkaido_chargers_all.csv` and `hokkaido_outline.geojson`.

## diorama-scene

```sh
pnpm diorama-scene build                      # static/diorama/appi-kogen-scene.geojson
pnpm diorama-scene build path/to/x.geojson    # another resort's features → x-scene.geojson beside it
pnpm diorama-scene build path/to/x.geojson out/scene.geojson   # … written to the given path instead
tools/diorama-scene-multi.sh dir/             # every *-ski-features.geojson in dir without a scene
```

Reads the runs and lifts in a ski features file, fits the same circle around them as the
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
reads just the row groups overlapping the area, the layers in parallel, about a minute and a
half with no API or rate limit in the way; its `httpfs` and `spatial` extensions are downloaded
once into `~/.duckdb`. The features are clipped to the circle's square and simplified to 2 m
(buildings keep every corner) and written beside the features file. Rerun after changing the
runs or lifts; bump `OVERTURE_RELEASE` in the tool for newer mapping.

Source: © OpenStreetMap contributors, ODbL, via Overture Maps. Some building footprints are
Overture's own (Microsoft and Google), with no OpenStreetMap id.

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
- `japan-outline.geojson` has no script; it's carried over as-is from liquidx-japan-train-lines.
