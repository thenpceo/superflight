import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const CHUNK_SPEED = 95;
const THROW_INTERVAL = 3.1;
const TELEGRAPH_TIME = 0.9;
const CHASE_SPEED = 27;
const CATCHUP_SPEED = 50;     // when far away, he closes hard
const PREFERRED_DIST = 75;

/**
 * Lex Luthor: rigged Justice League suit with its own skeletal idle,
 * plus additive procedural motion — platform bob/bank, arm-raise on
 * telegraph, recoil on hits — wrapped in green energy VFX.
 */
export class Lex {
  constructor(scene, vfx) {
    this.scene = scene;
    this.vfx = vfx;
    this.group = new THREE.Group();      // world position
    this.body = new THREE.Group();       // yaw
    this.tilt = new THREE.Group();       // procedural bank/lunge
    this.group.add(this.body);
    this.body.add(this.tilt);
    scene.add(this.group);

    this.maxHp = 320;
    this.hp = this.maxHp;
    this.dead = false;
    this.position = this.group.position;
    this.velocity = new THREE.Vector3();
    this.state = 'chase';                // chase | telegraph | stagger | dead
    this._stateT = 0;
    this._throwT = 1.8;                  // first throw comes quickly
    this._t = Math.random() * 10;
    this._lungeK = 0;
    this.chunks = [];
    this._burnAcc = 0;
  }

