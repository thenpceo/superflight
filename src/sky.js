import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

/**
 * Dynamic sky: physical sky shader, a sun that swings through a slow
 * day cycle (never fully night — combat stays readable), lighting and
 * fog that track the sun, drifting billboard clouds, and a procedural
 * mountain ring on the horizon.
 */
export class SkySystem {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this._t = 0.22; // phase: start mid-morning golden light

    this.sky = new Sky();
    this.sky.scale.setScalar(9000);
    scene.add(this.sky);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 4;
    u.rayleigh.value = 1.1;
    u.mieCoefficient.value = 0.0035;
    u.mieDirectionalG.value = 0.9;

    this.sun = new THREE.DirectionalLight(0xffe2b0, 2.4);
    scene.add(this.sun);
    this.hemi = new THREE.HemisphereLight(0xcfe0ff, 0x3a3f4a, 0.85);
    scene.add(this.hemi);

    scene.fog = new THREE.FogExp2(0xb8c4d4, 0.00052);

    this._buildClouds();
    this._buildMountains();
  }

  /* --------------------------- clouds --------------------------- */
  _cloudTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    // soft cluster of blobs, clustered near the center line
    for (let i = 0; i < 16; i++) {
      const x = 34 + Math.random() * 60, y = 56 + Math.random() * 20;
      const r = 12 + Math.random() * 18;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.34)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // circular mask so no rectangular ghosting survives
    const mask = ctx.createRadialGradient(64, 64, 26, 64, 64, 62);
    mask.addColorStop(0, 'rgba(255,255,255,1)');
    mask.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = mask;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _buildClouds() {
    this.clouds = [];
    const tex = this._cloudTexture();
    const group = new THREE.Group();
    for (let i = 0; i < 38; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex, color: 0xffffff, transparent: true, depthWrite: false,
        opacity: 0.5 + Math.random() * 0.25, fog: false,
      });
      const s = new THREE.Sprite(mat);
      const a = Math.random() * Math.PI * 2;
      const r = 600 + Math.random() * 2200;
      s.position.set(Math.cos(a) * r, 320 + Math.random() * 280, Math.sin(a) * r);
      const w = 180 + Math.random() * 300;
      s.scale.set(w, w * (0.26 + Math.random() * 0.12), 1);
      s.userData.drift = 1.5 + Math.random() * 2.5;
      group.add(s);
      this.clouds.push(s);
    }
    this.cloudGroup = group;
    this.scene.add(group);
  }

  /* ------------------------- mountains -------------------------- */
  _buildMountains() {
    const SEG = 220, R = 3400;
    const geo = new THREE.PlaneGeometry(1, 1, SEG, 1); // rebuilt manually below
    const pos = [];
    const idx = [];
    // ridged ring: two vertices per segment (base y=0, ridge y=h)
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      const h =
        260 +
        Math.sin(a * 5 + 1.3) * 130 +
        Math.sin(a * 11 + 4.1) * 90 +
        Math.sin(a * 23 + 0.5) * 55;
      pos.push(x, -40, z, x, h, z);
    }
    for (let i = 0; i < SEG; i++) {
      const b = i * 2;
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.MeshBasicMaterial({ color: 0x5a6478, fog: true, side: THREE.DoubleSide });
    this.mountains = new THREE.Mesh(g, m);
    this.scene.add(this.mountains);
  }

  /* -------------------------- per frame ------------------------- */
  update(dt, focus) {
    // slow cycle: sun elevation oscillates 8°..58°, azimuth drifts — full loop ~5min
    this._t += dt / 300;
    const phase = this._t * Math.PI * 2;
    const elevation = THREE.MathUtils.degToRad(33 + 25 * Math.sin(phase));
    const azimuth = THREE.MathUtils.degToRad(160 + 70 * Math.sin(phase * 0.5 + 1.2));

    const sunDir = new THREE.Vector3(
      Math.cos(elevation) * Math.sin(azimuth),
      Math.sin(elevation),
      Math.cos(elevation) * Math.cos(azimuth)
    );
    this.sky.material.uniforms.sunPosition.value.copy(sunDir);
    this.sun.position.copy(sunDir).multiplyScalar(800);
    if (focus) {
      this.sun.position.add(focus);
      this.sun.target.position.copy(focus);
      this.sun.target.updateMatrixWorld();
      // keep the skybox + mountains + clouds centered on the player
      this.sky.position.copy(focus);
      this.mountains.position.x = focus.x; this.mountains.position.z = focus.z;
    }

    // light + fog color track sun height: warm low sun, neutral noon
    const dayness = THREE.MathUtils.smoothstep(Math.sin(elevation), 0.1, 0.75);
    this.sun.color.setHSL(0.085 + 0.04 * dayness, 0.75 - 0.45 * dayness, 0.62 + 0.08 * dayness);
    this.sun.intensity = 2.8 + 2.2 * dayness;
    this.hemi.intensity = 1.0 + 0.85 * dayness;
    const fogColor = new THREE.Color().setHSL(0.6 - 0.05 * (1 - dayness), 0.18 + 0.18 * (1 - dayness), 0.62 + 0.1 * dayness);
    this.scene.fog.color.copy(fogColor);
    this.mountains.material.color.copy(fogColor).multiplyScalar(0.82);

    // clouds drift slowly around the ring
    for (const c of this.clouds) {
      c.position.x += c.userData.drift * dt;
      if (focus && c.position.x - focus.x > 2400) c.position.x -= 4800;
    }
  }
}
