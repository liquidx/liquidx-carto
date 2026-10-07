<!--
	Draws on the terrain surface of the enclosing `<Diorama>`: GeoJSON, an image, or anything
	you paint on a canvas. Everything follows the relief exactly. Drapes stack in the order
	they appear, under the contour lines unless `above` is set.
-->
<script lang="ts" module>
	import type { Feature } from 'geojson';
	import type { GeoJSONSource } from './geojson.svelte.js';
	import type { LonLat } from './surface.js';

	/** Canvas colours and sizes. Sizes are in the drape's `units`. */
	export interface DrapePaint {
		/** Fill for polygons and points. */
		fill?: string;
		/** Outline for polygons and points, and the colour of lines. */
		stroke?: string;
		/** Stroke width. */
		width?: number;
		/** Dash pattern: lengths of dashes and gaps. */
		dash?: number[];
		/** Radius of points. */
		radius?: number;
	}

	/** Helpers for a custom `draw` function. */
	export interface DrapeView {
		/** Canvas position of a longitude and latitude. */
		project(lonLat: LonLat): [x: number, y: number];
		/** Metres on the ground as canvas units. */
		metres(n: number): number;
		/** Width and height of the canvas in its own units; the diorama is the inscribed circle. */
		size: number;
	}

	const DEFAULT_PAINT: DrapePaint = { stroke: '#1f2933', width: 1.5 };
</script>

<script lang="ts">
	import { getDiorama } from './context.js';
	import { DRAPE_SIZE } from './drape.js';
	import { featureShapes } from './geojson.svelte.js';

	type Props = {
		/** GeoJSON to draw (any form, or an array of them), or a URL to fetch it from. */
		data?: GeoJSONSource;
		/** Keep only the features this returns true for. */
		filter?: (feature: Feature) => boolean;
		/** One paint for everything, or a function choosing per feature; return null to skip one. */
		paint?: DrapePaint | ((feature: Feature) => DrapePaint | null | undefined);
		/** An image to lay over `bounds`, north up: a URL or anything a canvas can draw. */
		image?: string | CanvasImageSource | null;
		/** West, south, east and north edges of `image` in degrees. */
		bounds?: [west: number, south: number, east: number, north: number];
		/** Draw freely on the canvas. Runs after `image` and `data`. */
		draw?: (ctx: CanvasRenderingContext2D, view: DrapeView) => void;
		opacity?: number;
		/** What paint sizes mean: `px` with the diorama 1024 px across, or `m` on the ground. */
		units?: 'px' | 'm';
		/** Draw over the contour lines instead of under them. */
		above?: boolean;
	};

	let {
		data,
		filter,
		paint = DEFAULT_PAINT,
		image,
		bounds,
		draw,
		opacity = 1,
		units = 'px',
		above = false
	}: Props = $props();

	const diorama = getDiorama();

	const view: DrapeView = {
		project(lonLat) {
			const [x, z] = diorama.toModel(lonLat);
			return [(x * 0.5 + 0.5) * DRAPE_SIZE, (z * 0.5 + 0.5) * DRAPE_SIZE];
		},
		metres: (n) => diorama.metres(n) * 0.5 * DRAPE_SIZE,
		size: DRAPE_SIZE
	};

	const shapes = featureShapes(
		() => data,
		() => filter
	);

	// An image given as a URL.
	let loaded = $state.raw<HTMLImageElement | null>(null);
	$effect(() => {
		if (typeof image !== 'string') return;
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => (loaded = img);
		img.onerror = () => console.error(`Drape: could not load ${image}`);
		img.src = image;
		return () => {
			img.onload = img.onerror = null;
			loaded = null;
		};
	});
	const picture = $derived(typeof image === 'string' ? loaded : image);

	// Shapes in canvas units with their paint, worked out here so that state read by `filter`
	// and `paint` redraws the drape when it changes.
	const items = $derived.by(() => {
		const out: { kind: string; paths: [number, number][][]; paint: DrapePaint }[] = [];
		for (const shape of shapes.current) {
			const p = typeof paint === 'function' ? paint(shape.feature) : paint;
			if (!p) continue;
			out.push({ kind: shape.kind, paths: shape.coords.map((c) => c.map(view.project)), paint: p });
		}
		return out;
	});

	function render(ctx: CanvasRenderingContext2D) {
		const unit = units === 'm' ? view.metres(1) : 1;
		ctx.globalAlpha = opacity;
		ctx.lineJoin = ctx.lineCap = 'round';

		if (picture && bounds) {
			const [x0, y0] = view.project([bounds[0], bounds[3]]);
			const [x1, y1] = view.project([bounds[2], bounds[1]]);
			ctx.drawImage(picture, x0, y0, x1 - x0, y1 - y0);
		}

		for (const { kind, paths, paint: p } of items) {
			ctx.beginPath();
			if (kind === 'point') {
				const [x, y] = paths[0][0];
				ctx.arc(x, y, (p.radius ?? 4) * unit, 0, Math.PI * 2);
			} else {
				for (const path of paths) {
					path.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
					if (kind === 'polygon') ctx.closePath();
				}
			}
			// A point with no fill is a dot in its stroke colour.
			const dot = kind === 'point' && !p.fill;
			const fill = dot ? p.stroke : p.fill;
			if (fill && kind !== 'line') {
				ctx.fillStyle = fill;
				ctx.fill('evenodd');
			}
			if (p.stroke && !dot) {
				ctx.strokeStyle = p.stroke;
				ctx.lineWidth = (p.width ?? 1.5) * unit;
				ctx.setLineDash((p.dash ?? []).map((d) => d * unit));
				ctx.stroke();
			}
		}

		if (draw) {
			ctx.setLineDash([]);
			draw(ctx, view);
		}
	}

	let anchor: HTMLElement;
	const layer = {
		get anchor() {
			return anchor;
		},
		get above() {
			return above;
		},
		draw: render
	};
	$effect(() => diorama.drapes.add(layer));

	// Redraw when anything the drape shows changes.
	$effect(() => {
		void [items, picture, bounds, draw, opacity, units, above];
		diorama.drapes.invalidate();
	});
</script>

<span bind:this={anchor} hidden></span>
