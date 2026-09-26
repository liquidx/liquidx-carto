/** Hypsometric ramp: stops in normalised [0, 1] elevation → rgb 0–255. */
const RAMP: [number, [number, number, number]][] = [
	[0.0, [77, 128, 82]],
	[0.2, [122, 166, 92]],
	[0.4, [190, 190, 120]],
	[0.6, [186, 150, 96]],
	[0.8, [160, 120, 90]],
	[0.95, [220, 220, 220]],
	[1.0, [255, 255, 255]]
];

/** Write the ramp colour for `t` into `out[o..o+2]`. */
export function rampColor(t: number, out: { [i: number]: number }, o = 0) {
	t = Math.min(1, Math.max(0, t));
	for (let i = 1; i < RAMP.length; i++) {
		if (t <= RAMP[i][0]) {
			const [t0, c0] = RAMP[i - 1];
			const [t1, c1] = RAMP[i];
			const f = (t - t0) / (t1 - t0);
			out[o] = c0[0] + (c1[0] - c0[0]) * f;
			out[o + 1] = c0[1] + (c1[1] - c0[1]) * f;
			out[o + 2] = c0[2] + (c1[2] - c0[2]) * f;
			return;
		}
	}
}
