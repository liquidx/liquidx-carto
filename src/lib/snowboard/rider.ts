/**
 * Snowboard physics: a point mass on the terrain. Gravity pulls it down the slope; the board's
 * edge resists sliding sideways; friction, drag and the snow off the groomed runs slow it; and
 * when the ground falls away faster than it does, it flies.
 */
import * as THREE from 'three';
import type { Forest } from './trees';
import type { Ground } from './ground';
import type { LiftLine } from './lifts';
import { LIFT_SPEED } from './lifts';
import type { Terrain } from './terrain';

export interface Input {
	/** -1 left to 1 right. */
	steer: number;
	tuck: boolean;
	brake: boolean;
	jump: boolean;
}

export type Mode = 'ride' | 'air' | 'lift' | 'crash';

const G = 9.81;
const MAX_SPEED = 42;
/** Radians a second the board spins in the air with the steering held over. */
const AIR_SPIN = 7;
/** How close the rider gets to a trunk, in metres from its bark. */
const TREE_REACH = 0.9;
/** Metres a second into a trunk that knocks the rider over; slower, they bounce off it. */
const TREE_CRASH = 5;
/** Radians to either side of a tree that the rider is turned out of when getting up from it. */
const TREE_CLEAR = 1.2;
/** Seconds after getting up from a tree in which another one only bumps. */
const TREE_GRACE = 3;

export class Rider {
	readonly position = new THREE.Vector3();
	readonly velocity = new THREE.Vector3();
	/** Direction the board points, as a bearing in radians: 0 is +x (east), π/2 is +z (south). */
	heading = 0;
	/** Riding with the other foot forward: the nose of the board points back along `heading`. */
	switch = false;
	mode: Mode = 'ride';
	/** Where the body is leaning, -1 to 1, for the figure. */
	lean = 0;
	/** How far along the lift, in metres. */
	liftDistance = 0;
	lift: LiftLine | null = null;
	/** Seconds left face down in the snow. */
	crashTimer = 0;
	/** Set each frame: on a groomed run, and the ground normal. */
	groomed = true;
	readonly normal = new THREE.Vector3(0, 1, 0);
	/** Distance travelled on snow, and the biggest air. */
	distance = 0;
	airtime = 0;
	/** Seconds since the rider was set down on the mountain or got on a lift. */
	elapsed = 0;
	private airStart = 0;
	private jumpHeld = false;
	/** Radians a second the board is turning in the air. */
	private spin = 0;
	/** The tree that knocked the rider over, as [x, z], until they are up again. */
	private felledBy: [number, number] | null = null;
	private grace = 0;

	constructor(
		private readonly terrain: Terrain,
		private readonly ground: Ground,
		private readonly forest: Forest
	) {}

	/** Put the rider on the snow at x, z, pointing along `heading`, stopped. */
	place(x: number, z: number, heading: number) {
		this.position.set(x, this.terrain.height(x, z), z);
		this.velocity.set(0, 0, 0);
		this.heading = heading;
		this.switch = false;
		this.mode = 'ride';
		this.lift = null;
		this.crashTimer = 0;
		this.felledBy = null;
	}

	board(line: LiftLine) {
		this.lift = line;
		// Onto the carrier just leaving the bottom station.
		this.liftDistance = line.nextCarrier();
		this.elapsed = 0;
		this.mode = 'lift';
		this.velocity.set(0, 0, 0);
	}

	get speed() {
		return Math.hypot(this.velocity.x, this.velocity.z);
	}

	forward(target = new THREE.Vector3()) {
		return target.set(Math.cos(this.heading), 0, Math.sin(this.heading));
	}

	update(dt: number, input: Input) {
		dt = Math.min(dt, 1 / 30);
		this.grace = Math.max(0, this.grace - dt);
		this.elapsed += dt;
		switch (this.mode) {
			case 'lift':
				return this.ride(dt);
			case 'crash':
				this.crashTimer -= dt;
				this.velocity.multiplyScalar(Math.exp(-6 * dt));
				this.position.addScaledVector(this.velocity, dt);
				this.position.y = this.terrain.height(this.position.x, this.position.z);
				if (this.crashTimer <= 0) this.getUp();
				return;
			case 'air':
				return this.fly(dt, input);
			default:
				return this.carve(dt, input);
		}
	}

