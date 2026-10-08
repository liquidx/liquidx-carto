/**
 * Snowboard physics: a point mass on the terrain. Gravity pulls it down the slope; the board's
 * edge resists sliding sideways; friction, drag and the snow off the groomed runs slow it; and
 * when the ground falls away faster than it does, it flies.
 */
import * as THREE from 'three';
import type { Forest } from './trees';
import type { Ground } from './ground';
import type { LiftLine } from './lifts';
import { SEAT_DROP, LIFT_SPEED } from './lifts';
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

export class Rider {
	readonly position = new THREE.Vector3();
	readonly velocity = new THREE.Vector3();
	/** Direction the board points, as a bearing in radians: 0 is +x (east), π/2 is +z (south). */
	heading = 0;
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
	private airStart = 0;
	private jumpHeld = false;

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
		this.mode = 'ride';
		this.lift = null;
		this.crashTimer = 0;
	}

	board(line: LiftLine) {
		this.lift = line;
		this.liftDistance = 0;
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
		switch (this.mode) {
			case 'lift':
				return this.ride(dt);
			case 'crash':
				this.crashTimer -= dt;
				this.velocity.multiplyScalar(Math.exp(-6 * dt));
				this.position.addScaledVector(this.velocity, dt);
				this.position.y = this.terrain.height(this.position.x, this.position.z);
				if (this.crashTimer <= 0) this.mode = 'ride';
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
		line.at(this.liftDistance, SEAT_DROP, this.position);
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
		const fx = Math.cos(this.heading);
		const fz = Math.sin(this.heading);
		let along = v.x * fx + v.z * fz;
		let across = -v.x * fz + v.z * fx;
		// Little edge at walking pace, so a board left across the slope still slips down it.
		const grip = input.brake ? 9 : 1.2 + 4.5 * Math.min(1, speed / 3);
		across *= Math.exp(-grip * dt);
		// Riding backwards is allowed but ungainly: the board tends to swing round.
		if (along < -0.5 && Math.abs(across) < 0.5) this.heading += Math.PI;
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
			const hop = 1 + 3.5 * Math.max(0, 1 - speed / 12);
			v.x += fx * hop;
			v.z += fz * hop;
			v.y = 2.1 + Math.min(1.25, speed * 0.05);
			this.mode = 'air';
			this.airStart = performance.now();
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
			this.mode = 'air';
			this.airStart = performance.now();
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
		this.heading += input.steer * 2.2 * dt;
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

	private collide() {
		const hit = this.forest.nearest(this.position.x, this.position.z, 0.9);
		if (!hit) return;
		const [tx, tz] = hit;
		const dx = this.position.x - tx;
		const dz = this.position.z - tz;
		const d = Math.hypot(dx, dz) || 1;
		this.position.x = tx + (dx / d) * 1.2;
		this.position.z = tz + (dz / d) * 1.2;
		if (this.speed > 6) this.crash();
		const dot = this.velocity.x * dx + this.velocity.z * dz;
		if (dot < 0) {
			this.velocity.x -= (1.4 * dot * dx) / (d * d);
			this.velocity.z -= (1.4 * dot * dz) / (d * d);
		}
		this.velocity.multiplyScalar(0.4);
	}

	private crash() {
		this.mode = 'crash';
		this.crashTimer = 1.6;
		this.velocity.y = 0;
		this.velocity.multiplyScalar(0.5);
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
