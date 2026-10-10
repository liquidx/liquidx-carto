# @liquidx/diorama

Svelte 5 component for terrain dioramas: a circular core of terrain, from a GLB exported by the
Mountain Diorama tool in liquidx-carto or built from your own elevation data. It draws the
terrain in a style you choose (a printed-map look, snow, or your own), and lets you draw on
the surface and stand objects and labels on it by longitude and latitude.

## Install

Peer dependencies: `svelte` 5 and `three`.

From a packed tarball:

```sh
cd packages/diorama && pnpm pack        # builds dist/ and writes liquidx-diorama-<version>.tgz
cd ~/my-app && pnpm add three /path/to/liquidx-diorama-0.6.0.tgz
```

Publishing works as well (`pnpm publish` from this folder): `publishConfig` points the exports at
the built `dist/` files. Inside this repo the package resolves to `src/` directly, so there is
no build step during development.

## Use

```svelte
<script lang="ts">
	import { Diorama, Drape } from '@liquidx/diorama';
	import pistes from './pistes.json';
</script>

<div style="height: 480px">
	<Diorama src="/models/hakuba.glb" terrain="snow">
		<Drape data="/data/forest.geojson" paint={{ fill: '#2f5d3a66' }} />
		<Drape data={pistes} paint={(f) => ({ stroke: f.properties?.color, width: 4 })} />
	</Diorama>
</div>
```

The component fills its parent, so give the parent a height. It uses WebGL, so it only renders
in the browser. It renders nothing during SSR and needs no `ssr = false`.

| Prop                 | Type                                    | Default         |
| -------------------- | --------------------------------------- | --------------- |
| `src`                | `string \| Blob \| ArrayBuffer \| null` |                 |
| `data`               | a mesh from `buildDiorama`              |                 |
| `exaggeration`       | relief of `data`                        | `1`             |
| `baseDepth`          | base thickness of `data`, in radii      | `0.25`          |
| `terrain`            | `'topo' \| 'snow' \| TerrainStyle`      | `'topo'`        |
| `contourInterval`    | metres, 0 disables                      | value from file |
| `majorEvery`         | every nth contour heavier, 0 disables   | value from file |
| `drapeResolution`    | pixels across the overlay texture       | `2048`          |
| `objectScale`        | enlarges objects placed on the terrain  | `1`             |
| `sun`                | `{ azimuth, elevation, intensity }`     | south-west, 48° |
| `background`         | CSS colour behind the model             | transparent     |
| `backgroundGradient` | backdrop shading, 0 to 1                | `0.5`           |
| `autoRotate`         | `boolean`, bindable                     | `true`          |
| `rotateSpeed`        | `number`                                | `1.2`           |
| `rotateButton`       | play/pause overlay for `autoRotate`     | `false`         |
| `minDistance`        | closest zoom, in radii of the model     | `0.8`           |
| `onload`             | `(meta: DioramaMeta \| null) => void`   |                 |
| `onerror`            | `(error: unknown) => void`              |                 |
| `class`              | `string`                                |                 |

The background is transparent unless you set it. Pass `background` (any CSS colour) for a
backdrop shaded like a studio: brighter behind the model, darker towards the corners.
`backgroundGradient` sets how strong that shading is, from 0 (flat) to 1; it defaults to 0.5.
For anything else, such as an image, set the `--diorama-background` CSS custom property to any
CSS background instead.

`rotateButton` puts a play/pause button in the bottom-right corner, a translucent dark circle
that stops and starts the rotation. Bind `autoRotate` to keep your own controls in step with
it. Restyle it with `--diorama-rotate-size`, `--diorama-rotate-inset`,
`--diorama-rotate-background` and `--diorama-rotate-color`.

Bind the component to call `glb()`, which returns the terrain on show as a GLB blob that `src`
can load again. Layers are not part of the file.

## Building the terrain

Instead of a file, you can build the mesh from any elevation lookup and pass it as `data`.
The relief can then be changed without rebuilding:

