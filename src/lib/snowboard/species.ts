/**
 * Procedural trees: three kinds of tree built in code, a broad fir, a narrow spruce and a beech
 * bare for the winter, each bent and sized a little differently per tree in the vertex shader
 * and dusted with snow wherever a branch faces up. A distant tree, of whatever kind, is one cone.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { noiseTile } from './snow';

/** Nearer than this a tree is drawn as its own kind; past it, as a cone. */
const NEAR_RANGE = 600;
/** Chunks past this are not drawn: the fog has taken them. */
const RANGE = 5600;

/** What each vertex is: `treePart` picks its colour in the shader. */
const BARK = 0;
const NEEDLES = 1;
const GREY_BARK = 2;

interface Species {
	geometry: THREE.BufferGeometry;
	/** How wide its cone is from afar, against the fir's. */
	farWidth: number;
	/** Its colour from afar, from the darkest tree to the palest. */
	far: [string, string];
}

/** Tag every vertex of `geometry` as `part`. */
function part(geometry: THREE.BufferGeometry, value: number) {
	const n = geometry.getAttribute('position').count;
	geometry.setAttribute('treePart', new THREE.Float32BufferAttribute(new Array(n).fill(value), 1));
	return geometry;
}

/**
 * One tier of branches, `r` across and `h` tall from `base`: an underside running in from the
 * tips, and a top that climbs to the point, flatter near the tips if `shelf`, where snow lies.
 */
function tier(r: number, h: number, base: number, shelf: boolean) {
	const v = (x: number, y: number) => new THREE.Vector2(x, base + y);
	const profile = shelf
		? [v(0.25 * r, 0.35 * h), v(r, 0), v(0.6 * r, 0.38 * h), v(0, h)]
		: [v(0.25 * r, 0.3 * h), v(r, 0), v(0, h)];
	return part(new THREE.LatheGeometry(profile, 6), NEEDLES);
}

const trunk = (bottom: number, top: number, height: number) =>
	part(
		new THREE.CylinderGeometry(top, bottom, height, 5, 1, true).translate(0, height / 2, 0),
		BARK
	);

function fir(): Species {
	return {
		geometry: mergeGeometries([
			trunk(0.3, 0.22, 2.4),
			tier(2.2, 3.0, 1.4, true),
			tier(1.75, 2.7, 3.2, true),
			tier(1.3, 2.4, 4.9, true),
			tier(0.8, 2.3, 6.5, true)
		]),
		farWidth: 1,
		far: ['#2f5a3a', '#6f8d78']
	};
}

function spruce(): Species {
	return {
		geometry: mergeGeometries([
			trunk(0.25, 0.18, 2.8),
			tier(1.45, 2.2, 2.0, false),
			tier(1.2, 2.0, 3.5, false),
			tier(0.98, 1.9, 4.9, false),
			tier(0.75, 1.8, 6.3, false),
			tier(0.45, 2.0, 7.6, false)
		]),
		farWidth: 0.7,
		far: ['#24463a', '#5d7c70']
	};
}

/** A beech in winter: a trunk and a few forked limbs, the same tree each time it is built. */
function beech(): Species {
	let seed = 7;
	const random = () => {
		seed = (seed * 16807) % 2147483647;
		return seed / 2147483647;
	};
	const up = new THREE.Vector3(0, 1, 0);
	const limb = (from: THREE.Vector3, dir: THREE.Vector3, length: number, r0: number, r1: number) =>
		new THREE.CylinderGeometry(r1, r0, length, 3, 1, true)
			.translate(0, length / 2, 0)
			.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir))
			.translate(from.x, from.y, from.z);
	const parts = [
		new THREE.CylinderGeometry(0.12, 0.32, 6.5, 5, 1, true).translate(0, 3.25, 0),
		limb(new THREE.Vector3(0, 6.3, 0), new THREE.Vector3(0.1, 1, 0.05).normalize(), 2.5, 0.12, 0.03)
	];
	for (let i = 0; i < 6; i++) {
		const start = new THREE.Vector3(0, 2.6 + i * 0.75, 0);
		const around = i * 2.4 + random() * 0.6;
		const tilt = 0.55 + random() * 0.35;
		const dir = new THREE.Vector3(
			Math.sin(tilt) * Math.cos(around),
			Math.cos(tilt),
			Math.sin(tilt) * Math.sin(around)
		);
		const length = 3.6 - i * 0.35 + random() * 0.6;
		parts.push(limb(start, dir, length, 0.13, 0.04));
		for (const t of [0.5, 0.8]) {
			const fork = dir
				.clone()
				.add(new THREE.Vector3(random() - 0.5, 0.5, random() - 0.5))
				.normalize();
			parts.push(
				limb(start.clone().addScaledVector(dir, length * t), fork, length * 0.5, 0.05, 0.015)
			);
		}
	}
	return {
		geometry: mergeGeometries(parts.map((p) => part(p, GREY_BARK))),
		farWidth: 1.1,
		far: ['#6f675f', '#9a948c']
	};
}

