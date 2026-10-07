import { describe, expect, it } from 'vitest';
import { createDrapeCompositor, createTerrainMaterial } from '@liquidx/diorama';

describe('drape compositor', () => {
	it('draws layers in document order, split around the contour lines', () => {
		const terrain = createTerrainMaterial();
		const drapes = createDrapeCompositor(terrain, { resolution: 64, anisotropy: 1 });
		const host = document.body.appendChild(document.createElement('div'));
		const drawn: string[] = [];
		const layer = (name: string, above = false) => ({
			anchor: document.createElement('span'),
			above,
			draw: () => void drawn.push(name)
		});
		const [first, second, top] = [layer('first'), layer('second'), layer('top', true)];
		// Registered out of order, as when an {#if} adds an earlier sibling later.
		host.append(first.anchor, top.anchor, second.anchor);
		const removeSecond = drapes.add(second);
		drapes.add(top);
		drapes.add(first);

		drapes.update();
		expect(drawn).toEqual(['first', 'second', 'top']);
		expect(terrain.uniforms.uDrape.value).not.toBeNull();
		expect(terrain.uniforms.uDrapeTop.value).not.toBeNull();

		// Nothing changed, so nothing is redrawn.
		drapes.update();
		expect(drawn).toHaveLength(3);

		removeSecond();
		drapes.update();
		expect(drawn.slice(3)).toEqual(['first', 'top']);

		drapes.dispose();
		expect(terrain.uniforms.uDrape.value).toBeNull();
		host.remove();
		terrain.dispose();
	});
});
