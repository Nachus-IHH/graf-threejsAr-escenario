// main_beatsaber.js
// Versión única y limpia basada en tu archivo subido.
// - Integra WebXR DOM Overlay para que los menús HTML aparezcan dentro del visor VR.
// - Conserva terreno (perlin), límites (WORLD_RADIUS), menú estilo osu!, spawn de notas,
//   pausa, countdown 3..2..1..GO, mezcla de audio (ambiente + música), y detección de hits
// - Se eliminan duplicados y se organizan funciones claramente.
// --------------------------------------------------------
// Requisitos:
// - index4.html debe cargar este archivo como module
// - style_beatsaber.css debe incluir las reglas de estilo ya compartidas (añadir los z-indexs sugeridos)
// - assets: audios en assets/audio/effects y assets/audio/songs; thumbs en assets/img; hdr en assets/hdr.
// --------------------------------------------------------

import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

/* ================== CONSTS / CONFIG (tomadas del archivo fuente / tu estructura) ================== */
const WORLD_SIZE = 260;
const TERRAIN_RES = 256;
const TERRAIN_MAX_H = 2.6;
const TREE_COUNT = 520;
const PLAYER_RADIUS = 0.35;
const OBJ_TREE_R = 0.6;
const WORLD_RADIUS = WORLD_SIZE * 0.5 - 1.0;

// HDRI: usa los que vienen en tu archivo cargado (ajusta si cambias los ficheros)
const HDRI_LOCAL = 'assets/hdr/evening_museum.hdr';
const HDRI_FALLBACK = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/moonless_golf_1k.hdr';

/* GAMEPLAY */
const NOTE_SPEED = 14.0;
const NOTE_SPAWN_Z = -45;
const NOTE_HIT_ZONE_Z = -1.8;
const NOTE_DESPAWN_Z = 6.0;
const NOTE_SIZE = 0.6;
const noteLanes = [-1.8, -0.6, 0.6, 1.8];
const MIN_Z_SEPARATION = 1.6; // separación mínima entre notas en z
const MAX_SAME_Z = 2; // máximo 2 notas con la misma Z

/* SONGS (usa tu estructura de assets) */
const SONGS = [
  {
    id: 'capibara_candidata',
    name: 'Capibara candidata',
    artist: 'Gemini',
    file: 'assets/audio/songs/capibara_candidata.mp3',
    duration: 99,
    thumb: 'assets/img/Gemini_capibara_candidata.png',
    diffs: { easy: 2, normal: 3, hard: 5 }
  },
  {
    id: 'capibara_mistica',
    name: 'Capibara mística',
    artist: 'Gemini',
    file: 'assets/audio/songs/capibara_mistica.mp3',
    duration: 35,
    thumb: 'assets/img/Gemini_capibara_mistica.png',
    diffs: { easy: 1, normal: 3, hard: 4 }
  },
  {
    id: 'pollo_mago',
    name: 'Pollo mago',
    artist: 'Gemini',
    file: 'assets/audio/songs/pollo_mago.mp3',
    duration: 30,
    thumb: 'assets/img/Gemini_pollo_mago.png',
    diffs: { easy: 2, normal: 3, hard: 5 }
  }
];

/* ========== DOM references (index4.html debe tener estos IDs) ========== */
const hudScore = document.getElementById('score');
const hudCombo = document.getElementById('combo');
const menuEl = document.getElementById('menu');
const songListEl = document.getElementById('songList');
const startBtn = document.getElementById('startBtn');
const difficultiesBlock = document.getElementById('difficulties');
const selectedSongTitle = document.getElementById('selectedSongTitle');

const pauseMenu = document.getElementById('pauseMenu');
const resumeBtn = document.getElementById('resumeBtn');
const restartBtn = document.getElementById('restartBtn');
const backMenuBtn = document.getElementById('backMenuBtn');

const resultScreen = document.getElementById('resultScreen');
const finalScoreEl = document.getElementById('finalScore');
const finalComboEl = document.getElementById('finalCombo');
const resultRestartBtn = document.getElementById('resultRestartBtn');
const resultMenuBtn = document.getElementById('resultMenuBtn');

