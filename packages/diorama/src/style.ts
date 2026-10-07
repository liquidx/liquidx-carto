import * as THREE from 'three';

/** A colour stop: position along the ramp, then any three.js colour (`'#fff'`, `0xffffff`). */
export type RampStop = [stop: number, color: THREE.ColorRepresentation];

/** A value for a custom shader uniform. Strings are colours; arrays of 2–4 numbers are vectors. */
export type UniformValue = number | string | number[] | THREE.Color | THREE.Texture;

/** How the terrain is drawn. Start from a preset in `terrainStyles` and override what you need. */
export interface TerrainStyle {
	/** Surface colour by elevation, lowest stop first. */
	ramp: RampStop[];
	/**
	 * `normalized` (default) spreads stops 0–1 over the model's own elevation range; `metres`
	 * pins them to real elevations, so a snowline sits at the same height in every model.
	 */
	rampUnits?: 'normalized' | 'metres';
	/** Tint steep ground, fading in between `from` and `to` degrees of real (unexaggerated) slope. */
	slope?: { color: THREE.ColorRepresentation; from: number; to: number };
	/** Contour line colour and strength (0–1); `false` hides them. */
	contours?: { color: THREE.ColorRepresentation; strength: number } | false;
	/**
	 * The cut sides and bottom: layered earth with a `topLayer` under the surface and `strata`
	 * tones below it, or one flat `color`.
	 */
	sides?:
		| {
				topLayer?: THREE.ColorRepresentation;
				strata?: [THREE.ColorRepresentation, THREE.ColorRepresentation];
		  }
		| { color: THREE.ColorRepresentation };
	roughness?: number;
	/**
	 * GLSL defining
	 * `vec3 surface(vec3 base, float elevation, float slope, vec3 normal, vec2 uv)`,
	 * which returns the surface colour (linear RGB) before overlays, contours and lighting.
	 * `base` is the ramp and slope colour, `elevation` is in metres, `slope` in degrees,
	 * `normal` is in model space (y up) and `uv` runs 0–1 west to east and north to south.
	 */
	surface?: string;
	/** Values for uniforms used by `surface`. Declared for you; changing a value is cheap. */
	uniforms?: Record<string, UniformValue>;
}

const SOIL = {
	topLayer: '#816950',
	strata: ['#b59779', '#ecd7b8']
} satisfies TerrainStyle['sides'];

export const terrainStyles = {
	/** Hypsometric tints with brown contours, like a printed terrain map. */
	topo: {
		ramp: [
			[0.0, '#95bc9a'],
			[0.2, '#b8d3a2'],
			[0.4, '#e0e0b6'],
			[0.6, '#decaa5'],
			[0.8, '#d0b6a0'],
			[0.95, '#efefef'],
			[1.0, '#ffffff']
		],
		contours: { color: '#3a2a1a', strength: 0.55 },
		sides: SOIL
	},
	/** Mostly white, a little blue in the valleys, with rock showing on the steepest faces. */
	snow: {
		ramp: [
			[0.0, '#e2eaf3'],
			[0.35, '#f3f6fa'],
			[1.0, '#ffffff']
		],
		slope: { color: '#8c8e93', from: 40, to: 55 },
		contours: { color: '#6f89a8', strength: 0.5 },
		sides: { ...SOIL, topLayer: '#f1f5f9' }
	}
} satisfies Record<string, TerrainStyle>;

export type TerrainPreset = keyof typeof terrainStyles;

export function resolveTerrainStyle(style: TerrainPreset | TerrainStyle | undefined): TerrainStyle {
	if (!style) return terrainStyles.topo;
	return typeof style === 'string' ? terrainStyles[style] : style;
}

export const RAMP_SIZE = 256;

/**
 * Fill `out` (RGBA bytes, `RAMP_SIZE` texels, sRGB) with the ramp, and return the stop
 * positions its first and last texel stand for.
 */
export function writeRamp(ramp: RampStop[], out: Uint8Array): [lo: number, hi: number] {
	const stops = ramp.map(([t, c]) => [t, new THREE.Color(c)] as const).sort((a, b) => a[0] - b[0]);
	if (!stops.length) stops.push([0, new THREE.Color(0xffffff)]);
	const lo = stops[0][0];
	const hi = stops[stops.length - 1][0];
	const c = new THREE.Color();
	let k = 1;
	for (let i = 0; i < RAMP_SIZE; i++) {
		const t = lo + ((hi - lo) * i) / (RAMP_SIZE - 1);
		while (k < stops.length - 1 && t > stops[k][0]) k++;
		const [t0, c0] = stops[Math.max(0, k - 1)];
		const [t1, c1] = stops[Math.min(k, stops.length - 1)];
		const f = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
		c.copy(c0).lerp(c1, f).convertLinearToSRGB();
		out[i * 4] = Math.round(c.r * 255);
		out[i * 4 + 1] = Math.round(c.g * 255);
		out[i * 4 + 2] = Math.round(c.b * 255);
		out[i * 4 + 3] = 255;
	}
	return [lo, hi];
}
