/**
 * The snowboard game: builds the scene for a resort, runs the loop, and reports to the HUD.
 */
import type { FeatureCollection } from 'geojson';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { findProvider } from '$lib/contour/terrain-api';
import { xToLon, yToLat } from '$lib/contour/mercator';
import { createFrame, type LocalFrame } from './frame';
import { paintGround, RUN_WIDTH, type Ground } from './ground';
import { buildLifts, type LiftLine } from './lifts';
import {
	DIFFICULTY_COLOR,
	nearestRun,
	parseResort,
	planArea,
	type FeaturesFile,
	type Resort
} from './resort';
import { Rider, type Input, type Mode } from './rider';
import { Terrain } from './terrain';
import { plantForest } from './trees';

export interface GameOptions {
	/** Terrain provider id, see `PROVIDERS`; the GSI 1 m tiles by default. */
	provider?: string;
	shadows?: boolean;
	/** Metres between trees. */
	treeSpacing?: number;
	/** Cap on the device pixel ratio rendered at; lower it on phones. */
	maxPixelRatio?: number;
	/** An element over the canvas for the lift names floating over their stations. */
	labels?: HTMLElement;
	/** Wood and forest polygons; trees only stand inside them where the data covers. */
	woods?: FeatureCollection | null;
	/**
	 * URLs of the glTF or GLB to hang as the chairs, by how many they seat, see `buildLifts`;
	 * a plain bench where there is none.
	 */
	chairModels?: Record<number, string>;
	/** URL of the glTF or GLB to hang as the gondola cabins; a plain box without. */
	cabinModel?: string;
	/** URL of the glTF or GLB to hang as the two cabins of a cable car; a plain box without. */
	ropewayModel?: string;
	/** URL of the glTF or GLB to stand at each end of the chairlifts; a plain shed without. */
	stationModel?: string;
}

export interface LoadProgress {
	stage: string;
	/** 0–1 where known. */
	fraction?: number;
}

export interface Hud {
	mode: Mode;
	/** km/h. */
	speed: number;
	altitude: number;
	run: { name: string; difficulty: string; color: string } | null;
	/** A lift whose bottom station the rider is standing at. */
	nearLift: LiftLine | null;
	/** The lift being ridden. */
	onLift: LiftLine | null;
	airtime: number;
	distance: number;
	fps: number;
}

export interface Game {
	/** The three.js scene and camera, for anything built on top of the game. */
	scene: THREE.Scene;
	camera: THREE.PerspectiveCamera;
	frame: LocalFrame;
	resort: Resort;
	ground: Ground;
	lifts: LiftLine[];
	rider: Rider;
	/** Start (or restart) at the top of a lift. */
	startAt(liftId: string): void;
	/** Drop the rider on the snow at a longitude and latitude, facing down the slope. */
	teleport(lon: number, lat: number): void;
	/** The rider's position as `[lon, lat]`, and their heading as a compass bearing in degrees. */
	riderLonLat(): [number, number];
	/** Get on the lift the rider is standing at, if any. */
	board(): void;
	setShadows(on: boolean): void;
	setPaused(on: boolean): void;
	input: Input;
	dispose(): void;
}

const SUN = new THREE.Vector3(-0.55, 0.62, 0.45).normalize();