	private ride(dt: number) {
		const line = this.lift!;
		const pace = LIFT_SPEED[line.lift.kind];
		this.liftDistance += pace * dt;
		line.seat(this.liftDistance, this.position);
		this.heading = Math.atan2(line.top.z - line.bottom.z, line.top.x - line.bottom.x);
		this.lean = 0;
		if (this.liftDistance >= line.total) {
			// Off at the top, carried a little way past the station.
			const dir = new THREE.Vector3(Math.cos(this.heading), 0, Math.sin(this.heading));
			const x = line.top.x + dir.x * 12;
			const z = line.top.z + dir.z * 12;
			this.place(x, z, this.heading);
			this.velocity.copy(dir).multiplyScalar(2);
		}
	}

	private carve(dt: number, input: Input) {
		const { position: p, velocity: v, terrain } = this;
		terrain.normal(p.x, p.z, this.normal);
		const n = this.normal;
		this.groomed = this.ground.groomed(p.x, p.z);

		// Steering: the board turns, faster when slow, and the body leans into it.
		const speed = this.speed;
		const turnRate = (2.6 / (1 + speed / 14)) * (input.brake ? 1.4 : 1);
		this.heading += input.steer * turnRate * dt;
		this.lean += (input.steer * Math.min(1, speed / 8) - this.lean) * Math.min(1, dt * 8);

		// Gravity along the slope.
		v.x += G * n.y * n.x * dt;
		v.y += G * (n.y * n.y - 1) * dt;
		v.z += G * n.y * n.z * dt;

		// Split the velocity into along the board and across it; the edge kills the sideways part.
		// The vertical component is scaled with the horizontal so the velocity stays in the slope.
		const before = Math.hypot(v.x, v.z);
		let fx = Math.cos(this.heading);
		let fz = Math.sin(this.heading);
		let along = v.x * fx + v.z * fz;
		let across = -v.x * fz + v.z * fx;
		// Little edge at walking pace, so a board left across the slope still slips down it.
		const grip = input.brake ? 9 : 1.2 + 4.5 * Math.min(1, speed / 3);
		across *= Math.exp(-grip * dt);
		// Sliding backwards is riding the other way round: the tail leads, and the stance is switch.
		if (along < -0.5 && Math.abs(across) < 0.5) {
			this.reverse();
			fx = -fx;
			fz = -fz;
			along = -along;
			across = -across;
		}
		// Friction and drag.
		const mu = (this.groomed ? 0.035 : 0.1) + (input.brake ? 0.42 : 0);
		const drag = input.tuck ? 0.0042 : 0.0078;
		const slow = (mu * G + drag * along * along) * dt;
		along = along > 0 ? Math.max(0, along - slow) : Math.min(0, along + slow);
		v.x = along * fx - across * fz;
		v.z = along * fz + across * fx;
		v.y *= before > 1e-6 ? Math.hypot(v.x, v.z) / before : 0;
		if (this.speed > MAX_SPEED) v.multiplyScalar(MAX_SPEED / this.speed);

		// Jumping, once per press: up, and forward where the board points, hardest when standing
		// still so that a hop or two gets out of a flat spot or off an uphill.
		if (input.jump && !this.jumpHeld) {
			this.jumpHeld = true;
			const hop = 1.5 + 5.25 * Math.max(0, 1 - speed / 12);
			v.x += fx * hop;
			v.z += fz * hop;
			v.y = 2.3 + Math.min(1.4, speed * 0.055);
			this.takeOff(input.steer * turnRate);
			p.addScaledVector(v, dt);
			return;
		}
		if (!input.jump) this.jumpHeld = false;

		// Move, and stick to the ground unless it dropped away faster than we fell.
		const x = p.x + v.x * dt;
		const z = p.z + v.z * dt;
		const h = terrain.height(x, z);
		const flown = p.y + v.y * dt;
		if (flown > h + 0.25 && v.y > -4) {
			this.takeOff(input.steer * turnRate);
			p.set(x, flown, z);
		} else {
			// Keep the velocity in the surface at the new spot.
			terrain.normal(x, z, n);
			v.addScaledVector(n, -v.dot(n));
			p.set(x, h, z);
		}
		this.distance += speed * dt;
		this.collide();
		this.fence();
	}

