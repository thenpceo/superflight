import * as THREE from 'three';

/**
 * Equirectangular sunset skybox. The painted panorama IS the sky and the
 * PBR environment (so the suit picks up warm reflections), and a matched
 * directional light throws dramatic golden-hour rays across the city.
 */
export class SkySystem {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;

    // azimuth (radians) the painted sun sits at — tuned so it reads ahead of spawn
    this.sunAzimuth = Math.PI * 0.5;
    this.sunElevation = THREE.MathUtils.degToRad(11);

    const tex = new THREE.TextureLoader().load('/assets/sky_equirect.png', (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      // environment reflections still come from the panorama
      const env = t.clone();
      env.mapping = THREE.EquirectangularReflectionMapping;
      scene.environment = env;
      this.dome.material.map = t;
      this.dome.material.needsUpdate = true;
    });
    this.tex = tex;
    scene.environmentIntensity = 0.55;
    scene.environmentRotation = new THREE.Euler(0, this.sunAzimuth, 0);

    // dome instead of scene.background so we can sink the painted skyline:
    // squashed vertically and pushed down, the image's buildings sit mostly
    // below the real horizon and the sky/clouds dominate
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(6500, 48, 32),
      new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: true })
    );
    this.dome.scale.y = 0.82;
    this.dome.rotation.y = this.sunAzimuth;
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    scene.add(this.dome);
    this._domeDrop = 950;

    // dramatic warm key from the painted sun
    this.sun = new THREE.DirectionalLight(0xffb066, 3.6);
    scene.add(this.sun, this.sun.target);
    // cool sky fill so shadows read blue against the warm key
    this.hemi = new THREE.HemisphereLight(0xffd2a0, 0x4a3a30, 0.9);
    scene.add(this.hemi);
    // subtle back-rim from the opposite side
    this.rim = new THREE.DirectionalLight(0xff6a9a, 0.5);
    scene.add(this.rim);

    this.sunDir = new THREE.Vector3();
    this._updateSunDir();

    scene.fog = new THREE.FogExp2(0xc77a52, 0.00020);
  }

  _updateSunDir() {
    const e = this.sunElevation, a = this.sunAzimuth;
    this.sunDir.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)).normalize();
  }

  /** dev hook: rotate the painted sun + matched light together */
  setSunAzimuth(a) {
    this.sunAzimuth = a;
    this.dome.rotation.y = a;
    this.scene.environmentRotation.y = a;
    this._updateSunDir();
  }

  update(dt, focus) {
    this.sun.position.copy(this.sunDir).multiplyScalar(1800);
    this.rim.position.copy(this.sunDir).multiplyScalar(-1500).setY(400);
    if (focus) {
      this.sun.position.add(focus);
      this.sun.target.position.copy(focus);
      this.sun.target.updateMatrixWorld();
      this.rim.position.add(focus);
      this.dome.position.set(focus.x, focus.y - this._domeDrop, focus.z);
    }
  }
}
