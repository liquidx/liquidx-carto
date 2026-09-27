# @liquidx/diorama

Svelte 5 viewer for terrain dioramas exported as GLB from the Mountain Diorama tool in
liquidx-carto. It renders the model with the same shader as the tool: contour lines on the
terrain and a soil texture on the sides.

## Install

Peer dependencies: `svelte` 5 and `three`.

From a packed tarball:

```sh
cd packages/diorama && pnpm pack        # builds dist/ and writes liquidx-diorama-<version>.tgz
cd ~/my-app && pnpm add three /path/to/liquidx-diorama-0.1.0.tgz
```

Publishing works as well (`pnpm publish` from this folder): `publishConfig` points the exports at
the built `dist/` files. Inside this repo the package resolves to `src/` directly, so there is
no build step during development.

## Use

```svelte
<script lang="ts">
	import { DioramaViewer } from '@liquidx/diorama';
</script>

<div style="height: 480px">
	<DioramaViewer src="/models/fuji.glb" />
</div>
```

The viewer fills its parent, so give the parent a height. It uses WebGL, so it only renders in
the browser. It renders nothing during SSR and needs no `ssr = false`.

| Prop              | Type                                    | Default         |
| ----------------- | --------------------------------------- | --------------- |
| `src`             | `string \| Blob \| ArrayBuffer \| null` | —               |
| `contourInterval` | metres, 0 disables                      | value from file |
| `majorEvery`      | every nth contour heavier, 0 disables   | value from file |
| `autoRotate`      | `boolean`                               | `true`          |
| `rotateSpeed`     | `number`                                | `1.2`           |
| `onload`          | `(meta: DioramaMeta \| null) => void`   |                 |
| `onerror`         | `(error: unknown) => void`              |                 |
| `class`           | `string`                                |                 |

Set the background with the `--diorama-background` CSS custom property. It defaults to
transparent.

## Lower level

- `loadDioramaGlb(src)` returns `{ mesh, meta, uniforms, dispose }` so you can put the model in
  your own three.js scene.
- `exportDioramaGlb(mesh, meta)` writes the format described below.
- `createTerrainMaterial()` returns the material and its uniforms.
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

The mesh node's `extras.diorama` holds a `DioramaMeta`: elevation range, ground radius, centre,
exaggeration, base depth and contour settings. Other glTF viewers ignore all of this and show
the vertex colours instead. GLBs without these attributes render with their own materials.
