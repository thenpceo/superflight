import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG } from './config.js';

const E = (x, y, z, order = 'XYZ') => new THREE.Euler(x, y, z, order);

/**
 * Superman-style flight pose, layered procedurally on top of the
 * falling-idle animation. Values are local bone rotations (radians)
 * for the Ready Player Me / Mixamo rig.
 */
const FLIGHT_POSE = {
  // right arm punched out past the head, fist leading
  RightShoulder: E(0, 0, -0.15),
  RightArm: E(0.1, 0.12, -1.42),
  RightForeArm: E(0, 0, -0.08),
  RightHand: E(0, 0, 0.0),
  // left arm pinned along the body
  LeftShoulder: E(0, 0, 0.1),
  LeftArm: E(0.1, 0, -1.2),
  LeftForeArm: E(0, 0, -0.15),
  // legs together, straight, toes pointed
  RightUpLeg: E(0.12, 0, 3.05),
  RightLeg: E(0.12, 0, 0),
  RightFoot: E(0.55, 0, 0),
  LeftUpLeg: E(0.12, 0, 3.23),
  LeftLeg: E(0.12, 0, 0),
  LeftFoot: E(0.55, 0, 0),
  // gentle arch through the torso
  Spine: E(-0.12, 0, 0),
  Spine1: E(-0.1, 0, 0),
  Spine2: E(-0.08, 0, 0),
};

// Head pitches up so he looks where he's flying while prone.
const HEAD_LOOKUP = -0.85;

export class Character {
  constructor(scene) {
    this.scene = scene;
    this.rig = new THREE.Group();      // world position of the flyer
    this.heading = new THREE.Group();  // yaw
    this.attitude = new THREE.Group(); // pitch (prone) + roll (bank)
    this.rig.add(this.heading);
    this.heading.add(this.attitude);
    scene.add(this.rig);

    this.poseWeight = 0;
    this.bones = {};
    this._poseQuats = {};
    this._headQuat = new THREE.Quaternion();
    this._t = 0;
  }

