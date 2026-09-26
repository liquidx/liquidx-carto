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
				varying float vElevation;`
			)
			.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
				vElevation = elevation;`
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
				varying float vElevation;
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
				}`
			)
			.replace(
				'#include <color_fragment>',
				`#include <color_fragment>
				if (uInterval > 0.0) {
					float v = vElevation / uInterval;
					float minor = contourLine(v, 1.2);
					float major = uMajorEvery > 0.0 ? contourLine(v / uMajorEvery, 1.6) : 0.0;
					float line = max(minor * 0.6, major) * uLineStrength;
					diffuseColor.rgb = mix(diffuseColor.rgb, uLineColor, clamp(line, 0.0, 1.0));
				}`
			);
	};
	material.customProgramCacheKey = () => 'terrain-contour';

	return { material, uniforms };
}
