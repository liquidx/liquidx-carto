import * as THREE from 'three';
import type { TerrainMaterial } from './material.js';

/** Drape drawing units across the diorama, whatever the texture resolution. */
export const DRAPE_SIZE = 1024;

export interface DrapeLayer {
	/** A node marking the layer's place among its siblings; layers draw in document order. */
	anchor: Node;
	/** Draw over the contour lines instead of under them. */
	above: boolean;
	/** Draw in a `DRAPE_SIZE` square: x runs west to east, y north to south. */
	draw(ctx: CanvasRenderingContext2D): void;
}

export interface DrapeCompositor {
	/** Register a layer; returns a function that removes it. */
	add(layer: DrapeLayer): () => void;
	/** Ask for a redraw on the next frame. */
	invalidate(): void;
	/** Texture size in pixels. */
	setResolution(px: number): void;
	/** Redraw if anything changed. Call once per frame. */
	update(): void;
	dispose(): void;
}

interface Plane {
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
	texture: THREE.CanvasTexture;
}

/**
 * Composites drape layers into the terrain material's two overlay textures (under and over
 * the contour lines). A texture only exists while it has layers.
 */
export function createDrapeCompositor(
	terrain: TerrainMaterial,
	options: { resolution: number; anisotropy: number }
): DrapeCompositor {
	const layers = new Set<DrapeLayer>();
	const planes: [Plane | null, Plane | null] = [null, null];
	let resolution = options.resolution;
	let dirty = false;

	function createPlane(): Plane {
		const canvas = document.createElement('canvas');
		const texture = new THREE.CanvasTexture(canvas);
		// Sampled as premultiplied sRGB and decoded in the shader, so edges blend cleanly.
		texture.premultiplyAlpha = true;
		texture.flipY = false;
		texture.anisotropy = options.anisotropy;
		return { canvas, ctx: canvas.getContext('2d')!, texture };
	}

	function paint(index: 0 | 1, list: DrapeLayer[]) {
		if (!list.length) {
			planes[index]?.texture.dispose();
			planes[index] = null;
			return;
		}
		const plane = (planes[index] ??= createPlane());
		const { canvas, ctx } = plane;
		if (canvas.width !== resolution) {
			// A texture cannot change size in place.
			plane.texture.dispose();
			canvas.width = canvas.height = resolution;
		}
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, resolution, resolution);
		const scale = resolution / DRAPE_SIZE;
		for (const layer of list) {
			ctx.save();
			ctx.setTransform(scale, 0, 0, scale, 0, 0);
			layer.draw(ctx);
			ctx.restore();
		}
		plane.texture.needsUpdate = true;
	}

	return {
		add(layer) {
			layers.add(layer);
			dirty = true;
			return () => {
				layers.delete(layer);
				dirty = true;
			};
		},
		invalidate() {
			dirty = true;
		},
		setResolution(px) {
			if (px === resolution) return;
			resolution = px;
			dirty = true;
		},
		update() {
			if (!dirty) return;
			dirty = false;
			const ordered = [...layers].sort((a, b) =>
				a.anchor.compareDocumentPosition(b.anchor) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
			);
			paint(
				0,
				ordered.filter((l) => !l.above)
			);
			paint(
				1,
				ordered.filter((l) => l.above)
			);
			terrain.setDrapes(planes[0]?.texture ?? null, planes[1]?.texture ?? null);
		},
		dispose() {
			terrain.setDrapes(null, null);
			for (const plane of planes) plane?.texture.dispose();
			planes[0] = planes[1] = null;
			layers.clear();
		}
	};
}
