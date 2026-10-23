/**
 * Procedural snow: the terrain shaded in the fragment shader. The runs and lifts go to the GPU
 * as a distance field, so their edges are drawn
 * sharp at any distance from a coarse texture, and the surface grain is noise in world space,
 * so it never repeats and fades out before it would shimmer.
 */
import * as THREE from 'three';
import type { LocalFrame } from './frame';
import { LIFT_CLEARANCE, RUN_WIDTH } from './ground';
import { DIFFICULTY_COLOR, type Difficulty, type Resort } from './resort';

/** Distances are stored up to this far from a run's centre line, and from a lift line. */
const RUN_RANGE = 32;
const LIFT_RANGE = 16;
/**
 * The field's long side is capped at this many pixels, and a pixel is never under 2 m. A
 * distance interpolates where a colour blurs, so a texel of 4 m still draws a sharp edge.
 */
const MAX_TEXTURE_PX = 1024;
const MIN_METRES_PER_PIXEL = 2;

const DIFFICULTIES = Object.keys(DIFFICULTY_COLOR) as Difficulty[];
/** Texels a side of the noise tile. */
const NOISE = 256;

export interface SnowShader {
	/** For `customProgramCacheKey`. */
	key: string;
	/** Patch a MeshStandardMaterial's shader, from its `onBeforeCompile`. */
	patch(shader: THREE.WebGLProgramParametersWithUniforms): void;
	dispose(): void;
}

/**
 * The distance field, one texel every few metres over the frame: red and green the distance to
 * the nearest run's centre line in 16 bits (bilinear filtering is linear, so the two bytes filter
 * as one number), blue the distance to the nearest lift line, alpha the nearest run's difficulty.
 */
function buildField(frame: LocalFrame, resort: Resort) {
	const long = Math.max(frame.width, frame.height);
	const mpp = Math.max(MIN_METRES_PER_PIXEL, long / MAX_TEXTURE_PX);
	const w = Math.ceil(frame.width / mpp);
	const h = Math.ceil(frame.height / mpp);
	// The texture covers the frame exactly, so its pixels are a little under `mpp`.
	const px = frame.width / w;
	const pz = frame.height / h;
	// Squared distances while splatting: the square roots are taken once a pixel at the end.
	const run = new Float32Array(w * h).fill(RUN_RANGE ** 2);
	const lift = new Float32Array(w * h).fill(LIFT_RANGE ** 2);
	const kind = new Uint8Array(w * h);

	/**
	 * Lower `dist` to the squared distance from each pixel within `range` of the path, calling
	 * `closer` where it does.
	 */
	const splat = (
		path: [number, number][],
		range: number,
		dist: Float32Array,
		closer?: (i: number) => void
	) => {
		for (let s = 1; s < path.length; s++) {
			const [ax, az] = path[s - 1];
			const [bx, bz] = path[s];
			const dx = bx - ax;
			const dz = bz - az;
			const inv = 1 / (dx * dx + dz * dz || 1);
			const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - range + frame.width / 2) / px));
			const i1 = Math.min(w - 1, Math.ceil((Math.max(ax, bx) + range + frame.width / 2) / px));
			const j0 = Math.max(0, Math.floor((Math.min(az, bz) - range + frame.height / 2) / pz));
			const j1 = Math.min(h - 1, Math.ceil((Math.max(az, bz) + range + frame.height / 2) / pz));
			for (let j = j0; j <= j1; j++) {
				const rz = -frame.height / 2 + (j + 0.5) * pz - az;
				for (let i = i0; i <= i1; i++) {
					const rx = -frame.width / 2 + (i + 0.5) * px - ax;
					let t = (rx * dx + rz * dz) * inv;
					t = t < 0 ? 0 : t > 1 ? 1 : t;
					const ex = rx - dx * t;
					const ez = rz - dz * t;
					const d = ex * ex + ez * ez;
					const k = j * w + i;
					if (d < dist[k]) {
						dist[k] = d;
						closer?.(k);
					}
				}
			}
		}
	};
	for (const l of resort.lifts) splat(l.path, LIFT_RANGE, lift);
	for (const r of resort.runs) {
		const index = DIFFICULTIES.indexOf(r.difficulty);
		splat(r.path, RUN_RANGE, run, (k) => (kind[k] = index));
	}

	const data = new Uint8Array(w * h * 4);
	for (let k = 0; k < w * h; k++) {
		const v = Math.round((Math.sqrt(run[k]) / RUN_RANGE) * 65535);
		data[k * 4] = v >> 8;
		data[k * 4 + 1] = v & 255;
		data[k * 4 + 2] = Math.round((Math.sqrt(lift[k]) / LIFT_RANGE) * 255);
		data[k * 4 + 3] = kind[k] * 85;
	}
	const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
	texture.minFilter = THREE.LinearMipmapLinearFilter;
	texture.magFilter = THREE.LinearFilter;
	texture.generateMipmaps = true;
	texture.anisotropy = 8;
	texture.needsUpdate = true;
	return texture;
}