```svelte
<script lang="ts">
	import { Diorama, buildDiorama, type Sampler } from '@liquidx/diorama';

	// Elevation in metres at a longitude and latitude, NaN where there is none.
	const sample: Sampler = (lon, lat) => elevationAt(lon, lat);
	const data = buildDiorama(sample, { lon: 138.7274, lat: 35.3606, radius: 7000 }, { rings: 220 });
	let exaggeration = $state(1.5);
</script>

<Diorama {data} {exaggeration} baseDepth={0.25} contourInterval={50} />
```

The component takes the mesh over: it sets the heights and disposes of the geometry when
`data` changes or the component goes away. Changing `exaggeration` or `baseDepth` recreates
the children, so objects and labels land on the new surface.

## Terrain styles

`terrain` takes a preset name or a `TerrainStyle`. To make your own, spread a preset from
`terrainStyles` and override parts of it:

```ts
import { terrainStyles, type TerrainStyle } from '@liquidx/diorama';

const dusk: TerrainStyle = {
	...terrainStyles.snow,
	ramp: [
		[0, '#c9d3e6'],
		[1, '#fff4ea']
	],
	contours: { color: '#5b6b8c', strength: 0.4 }
};
```

| Field       | Meaning                                                                                |
| ----------- | -------------------------------------------------------------------------------------- |
| `ramp`      | colour by elevation, as `[stop, colour]` pairs                                         |
| `rampUnits` | `normalized` (default): stops run 0–1 over the model's range. `metres`: real elevation |
| `slope`     | `{ color, from, to }`: tint steep ground between two angles in degrees                 |
| `contours`  | `{ color, strength }`, or `false` to hide them                                         |
| `sides`     | `{ topLayer, topLayerDepth, strata: [a, b] }` for layered earth, or `{ color }` flat   |
| `roughness` | 0–1, default 0.9                                                                       |
| `surface`   | your own GLSL for the surface colour                                                   |
| `uniforms`  | values for the uniforms `surface` uses                                                 |

`surface` defines one function. It receives the ramp and slope colour and returns the colour
to use; overlays, contours and lighting are applied afterwards. `elevation` is in metres,
`slope` in degrees, `normal` is in model space with y up, and `uv` runs 0–1 west to east and
north to south. Colours are linear RGB.

```ts
const snowline: TerrainStyle = {
	...terrainStyles.snow,
	uniforms: { uSnowline: 1600, uGrass: '#5f7f4a' },
	surface: `vec3 surface(vec3 base, float elevation, float slope, vec3 normal, vec2 uv) {
		return mix(uGrass, base, smoothstep(uSnowline - 80.0, uSnowline + 80.0, elevation));
	}`
};
```

Uniforms are declared for you from their values: a number is a `float`, a colour string a
`vec3`, an array of 2 to 4 numbers a vector and a three.js texture a `sampler2D`. Changing a
value is cheap. Changing the GLSL, or adding or removing a uniform, recompiles the shader.

## Drape

`<Drape>` draws on the terrain surface, following the relief. Put any number inside
`<Diorama>`. They stack in the order they appear, also when `{#if}` and `{#each}` add and
remove them.

| Prop      | Type                                            | Default        |
| --------- | ----------------------------------------------- | -------------- |
| `data`    | GeoJSON, an array of GeoJSON, or a URL          |                |
| `filter`  | `(feature) => boolean`                          |                |
| `paint`   | `DrapePaint \| (feature) => DrapePaint \| null` | thin dark line |
| `image`   | URL or anything a canvas can draw               |                |
| `bounds`  | `[west, south, east, north]` of `image`         |                |
| `draw`    | `(ctx, view) => void`                           |                |
| `opacity` | `number`                                        | `1`            |
| `units`   | `'px' \| 'm'`                                   | `'px'`         |
| `above`   | draw over the contour lines instead of under    | `false`        |

`data` can be a `FeatureCollection`, a `Feature`, a bare geometry or an array mixing them, in
longitude and latitude (WGS84). Lines, polygons and points are all drawn, and multi-geometries
are split up. `DrapePaint` is `{ fill, stroke, width, dash, radius }` with CSS colours. Sizes
are in pixels with the diorama 1024 pixels across, or in metres on the ground with
`units="m"`.

