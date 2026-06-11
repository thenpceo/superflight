import * as THREE from 'three';
import { CONFIG } from './config.js';

/**
 * Superman flight model: mouse steers a heading (yaw/pitch),
 * W flies forward along it, Shift boosts, S brakes,
 * Space/C nudge altitude. Heavy, momentum-y feel.
 */
export class FlightController {
  constructor(world, dom) {
    this.world = world;
    this.dom = dom;

    this.position = world.spawn.clone();
    this.velocity = new THREE.Vector3();
    this.yaw = world.spawnYaw;
    this.pitch = 0;
    this.speed = 0;
    this.boost = 0;          // smoothed 0..1
    this.bankRoll = 0;
    this._yawRate = 0;
    this._bob = Math.random() * 10;
    this._boundsF = new THREE.Vector3();
    this._justBoosted = 0;

    this.keys = {};
    addEventListener('keydown', (e) => { this.keys[e.code] = true; });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });

    this._mdx = 0; this._mdy = 0;
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement) {
        this._mdx += e.movementX;
        this._mdy += e.movementY;
      }
    });
  }

  get flying() { return !!this.keys['KeyW']; }
  get boosting() { return this.flying && !!(this.keys['ShiftLeft'] || this.keys['ShiftRight']); }

  update(dt) {
    // ---- steering ----
    const steer = Math.min(1, 0.55 + this.speed / CONFIG.boostSpeed);
    const dYaw = -this._mdx * CONFIG.yawSensitivity * steer;
    this.yaw += dYaw;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch - this._mdy * CONFIG.pitchSensitivity,
      -CONFIG.pitchLimit, CONFIG.pitchLimit
    );
    this._yawRate = THREE.MathUtils.lerp(this._yawRate, dYaw / Math.max(dt, 1e-4), 1 - Math.exp(-8 * dt));
    this._mdx = 0; this._mdy = 0;

    // ---- speed ----
    const wasBoosting = this.boost > 0.5;
    let targetSpeed = 0;
    if (this.flying) targetSpeed = this.boosting ? CONFIG.boostSpeed : CONFIG.cruiseSpeed;
    const rate = this.keys['KeyS'] || targetSpeed < this.speed ? CONFIG.brakeAccel : CONFIG.accel;
    this.speed += (targetSpeed - this.speed) * Math.min(1, rate * dt);
    if (this.keys['KeyS']) this.speed *= Math.max(0, 1 - 2.5 * dt);

    this.boost += ((this.boosting ? 1 : 0) - this.boost) * Math.min(1, 3 * dt);
    this._justBoosted = !wasBoosting && this.boost > 0.5 ? 1 : Math.max(0, this._justBoosted - dt * 1.5);

    // ---- velocity ----
    const forward = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    );
    const desired = forward.multiplyScalar(this.speed);

    // hover: gentle superman bob + manual altitude
    this._bob += dt;
    if (this.speed < 1.5) desired.y += Math.sin(this._bob * 1.4) * CONFIG.hoverDrift;
    if (this.keys['Space']) desired.y += CONFIG.verticalSpeed;
    if (this.keys['KeyC'] || this.keys['ControlLeft']) desired.y -= CONFIG.verticalSpeed;

    // soft world bounds
    desired.add(this.world.boundsForce(this.position, this._boundsF));

    this.velocity.lerp(desired, 1 - Math.exp(-3.2 * dt));

    // ---- wall collision: slide along cliffs instead of passing through ----
    const vlen = this.velocity.length();
    if (vlen > 0.5) {
      const dir = this.velocity.clone().normalize();
      const lookahead = 2.5 + vlen * 0.45;
      const hit = this.world.raycast(this.position, dir, lookahead);
      if (hit) {
        const into = hit.normal.dot(this.velocity);
        if (into < 0) {
          // remove the into-wall component, eased by proximity
          const ease = 1 - THREE.MathUtils.clamp((hit.distance - 1.2) / (lookahead - 1.2), 0, 1);
          this.velocity.addScaledVector(hit.normal, -into * ease);
        }
        if (hit.distance < 1.2) {
          // hard push-out when nearly touching
          this.position.addScaledVector(hit.normal, (1.2 - hit.distance) * 0.5);
          this.speed *= Math.max(0, 1 - 3 * dt);
        }
      }
    }

    this.position.addScaledVector(this.velocity, dt);

    // ---- ground clamp ----
    const gd = this.world.groundDistance(this.position);
    if (gd !== null && gd < CONFIG.groundClearance) {
      this.position.y += (CONFIG.groundClearance - gd);
      if (this.velocity.y < 0) this.velocity.y = 0;
    }

    // ---- bank ----
    const speed01 = this.speed / CONFIG.boostSpeed;
    const targetBank = THREE.MathUtils.clamp(
      this._yawRate * CONFIG.bankStrength * Math.min(1, speed01 * 2.2),
      -CONFIG.bankLimit, CONFIG.bankLimit
    );
    this.bankRoll = THREE.MathUtils.lerp(this.bankRoll, targetBank, 1 - Math.exp(-4 * dt));

    const vh = Math.hypot(this.velocity.x, this.velocity.z);
    return {
      position: this.position,
      velocity: this.velocity,
      yaw: this.yaw,
      speed01: THREE.MathUtils.clamp(this.velocity.length() / CONFIG.boostSpeed, 0, 1),
      boost01: this.boost,
      justBoosted: this._justBoosted,
      bankRoll: this.bankRoll,
      velPitch: Math.atan2(this.velocity.y, Math.max(vh, 0.001)),
      kmh: this.velocity.length() * 3.6,
    };
  }
}
