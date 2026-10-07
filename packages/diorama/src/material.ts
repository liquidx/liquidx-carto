import * as THREE from 'three';
import {
	RAMP_SIZE,
	terrainStyles,
	writeRamp,
	type TerrainStyle,
	type UniformValue
} from './style.js';

type U<T> = { value: T };

export interface TerrainUniforms {
	/** Contour interval in metres, 0 disables. */
	uInterval: U<number>;
	/** Every nth contour is drawn heavier, 0 disables. */
	uMajorEvery: U<number>;
	/** Vertical exaggeration of the mesh, so slopes can be read as real angles. */
	uExaggeration: U<number>;
	[name: string]: U<unknown>;
}

export interface TerrainMaterial {
	material: THREE.MeshStandardMaterial;
	uniforms: TerrainUniforms;
	/** Apply a style. Cheap unless the `surface` shader or its set of uniforms changed. */
	setStyle(style: TerrainStyle): void;
	/** Lowest and highest elevation of the model in metres, for normalised ramps. */
	setElevationRange(minZ: number, maxZ: number): void;
	/**
	 * Overlay textures projected straight down onto the surface: one under the contour lines
	 * and one over them, null for none. Expects premultiplied sRGB with `flipY` off.
	 */
	setDrapes(below: THREE.Texture | null, above: THREE.Texture | null): void;
	dispose(): void;
}

const DEFAULT_SURFACE = `vec3 surface(vec3 base, float elevation, float slope, vec3 normal, vec2 uv) { return base; }`;

const color = (c: THREE.ColorRepresentation) => new THREE.Color(c);

/** GLSL type and three.js value for a custom uniform. */
function customUniform(v: UniformValue): [type: string, value: unknown] {
	if (typeof v === 'number') return ['float', v];
	if (typeof v === 'string' || v instanceof THREE.Color) return ['vec3', color(v)];
	if (Array.isArray(v)) {
		if (v.length === 2) return ['vec2', new THREE.Vector2(...v)];
		if (v.length === 3) return ['vec3', new THREE.Vector3(...v)];
		if (v.length === 4) return ['vec4', new THREE.Vector4(...v)];
		throw new Error(`Uniform arrays need 2 to 4 numbers, got ${v.length}`);
	}
	return ['sampler2D', v];
}

/**
 * Standard material for a diorama mesh, styled by a `TerrainStyle`. The top surface (where the
 * `contourMask` attribute is 1) is coloured from the per-vertex `elevation` (real metres,
 * unaffected by exaggeration) through a ramp, then tinted by slope, passed through the style's
 * `surface` shader, covered by the drape overlays and given screen-space-constant contour
 * lines. Everywhere else (wall and bottom) gets a procedural soil texture: a top layer
 * following the terrain edge (`surfaceY`), horizontal strata, grain and pebbles.
 */
