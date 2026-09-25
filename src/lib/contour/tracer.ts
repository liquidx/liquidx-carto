import type { ContourOptions, Grid } from './contour.js';
import type { ContourPath, ContourRequest, ContourResponse } from './worker.js';

/**
 * Runs contour tracing in a dedicated worker. Only the latest request matters: a newer call
 * supersedes older ones, which resolve to null.
 */
export class ContourTracer {
	private worker: Worker | null = null;
	private nextId = 1;
	private latest = 0;
	private pending = new Map<number, (r: ContourResponse | null) => void>();

	private getWorker() {
		if (!this.worker) {
			this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
			this.worker.onmessage = (ev: MessageEvent<ContourResponse>) => {
				const resolve = this.pending.get(ev.data.id);
				this.pending.delete(ev.data.id);
				resolve?.(ev.data.id === this.latest ? ev.data : null);
			};
		}
		return this.worker;
	}

	async trace(
		grid: Grid,
		opts: ContourOptions
	): Promise<{ paths: ContourPath[]; ms: number } | null> {
		const id = this.nextId++;
		this.latest = id;
		const res = await new Promise<ContourResponse | null>((resolve) => {
			this.pending.set(id, resolve);
			// The grid is copied (not transferred) so the caller can re-trace it with new options.
			this.getWorker().postMessage({ id, grid, opts } satisfies ContourRequest);
		});
		if (!res) return null;
		if (res.type === 'error') throw new Error(res.message);
		return { paths: res.paths, ms: res.ms };
	}

	terminate() {
		this.worker?.terminate();
		this.worker = null;
		for (const resolve of this.pending.values()) resolve(null);
		this.pending.clear();
	}
}
