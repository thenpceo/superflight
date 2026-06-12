import * as THREE from 'three';

function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Pooled gameplay VFX: smoke bursts, impact flashes, expanding shockwave
 * rings, green chunk-lightning, and the player's red laser beam.
 */
export class VFX {
  constructor(scene) {
    this.scene = scene;
    this.alive = [];
    this.softTex = radialTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)');
    this.smokeTex = radialTexture('rgba(180,180,185,0.55)', 'rgba(120,120,125,0)', 96);

    // --- laser beam (one instance, toggled) ---
    const coreGeo = new THREE.CylinderGeometry(0.07, 0.07, 1, 12, 1, true);
    coreGeo.rotateX(Math.PI / 2); // align to +z
    const glowGeo = new THREE.CylinderGeometry(0.34, 0.34, 1, 12, 1, true);
    glowGeo.rotateX(Math.PI / 2);
    this.beamCore = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    this.beamGlow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({
      color: 0xff2211, transparent: true, opacity: 0.45, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    this.beamTip = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.softTex, color: 0xff3322, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0.9,
    }));
    this.beamTip.scale.setScalar(3);
    this.beamCore.visible = this.beamGlow.visible = this.beamTip.visible = false;
    this.beamCore.frustumCulled = this.beamGlow.frustumCulled = false;
    scene.add(this.beamCore, this.beamGlow, this.beamTip);
    this._beamT = 0;
  }

  /* ---------- laser ---------- */
  setBeam(from, to, on) {
    this.beamCore.visible = this.beamGlow.visible = this.beamTip.visible = on;
    if (!on) return;
    this._beamT += 0.13;
    const mid = from.clone().add(to).multiplyScalar(0.5);
    const len = from.distanceTo(to);
    for (const m of [this.beamCore, this.beamGlow]) {
      m.position.copy(mid);
      m.lookAt(to);
      m.scale.set(1 + Math.sin(this._beamT * 6) * 0.18, 1 + Math.sin(this._beamT * 6) * 0.18, len);
    }
    this.beamTip.position.copy(to);
    this.beamTip.scale.setScalar(2.4 + Math.random() * 1.6);
  }

  /* ---------- one-shots ---------- */
  smokeBurst(pos, scale = 1, color = 0xb0b0b5) {
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.smokeTex, color, transparent: true, depthWrite: false, opacity: 0.85, fog: true,
      }));
      s.position.copy(pos).add(new THREE.Vector3(
        (Math.random() - 0.5) * 2.4 * scale, (Math.random() - 0.5) * 2 * scale, (Math.random() - 0.5) * 2.4 * scale));
      const sz = (1.6 + Math.random() * 2.2) * scale;
      s.scale.setScalar(sz);
      const vel = new THREE.Vector3((Math.random() - 0.5) * 7, Math.random() * 4 + 1.5, (Math.random() - 0.5) * 7).multiplyScalar(scale);
      this.scene.add(s);
      this.alive.push({ obj: s, life: 0, max: 1.1 + Math.random() * 0.5, update: (p, dt) => {
        p.obj.position.addScaledVector(vel, dt);
        vel.multiplyScalar(1 - 2.2 * dt);
        p.obj.scale.addScalar(3.4 * scale * dt);
        p.obj.material.opacity = 0.85 * (1 - p.life / p.max);
      }});
    }
  }

  flash(pos, color = 0xffd9a0, size = 6, time = 0.18) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.softTex, color, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 1, toneMapped: false,
    }));
    s.position.copy(pos); s.scale.setScalar(size);
    this.scene.add(s);
    this.alive.push({ obj: s, life: 0, max: time, update: (p) => {
      const k = 1 - p.life / p.max;
      p.obj.material.opacity = k;
      p.obj.scale.setScalar(size * (1 + (1 - k) * 1.6));
    }});
  }

  shockwave(pos, color = 0xffe9b8, maxR = 9, time = 0.45) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.07, 8, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
    );
    ring.position.copy(pos);
    ring.rotation.x = Math.PI / 2;
    this.scene.add(ring);
    this.alive.push({ obj: ring, life: 0, max: time, update: (p) => {
      const k = p.life / p.max;
      p.obj.scale.setScalar(1 + k * maxR);
      p.obj.material.opacity = 0.9 * (1 - k);
    }});
  }

  /* ---------- chunk lightning: jagged arcs + glow, attached to a target ---------- */
  makeLightning(radius = 5) {
    const group = new THREE.Group();
    const mat = new THREE.LineBasicMaterial({
      color: 0x66ff66, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const ARCS = 8, SEGS = 14;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARCS * SEGS * 2 * 3), 3));
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    group.add(lines);

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.softTex, color: 0x44ff55, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0.5,
    }));
    glow.scale.setScalar(radius * 3.2);
    group.add(glow);

    const light = new THREE.PointLight(0x55ff66, 30, radius * 9, 1.8);
    group.add(light);

    let acc = 0;
    group.userData.update = (dt) => {
      acc -= dt;
      glow.material.opacity = 0.38 + Math.random() * 0.25;
      light.intensity = 22 + Math.random() * 22;
      if (acc > 0) return;
      acc = 0.05 + Math.random() * 0.06;
      const a = geo.attributes.position.array;
      let k = 0;
      for (let arc = 0; arc < ARCS; arc++) {
        // tight jagged arc crawling across the surface of the chunk
        // arcs stretched vertically to wrap the tall chunk
        let p = new THREE.Vector3().randomDirection().multiplyScalar(radius * 0.8);
        for (let seg = 0; seg < SEGS; seg++) {
          a[k++] = p.x; a[k++] = p.y * 1.8; a[k++] = p.z;
          p = p.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(radius * 0.2));
          p.clampLength(radius * 0.55, radius * 0.95);
          a[k++] = p.x; a[k++] = p.y * 1.8; a[k++] = p.z;
        }
      }
      geo.attributes.position.needsUpdate = true;
    };
    return group;
  }

  update(dt) {
    for (let i = this.alive.length - 1; i >= 0; i--) {
      const p = this.alive[i];
      p.life += dt;
      if (p.life >= p.max) {
        this.scene.remove(p.obj);
        p.obj.material?.dispose?.();
        this.alive.splice(i, 1);
      } else p.update(p, dt);
    }
  }
}
