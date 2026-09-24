<!-- 9px ruler of 1px ticks every 24px on a hairline baseline. -->
<script lang="ts">
	type Props = { mobileOnly?: boolean };

	let { mobileOnly = false }: Props = $props();
</script>

<div class="ticks" class:mobile-only={mobileOnly} aria-hidden="true"></div>

<style>
	.ticks {
		height: 9px;
		background-image: repeating-linear-gradient(
			90deg,
			rgba(255, 255, 255, 0.16) 0 1px,
			transparent 1px 24px
		);
		border-bottom: 1px solid var(--color-line);
	}
	@media (min-width: 720px) {
		.mobile-only {
			display: none;
		}
	}
</style>