  async load() {
    const loader = new GLTFLoader();
    const [avatarGltf, fallGltf, idleGltf] = await Promise.all([
      loader.loadAsync('/assets/character.glb'),
      loader.loadAsync('/assets/anim/falling_idle.glb'),
      loader.loadAsync('/assets/anim/standing_idle.glb'),
    ]);

    this.model = avatarGltf.scene;
    this.model.position.y = -1.05; // pivot ≈ hips, not feet
    this.model.rotation.y = Math.PI; // RPM avatars face +z; flight forward is -z
    this.model.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = false;
        o.receiveShadow = false;
        o.frustumCulled = false;
        if (o.material) {
          o.material.envMapIntensity = 0.9;
        }
      }
      if (o.isBone) this.bones[o.name] = o;
    });
    this.attitude.add(this.model);

    // pre-bake pose target quaternions
    for (const [name, euler] of Object.entries(FLIGHT_POSE)) {
      this._poseQuats[name] = new THREE.Quaternion().setFromEuler(euler);
    }
    this._headQuat.setFromEuler(E(HEAD_LOOKUP, 0, 0));

    this.mixer = new THREE.AnimationMixer(this.model);
    // upright, arms-relaxed hover (Superman floats, he doesn't skydive)
    this.hoverAction = this.mixer.clipAction(idleGltf.animations[0]);
    this.hoverAction.play();
    // spread-limb falling clip kept as a soft layer during fast climbs/dives
    this.fallAction = this.mixer.clipAction(fallGltf.animations[0]);
    this.fallAction.play();
    this.fallAction.setEffectiveWeight(0);

    this._buildCape();
    return this;
  }

  /* ------------------------- cape (verlet cloth) ------------------------- */
  _buildCape() {
    const W = 7, H = 11;           // particle grid
    const width = 0.78, length = 1.55;
    this.cape = { W, H, pts: [], prev: [], pins: [] };

    const geo = new THREE.PlaneGeometry(width, length, W - 1, H - 1);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xa51220,
      roughness: 0.75,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    this.capeMesh = new THREE.Mesh(geo, mat);
    this.capeMesh.frustumCulled = false;
    this.scene.add(this.capeMesh); // simulated in world space

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = new THREE.Vector3((x / (W - 1) - 0.5) * width, -(y / (H - 1)) * length, 0);
        this.cape.pts.push(p.clone());
        this.cape.prev.push(p.clone());
      }
    }
    this.cape.rest = width / (W - 1);
    this.cape.restY = length / (H - 1);
    // flare: horizontal rest length grows toward the hem so the cape fans out
    this.cape.restRow = [];
    for (let y = 0; y < H; y++) {
      this.cape.restRow.push(this.cape.rest * (0.78 + 0.65 * (y / (H - 1))));
    }
  }

  _updateCape(dt, velocity) {
    const { W, H, pts, prev, rest, restY } = this.cape;
    const spine = this.bones['Spine2'];
    if (!spine) return;

    // anchor row across the shoulders, slightly behind the back
    spine.updateWorldMatrix(true, false);
    const anchorC = new THREE.Vector3(0, 0.17, -0.13).applyMatrix4(spine.matrixWorld);
    const right = new THREE.Vector3(1, 0, 0).transformDirection(spine.matrixWorld);

    // pin the top row across the shoulders FIRST so constraints act on fresh anchors
    for (let x = 0; x < W; x++) {
      pts[x].copy(anchorC).addScaledVector(right, (x / (W - 1) - 0.5) * 0.46);
      prev[x].copy(pts[x]);
    }

    const sdt = Math.min(dt, 1 / 50);
    const damp = 0.965;
    const gravity = -4.5 * sdt * sdt;
    const windV = velocity.clone().multiplyScalar(-1.7 * sdt * sdt); // trail behind motion
    const speedK = Math.min(1, velocity.length() / 8);
    const flutterAmp = 0.0008 + 0.0028 * speedK;
    for (let i = W; i < pts.length; i++) {
      const row = Math.floor(i / W), col = i % W;
      const p = pts[i], pr = prev[i];
      const vx = (p.x - pr.x) * damp, vy = (p.y - pr.y) * damp, vz = (p.z - pr.z) * damp;
      pr.copy(p);
      p.x += vx + windV.x;
      p.y += vy + gravity + windV.y;
      p.z += vz + windV.z;
      // flutter: travelling ripples, phase-shifted per column so folds form
      const ph = this._t * (13 + col * 0.9) + row * 1.9 + col * 2.1;
      const fx = Math.sin(ph) * flutterAmp;
      const fy = Math.sin(ph * 0.7 + 1.1) * flutterAmp * 0.5 * speedK;
      const fz = Math.cos(this._t * 10.5 + row * 2.5 + col * 1.3) * flutterAmp;
      p.x += fx; p.y += fy; p.z += fz;
      pr.x += fx * 0.82; pr.y += fy * 0.82; pr.z += fz * 0.82;
    }
    // constraints
    const restRow = this.cape.restRow;
    for (let iter = 0; iter < 4; iter++) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          if (x < W - 1) this._satisfy(pts[i], pts[i + 1], restRow[y], y === 0);
          if (y < H - 1) this._satisfy(pts[i], pts[i + W], restY, y === 0);
        }
      }
    }
    // hard safety: no particle may stray beyond the cape's full length from its anchor
    const maxR = restY * (H - 1) * 1.25;
    // and none may wrap over the shoulders in front of the back plane
    const backDir = new THREE.Vector3(0, 0, -1).transformDirection(spine.matrixWorld); // model-local -z = behind
    for (let i = W; i < pts.length; i++) {
      const ax = pts[i % W].x, ay = pts[i % W].y, az = pts[i % W].z;
      const dx = pts[i].x - ax, dy = pts[i].y - ay, dz = pts[i].z - az;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > maxR) {
        const s = maxR / d;
        pts[i].set(ax + dx * s, ay + dy * s, az + dz * s);
        prev[i].copy(pts[i]);
      }
      // front-of-plane containment
      const fwdAmt = -(dx * backDir.x + dy * backDir.y + dz * backDir.z); // >0 means in front
      if (fwdAmt > 0.12) {
        const push = (fwdAmt - 0.12) * 0.65;
        pts[i].addScaledVector(backDir, push);
        prev[i].addScaledVector(backDir, push * 0.9);
      }
    }
    // write to geometry
    const pos = this.capeMesh.geometry.attributes.position;
    for (let i = 0; i < pts.length; i++) pos.setXYZ(i, pts[i].x, pts[i].y, pts[i].z);
    pos.needsUpdate = true;
    this.capeMesh.geometry.computeVertexNormals();
  }

  _satisfy(a, b, rest, aPinned) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    const diff = (d - rest) / d;
    const wa = aPinned ? 0 : 0.5, wb = aPinned ? 1 : 0.5;
    a.x += dx * diff * wa; a.y += dy * diff * wa; a.z += dz * diff * wa;
    b.x -= dx * diff * wb; b.y -= dy * diff * wb; b.z -= dz * diff * wb;
  }

  /* ------------------------------ per frame ------------------------------ */
  /**
   * @param state { position, yaw, velocity, speed01, boost01, bankRoll, velPitch }
   */
  update(dt, state) {
    this._t += dt;
    this.rig.position.copy(state.position);
    this.heading.rotation.y = state.yaw;

    // prone pitch: lying flat at speed, upright at hover; follow climb/dive
    const prone = CONFIG.proneAngle * THREE.MathUtils.smoothstep(state.speed01, 0.04, 0.42);
    const targetPitch = -prone + state.velPitch * state.speed01 * 0.9;
    this.attitude.rotation.order = 'ZYX';
    this.attitude.rotation.x = THREE.MathUtils.lerp(this.attitude.rotation.x, targetPitch, 1 - Math.exp(-6 * dt));
    this.attitude.rotation.z = THREE.MathUtils.lerp(this.attitude.rotation.z, state.bankRoll, 1 - Math.exp(-5 * dt));

    // animation + procedural pose blend
    const targetW = THREE.MathUtils.smoothstep(state.speed01, 0.08, 0.38);
    this.poseWeight += (targetW - this.poseWeight) * Math.min(1, CONFIG.poseBlendRate * dt);
    // limbs spread for a beat as he leans into / out of flight
    this.fallAction.setEffectiveWeight(4 * this.poseWeight * (1 - this.poseWeight) * 0.4);
    this.mixer.update(dt);

    const w = this.poseWeight;
    if (w > 0.001) {
      for (const [name, q] of Object.entries(this._poseQuats)) {
        const bone = this.bones[name];
        if (bone) bone.quaternion.slerp(q, w);
      }
      const head = this.bones['Head'];
      if (head) {
        const target = head.quaternion.clone().multiply(this._headQuat);
        head.quaternion.slerp(target, w * (0.35 + 0.65 * state.speed01));
      }
    }

    this._updateCape(dt, state.velocity);
  }
}
