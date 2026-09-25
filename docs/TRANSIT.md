# Transit data

Code for ingesting Japanese rail timetables, as groundwork for train-timing visualisations.

- `src/lib/transit/gtfs/` — GTFS / GTFS-JP parsing (`parseGtfsZip`), a compact `Timetable`, service calendars, and `positionsAt()` which interpolates every running train's position at a moment in time.
- `src/lib/transit/odpt/` — catalog of ODPT rail GTFS feeds and an `OdptClient` for files and the JSON-LD API.
- `src/lib/transit/ekispert/` — `EkispertClient` for 駅すぱあと API, with normalisers that flatten its JSON (single objects vs arrays, string numbers, RRRGGGBBB colours).

Relative imports inside `src/lib/transit` use `.ts` extensions so the CLIs run directly under Node's type stripping.

## Keys (`.env`)

| Variable                      | Covers                                                                     |
| ----------------------------- | -------------------------------------------------------------------------- |
| `ODPT_ACCESS_TOKEN`           | basic-license feeds (Tokyo Metro, TX, Rinkai, Tama Monorail, Yokohama)     |
| `ODPT_CHALLENGE_ACCESS_TOKEN` | Open Data Challenge feeds (Keio, JR East, Tobu, Sotetsu); contest use only |
| `EKISPERT_API_KEY`            | 駅すぱあと API trial / free plan                                           |

Toei is CC BY 4.0 on `api-public.odpt.org` and needs no token.

## CLI

```sh
pnpm odpt feeds                         # what's available and what your tokens cover
pnpm odpt fetch --all                   # download every accessible feed to data/odpt/gtfs/
pnpm odpt info toei                     # routes, trip counts, service span today
pnpm odpt at toei --time 08:15          # every train's interpolated position
pnpm odpt export toei --date 20260926   # compact JSON day timetable for the browser
pnpm odpt query Station --operator Toei --access public

pnpm ekispert station 三鷹台
pnpm ekispert route 三鷹台 九段下 --time 0830 --stops --shape
pnpm ekispert timetable 三鷹台           # directions, then --code N for departures
pnpm ekispert train <trainCode>
pnpm ekispert raw operationLine name=京王
```

Downloaded data lives in `/data/` (gitignored).

## Notes

- ODPT GTFS feeds have no `shapes.txt`; positions are straight-line between stations. Track geometry could come from Ekispert `course/shape`, ODPT `odpt:Railway`, or OSM.
- GTFS times can exceed 24:00; `positionsAt` also checks the previous service day.
- Through-running (e.g. Keio ↔ Toei Shinjuku Line) is split across operator feeds; `block_id` may link them.
- Ekispert trial keys limit `/station`, `/rail` and `/corporation` to Hokkaido, Tokyo, Kanagawa and Osaka. The free plan only allows `/station` and `/search/course/light`, which returns a link to a results page, not route data.
- Ekispert coordinates default to the Tokyo datum; the client always requests `gcs=wgs84`.
