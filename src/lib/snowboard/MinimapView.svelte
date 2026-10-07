<!--
	Frames the minimap diorama: a view from the south, high enough to fill the box, with the
	orbit kept close so the model never shrinks to a dot. Must sit inside `<Diorama>`.
-->
<script lang="ts">
	import { getDiorama } from '@liquidx/diorama';

	const diorama = getDiorama();

	$effect(() => {
		const { camera, controls } = diorama.stage;
		camera.position.set(0.1, 2.1, 1.5);
		controls.target.set(0, 0.1, 0);
		controls.minDistance = 1.2;
		controls.maxDistance = 4;
		controls.update();
	});
</script>
