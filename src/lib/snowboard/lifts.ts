/**
 * Lifts: towers on the terrain, two cables, stations at each end and carriers going round
 * the loop. Each lift also exposes its cable as a path the rider can be carried along.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Lift } from './resort';
import type { Terrain } from './terrain';

/** Metres between towers; closer on a chairlift, whose low cable has to follow the ground. */
const TOWER_EVERY = { gondola: 90, chair: 45, cableCar: 90, ropeTow: 90 };
/**
 * Height of the cable at each tower: a cable car's cabin hangs far lower than a chair, and
 * the rope of a rope tow is at arm's height.
 */
const CABLE_HEIGHT = { gondola: 11, chair: 5.5, cableCar: 17, ropeTow: 1.1 };
/** The least a chairlift's cable is above the snow anywhere: a chair, a rider's legs and a little. */
const CHAIR_CLEARANCE = 4.2;
const GAUGE = 5;
/**
 * Carrier spacing and speed, metres and metres a second. A cable car has no spacing: just two
 * cabins, one on each side, going up and down their own side in turn.
 */
const CARRIER_EVERY = { gondola: 70, chair: 26, ropeTow: 12 };
export const LIFT_SPEED = { gondola: 6, chair: 3.2, cableCar: 8, ropeTow: 2.2 };
/**
 * Where a rider's feet go on each carrier, below the cable, ahead of its hanger and across
 * from its middle: on a chair the seat top is 2.5 m down and the seated figure's feet hang
 * 0.6 m below its hips and a little in front; in a cabin they stand on the floor. On a rope
 * tow they stand beside the rope, on the snow whatever the drop.
 */
const SEAT = {
	chair: { drop: 3.09, forward: 0.34, across: 0 },
	gondola: { drop: 3.3, forward: 0, across: 0 },
	cableCar: { drop: 3.3, forward: 0, across: 0 },
	ropeTow: { drop: 1.1, forward: 0, across: 0.35 }
};
/**
 * The same on the models: a chair's seat top is 2.74 m down and the rider sits right of the
 * middle, or in the middle of an odd number of seats; the floor of a gondola cabin is 3.97 m
 * down and of a cable car 5.88 m.
 */
const MODEL_SEAT = {
	chair: { drop: 3.33, forward: 0.37, across: 0.28 },
	gondola: { drop: 3.97, forward: 0, across: 0 },
	cableCar: { drop: 5.88, forward: 0, across: 0 }
};

export interface LiftLine {
	lift: Lift;
	/** The cable's midline from bottom to top, in world space. */
	path: THREE.Vector3[];
	/** Distance along the path to each point, and the total. */
	lengths: number[];
	total: number;
	/** World position of the bottom and top stations, on the ground. */
	bottom: THREE.Vector3;
	top: THREE.Vector3;
	/** Unit direction of travel on the map at the top, for dropping riders off. */
	heading: number;
	/** Where a rider's feet are, riding the carrier that is `d` metres up the line, into `target`. */
	seat(d: number, target: THREE.Vector3): THREE.Vector3;
	/** Distance up the line of the carrier nearest the bottom station and heading up. */
	nextCarrier(): number;
	/** Position on the cable `d` metres from the bottom, `drop` metres below it. */
	at(d: number, drop: number, target: THREE.Vector3): THREE.Vector3;
}

export interface Lifts {
	group: THREE.Group;
	lines: LiftLine[];
	/** Advance the carriers. */
	update(dt: number): void;
	dispose(): void;
}

function alongPath(path: THREE.Vector3[], lengths: number[], d: number, target: THREE.Vector3) {
	const total = lengths[lengths.length - 1];
	d = Math.max(0, Math.min(total, d));
	let k = 1;
	while (k < path.length - 1 && lengths[k] < d) k++;
	const span = lengths[k] - lengths[k - 1] || 1;
	return target.copy(path[k - 1]).lerp(path[k], (d - lengths[k - 1]) / span);
}

/**
 * `chairModels` are hung as the chairs in place of the plain bench, by how many the lift's
 * chairs seat and in their own materials: in metres, the cable through the origin, facing +z.
 * The `Hood` node of one is left off the lifts without a bubble. `cabinModels` are hung as
 * the cabins of the gondolas and of the cable cars in the same way. `stationModel` stands at
 * each end of the chairlifts in place of the shed: origin on the ground where the line ends,
 * facing +z along it, its `Mast` stretched and its `Head` raised to the cable and its
 * `Bullwheel` turning. The lifts dispose of them all with themselves.
 */
