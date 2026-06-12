import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

/** Rebuild a (possibly quantized/interleaved) geometry with plain Float32 attributes so merging works. */
function toFloatGeometry(src, matrix) {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = src.getAttribute(name);
    if (!a) continue;
    const itemSize = a.itemSize;
    const arr = new Float32Array(a.count * itemSize);
    for (let i = 0; i < a.count; i++) {
      arr[i * itemSize] = a.getX(i);
      if (itemSize > 1) arr[i * itemSize + 1] = a.getY(i);
      if (itemSize > 2) arr[i * itemSize + 2] = a.getZ(i);
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, itemSize));
  }
  if (src.index) out.setIndex(src.index.clone());
  if (matrix) out.applyMatrix4(matrix);
  return out;
}

const GRID_X = 4;          // tiles across
const GRID_Z = 9;          // tiles deep — a long Manhattan-style stretch
const TILE_TARGET = 580;   // meters — 2x scale, properly tall skyscrapers

/**
 * The instanced city: one merged geometry per material rendered as
 * InstancedMesh (6 draw calls for the whole skyline), plus shared-BVH
 * collider meshes per tile for cheap exact raycasts.
 *
 * Exposes the same surface flight.js expects from a world:
 * groundDistance / raycast / boundsForce / spawn / spawnYaw.
 */
