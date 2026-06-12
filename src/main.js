import * as THREE from 'three';
import { City } from './city.js';
import { SkySystem } from './sky.js';
import { Character } from './character.js';
import { FlightController } from './flight.js';
import { CameraRig } from './cameraRig.js';
import { createPost } from './post.js';
import { WindAudio, SFX, Music } from './audio.js';
import { VFX } from './vfx.js';
import { Lex } from './lex.js';
import { Game } from './game.js';
import { HUD } from './hud.js';

const params = new URLSearchParams(location.search);
const NO_POST = params.has('nopost');
const POSE_DEBUG = params.has('pose'); // freeze at full flight pose for tuning

const app = document.getElementById('app');
const loaderEl = document.getElementById('loader');
const barEl = document.getElementById('bar');
const tipEl = document.getElementById('load-tip');
const startEl = document.getElementById('start');
const hudEl = document.getElementById('hud');
const speedEl = document.getElementById('speed-val');
const boostEl = document.getElementById('boost');

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
const BASE_DPR = Math.min(devicePixelRatio, 1.5);
renderer.setPixelRatio(BASE_DPR);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.58; // the Sky shader is calibrated for ~0.5

app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.03, 9500);

const sky = new SkySystem(scene, renderer);
const vfx = new VFX(scene);
const city = new City(scene);
const character = new Character(scene);
const lex = new Lex(scene, vfx);

let progress = { city: 0, char: 0, lex: 0 };
const setBar = () => {
  const p = (progress.city * 0.5 + progress.char * 0.25 + progress.lex * 0.25) * 100;
  barEl.style.width = `${p}%`;
};

async function boot() {
  tipEl.textContent = 'raising the skyline…';
  await city.load();
  progress.city = 1; setBar();

  tipEl.textContent = 'suiting up…';
  await character.load();
  progress.char = 1; setBar();

  tipEl.textContent = 'lex is monologuing…';
  await lex.load();
  progress.lex = 1; setBar();

  // place the player & the villain
  flight.position.copy(city.spawn);
  flight.yaw = city.spawnYaw;
  lex.position.copy(city.spawn).add(new THREE.Vector3(0, 12, -150));

  loaderEl.classList.add('hidden');
  startEl.classList.add('visible');
}

const flight = new FlightController(city, renderer.domElement);
const rig = new CameraRig(camera, city);
const post = NO_POST ? null : createPost(renderer, scene, camera);
const wind = new WindAudio();
const sfx = new SFX(wind);
const music = new Music(wind);
const hud = new HUD();
const game = new Game({ flight, character, lex, vfx, rig, sfx, hud });

let started = POSE_DEBUG;
let paused = false;
const pauseEl = document.getElementById('pause');

function setPaused(v) {
  if (paused === v) return;
  paused = v;
  pauseEl.classList.toggle('visible', v);
  music.setDucked(v);
}

startEl.addEventListener('click', () => {
  startEl.classList.add('hidden');
  hudEl.classList.add('visible');
  wind.start();
  music.start();
  renderer.domElement.requestPointerLock?.();
  started = true;
});
renderer.domElement.addEventListener('click', () => {
  if (started && game.gameActive && !paused && !document.pointerLockElement) {
    renderer.domElement.requestPointerLock?.();
  }
});

// Escape exits pointer lock → that IS the pause button
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && started && game.gameActive && !POSE_DEBUG) {
    setPaused(true);
  }
});
pauseEl.addEventListener('click', () => {
  setPaused(false);
  renderer.domElement.requestPointerLock?.();
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  post?.composer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
let hudTick = 0;

// ---- adaptive resolution: trade pixels for frame rate ----
const adapt = { scale: 1, acc: 0, n: 0, cooldown: 0 };
function adaptResolution(rawDt) {
  adapt.acc += rawDt; adapt.n++; adapt.cooldown -= rawDt;
  if (adapt.n < 45 || adapt.cooldown > 0) return;
  const avg = adapt.acc / adapt.n;
  adapt.acc = 0; adapt.n = 0;
  let next = adapt.scale;
  if (avg > 1 / 42 && adapt.scale > 0.62) next = Math.max(0.62, adapt.scale - 0.12);
  else if (avg < 1 / 70 && adapt.scale < 1) next = Math.min(1, adapt.scale + 0.06);
  if (next !== adapt.scale) {
    adapt.scale = next;
    adapt.cooldown = 1.5;
    renderer.setPixelRatio(BASE_DPR * adapt.scale);
    renderer.setSize(innerWidth, innerHeight);
    post?.composer.setSize(innerWidth, innerHeight);
  }
}

function tick(dt) {
  if (paused) {
    // frozen world: keep presenting frames so the blur overlay has something behind it
    if (post) post.composer.render();
    else renderer.render(scene, camera);
    return;
  }
  if (character.model && lex.model) {
    let state;
    if (POSE_DEBUG) {
      const t = performance.now() / 1000;
      state = {
        position: new THREE.Vector3(0, 60, 0),
        velocity: new THREE.Vector3(0, 0, -20),
        yaw: 0, speed01: 1, boost01: 0, justBoosted: 0,
        bankRoll: 0, velPitch: 0, kmh: 0,
      };
      character.update(dt, state);
      camera.position.set(Math.sin(t * 0.4) * 5, 63, Math.cos(t * 0.4) * 5);
      camera.lookAt(0, 60, 0);
      camera.fov = 50; camera.updateProjectionMatrix();
      sky.update(dt, state.position);
    } else {
      const ts = game.timeScale(dt);
      const sdt = dt * ts;
      state = flight.update(game.gameActive ? sdt : sdt * 0.2);
      character.update(sdt, state);
      lex.update(sdt, {
        position: flight.position,
        velocity: flight.velocity,
        onChunkHit: (c) => game.onChunkHit(c),
        gameActive: game.gameActive,
      }, city);
      game.update(dt, camera);
      if (!window.__freeCam) rig.update(dt, state);
      sky.update(dt, flight.position);
      vfx.update(sdt);
      wind.update(state);

      hudTick += dt;
      if (hudTick > 0.08) {
        hudTick = 0;
        speedEl.textContent = Math.round(state.kmh);
        boostEl.style.width = `${Math.round(state.boost01 * 100)}%`;
        hudEl.classList.toggle('boosting', state.boost01 > 0.4);
      }
    }
  }
  if (post) post.composer.render();
  else renderer.render(scene, camera);
}

renderer.setAnimationLoop(() => {
  const raw = clock.getDelta();
  if (window.__pause) return; // dev: freeze real time, drive via __tick
  if (document.visibilityState === 'visible') adaptResolution(Math.min(raw, 0.25));
  tick(Math.min(raw, 1 / 20));
});

boot();

// debug handles for development: drive N frames manually (works in hidden tabs)
window.__game = { scene, camera, city, character, flight, rig, lex, game, vfx, sky, THREE };
window.__tick = (n = 1, dt = 1 / 60) => {
  for (let i = 0; i < n; i++) tick(dt);
  clock.getDelta(); // swallow the elapsed time so the rAF loop doesn't double-step
};