const countdownEl = document.getElementById('countdown');
const ambientEl = document.getElementById('ambient');

/* ========== RENDERER / SCENES / CAMERA ========== */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.xr.enabled = true;
renderer.autoClear = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x06101a);
scene.fog = new THREE.FogExp2(0x06101a, 0.028);

const bgScene = new THREE.Scene();
const bgCam = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 5000);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 500);
const player = new THREE.Group();
player.position.set(0, 1.6, 3);
player.add(camera);
scene.add(player);

/* ========== PMREM / HDRI (uso de RGBELoader con fallback) ========== */
const pmremGen = new THREE.PMREMGenerator(renderer);
pmremGen.compileEquirectangularShader();

async function setHDRI(url) {
  const hdr = await new Promise((res, rej) =>
    new RGBELoader().load(url, (t) => res(t), undefined, rej)
  );
  const env = pmremGen.fromEquirectangular(hdr).texture;
  scene.environment = env;
  hdr.dispose();
  pmremGen.dispose();
}
setHDRI(HDRI_LOCAL)
  .catch(() => setHDRI(HDRI_FALLBACK).catch((e) => console.warn('Sin HDRI:', e)));

/* ========== LIGHTS ========== */
const hemiLight = new THREE.HemisphereLight(0x8fb2ff, 0x0a0c10, 0.35);
scene.add(hemiLight);

const moonLight = new THREE.DirectionalLight(0xcfe2ff, 1.25);
moonLight.castShadow = true;
moonLight.shadow.mapSize.set(2048, 2048);
moonLight.shadow.camera.near = 0.5;
moonLight.shadow.camera.far = 220;
scene.add(moonLight);

/* ========== TERRAIN (Perlin) ========== */
function makePerlin(seed = 1337) {
  const p = new Uint8Array(512);
  for (let i = 0; i < 256; i++) p[i] = i;
  let n, q;
  for (let i = 255; i > 0; i--) {
    n = Math.floor((seed = (seed * 16807) % 2147483647) / 2147483647 * (i + 1));
    q = p[i]; p[i] = p[n]; p[n] = q;
  }
  for (let i = 0; i < 256; i++) p[256 + i] = p[i];
  const grad = (h, x, y) => {
    switch (h & 3) {
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      default: return -x - y;
    }
  };
  const fade = t => t * t * t * (t * (t * 6. - 15.) + 10.);
  const lerp = (a, b, t) => a + t * (b - a);
  return function noise(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x); y -= Math.floor(y);
    const u = fade(x), v = fade(y), A = p[X] + Y, B = p[X + 1] + Y;
    return lerp(
      lerp(grad(p[A], x, y), grad(p[B], x - 1., y), u),
      lerp(grad(p[A + 1], x, y - 1.), grad(p[B + 1], x - 1., y - 1.), u),
      v
    );
  };
}

const noise2D = makePerlin(2025);
const terrainGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, TERRAIN_RES, TERRAIN_RES);
terrainGeo.rotateX(-Math.PI / 2);
const tPos = terrainGeo.attributes.position;
for (let i = 0; i < tPos.count; i++) {
  const x = tPos.getX(i), z = tPos.getZ(i);
  const h = noise2D(x * 0.02, z * 0.02) * 0.6 +
            noise2D(x * 0.05, z * 0.05) * 0.25 +
            noise2D(x * 0.1, z * 0.1) * 0.1;
  tPos.setY(i, h * TERRAIN_MAX_H);
}
tPos.needsUpdate = true;
terrainGeo.computeVertexNormals();
terrainGeo.setAttribute('uv2', new THREE.BufferAttribute(new Float32Array(terrainGeo.attributes.uv.array), 2));

const terrainMat = new THREE.MeshStandardMaterial({
  color: 0x3a2a1c, roughness: 1.0, metalness: 0.0
});
const terrain = new THREE.Mesh(terrainGeo, terrainMat);
terrain.receiveShadow = true;
scene.add(terrain);

