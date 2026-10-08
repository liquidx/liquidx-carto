import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** Where the main light comes from. */
export interface Sun {
	/** Compass bearing of the sun in degrees, clockwise from north: 90 lights from the east. */
	azimuth: number;
	/** Height of the sun above the horizon in degrees. */
	elevation: number;
	/** Brightness of the sun. */
	intensity: number;
}

/** Afternoon light from the south-west. */
export const DEFAULT_SUN: Sun = { azimuth: 231, elevation: 48, intensity: 1.7 };

export interface Stage {
	scene: THREE.Scene;
	camera: THREE.PerspectiveCamera;
	controls: OrbitControls;
	renderer: THREE.WebGLRenderer;
	/** Where the main light is now. */
	readonly sun: Sun;
	/** Move or dim the main light; the fill light stays opposite it. Unset fields keep their value. */
	setSun(sun: Partial<Sun>): void;
	/**
	 * Run `fn` on every animation frame, before anything is drawn; returns a function that stops
	 * it. A frame is only drawn when the view moved or something asked for it, so a callback
	 * that changes the scene calls `invalidate()`.
	 */
	onFrame(fn: () => void): () => void;
	/** Draw the next frame. Call after changing anything that shows. */
	invalidate(): void;
	/**
	 * Draw the next frame with fresh shadows. The shadows are kept between frames, so call this
	 * after adding, removing or moving anything that casts one.
	 */
	invalidateShadows(): void;
	dispose(): void;
}

/**
 * Renderer, camera, orbit controls and lighting for a diorama normalised to a unit radius.
 * Appends a canvas to `container`, tracks its size and, until disposed, renders a frame
 * whenever the view moves or `invalidate()` asks for one.
 */
export function createStage(container: HTMLElement): Stage {
	const scene = new THREE.Scene();
	const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
	renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFShadowMap;
	// Drawing the shadows costs as much as drawing the scene, and they only change when the
	// sun or something casting them does: see `invalidateShadows`.
	renderer.shadowMap.autoUpdate = false;
	renderer.shadowMap.needsUpdate = true;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 0.95;
	renderer.domElement.style.display = 'block';
	renderer.domElement.style.width = '100%';
	renderer.domElement.style.height = '100%';
	container.appendChild(renderer.domElement);

	const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
	camera.position.set(2.4, 1.9, 2.6);

	const controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.06;
	controls.target.set(0, 0.15, 0);
	controls.minDistance = 0.8;
	controls.maxDistance = 12;
	controls.maxPolarAngle = Math.PI * 0.55;

	scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x6a5a48, 0.55));
	const sunLight = new THREE.DirectionalLight(0xfff2e0);
	sunLight.castShadow = true;
	sunLight.shadow.mapSize.set(2048, 2048);
	Object.assign(sunLight.shadow.camera, { left: -1.6, right: 1.6, top: 1.6, bottom: -1.6 });
	sunLight.shadow.camera.near = 0.5;
	sunLight.shadow.camera.far = 12;
	sunLight.shadow.bias = -0.0004;
	sunLight.shadow.normalBias = 0.01;
	scene.add(sunLight);
	// A weak light from the far side, so slopes facing away from the sun keep their shape.
	const fill = new THREE.DirectionalLight(0xc8d8ff, 0.3);
	scene.add(fill);

	// Model x is east, y is up and z is south.
	const aim = (light: THREE.Object3D, azimuth: number, elevation: number, distance: number) => {
		const a = THREE.MathUtils.degToRad(azimuth);
		const e = THREE.MathUtils.degToRad(elevation);
		light.position
			.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e))
			.multiplyScalar(distance);
	};
	let dirty = true;
	const invalidate = () => {
		dirty = true;
	};
	const invalidateShadows = () => {
		renderer.shadowMap.needsUpdate = true;
		dirty = true;
	};

	const sun = { ...DEFAULT_SUN };
	const setSun = (next: Partial<Sun>) => {
		Object.assign(sun, next);
		sunLight.intensity = sun.intensity;
		aim(sunLight, sun.azimuth, sun.elevation, 4.7);
		aim(fill, sun.azimuth + 185, 15, 3.7);
		invalidateShadows();
	};
	setSun({});

	const resize = () => {
		const w = container.clientWidth || 1;
		const h = container.clientHeight || 1;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		invalidate();
	};
	const ro = new ResizeObserver(resize);
	ro.observe(container);
	resize();

	const frameCallbacks = new Set<() => void>();
	let raf = 0;
	const loop = () => {
		raf = requestAnimationFrame(loop);
		// True while the view is turning, being dragged or settling.
		const moved = controls.update();
		for (const fn of frameCallbacks) fn();
		if (!moved && !dirty) return;
		dirty = false;
		renderer.render(scene, camera);
	};
	loop();

	return {
		scene,
		camera,
		controls,
		renderer,
		sun,
		setSun,
		onFrame(fn) {
			frameCallbacks.add(fn);
			return () => frameCallbacks.delete(fn);
		},
		invalidate,
		invalidateShadows,
		dispose() {
			cancelAnimationFrame(raf);
			ro.disconnect();
			controls.dispose();
			renderer.dispose();
			renderer.domElement.remove();
		}
	};
}
