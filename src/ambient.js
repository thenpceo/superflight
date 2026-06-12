import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const SHIP_GROUPS = 3;
const SHIPS_PER_GROUP = 3;
const EXPLOSION_EVERY = 20;   // seconds, ±5 jitter

/**
 * Background life: three staggered formations of capital ships drifting
 * very slowly across the skyline, and distant explosions blooming around
 * the city every ~20 seconds. Pure atmosphere — no gameplay interaction.
 */
export class Ambient {
  constructor(scene, vfx, city, sfx) {
    this.scene = scene;
    this.vfx = vfx;
    this.city = city;
    this.sfx = sfx;
    this.groups = [];
    this._boomT = EXPLOSION_EVERY * (0.6 + Math.random() * 0.4);
  }

  async load() {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync('/assets/space_ship.glb');

    // normalize: find the long axis, lay it along -Z (travel direction)
    const src = gltf.scene;
    const box = new THREE.Box3().setFromObject(src);
    const size = box.getSize(new THREE.Vector3());
    const ship = new THREE.Group();
    if (size.y >= size.x && size.y >= size.z) src.rotation.x = -Math.PI / 2; // length was vertical
    else if (size.x >= size.z) src.rotation.y = -Math.PI / 2;                // length was on X
    ship.add(src);
    const scale = 220 / Math.max(size.x, size.y, size.z); // ~220m capital ships
    ship.scale.setScalar(scale);

    const H = this.city.halfX;
    for (let gIdx = 0; gIdx < SHIP_GROUPS; gIdx++) {
      const group = new THREE.Group();
      // staggered V formation
      for (let i = 0; i < SHIPS_PER_GROUP; i++) {
        const m = ship.clone(true);
        const row = i === 0 ? 0 : 1;
        const side = i === 0 ? 0 : (i === 1 ? -1 : 1);
        m.position.set(side * 190, (Math.random() - 0.5) * 30, row * 240);
        group.add(m);
      }
      const a = (gIdx / SHIP_GROUPS) * Math.PI * 2 + Math.random();
      group.position.set(
        Math.cos(a) * H * 0.7,
        380 + gIdx * 80 + Math.random() * 50,
        Math.sin(a) * this.city.halfZ * 0.7
      );
      group.rotation.y = Math.random() * Math.PI * 2;
      group.userData.speed = 7 + Math.random() * 6;     // slow cruise
      group.userData.yawRate = (Math.random() - 0.5) * 0.008;
      this.scene.add(group);
      this.groups.push(group);
    }
    return this;
  }

  update(dt, focus) {
    // ---- ships drift ----
    for (const g of this.groups) {
      g.rotation.y += g.userData.yawRate * dt;
      const fwd = new THREE.Vector3(-Math.sin(g.rotation.y), 0, -Math.cos(g.rotation.y));
      g.position.addScaledVector(fwd, g.userData.speed * dt);
      // wrap when far outside the city
      const mX = this.city.halfX + 1500, mZ = this.city.halfZ + 1500;
      if (Math.abs(g.position.x) > mX) g.position.x *= -0.96;
      if (Math.abs(g.position.z) > mZ) g.position.z *= -0.96;
    }

    // ---- scattered explosions ----
    this._boomT -= dt;
    if (this._boomT <= 0) {
      this._boomT = EXPLOSION_EVERY + (Math.random() * 10 - 5);
      const p = new THREE.Vector3(
        (Math.random() * 2 - 1) * this.city.halfX * 0.9,
        15 + Math.random() * 120,
        (Math.random() * 2 - 1) * this.city.halfZ * 0.9
      );
      const big = 1 + Math.random() * 1.6;
      this.vfx.flash(p, 0xffb050, 55 * big, 0.5);
      this.vfx.smokeBurst(p, 7 * big, 0x4a4038);
      this.vfx.shockwave(p, 0xff9040, 70 * big, 1.1);
      // distant rumble, quieter the farther it is
      if (focus && this.sfx?.ctx) {
        const d = focus.distanceTo(p);
        if (d < 1600) this.sfx.boomFar(THREE.MathUtils.clamp(1 - d / 1600, 0.05, 0.8));
      }
    }
  }
}
