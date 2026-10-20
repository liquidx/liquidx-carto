/// <reference lib="webworker" />
import { viewshed, viewshedImage, type ViewshedOptions } from './viewshed';
import type { TerrainGrid } from './alignment';

export interface ViewshedRequest {
	id: number;
	region: TerrainGrid;
	mountain: TerrainGrid;
	options: ViewshedOptions;
}

export interface ViewshedResponse {
	id: number;
	fractions: Float32Array;
	pixels: Uint8ClampedArray;
}

self.onmessage = (e: MessageEvent<ViewshedRequest>) => {
	const { id, region, mountain, options } = e.data;
	const fractions = viewshed(region, mountain, options);
	const pixels = viewshedImage(fractions);
	const reply: ViewshedResponse = { id, fractions, pixels };
	(self as unknown as Worker).postMessage(reply, [fractions.buffer, pixels.buffer]);
};
