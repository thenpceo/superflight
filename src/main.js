import * as THREE from 'three';
import { SparkRenderer } from '@sparkjsdev/spark';
import { World } from './world.js';
import { Character } from './character.js';
import { FlightController } from './flight.js';
import { CameraRig } from './cameraRig.js';
import { createPost } from './post.js';
import { WindAudio } from './audio.js';

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
// splat rendering is fill-rate bound — high DPR costs far more than it adds
const BASE_DPR = Math.min(devicePixelRatio, 1.5);
renderer.setPixelRatio(BASE_DPR);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.NoToneMapping; // splat colors are already photographic
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0c12);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.03, 1400);

// maxStdDev √5 ≈ perceptually identical to the default √8, much less overdraw
const spark = new SparkRenderer({ renderer, maxStdDev: Math.sqrt(5) });
scene.add(spark);

// warm golden-hour key + cool ambient fill for the character
const hemi = new THREE.HemisphereLight(0xffe6c0, 0x4a4f5e, 1.15);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffd9a0, 2.2);
sun.position.set(-30, 40, -10);
scene.add(sun);
const rim = new THREE.DirectionalLight(0x9fc3ff, 0.7);
rim.position.set(25, 12, 30);
scene.add(rim);

let progress = { splat: 0, char: 0 };
const setBar = () => {
  const p = (progress.splat * 0.7 + progress.char * 0.3) * 100;
  barEl.style.width = `${p}%`;
};

const world = new World(scene);
const character = new Character(scene);

async function boot() {
  tipEl.textContent = 'loading the marble world…';
  let worldOk = true;
  try {
    await world.load((p) => { progress.splat = p.splat ?? progress.splat; setBar(); });
  } catch (e) {
    console.warn('world manifest missing — using placeholder environment', e);
    worldOk = false;
    buildPlaceholder();
  }
  progress.splat = 1; setBar();

  tipEl.textContent = 'suiting up…';
  await character.load();
  progress.char = 1; setBar();

  if (!worldOk) {
    world.spawn.set(0, 3, 0);
    world.boundsRadius = 60;
  }
  // flight was constructed before the manifest arrived — re-seed placement
  flight.position.copy(world.spawn);
  flight.yaw = world.spawnYaw;

  loaderEl.classList.add('hidden');
  startEl.classList.add('visible');
}

function buildPlaceholder() {
  scene.background = new THREE.Color(0x131726);
  scene.fog = new THREE.Fog(0x131726, 30, 160);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400, 64, 64),
    new THREE.MeshStandardMaterial({ color: 0x2a3040, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const grid = new THREE.GridHelper(400, 80, 0x4a5670, 0x323a4e);
  grid.position.y = 0.01;
  scene.add(grid);
  for (let i = 0; i < 40; i++) {
    const h = 2 + Math.random() * 12;
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(2 + Math.random() * 4, h, 2 + Math.random() * 4),
      new THREE.MeshStandardMaterial({ color: 0x39415a, roughness: 0.9 })
    );
    const a = Math.random() * Math.PI * 2, r = 14 + Math.random() * 70;
    box.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
    scene.add(box);
  }
}

const flight = new FlightController(world, renderer.domElement);
const rig = new CameraRig(camera, world);
const post = NO_POST ? null : createPost(renderer, scene, camera);
const wind = new WindAudio();

let started = POSE_DEBUG;
startEl.addEventListener('click', () => {
  startEl.classList.add('hidden');
  hudEl.classList.add('visible');
  wind.start();
  renderer.domElement.requestPointerLock?.();
  started = true;
});
renderer.domElement.addEventListener('click', () => {
  if (started && !document.pointerLockElement) renderer.domElement.requestPointerLock?.();
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
  if (character.model) {
    let state;
    if (POSE_DEBUG) {
      // frozen full-speed pose, slow orbit for inspection
      const t = performance.now() / 1000;
      state = {
        position: new THREE.Vector3(0, 3, 0),
        velocity: new THREE.Vector3(0, 0, -20),
        yaw: 0, speed01: 1, boost01: 0, justBoosted: 0,
        bankRoll: 0, velPitch: 0, kmh: 0,
      };
      character.update(dt, state);
      camera.position.set(Math.sin(t * 0.4) * 5, 3.6, Math.cos(t * 0.4) * 5);
      camera.lookAt(0, 3, 0);
      camera.fov = 50; camera.updateProjectionMatrix();
    } else {
      state = flight.update(dt);
      character.update(dt, state);
      rig.update(dt, state);
      wind.update(state);
      post?.update(state);

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
  if (document.visibilityState === 'visible') adaptResolution(Math.min(raw, 0.25));
  tick(Math.min(raw, 1 / 20));
});

boot();

// debug handles for development: drive N frames manually (works in hidden tabs)
window.__game = { scene, camera, world, character, flight, rig, THREE };
window.__tick = (n = 1, dt = 1 / 60) => {
  for (let i = 0; i < n; i++) tick(dt);
  clock.getDelta(); // swallow the elapsed time so the rAF loop doesn't double-step
};