`draw` gets a canvas context and a `view` with `project([lon, lat])`, `metres(n)` and `size`.
State read inside `paint` and `filter` redraws the drape when it changes. `draw` runs outside
that tracking, so pass a new function to redraw it.

All drapes share one texture of `drapeResolution` pixels, so very fine detail softens when you
zoom far in on a large model.

## Objects

Placeholder 3D objects that stand on the terrain. They are deliberately simple, and each is a
short example of building a layer with `getDiorama()`; copy one as a starting point for your
own.

```svelte
<Diorama src="/models/appi.glb" terrain="snow" objectScale={4}>
	<Trees data={skiArea} avoid={runs} clearance={30} />
	<Carpet data={lifts} filter={(f) => f.properties?.liftType === 'magic_carpet'} speed={0.7} />
	<Lift
		data={lifts}
		carrier={(f) => (f.properties?.liftType === 'gondola' ? 'cabin' : 'chair')}
		speed={4}
	/>
	<Riders data={runs} every={90} speed={(f) => (f.properties?.difficulty === 'easy' ? 8 : 12)} />
	<Building data={footprints} height={(f) => f.properties?.height ?? 9} />
	<Building at={[140.9715, 40.0017]} footprint={[60, 24]} height={14} />
	<Model src="/models/hut.glb" data={peaks} size={40} heading={200} />
	<Marker data={peaks} />
</Diorama>
```

| Component  | Reads               | Draws                                                  | Main props                                                                |
| ---------- | ------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------- |
| `Trees`    | polygons            | conifers scattered over each area                      | `density` (per km²), `height`, `variation`, `color`, `avoid`, `clearance` |
| `Lift`     | lines               | towers, cables, end stations and moving carriers       | `towerEvery`, `height`, `color`, `carrier`, `carrierEvery`, `speed`       |
| `Carpet`   | lines               | a magic carpet: a moving belt on the ground, railed    | `width`, `color`, `railColor`, `speed`                                    |
| `Riders`   | lines               | snowboarders carving down each run                     | `every`, `speed`, `height`, `carve`, `colors`                             |
| `Building` | polygons and points | a footprint extruded with a flat roof, or a gabled box | `height`, `footprint` (`[width, depth]`), `heading`, `color`, `roofColor` |
| `Model`    | points              | copies of your own glTF, GLB or three.js object        | `src`, `size` (longest side), `heading`, `altitude`                       |
| `Marker`   | points              | a pin                                                  | `height`, `head` (width of the ball), `color`                             |

They all take `data` and `filter` like `Drape`, so several can read the same file. `Building`,
`Model` and `Marker` also take `at={[lon, lat]}` for a single position. Sizes are in metres.
A `Building` that would reach past the rim of the diorama is left out.
Props typed as `PerFeature` (colours, sizes, headings, the carrier props, the `clearance` of
`Trees` from each thing it avoids) accept a value or a function of the feature.

`Lift` hangs a `carrier` (`'chair'` or `'cabin'`, `carrierSize` metres wide: a chair seats one
a 0.55 m, a cabin is a little longer than wide) every `carrierEvery` metres round the loop, up
the right of the line and back down the left. Give it a `speed` in metres a second and they
travel; at 0, the default, they stand still. With `shuttle` a line is an aerial tramway
instead: two carriers, one on each side, going up and down their own side and passing halfway.
With a `clearance` the towers stand taller than `height` wherever the ground bulges up under
the cable, to keep it that many metres clear. A `stationModel` stands your own glTF at each end in place of the built-in station: origin on
the ground where the line ends, facing +z along it. Its `Mast` node is stretched and its `Head`
raised to the `height` of the cable, and its `Bullwheel` turns with the carriers.
For a rope tow, lower the `height` to arm's reach, turn the `stations` at the ends off and make
the `carrier` a `'ball'`.

To hang your own carrier, give `carrierModel` the URL of a glTF or GLB (or a three.js object):
in metres, the cable through its origin, facing +z. It keeps its own materials, so
`carrierSize` and `carrierColor` do not apply. `carrierParts` poses its named nodes: `false`
leaves one out, and a number swings it open from 0 to 1 by the `openRotationX` in its extras.

```svelte
<Lift data={lifts} carrierModel="/models/chair.glb" carrierParts={{ Hood: 1, SafetyBar: false }} />
```