/* ========== RAYCAST HELPERS ========== */
const raycaster = new THREE.Raycaster();
function getTerrainHitRay(origin, dir, far = 500) {
  raycaster.set(origin, dir); raycaster.far = far;
  const hit = raycaster.intersectObject(terrain, false)[0];
  return hit || null;
}
function getTerrainHeight(x, z) {
  const hit = getTerrainHitRay(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
  return hit ? hit.point.y : 0;
}

/* ========== CLAMP TO WORLD ========== */
function clampToWorld(v) {
  const r = Math.hypot(v.x, v.z);
  if (r > WORLD_RADIUS - PLAYER_RADIUS) {
    const ang = Math.atan2(v.z, v.x);
    const rr = WORLD_RADIUS - PLAYER_RADIUS;
    v.x = Math.cos(ang) * rr; v.z = Math.sin(ang) * rr;
  }
  return v;
}

/* ========== SIMPLE TREE COLLIDERS ========== */
const treeColliders = [];
function addTree(x, z, scale = 1) {
  treeColliders.push({ x, z, r: OBJ_TREE_R * scale });
}
for (let i = 0; i < TREE_COUNT; i++) {
  let x = (Math.random() - 0.5) * WORLD_SIZE, z = (Math.random() - 0.5) * WORLD_SIZE;
  if (Math.hypot(x - player.position.x, z - player.position.z) < 6) {
    const a = Math.random() * Math.PI * 2, r = 8 + Math.random() * 20;
    x = player.position.x + Math.cos(a) * r; z = player.position.z + Math.sin(a) * r;
  }
  addTree(x, z, 0.8 + Math.random() * 1.8);
}

/* ========== AUDIO (ambiente + sfx + música) ========== */
const listener = new THREE.AudioListener(); camera.add(listener);
const audioLoader = new THREE.AudioLoader();
let chimeBuffer = null, missBuffer = null;
let musicBuffers = {}, musicAudio = null;

audioLoader.load('assets/audio/effects/hit.wav', b => chimeBuffer = b, undefined, e => console.warn('hit load fail', e));
audioLoader.load('assets/audio/effects/miss.wav', b => missBuffer = b, undefined, e => console.warn('miss load fail', e));
for (const s of SONGS) {
  audioLoader.load(s.file, b => musicBuffers[s.id] = b, undefined, e => console.warn('song load fail', s.file, e));
}

function setAmbientVolume(v) {
  try { if (ambientEl) ambientEl.volume = v; } catch (e) { }
}
function playSfx(buf, vol = 1.0) {
  if (!buf) return;
  const s = new THREE.Audio(listener);
  s.setBuffer(buf);
  s.setVolume(vol);
  s.setLoop(false);
  s.play();
}

/* ========== VR CONTROLLERS & SABERS ========== */
const vrBtn = VRButton.createButton(renderer, {
  optionalFeatures: ["dom-overlay"],
  domOverlay: { root: document.body }
});
vrBtn.classList.add('vr-button');
document.body.appendChild(vrBtn);

// Controllers
const controllerLeft = renderer.xr.getController(0);
const controllerRight = renderer.xr.getController(1);
scene.add(controllerLeft, controllerRight);

const controllerModelFactory = new XRControllerModelFactory();
const grip0 = renderer.xr.getControllerGrip(0); grip0.add(controllerModelFactory.createControllerModel(grip0)); scene.add(grip0);
const grip1 = renderer.xr.getControllerGrip(1); grip1.add(controllerModelFactory.createControllerModel(grip1)); scene.add(grip1);

// Sabers (elevados para que no estén tan abajo)
function makeSaberMesh() {
  const geo = new THREE.CylinderGeometry(0.03, 0.03, 0.9, 8);
  const mat = new THREE.MeshStandardMaterial({ emissive: 0x44ccff, emissiveIntensity: 1.2, metalness: 0.1, roughness: 0.6 });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(0, -0.25, 0); // menos negativo -> más arriba
  return m;
}
const saberL = makeSaberMesh(); controllerLeft.add(saberL);
const saberR = makeSaberMesh(); controllerRight.add(saberR);

const saberTipL = new THREE.Object3D(); saberTipL.position.set(0, -0.7, 0); controllerLeft.add(saberTipL);
const saberTipR = new THREE.Object3D(); saberTipR.position.set(0, -0.7, 0); controllerRight.add(saberTipR);

/* ========== NOTES (cubos) ========== */
const notes = [];
const activeZCounts = new Map();
function roundZKey(z) { return Math.round(z * 10) / 10; }
function makeNoteMesh(color = 0xff6a00) {
  const geo = new THREE.BoxGeometry(NOTE_SIZE, NOTE_SIZE, NOTE_SIZE);
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.2, roughness: 0.5 });
  return new THREE.Mesh(geo, mat);
}
function chooseSpawnZ() {
  const attempts = 20;
  for (let a = 0; a < attempts; a++) {
    const z = NOTE_SPAWN_Z + (Math.random() - 0.5) * 3.5;
    const key = roundZKey(z);
    const count = activeZCounts.get(key) || 0;
    if (count >= MAX_SAME_Z) continue;
    let ok = true;
    for (const existingKey of activeZCounts.keys()) {
      if (Math.abs(existingKey - key) < MIN_Z_SEPARATION) { ok = false; break; }
    }
    if (ok) return { z, key };
  }
  return { z: NOTE_SPAWN_Z, key: roundZKey(NOTE_SPAWN_Z) };
}
function spawnNoteAtLane(laneIndex) {
  const { z, key } = chooseSpawnZ();
  const x = noteLanes[laneIndex];
  const y = 0.9 + Math.random() * 1.25; // altura aleatoria
  const m = makeNoteMesh(new THREE.Color().setHSL(Math.random(), 0.9, 0.5).getHex());
  m.position.set(x, y, z);
  m.userData = { lane: laneIndex, hit: false, zKey: key };
  scene.add(m);
  notes.push(m);
  activeZCounts.set(key, (activeZCounts.get(key) || 0) + 1);
  return m;
}
function removeNoteAtIndex(i) {
  const n = notes[i];
  const key = n.userData.zKey;
  scene.remove(n);
  if (n.geometry) n.geometry.dispose();
  if (n.material) n.material.dispose();
  notes.splice(i, 1);
  if (key !== undefined) {
    const c = activeZCounts.get(key) || 1;
    if (c <= 1) activeZCounts.delete(key); else activeZCounts.set(key, c - 1);
  }
}
function clearNotes() {
  for (let i = notes.length - 1; i >= 0; i--) removeNoteAtIndex(i);
  activeZCounts.clear();
}