export async function createGame(
	canvas: HTMLCanvasElement,
	features: FeaturesFile,
	options: GameOptions,
	onProgress: (p: LoadProgress) => void,
	onHud: (h: Hud) => void
): Promise<Game> {
	const provider = findProvider(options.provider ?? 'gsi-1m');
	const box = planArea(features);
	const frame = createFrame(box, yToLat((box.y0 + box.y1) / 2));
	const resort = parseResort(features, frame);

	onProgress({ stage: 'painting the snow' });
	await tick();
	const ground = paintGround(frame, resort, options.woods);

	const terrain = new Terrain(frame, provider, ground.texture, ground.grain);
	onProgress({ stage: `fetching ${terrain.cellCount} terrain tiles`, fraction: 0 });
	await terrain.loadBase((p) =>
		onProgress({
			stage: `fetching ${provider.label} terrain · ${p.loaded} of ${p.total} tiles`,
			fraction: p.loaded / p.total
		})
	);

	onProgress({ stage: 'building the lifts' });
	await tick();
	const chairs: Record<number, THREE.Object3D> = {};
	await Promise.all(
		Object.entries(options.chairModels ?? {}).map(async ([seats, url]) => {
			chairs[+seats] = (await new GLTFLoader().loadAsync(url)).scene;
		})
	);
	const load = async (url?: string) =>
		url ? (await new GLTFLoader().loadAsync(url)).scene : undefined;
	const [cabin, ropeway, station] = await Promise.all([
		load(options.cabinModel),
		load(options.ropewayModel),
		load(options.stationModel)
	]);
	const lifts = buildLifts(
		resort.lifts,
		terrain,
		chairs,
		{ gondola: cabin, cableCar: ropeway },
		station
	);

	onProgress({ stage: 'planting the forest' });
	await tick();
	const forest = plantForest(frame, terrain, ground, options.treeSpacing ?? 14);
	forest.setShadows(options.shadows ?? true);

	onProgress({ stage: 'setting the course' });
	await tick();
	const poles = buildPoles(resort, terrain);

	// Scene.
	const renderer = new THREE.WebGLRenderer({
		canvas,
		antialias: true,
		powerPreference: 'high-performance'
	});
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, options.maxPixelRatio ?? 2));
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.05;
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;

	const scene = new THREE.Scene();
	const skyColor = new THREE.Color('#b9d3ea');
	scene.background = skyColor;
	scene.fog = new THREE.Fog(skyColor, 700, 5200);
	const sky = buildSky();
	scene.add(terrain.group, lifts.group, forest.group, poles, sky);

	const hemi = new THREE.HemisphereLight('#cfe3ff', '#ffffff', 1.5);
	scene.add(hemi);
	const sun = new THREE.DirectionalLight('#fff4e2', 2.2);
	sun.castShadow = options.shadows ?? true;
	sun.shadow.mapSize.set(2048, 2048);
	sun.shadow.camera.near = 50;
	sun.shadow.camera.far = 700;
	sun.shadow.camera.left = sun.shadow.camera.bottom = -140;
	sun.shadow.camera.right = sun.shadow.camera.top = 140;
	sun.shadow.bias = -0.0006;
	sun.shadow.normalBias = 0.6;
	scene.add(sun, sun.target);

	const camera = new THREE.PerspectiveCamera(62, 1, 0.5, 16000);
	const rider = new Rider(terrain, ground, forest);
	const figure = buildFigure();
	scene.add(figure.group);

	const input: Input = { steer: 0, tuck: false, brake: false, jump: false };
	let paused = true;
	let nearLift: LiftLine | null = null;
	let disposed = false;

	// Resize to the canvas's layout box.
	const resize = () => {
		const w = canvas.clientWidth || 1;
		const h = canvas.clientHeight || 1;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
	};
	const observer = new ResizeObserver(resize);
	observer.observe(canvas);
	resize();

	const teleport = (lon: number, lat: number) => {
		const [x, z] = frame.toWorld([lon, lat]);
		if (!terrain.contains(x, z)) return;
		const n = terrain.normal(x, z);
		rider.place(x, z, Math.atan2(n.z, n.x));
		placeCamera(0, true);
	};
	const riderLonLat = (): [number, number] => {
		const [mx, my] = frame.worldToMercator(rider.position.x, rider.position.z);
		return [xToLon(mx), yToLat(my)];
	};

	const startAt = (liftId: string) => {
		const line = lifts.lines.find((l) => l.lift.id === liftId) ?? lifts.lines[0];
		if (!line) {
			const [x, z] = resort.peak ?? [0, 0];
			rider.place(x, z, 0);
			return;
		}
		// The run nearest the top station, pointing down it.
		const hit = nearestRun(resort.runs, line.top.x, line.top.z);
		if (hit) {
			// Then a little way down it, past the flat at the top, pointing down the run.
			const p = hit.run.path;
			let i = hit.segment;
			let [x, z] = [
				p[i - 1][0] + (p[i][0] - p[i - 1][0]) * hit.t,
				p[i - 1][1] + (p[i][1] - p[i - 1][1]) * hit.t
			];
			let left = 60;
			while (left > 0 && i < p.length) {
				const d = Math.hypot(p[i][0] - x, p[i][1] - z);
				if (d > left) {
					x += ((p[i][0] - x) * left) / d;
					z += ((p[i][1] - z) * left) / d;
					break;
				}
				left -= d;
				[x, z] = p[i];
				i++;
			}
			// Facing the fall line, so the first push is downhill.
			const n = terrain.normal(x, z);
			rider.place(x, z, Math.atan2(n.z, n.x));
		} else rider.place(line.top.x, line.top.z, line.heading);
		// Camera snaps behind the rider.
		placeCamera(0, true);
	};

	// Chase camera, with a look-round offset from dragging that eases back when riding.
	let lookYaw = 0;
	let dragging = false;
	let dragX = 0;
	const onDown = (e: PointerEvent) => {
		if (e.pointerType !== 'mouse') return;
		dragging = true;
		dragX = e.clientX;
	};
	const onMove = (e: PointerEvent) => {
		if (!dragging) return;
		lookYaw += (e.clientX - dragX) * 0.008;
		dragX = e.clientX;
	};
	const onUp = () => (dragging = false);
	canvas.addEventListener('pointerdown', onDown);
	window.addEventListener('pointermove', onMove);
	window.addEventListener('pointerup', onUp);
	const camTarget = new THREE.Vector3();
	const look = new THREE.Vector3();
	const dir = new THREE.Vector3();
	function placeCamera(dt: number, snap = false) {
		const speed = rider.speed;
		if (speed > 2.5 && rider.mode !== 'lift') dir.copy(rider.velocity).setY(0).normalize();
		else rider.forward(dir);
		// Close and low behind the rider, so the snow streams past and speed reads; a little
		// further back and wider as they go faster.
		const back = rider.mode === 'lift' ? 12 : 6.5 + speed * 0.1;
		const up = rider.mode === 'lift' ? 3 : 2.3 + speed * 0.02;
		if (!dragging && rider.speed > 2) lookYaw *= Math.exp(-dt * 2);
		if (lookYaw) dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), lookYaw);
		camTarget.copy(rider.position).addScaledVector(dir, -back);
		camTarget.y += up;
		const floor = terrain.height(camTarget.x, camTarget.z) + 1.6;
		if (camTarget.y < floor) camTarget.y = floor;
		if (snap) camera.position.copy(camTarget);
		else camera.position.lerp(camTarget, 1 - Math.exp(-dt * 5));
		look.copy(rider.position);
		look.y += rider.mode === 'lift' ? 0.5 : 1.3;
		camera.lookAt(look);
		camera.fov = 64 + Math.min(18, speed * 0.45);
		camera.updateProjectionMatrix();
	}

	// Loop.
	let last = performance.now();
	let hudAt = 0;
	let frames = 0;
	let fps = 0;
	let fpsAt = last;
	const hud: Hud = {
		mode: 'ride',
		speed: 0,
		altitude: 0,
		run: null,
		nearLift: null,
		onLift: null,
		airtime: 0,
		distance: 0,
		fps: 0
	};
	// Lift names over their stations: DOM labels placed every frame, shrunk and faded with
	// distance and hidden when the terrain is in the way.
	const LABEL_RANGE = 1800;
	const labels = options.labels
		? lifts.lines.flatMap((line) =>
				[line.top, line.bottom].map((at) => {
					const el = document.createElement('div');
					el.className = 'lift-label';
					el.textContent = line.lift.name;
					options.labels!.appendChild(el);
					return { el, at: at.clone().setY(at.y + 16) };
				})
			)
		: [];
	const screen = new THREE.Vector3();
	const probe = new THREE.Vector3();
	function occluded(point: THREE.Vector3) {
		const steps = 24;
		probe.copy(camera.position).sub(point).divideScalar(steps);
		let x = point.x,
			y = point.y,
			z = point.z;
		for (let i = 1; i < steps; i++) {
			x += probe.x;
			y += probe.y;
			z += probe.z;
			if (y < terrain.height(x, z)) return true;
		}
		return false;
	}
	function placeLabels() {
		if (!labels.length) return;
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		for (const { el, at } of labels) {
			const d = at.distanceTo(camera.position);
			screen.copy(at).project(camera);
			const show =
				d < LABEL_RANGE &&
				screen.z < 1 &&
				Math.abs(screen.x) < 1.1 &&
				Math.abs(screen.y) < 1.1 &&
				!occluded(at);
			if (!show) {
				el.style.opacity = '0';
				continue;
			}
			el.style.opacity = String(Math.min(0.9, (LABEL_RANGE - d) / 600));
			// Full size up close, down to half size far off.
			const size = 1 - Math.min(0.5, d / LABEL_RANGE / 2);
			el.style.transform = `translate(${((screen.x + 1) / 2) * w}px, ${((1 - screen.y) / 2) * h}px) translate(-50%, -100%) scale(${size.toFixed(3)})`;
		}
	}

	function loop(now: number) {
		if (disposed) return;
		requestAnimationFrame(loop);
		// Up to a tenth of a second a frame is simulated in full, in steps of at most a sixtieth,
		// so the mountain goes past at the speed on the dial however slow the rendering is.
		const dt = Math.min(0.1, (now - last) / 1000);
		last = now;
		frames++;
		if (now - fpsAt > 1000) {
			fps = Math.round((frames * 1000) / (now - fpsAt));
			frames = 0;
			fpsAt = now;
		}
		lifts.update(dt);
		if (!paused) {
			const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
			for (let i = 0; i < steps; i++) rider.update(dt / steps, input);
			terrain.update(rider.position.x, rider.position.z);
			nearLift = null;
			if (rider.mode === 'ride' && rider.speed < 7) {
				for (const line of lifts.lines) {
					if (rider.position.distanceTo(line.bottom) < 22) nearLift = line;
				}
			}
			placeCamera(dt);
		}
		figure.update(rider, dt, input);
		// The dome rides with the camera so it is never clipped.
		sky.position.copy(camera.position);
		sun.position.copy(rider.position).addScaledVector(SUN, 400);
		sun.target.position.copy(rider.position);
		renderer.render(scene, camera);
		placeLabels();

		if (now - hudAt > 120) {
			hudAt = now;
			const near = nearestRun(resort.runs, rider.position.x, rider.position.z);
			hud.mode = rider.mode;
			hud.speed = rider.speed * 3.6;
			hud.altitude = rider.position.y;
			hud.run =
				near && near.distance < RUN_WIDTH / 2 + 6
					? {
							name: near.run.name || 'piste',
							difficulty: near.run.difficulty,
							color: DIFFICULTY_COLOR[near.run.difficulty]
						}
					: null;
			hud.nearLift = nearLift;
			hud.onLift = rider.mode === 'lift' ? rider.lift : null;
			hud.airtime = rider.airtime;
			hud.distance = rider.distance;
			hud.fps = fps;
			onHud({ ...hud });
		}
	}
	requestAnimationFrame(loop);

	return {
		scene,
		camera,
		frame,
		resort,
		ground,
		lifts: lifts.lines,
		rider,
		input,
		startAt,
		teleport,
		riderLonLat,
		board() {
			if (nearLift) rider.board(nearLift);
		},
		setShadows(on) {
			sun.castShadow = on;
			forest.setShadows(on);
		},
		setPaused(on) {
			paused = on;
			last = performance.now();
		},
		dispose() {
			disposed = true;
			observer.disconnect();
			for (const { el } of labels) el.remove();
			canvas.removeEventListener('pointerdown', onDown);
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			terrain.dispose();
			forest.dispose();
			lifts.dispose();
			ground.dispose();
			// Whatever is left (sky, poles, figure): geometry and materials go with the scene.
			scene.traverse((o) => {
				const mesh = o as THREE.Mesh;
				mesh.geometry?.dispose();
				for (const m of [mesh.material].flat()) m?.dispose();
			});
			renderer.dispose();
			// Give the GPU memory back now rather than when the context is collected.
			renderer.forceContextLoss();
		}
	};
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/** A gradient dome: pale horizon, deeper blue overhead. */
function buildSky() {
	const material = new THREE.ShaderMaterial({
		side: THREE.BackSide,
		depthWrite: false,
		fog: false,
		uniforms: {
			top: { value: new THREE.Color('#5d93c9') },
			horizon: { value: new THREE.Color('#c9dced') }
		},
		vertexShader: `
			varying vec3 vDir;
			void main() {
				vDir = normalize(position);
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}`,
		fragmentShader: `
			uniform vec3 top; uniform vec3 horizon; varying vec3 vDir;
			void main() {
				float t = smoothstep(-0.05, 0.6, vDir.y);
				gl_FragColor = vec4(mix(horizon, top, t), 1.0);
			}`
	});
	const sky = new THREE.Mesh(new THREE.SphereGeometry(12000, 24, 12), material);
	sky.frustumCulled = false;
	return sky;
}

