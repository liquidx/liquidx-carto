/// <reference lib="webworker" />
import { blur, toPathData, traceContours, type ContourOptions, type Grid } from './contour.js';

export type ContourRequest = { id: number; grid: Grid; opts: ContourOptions };

export interface ContourPath {
	value: number;
	major: boolean;
	d: string;
}

export type ContourResponse =
	| { id: number; type: 'done'; paths: ContourPath[]; ms: number }
	| { id: number; type: 'error'; message: string };

self.onmessage = (ev: MessageEvent<ContourRequest>) => {
	const { id, grid, opts } = ev.data;
	try {
		const t0 = performance.now();
		const levels = traceContours(blur(grid, opts.smoothing), opts);
		const paths = levels
			.filter((l) => l.lines.length)
			.map((l) => ({ value: l.value, major: l.major, d: toPathData(l.lines) }));
		const res: ContourResponse = { id, type: 'done', paths, ms: performance.now() - t0 };
		self.postMessage(res);
	} catch (e) {
		self.postMessage({ id, type: 'error', message: (e as Error).message } as ContourResponse);
	}
};