The package comes with the lift models used in liquidx-carto, under
`@liquidx/diorama/models/`: `chairlift-1.glb` (a single chair on a bent pole),
`chairlift-2.glb` and `chairlift-4.glb` (chairs with a `Hood`),
`gondola.glb`, `ropeway.glb` (a cable car cabin) and `lift-station.glb` (a `stationModel`).
Import one as a URL, which a bundler such as Vite does with `?url`, and pass it on:

```svelte
<script>
	import chair from '@liquidx/diorama/models/chairlift-4.glb?url';
	import station from '@liquidx/diorama/models/lift-station.glb?url';
</script>

<Lift data={lifts} carrierModel={chair} stationModel={station} carrierParts={{ Hood: false }} />
```

`Riders` sends a snowboarder down each line every `every` metres, from its high end to its
low end whichever way the line is drawn, at `speed` metres a second on average (10 by
default, about 36 km/h; each rider is a little faster or slower). They carve `carve` metres
either side of the line, lean into their turns and start again at the top when they reach the
bottom.

The defaults are true to life: a 14 m tree, a 10 m lift tower, a chair 2.2 m wide. On a model
several kilometres across that makes each one a speck, which shows how big the mountain is;
lower `minDistance` on `<Diorama>` so the view can zoom in to them. To have them read from
afar instead, set `objectScale` to enlarge every object. Positions and spacing stay true; only
the objects grow.

## North and light

`<Compass>` sits in a corner of the diorama. Its red needle points to where north is on
screen and turns with the view; clicking it swings the view round to north-up.

```svelte
<Diorama src="/models/appi.glb" sun={{ azimuth: 315, elevation: 35 }}>
	<Compass sun />
</Diorama>
```

| Prop     | Type                                                           | Default       |
| -------- | -------------------------------------------------------------- | ------------- |
| `corner` | `'top-left' \| 'top-right' \| 'bottom-left' \| 'bottom-right'` | `'top-right'` |
| `sun`    | mark the side the light comes from with a dot on the rim       | `false`       |
| `label`  | accessible name of the button                                  |               |
| `class`  | `string`                                                       |               |

Restyle it with `--diorama-compass-size`, `--diorama-compass-inset`, `--diorama-compass-color`,
`--diorama-compass-face`, `--diorama-compass-north` and `--diorama-compass-sun`.

The `sun` prop on `<Diorama>` sets where the light comes from. `azimuth` is a compass bearing
in degrees, clockwise from north, so 90 lights the terrain from the east. `elevation` is the
sun's height above the horizon in degrees, and `intensity` its brightness. Fields you leave
out keep the default: a sun in the south-west (231°) at 48°, intensity 1.7. A weak fill light
stays on the opposite side so shaded slopes keep their shape. In the model, north is -z, east
is +x and up is +y.

## Labels

`<Label>` floats text or any markup over a place and follows it as the view turns.

```svelte
<Label data={lifts} text={(f) => f.properties?.name} />
<Label at={[140.9597, 39.978]} altitude={95}>
	{#snippet children()}<strong>1304 m</strong>{/snippet}
</Label>
```

| Prop        | Type                                  | Default |
| ----------- | ------------------------------------- | ------- |
| `data`      | GeoJSON, an array of GeoJSON, or URL  |         |
| `at`        | `[lon, lat]`, instead of `data`       |         |
| `filter`    | `(feature) => boolean`                |         |
| `text`      | `(feature) => string`                 |         |
| `children`  | snippet given the feature             |         |
| `altitude`  | metres above ground, × `objectScale`  | `30`    |
| `declutter` | hide labels that overlap earlier ones | `true`  |
| `class`     | `string`                              |         |

A point is labelled where it is, a line at its midpoint and a polygon at its centre. A label
fades out while the terrain is in front of it. Objects such as trees do not hide labels, and
decluttering only compares labels from the same `<Label>`.

Style labels with `class`, or with the custom properties `--diorama-label-color`,
`--diorama-label-halo` and `--diorama-label-size`.

## Your own layers

A component inside `<Diorama>` can call `getDiorama()` to place things on the terrain. Children
only exist while a model is loaded and are recreated when it changes.