export function createTerrainMaterial(style: TerrainStyle = terrainStyles.topo): TerrainMaterial {
	const rampData = new Uint8Array(RAMP_SIZE * 4);
	const ramp = new THREE.DataTexture(rampData, RAMP_SIZE, 1, THREE.RGBAFormat);
	ramp.colorSpace = THREE.SRGBColorSpace;
	ramp.minFilter = ramp.magFilter = THREE.LinearFilter;

	const uniforms = {
		uInterval: { value: 20 },
		uMajorEvery: { value: 5 },
		uExaggeration: { value: 1 },
		uDrape: { value: null as THREE.Texture | null },
		uDrapeTop: { value: null as THREE.Texture | null },
		uDrapeOn: { value: 0 },
		uDrapeTopOn: { value: 0 },
		uLineColor: { value: color(0) },
		uLineStrength: { value: 0 },
		uRamp: { value: ramp },
		uRampRange: { value: new THREE.Vector2(0, 1) },
		uSlopeColor: { value: color(0) },
		uSlopeRange: { value: new THREE.Vector2(0, 90) },
		uSlopeStrength: { value: 0 },
		uSideTop: { value: color(0) },
		uStrataA: { value: color(0) },
		uStrataB: { value: color(0) },
		uSideColor: { value: color(0) },
		uSideFlat: { value: 0 }
	} satisfies TerrainUniforms;
	const all: TerrainUniforms = uniforms;
	const builtIn = new Set(Object.keys(uniforms));

	const material = new THREE.MeshStandardMaterial({ metalness: 0.0, flatShading: false });

	let current = style;
	let range: [number, number] = [0, 1];
	// The style's own shader: uniform declarations and the surface() function.
	let custom: Record<string, string> = {};
	let surface = DEFAULT_SURFACE;
	const customKey = () =>
		Object.entries(custom)
			.map(([name, type]) => `uniform ${type} ${name};`)
			.join('\n') +
		'\n' +
		surface;

	// Stop positions at the two ends of the ramp texture.
	let stops: [number, number] = [0, 1];

	function updateRampRange() {
		const [minZ, maxZ] = range;
		const metres = current.rampUnits === 'metres';
		uniforms.uRampRange.value.set(
			metres ? stops[0] : minZ + stops[0] * (maxZ - minZ),
			metres ? stops[1] : minZ + stops[1] * (maxZ - minZ)
		);
	}

	function setStyle(next: TerrainStyle) {
		current = next;
		stops = writeRamp(next.ramp, rampData);
		ramp.needsUpdate = true;
		updateRampRange();

		const { slope } = next;
		uniforms.uSlopeStrength.value = slope ? 1 : 0;
		if (slope) {
			uniforms.uSlopeColor.value.set(slope.color);
			uniforms.uSlopeRange.value.set(slope.from, Math.max(slope.to, slope.from + 1e-3));
		}

		const contours = next.contours === undefined ? terrainStyles.topo.contours : next.contours;
		uniforms.uLineStrength.value = contours ? contours.strength : 0;
		if (contours) uniforms.uLineColor.value.set(contours.color);

		const sides = next.sides ?? {};
		uniforms.uSideFlat.value = 'color' in sides ? 1 : 0;
		if ('color' in sides) uniforms.uSideColor.value.set(sides.color);
		else {
			const soil = terrainStyles.topo.sides;
			uniforms.uSideTop.value.set(sides.topLayer ?? soil.topLayer);
			uniforms.uStrataA.value.set(sides.strata?.[0] ?? soil.strata[0]);
			uniforms.uStrataB.value.set(sides.strata?.[1] ?? soil.strata[1]);
		}

		material.roughness = next.roughness ?? 0.9;

		// Custom shader: keep uniform objects stable so a value change needs no recompile.
		const before = customKey();
		const types: Record<string, string> = {};
		for (const [name, v] of Object.entries(next.uniforms ?? {})) {
			if (builtIn.has(name))
				throw new Error(`Uniform name "${name}" is used by the terrain shader`);
			const [type, value] = customUniform(v);
			types[name] = type;
			if (custom[name] === type) all[name].value = value;
			else all[name] = { value };
		}
		for (const name of Object.keys(custom)) if (!(name in types)) delete all[name];
		custom = types;
		surface = next.surface ?? DEFAULT_SURFACE;
		if (customKey() !== before) material.needsUpdate = true;
	}

	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, all);
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>
				attribute float elevation;
				attribute float contourMask;
				attribute float surfaceY;
				varying float vElevation;
				varying float vContourMask;
				varying float vSurfaceY;
				varying vec3 vSoilPos;
				varying vec3 vObjNormal;`
			)
			.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
				vElevation = elevation;
				vContourMask = contourMask;
				vSurfaceY = surfaceY;
				vSoilPos = position;
				vObjNormal = normal;`
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
				varying float vElevation;
				varying float vContourMask;
				varying float vSurfaceY;
				varying vec3 vSoilPos;
				varying vec3 vObjNormal;
				uniform float uInterval;
				uniform float uMajorEvery;
				uniform float uExaggeration;
				uniform vec3 uLineColor;
				uniform float uLineStrength;
				uniform sampler2D uRamp;
				uniform vec2 uRampRange;
				uniform vec3 uSlopeColor;
				uniform vec2 uSlopeRange;
				uniform float uSlopeStrength;
				uniform vec3 uSideTop;
				uniform vec3 uStrataA;
				uniform vec3 uStrataB;
				uniform vec3 uSideColor;
				uniform float uSideFlat;
				uniform sampler2D uDrape;
				uniform sampler2D uDrapeTop;
				uniform float uDrapeOn;
				uniform float uDrapeTopOn;
				float contourLine(float v, float width) {
					float f = fract(v);
					float d = fwidth(v);
					float dist = min(f, 1.0 - f);
					return 1.0 - smoothstep(0.0, d * width, dist);
				}
				float soilHash(vec3 p) {
					p = fract(p * 0.3183099 + 0.1);
					p *= 17.0;
					return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
				}
				float soilNoise(vec3 x) {
					vec3 i = floor(x);
					vec3 f = fract(x);
					f = f * f * (3.0 - 2.0 * f);
					return mix(
						mix(mix(soilHash(i), soilHash(i + vec3(1, 0, 0)), f.x),
							mix(soilHash(i + vec3(0, 1, 0)), soilHash(i + vec3(1, 1, 0)), f.x), f.y),
						mix(mix(soilHash(i + vec3(0, 0, 1)), soilHash(i + vec3(1, 0, 1)), f.x),
							mix(soilHash(i + vec3(0, 1, 1)), soilHash(i + vec3(1, 1, 1)), f.x), f.y),
						f.z);
				}
				// Round pebbles: 0..1 coverage from a jittered cell grid, 'density' of cells occupied.
				float pebbles(vec3 x, float density) {
					vec3 i = floor(x);
					vec3 f = fract(x);
					float cover = 0.0;
					for (int dz = -1; dz <= 1; dz++)
					for (int dy = -1; dy <= 1; dy++)
					for (int dx = -1; dx <= 1; dx++) {
						vec3 cell = i + vec3(dx, dy, dz);
						float h = soilHash(cell + 5.3);
						if (h > density) continue;
						vec3 centre = vec3(dx, dy, dz) + 0.2 + 0.6 * vec3(soilHash(cell), soilHash(cell + 1.7), soilHash(cell + 3.1));
						float r = 0.18 + 0.22 * soilHash(cell + 9.1);
						vec3 d = (f - centre) * vec3(1.0, 1.5, 1.0);
						cover = max(cover, 1.0 - smoothstep(r * 0.8, r, length(d)));
					}
					return cover;
				}
				// Colour of the earth at object-space p, 'depth' units below the terrain surface.
				vec3 soilColor(vec3 p, float depth) {
					float wobble = soilNoise(p * vec3(4.0, 1.0, 4.0)) - 0.5;
					// Horizontal strata, each band a slightly different tone.
					float band = floor((p.y + wobble * 0.06) * 24.0);
					float tone = soilHash(vec3(band, 3.1, 7.7));
					vec3 subsoil = mix(uStrataA, uStrataB, tone);
					subsoil = mix(subsoil, vec3(0.56, 0.52, 0.48), step(0.8, tone) * 0.8);
					// A top layer (humus-rich topsoil, or snow) hugging the surface with a ragged lower edge.
					float topEdge = 0.05 + wobble * 0.03 + (soilNoise(p * 25.0) - 0.5) * 0.015;
					vec3 c = mix(uSideTop, subsoil, smoothstep(topEdge - 0.008, topEdge + 0.012, depth));
					// Grain and clumps.
					float grain = soilNoise(p * 90.0) * 0.6 + soilNoise(p * 220.0) * 0.4;
					c *= 0.75 + 0.45 * grain;
					// Scattered pebbles, more of them deeper down.
					float pebbleMask = pebbles(p * 24.0, 0.12 + clamp(depth, 0.0, 0.3) * 0.5);
					vec3 stone = vec3(0.62, 0.60, 0.56) * (0.8 + 0.4 * soilNoise(p * 200.0));
					c = mix(c, stone, pebbleMask * 0.85);
					// Slightly darker and cooler towards the base.
					c *= 1.0 - clamp(depth, 0.0, 0.6) * 0.25;
					return c;
				}
				// Lay a canvas overlay (premultiplied sRGB) over a linear colour.
				vec3 drapeOver(vec3 base, sampler2D map, vec2 uv) {
					vec4 d = texture2D(map, uv);
					if (d.a < 0.004) return base;
					vec3 c = d.rgb / d.a;
					c = mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
					return mix(base, c, d.a);
				}
				${customKey()}`
			)
			.replace(
				'#include <color_fragment>',
				`#include <color_fragment>
				if (vContourMask < 0.5) {
					diffuseColor.rgb = uSideFlat > 0.5
						? uSideColor
						: soilColor(vSoilPos, vSurfaceY - vSoilPos.y);
				} else {
					vec3 n = normalize(vObjNormal);
					float slope = degrees(atan(length(n.xz), max(n.y, 1e-4) * uExaggeration));
					vec2 uv = vSoilPos.xz * 0.5 + 0.5;
					float t = (vElevation - uRampRange.x) / max(uRampRange.y - uRampRange.x, 1e-6);
					float texel = 1.0 / ${RAMP_SIZE}.0;
					vec3 c = texture2D(uRamp, vec2(mix(0.5 * texel, 1.0 - 0.5 * texel, clamp(t, 0.0, 1.0)), 0.5)).rgb;
					c = mix(c, uSlopeColor, uSlopeStrength * smoothstep(uSlopeRange.x, uSlopeRange.y, slope));
					c = surface(c, vElevation, slope, n, uv);
					if (uDrapeOn > 0.5) c = drapeOver(c, uDrape, uv);
					if (uInterval > 0.0 && uLineStrength > 0.0) {
						float v = vElevation / uInterval;
						float minor = contourLine(v, 1.2);
						float major = uMajorEvery > 0.0 ? contourLine(v / uMajorEvery, 1.6) : 0.0;
						float line = max(minor * 0.6, major) * uLineStrength;
						c = mix(c, uLineColor, clamp(line, 0.0, 1.0));
					}
					if (uDrapeTopOn > 0.5) c = drapeOver(c, uDrapeTop, uv);
					diffuseColor.rgb = c;
				}`
			);
	};
	material.customProgramCacheKey = () => 'diorama-terrain\n' + customKey();

	setStyle(style);

	return {
		material,
		uniforms,
		setStyle,
		setElevationRange(minZ, maxZ) {
			range = [minZ, maxZ];
			updateRampRange();
		},
		setDrapes(below, above) {
			uniforms.uDrape.value = below;
			uniforms.uDrapeOn.value = below ? 1 : 0;
			uniforms.uDrapeTop.value = above;
			uniforms.uDrapeTopOn.value = above ? 1 : 0;
		},
		dispose() {
			material.dispose();
			ramp.dispose();
		}
	};
}
