# Data tools

Command-line tools that fetch, build and explore the data behind the prototypes. They're
TypeScript run directly by Node's type stripping, so shared code in `src/lib` uses relative
imports with `.ts` extensions. They're type-checked with the app by `pnpm check`.

| Command         | Prototype         | What it does                                                 |
| --------------- | ----------------- | ------------------------------------------------------------ |
| `pnpm ev-jp`    | EV Charging Japan | builds charger, distance-grid and route data from the source |
| `pnpm odpt`     | transit           | ODPT GTFS feeds and API (see `docs/TRANSIT.md`)              |
| `pnpm ekispert` | transit           | 駅すぱあと API (see `docs/TRANSIT.md`)                       |

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
