# Data tools

Command-line tools that fetch, build and explore the data behind the prototypes. They're
TypeScript run directly by Node's type stripping, so shared code in `src/lib` uses relative
imports with `.ts` extensions. They're type-checked with the app by `pnpm check`.

| Command                  | Prototype         | What it does                                                  |
| ------------------------ | ----------------- | ------------------------------------------------------------- |
| `pnpm ev-jp`             | EV Charging Japan | builds charger, distance-grid and route data from the source  |
| `pnpm japan-train-lines` | Japan Train Lines | downloads railway data, builds region polygons and line index |
| `pnpm diorama-woods`     | Snow Diorama      | fetches wooded areas from OpenStreetMap for a ski resort      |
| `pnpm odpt`              | transit           | ODPT GTFS feeds and API (see `docs/TRANSIT.md`)               |
| `pnpm ekispert`          | transit           | 駅すぱあと API (see `docs/TRANSIT.md`)                        |

Run any of them with `help` for their subcommands.

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

## diorama-woods

```sh
pnpm diorama-woods build                      # static/diorama/appi-kogen-woods.geojson
pnpm diorama-woods build path/to/x.geojson    # another resort's features → x-woods.geojson beside it
pnpm diorama-woods build path/to/x.geojson out/woods.geojson   # … written to the given path instead
```

Reads the runs and lifts in a ski features file, fits the same circle around them as the
/diorama-snow page, and reads the forest and wood areas there from
[Overture Maps](https://overturemaps.org)' `base/land` data: OpenStreetMap's `natural=wood` and
`landuse=forest`, republished monthly as Parquet on S3. DuckDB (in-process, via
`@duckdb/node-api`) reads just the row groups overlapping the area, about 15 s with no API or
rate limit in the way; its `httpfs` and `spatial` extensions are downloaded once into `~/.duckdb`.
The areas are clipped to the circle's square, simplified to 2 m and written beside the features
file. Rerun after changing the runs or lifts; bump `OVERTURE_RELEASE` in the tool for newer mapping.

Source: © OpenStreetMap contributors, ODbL, via Overture Maps.

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