const linear = (hex: string) => new THREE.Color(hex);

/**
 * A tile of white noise, read as value noise: a texture fetch is far cheaper than hashing in
 * the shader, and its mipmaps fade the detail out with distance for free.
 */
export function noiseTile() {
	const data = new Uint8Array(NOISE * NOISE);
	for (let i = 0; i < data.length; i++) data[i] = Math.random() * 256;
	const texture = new THREE.DataTexture(
		data,
		NOISE,
		NOISE,
		THREE.RedFormat,
		THREE.UnsignedByteType
	);
	texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
	texture.minFilter = THREE.LinearMipmapLinearFilter;
	texture.magFilter = THREE.LinearFilter;
	texture.generateMipmaps = true;
	texture.anisotropy = 8;
	texture.needsUpdate = true;
	return texture;
}

export function proceduralSnow(frame: LocalFrame, resort: Resort): SnowShader {
	const field = buildField(frame, resort);
	const noise = noiseTile();
	const uniforms = {
		snowField: { value: field },
		snowNoiseMap: { value: noise },
		snowHalf: { value: new THREE.Vector2(frame.width / 2, frame.height / 2) },
		snowDifficulty: { value: DIFFICULTIES.map((d) => linear(DIFFICULTY_COLOR[d])) },
		// Snow colours, in linear light as the shader works in.
		snowOff: { value: linear('#e4e9f1') },
		snowGroomed: { value: linear('#f6f8fc') },
		snowLift: { value: linear('#bec8d6') }
	};
	const f = (n: number) => n.toFixed(3);
	const common = /* glsl */ `
		varying vec3 vSnowPos;
		uniform sampler2D snowField;
		uniform sampler2D snowNoiseMap;
		uniform vec2 snowHalf;
		uniform vec3 snowDifficulty[${DIFFICULTIES.length}];
		uniform vec3 snowOff;
		uniform vec3 snowGroomed;
		uniform vec3 snowLift;
		float snowHeight;

		// Value noise of wavelength wl metres at xz, in one fetch: the coordinate is eased between
		// texel centres so the surface has no creases, and the mip level comes from the screen
		// derivatives of xz, gx and gy, passed in so it can be read inside a branch.
		float snowNoise(vec2 xz, float wl, vec2 gx, vec2 gy) {
			vec2 q = xz / wl + 0.5;
			vec2 i = floor(q);
			vec2 t = q - i;
			t = t * t * (3.0 - 2.0 * t);
			float s = 1.0 / (wl * ${f(NOISE)});
			return textureGrad(snowNoiseMap, (i + t - 0.5) / ${f(NOISE)}, gx * s, gy * s).r;
		}
		// Detail of wavelength wl in metres: whole at 8 pixels a wave, gone by 4, before it aliases.
		float snowFade(float wl, float footprint) {
			return clamp((wl / footprint - 4.0) / 4.0, 0.0, 1.0);
		}
		// Mikkelsen's surface gradient: a height in metres tilts the normal by its screen derivatives.
		vec3 snowBump(vec3 pos, vec3 n, float h) {
			vec3 dpdx = dFdx(pos);
			vec3 dpdy = dFdy(pos);
			vec3 r1 = cross(dpdy, n);
			vec3 r2 = cross(n, dpdx);
			float det = dot(dpdx, r1);
			vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
			return normalize(abs(det) * n - grad);
		}
	`;
	// In a block, so its names cannot clash with the material's own.
	const surface = /* glsl */ `{
		vec2 snowXZ = vSnowPos.xz;
		vec2 gx = dFdx(snowXZ);
		vec2 gy = dFdy(snowXZ);
		float footprint = max(length(dFdx(vSnowPos)), length(dFdy(vSnowPos)));
		vec4 field = texture2D(snowField, (snowXZ + snowHalf) / (2.0 * snowHalf));
		float dRun = (field.r * 65280.0 + field.g * 255.0) / 65535.0 * ${f(RUN_RANGE)};
		float dLift = field.b * ${f(LIFT_RANGE)};
		vec3 difficulty = snowDifficulty[int(field.a * 3.0 + 0.5)];
		// Edges a pixel wide, wherever the camera is.
		float aa = max(fwidth(dRun), 1e-3);
		float groomed = smoothstep(${f(RUN_WIDTH / 2)} + aa, ${f(RUN_WIDTH / 2)} - aa, dRun);
		float band = smoothstep(${f(RUN_WIDTH / 2 + 1.5)} + aa, ${f(RUN_WIDTH / 2 + 1.5)} - aa, dRun);
		float aaLift = max(fwidth(dLift), 1e-3);
		float cleared = smoothstep(${f(LIFT_CLEARANCE / 2)} + aaLift, ${f(LIFT_CLEARANCE / 2)} - aaLift, dLift);

		// Off piste: wind-worked drifts tens of metres across, and smaller ripples.
		float drift =
			snowNoise(snowXZ, 37.0, gx, gy) * 0.6 + snowNoise(snowXZ + 591.0, 8.3, gx, gy) * 0.4;
		// On piste: the groomer's passes, a few metres wide, alongside the run.
		float passes = (0.5 + 0.5 * cos(dRun * 6.2832 / 4.5)) * snowFade(4.5, footprint);
		vec3 snow = snowOff * (0.965 + 0.06 * drift);
		snow = mix(snow, snowLift, 0.6 * cleared);
		snow = mix(snow, difficulty, 0.6 * band);
		snow = mix(snow, snowGroomed * (0.985 + 0.025 * passes), groomed);
		diffuseColor.rgb *= snow;

		// Relief in metres: drifts and crust off piste, corduroy ribs on it.
		// The noise's mipmaps fade it out at a distance; the ribs need fading by hand. Each is only
		// worked out where it shows.
		float rough = 0.0;
		float corduroy = 0.0;
		if (groomed < 0.999)
			rough =
				snowNoise(snowXZ + 55.0, 3.1, gx, gy) * 0.12 +
				snowNoise(snowXZ + 123.0, 0.93, gx, gy) * 0.035 +
				snowNoise(snowXZ + 58.0, 0.29, gx, gy) * 0.01;
		if (groomed > 0.001)
			corduroy =
				(0.5 + 0.5 * cos(dRun * 6.2832 / 0.25)) * 0.008 * snowFade(0.25, footprint) +
				snowNoise(snowXZ + 80.0, 1.7, gx, gy) * 0.015;
		snowHeight = mix(rough, corduroy, groomed);
	}`;
	return {
		key: 'snow',
		patch(shader) {
			Object.assign(shader.uniforms, uniforms);
			shader.vertexShader = shader.vertexShader
				.replace('#include <common>', '#include <common>\nvarying vec3 vSnowPos;')
				.replace(
					'#include <project_vertex>',
					'#include <project_vertex>\nvSnowPos = (modelMatrix * vec4(transformed, 1.0)).xyz;'
				);
			shader.fragmentShader = shader.fragmentShader
				.replace('#include <common>', '#include <common>\n' + common)
				.replace('#include <map_fragment>', surface)
				.replace(
					'#include <normal_fragment_maps>',
					'#include <normal_fragment_maps>\nnormal = snowBump(-vViewPosition, normal, snowHeight);'
				);
		},
		dispose() {
			field.dispose();
			noise.dispose();
		}
	};
}
