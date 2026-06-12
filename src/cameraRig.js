import * as THREE from 'three';
import { CONFIG } from './config.js';

/**
 * Cinematic chase camera: spring-damped follow, speed-based FOV zoom,
 * banked roll, layered procedural shake, and a kick on boost engage.
 */
export class CameraRig {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.roll = 0;
    this._t = 0;
    this._shakeImpulse = 0;
    this._initialized = false;
    this._tmpOff = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
  }

  snapTo(state) {
    this._computeIdeal(state, this.pos, this.look);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    this._initialized = true;
  }

  _computeIdeal(state, outPos, outLook) {
    const s = state.speed01;
    const b = state.boost01;
    const hov = CONFIG.camHoverOffset, fly = CONFIG.camFlightOffset, bst = CONFIG.camBoostOffset;
    const sideX = THREE.MathUtils.lerp(THREE.MathUtils.lerp(hov[0], fly[0], s), bst[0], b);
    const height = THREE.MathUtils.lerp(THREE.MathUtils.lerp(hov[1], fly[1], s), bst[1], b);
    const dist = THREE.MathUtils.lerp(THREE.MathUtils.lerp(hov[2], fly[2], s), bst[2], b);

    // full look direction (yaw + damped pitch) → free look up/down/left/right
    const pitch = (state.pitch ?? 0) * 0.82;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const lookDir = this._fwd.set(-Math.sin(state.yaw) * cp, sp, -Math.cos(state.yaw) * cp);
    const right = this._tmpOff.set(Math.cos(state.yaw), 0, -Math.sin(state.yaw));

    outPos.copy(state.position).addScaledVector(lookDir, -dist).addScaledVector(right, sideX);
    outPos.y += height;

    outLook.copy(state.position)
      .addScaledVector(lookDir, CONFIG.camLookAhead * (0.4 + 0.6 * s))
      .addScaledVector(state.velocity, 0.06);
    outLook.y += 0.4;
  }

  kick(amount = 1) { this._shakeImpulse = Math.min(1.5, this._shakeImpulse + amount); }

  update(dt, state) {
    if (!this._initialized) this.snapTo(state);
    this._t += dt;

    const idealPos = new THREE.Vector3(), idealLook = new THREE.Vector3();
    this._computeIdeal(state, idealPos, idealLook);

    // springy follow — extra lag when boosting for a sense of pull
    const stiff = CONFIG.camStiffness * (1 - state.boost01 * 0.35);
    const k = 1 - Math.exp(-stiff * dt);
    this.pos.lerp(idealPos, k);
    this.look.lerp(idealLook, 1 - Math.exp(-7 * dt));

    // occlusion: if a cliff sits between the flyer and the camera, pull in
    if (this.world) {
      const toCam = this.pos.clone().sub(state.position);
      const dist = toCam.length();
      const hit = this.world.raycast(state.position, toCam.normalize(), dist + 0.3);
      if (hit && hit.distance < dist) {
        this.pos.copy(state.position).addScaledVector(toCam, Math.max(0.8, hit.distance - 0.35));
      }
    }
    // keep the camera from dipping into the street
    const cg = this.world?.groundDistance(this.pos);
    if (cg !== null && cg !== undefined && cg < 1.4) this.pos.y += (1.4 - cg);

    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);

    // banked roll
    this.roll = THREE.MathUtils.lerp(this.roll, state.bankRoll * 0.42, 1 - Math.exp(-4 * dt));
    this.camera.rotateZ(-this.roll);

    // ---- shake: layered sines ≈ smooth noise, scaled by speed² + impulses ----
    if (state.justBoosted > 0.9) this.kick(1);
    this._shakeImpulse = Math.max(0, this._shakeImpulse - dt * 2.2);
    const amp =
      CONFIG.shakeBase +
      CONFIG.shakeSpeedGain * state.speed01 * state.speed01 +
      CONFIG.shakeBoostBurst * this._shakeImpulse * this._shakeImpulse;
    const t = this._t;
    const nx = Math.sin(t * 31.7) * 0.6 + Math.sin(t * 13.1 + 1.3) * 0.4;
    const ny = Math.cos(t * 27.3 + 0.7) * 0.6 + Math.sin(t * 17.9 + 2.1) * 0.4;
    const nz = Math.sin(t * 23.9 + 4.2) * 0.5;
    this.camera.rotateX(nx * amp);
    this.camera.rotateY(ny * amp);
    this.camera.rotateZ(nz * amp * 0.6);

    // ---- FOV zoom ----
    const targetFov =
      CONFIG.fovBase +
      CONFIG.fovSpeedGain * state.speed01 +
      CONFIG.fovBoostKick * state.boost01 +
      10 * this._shakeImpulse;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 1 - Math.exp(-3.5 * dt));
    this.camera.updateProjectionMatrix();
  }
}
