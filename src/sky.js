import * as THREE from 'three';

/**
 * Stylized sunset sky: hand-rolled gradient dome (deep violet zenith →
 * magenta → burning orange horizon) with a fat glowing sun disc, banded
 * painterly clouds tinted by the sun, and a mountain ring in the haze.
 * The sun drifts very slowly to keep the light alive, but it stays in
 * golden-hour range — it's always sunset in this city.
 */
export class SkySystem {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this._t = 0;

    this.sunDir = new THREE.Vector3(0.2, 0.18, -0.96).normalize();

    // ---- gradient dome ----
    this.uniforms = {
      sunDir: { value: this.sunDir.clone() },
      zenith: { value: new THREE.Color(0x2b1a4e) },   // deep violet
      mid: { value: new THREE.Color(0xb0356b) },      // magenta
      horizon: { value: new THREE.Color(0xff7e2e) },  // burning orange
      glow: { value: new THREE.Color(0xffd86b) },     // sun halo gold
      sunCore: { value: new THREE.Color(0xfff3cf) },
    };
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_Position.z = gl_Position.w; // pin to far plane
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform vec3 sunDir, zenith, mid, horizon, glow, sunCore;
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.12, 1.0);
          // three-stop vertical gradient with painterly wide bands
          vec3 col = mix(horizon, mid, smoothstep(0.0, 0.28, h));
          col = mix(col, zenith, smoothstep(0.22, 0.75, h));
          // warm wash rising from the sun's side of the horizon
          float sunH = pow(clamp(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(sunDir.x, 0.0, sunDir.z))), 0.0, 1.0), 2.0);
          col = mix(col, horizon * 1.12, sunH * smoothstep(0.45, -0.05, h) * 0.55);
          // sun disc + layered halo
          float s = dot(d, sunDir);
          col += glow * pow(clamp(s, 0.0, 1.0), 38.0) * 0.5;
          col += glow * pow(clamp(s, 0.0, 1.0), 120.0) * 0.85;
          col = mix(col, sunCore, smoothstep(0.9994, 0.99975, s));
          // subtle horizon banding for the stylized feel
          col += horizon * 0.05 * sin(h * 38.0) * smoothstep(0.3, 0.02, h);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(8500, 48, 24), skyMat);
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    // ---- lights tuned to the dome ----
    this.sun = new THREE.DirectionalLight(0xffa14d, 3.4);
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xcc6f9a, 0x33284a, 1.25);
    scene.add(this.hemi);

    scene.fog = new THREE.FogExp2(0xd96a4f, 0.00026);

    this._buildClouds();
    this._buildMountains();
  }

  /* --------------------------- clouds --------------------------- */
  _cloudTexture() {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const ctx = c.getContext('2d');
    // long painterly puffs along the center line
    for (let i = 0; i < 26; i++) {
      const x = 40 + Math.random() * 176, y = 58 + Math.random() * 22;
      const r = 12 + Math.random() * 26;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.32)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // flat-bottom slice for that anime-sunset look
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 92, 256, 36);
    // oval mask kills rectangular ghosting
    ctx.globalCompositeOperation = 'destination-in';
    const mask = ctx.createRadialGradient(128, 64, 30, 128, 64, 124);
    mask.addColorStop(0, 'rgba(255,255,255,1)');
    mask.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = mask;
    ctx.fillRect(0, 0, 256, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _buildClouds() {
    this.clouds = [];
    const tex = this._cloudTexture();
    const group = new THREE.Group();
    const palette = [0xffc9a3, 0xffa9c2, 0xe8b4ff, 0xffd9b0, 0xff9e7e];
    for (let i = 0; i < 46; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex,
        color: palette[i % palette.length],
        transparent: true, depthWrite: false,
        opacity: 0.42 + Math.random() * 0.3, fog: false,
      });
      const s = new THREE.Sprite(mat);
      const a = Math.random() * Math.PI * 2;
      const r = 900 + Math.random() * 3800;
      s.position.set(Math.cos(a) * r, 420 + Math.random() * 560, Math.sin(a) * r);
      const w = 380 + Math.random() * 760;
      s.scale.set(w, w * (0.2 + Math.random() * 0.1), 1);
      s.userData.drift = 2 + Math.random() * 3.5;
      group.add(s);
      this.clouds.push(s);
    }
    this.cloudGroup = group;
    this.scene.add(group);
  }

  /* ------------------------- mountains -------------------------- */
  _buildMountains() {
    const SEG = 220, R = 5200;
    const pos = [];
    const idx = [];
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      const h =
        420 +
        Math.sin(a * 5 + 1.3) * 210 +
        Math.sin(a * 11 + 4.1) * 140 +
        Math.sin(a * 23 + 0.5) * 80;
      pos.push(x, -60, z, x, h, z);
    }
    for (let i = 0; i < SEG; i++) {
      const b = i * 2;
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.MeshBasicMaterial({ color: 0x5e2e55, fog: true, side: THREE.DoubleSide });
    this.mountains = new THREE.Mesh(g, m);
    this.scene.add(this.mountains);
  }

  /* -------------------------- per frame ------------------------- */
  update(dt, focus) {
    // perpetual golden hour: the sun creeps along the horizon, never rises
    this._t += dt / 240;
    const az = 2.6 + Math.sin(this._t * Math.PI * 2) * 0.35;
    const el = THREE.MathUtils.degToRad(9 + 3.5 * Math.sin(this._t * Math.PI * 4 + 1.0));
    this.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    this.uniforms.sunDir.value.copy(this.sunDir);

    this.sun.position.copy(this.sunDir).multiplyScalar(1500);
    if (focus) {
      this.sun.position.add(focus);
      this.sun.target.position.copy(focus);
      this.sun.target.updateMatrixWorld();
      this.sky.position.copy(focus);
      this.mountains.position.x = focus.x; this.mountains.position.z = focus.z;
    }

    for (const c of this.clouds) {
      c.position.x += c.userData.drift * dt;
      if (focus && c.position.x - focus.x > 4800) c.position.x -= 9600;
    }
  }
}