export function buildLifts(
	lifts: Lift[],
	terrain: Terrain,
	chairModels: Record<number, THREE.Object3D> = {},
	cabinModels: Partial<Record<'gondola' | 'cableCar', THREE.Object3D>> = {},
	stationModel?: THREE.Object3D
): Lifts {
	const group = new THREE.Group();
	const structure = new THREE.MeshStandardMaterial({
		color: '#6b7280',
		roughness: 0.7,
		side: THREE.DoubleSide
	});
	const post = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
	const box = new THREE.BoxGeometry(1, 1, 1);
	const posts: THREE.Matrix4[] = [];
	const boxes: THREE.Matrix4[] = [];
	const cable: number[] = [];
	const up = new THREE.Vector3(0, 1, 0);

	const rod = (a: THREE.Vector3, b: THREE.Vector3, width: number) => {
		const span = b.clone().sub(a);
		const length = span.length();
		posts.push(
			new THREE.Matrix4().compose(
				a.clone().add(b).multiplyScalar(0.5),
				new THREE.Quaternion().setFromUnitVectors(up, span.divideScalar(length || 1)),
				new THREE.Vector3(width, length, width)
			)
		);
	};

	const slab = (w: number, h: number, d: number, y: number, z = 0) =>
		new THREE.BoxGeometry(w, h, d).translate(0, y, z);
	const chairShape = mergeGeometries([
		slab(0.1, 2.2, 0.1, -1.1),
		slab(2.4, 0.5, 0.1, -2.3, -0.25),
		slab(2.4, 0.1, 0.6, -2.55),
		slab(2.4, 0.06, 0.06, -1.5, 0.5)
	]);
	const cabinShape = mergeGeometries([slab(0.12, 1, 0.12, -0.5), slab(2.2, 2.3, 2.6, -2.15)]);
	// The ball on a rope tow to hold on to.
	const ballShape = new THREE.SphereGeometry(0.15, 12, 8);
	const carrierMaterial = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.2 });

	// A chair model as one shape for each of its materials, with or without its hood.
	const modelShapes = (model: THREE.Object3D, hood: boolean) => {
		const copy = model.clone();
		const part = copy.getObjectByName('Hood');
		if (part) part.visible = hood;
		copy.updateMatrixWorld(true);
		const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
		copy.traverseVisible((o) => {
			const mesh = o as THREE.Mesh;
			if (!mesh.isMesh) return;
			const material = [mesh.material].flat()[0];
			const pieces = byMaterial.get(material) ?? [];
			pieces.push(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
			byMaterial.set(material, pieces);
		});
		return [...byMaterial].map(([material, pieces]) => {
			const geometry = mergeGeometries(pieces);
			for (const piece of pieces) piece.dispose();
			return { geometry, material };
		});
	};
	const chairShapes = new Map<string, ReturnType<typeof modelShapes>>();

	type Fleet = {
		/** One mesh for a built-in carrier, or one for each material of the chair model. */
		meshes: THREE.InstancedMesh[];
		count: number;
		line: LiftLine;
		gap: number;
		pace: number;
		/** Two carriers half a loop apart that keep to their own side, instead of going round. */
		shuttle: boolean;
		travelled: number;
		side: THREE.Vector3;
		turns: [THREE.Quaternion, THREE.Quaternion];
	};
	const fleets: Fleet[] = [];
	// The bullwheels of the station models, with how fast each turns in radians a second.
	const wheels: { wheel: THREE.Object3D; turn: number }[] = [];
	const lines: LiftLine[] = [];

	for (const lift of lifts) {
		if (lift.path.length < 2) continue;
		// Bottom to top by elevation, whatever order the data has.
		let pts = lift.path.map(([x, z]) => new THREE.Vector3(x, terrain.height(x, z), z));
		if (pts[0].y > pts[pts.length - 1].y) pts = pts.reverse();
		// Towers at even ground spacing along the line.
		const lengths2d = [0];
		for (let i = 1; i < pts.length; i++)
			lengths2d.push(
				lengths2d[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z)
			);
		const groundTotal = lengths2d[lengths2d.length - 1];
		const towers = Math.max(1, Math.round(groundTotal / TOWER_EVERY[lift.kind]));
		const feet: THREE.Vector3[] = [];
		for (let i = 0; i <= towers; i++) {
			const p = alongPath(pts, lengths2d, (groundTotal * i) / towers, new THREE.Vector3());
			p.y = terrain.height(p.x, p.z);
			feet.push(p);
		}
		const cableHeight = CABLE_HEIGHT[lift.kind];
		const tops = feet.map((p) => p.clone().setY(p.y + cableHeight));
		// Where the ground bulges up under a span of a chairlift, the towers at its ends stand
		// taller, so the chairs and the feet of those on them stay clear of the snow.
		if (lift.kind === 'chair') {
			const probe = new THREE.Vector3();
			for (let pass = 0; pass < 3; pass++)
				for (let i = 1; i < tops.length; i++) {
					let short = 0;
					for (let k = 1; k < 8; k++) {
						probe.lerpVectors(tops[i - 1], tops[i], k / 8);
						short = Math.max(short, CHAIR_CLEARANCE - (probe.y - terrain.height(probe.x, probe.z)));
					}
					tops[i - 1].y += short;
					tops[i].y += short;
				}
		}
		const bearing = Math.atan2(
			tops[tops.length - 1].x - tops[0].x,
			tops[tops.length - 1].z - tops[0].z
		);
		const heading = new THREE.Quaternion().setFromAxisAngle(up, bearing);
		const side = new THREE.Vector3(-Math.cos(bearing), 0, Math.sin(bearing));

		feet.forEach((foot, i) => {
			const end = i === 0 || i === feet.length - 1;
			const tow = lift.kind === 'ropeTow';
			// A rope tow has no stations, and slim posts to carry its rope.
			if (end && stationModel && lift.kind === 'chair') {
				// A copy shares the model's geometry and materials. It faces along the line.
				const station = stationModel.clone();
				station.getObjectByName('Mast')?.scale.setY(tops[i].y - foot.y);
				station.getObjectByName('Head')?.position.setY(tops[i].y - foot.y);
				station.position.copy(foot);
				station.quaternion.copy(heading);
				if (i) station.rotateY(Math.PI);
				station.traverse((o) => (o.castShadow = true));
				group.add(station);
				const wheel = station.getObjectByName('Bullwheel');
				// The rim keeps pace with the cable, half the gauge out from the hub.
				if (wheel) wheels.push({ wheel, turn: LIFT_SPEED.chair / (GAUGE / 2) });
			} else if (end && !tow) {
				// A shed over the end of the line: a roof on legs, open at the sides.
				const roof = new THREE.Vector3(GAUGE + 5, 0.6, 12);
				boxes.push(
					new THREE.Matrix4().compose(foot.clone().setY(foot.y + cableHeight + 1.6), heading, roof)
				);
				for (const sx of [-1, 1])
					for (const sz of [-1, 1]) {
						const leg = foot
							.clone()
							.addScaledVector(side, (sx * roof.x) / 2)
							.addScaledVector(
								new THREE.Vector3(Math.sin(bearing), 0, Math.cos(bearing)),
								(sz * roof.z) / 2
							);
						leg.y = terrain.height(leg.x, leg.z) - 1;
						rod(leg, leg.clone().setY(foot.y + cableHeight + 1.6), 0.6);
					}
			} else {
				rod(foot.clone().setY(foot.y - 1), tops[i], tow ? 0.12 : 0.9);
				const arm = tow
					? new THREE.Vector3(GAUGE + 0.3, 0.1, 0.1)
					: new THREE.Vector3(GAUGE + 1.4, 0.5, 0.6);
				boxes.push(new THREE.Matrix4().compose(tops[i], heading, arm));
			}
			if (!i) return;
			for (const sign of [1, -1]) {
				const a = tops[i - 1].clone().addScaledVector(side, sign * (GAUGE / 2));
				const b = tops[i].clone().addScaledVector(side, sign * (GAUGE / 2));
				cable.push(a.x, a.y, a.z, b.x, b.y, b.z);
			}
		});

		const lengths = [0];
		for (let i = 1; i < tops.length; i++)
			lengths.push(lengths[i - 1] + tops[i].distanceTo(tops[i - 1]));
		const total = lengths[lengths.length - 1];
		// Assigned below; the line's methods only run once it exists.
		let fleet!: Fleet;
		const model =
			lift.kind === 'chair'
				? chairModels[lift.seats]
				: lift.kind === 'ropeTow'
					? undefined
					: cabinModels[lift.kind];
		let seat = model && lift.kind !== 'ropeTow' ? MODEL_SEAT[lift.kind] : SEAT[lift.kind];
		if (model && lift.kind === 'chair' && lift.seats % 2) seat = { ...seat, across: 0 };
		const forward = new THREE.Vector3(Math.sin(bearing), 0, Math.cos(bearing));
		const line: LiftLine = {
			lift,
			path: tops,
			lengths,
			total,
			bottom: feet[0],
			top: feet[feet.length - 1],
			heading: bearing,
			at: (d, drop, target) => {
				alongPath(tops, lengths, d, target);
				target.y -= drop;
				return target;
			},
			seat: (d, target) => {
				line
					.at(d, seat.drop, target)
					// The cabin of a shuttle that is going up is on the right, then on the left.
					.addScaledVector(
						side,
						(fleet.shuttle && fleet.travelled >= total ? -1 : 1) * (GAUGE / 2 + seat.across)
					)
					.addScaledVector(forward, seat.forward);
				if (lift.kind === 'ropeTow') target.y = terrain.height(target.x, target.z);
				return target;
			},
			nextCarrier: () => {
				let best = Infinity;
				for (let i = 0; i < fleet.count; i++) {
					const d = (fleet.travelled + i * fleet.gap) % (total * 2);
					if (d < total && d < best) best = d;
				}
				return best === Infinity ? 0 : best;
			}
		};
		lines.push(line);

		const count =
			lift.kind === 'cableCar'
				? 2
				: Math.max(2, Math.round((total * 2) / CARRIER_EVERY[lift.kind]));
		let meshes: THREE.InstancedMesh[];
		if (model) {
			const key = `${lift.kind}:${lift.seats}:${lift.bubble}`;
			if (!chairShapes.has(key)) chairShapes.set(key, modelShapes(model, lift.bubble));
			meshes = chairShapes
				.get(key)!
				.map(({ geometry, material }) => new THREE.InstancedMesh(geometry, material, count));
		} else {
			const mesh = new THREE.InstancedMesh(
				lift.kind === 'chair' ? chairShape : lift.kind === 'ropeTow' ? ballShape : cabinShape,
				carrierMaterial,
				count
			);
			const colour = new THREE.Color(
				lift.kind === 'gondola' || lift.kind === 'cableCar' ? '#f08c00' : '#c92a2a'
			);
			for (let i = 0; i < count; i++) mesh.setColorAt(i, colour);
			meshes = [mesh];
		}
		for (const mesh of meshes) mesh.frustumCulled = false;
		group.add(...meshes);
		fleet = {
			meshes,
			count,
			line,
			gap: (total * 2) / count,
			pace: LIFT_SPEED[lift.kind],
			shuttle: lift.kind === 'cableCar',
			travelled: 0,
			side,
			turns: [
				heading,
				heading.clone().multiply(new THREE.Quaternion().setFromAxisAngle(up, Math.PI))
			]
		};
		fleets.push(fleet);
	}

	const postMesh = new THREE.InstancedMesh(post, structure, posts.length);
	posts.forEach((m, i) => postMesh.setMatrixAt(i, m));
	const boxMesh = new THREE.InstancedMesh(box, structure, boxes.length);
	boxes.forEach((m, i) => boxMesh.setMatrixAt(i, m));
	postMesh.castShadow = boxMesh.castShadow = true;
	postMesh.frustumCulled = boxMesh.frustumCulled = false;
	const cableGeometry = new THREE.BufferGeometry();
	cableGeometry.setAttribute('position', new THREE.Float32BufferAttribute(cable, 3));
	const cableMaterial = new THREE.LineBasicMaterial({ color: '#2b2f36' });
	const cables = new THREE.LineSegments(cableGeometry, cableMaterial);
	cables.frustumCulled = false;
	group.add(postMesh, boxMesh, cables);

	const matrix = new THREE.Matrix4();
	const position = new THREE.Vector3();
	const one = new THREE.Vector3(1, 1, 1);
	const place = (fleet: Fleet) => {
		const { meshes, line, gap, side, turns } = fleet;
		const loop = line.total * 2;
		for (let i = 0; i < fleet.count; i++) {
			const d = (fleet.travelled + i * gap) % loop;
			const goingUp = d < line.total;
			line.at(goingUp ? d : loop - d, 0, position);
			// The first of a shuttle stays on the right and the second on the left.
			const right = fleet.shuttle ? i === 0 : goingUp;
			position.addScaledVector(side, right ? GAUGE / 2 : -GAUGE / 2);
			matrix.compose(position, turns[right ? 0 : 1], one);
			for (const mesh of meshes) mesh.setMatrixAt(i, matrix);
		}
		for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
	};
	for (const fleet of fleets) place(fleet);

	return {
		group,
		lines,
		update(dt) {
			for (const fleet of fleets) {
				fleet.travelled = (fleet.travelled + fleet.pace * dt) % (fleet.line.total * 2);
				place(fleet);
			}
			for (const { wheel, turn } of wheels) wheel.rotation.y += turn * dt;
		},
		dispose() {
			for (const g of [post, box, chairShape, cabinShape, ballShape, cableGeometry]) g.dispose();
			structure.dispose();
			carrierMaterial.dispose();
			cableMaterial.dispose();
			for (const shapes of chairShapes.values()) for (const s of shapes) s.geometry.dispose();
			for (const model of [
				...Object.values(chairModels),
				...Object.values(cabinModels),
				stationModel
			])
				model?.traverse((o) => {
					const mesh = o as THREE.Mesh;
					if (!mesh.isMesh) return;
					mesh.geometry.dispose();
					for (const m of [mesh.material].flat()) m.dispose();
				});
			for (const f of fleets) for (const mesh of f.meshes) mesh.dispose();
			postMesh.dispose();
			boxMesh.dispose();
		}
	};
}