/** Piste markers: a pole every 40 m down both edges of each run, capped in its colour. */
function buildPoles(resort: Resort, terrain: Terrain) {
	const positions: { x: number; z: number; color: string }[] = [];
	for (const run of resort.runs) {
		const p = run.path;
		let carry = 0;
		for (let i = 1; i < p.length; i++) {
			const [x0, z0] = p[i - 1];
			const [x1, z1] = p[i];
			const len = Math.hypot(x1 - x0, z1 - z0);
			if (!len) continue;
			const nx = -(z1 - z0) / len;
			const nz = (x1 - x0) / len;
			for (let d = carry; d < len; d += 40) {
				const t = d / len;
				const x = x0 + (x1 - x0) * t;
				const z = z0 + (z1 - z0) * t;
				for (const s of [1, -1])
					positions.push({
						x: x + nx * s * (RUN_WIDTH / 2 + 1),
						z: z + nz * s * (RUN_WIDTH / 2 + 1),
						color: DIFFICULTY_COLOR[run.difficulty]
					});
				carry = d + 40 - len;
			}
		}
	}
	const pole = new THREE.CylinderGeometry(0.06, 0.06, 2.2, 5).translate(0, 1.1, 0);
	const cap = new THREE.SphereGeometry(0.22, 8, 6).translate(0, 2.3, 0);
	const poles = new THREE.InstancedMesh(
		pole,
		new THREE.MeshStandardMaterial({ color: '#e9ecef', roughness: 0.6 }),
		positions.length
	);
	const caps = new THREE.InstancedMesh(
		cap,
		new THREE.MeshStandardMaterial({ roughness: 0.4 }),
		positions.length
	);
	const m = new THREE.Matrix4();
	const c = new THREE.Color();
	positions.forEach((p, i) => {
		m.makeTranslation(p.x, terrain.height(p.x, p.z), p.z);
		poles.setMatrixAt(i, m);
		caps.setMatrixAt(i, m);
		caps.setColorAt(i, c.set(p.color));
	});
	poles.frustumCulled = caps.frustumCulled = false;
	const group = new THREE.Group();
	group.add(poles, caps);
	return group;
}

