<!--
	Click on the minimap diorama to pick a place on the terrain: a press that does not drag
	reports the longitude and latitude under the pointer. Must sit inside `<Diorama>`.
-->
<script lang="ts">
	import * as THREE from 'three';
	import { getDiorama } from '@liquidx/diorama';

	type Props = { onpick: (lon: number, lat: number) => void };
	let { onpick }: Props = $props();

	const diorama = getDiorama();
	const M_PER_DEG_LAT = 111_320;

	$effect(() => {
		const { renderer, camera, scene } = diorama.stage;
		const el = renderer.domElement;
		const raycaster = new THREE.Raycaster();
		const ndc = new THREE.Vector2();
		let down: [number, number] | null = null;
		const onDown = (e: PointerEvent) => (down = [e.clientX, e.clientY]);
		const onUp = (e: PointerEvent) => {
			if (!down) return;
			const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
			down = null;
			if (moved > 4) return;
			const r = el.getBoundingClientRect();
			ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
			raycaster.setFromCamera(ndc, camera);
			// The terrain is the mesh carrying elevations; skip the pins and lifts.
			const terrain = scene.children.filter(
				(o): o is THREE.Mesh => o instanceof THREE.Mesh && !!o.geometry.getAttribute('elevation')
			);
			const hit = raycaster.intersectObjects(terrain, false)[0];
			if (!hit) return;
			const { lon, lat, radius } = diorama.meta;
			const perLon = (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)) / radius;
			onpick(lon + hit.point.x / perLon, lat - hit.point.z / (M_PER_DEG_LAT / radius));
		};
		el.addEventListener('pointerdown', onDown);
		el.addEventListener('pointerup', onUp);
		return () => {
			el.removeEventListener('pointerdown', onDown);
			el.removeEventListener('pointerup', onUp);
		};
	});
</script>
