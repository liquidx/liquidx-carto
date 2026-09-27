import * as THREE from 'three';

export interface ContourUniforms {
	uInterval: { value: number };
	uMajorEvery: { value: number };
	uLineColor: { value: THREE.Color };
	uLineStrength: { value: number };
	uMinZ: { value: number };
}

/**
 * Standard material with vertex colours plus screen-space-constant contour lines
 * driven by the per-vertex `elevation` attribute (real metres, unaffected by exaggeration).
 * The `contourMask` attribute limits lines to the top surface; everywhere else (wall and
 * bottom) gets a procedural soil texture: topsoil following the terrain edge (`surfaceY`),
 * horizontal strata, grain and pebbles.
 */
export function createTerrainMaterial(): {
	material: THREE.MeshStandardMaterial;
	uniforms: ContourUniforms;
} {
	const uniforms: ContourUniforms = {
		uInterval: { value: 20 },
		uMajorEvery: { value: 5 },
		uLineColor: { value: new THREE.Color(0x3a2a1a) },
		uLineStrength: { value: 0.55 },
		uMinZ: { value: 0 }
	};

	const material = new THREE.MeshStandardMaterial({
		vertexColors: true,
		roughness: 0.9,
		metalness: 0.0,
		flatShading: false
	});

	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, uniforms);
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
				varying vec3 vSoilPos;`
			)
			.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
				vElevation = elevation;
				vContourMask = contourMask;
				vSurfaceY = surfaceY;
				vSoilPos = position;`
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
				varying float vElevation;
				varying float vContourMask;
				varying float vSurfaceY;
				varying vec3 vSoilPos;
				uniform float uInterval;
				uniform float uMajorEvery;
				uniform vec3 uLineColor;
				uniform float uLineStrength;
				uniform float uMinZ;
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
					vec3 subsoil = mix(vec3(0.46, 0.31, 0.19), vec3(0.84, 0.68, 0.48), tone);
					subsoil = mix(subsoil, vec3(0.56, 0.52, 0.48), step(0.8, tone) * 0.8);
					// Darker, humus-rich topsoil hugging the surface with a ragged lower edge.
					float topEdge = 0.05 + wobble * 0.03 + (soilNoise(p * 25.0) - 0.5) * 0.015;
					vec3 topsoil = vec3(0.22, 0.14, 0.08);
					vec3 c = mix(topsoil, subsoil, smoothstep(topEdge - 0.008, topEdge + 0.012, depth));
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
				}`
			)
			.replace(
				'#include <color_fragment>',
				`#include <color_fragment>
				if (vContourMask < 0.5) {
					diffuseColor.rgb = soilColor(vSoilPos, vSurfaceY - vSoilPos.y);
				} else if (uInterval > 0.0) {
					float v = vElevation / uInterval;
					float minor = contourLine(v, 1.2);
					float major = uMajorEvery > 0.0 ? contourLine(v / uMajorEvery, 1.6) : 0.0;
					float line = max(minor * 0.6, major) * uLineStrength * vContourMask;
					diffuseColor.rgb = mix(diffuseColor.rgb, uLineColor, clamp(line, 0.0, 1.0));
				}`
			);
	};
	material.customProgramCacheKey = () => 'terrain-contour-soil';

	return { material, uniforms };
}