/**
 * A blocky snowboarder standing sideways on the board: hips over the board, knees that bend,
 * a torso that leans into turns, and a tumble when things go wrong. The board's long axis is
 * x; the rider faces +z, so knees bend towards +z and turns lean about the x axis.
 */
function buildFigure() {
	const group = new THREE.Group();
	const mat = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
	const box = (w: number, h: number, d: number, color: string) => {
		const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
		mesh.castShadow = true;
		return mesh;
	};
	const board = box(1.55, 0.05, 0.28, '#1864ab');
	board.position.y = 0.04;
	group.add(board);

	// Everything above the board pivots at the feet, so a fall rotates the whole rider.
	const rig = new THREE.Group();
	group.add(rig);
	const hips = new THREE.Group();
	rig.add(hips);
	const LEG = 0.44;
	type Leg = { thigh: THREE.Group; knee: THREE.Group };
	const legs: Leg[] = [-0.3, 0.3].map((x) => {
		const thigh = new THREE.Group();
		thigh.position.x = x;
		const upper = box(0.2, LEG, 0.22, '#343a40');
		upper.position.y = -LEG / 2;
		thigh.add(upper);
		const knee = new THREE.Group();
		knee.position.y = -LEG;
		const lower = box(0.18, LEG, 0.2, '#2b3036');
		lower.position.y = -LEG / 2;
		const boot = box(0.24, 0.12, 0.3, '#16191d');
		boot.position.set(0, -LEG + 0.02, 0.02);
		knee.add(lower, boot);
		thigh.add(knee);
		hips.add(thigh);
		return { thigh, knee };
	});
	const pelvis = box(0.64, 0.18, 0.3, '#343a40');
	hips.add(pelvis);
	// The torso pivots at the hips.
	const torso = new THREE.Group();
	hips.add(torso);
	const chest = box(0.6, 0.6, 0.32, '#e8590c');
	chest.position.y = 0.38;
	torso.add(chest);
	const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), mat('#f1f3f5'));
	head.position.y = 0.88;
	head.castShadow = true;
	torso.add(head);
	const arms = [-0.4, 0.4].map((x) => {
		const shoulder = new THREE.Group();
		shoulder.position.set(x, 0.62, 0);
		// Darker than the chest, with a glove, so the arms read against the body from the side.
		const arm = box(0.13, 0.42, 0.13, '#b84708');
		arm.position.y = -0.21;
		const glove = box(0.14, 0.12, 0.14, '#16191d');
		glove.position.y = -0.47;
		shoulder.add(arm, glove);
		torso.add(shoulder);
		return shoulder;
	});
	/**
	 * Rotation about z that swings an arm away from the body by `angle`: a hanging arm turned
	 * by a positive angle about z moves its hand towards +x, so the arm on -x needs the opposite.
	 */
	const outward = (i: number, angle: number) => (i === 0 ? -angle : angle);

	/**
	 * Bend the legs so the feet stay on the board: thighs forward, shins back. With `sit` the
	 * legs go to a chairlift seat instead: thighs out level, shins hanging.
	 */
	function pose(crouch: number, sit: number) {
		const stand = 0.3 + crouch * 0.85; // thigh from vertical, knees towards +z
		const a = stand * (1 - sit) + 1.45 * sit;
		const b = -stand * 0.95 * (1 - sit) - 0.1 * sit; // shin leans back, or hangs
		// A limb of length L at angle t hangs to (0, -L cos t, L sin t).
		hips.position.y = LEG * (Math.cos(a) + Math.cos(b)) + 0.1;
		hips.position.z = -LEG * (Math.sin(a) + Math.sin(b));
		for (const { thigh, knee } of legs) {
			thigh.rotation.x = -a;
			knee.rotation.x = -(b - a);
		}
	}

	let crouch = 0.25;
	let sit = 0;
	let fall = 0;
	let lean = 0;
	/** Where the arms are heading: spread from the body, and swung forward or back. */
	let spread = 0.3;
	let swing = 0;
	let flail = 0;
	const q = new THREE.Quaternion();
	const up = new THREE.Vector3(0, 1, 0);
	const tilt = new THREE.Quaternion();
	const ease = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);
	return {
		group,
		update(rider: Rider, dt: number, input: Input) {
			group.position.copy(rider.position);
			// Yaw to the heading: the board's long axis is x, the heading is a bearing in x–z.
			// On a lift the rider faces the way the carrier is going, board hanging across it.
			const onLift = rider.mode === 'lift';
			q.setFromAxisAngle(up, onLift ? Math.PI / 2 - rider.heading : -rider.heading);
			// Then settle onto the slope.
			if (rider.mode === 'ride' || rider.mode === 'crash') {
				tilt.setFromUnitVectors(up, rider.normal);
				q.premultiply(tilt);
			}
			group.quaternion.slerp(q, ease(dt, 12));

			// Knees: easy bend riding, deep in a tuck or a brake, pulled up in the air.
			const wantCrouch =
				rider.mode === 'crash'
					? 0.05
					: rider.mode === 'air'
						? 0.9
						: rider.mode === 'lift'
							? 0.5
							: input.tuck
								? 0.85
								: input.brake
									? 0.6
									: 0.3 + Math.min(0.25, rider.speed / 80);
			crouch += (wantCrouch - crouch) * ease(dt, 6);
			const seated = onLift && rider.lift?.lift.kind === 'chair';
			sit += ((seated ? 1 : 0) - sit) * ease(dt, 6);
			pose(crouch, sit);

			// Lean into the turn centre, which is across the board, and turn the shoulders with it.
			lean += (rider.lean - lean) * ease(dt, 7);
			torso.rotation.x = lean * 0.55 + (input.tuck ? 0.35 : 0.12) * (1 - sit);
			torso.rotation.y = -lean * 0.4;
			torso.rotation.z = 0;

			// Arms: out for balance in a carve and swung against the lean, thrown up in the air,
			// tucked in at speed, and waving about in a wipeout.
			const air = rider.mode === 'air';
			const wantSpread = air
				? 1.9
				: rider.mode === 'crash'
					? 1.2
					: seated
						? 0.2
						: input.tuck
							? 0.1
							: 0.35 + Math.abs(lean) * 1.1;
			// Seated, the hands rest forward on the lap.
			const wantSwing = air ? -0.4 : seated ? 0.5 : input.tuck ? 0.5 : -lean * 1.1;
			spread += (wantSpread - spread) * ease(dt, air ? 10 : 6);
			swing += (wantSwing - swing) * ease(dt, 6);
			flail = rider.mode === 'crash' ? flail + dt * 14 : 0;
			arms.forEach((arm, i) => {
				const wave = flail ? Math.sin(flail + i * 2) * 0.6 : 0;
				arm.rotation.z = outward(i, spread + wave);
				// The leading arm reaches further round the turn than the trailing one.
				arm.rotation.x = swing * (i === 0 ? 1.2 : 0.8) + wave * 0.5;
			});

			// A crash: topple over onto the snow, lie there, then get back up.
			const wantFall =
				rider.mode === 'crash' ? (rider.crashTimer > 0.6 ? 1 : rider.crashTimer / 0.6) : 0;
			fall += (wantFall - fall) * ease(dt, wantFall > fall ? 9 : 4);
			rig.rotation.x = fall * 1.5;
			rig.position.z = fall * 0.25;
			rig.position.y = -fall * 0.05;
			torso.rotation.x += fall * 0.4;
		}
	};
}
