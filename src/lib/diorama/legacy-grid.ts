import * as THREE from 'three';

/**
 * Test helper: a diorama geometry in the layout older exports used, with `segments` vertices
 * on every ring and each cell split along one diagonal. Heights are `height(x, z)` in both
 * model units and metres. The wall and bottom vertices are present but not joined up, which
 * is all that reading such a file needs.
 */
export function legacyGridGeometry(
	rings: number,
	segments: number,
	height: (x: number, z: number) => number
): THREE.BufferGeometry {
	const top = 1 + rings * segments;
	const total = top + segments * 3 + 1;
	const position = new Float32Array(total * 3);
	const elevation = new Float32Array(total);
	const contourMask = new Float32Array(total);
	for (let i = 0; i < top; i++) {
		const ring = i === 0 ? 0 : Math.floor((i - 1) / segments) + 1;
		const theta = i === 0 ? 0 : (((i - 1) % segments) / segments) * Math.PI * 2;
		const x = (Math.cos(theta) * ring) / rings;
		const z = (Math.sin(theta) * ring) / rings;
		position.set([x, height(x, z), z], i * 3);
		elevation[i] = height(x, z);
		contourMask[i] = 1;
	}
	const index: number[] = [];
	for (let s = 0; s < segments; s++) index.push(0, 1 + ((s + 1) % segments), 1 + s);
	for (let ring = 1; ring < rings; ring++) {
		for (let s = 0; s < segments; s++) {
			const a = 1 + (ring - 1) * segments + s;
			const b = 1 + (ring - 1) * segments + ((s + 1) % segments);
			const c = a + segments;
			const d = b + segments;
			index.push(a, d, c, a, b, d);
		}
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
	geometry.setAttribute('elevation', new THREE.BufferAttribute(elevation, 1));
	geometry.setAttribute('contourMask', new THREE.BufferAttribute(contourMask, 1));
	geometry.setAttribute('surfaceY', new THREE.BufferAttribute(new Float32Array(total), 1));
	geometry.setIndex(index);
	geometry.computeVertexNormals();
	return geometry;
}