/**
 * Which kind grows where: beech on the lower slopes, spruce taking over from the fir higher up.
 * `u` is a random number for the tree.
 */
function kindAt(y: number, u: number) {
	const beech = 0.6 * Math.min(1, Math.max(0, (1150 - y) / 400));
	const spruce = (1 - beech) * Math.min(0.65, Math.max(0.25, 0.25 + (y - 900) / 1000));
	return u < beech ? 2 : u < beech + spruce ? 1 : 0;
}

const linear = (hex: string) => new THREE.Color(hex);

/** The shader changes shared by near and far trees; `far` trees are cones, all needles. */
function treeShader(uniforms: Record<string, THREE.IUniform>, far: boolean) {
	return (shader: THREE.WebGLProgramParametersWithUniforms) => {
		Object.assign(shader.uniforms, uniforms);
		const define = far ? '#define TREE_FAR\n' : '';
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>
				${define}
				attribute float treePart;
				uniform float treeTime;
				varying float vTreePart;
				varying float vTreeSeed;
				varying float vTreeSnow;
				varying vec3 vTreeWorld;`
			)
			.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
				// Each tree's own random numbers, from where it stands.
				vec3 treeOrigin = instanceMatrix[3].xyz;
				float seed = fract(sin(dot(treeOrigin.xz, vec2(12.9898, 78.233))) * 43758.5453);
				vTreeSeed = seed;
				// More snow on the trees higher up.
				vTreeSnow = clamp(0.35 + (treeOrigin.y - 900.0) / 800.0, 0.2, 1.0) * mix(0.6, 1.0, fract(seed * 5.3));
				#ifdef TREE_FAR
				vTreePart = 1.0;
				#else
				vTreePart = treePart;
				float h = clamp(transformed.y / 10.0, 0.0, 1.0);
				float out_ = length(transformed.xz);
				// Fuller or slimmer, and fuller low down or high up.
				transformed.xz *= mix(0.82, 1.18, fract(seed * 7.13)) * (1.0 + (fract(seed * 3.71) - 0.5) * 0.3 * (1.0 - 2.0 * h));
				// Branch tips sag, the more under more snow.
				transformed.y -= step(0.5, treePart) * out_ * out_ * mix(0.02, 0.07, vTreeSnow);
				// A lean of its own, and a sway in the wind.
				vec2 lean = vec2(cos(seed * 6.2832), sin(seed * 6.2832));
				transformed.xz += lean * h * h * ((fract(seed * 11.3) - 0.5) * 0.9 + 0.07 * sin(treeTime * 1.3 + seed * 40.0));
				#endif`
			)
			.replace(
				'#include <project_vertex>',
				`#include <project_vertex>
				vTreeWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;`
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
				${define}
				uniform sampler2D treeNoise;
				uniform vec3 treeBark;
				uniform vec3 treeGreyBark;
				uniform vec3 treeSnowColor;
				varying float vTreePart;
				varying float vTreeSeed;
				varying float vTreeSnow;
				varying vec3 vTreeWorld;`
			)
			.replace(
				'#include <color_fragment>',
				`#include <color_fragment>
				#ifndef TREE_FAR
				// The instance colour is the needles'; bark has its own.
				vec3 bark = (vTreePart > 1.5 ? treeGreyBark : treeBark) * (0.85 + 0.3 * vTreeSeed);
				diffuseColor.rgb = vTreePart > 0.5 && vTreePart < 1.5 ? diffuseColor.rgb : bark;
				#endif`
			)
			.replace(
				'#include <normal_fragment_maps>',
				`#include <normal_fragment_maps>
				#ifdef TREE_FAR
				float treeWhite = 0.4 * vTreeSnow;
				#else
				// Snow lies where a face looks up, in patches.
				float up = dot(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
				float patches = texture2D(treeNoise, (vTreeWorld.xz + vTreeWorld.y * vec2(0.6, 0.8)) / 230.0).r;
				float treeWhite = smoothstep(0.45, 0.62, up + (patches - 0.5) * 0.6 + (vTreeSnow - 0.5) * 0.5);
				#endif
				diffuseColor.rgb = mix(diffuseColor.rgb, treeSnowColor, treeWhite);`
			);
	};
}

export interface SpeciesChunks {
	meshes: THREE.Object3D[];
	update(eye: THREE.Vector3): void;
	setShadows(on: boolean): void;
	dispose(): void;
}

