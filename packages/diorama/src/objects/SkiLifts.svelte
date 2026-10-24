<!--
	A ski resort's lifts with their sizes, speeds and models worked out from the data: chair
	lifts, gondolas, cable cars and rope tows on `Lift`, and magic carpets on `Carpet`. The
	defaults are in `ski.ts`; any prop of `Lift` given here overrides its default for every
	lift, as a value or a function of the feature.
-->
<script lang="ts">
	import type { Feature } from 'geojson';
	import type { ComponentProps } from 'svelte';
	import type * as THREE from 'three';
	import type { GeoJSONSource, PerFeature } from '../geojson.svelte.js';
	import {
		carrierSpacing,
		carrierWidth,
		isLift,
		LIFT_METRICS,
		LIFT_MODELS,
		liftKind,
		liftSpeed,
		seats
	} from '../ski.js';
	import Carpet from './Carpet.svelte';
	import Lift from './Lift.svelte';

	type Props = Omit<ComponentProps<typeof Lift>, 'data' | 'filter'> & {
		/** Lifts, among anything else: GeoJSON in any form, or a URL. */
		data?: GeoJSONSource;
		/** Which features are lifts. Defaults to those of `kind: 'lift'`. */
		filter?: (feature: Feature) => boolean;
		/** Whether the carriers and carpets travel; when false they stand still. */
		moving?: boolean;
		/** Colour of chairs, and of cabins with no model. */
		chairColor?: THREE.ColorRepresentation;
		cabinColor?: THREE.ColorRepresentation;
		/** Speed of the magic carpets' belts in metres a second. */
		carpetSpeed?: PerFeature<number>;
	};

	let {
		data,
		filter = isLift,
		moving = true,
		chairColor = '#e03131',
		cabinColor = '#f08c00',
		carpetSpeed = liftSpeed,
		...overrides
	}: Props = $props();

	const kind = liftKind;
	const isCabin = (f: Feature) => kind(f) === 'gondola' || kind(f) === 'cableCar';
	const aerial = (f: Feature) => filter(f) && kind(f) !== 'carpet';
	const carpet = (f: Feature) => filter(f) && kind(f) === 'carpet';

	const metrics = (f: Feature) => {
		const k = kind(f);
		return k === 'carpet' ? LIFT_METRICS.chair : LIFT_METRICS[k];
	};
</script>

<Carpet {data} filter={carpet} speed={moving ? carpetSpeed : 0} />
<Lift
	{data}
	filter={aerial}
	height={(f) => metrics(f).height}
	clearance={(f) => metrics(f).clearance}
	stations={(f) => kind(f) !== 'ropeTow'}
	stationModel={(f) => (isCabin(f) ? null : LIFT_MODELS.station)}
	carrier={(f) => (isCabin(f) ? 'cabin' : kind(f) === 'ropeTow' ? 'ball' : 'chair')}
	shuttle={(f) => kind(f) === 'cableCar'}
	carrierEvery={carrierSpacing}
	carrierSize={carrierWidth}
	carrierColor={(f) => (isCabin(f) ? cabinColor : chairColor)}
	carrierModel={(f) =>
		kind(f) === 'cableCar'
			? LIFT_MODELS.cableCar
			: kind(f) === 'gondola'
				? LIFT_MODELS.gondola
				: kind(f) === 'ropeTow'
					? null
					: LIFT_MODELS.chairs[seats(f)]}
	carrierParts={(f) => ({ Hood: f.properties?.bubble ? 0 : false })}
	speed={moving ? liftSpeed : 0}
	{...overrides}
/>
