/// <reference lib="webworker" />
import { unzipSync } from 'fflate';
import { parseFgdDem } from './parse.js';
import { renderHillshade } from './hillshade.js';
import type { DemTile, HillshadeOptions } from './types.js';

export type WorkerRequest =
	| { type: 'parse'; id: number; file?: File; url?: string; name: string }
	| { type: 'preview'; id: number; tile: DemTile; opts: HillshadeOptions };

export type WorkerResponse =
	| { type: 'parsed'; id: number; tiles: DemTile[] }
	| { type: 'preview'; id: number; blob: Blob; width: number; height: number }
	| { type: 'error'; id: number; message: string };

const decoder = new TextDecoder('utf-8');

async function loadBytes(req: Extract<WorkerRequest, { type: 'parse' }>): Promise<Uint8Array> {
	if (req.file) return new Uint8Array(await req.file.arrayBuffer());
	if (req.url) {
		const res = await fetch(req.url);
		if (!res.ok) throw new Error(`fetch ${req.url}: ${res.status}`);
		return new Uint8Array(await res.arrayBuffer());
	}
	throw new Error('no source');
}

function parseBytes(bytes: Uint8Array, name: string): DemTile[] {
	if (name.toLowerCase().endsWith('.zip')) {
		const entries = unzipSync(bytes, {
			filter: (f) => f.name.toLowerCase().endsWith('.xml') && f.name.includes('DEM')
		});
		const out: DemTile[] = [];
		for (const [entryName, data] of Object.entries(entries)) {
			out.push(parseFgdDem(decoder.decode(data), entryName.split('/').pop() ?? entryName));
		}
		return out;
	}
	return [parseFgdDem(decoder.decode(bytes), name)];
}

const post = (msg: WorkerResponse, transfer: Transferable[] = []) =>
	(self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
	const req = ev.data;
	try {
		if (req.type === 'parse') {
			const bytes = await loadBytes(req);
			const tiles = parseBytes(bytes, req.name);
			post(
				{ type: 'parsed', id: req.id, tiles },
				tiles.map((t) => t.data.buffer as ArrayBuffer)
			);
		} else if (req.type === 'preview') {
			const { rgba, width, height } = renderHillshade(req.tile, req.opts);
			const canvas = new OffscreenCanvas(width, height);
			const ctx = canvas.getContext('2d')!;
			ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
			const blob = await canvas.convertToBlob({ type: 'image/png' });
			post({ type: 'preview', id: req.id, blob, width, height });
		}
	} catch (e) {
		post({ type: 'error', id: req.id, message: (e as Error).message });
	}
};