/* ========== GAME STATE, PATTERNS & UI ========== */
let activeSong = null;
let chosenDiff = 'normal';
let playing = false, paused = false;
let songStartTime = 0;
let score = 0, combo = 0, maxCombo = 0;
let pattern = [], patternIdx = 0;

function genPatternForDuration(dur, density = 1.0) {
  const pat = []; let t = 1.2;
  while (t < dur - 1) {
    const lane = Math.floor(Math.random() * noteLanes.length);
    pat.push({ t, lane });
    t += 0.4 + Math.random() * 0.6 / density;
  }
  return pat;
}
for (const s of SONGS) s.pattern = genPatternForDuration(s.duration, 1.0);

/* UI: build song list (osu-like) */
function secondsToMMSS(sec) {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
function createStarMarkup(n) {
  return '★'.repeat(Math.max(0, Math.floor(n)));
}
function buildSongList() {
  songListEl.innerHTML = '';
  for (const s of SONGS) {
    const card = document.createElement('div');
    card.className = 'song-card';
    card.dataset.song = s.id;

    const thumb = document.createElement('div'); thumb.className = 'song-thumb';
    thumb.style.backgroundImage = `url('${s.thumb}')`;

    const info = document.createElement('div'); info.className = 'song-info';
    const title = document.createElement('div'); title.className = 'song-title'; title.textContent = s.name;
    const sub = document.createElement('div'); sub.className = 'song-sub'; sub.textContent = `${s.artist}`;
    const meta = document.createElement('div'); meta.className = 'song-meta';
    const stars = document.createElement('div'); stars.className = 'stars'; stars.textContent = createStarMarkup(s.diffs.normal);
    const dur = document.createElement('div'); dur.className = 'song-duration'; dur.textContent = secondsToMMSS(s.duration);

    meta.appendChild(stars); meta.appendChild(dur);
    info.appendChild(title); info.appendChild(sub); info.appendChild(meta);
    card.appendChild(thumb); card.appendChild(info);

    card.addEventListener('click', () => {
      document.querySelectorAll('.song-card').forEach(x => x.classList.remove('selected'));
      card.classList.add('selected');
      difficultiesBlock.style.display = 'block';
      selectedSongTitle.textContent = `${s.name} — ${s.artist}`;

      // update diff buttons with stars
      document.querySelectorAll('.diff-btn').forEach(btn => {
        const diff = btn.dataset.diff;
        // remove prior stars node inside button if exists
        const existingStars = btn.querySelector('.stars');
        if (existingStars) existingStars.remove();
        const sp = document.createElement('span'); sp.className = 'stars'; sp.textContent = createStarMarkup(s.diffs[diff] || 0);
        btn.appendChild(sp);
        btn.classList.remove('selected');
      });
      // default normal
      chosenDiff = 'normal';
      const normalBtn = document.querySelector('.diff-btn[data-diff="normal"]');
      if (normalBtn) normalBtn.classList.add('selected');

      // set start dataset
      startBtn.dataset.song = s.id;
      startBtn.dataset.diff = chosenDiff;

      // OPTIONAL: set background image of the big menu panel to the thumb (like osu)
      if (menuEl) {
        menuEl.style.backgroundImage = `url('${s.thumb}')`;
        menuEl.style.backgroundSize = 'cover';
        menuEl.style.backgroundPosition = 'center';
      }
    });

    songListEl.appendChild(card);
  }
}

/* difficulty buttons click handling (delegated) */
document.addEventListener('click', (e) => {
  const target = e.target.closest('.diff-btn');
  if (target) {
    const d = target.dataset.diff;
    chosenDiff = d;
    document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('selected'));
    target.classList.add('selected');
    if (startBtn) startBtn.dataset.diff = chosenDiff;
  }
});

