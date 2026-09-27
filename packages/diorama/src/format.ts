import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createTerrainMaterial, type ContourUniforms } from './material.js';

/**
 * Settings and extents carried in the GLB (as `extras.diorama` on the mesh node) so a viewer
 * can render it the way it was exported.
 */
export interface DioramaMeta {
	version: 1;
	/** Lowest and highest terrain elevation in metres. */
	minZ: number;
	maxZ: number;
	/** Ground radius in metres; the model itself is normalised to a radius of 1. */
	radius: number;
	/** Centre of the circle in degrees, when known. */
	lon?: number;
	lat?: number;
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
	/** Contour shader uniforms; null when the file lacks the attributes the shader needs. */
	uniforms: ContourUniforms | null;
	dispose(): void;
}

/** Load a diorama GLB from a URL, Blob or ArrayBuffer and give it the terrain material. */
export async function loadDioramaGlb(src: string | Blob | ArrayBuffer): Promise<LoadedDiorama> {
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
	const meta = (mesh.userData[EXTRAS_KEY] as DioramaMeta | undefined) ?? null;

	let uniforms: ContourUniforms | null = null;
	if (ATTRIBUTES.every((a) => geometry.hasAttribute(loadedName(a)))) {
		for (const a of ATTRIBUTES) {
			geometry.setAttribute(a, geometry.getAttribute(loadedName(a)));
			geometry.deleteAttribute(loadedName(a));
		}
		const terrain = createTerrainMaterial();
		uniforms = terrain.uniforms;
		if (meta) {
			uniforms.uInterval.value = meta.contourInterval;
			uniforms.uMajorEvery.value = meta.majorEvery;
			uniforms.uMinZ.value = meta.minZ;
		}
		const old = mesh.material as THREE.Material;
		mesh.material = terrain.material;
		old.dispose();
	}

	const loaded = mesh;
	return {
		mesh: loaded,
		meta,
		uniforms,
		dispose() {
			loaded.geometry.dispose();
			(loaded.material as THREE.Material).dispose();
		}
	};
}
