import type { DemTile, HillshadeOptions } from './types.js';
import type { WorkerRequest, WorkerResponse } from './worker.js';

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
type Pending = { resolve: (v: WorkerResponse) => void; reject: (e: Error) => void };

/** Small worker pool for parsing and rendering DEM tiles off the main thread. */
export class DemWorkerPool {
	private workers: Worker[] = [];
	private busy: boolean[] = [];
	private queue: { req: WorkerRequest; p: Pending }[] = [];
	private pending = new Map<number, Pending>();
	private nextId = 1;

	constructor(size = Math.max(1, Math.min(8, (navigator.hardwareConcurrency ?? 4) - 1))) {
		for (let i = 0; i < size; i++) {
			const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
			w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
				const p = this.pending.get(ev.data.id);
				this.pending.delete(ev.data.id);
				this.busy[i] = false;
				if (p) {
					if (ev.data.type === 'error') p.reject(new Error(ev.data.message));
					else p.resolve(ev.data);
				}
				this.pump();
			};
			this.workers.push(w);
			this.busy.push(false);
		}
	}

	private pump() {
		for (let i = 0; i < this.workers.length && this.queue.length; i++) {
			if (this.busy[i]) continue;
			const job = this.queue.shift()!;
			this.busy[i] = true;
			this.pending.set(job.req.id, job.p);
			this.workers[i].postMessage(job.req);
		}
	}

	private submit(req: DistributiveOmit<WorkerRequest, 'id'>) {
		return new Promise<WorkerResponse>((resolve, reject) => {
			const full = { ...req, id: this.nextId++ } as WorkerRequest;
			this.queue.push({ req: full, p: { resolve, reject } });
			this.pump();
		});
	}

	async parse(source: File | string, name: string): Promise<DemTile[]> {
		const req =
			typeof source === 'string'
				? { type: 'parse' as const, url: source, name }
				: { type: 'parse' as const, file: source, name };
		const res = await this.submit(req);
		if (res.type !== 'parsed') throw new Error('unexpected response');
		return res.tiles;
	}

	/** Render a preview PNG. The tile buffer is structured-cloned so the store keeps its copy. */
	async preview(tile: DemTile, opts: HillshadeOptions): Promise<Blob> {
		const res = await this.submit({ type: 'preview', tile, opts });
		if (res.type !== 'preview') throw new Error('unexpected response');
		return res.blob;
	}

	terminate() {
		this.workers.forEach((w) => w.terminate());
	}
}