/* start button */
if (startBtn) startBtn.addEventListener('click', () => {
  const sid = startBtn.dataset.song || SONGS[0].id;
  const diff = startBtn.dataset.diff || 'normal';
  prepareAndStartSong(sid, diff);
});

/* ========== PREPARE / START / COUNTDOWN / PAUSE / RESTART / MENU ========== */
function prepareAndStartSong(songId, diff) {
  const s = SONGS.find(x => x.id === songId);
  if (!s) return;
  const density = diff === 'easy' ? 0.8 : diff === 'hard' ? 1.4 : 1.0;
  s.pattern = genPatternForDuration(s.duration, density);
  pattern = s.pattern.slice();
  patternIdx = 0;
  runCountdown(3, () => startSongInternal(s));
}

function startSongInternal(s) {
  clearNotes();
  if (musicAudio) { try { musicAudio.stop(); } catch (e) { } musicAudio = null; }
  if (musicBuffers[s.id]) {
    musicAudio = new THREE.Audio(listener); musicAudio.setBuffer(musicBuffers[s.id]);
    musicAudio.setLoop(false); musicAudio.setVolume(0.85); musicAudio.play();
  } else console.warn('Música no cargada:', s.file);
  setAmbientVolume(0.12);
  activeSong = s;
  playing = true; paused = false;
  score = 0; combo = 0; maxCombo = 0;
  pattern = s.pattern.slice(); patternIdx = 0;
  songStartTime = performance.now() * 0.001;
  if (hudScore) hudScore.textContent = String(score);
  if (hudCombo) hudCombo.textContent = String(combo);
  menuEl.style.display = 'none';
  difficultiesBlock.style.display = 'none';
  resultScreen.style.display = 'none';
  pauseMenu.style.display = 'none';
}

