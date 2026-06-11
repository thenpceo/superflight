import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SplatMesh } from '@sparkjsdev/spark';

/**
 * Loads the World Labs Marble splat world + its collider mesh.
 * Reads /assets/world.json for asset paths and placement.
 */
export class World {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.collider = null;
    this.boundsRadius = 35;
    this.boundsCenter = new THREE.Vector3();
    this.spawn = new THREE.Vector3(0, 2.5, 0);
    this.spawnYaw = 0;
    this._ray = new THREE.Raycaster();
    this._down = new THREE.Vector3(0, -1, 0);
    scene.add(this.group);
  }

  async load(onProgress = () => {}) {
    const manifest = await (await fetch('/assets/world.json')).json();
    this.manifest = manifest;
    this.boundsRadius = manifest.boundsRadius ?? 35;
    if (manifest.boundsCenter) this.boundsCenter.fromArray(manifest.boundsCenter);
    if (manifest.spawn) this.spawn.fromArray(manifest.spawn);
    this.spawnYaw = manifest.spawnYaw ?? 0;

    // --- gaussian splat scene ---
    this.splat = new SplatMesh({
      url: manifest.splatUrl,
      onLoad: () => onProgress({ splat: 1 }),
    });
    // Marble/Spark assets are OpenCV-convention (Y down) — flip to three.js Y-up.
    if (manifest.flipSplat !== false) this.splat.quaternion.set(1, 0, 0, 0);
    if (manifest.worldScale) this.splat.scale.setScalar(manifest.worldScale);
    this.group.add(this.splat);
    await this.splat.initialized;

    // --- collider mesh (invisible, used for ground clamping) ---
    if (manifest.colliderUrl) {
      try {
        const gltf = await new GLTFLoader().loadAsync(manifest.colliderUrl);
        this.collider = gltf.scene;
        this.collider.rotation.copy(this.splat.rotation);
        if (manifest.worldScale) this.collider.scale.setScalar(manifest.worldScale);
        this.collider.updateMatrixWorld(true);
        this.collider.traverse((o) => {
          if (o.isMesh) {
            o.material = new THREE.MeshBasicMaterial({ visible: false });
          }
        });
        this.group.add(this.collider);
      } catch (e) {
        console.warn('collider failed to load, flying without ground clamp', e);
      }
    }
    return this;
  }

  /** Distance from `pos` straight down to the collider, or null. */
  groundDistance(pos) {
    if (!this.collider) return null;
    this._ray.set(new THREE.Vector3(pos.x, pos.y + 0.1, pos.z), this._down);
    this._ray.far = 250;
    const hits = this._ray.intersectObject(this.collider, true);
    return hits.length ? hits[0].distance - 0.1 : null;
  }

  /** First collider hit from `origin` along `dir` within `far`, or null. */
  raycast(origin, dir, far) {
    if (!this.collider) return null;
    this._ray.set(origin, dir);
    this._ray.far = far;
    const hits = this._ray.intersectObject(this.collider, true);
    if (!hits.length) return null;
    const h = hits[0];
    let normal = h.face ? h.face.normal.clone() : new THREE.Vector3(0, 1, 0);
    normal.transformDirection(h.object.matrixWorld);
    if (normal.dot(dir) > 0) normal.negate();
    return { distance: h.distance, point: h.point, normal };
  }

  /** Soft push-back force that keeps the player inside the splat's nice region. */
  boundsForce(pos, out) {
    out.set(0, 0, 0);
    const d = new THREE.Vector3().subVectors(pos, this.boundsCenter);
    const r = d.length();
    if (r > this.boundsRadius) {
      const over = r - this.boundsRadius;
      out.copy(d).normalize().multiplyScalar(-over * over * 0.15);
    }
    // gentle ceiling so we don't fly into the unscanned sky forever
    const ceil = this.boundsCenter.y + (this.manifest?.ceiling ?? this.boundsRadius * 0.8);
    if (pos.y > ceil) out.y -= (pos.y - ceil) * 0.8;
    return out;
  }
}
