/**
 * A sky worked out in the shader: the gradient dome, a sun where the light comes from, and a
 * layer of cloud that drifts overhead and slides past as the rider moves.
 */
import * as THREE from 'three';
import { noiseTile } from './snow';

/** Height of the cloud layer above the eye, in metres. */
const CLOUD_HEIGHT = 2200;
/** Wind across the cloud layer, in metres a second. */
const WIND = new THREE.Vector2(9, 4);
/** Angular radius of the sun's disc, drawn a little larger than life, in radians. */
const SUN_RADIUS = 0.012;

export interface Sky {
	mesh: THREE.Mesh;
	/** Follow the camera and move the clouds on to `time` seconds. */
	update(eye: THREE.Vector3, time: number): void;
	dispose(): void;
}

export function proceduralSky(sun: THREE.Vector3): Sky {
	const noise = noiseTile();
	const uniforms = {
		top: { value: new THREE.Color('#5d93c9') },
		horizon: { value: new THREE.Color('#c9dced') },
		sunDir: { value: sun.clone().normalize() },
		sunColor: { value: new THREE.Color('#fff4e2') },
		noiseMap: { value: noise },
		eye: { value: new THREE.Vector2() }
	};
	const f = (n: number) => n.toFixed(4);
	const material = new THREE.ShaderMaterial({
		side: THREE.BackSide,
		depthWrite: false,
		fog: false,
		uniforms,
		vertexShader: /* glsl */ `
			varying vec3 vDir;
			void main() {
				vDir = position;
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}`,
		fragmentShader: /* glsl */ `
			uniform vec3 top;
			uniform vec3 horizon;
			uniform vec3 sunDir;
			uniform vec3 sunColor;
			uniform sampler2D noiseMap;
			uniform vec2 eye;
			varying vec3 vDir;

			// Value noise of wavelength wl metres, as on the snow: one eased fetch, its mip level
			// from the derivatives of p so the cloud blurs rather than sparkles near the horizon.
			float noise(vec2 p, float wl, vec2 gx, vec2 gy) {
				vec2 q = p / wl + 0.5;
				vec2 i = floor(q);
				vec2 t = q - i;
				t = t * t * (3.0 - 2.0 * t);
				float s = 1.0 / (wl * 256.0);
				return textureGrad(noiseMap, (i + t - 0.5) / 256.0, gx * s, gy * s).r;
			}
			float cloud(vec2 p, vec2 gx, vec2 gy, int octaves) {
				float sum = 0.0;
				float amp = 0.5;
				float wl = 2600.0;
				for (int k = 0; k < 5; k++) {
					if (k == octaves) break;
					sum += noise(p + float(k) * 317.0, wl, gx, gy) * amp;
					amp *= 0.5;
					wl *= 0.47;
				}
				return sum;
			}

			void main() {
				vec3 d = normalize(vDir);
				vec3 col = mix(horizon, top, smoothstep(-0.05, 0.6, d.y));
				float mu = dot(d, sunDir);
				float toward = max(mu, 0.0);
				// The air brightens round the sun.
				col += sunColor * (0.12 * pow(toward, 6.0) + 0.3 * pow(toward, 90.0));

				// Clouds: a flat layer overhead, read where the view ray meets it. Derivatives are
				// taken outside the branch, so the ray is held off the horizon.
				float up = max(d.y, 0.02);
				vec2 p = eye + d.xz * (${f(CLOUD_HEIGHT)} / up);
				vec2 gx = dFdx(p);
				vec2 gy = dFdy(p);
				float cover = 0.0;
				if (d.y > 0.0) {
					float c = cloud(p, gx, gy, 5);
					cover = smoothstep(0.46, 0.68, c);
					if (cover > 0.0) {
						// Thicker cloud towards the sun means this side is in its own shade.
						float ahead = cloud(p + sunDir.xz * 260.0, gx, gy, 3);
						float lit = clamp(0.75 - (ahead - c) * 4.0, 0.0, 1.0);
						vec3 shade = mix(vec3(0.62, 0.68, 0.78), vec3(1.0), lit);
						// Thin edges glow when the sun is behind them.
						shade += sunColor * pow(toward, 5.0) * (1.0 - cover) * 0.8;
						// Far cloud fades into the haze at the horizon.
						float haze = smoothstep(0.02, 0.25, d.y);
						col = mix(col, mix(horizon, shade, haze), cover * mix(0.35, 0.92, haze));
					}
				}

				// The disc, a pixel soft at its edge, dimmed where cloud crosses it.
				float angle = acos(clamp(mu, -1.0, 1.0));
				float aa = fwidth(angle);
				float disc = smoothstep(${f(SUN_RADIUS)} + aa, ${f(SUN_RADIUS)} - aa, angle);
				col = mix(col, vec3(1.0, 0.98, 0.93), disc * (1.0 - cover * 0.6));
				// And a glow through the cloud round it.
				col += sunColor * pow(toward, 400.0) * 0.4 * cover;
				gl_FragColor = vec4(col, 1.0);
			}`
	});
	const mesh = new THREE.Mesh(new THREE.SphereGeometry(12000, 48, 24), material);
	mesh.frustumCulled = false;
	return {
		mesh,
		update(eye, time) {
			mesh.position.copy(eye);
			// The layer is fixed to the ground, so it slides past as the rider moves, and the wind
			// carries it on.
			uniforms.eye.value.set(eye.x - WIND.x * time, eye.z - WIND.y * time);
		},
		dispose() {
			noise.dispose();
			mesh.geometry.dispose();
			material.dispose();
		}
	};
}
