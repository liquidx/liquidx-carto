/**
 * The snowboard game: builds the scene for a resort, runs the loop, and reports to the HUD.
 */
import type { FeatureCollection } from 'geojson';
import * as THREE from 'three';
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
	/** An element over the canvas for the lift names floating over their stations. */
	labels?: HTMLElement;
	/** Wood and forest polygons; trees only stand inside them where the data covers. */
	woods?: FeatureCollection | null;
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

	const terrain = new Terrain(frame, provider, ground.texture);
	onProgress({ stage: `fetching ${terrain.cellCount} terrain tiles`, fraction: 0 });
	await terrain.loadBase((p) =>
		onProgress({
			stage: `fetching ${provider.label} terrain · ${p.loaded} of ${p.total} tiles`,
			fraction: p.loaded / p.total
		})
	);

	onProgress({ stage: 'building the lifts' });
	await tick();
	const lifts = buildLifts(resort.lifts, terrain);

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
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
		const back = rider.mode === 'lift' ? 12 : 8.5 + speed * 0.12;
		const up = rider.mode === 'lift' ? 3 : 3.2 + speed * 0.03;
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
		camera.fov = 62 + Math.min(14, speed * 0.3);
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
	// Lift names over their stations: DOM labels placed every frame, faded with distance and
	// hidden when the terrain is in the way.
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
				d < 2600 &&
				screen.z < 1 &&
				Math.abs(screen.x) < 1.1 &&
				Math.abs(screen.y) < 1.1 &&
				!occluded(at);
			if (!show) {
				el.style.opacity = '0';
				continue;
			}
			el.style.opacity = String(Math.min(1, (2600 - d) / 800));
			el.style.transform = `translate(${((screen.x + 1) / 2) * w}px, ${((1 - screen.y) / 2) * h}px) translate(-50%, -100%)`;
		}
	}

	function loop(now: number) {
		if (disposed) return;
		requestAnimationFrame(loop);
		const dt = Math.min(0.05, (now - last) / 1000);
		last = now;
		frames++;
		if (now - fpsAt > 1000) {
			fps = Math.round((frames * 1000) / (now - fpsAt));
			frames = 0;
			fpsAt = now;
		}
		lifts.update(dt);
		if (!paused) {
			rider.update(dt, input);
			terrain.update(rider.position.x, rider.position.z);
			nearLift = null;
			if (rider.mode === 'ride' && rider.speed < 7) {
				for (const line of lifts.lines) {
					if (rider.position.distanceTo(line.bottom) < 22) nearLift = line;
				}
			}
			placeCamera(dt);
		}
		figure.update(rider, dt);
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
			renderer.dispose();
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

/** A blocky snowboarder standing sideways on the board. */
function buildFigure() {
	const group = new THREE.Group();
	const body = new THREE.Group();
	group.add(body);
	const mat = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
	const board = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.05, 0.28), mat('#1864ab'));
	board.position.y = 0.04;
	group.add(board);
	const part = (w: number, h: number, d: number, color: string, x: number, y: number) => {
		const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
		mesh.position.set(x, y, 0);
		mesh.castShadow = true;
		body.add(mesh);
		return mesh;
	};
	part(0.2, 0.75, 0.22, '#343a40', -0.28, 0.45); // legs
	part(0.2, 0.75, 0.22, '#343a40', 0.28, 0.45);
	const torso = part(0.62, 0.6, 0.34, '#e8590c', 0, 1.15);
	part(0.14, 0.5, 0.14, '#e8590c', -0.44, 1.1); // arms
	part(0.14, 0.5, 0.14, '#e8590c', 0.44, 1.1);
	const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), mat('#f1f3f5'));
	head.position.set(0, 1.66, 0);
	head.castShadow = true;
	body.add(head);
	board.castShadow = true;

	const q = new THREE.Quaternion();
	const up = new THREE.Vector3(0, 1, 0);
	const tilt = new THREE.Quaternion();
	const axisZ = new THREE.Vector3(0, 0, 1);
	return {
		group,
		update(rider: Rider, dt: number) {
			group.position.copy(rider.position);
			// Yaw to the heading: the board's long axis is x, the heading is a bearing in x–z.
			q.setFromAxisAngle(up, -rider.heading);
			// Then settle onto the slope.
			if (rider.mode === 'ride' || rider.mode === 'crash') {
				tilt.setFromUnitVectors(up, rider.normal);
				q.premultiply(tilt);
			}
			group.quaternion.slerp(q, 1 - Math.exp(-dt * 12));
			// Lean into turns; crouch in the air and when crashed.
			body.quaternion.setFromAxisAngle(axisZ, -rider.lean * 0.45);
			const crouch = rider.mode === 'air' ? 0.8 : rider.mode === 'crash' ? 0.35 : 1;
			body.scale.setScalar(1).y = crouch;
			torso.visible = true;
		}
	};
}