export class City {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.spawn = new THREE.Vector3(0, 55, 0);
    this.spawnYaw = 0;
    this.colliders = [];
    this._ray = new THREE.Raycaster();
    this._ray.firstHitOnly = true;
    this._down = new THREE.Vector3(0, -1, 0);
    this.halfX = 0; this.halfZ = 0; this.ceiling = 430;
  }

  async load() {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync('/assets/city_opt.glb');
    const root = gltf.scene;
    root.updateMatrixWorld(true);

    // ---- measure and normalize: find up axis (smallest extent), scale to target ----
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const wrap = new THREE.Group();
    wrap.add(root);
    if (size.z < size.y && size.z < size.x) wrap.rotation.x = -Math.PI / 2; // z-up source
    wrap.updateMatrixWorld(true);
    let b = new THREE.Box3().setFromObject(wrap);
    let s = b.getSize(new THREE.Vector3());
    const scale = TILE_TARGET / Math.max(s.x, s.z);
    wrap.scale.setScalar(scale);
    wrap.updateMatrixWorld(true);
    b = new THREE.Box3().setFromObject(wrap);
    s = b.getSize(new THREE.Vector3());
    this.tileW = s.x; this.tileD = s.z; this.tileH = s.y;

    // ---- collect geometries per material, baking world transforms ----
    const byMat = new Map();
    wrap.traverse((o) => {
      if (!o.isMesh) return;
      const g = toFloatGeometry(o.geometry, o.matrixWorld);
      const key = o.material.uuid;
      if (!byMat.has(key)) byMat.set(key, { material: o.material, geos: [] });
      byMat.get(key).geos.push(g);
    });

    const yOff = -b.min.y;
    const merged = [];
    const collisionGeos = [];
    for (const { material, geos } of byMat.values()) {
      const g = BufferGeometryUtils.mergeGeometries(geos, false);
      g.translate(0, yOff, 0);
      material.side = THREE.FrontSide;
      merged.push({ geometry: g, material });
      collisionGeos.push(g.clone());
      geos.forEach((x) => x.dispose());
    }

    // ---- instanced grid ----
    this.halfX = (GRID_X * this.tileW) / 2;
    this.halfZ = (GRID_Z * this.tileD) / 2;
    const count = GRID_X * GRID_Z;
    const m4 = new THREE.Matrix4();
    const tileOrigins = [];
    for (let gx = 0; gx < GRID_X; gx++) {
      for (let gz = 0; gz < GRID_Z; gz++) {
        const x = -this.halfX + (gx + 0.5) * this.tileW;
        const z = -this.halfZ + (gz + 0.5) * this.tileD;
        // alternate tile rotation 180° so the repetition is less obvious
        const rotY = (gx + gz) % 2 ? Math.PI : 0;
        tileOrigins.push({ x, z, rotY });
      }
    }
    for (const { geometry, material } of merged) {
      const im = new THREE.InstancedMesh(geometry, material, count);
      im.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      tileOrigins.forEach((t, i) => {
        m4.makeRotationY(t.rotY).setPosition(t.x, 0, t.z);
        im.setMatrixAt(i, m4);
      });
      im.frustumCulled = false; // single bound covers all instances anyway
      this.group.add(im);
    }

    // ---- shared-BVH colliders, one invisible mesh per tile ----
    const colGeo = BufferGeometryUtils.mergeGeometries(
      collisionGeos.map((g) => {
        // strip non-position attributes so merge succeeds & memory stays low
        const stripped = new THREE.BufferGeometry();
        stripped.setAttribute('position', g.getAttribute('position'));
        if (g.index) stripped.setIndex(g.index);
        return stripped;
      }),
      false
    );
    colGeo.computeBoundsTree();
    const colMat = new THREE.MeshBasicMaterial({ visible: false });
    for (const t of tileOrigins) {
      const cm = new THREE.Mesh(colGeo, colMat);
      cm.position.set(t.x, 0, t.z);
      cm.rotation.y = t.rotY;
      cm.updateMatrixWorld(true);
      cm.matrixAutoUpdate = false;
      this.colliders.push(cm);
      this.group.add(cm);
    }

    // ---- ground plane (streets between tiles, and a safety net) ----
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(this.halfX * 2 + 1200, this.halfZ * 2 + 1200),
      new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.95, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    this.group.add(ground);
    this.ground = ground;

    this.spawn.set(0, Math.min(150, this.tileH + 40), this.halfZ * 0.55);
    this.spawnYaw = 0; // facing -z, down the long axis of the city
    return this;
  }

  /** colliders near a world position (own tile + 8 neighbours is overkill; 4 nearest is plenty) */
  _nearColliders(pos, out = []) {
    out.length = 0;
    for (const c of this.colliders) {
      const dx = Math.abs(c.position.x - pos.x), dz = Math.abs(c.position.z - pos.z);
      if (dx < this.tileW && dz < this.tileD) out.push(c);
    }
    return out;
  }

  groundDistance(pos) {
    this._ray.set(new THREE.Vector3(pos.x, pos.y + 0.1, pos.z), this._down);
    this._ray.far = 400;
    const hits = this._ray.intersectObjects(this._nearColliders(pos, this._tmpA ??= []), false);
    let d = hits.length ? hits[0].distance - 0.1 : null;
    const dg = pos.y + 0.05; // ground plane
    if (d === null || dg < d) d = dg;
    return d;
  }

  raycast(origin, dir, far) {
    this._ray.set(origin, dir);
    this._ray.far = far;
    const hits = this._ray.intersectObjects(this._nearColliders(origin, this._tmpB ??= []), false);
    if (!hits.length) {
      // ground plane fallback for downward rays
      if (dir.y < -0.05) {
        const t = -origin.y / dir.y;
        if (t > 0 && t < far) {
          return { distance: t, point: origin.clone().addScaledVector(dir, t), normal: new THREE.Vector3(0, 1, 0) };
        }
      }
      return null;
    }
    const h = hits[0];
    let normal = h.face ? h.face.normal.clone() : new THREE.Vector3(0, 1, 0);
    normal.transformDirection(h.object.matrixWorld);
    if (normal.dot(dir) > 0) normal.negate();
    return { distance: h.distance, point: h.point, normal };
  }

  /** rectangular soft bounds with a ceiling */
  boundsForce(pos, out) {
    out.set(0, 0, 0);
    const mX = this.halfX + 60, mZ = this.halfZ + 60;
    if (pos.x > mX) out.x = -(pos.x - mX) * (0.6 + (pos.x - mX) * 0.35);
    if (pos.x < -mX) out.x = -(pos.x + mX) * (0.6 - (pos.x + mX) * 0.35);
    if (pos.z > mZ) out.z = -(pos.z - mZ) * (0.6 + (pos.z - mZ) * 0.35);
    if (pos.z < -mZ) out.z = -(pos.z + mZ) * (0.6 - (pos.z + mZ) * 0.35);
    if (pos.y > this.ceiling) out.y = -(pos.y - this.ceiling) * 0.8;
    return out;
  }
}
