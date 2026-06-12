import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CONFIG } from './config.js';

/**
 * Adapt a Mixamo FBX clip to our GLB rig: keep rotation tracks only
 * (positions are in cm and would explode the meter-scale model) and
 * rename "mixamorig:Hips" → "mixamorigHips" to match GLTF-sanitized bones.
 */
function adaptMixamoClip(clip) {
  const tracks = clip.tracks
    .filter((t) => t.name.endsWith('.quaternion'))
    .map((t) => { t.name = t.name.replace('mixamorig:', 'mixamorig'); return t; });
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

const E = (x, y, z, order = 'XYZ') => new THREE.Euler(x, y, z, order);

/**
 * Superman flight pose, layered procedurally on top of the real Mixamo
 * floating/falling clips. Bone keys are the stripped Mixamo names
 * (the rig uses a `mixamorig:` prefix that we strip when indexing).
 */
const FLIGHT_POSE = {
  RightShoulder: E(0, 0, -0.15),
  RightArm: E(0.1, 0.12, -1.42),
  RightForeArm: E(0, 0, -0.08),
  LeftShoulder: E(0, 0, 0.1),
  LeftArm: E(0.1, 0, -1.2),
  LeftForeArm: E(0, 0, -0.15),
  RightUpLeg: E(0.12, 0, 3.05),
  RightLeg: E(0.12, 0, 0),
  RightFoot: E(0.55, 0, 0),
  LeftUpLeg: E(0.12, 0, 3.23),
  LeftLeg: E(0.12, 0, 0),
  LeftFoot: E(0.55, 0, 0),
  Spine: E(-0.12, 0, 0),
  Spine1: E(-0.1, 0, 0),
  Spine2: E(-0.08, 0, 0),
};

const HEAD_LOOKUP = -0.7;

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
    loader.setMeshoptDecoder(MeshoptDecoder);
    const fbx = new FBXLoader();
    const [manGltf, idleFbx, flyFbx] = await Promise.all([
      loader.loadAsync('/assets/superman_opt.glb'),
      fbx.loadAsync('/assets/anim/breathing_idle.fbx'),
      fbx.loadAsync('/assets/anim/flying.fbx'),
    ]);

    this.model = manGltf.scene;
    this.model.rotation.y = Math.PI;   // Mixamo faces +Z; flight forward is -Z

    // center hips on the rig origin (model origin is at the feet)
    const box = new THREE.Box3().setFromObject(this.model);
    this.model.position.y = -(box.min.y + box.getSize(new THREE.Vector3()).y * 0.52);

    this.model.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = false;
        o.frustumCulled = false;
        // the asset's cape is skinned to bones the Mixamo clips never touch,
        // so it hangs frozen — hide it; we simulate our own cloth cape instead
        if (o.name.toLowerCase().includes('cape')) { o.visible = false; return; }
        const m = o.material;
        if (m) {
          // the asset ships fully metallic + white-emissive + partly transparent,
          // which ghosts out against the bright sky — calm it into a solid suit
          m.envMapIntensity = 0.25;
          if (m.name !== 'Fabric 127') {       // everything but the cape
            m.metalness = 0.1;
            m.roughness = 0.7;
            m.emissive = new THREE.Color(0x000000); // kill the white wash-out
            m.emissiveIntensity = 0;
            m.transparent = false;
            m.opacity = 1;
            m.depthWrite = true;
          }
        }
      }
      if (o.isBone) this.bones[o.name.replace(/^mixamorig:?/, '')] = o;
    });
    this.attitude.add(this.model);

    for (const [name, euler] of Object.entries(FLIGHT_POSE)) {
      this._poseQuats[name] = new THREE.Quaternion().setFromEuler(euler);
    }
    this._headQuat.setFromEuler(E(HEAD_LOOKUP, 0, 0));

    this.mixer = new THREE.AnimationMixer(this.model);
    this.hoverAction = this.mixer.clipAction(adaptMixamoClip(idleFbx.animations[0])); // breathing idle
    this.hoverAction.play();
    this.flyAction = this.mixer.clipAction(adaptMixamoClip(flyFbx.animations[0]));    // real flying clip
    this.flyAction.play();
    this.flyAction.setEffectiveWeight(0);

    // expose the eye origin for the heat-vision laser
    this.eyeBone = this.bones['Head'] || null;

    return this;
  }

  /** world position roughly between the eyes (laser origin) */
  eyeWorld(out, forward) {
    const head = this.eyeBone;
    if (head) {
      out.setFromMatrixPosition(head.matrixWorld);
      if (forward) out.addScaledVector(forward, 0.18).y += 0.08;
    } else {
      out.copy(this.rig.position);
    }
    return out;
  }

  update(dt, state) {
    this._t += dt;
    this.rig.position.copy(state.position);
    this.heading.rotation.y = state.yaw;

    // the Flying clip bakes the prone pose into the hips but aims the head
    // ~30° down — trim it back up so level flight reads level and heroic
    const targetPitch = state.velPitch * state.speed01 * 0.55 + 0.2 * this.poseWeight;
    this.attitude.rotation.order = 'ZYX';
    this.attitude.rotation.x = THREE.MathUtils.lerp(this.attitude.rotation.x, targetPitch, 1 - Math.exp(-6 * dt));
    this.attitude.rotation.z = THREE.MathUtils.lerp(this.attitude.rotation.z, state.bankRoll, 1 - Math.exp(-5 * dt));

    // crossfade breathing idle ↔ flying clip by speed
    const targetW = THREE.MathUtils.smoothstep(state.speed01, 0.06, 0.35);
    this.poseWeight += (targetW - this.poseWeight) * Math.min(1, CONFIG.poseBlendRate * dt);
    this.flyAction.setEffectiveWeight(this.poseWeight);
    this.hoverAction.setEffectiveWeight(1 - this.poseWeight);
    this.mixer.update(dt);

    // head up so he looks where he's going while prone, and legs drawn
    // together over the clip's splayed kick frames — keeps the clip's life
    // in the torso/arms but reads heroic from behind
    const w = this.poseWeight;
    if (w > 0.001) {
      const head = this.bones['Head'];
      if (head) {
        const target = head.quaternion.clone().multiply(this._headQuat);
        head.quaternion.slerp(target, w * (0.3 + 0.55 * state.speed01));
      }
      const legW = w * 0.62;
      for (const name of ['RightUpLeg', 'RightLeg', 'RightFoot', 'LeftUpLeg', 'LeftLeg', 'LeftFoot']) {
        const bone = this.bones[name];
        if (bone) bone.quaternion.slerp(this._poseQuats[name], legW);
      }
    }

  }
}