function runCountdown(n, cb) {
  if (!countdownEl) { cb(); return; }
  countdownEl.style.display = 'block';
  let cur = n;
  countdownEl.textContent = String(cur);
  const t = setInterval(() => {
    cur--;
    if (cur <= 0) {
      countdownEl.textContent = 'GO';
      setTimeout(() => {
        countdownEl.style.display = 'none';
        clearInterval(t);
        cb();
      }, 420);
    } else {
      countdownEl.textContent = String(cur);
    }
  }, 900);
}

function openPauseMenu() {
  if (!playing) return;
  paused = true;
  pauseMenu.style.display = 'block';
  if (musicAudio && musicAudio.isPlaying) musicAudio.pause();
  setAmbientVolume(0.18);
}
function resumeFromPause() {
  if (!playing) return;
  pauseMenu.style.display = 'none';
  runCountdown(3, () => {
    paused = false;
    if (musicAudio && !musicAudio.isPlaying) musicAudio.play();
    setAmbientVolume(0.12);
  });
}
function resetToMenu() {
  clearNotes();
  if (musicAudio) { try { musicAudio.stop(); } catch (e) { } musicAudio = null; }
  setAmbientVolume(0.4);
  playing = false; paused = false; activeSong = null;
  menuEl.style.display = 'block';
  pauseMenu.style.display = 'none';
  resultScreen.style.display = 'none';
  score = 0; combo = 0; maxCombo = 0;
  if (hudScore) hudScore.textContent = '0';
  if (hudCombo) hudCombo.textContent = '0';
}
function restartSong() {
  if (!activeSong) return;
  prepareAndStartSong(activeSong.id, chosenDiff);
}

/* UI Pause / Result buttons */
if (resumeBtn) resumeBtn.addEventListener('click', () => resumeFromPause());
if (restartBtn) restartBtn.addEventListener('click', () => restartSong());
if (backMenuBtn) backMenuBtn.addEventListener('click', () => resetToMenu());
if (resultRestartBtn) resultRestartBtn.addEventListener('click', () => { restartSong(); resultScreen.style.display = 'none'; });
if (resultMenuBtn) resultMenuBtn.addEventListener('click', () => { resetToMenu(); resultScreen.style.display = 'none'; });

/* controller squeeze to pause/resume */
controllerLeft.addEventListener('squeezestart', () => { if (!playing) return; if (paused) resumeFromPause(); else openPauseMenu(); });
controllerRight.addEventListener('squeezestart', () => { if (!playing) return; if (paused) resumeFromPause(); else openPauseMenu(); });

/* ========== HIT DETECTION ========== */
function checkHits() {
  const DIST_THRESHOLD = 0.95;
  const tipL = new THREE.Vector3(); saberTipL.getWorldPosition(tipL);
  const tipR = new THREE.Vector3(); saberTipR.getWorldPosition(tipR);

  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    const notePos = new THREE.Vector3(); n.getWorldPosition(notePos);
    const dz = Math.abs(n.position.z - NOTE_HIT_ZONE_Z);
    const zt = dz / NOTE_SPEED;
    const dL = tipL.distanceTo(notePos);
    const dR = tipR.distanceTo(notePos);

    if (zt <= 0.5 && (dL < DIST_THRESHOLD || dR < DIST_THRESHOLD)) {
      const usedPos = dL < dR ? tipL : tipR;
      spawnHitEffectAt(usedPos);
      playSfx(chimeBuffer, 1.0);
      const add = Math.max(50, Math.floor((0.5 - zt) * 200));
      score += add;
      combo += 1;
      if (combo > maxCombo) maxCombo = combo;
      if (hudScore) hudScore.textContent = String(score);
      if (hudCombo) hudCombo.textContent = String(combo);
      removeNoteAtIndex(i);
    }
  }
}
function spawnHitEffectAt(pos) {
  const g = new THREE.SphereGeometry(0.16, 8, 8);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xfff2c8 }));
  m.position.copy(pos);
  scene.add(m);
  setTimeout(() => { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }, 220);
}