	private fly(dt: number, input: Input) {
		const { position: p, velocity: v, terrain } = this;
		v.y -= G * dt;
		// The spin winds up while the steering is held over and stops when it is let go.
		this.spin += (input.steer * AIR_SPIN - this.spin) * Math.min(1, dt * (input.steer ? 6 : 20));
		this.heading += this.spin * dt;
		this.lean += (0 - this.lean) * Math.min(1, dt * 4);
		p.addScaledVector(v, dt);
		const h = terrain.height(p.x, p.z);
		if (p.y <= h) {
			p.y = h;
			terrain.normal(p.x, p.z, this.normal);
			const n = this.normal;
			const impact = -v.dot(n);
			v.addScaledVector(n, impact);
			this.airtime = Math.max(this.airtime, (performance.now() - this.airStart) / 1000);
			if (impact > 13) this.crash();
			else {
				// Spun more than half way round, the tail comes down in front: ride it out switch.
				if (v.x * Math.cos(this.heading) + v.z * Math.sin(this.heading) < 0) this.reverse();
				// Landing sideways scrubs speed.
				const fx = Math.cos(this.heading);
				const fz = Math.sin(this.heading);
				const across = -v.x * fz + v.z * fx;
				v.x += across * fz * 0.6;
				v.z -= across * fx * 0.6;
				this.mode = 'ride';
			}
		}
		this.collide();
		this.fence();
	}

	/** Leave the snow, the board turning at `spin` radians a second. */
	private takeOff(spin: number) {
		this.mode = 'air';
		this.spin = spin;
		this.airStart = performance.now();
	}

	/** Swap the nose and the tail: the same way over the snow, in the other stance. */
	private reverse() {
		this.heading += Math.PI;
		this.switch = !this.switch;
	}

	private collide() {
		const hit = this.forest.nearest(this.position.x, this.position.z, TREE_REACH);
		if (!hit) return;
		const [tx, tz, r] = hit;
		let dx = this.position.x - tx;
		let dz = this.position.z - tz;
		const d = Math.hypot(dx, dz) || 1;
		dx /= d;
		dz /= d;
		// Out to just clear of the trunk, so that riding away from it is not another hit.
		this.position.x = tx + dx * (r + TREE_REACH + 0.01);
		this.position.z = tz + dz * (r + TREE_REACH + 0.01);
		// Only running into the tree counts: bounce off it, and fall over if that was fast.
		const into = -(this.velocity.x * dx + this.velocity.z * dz);
		if (into <= 0) return;
		this.velocity.x += 1.4 * into * dx;
		this.velocity.z += 1.4 * into * dz;
		this.velocity.multiplyScalar(0.4);
		if (into > TREE_CRASH && !this.grace) {
			this.crash();
			this.felledBy = [tx, tz];
		}
	}

	private crash() {
		this.mode = 'crash';
		this.crashTimer = 1.6;
		this.felledBy = null;
		this.velocity.y = 0;
		this.velocity.multiplyScalar(0.5);
	}

	/**
	 * Back on the board after a crash. After hitting a tree the rider gets up pointing clear of
	 * it, down the slope where the tree is not in the way, with a push to get going and a few
	 * seconds in which the next tree only bumps.
	 */
	private getUp() {
		this.mode = 'ride';
		const tree = this.felledBy;
		if (!tree) return;
		this.felledBy = null;
		this.grace = TREE_GRACE;
		const p = this.position;
		const toTree = Math.atan2(tree[1] - p.z, tree[0] - p.x);
		// Down the fall line, or straight away from the tree on the flat; turned aside if the
		// tree stands in that way.
		const n = this.terrain.normal(p.x, p.z, this.normal);
		let heading = Math.hypot(n.x, n.z) > 0.02 ? Math.atan2(n.z, n.x) : toTree + Math.PI;
		const off = Math.atan2(Math.sin(heading - toTree), Math.cos(heading - toTree));
		if (Math.abs(off) < TREE_CLEAR) heading = toTree + (off < 0 ? -TREE_CLEAR : TREE_CLEAR);
		this.heading = heading;
		this.switch = false;
		this.velocity.set(Math.cos(heading) * 3, 0, Math.sin(heading) * 3);
	}

	/** Keep inside the loaded terrain. */
	private fence() {
		const f = this.terrain.frame;
		const hx = f.width / 2 - 30;
		const hz = f.height / 2 - 30;
		const p = this.position;
		if (Math.abs(p.x) > hx || Math.abs(p.z) > hz) {
			p.x = Math.max(-hx, Math.min(hx, p.x));
			p.z = Math.max(-hz, Math.min(hz, p.z));
			this.velocity.multiplyScalar(0.2);
		}
	}
}
