/**
 * A photographic preview of the moment: the terrain around the observer as a lit mesh, seen
 * from their eye through a chosen lens, under a physical sky with the sun where it really is.
 * The earth's curvature (less refraction) is built into the mesh, so distant ridges sink and
 * the sun sets on the summit exactly where the geometry says it does.
 */
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EARTH_RADIUS, REFRACTION_K } from './geo';
import type { Observer, TerrainGrid } from './alignment';

/** How the air and the mountain look. */
export interface Conditions {
	/** 0 crisp winter air … 1 summer murk. Sets turbidity and the haze that veils distance. */
	haze: number;
	/** 0 none … 1 overcast: a deck of cloud at `cloudBase`. */
	cloud: number;
	/** Metres above sea level of the cloud deck. */
	cloudBase: number;
	/** Metres above sea level above which the ground is white. */
	snowLine: number;
	/** 35 mm-equivalent focal length. */
	focalLength: number;
	exposure: number;
}

export interface SunState {
	azimuth: number;
	/** Apparent altitude, degrees. */
	altitude: number;
}

const RAD = Math.PI / 180;
const M_PER_DEG = RAD * EARTH_RADIUS;

/** Build an indexed terrain mesh in metres east/up/north of the observer, curved away. */
function terrainGeometry(
	g: TerrainGrid,
	observer: Observer,
	skip?: (lon: number, lat: number) => boolean
): THREE.BufferGeometry {
	const { width: w, height: h } = g;
	const cosLat = Math.cos(observer.lat * RAD);
	const dLon = (g.east - g.west) / (w - 1);
	const dLat = (g.north - g.south) / (h - 1);
	const pos = new Float32Array(w * h * 3);
	const keep = new Uint8Array(w * h);
	for (let j = 0; j < h; j++) {
		const lat = g.north - j * dLat;
		const z = -(lat - observer.lat) * M_PER_DEG; // north is −z
		for (let i = 0; i < w; i++) {
			const lon = g.west + i * dLon;
			const x = (lon - observer.lon) * M_PER_DEG * cosLat;
			let e = g.data[j * w + i];
			if (Number.isNaN(e)) e = 0;
			const d2 = x * x + z * z;
			const drop = ((1 - REFRACTION_K) * d2) / (2 * EARTH_RADIUS);
			const k = (j * w + i) * 3;
			pos[k] = x;
			pos[k + 1] = Math.max(e, 0) - drop;
			pos[k + 2] = z;
			keep[j * w + i] = skip && skip(lon, lat) ? 0 : 1;
		}
	}
	const index: number[] = [];
	for (let j = 0; j < h - 1; j++)
		for (let i = 0; i < w - 1; i++) {
			const a = j * w + i,
				b = a + 1,
				c = a + w,
				d = c + 1;
			if (!(keep[a] || keep[b] || keep[c] || keep[d])) continue;
			index.push(a, c, b, b, c, d);
		}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
	geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(w * h * 3), 3));
	geo.setIndex(index);
	geo.computeVertexNormals();
	return geo;
}

const ROCK = new THREE.Color('#4d443f');
const FOREST = new THREE.Color('#2f3d2c');
const SCRUB = new THREE.Color('#5b5a44');
const SNOW = new THREE.Color('#e8ecf0');
const SEA = new THREE.Color('#2a3a48');

/** Colour each vertex by its height: woods, then scrub, then bare rock, then snow. */
function paint(geo: THREE.BufferGeometry, g: TerrainGrid, snowLine: number) {
	const color = geo.getAttribute('color') as THREE.BufferAttribute;
	const normal = geo.getAttribute('normal') as THREE.BufferAttribute;
	const c = new THREE.Color();
	for (let i = 0; i < g.data.length; i++) {
		const e = g.data[i];
		const steep = 1 - Math.abs(normal.getY(i));
		if (!(e > 0.5)) c.copy(SEA);
		else if (e < 1700) c.copy(FOREST);
		else if (e < 2600) c.lerpColors(FOREST, SCRUB, (e - 1700) / 900);
		else c.copy(ROCK);
		// Snow lies above the line, thinning on steep ground and feathered over 150 m.
		const snow = THREE.MathUtils.smoothstep(e, snowLine - 150, snowLine + 150) * (1 - steep * 1.5);
		if (snow > 0) c.lerp(SNOW, Math.min(1, snow));
		color.setXYZ(i, c.r, c.g, c.b);
	}
	color.needsUpdate = true;
}

