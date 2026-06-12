import * as THREE from 'three';

const LASER_RANGE = 360;
const LASER_DPS = 40;
const STICKY_RADIUS = 5;   // beam snaps to Lex if your aim passes this close
const PUNCH_RANGE = 9;
const PUNCH_DMG = 115;
const CHUNK_DMG = 18;

/**
 * Player combat + match state. Laser: hold RMB (or F) — heat-limited red beam
 * with generous aim assist. Punch: LMB (or E) in close — dash + heavy hit.
 */
export class Game {
  constructor({ flight, character, lex, vfx, rig, sfx, hud }) {
    this.flight = flight;
    this.character = character;
    this.lex = lex;
    this.vfx = vfx;
    this.rig = rig;
    this.sfx = sfx;
    this.hud = hud;

    this.state = 'playing'; // playing | dead | victory
    this.maxHp = 100;
    this.hp = this.maxHp;
    this.heat = 0;
    this.overheated = 0;
    this.punchCd = 0;
    this.stumbleT = 0;
    this._mouseButtons = { 0: false, 2: false };
    this._punchQueued = false;
    this._hitstop = 0;
    this._shownIntro = false;

    addEventListener('mousedown', (e) => {
      if (!document.pointerLockElement) return;
      this._mouseButtons[e.button] = true;
      if (e.button === 0) this._punchQueued = true;
    });
    addEventListener('mouseup', (e) => { this._mouseButtons[e.button] = false; });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyE') this._punchQueued = true;
      if (e.code === 'KeyR' && this.state !== 'playing') this.restart();
    });
    hud.restartBtn.addEventListener('click', () => this.restart());
  }

  get gameActive() { return this.state === 'playing'; }
  get laserHeld() {
    return (this._mouseButtons[2] || this.flight.keys['KeyF']) && this.gameActive;
  }

  /** dt scale for hit-stop drama */
  timeScale(dt) {
    if (this._hitstop > 0) { this._hitstop -= dt; return 0.12; }
    return 1;
  }

  onChunkHit(chunk) {
    if (!this.gameActive) return;
    this.hp = Math.max(0, this.hp - CHUNK_DMG);
    this.stumbleT = 1.1;
    // knockback along the chunk's motion + stop forward momentum
    this.flight.velocity.multiplyScalar(0.15);
    this.flight.velocity.addScaledVector(chunk.vel.clone().normalize(), 22);
    this.flight.velocity.y += 6;
    this.rig.kick(1.4);
    this.vfx.smokeBurst(this.flight.position, 1.5);
    this.vfx.flash(this.flight.position, 0xffaa66, 8, 0.25);
    this.sfx?.boom();
    this.hud.damageFlash();
    if (this.hp <= 0) this._defeat();
    else this.dialog?.onPlayerHit();
  }

  _defeat() {
    this.state = 'dead';
    this.vfx.smokeBurst(this.flight.position, 2);
    this.hud.showEnd(false);
    this.dialog?.onPlayerDeath();
    document.exitPointerLock?.();
  }

  _victory() {
    this.state = 'victory';
    this.hud.showEnd(true);
    document.exitPointerLock?.();
  }

  restart() {
    this.state = 'playing';
    this.hp = this.maxHp;
    this.heat = 0; this.overheated = 0; this.stumbleT = 0;
    const f = this.flight;
    f.position.copy(f.world.spawn);
    f.velocity.set(0, 0, 0);
    f.yaw = f.world.spawnYaw; f.pitch = 0;
    // reset Lex
    const lex = this.lex;
    lex.hp = lex.maxHp; lex.dead = false; lex._crashed = false;
    lex.state = 'chase'; lex._stateT = 0; lex._throwT = 2.2; lex._pending = null;
    lex.velocity.set(0, 0, 0);
    lex.tilt.rotation.set(0, 0, 0);
    lex.position.copy(f.world.spawn).add(new THREE.Vector3(0, 10, -130));
    for (const c of lex.chunks) lex._despawnChunk(c);
    lex.chunks.length = 0;
    this.hud.hideEnd();
    this.hud.banner('ROUND TWO');
    this.rig.snapTo({ position: f.position.clone(), yaw: f.yaw, speed01: 0, boost01: 0, velocity: f.velocity });
  }

  update(dt, camera) {
    const lex = this.lex;
    if (!this._shownIntro && this.gameActive) {
      this._shownIntro = true;
      this.hud.banner('LEX LUTHOR APPROACHES');
    }

    // stumble: damp player control
    if (this.stumbleT > 0) {
      this.stumbleT -= dt;
      this.flight.velocity.multiplyScalar(Math.max(0, 1 - 2.5 * dt));
    }

    this.punchCd = Math.max(0, this.punchCd - dt);

    const lexAlive = !lex.dead;
    const toLex = lex.position.clone().sub(this.flight.position);
    const dist = toLex.length();

    /* ---------------- laser: free-fire from the eyes ---------------- */
    let beamOn = false;
    if (this.overheated > 0) this.overheated -= dt;
    if (this.laserHeld && this.overheated <= 0 && this.gameActive) {
      beamOn = true;
      this.heat = Math.min(1, this.heat + dt * 0.38);
      if (this.heat >= 1) { this.overheated = 1.7; this.heat = 1; }

      const camFwd = new THREE.Vector3();
      camera.getWorldDirection(camFwd);
      // beam originates between the eyes
      const head = this.character.bones['Head'];
      const from = head
        ? new THREE.Vector3().setFromMatrixPosition(head.matrixWorld)
        : this.flight.position.clone();
      from.addScaledVector(camFwd, 0.22).y += 0.06;

      // sticky aim: does the crosshair ray pass within STICKY_RADIUS of Lex?
      let hittingLex = false;
      if (lexAlive) {
        const toLexCam = lex.position.clone().sub(camera.position);
        const along = toLexCam.dot(camFwd);
        if (along > 0 && along < LASER_RANGE + 40) {
          const miss = toLexCam.addScaledVector(camFwd, -along).length();
          hittingLex = miss < STICKY_RADIUS;
        }
      }

      let to;
      if (hittingLex) {
        to = lex.position.clone().add(new THREE.Vector3(0, 0.4, 0));
        const hpBefore = lex.hp;
        lex.damage(LASER_DPS * dt, null);
        if (hpBefore > lex.maxHp * 0.25 && lex.hp <= lex.maxHp * 0.25) this.dialog?.onLexLowHp();
        if (Math.random() < 0.3) this.vfx.flash(to.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(0.8)), 0xff4422, 1.6, 0.1);
        this.hud.hitmark();
        if (lex.dead) this._victory();
      } else {
        // free fire: the beam lands on whatever the crosshair touches
        const hit = this.flight.world.raycast(camera.position, camFwd, LASER_RANGE);
        to = hit ? hit.point : camera.position.clone().addScaledVector(camFwd, LASER_RANGE);
        if (hit && Math.random() < 0.35) this.vfx.flash(to, 0xff6633, 3, 0.12);
      }
      this.vfx.setBeam(from, to, true);
    }
    if (!beamOn) {
      this.vfx.setBeam(null, null, false);
      this.heat = Math.max(0, this.heat - dt * 0.45);
    }
    this.sfx?.laser(beamOn);

    /* ---------------- punch ---------------- */
    if (this._punchQueued) {
      this._punchQueued = false;
      if (this.gameActive && lexAlive && this.punchCd <= 0 && dist < PUNCH_RANGE) {
        this.punchCd = 1.15;
        // dash into him
        this.flight.velocity.addScaledVector(toLex.normalize(), 18);
        this._hitstop = 0.09;
        lex.damage(PUNCH_DMG, lex.position.clone());
        lex.stagger();
        lex.velocity.addScaledVector(toLex, 3.2);
        this.vfx.shockwave(lex.position, 0xffd9a0, 14, 0.5);
        this.vfx.flash(lex.position, 0xfff0c0, 12, 0.2);
        this.rig.kick(1.2);
        this.sfx?.punch();
        if (lex.dead) this._victory();
      } else if (this.gameActive && lexAlive && this.punchCd <= 0) {
        // whiffed: small lunge forward anyway, feels responsive
        this.punchCd = 0.4;
        const fwd = new THREE.Vector3();
        camera.getWorldDirection(fwd);
        this.flight.velocity.addScaledVector(fwd, 8);
      }
    }

    /* ---------------- HUD ---------------- */
    this.hud.setHealth(this.hp / this.maxHp, lex.hp / lex.maxHp);
    this.hud.setHeat(this.heat, this.overheated > 0);
    this.hud.setPunchReady(this.punchCd <= 0 && dist < PUNCH_RANGE);
    this.hud.setLexDistance(dist);
  }
}
