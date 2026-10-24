import { getContext, setContext } from 'svelte';
import type * as THREE from 'three';
import type { DrapeCompositor } from './drape.js';
import type { DioramaMeta } from './format.js';
import type { Stage } from './stage.js';
import type { DioramaSurface } from './surface.js';

/** How a `Label` stands off the terrain. */
export type LabelVariant = 'light' | 'dark' | 'halo';

/**
 * What a component inside `<Diorama>` works with: the loaded terrain's settings, lookups by
 * longitude and latitude, and places to add things. Children only exist while a terrain is
 * loaded, and are recreated when it changes, so none of this goes stale.
 */
export interface DioramaContext extends DioramaSurface {
	meta: DioramaMeta;
	/**
	 * The size of an object `n` metres across, in model units: `metres(n)` enlarged by the
	 * diorama's `objectScale`. Read it inside an effect to follow changes to the scale.
	 */
	size(n: number): number;
	/** Add three.js objects here, in model space; the group leaves the scene with the terrain. */
	group: THREE.Group;
	/** The renderer, scene, camera and controls. */
	stage: Stage;
	/** The overlays drawn on the terrain surface. */
	drapes: DrapeCompositor;
	/** Whether `Label` children are shown, and how they look unless they say otherwise. */
	labels: { readonly visible: boolean; readonly variant: LabelVariant };
}

const KEY = Symbol('diorama');

export function setDioramaContext(current: () => DioramaContext | undefined) {
	setContext(KEY, current);
}

/** The enclosing `<Diorama>`. Call during component initialisation. */
export function getDiorama(): DioramaContext {
	const context = getContext<(() => DioramaContext | undefined) | undefined>(KEY)?.();
	if (!context) throw new Error('getDiorama() must be called by a component inside <Diorama>');
	return context;
}