const CLOUD_VERT = /* glsl */ `
	varying vec3 vWorld;
	#include <common>
	#include <fog_pars_vertex>
	#include <logdepthbuf_pars_vertex>
	void main() {
		vec4 world = modelMatrix * vec4(position, 1.0);
		vWorld = world.xyz;
		vec4 mvPosition = viewMatrix * world;
		gl_Position = projectionMatrix * mvPosition;
		#include <logdepthbuf_vertex>
		#include <fog_vertex>
	}`;

const CLOUD_FRAG = /* glsl */ `
	uniform float uCoverage;
	uniform float uTime;
	uniform vec3 uSunDir;
	uniform vec3 uLit;
	uniform vec3 uShade;
	varying vec3 vWorld;
	#include <common>
	#include <fog_pars_fragment>
	#include <logdepthbuf_pars_fragment>
	float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
	float noise(vec2 p) {
		vec2 i = floor(p), f = fract(p);
		f = f * f * (3.0 - 2.0 * f);
		return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
	}
	float fbm(vec2 p) {
		float v = 0.0, a = 0.5;
		for (int k = 0; k < 6; k++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
		return v;
	}
	void main() {
		#include <logdepthbuf_fragment>
		vec2 p = vWorld.xz / 6000.0 + vec2(uTime * 0.02, uTime * 0.007);
		float n = fbm(p);
		float edge = 1.0 - uCoverage;
		float a = smoothstep(edge - 0.08, edge + 0.25, n);
		if (a < 0.01) discard;
		vec3 view = normalize(vWorld - cameraPosition);
		float toward = pow(max(dot(view, uSunDir), 0.0), 6.0);
		float thick = smoothstep(edge, edge + 0.5, n);
		vec3 col = mix(uLit, uShade, thick * 0.8);
		col += uLit * toward * (1.0 - thick) * 0.8;
		gl_FragColor = vec4(col, a * 0.96);
		#include <fog_fragment>
	}`;

export class FujiScene {
	readonly renderer: THREE.WebGLRenderer;
	readonly scene = new THREE.Scene();
	readonly camera: THREE.PerspectiveCamera;
	readonly sky = new Sky();
	private sun = new THREE.DirectionalLight(0xffffff, 3);
	private hemi = new THREE.HemisphereLight(0xb0c0d0, 0x202020, 0.5);
	private fog = new THREE.FogExp2(0x9aa4ae, 0);
	private material = new THREE.MeshStandardMaterial({
		vertexColors: true,
		roughness: 1,
		metalness: 0
	});
	private meshes: { mesh: THREE.Mesh; grid: TerrainGrid }[] = [];
	private clouds: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
	private sunDir = new THREE.Vector3(0, 1, 0);
	private snowLine = NaN;
	private start = performance.now();

	constructor(canvas: HTMLCanvasElement) {
		this.renderer = new THREE.WebGLRenderer({
			canvas,
			antialias: true,
			logarithmicDepthBuffer: true
		});
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
		this.renderer.toneMappingExposure = 0.35;
		this.camera = new THREE.PerspectiveCamera(20, 16 / 9, 5, 600_000);
		this.scene.fog = this.fog;
		this.sky.scale.setScalar(500_000);
		this.scene.add(this.sky, this.sun, this.sun.target, this.hemi);
		this.clouds = new THREE.Mesh(
			new THREE.PlaneGeometry(500_000, 500_000),
			new THREE.ShaderMaterial({
				vertexShader: CLOUD_VERT,
				fragmentShader: CLOUD_FRAG,
				uniforms: THREE.UniformsUtils.merge([
					THREE.UniformsLib.fog,
					{
						uCoverage: { value: 0 },
						uTime: { value: 0 },
						uSunDir: { value: new THREE.Vector3() },
						uLit: { value: new THREE.Color() },
						uShade: { value: new THREE.Color() }
					}
				]),
				transparent: true,
				depthWrite: false,
				side: THREE.DoubleSide,
				fog: true
			})
		);
		this.clouds.rotation.x = -Math.PI / 2;
		this.clouds.renderOrder = 1;
		this.scene.add(this.clouds);
	}

	/** Rebuild the ground for an observer. Grids are drawn in order; later ones skip earlier ones' area. */
	setTerrain(grids: TerrainGrid[], observer: Observer) {
		for (const { mesh } of this.meshes) {
			this.scene.remove(mesh);
			mesh.geometry.dispose();
		}
		this.meshes = [];
		const covered: TerrainGrid[] = [];
		for (const g of grids) {
			const inside = covered.slice();
			const skip = inside.length
				? (lon: number, lat: number) =>
						inside.some((c) => lon > c.west && lon < c.east && lat > c.south && lat < c.north)
				: undefined;
			const geo = terrainGeometry(g, observer, skip);
			const mesh = new THREE.Mesh(geo, this.material);
			this.scene.add(mesh);
			this.meshes.push({ mesh, grid: g });
			covered.push(g);
		}
		this.snowLine = NaN;
		this.camera.position.set(0, observer.elevation, 0);
	}