/**
 * Instanced meshes for the trees in `spots` (x, y, z, scale, random, random: `stride` numbers
 * each), by chunk: a mesh per kind near by, one of cones for all of them far off.
 */
export function speciesChunks(spots: number[], stride: number, chunks: number[][]): SpeciesChunks {
	const kinds = [fir(), spruce(), beech()];
	const noise = noiseTile();
	const uniforms = {
		treeTime: { value: 0 },
		treeNoise: { value: noise },
		treeBark: { value: linear('#4a3526') },
		treeGreyBark: { value: linear('#7d776f') },
		treeSnowColor: { value: linear('#eef2f7') }
	};
	const material = (far: boolean) => {
		const m = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true });
		m.onBeforeCompile = treeShader(uniforms, far);
		m.customProgramCacheKey = () => (far ? 'tree-far' : 'tree-near');
		return m;
	};
	const nearMaterial = material(false);
	const farMaterial = material(true);
	// Any tree from afar: a cone the shape of the fir.
	const distant = part(
		new THREE.ConeGeometry(1.9, 8.6, 5, 1, true).translate(0, 1.6 + 4.3, 0),
		NEEDLES
	);

	const matrix = new THREE.Matrix4();
	const position = new THREE.Vector3();
	const turn = new THREE.Quaternion();
	const scale = new THREE.Vector3();
	const up = new THREE.Vector3(0, 1, 0);
	const tint = new THREE.Color();
	const farTints = kinds.map((k) => k.far.map(linear));
	const needles = [linear('#2b5236'), linear('#24463a')];
	const needlesPale = [linear('#46704f'), linear('#3a6152')];

	const meshes: THREE.Object3D[] = [];
	const built: {
		centre: THREE.Vector3;
		radius: number;
		near: THREE.InstancedMesh[];
		far: THREE.InstancedMesh;
	}[] = [];
	for (const list of chunks) {
		const byKind: number[][] = [[], [], []];
		for (const i of list) byKind[kindAt(spots[i * stride + 1], spots[i * stride + 5])].push(i);
		const far = new THREE.InstancedMesh(distant, farMaterial, list.length);
		const near: THREE.InstancedMesh[] = [];
		let n = 0;
		byKind.forEach((members, k) => {
			if (!members.length) return;
			const mesh = new THREE.InstancedMesh(kinds[k].geometry, nearMaterial, members.length);
			members.forEach((i, m) => {
				const [x, y, z, s, r] = spots.slice(i * stride, i * stride + 5);
				position.set(x, y - 0.5, z);
				turn.setFromAxisAngle(up, r * Math.PI * 2);
				const width = s * (0.85 + r * 0.3);
				scale.set(width, s, width);
				matrix.compose(position, turn, scale);
				mesh.setMatrixAt(m, matrix);
				// The beech has no needles, but a colour all the same, so every near tree shares one
				// shader and none is compiled mid-ride.
				if (k < 2) mesh.setColorAt(m, tint.copy(needles[k]).lerp(needlesPale[k], r));
				else mesh.setColorAt(m, tint.setRGB(1, 1, 1));
				scale.set(width * kinds[k].farWidth, s, width * kinds[k].farWidth);
				far.setMatrixAt(n, matrix.compose(position, turn, scale));
				far.setColorAt(n++, tint.copy(farTints[k][0]).lerp(farTints[k][1], r * 0.55));
			});
			mesh.computeBoundingSphere();
			mesh.matrixAutoUpdate = false;
			near.push(mesh);
		});
		// The sphere round the whole chunk is what lets the renderer skip it when out of view.
		far.computeBoundingSphere();
		far.matrixAutoUpdate = false;
		meshes.push(far, ...near);
		const sphere = far.boundingSphere!;
		built.push({ centre: sphere.center, radius: sphere.radius, near, far });
	}

	return {
		meshes,
		update(eye) {
			uniforms.treeTime.value = performance.now() / 1000;
			for (const chunk of built) {
				const d = chunk.centre.distanceTo(eye) - chunk.radius;
				for (const mesh of chunk.near) mesh.visible = d < NEAR_RANGE;
				chunk.far.visible = d >= NEAR_RANGE && d < RANGE;
			}
		},
		setShadows(on) {
			for (const chunk of built) for (const mesh of chunk.near) mesh.castShadow = on;
		},
		dispose() {
			for (const kind of kinds) kind.geometry.dispose();
			distant.dispose();
			noise.dispose();
			nearMaterial.dispose();
			farMaterial.dispose();
			for (const chunk of built) {
				chunk.far.dispose();
				for (const mesh of chunk.near) mesh.dispose();
			}
		}
	};
}
