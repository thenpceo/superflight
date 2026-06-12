import * as THREE from 'three';
import { CONFIG } from './config.js';

/**
 * Dynamic flight: the mouse always aims a look/heading direction (free look,
 * full front hemisphere, even while hovering). W thrusts along it, A/D strafe
 * left/right, S brakes — and they all blend, so W+A curves forward-left, etc.
 * Mouse motion bends the whole thing for weaving dodges.
 */
export class FlightController {
  constructor(world, dom) {
    this.world = world;
    this.dom = dom;

    this.position = world.spawn.clone();
    this.velocity = new THREE.Vector3();
    this.yaw = world.spawnYaw;
    this.pitch = 0;
    this.boost = 0;          // smoothed 0..1
    this.bankRoll = 0;
    this._yawRate = 0;
    this._bob = Math.random() * 10;
    this._boundsF = new THREE.Vector3();
    this._justBoosted = 0;
    this._moveAmt = 0;       // smoothed "how much thrust input" 0..1

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

  get moving() {
    return !!(this.keys['KeyW'] || this.keys['KeyA'] || this.keys['KeyD']);
  }
  get boosting() {
    return this.moving && !!(this.keys['ShiftLeft'] || this.keys['ShiftRight']);
  }

  update(dt) {
    // ---- free look (always active) ----
    const dYaw = -this._mdx * CONFIG.yawSensitivity;
    this.yaw += dYaw;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch - this._mdy * CONFIG.pitchSensitivity,
      -CONFIG.pitchLimit, CONFIG.pitchLimit
    );
    this._yawRate = THREE.MathUtils.lerp(this._yawRate, dYaw / Math.max(dt, 1e-4), 1 - Math.exp(-8 * dt));
    this._mdx = 0; this._mdy = 0;

    // ---- basis vectors from the look direction ----
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const forward = new THREE.Vector3(-Math.sin(this.yaw) * cp, sp, -Math.cos(this.yaw) * cp);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    // ---- blended movement input ----
    const fAmt = (this.keys['KeyW'] ? 1 : 0) - (this.keys['KeyS'] ? 1 : 0);
    const sAmt = (this.keys['KeyD'] ? 1 : 0) - (this.keys['KeyA'] ? 1 : 0);
    const moveDir = new THREE.Vector3()
      .addScaledVector(forward, fAmt)
      .addScaledVector(right, sAmt);
    if (moveDir.lengthSq() > 1) moveDir.normalize();
    const inputMag = Math.min(1, Math.hypot(fAmt, sAmt));
    this._moveAmt += (inputMag - this._moveAmt) * Math.min(1, 6 * dt);

    // ---- boost ----
    const wasBoosting = this.boost > 0.5;
    this.boost += ((this.boosting ? 1 : 0) - this.boost) * Math.min(1, 3 * dt);
    this._justBoosted = !wasBoosting && this.boost > 0.5 ? 1 : Math.max(0, this._justBoosted - dt * 1.5);
    const moveSpeed = THREE.MathUtils.lerp(CONFIG.cruiseSpeed, CONFIG.boostSpeed, this.boost);

    // ---- desired velocity ----
    const desired = moveDir.multiplyScalar(moveSpeed * Math.max(inputMag, this._moveAmt * 0.0));

    // hover bob + manual altitude
    this._bob += dt;
    if (!this.moving) desired.y += Math.sin(this._bob * 1.4) * CONFIG.hoverDrift;
    if (this.keys['Space']) desired.y += CONFIG.verticalSpeed;
    if (this.keys['KeyC'] || this.keys['ControlLeft']) desired.y -= CONFIG.verticalSpeed;

    desired.add(this.world.boundsForce(this.position, this._boundsF));

    this.velocity.lerp(desired, 1 - Math.exp(-CONFIG.accelRate * dt));
    if (this.keys['KeyS']) this.velocity.multiplyScalar(Math.max(0, 1 - 3 * dt)); // firm brake

    // ---- wall collision: slide along buildings ----
    const vlen = this.velocity.length();
    if (vlen > 0.5) {
      const dir = this.velocity.clone().normalize();
      const lookahead = 3 + vlen * 0.5;
      const hit = this.world.raycast(this.position, dir, lookahead);
      if (hit) {
        const into = hit.normal.dot(this.velocity);
        if (into < 0) {
          const ease = 1 - THREE.MathUtils.clamp((hit.distance - 1.4) / (lookahead - 1.4), 0, 1);
          this.velocity.addScaledVector(hit.normal, -into * ease);
        }
        if (hit.distance < 1.4) this.position.addScaledVector(hit.normal, (1.4 - hit.distance) * 0.5);
      }
    }

    this.position.addScaledVector(this.velocity, dt);

    // ---- ground clamp ----
    const gd = this.world.groundDistance(this.position);
    if (gd !== null && gd < CONFIG.groundClearance) {
      this.position.y += (CONFIG.groundClearance - gd);
      if (this.velocity.y < 0) this.velocity.y = 0;
    }

    // ---- bank: lean into turns and into strafes ----
    const speed01 = THREE.MathUtils.clamp(this.velocity.length() / CONFIG.boostSpeed, 0, 1);
    const targetBank = THREE.MathUtils.clamp(
      this._yawRate * CONFIG.bankStrength * Math.min(1, speed01 * 2.2) + sAmt * CONFIG.strafeBank,
      -CONFIG.bankLimit, CONFIG.bankLimit
    );
    this.bankRoll = THREE.MathUtils.lerp(this.bankRoll, targetBank, 1 - Math.exp(-4 * dt));

    const vh = Math.hypot(this.velocity.x, this.velocity.z);
    return {
      position: this.position,
      velocity: this.velocity,
      yaw: this.yaw,
      pitch: this.pitch,
      speed01,
      boost01: this.boost,
      justBoosted: this._justBoosted,
      bankRoll: this.bankRoll,
      velPitch: Math.atan2(this.velocity.y, Math.max(vh, 0.001)),
      kmh: this.velocity.length() * 3.6,
    };
  }
}
