import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface Stage {
	scene: THREE.Scene;
	camera: THREE.PerspectiveCamera;
	controls: OrbitControls;
	renderer: THREE.WebGLRenderer;
	dispose(): void;
}

/**
 * Renderer, camera, orbit controls and lighting for a diorama normalised to a unit radius.
 * Appends a canvas to `container`, tracks its size and renders every frame until disposed.
 */
export function createStage(container: HTMLElement): Stage {
	const scene = new THREE.Scene();
	const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
	renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFShadowMap;
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
	const sun = new THREE.DirectionalLight(0xfff2e0, 1.7);
	sun.position.set(-2.5, 3.5, 2);
	sun.castShadow = true;
	sun.shadow.mapSize.set(2048, 2048);
	Object.assign(sun.shadow.camera, { left: -1.6, right: 1.6, top: 1.6, bottom: -1.6 });
	sun.shadow.camera.near = 0.5;
	sun.shadow.camera.far = 12;
	sun.shadow.bias = -0.0004;
	sun.shadow.normalBias = 0.01;
	scene.add(sun);
	const fill = new THREE.DirectionalLight(0xc8d8ff, 0.3);
	fill.position.set(3, 1, -2);
	scene.add(fill);

	const resize = () => {
		const w = container.clientWidth || 1;
		const h = container.clientHeight || 1;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
	};
	const ro = new ResizeObserver(resize);
	ro.observe(container);
	resize();

	let raf = 0;
	const loop = () => {
		raf = requestAnimationFrame(loop);
		controls.update();
		renderer.render(scene, camera);
	};
	loop();

	return {
		scene,
		camera,
		controls,
		renderer,
		dispose() {
			cancelAnimationFrame(raf);
			ro.disconnect();
			controls.dispose();
			renderer.dispose();
			renderer.domElement.remove();
		}
	};
}
