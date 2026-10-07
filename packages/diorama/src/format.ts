import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createTerrainMaterial, type TerrainMaterial } from './material.js';
import { createSurface, type DioramaSurface } from './surface.js';
import type { TerrainStyle } from './style.js';

/**
 * Settings and extents carried in the GLB (as `extras.diorama` on the mesh node) so a viewer
 * can render it the way it was exported and place things on it by longitude and latitude.
 */
export interface DioramaMeta {
	version: 2;
	/** Lowest and highest terrain elevation in metres. */
	minZ: number;
	maxZ: number;
	/** Ground radius in metres; the model itself is normalised to a radius of 1. */
	radius: number;
	/** Centre of the circle in degrees. */
	lon: number;
	lat: number;
	/**
	 * Layout of the top disc: a centre vertex, then `rings` rings. Ring k holds 6k vertices,
	 * unless `segments` is given: older files have that many on every ring.
	 */
	rings: number;
	segments?: number;
	exaggeration: number;
	/** Base thickness as a fraction of the radius. */
	baseDepth: number;
	/** Contour interval in metres, 0 disables. */
	contourInterval: number;
	/** Every nth contour is drawn heavier, 0 disables. */
	majorEvery: number;
}

/**
 * Custom vertex attributes the terrain shader reads. glTF requires custom attribute names to
 * start with an underscore; GLTFExporter adds it and upper-cases, GLTFLoader lower-cases.
 */
const ATTRIBUTES = ['elevation', 'contourMask', 'surfaceY'] as const;
const loadedName = (name: string) => '_' + name.toLowerCase();

const EXTRAS_KEY = 'diorama';

/** Serialise a diorama mesh (built with the terrain material's attributes) to a binary glTF. */
export async function exportDioramaGlb(mesh: THREE.Mesh, meta: DioramaMeta): Promise<Blob> {
	const previous = mesh.userData;
	mesh.userData = { ...previous, [EXTRAS_KEY]: meta };
	try {
		const out = (await new GLTFExporter().parseAsync(mesh, { binary: true })) as ArrayBuffer;
		return new Blob([out], { type: 'model/gltf-binary' });
	} finally {
		mesh.userData = previous;
	}
}

export interface LoadedDiorama {
	/** The terrain mesh, ready to add to a scene. */
	mesh: THREE.Mesh;
	/** Settings stored in the file; null for GLBs without them. */
	meta: DioramaMeta | null;
	/** The terrain material; null when the file lacks the attributes its shader needs. */
	terrain: TerrainMaterial | null;
	/** Longitude/latitude lookups on the mesh; null without `meta`. */
	surface: DioramaSurface | null;
	dispose(): void;
}

/**
 * Bring the stored settings up to the current version. Version 1 files did not record the
 * disc layout, which is recovered from the vertex counts: after the disc come three vertices
 * for each one on its rim (wall top, wall bottom and bottom cap) and one for the middle of the
 * bottom. Null when the file has no usable settings, such as a version 1 file exported
 * without its centre.
 */
function readMeta(mesh: THREE.Mesh): DioramaMeta | null {
	const raw = mesh.userData[EXTRAS_KEY] as (Partial<DioramaMeta> & { version: number }) | undefined;
	if (!raw) return null;
	if (raw.version === 2) return raw as DioramaMeta;
	const mask = mesh.geometry.getAttribute('contourMask');
	if (raw.version !== 1 || raw.lon === undefined || raw.lat === undefined || !mask) return null;
	let top = 0;
	while (top < mask.count && mask.getX(top) > 0.5) top++;
	const rim = (mask.count - top - 1) / 3;
	if (!Number.isInteger(rim) || rim < 3) return null;
	// 6k vertices on ring k: the rim holds 6 × rings and the disc 1 + 3 × rings × (rings + 1).
	const even = rim / 6;
	if (Number.isInteger(even) && top === 1 + 3 * even * (even + 1)) {
		return { ...(raw as DioramaMeta), version: 2, rings: even };
	}
	// Otherwise the same number on every ring.
	const rings = (top - 1) / rim;
	if (!Number.isInteger(rings) || rings < 1) return null;
	return { ...(raw as DioramaMeta), version: 2, rings, segments: rim };
}

/**
 * Load a diorama GLB from a URL, Blob or ArrayBuffer and give it the terrain material, in
 * `style` when given.
 */
export async function loadDioramaGlb(
	src: string | Blob | ArrayBuffer,
	style?: TerrainStyle
): Promise<LoadedDiorama> {
	const loader = new GLTFLoader();
	const gltf =
		typeof src === 'string'
			? await loader.loadAsync(src)
			: await loader.parseAsync(src instanceof Blob ? await src.arrayBuffer() : src, '');

	let mesh: THREE.Mesh | undefined;
	gltf.scene.traverse((o) => {
		if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
	});
	if (!mesh) throw new Error('No mesh in GLB');
	mesh.removeFromParent();
	mesh.updateMatrix();
	mesh.castShadow = true;
	mesh.receiveShadow = true;

	const geometry = mesh.geometry;
	let terrain: TerrainMaterial | null = null;
	if (ATTRIBUTES.every((a) => geometry.hasAttribute(loadedName(a)))) {
		for (const a of ATTRIBUTES) {
			geometry.setAttribute(a, geometry.getAttribute(loadedName(a)));
			geometry.deleteAttribute(loadedName(a));
		}
		terrain = createTerrainMaterial(style);
		const old = mesh.material as THREE.Material;
		mesh.material = terrain.material;
		old.dispose();
	}

	const meta = terrain ? readMeta(mesh) : null;
	if (terrain && meta) {
		terrain.uniforms.uInterval.value = meta.contourInterval;
		terrain.uniforms.uMajorEvery.value = meta.majorEvery;
		terrain.uniforms.uExaggeration.value = meta.exaggeration;
		terrain.setElevationRange(meta.minZ, meta.maxZ);
	} else if (terrain) {
		// No settings to go by: take the elevation range from the mesh itself.
		const elevation = geometry.getAttribute('elevation');
		let minZ = Infinity,
			maxZ = -Infinity;
		for (let i = 0; i < elevation.count; i++) {
			const z = elevation.getX(i);
			if (z < minZ) minZ = z;
			if (z > maxZ) maxZ = z;
		}
		terrain.setElevationRange(minZ, maxZ);
	}

	const loaded = mesh;
	return {
		mesh: loaded,
		meta,
		terrain,
		surface: meta ? createSurface(geometry, meta) : null,
		dispose() {
			loaded.geometry.dispose();
			if (terrain) terrain.dispose();
			else (loaded.material as THREE.Material).dispose();
		}
	};
}