  async load() {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const [lexGltf, chunkGltf] = await Promise.all([
      loader.loadAsync('/assets/lex_rigged.glb'),
      loader.loadAsync('/assets/chunk_opt.glb'),
    ]);

    // ---- the man himself (rigged Justice League suit) ----
    this.model = lexGltf.scene;
    const box = new THREE.Box3().setFromObject(this.model);
    const size = box.getSize(new THREE.Vector3());
    const scale = 2.6 / size.y;              // imposing: comic-boss sized
    this.model.scale.setScalar(scale);
    box.setFromObject(this.model);
    this.model.position.y = -box.min.y - 1.0; // feet ≈ 1m below group center
    this.bones = {};
    this.model.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) o.frustumCulled = false;
      if (o.isBone) {
        // GLTFLoader sanitizes "Bip001 R UpperArm_048" → "Bip001_R_UpperArm_048"
        for (const key of ['R_Clavicle', 'R_UpperArm', 'R_Forearm', 'R_Hand', 'Head', 'Neck']) {
          if (o.name.includes(key)) this.bones[key] = this.bones[key] ?? o;
        }
      }
    });

    // idle animation straight off the asset
    this.mixer = new THREE.AnimationMixer(this.model);
    const clips = lexGltf.animations ?? [];
    if (clips.length) {
      const idle = clips.reduce((a, b) => (b.duration > a.duration ? b : a));
      this.mixer.clipAction(idle).play();
      // the idle's root motion floats him — re-ground against the animated pose
      this.mixer.update(0.05);
      this.model.updateMatrixWorld(true);
      const animBox = new THREE.Box3().setFromObject(this.model);
      this.model.position.y -= animBox.min.y - (-1.25); // feet just above the platform
    }

    // additive throw gesture: arm sweeps overhead during the telegraph
    this._armK = 0;
    this._qArm = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -2.3));
    this._qFore = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.4));
    this._qIdent = new THREE.Quaternion();
    this.tilt.add(this.model);

    // ---- hover platform ----
    const plat = new THREE.Group();
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.85, 1.1, 0.22, 24),
      new THREE.MeshStandardMaterial({ color: 0x2a2f33, metalness: 0.9, roughness: 0.35 })
    );
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(1.0, 0.06, 10, 40),
      new THREE.MeshBasicMaterial({ color: 0x39ff5a, toneMapped: false })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.08;
    plat.add(disc, rim);
    const thrust = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.vfx.softTex, color: 0x44ff66, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.7,
    }));
    thrust.position.y = -0.55;
    thrust.scale.set(1.7, 1.1, 1);
    plat.add(thrust);
    this._thrust = thrust;
    plat.position.y = -1.3;
    this.tilt.add(plat);

    this._glowLight = new THREE.PointLight(0x44ff66, 7, 18, 1.7);
    this._glowLight.position.y = -0.9;
    this.tilt.add(this._glowLight);

    // ---- chunk template (shared geometry/material) ----
    let srcMesh = null;
    chunkGltf.scene.traverse((o) => { if (o.isMesh && !srcMesh) srcMesh = o; });
    const cb = new THREE.Box3().setFromObject(chunkGltf.scene);
    const cs = cb.getSize(new THREE.Vector3());
    this._chunkGeo = srcMesh.geometry;
    this._chunkMat = srcMesh.material.clone();
    // kryptonite-charged: reads against the sunset instead of silhouetting
    this._chunkMat.emissive = new THREE.Color(0x1c3a1c);
    this._chunkMat.emissiveIntensity = 0.85;
    this._chunkSize = cs.clone();
    this._chunkScale = 260 / Math.max(cs.x, cs.y, cs.z); // ~260m — an entire thrown skyscraper
    this._chunkRadius = 38;                             // gameplay hit radius (forgiving vs the visual)
    return this;
  }

  /* ------------------------------ damage ------------------------------ */
  damage(amount, hitPos) {
    if (this.dead) return;
    this.hp = Math.max(0, this.hp - amount);
    if (hitPos) this.vfx.flash(hitPos, 0xff5533, 2.2, 0.12);
    if (this.hp <= 0) {
      this.dead = true;
      this.state = 'dead';
      this._stateT = 0;
      this.vfx.smokeBurst(this.position, 2.2, 0x556055);
      this.vfx.shockwave(this.position, 0x66ff77, 26, 0.9);
      this.vfx.flash(this.position, 0x88ffaa, 30, 0.5);
      for (const c of this.chunks) this._despawnChunk(c, true);
    }
  }

  stagger() {
    if (this.dead) return;
    this.state = 'stagger';
    this._stateT = 0;
  }

  /* ------------------------------ chunks ------------------------------ */
  _spawnChunk(targetPos) {
    const mesh = new THREE.Mesh(this._chunkGeo, this._chunkMat);
    const s = this._chunkScale * (0.85 + Math.random() * 0.3);
    mesh.scale.setScalar(s);
    const holder = new THREE.Group();
    holder.add(mesh);
    mesh.position.y = -(this._chunkSize.y * s) / 2; // center the geometry (base at 0 in source)
    this._chunkHover = this._chunkSize.y * this._chunkScale * 0.5 + 12;
    const fx = this.vfx.makeLightning(this._chunkSize.y * s * 0.26);
    holder.add(fx);
    holder.position.copy(this.position).add(new THREE.Vector3(0, this._chunkHover, 0));
    this.scene.add(holder);

    // dumb-fire: aimed at where you ARE, not where you're going — so you can dodge
    const dir = targetPos.clone().sub(holder.position).normalize();

    const chunk = {
      holder, mesh, fx,
      vel: dir.multiplyScalar(CHUNK_SPEED),
      spin: new THREE.Vector3().randomDirection().multiplyScalar(0.5 + Math.random() * 0.7),
      life: 0, max: 14, hit: false, fading: 0,
      halfH: (this._chunkSize.y * s) / 2,
    };
    this.chunks.push(chunk);
    this.vfx.flash(holder.position, 0x66ff77, 28, 0.3);
    return chunk;
  }

  _despawnChunk(c, explode = false) {
    if (explode) this.vfx.smokeBurst(c.holder.position, 1.4, 0x9aa59a);
    this.scene.remove(c.holder);
    c.dead = true;
  }

  /* ------------------------------ per frame ------------------------------ */
  /**
   * @param player { position, velocity, onChunkHit(chunk), gameActive }
   */
  update(dt, player, city) {
    this._t += dt;
    this._stateT += dt;

    if (!this.dead) {
      const toPlayer = player.position.clone().sub(this.position);
      const dist = toPlayer.length();
      const dirP = toPlayer.clone().normalize();

      // face the player
      const targetYaw = Math.atan2(-dirP.x, -dirP.z) + Math.PI;
      let dy = targetYaw - this.body.rotation.y;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.body.rotation.y += dy * Math.min(1, 5 * dt);

      // ---- movement: pursue, keep preferred distance, never below rooftops ----
      let desired = new THREE.Vector3();
      if (this.state !== 'stagger') {
        const speed = dist > 220 ? CATCHUP_SPEED : CHASE_SPEED;
        if (dist > PREFERRED_DIST + 12) desired.copy(dirP).multiplyScalar(speed);
        else if (dist < PREFERRED_DIST - 18) desired.copy(dirP).multiplyScalar(-CHASE_SPEED * 0.7);
        else {
          // orbit strafe for menace
          desired.set(-dirP.z, 0, dirP.x).multiplyScalar(CHASE_SPEED * 0.45 * (Math.sin(this._t * 0.31) > 0 ? 1 : -1));
        }
        desired.y += (player.position.y - this.position.y) * 0.6;
      }
      // hover bob
      desired.y += Math.sin(this._t * 1.7) * 0.8;
      this.velocity.lerp(desired, 1 - Math.exp(-2.2 * dt));
      this.position.addScaledVector(this.velocity, dt);

      // stay above streets
      const gd = city.groundDistance(this.position);
      if (gd !== null && gd < 6) this.position.y += (6 - gd) * Math.min(1, 4 * dt) * 10 * dt + (6 - gd) * 0.08;

      // ---- attack cycle ----
      if (player.gameActive && this.state === 'chase') {
        this._throwT -= dt;
        if (this._throwT <= 0 && dist < 340 && this.chunks.filter(c => !c.dead).length < 3) {
          this.state = 'telegraph';
          this._stateT = 0;
          this._pending = this._spawnChunk(player.position);
          this._pending.held = true;
          this.vfx.shockwave(this.position, 0x55ff66, 8, 0.4);
        }
      } else if (this.state === 'telegraph') {
        // chunk hovers above him, crackling, then launches
        if (this._pending && !this._pending.dead) {
          this._pending.holder.position.copy(this.position).add(new THREE.Vector3(0, this._chunkHover + Math.sin(this._stateT * 9) * 1.5, 0));
        }
        this._lungeK = Math.min(1, this._stateT / TELEGRAPH_TIME);
        if (this._stateT >= TELEGRAPH_TIME) {
          if (this._pending && !this._pending.dead) {
            this._pending.held = false;
            // straight at the player's CURRENT spot — outrun it or eat it
            this._pending.vel.copy(player.position.clone().sub(this._pending.holder.position).normalize().multiplyScalar(CHUNK_SPEED));
            this.vfx.flash(this._pending.holder.position, 0x88ffaa, 30, 0.25);
          }
          this._pending = null;
          this.state = 'chase';
          this._throwT = THROW_INTERVAL * (0.8 + Math.random() * 0.5);
        }
      } else if (this.state === 'stagger') {
        this._lungeK = -Math.min(1, this._stateT / 0.3);
        if (this._stateT > 0.9) { this.state = 'chase'; this._lungeK = 0; }
      }
    } else {
      // death: tumble out of the sky with smoke
      this.velocity.y -= 22 * dt;
      this.velocity.multiplyScalar(1 - 0.4 * dt);
      this.position.addScaledVector(this.velocity, dt);
      this.tilt.rotation.x += dt * 2.1;
      this.tilt.rotation.z += dt * 1.4;
      this._burnAcc -= dt;
      if (this._burnAcc <= 0 && this._stateT < 4) {
        this._burnAcc = 0.18;
        this.vfx.smokeBurst(this.position, 0.9, 0x444844);
      }
      const gd = city.groundDistance(this.position);
      if (gd !== null && gd <= 0.5 && !this._crashed) {
        this._crashed = true;
        this.velocity.set(0, 0, 0);
        this.vfx.smokeBurst(this.position, 3, 0x777a77);
        this.vfx.shockwave(this.position, 0xffc080, 30, 1);
      }
      if (this._crashed) this.velocity.set(0, 0, 0);
    }

    // ---- skeletal idle + additive throw gesture ----
    this.mixer?.update(dt);
    const armTarget = this.state === 'telegraph' ? Math.min(1, this._stateT / (TELEGRAPH_TIME * 0.55)) : 0;
    this._armK += (armTarget - this._armK) * Math.min(1, (armTarget > this._armK ? 9 : 6) * dt);
    if (this._armK > 0.003) {
      const k = THREE.MathUtils.smoothstep(this._armK, 0, 1);
      const up = this.bones['R_UpperArm'], fore = this.bones['R_Forearm'];
      // local additive rotation on top of whatever the idle is doing
      if (up) up.quaternion.multiply(this._qIdent.clone().slerp(this._qArm, k));
      if (fore) fore.quaternion.multiply(this._qIdent.clone().slerp(this._qFore, k));
    }

    // ---- procedural body animation ----
    if (!this.dead) {
      const lunge = this._lungeK;
      const targetPitch = lunge > 0 ? -0.5 * lunge : 0.35 * -lunge; // back-arch on telegraph, recoil fwd on stagger
      this.tilt.rotation.x = THREE.MathUtils.lerp(this.tilt.rotation.x, targetPitch + Math.sin(this._t * 1.7) * 0.04, 1 - Math.exp(-6 * dt));
      const latVel = this.velocity.dot(new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.body.rotation.y));
      this.tilt.rotation.z = THREE.MathUtils.lerp(this.tilt.rotation.z, THREE.MathUtils.clamp(-latVel * 0.02, -0.3, 0.3), 1 - Math.exp(-4 * dt));
      this._thrust.material.opacity = 0.5 + Math.random() * 0.3;
      this._thrust.scale.x = 2.4 + Math.random() * 0.5;
      this._glowLight.intensity = 11 + Math.random() * 6 + (this.state === 'telegraph' ? 14 : 0);
    }

    // ---- chunks fly ----
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      if (c.dead) { this.chunks.splice(i, 1); continue; }
      c.life += dt;
      c.fx.userData.update(dt);
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      if (!c.held) {
        c.holder.position.addScaledVector(c.vel, dt);
        // hit the player?
        const dp = c.holder.position.distanceTo(player.position);
        if (!c.hit && dp < this._chunkRadius + 1.1) {
          c.hit = true;
          player.onChunkHit(c);
          this._despawnChunk(c, true);
          continue;
        }
        // past the player and receding, or expired → fade out
        const receding = c.vel.dot(player.position.clone().sub(c.holder.position)) < 0;
        if ((receding && dp > 380) || c.life > c.max) {
          this._despawnChunk(c, false);
          this.vfx.flash(c.holder.position, 0x66ff77, 18, 0.3);
          continue;
        }
        // smashes into the street in a big plume
        if (c.holder.position.y - c.halfH * 0.5 < 0) {
          this._despawnChunk(c, true);
          this.vfx.shockwave(c.holder.position.clone().setY(2), 0x88ffaa, 60, 0.8);
          continue;
        }
      }
    }
  }
}