	resize(width: number, height: number) {
		this.renderer.setSize(width, height, false);
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
	}

	/** Point the camera and the sun, then draw. `bearing` and `pitch` are where the lens looks. */
	render(sun: SunState, bearing: number, pitch: number, c: Conditions) {
		if (this.snowLine !== c.snowLine) {
			for (const { mesh, grid } of this.meshes) paint(mesh.geometry, grid, c.snowLine);
			this.snowLine = c.snowLine;
		}
		// Lens: a 36 mm-wide frame; three's fov is vertical.
		const hfov = 2 * Math.atan(18 / c.focalLength);
		const vfov = 2 * Math.atan(Math.tan(hfov / 2) / this.camera.aspect);
		this.camera.fov = vfov / RAD;
		this.camera.updateProjectionMatrix();
		const az = bearing * RAD,
			el = pitch * RAD;
		const look = new THREE.Vector3(
			Math.sin(az) * Math.cos(el),
			Math.sin(el),
			-Math.cos(az) * Math.cos(el)
		);
		this.camera.lookAt(look.add(this.camera.position));

		const sa = sun.azimuth * RAD,
			se = sun.altitude * RAD;
		this.sunDir.set(Math.sin(sa) * Math.cos(se), Math.sin(se), -Math.cos(sa) * Math.cos(se));
		this.sun.position.copy(this.sunDir).multiplyScalar(100_000).add(this.camera.position);
		this.sun.target.position.copy(this.camera.position);

		// The sky: hazier air scatters more, reddening a low sun and paling the horizon.
		const u = this.sky.material.uniforms;
		u.sunPosition.value.copy(this.sunDir);
		u.turbidity.value = 3 + c.haze * 9;
		u.rayleigh.value = 1.8 + c.haze * 1.2;
		u.mieCoefficient.value = 0.0015 + c.haze * 0.006;
		u.mieDirectionalG.value = 0.65 + c.haze * 0.15;
		this.renderer.toneMappingExposure = c.exposure;

		// Light: the sun fades and warms as it nears the horizon, then is gone.
		const alt = sun.altitude;
		const day = THREE.MathUtils.smoothstep(alt, -1, 4);
		const warm = 1 - THREE.MathUtils.smoothstep(alt, 0, 12);
		this.sun.color.setRGB(1, 1 - warm * 0.45, 1 - warm * 0.75);
		this.sun.intensity = 3.5 * day * (1 - c.cloud * 0.6);
		const dusk = THREE.MathUtils.smoothstep(alt, -8, 0);
		this.hemi.color.setRGB(0.55 + warm * 0.3, 0.6, 0.75).multiplyScalar(0.25 + dusk * 0.75);
		this.hemi.intensity = 0.7;

		// Haze colour follows the sky near the horizon; thick haze also hides distance.
		const fogColor = new THREE.Color().setRGB(
			0.62 + warm * 0.3,
			0.64 - warm * 0.1,
			0.7 - warm * 0.3
		);
		fogColor.multiplyScalar(0.3 + dusk * 0.7);
		this.fog.color.copy(fogColor);
		this.fog.density = (0.4 + c.haze * 6) * 1e-5;

		const cu = this.clouds.material.uniforms;
		this.clouds.position.y = c.cloudBase;
		this.clouds.visible = c.cloud > 0.01;
		cu.uCoverage.value = c.cloud;
		cu.uTime.value = (performance.now() - this.start) / 1000;
		cu.uSunDir.value.copy(this.sunDir);
		(cu.uLit.value as THREE.Color)
			.setRGB(1, 0.85 - warm * 0.35, 0.8 - warm * 0.55)
			.multiplyScalar(0.3 + dusk * 0.9);
		(cu.uShade.value as THREE.Color).setRGB(0.35, 0.37, 0.45).multiplyScalar(0.3 + dusk * 0.7);
		this.renderer.render(this.scene, this.camera);
	}

	dispose() {
		for (const { mesh } of this.meshes) mesh.geometry.dispose();
		this.material.dispose();
		this.clouds.geometry.dispose();
		this.clouds.material.dispose();
		this.renderer.dispose();
	}
}

/** Where the snow usually reaches on Fuji in each month (1 = January), metres above sea level. */
export const SNOW_LINE_BY_MONTH = [
	2200, 2000, 2100, 2400, 2800, 3300, 4000, 4000, 4000, 3500, 2900, 2400
];