```svelte
<script lang="ts">
	import * as THREE from 'three';
	import { getDiorama } from '@liquidx/diorama';

	let { at }: { at: [number, number] } = $props();
	const diorama = getDiorama();

	const pin = new THREE.Mesh(
		new THREE.SphereGeometry(diorama.metres(60)),
		new THREE.MeshStandardMaterial({ color: '#d1345b' })
	);
	$effect(() => {
		diorama.project(at, 60, pin.position);
		diorama.group.add(pin);
		return () => void diorama.group.remove(pin);
	});
</script>
```

| Member                       | Meaning                                                  |
| ---------------------------- | -------------------------------------------------------- |
| `project(lonLat, altitude?)` | point on the surface in model space, metres above ground |
| `elevationAt(lonLat)`        | ground elevation in metres                               |
| `toModel(lonLat)`            | model x and z                                            |
| `contains(lonLat)`           | whether the position is inside the circle                |
| `metres(n)`                  | ground metres as model units                             |
| `meta`                       | the file's `DioramaMeta`                                 |
| `group`                      | a `THREE.Group` for your objects                         |
| `stage`                      | renderer, scene, camera and controls                     |
| `drapes`                     | the overlay compositor `Drape` draws through             |

A frame is only drawn when the view moves or something on the diorama changes, and the shadows
are kept from one frame to the next. Adding to `group` or removing from it redraws both. If you
change an object that is already there, call `stage.invalidate()` to draw a frame, or
`stage.invalidateShadows()` when it casts a shadow that should follow it. `stage.onFrame(fn)`
runs `fn` on every animation frame for animations; they call `stage.invalidate()` as they go.
The carriers of `Lift` and the `Riders` cast no shadows for this reason.

## Lower level

- `buildDiorama(sample, circle, mesh)` and `applyVertical(data, { exaggeration, baseDepth })`
  build the mesh; `dioramaMeta(data, settings)` gives the settings to export it with.
- `loadDioramaGlb(src, style?)` returns `{ mesh, meta, terrain, surface, dispose }` so you can
  put the model in your own three.js scene.
- `exportDioramaGlb(mesh, meta)` writes the format described below; `exportDioramaData(data,
settings, style?)` does the same for a mesh from `buildDiorama` without a stage, so it also
  runs in Node. `createDioramaMesh(data, style?)` is the mesh the component shows for `data`,
  and `dioramaFileName(circle)` the name the Mountain Diorama tool exports under.
- `createTerrainMaterial(style?)` returns the material with `setStyle`, `setElevationRange` and
  `setDrapes`.
- `createSurface(geometry, meta)` gives the longitude and latitude lookups for a mesh.
- `createStage(container)` sets up the renderer, camera, lights and orbit controls.

## GLB format

The GLB is a single mesh normalised to a radius of 1, with its heights already scaled by the
exaggeration used at export. On top of `POSITION`, `NORMAL` and `COLOR_0`, the mesh carries three
custom vertex attributes for the shader:

| glTF attribute | three.js name | Meaning                                                      |
| -------------- | ------------- | ------------------------------------------------------------ |
| `_ELEVATION`   | `elevation`   | real elevation in metres, which drives the contour lines     |
| `_CONTOURMASK` | `contourMask` | 1 on the terrain surface, 0 on the sides and bottom          |
| `_SURFACEY`    | `surfaceY`    | height of the terrain surface above the vertex (for topsoil) |

The mesh node's `extras.diorama` holds a `DioramaMeta` (version 2): elevation range, ground
radius, centre, the disc's `rings`, exaggeration, base depth and contour
settings. The top disc is a centre vertex followed by `rings` rings, with 6k vertices on ring
k so that triangles are evenly sized; older files instead record `segments`, the same count on
every ring. The centre and disc layout are what place longitude and latitude on the mesh.
Version 1 files load too, as long as they were exported with their centre. The terrain style
is not stored: the file holds the terrain, and each viewer chooses how to draw it.

Other glTF viewers ignore all of this and show the vertex colours instead. GLBs without these
attributes render with their own materials, and children of `<Diorama>` are not rendered.