/* ========== UPDATE LOOP: spawn notes by pattern, move notes, handle misses ========== */
const clock = new THREE.Clock();
function update(dt) {
  if (!playing || paused) return;

  const now = performance.now() * 0.001 - songStartTime;
  const timeToTravel = Math.abs(NOTE_SPAWN_Z) / NOTE_SPEED;

  while (patternIdx < pattern.length && pattern[patternIdx].t <= now + timeToTravel) {
    const p = pattern[patternIdx];
    spawnNoteAtLane(p.lane);
    patternIdx++;
  }

  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    n.position.z += NOTE_SPEED * dt;
    if (n.position.z > NOTE_DESPAWN_Z) {
      playSfx(missBuffer, 0.6);
      removeNoteAtIndex(i);
      combo = 0;
      if (hudCombo) hudCombo.textContent = String(combo);
    }
  }

  checkHits();

  const songDuration = (activeSong && activeSong.pattern) ? (activeSong.pattern[activeSong.pattern.length - 1]?.t + 4.0) : (activeSong?.duration || 60);
  if (now > songDuration && notes.length === 0) {
    playing = false;
    if (musicAudio) { try { musicAudio.stop(); } catch (e) { } musicAudio = null; }
    setAmbientVolume(0.4);
    finalScoreEl.textContent = String(score);
    finalComboEl.textContent = String(maxCombo);
    resultScreen.style.display = 'block';
  }
}

/* ========== RENDER LOOP ========== */
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);

  const p = player.position;
  // Keep background centered if you have sky/field
  renderer.clear();
  bgCam.projectionMatrix.copy(camera.projectionMatrix);
  bgCam.matrixWorld.copy(camera.matrixWorld);
  bgCam.matrixWorldInverse.copy(camera.matrixWorldInverse);
  renderer.render(bgScene, bgCam);
  renderer.render(scene, camera);
});

/* ========== RESIZE ========== */
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ========== STARTUP: build UI + ambient play attempts ========== */
buildSongList();
try { if (ambientEl) { ambientEl.volume = 0.4; ambientEl.play().catch(()=>{}); } } catch (e) {}

/* ========== DOM OVERLAY / VR session events handling ========== */
/* Ensure these panels are visible in VR overlay: we added dom-overlay option to VRButton.
   Also add a class to body to adjust mobile/VR specific CSS if needed. */
renderer.xr.addEventListener('sessionstart', () => {
  document.body.classList.add('in-vr');
  // ensure overlayed DOM panels are above canvas; menu stays visible only if you want:
  // If you want to hide the menu at session start uncomment:
  // menuEl.style.display = 'none';
});
renderer.xr.addEventListener('sessionend', () => {
  document.body.classList.remove('in-vr');
  // restore ambient volume when exiting VR
  setAmbientVolume(0.4);
});

/* ========== UTILS / NOTES ========== */
/* If you want to show a VR pointer cursor to interact with DOM overlay, browsers implement it:
   - On supported runtimes you can use controller UI input to click DOM overlays (most modern WebXR runtimes do).
   If your headset/browser doesn't allow pointer interaction on DOM overlay, fallback to implementing
   3D UI in Three.js (plane with texture or raycast buttons).
*/

/* ========== End of file: recomendaciones ==========
- Asegúrate de servir los archivos mediante un servidor (http), no file://, porque HDRI y ESM requieren CORS/HTTP.
- Si los menús no responden en VR: verifica que el runtime soporta dom-overlay; Chrome + Oculus Browser suelen soportarlo.
- Si el overlay está visible pero no interactuable, puede que el runtime no entregue eventos apuntador; en ese caso debo añadir un cursor 3D y raycasting para interactuar con los botones (te lo puedo generar).
- Ajusta MIN_Z_SEPARATION, NOTE_SPEED y NOTE_SPAWN_Z para pulir dificultad/solapamientos.
- Si quieres que las tarjetas de la lista no ocupen toda la pantalla en VR, cambia menuEl.style.backgroundImage en la selección para reducir opacidad.
*/