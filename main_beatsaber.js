// main_beatsaber.js
// Versión extendida: Beat-Saber style + osu-like song selection + terrain/clamp + countdown + pause + hit effects at hand
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

/* ================== CONFIG / TERRAIN (tomadas del archivo fuente) ================== */
const WORLD_SIZE = 260;
const TERRAIN_RES = 256;
const TERRAIN_MAX_H = 2.6;
const TREE_COUNT = 520;
const PLAYER_RADIUS = 0.35;
const OBJ_TREE_R = 0.6;
const WORLD_RADIUS = WORLD_SIZE * 0.5 - 1.0;

// HDRI
const HDRI_LOCAL = 'assets/hdr/evening_museum.hdr';
const HDRI_FALLBACK = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/evening_museum.hdr';
const DANCE_MAT_TEXTURE = 'assets/img/dance_mat.png';

/* GAMEPLAY */
const NOTE_SPEED = 14.0;
const NOTE_SPAWN_Z = -45;
const NOTE_HIT_ZONE_Z = -1.8;
const NOTE_DESPAWN_Z = 6.0;
const NOTE_SIZE = 0.6;
const noteLanes = [-1.8, -0.6, 0.6, 1.8];
const MIN_Z_SEPARATION = 1.6; // separación mínima entre notas en z para evitar sobreposición
const MAX_SAME_Z = 2; // máximo 2 notas con la misma z (para pegar con dos manos)


const SONGS = [
  {
    id: 'song_a',
    name: 'Capibara candidata',
    artist: 'Artist A',
    file: 'assets/audio/songs/capibara_candidata.mp3',
    duration: 99,
    thumb: 'assets/img/Gemini_capibara_candidata.png', // tu imagen subida
    diffs: { easy: 2, normal: 3, hard: 5 }
  },
  {
    id: 'song_b',
    name: 'Capibara mistica',
    artist: 'Artist B',
    file: 'assets/audio/songs/capibara_mistica.mp3',
    duration: 205,
    thumb: 'assets/img/Gemini_capibara_mistica.png',
    diffs: { easy: 1, normal: 3, hard: 4 }
  },
  {
    id: 'song_c',
    name: 'Pollo mago',
    artist: 'Artist C',
    file: 'assets/audio/songs/pollo_mago.mp3',
    duration: 183,
    thumb: 'assets/img/Gemini_pollo_mago.png',
    diffs: { easy: 2, normal: 3, hard: 5 }
  }
];

/* DOM Refs */
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

/* THREE renderer, scenes, camera */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.xr.enabled = true;
renderer.autoClear = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x06101a);

const bgScene = new THREE.Scene();
const bgCam = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 5000);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 500);
const player = new THREE.Group();
player.position.set(0, 1.6, 3);
player.add(camera);
scene.add(player);


/* PMREM / HDRI (usando tus constantes) */
const pmremGen = new THREE.PMREMGenerator(renderer);
pmremGen.compileEquirectangularShader();
async function setHDRI(url) {
  const hdr = await new Promise((res, rej) => new RGBELoader().load(url, (t) => res(t), undefined, rej));
  const env = pmremGen.fromEquirectangular(hdr).texture;
  scene.environment = env;
  hdr.dispose(); pmremGen.dispose();
}
setHDRI(HDRI_LOCAL).catch(() => setHDRI(HDRI_FALLBACK).catch(e => console.warn('Sin HDRI:', e)));

/* Lights */
const hemiLight = new THREE.HemisphereLight(0x8fb2ff, 0x0a0c10, 0.35);
scene.add(hemiLight);
const moonLight = new THREE.DirectionalLight(0xcfe2ff, 1.25);
moonLight.castShadow = true;
moonLight.shadow.mapSize.set(2048, 2048);
moonLight.shadow.camera.near = 0.5;
moonLight.shadow.camera.far = 220;
scene.add(moonLight);


/* Raycast helpers (terrain height) */
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

/* clampToWorld como en el fichero fuente */
function clampToWorld(v) {
  const r = Math.hypot(v.x, v.z);
  if (r > WORLD_RADIUS - PLAYER_RADIUS) {
    const ang = Math.atan2(v.z, v.x);
    const rr = WORLD_RADIUS - PLAYER_RADIUS;
    v.x = Math.cos(ang) * rr; v.z = Math.sin(ang) * rr;
  }
  return v;
}


/* ========== AUDIO ========== */
const listener = new THREE.AudioListener(); camera.add(listener);
const audioLoader = new THREE.AudioLoader();
let chimeBuffer = null, windBuffer = null;
let musicBuffers = {};
let musicAudio = null;
let previewAudio = null;

audioLoader.load('assets/audio/effects/hit.wav', b => chimeBuffer = b, undefined, e => console.warn('hit load fail', e));
audioLoader.load('assets/audio/effects/miss.wav', b => windBuffer = b, undefined, e => console.warn('miss load fail', e));
for (const s of SONGS) {
  audioLoader.load(s.file, b => musicBuffers[s.id] = b, undefined, e => console.warn('song load fail', s.file, e));
}

/* ambient element control */
function setAmbientVolume(v) {
  try { if (ambientEl) ambientEl.volume = v; } catch (e) { }
}

/* preview audio control */
function stopPreviewAudio() {
  if (previewAudio) {
    try { previewAudio.stop(); } catch (e) { }
    previewAudio = null;
  }
}

/* sfx play */
function playSfx(buffer, vol = 0.9) {
  if (!buffer) return;
  const s = new THREE.Audio(listener);
  s.setBuffer(buffer);
  s.setLoop(false);
  s.setVolume(vol);
  s.play();
}

/* ========== VR CONTROLLERS + SABERS ========== */
// ACTIVA VR + DOM OVERLAY
const vrBtn = VRButton.createButton(renderer, {
  optionalFeatures: ["dom-overlay"],       // habilita DOM Overlay dentro del visor VR
  domOverlay: { root: document.body }      // qué elementos HTML serán visibles en VR
});
// clase opcional para estilizar el botón VR
vrBtn.classList.add('vr-button');
// agrega el botón a la página
document.body.appendChild(vrBtn);


const controllerLeft = renderer.xr.getController(0);
const controllerRight = renderer.xr.getController(1);
scene.add(controllerLeft, controllerRight);

const controllerModelFactory = new XRControllerModelFactory();
const grip0 = renderer.xr.getControllerGrip(0); grip0.add(controllerModelFactory.createControllerModel(grip0)); scene.add(grip0);
const grip1 = renderer.xr.getControllerGrip(1); grip1.add(controllerModelFactory.createControllerModel(grip1)); scene.add(grip1);


function makeSaberMesh(color = 0x00c8ff, length = 1.4) {
  // Hoja del sable
  const bladeGeo = new THREE.CylinderGeometry(0.02, 0.02, length, 8);
  bladeGeo.translate(0, -length / 2, 0);

  const mat = new THREE.MeshBasicMaterial({
    color,
    emissive: color,
    emissiveIntensity: 2.0
  });

  const saberBlade = new THREE.Mesh(bladeGeo, mat);

  // Mango
  const handleGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.2, 8);
  const handleMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8 });
  const handle = new THREE.Mesh(handleGeo, handleMat);
  handle.position.y = 0.1;

  // Grupo completo
  const saber = new THREE.Group();
  saber.add(saberBlade);
  saber.add(handle);

  // 🔥 FIX: Rotar el grupo para que apunte hacia adelante
  saber.rotation.x = Math.PI / 2;

  return saber;
}

const saberL = makeSaberMesh(); controllerLeft.add(saberL);
const saberR = makeSaberMesh(); controllerRight.add(saberR);

/* tips para detectar colisiones (colocados cerca del extremo de la vara) */
const saberTipL = new THREE.Object3D(); saberTipL.position.set(0, 0.7, 0); controllerLeft.add(saberTipL);
const saberTipR = new THREE.Object3D(); saberTipR.position.set(0, 0.7, 0); controllerRight.add(saberTipR);

/* ========== NOTES (cubos) ========= */
const notes = []; // stores {mesh, lane, z, hit}
const activeZCounts = new Map(); // track count of notes per z (rounded) to enforce MAX_SAME_Z

function roundZKey(z) { return Math.round(z * 10) / 10; } // discretize z keys

function makeNote(color = 0xff6a00) {
  const geo = new THREE.BoxGeometry(NOTE_SIZE, NOTE_SIZE, NOTE_SIZE);
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.2, roughness: 0.5 });
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

/* Try to find a spawn Z that doesn't violate min separation and max same-z */
function chooseSpawnZ() {
  // We'll pick candidate z values along spawn band and check spacing
  const attempts = 20;
  for (let a = 0; a < attempts; a++) {
    // Escoger una Z aleatoria dentro de la zona de spawn
    const z = NOTE_SPAWN_Z + (Math.random() - 0.5) * 3.5;
    const key = roundZKey(z);

    // 1. Verificar el límite de MAX_SAME_Z
    const count = activeZCounts.get(key) || 0;
    if (count >= MAX_SAME_Z) continue;

    // 2. Verificar la separación mínima (MIN_Z_SEPARATION)
    let ok = true;
    for (const existingKey of activeZCounts.keys()) {
      // Si la distancia entre la nueva Z y una Z existente es menor que la separación mínima, fallar.
      if (Math.abs(existingKey - key) < MIN_Z_SEPARATION) {
        ok = false;
        break;
      }
    }

    if (ok) return { z, key };
  }

  // fallback: return spawn z regardless (will allow some overlap)
  const fallz = NOTE_SPAWN_Z;
  return { z: fallz, key: roundZKey(fallz) };
}

/* spawnNote: lane index 0..3; height random (punto 4) */
function spawnNoteAtLane(laneIndex) {
  const { z, key } = chooseSpawnZ();
  const x = noteLanes[laneIndex];
  const y = 0.9 + Math.random() * 1.25; // altura aleatoria
  const m = makeNote(new THREE.Color().setHSL(Math.random(), 0.9, 0.5).getHex());
  m.position.set(x, y, z);
  m.userData = { lane: laneIndex, hit: false };
  scene.add(m);
  notes.push(m);
  activeZCounts.set(key, (activeZCounts.get(key) || 0) + 1);
  m.userData.zKey = key;
  return m;
}

/* remove note helper */
function removeNoteAtIndex(i) {
  const n = notes[i];
  const key = n.userData.zKey;
  scene.remove(n);
  if (n.geometry) n.geometry.dispose();
  if (n.material) n.material.dispose();
  notes.splice(i, 1);
  // decrement activeZCounts
  if (key !== undefined) {
    const c = activeZCounts.get(key) || 1;
    if (c <= 1) activeZCounts.delete(key); else activeZCounts.set(key, c - 1);
  }
}

/* ========== GAME STATE & PATTERNS ========= */
let activeSong = null;
let chosenDiff = 'normal';
let playing = false, paused = false;
let songStartTime = 0;
let score = 0, combo = 0, maxCombo = 0;
let pattern = [];
let patternIdx = 0;

/* generate placeholder pattern aligned to SONG duration (simple) */
function genPatternForDuration(dur, density = 1.0) {
  const pat = [];
  let t = 1.2;
  while (t < dur - 1) {
    const lane = Math.floor(Math.random() * noteLanes.length);
    pat.push({ t: t, lane });
    t += 0.4 + Math.random() * 0.6 / density;
  }
  return pat;
}

/* Initialize patterns */
for (const s of SONGS) {
  s.pattern = genPatternForDuration(s.duration, 1.0);
}

/* ========== UI: build osu-like song list (cards) ========== */
function secondsToMMSS(sec) {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function createStarMarkup(n) {
  let out = '';
  for (let i = 0; i < n; i++) out += '★';
  return out;
}

// main_beatsaber.js (aproximadamente línea 214)

/* ========== UI: build osu-like song list (cards) ========== */
// ... (toda la función buildSongList, que es muy larga) ...

/* ========== UI: build osu-like song list (cards) ========== */
function buildSongList() {
  songListEl.innerHTML = '';
  for (const s of SONGS) {
    const card = document.createElement('div');
    card.className = 'song-card';
    card.dataset.song = s.id;

    const thumb = document.createElement('div');
    thumb.className = 'song-thumb';
    thumb.style.backgroundImage = `url('${s.thumb}')`;

    const info = document.createElement('div');
    info.className = 'song-info';

    const title = document.createElement('div');
    title.className = 'song-title';
    title.textContent = s.name;

    const sub = document.createElement('div');
    sub.className = 'song-sub';
    sub.textContent = `${s.artist}`;

    const meta = document.createElement('div');
    meta.className = 'song-meta';
    const stars = document.createElement('div');
    stars.className = 'stars';
    stars.textContent = createStarMarkup(s.diffs.normal);
    const dur = document.createElement('div');
    dur.className = 'song-duration';
    dur.textContent = secondsToMMSS(s.duration);

    meta.appendChild(stars);
    meta.appendChild(dur);

    info.appendChild(title);
    info.appendChild(sub);
    info.appendChild(meta);

    card.appendChild(thumb);
    card.appendChild(info);

    // ⭐️ LÓGICA DE AUDIO Y SELECCIÓN AL HACER CLIC ⭐️
    card.addEventListener('click', () => {
      // A. Detener audio anterior (Esencial al cambiar de canción)
      stopPreviewAudio(); // 👈 Llama a la función de parada

      // B. Marcar seleccionada y actualizar fondo
      document.querySelectorAll('.song-card').forEach(x => x.classList.remove('selected'));
      card.classList.add('selected');

      // Cambio de fondo del menú principal
      menuEl.style.backgroundImage = `url('${s.thumb}')`;
      menuEl.style.backgroundSize = 'cover';
      menuEl.style.backgroundPosition = 'center';

      // C. Reproducir previsualización (usando el buffer cargado)
      if (musicBuffers[s.id]) { // Verificar que el buffer esté cargado
        previewAudio = new THREE.Audio(listener);
        previewAudio.setBuffer(musicBuffers[s.id]);
        previewAudio.setLoop(true); // Se reproduce en bucle
        previewAudio.setVolume(0.7);
        previewAudio.play(0.8); // Iniciar la reproducción desde el segundo 0.8
      }

      // D. Mostrar y actualizar dificultades UI
      difficultiesBlock.style.display = 'flex';
      selectedSongTitle.textContent = `${s.name} — ${s.artist}`;
      document.querySelectorAll('.diff-btn').forEach(btn => {
        const diff = btn.dataset.diff;
        btn.querySelector('.stars')?.remove();

        const sp = document.createElement('span');
        sp.className = 'stars';
        sp.textContent = createStarMarkup(s.diffs[diff] || 0);
        btn.appendChild(sp);
        btn.classList.remove('selected');
      });
      // Default select normal
      chosenDiff = 'normal';
      document.querySelector('.diff-btn[data-diff="normal"]')?.classList.add('selected');

      // E. Set start button dataset
      startBtn.dataset.song = s.id;
      startBtn.dataset.diff = chosenDiff;
    });

    songListEl.appendChild(card);
  }

  // ⭐️ INICIALIZACIÓN: SELECCIONAR LA PRIMERA CANCIÓN AL CARGAR ⭐️
  const firstCard = songListEl.querySelector('.song-card');
  if (firstCard) {
    // Simular el clic en la primera tarjeta para inicializar la UI Y el audio
    firstCard.click();
  }
}

/* diff buttons listeners */
document.addEventListener('click', (e) => {
  if (e.target && e.target.matches && e.target.matches('.diff-btn')) {
    const d = e.target.dataset.diff;
    chosenDiff = d;
    document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('selected'));
    e.target.classList.add('selected');
    if (startBtn) startBtn.dataset.diff = chosenDiff;
  }
});

/* start button */
if (startBtn) startBtn.addEventListener('click', () => {
  const sid = startBtn.dataset.song || SONGS[0].id;
  const s = SONGS.find(x => x.id === sid);
  if (!s) return;
  startSong(s.id, startBtn.dataset.diff || 'normal');
});

/* ========== START / PAUSE / RESUME / RESTART / MENU ======== */
function prepareAndStartSong(songId, diff) {
  const s = SONGS.find(x => x.id === songId);
  if (!s) return;

  // set pattern scaling by diff (hard -> denser)
  const density = diff === 'easy' ? 0.8 : diff === 'hard' ? 1.4 : 1.0;
  s.pattern = genPatternForDuration(s.duration, density);

  // countdown then start
  runCountdown(3, () => {
    startSongInternal(s, density); // 👈 ¡ESTE FUE EL CAMBIO CRÍTICO QUE FALTÓ!
  });
}

function startSongInternal(s, density) { // 👈 ACEPTAR EL PARÁMETRO DENSITY
  // clear old notes
  clearNotes();
  stopPreviewAudio();
  // Detener audio de previsualización (agregado de la respuesta anterior)
  // Asegúrate de que stopPreviewAudio() esté definido antes de aquí.
  // stopPreviewAudio(); // Si lo tienes, descoméntalo o añádelo aquí

  // 👈 AJUSTAR VELOCIDAD DE NOTAS BASADA EN LA DIFICULTAD/DENSIDAD
  const currentNoteSpeed = NOTE_SPEED * (1.0 + (density - 1.0) * 0.4);
  s.currentNoteSpeed = currentNoteSpeed;

  // audio
  if (musicAudio) { try { musicAudio.stop(); } catch (e) { } musicAudio = null; }
  if (musicBuffers[s.id]) {
    musicAudio = new THREE.Audio(listener);
    musicAudio.setBuffer(musicBuffers[s.id]);
    musicAudio.setLoop(false);
    musicAudio.setVolume(0.85);
    musicAudio.play();
  } else {
    console.warn('Música no cargada:', s.file);
  }
  // lower ambient
  setAmbientVolume(0.12);

  activeSong = s;
  playing = true; paused = false;
  score = 0; combo = 0; maxCombo = 0;
  pattern = s.pattern.slice();
  patternIdx = 0;
  songStartTime = performance.now() * 0.001;
  if (hudScore) hudScore.textContent = String(score);
  if (hudCombo) hudCombo.textContent = String(combo);
  menuEl.style.display = 'none';
  difficultiesBlock.style.display = 'none';
  resultScreen.style.display = 'none';
  pauseMenu.style.display = 'none';
}

/* public startSong wrapper */
function startSong(songId, diff) { prepareAndStartSong(songId, diff); }

/* run countdown overlay then callback */
function runCountdown(n, cb) {
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

/* pause / resume using controller squeeze*/
function openPauseMenu() {
  if (!playing) return;
  paused = true;
  pauseMenu.style.display = 'block';
  if (musicAudio && musicAudio.isPlaying) musicAudio.pause();
  setAmbientVolume(0.18);

  // ⭐ NUEVO: Ajuste para VR: Reposicionar el menú delante de la cámara
  if (renderer.xr.isPresenting) {
    // Mover y rotar para que aparezca en el espacio virtual (ej. a 1.5 metros de distancia)
    pauseMenu.style.transform = "translate(-50%, -50%)";
  } else {
    // Restaurar la posición para el modo de escritorio (centrado en la pantalla)
    pauseMenu.style.transform = 'translate(-50%, -50%)';
  }
}
function resumeFromPause() {
  if (!playing) return;
  // countdown before resuming
  pauseMenu.style.display = 'none';
  runCountdown(3, () => {
    paused = false;
    if (musicAudio && !musicAudio.isPlaying) musicAudio.play();
    setAmbientVolume(0.12);
  });
  // ⭐ Restauramos la posición solo a centrado 2D
  pauseMenu.style.transform = 'translate(-50%, -50%)'; 
}
function resetToMenu() {
  clearNotes();
  stopPreviewAudio();
  if (musicAudio) { try { musicAudio.stop(); } catch (e) { } musicAudio = null; }
  setAmbientVolume(0.4);
  playing = false; paused = false; activeSong = null;
  menuEl.style.display = 'block';
  pauseMenu.style.display = 'none';
  resultScreen.style.display = 'none';
  score = 0; combo = 0; maxCombo = 0;
  if (hudScore) hudScore.textContent = '0';
  if (hudCombo) hudCombo.textContent = '0';
  // ⭐ Restaurar a centrado 2D
  pauseMenu.style.transform = 'translate(-50%, -50%)';
  resultScreen.style.transform = 'translate(-50%, -50%)';
}
function restartSong() {
  if (!activeSong) return;
  // start again with same pattern/difficulty (we regenerate)
  prepareAndStartSong(activeSong.id, chosenDiff);
}

/* UI pause buttons */
if (resumeBtn) resumeBtn.addEventListener('click', () => resumeFromPause());
if (restartBtn) restartBtn.addEventListener('click', () => restartSong());
if (backMenuBtn) backMenuBtn.addEventListener('click', () => resetToMenu());
if (resultRestartBtn) resultRestartBtn.addEventListener('click', () => { restartSong(); resultScreen.style.display = 'none'; });
if (resultMenuBtn) resultMenuBtn.addEventListener('click', () => { resetToMenu(); resultScreen.style.display = 'none'; });

/* controller squeeze to pause/resume */
controllerLeft.addEventListener('squeezestart', () => {
  if (!playing) return;
  if (paused) resumeFromPause(); else openPauseMenu();
});
controllerRight.addEventListener('squeezestart', () => {
  if (!playing) return;
  if (paused) resumeFromPause(); else openPauseMenu();
});

/* ========== HIT / COLLISIONS ========== */
/* We'll check distance from note to the world position of each saber tip.
   Hit effect spawns at the hand position (user requested). */
function checkHits() {
  const DIST_THRESHOLD = 0.95;
  const tipL = new THREE.Vector3(); saberTipL.getWorldPosition(tipL);
  const tipR = new THREE.Vector3(); saberTipR.getWorldPosition(tipR);

  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    if (n.userData.hit) continue;
    const notePos = new THREE.Vector3(); n.getWorldPosition(notePos);
    // approximate z timing
    const dz = Math.abs(n.position.z - NOTE_HIT_ZONE_Z);
    const zt = dz / NOTE_SPEED;
    const dL = tipL.distanceTo(notePos);
    const dR = tipR.distanceTo(notePos);
    if (zt <= 0.5 && (dL < DIST_THRESHOLD || dR < DIST_THRESHOLD)) {
      // hit: spawn hit effect at the hand used
      const usedPos = dL < dR ? tipL : tipR;
      spawnHitEffect(usedPos);
      playSfx(chimeBuffer, 0.35);

      // scoring better if closer to center (zt small)
      const add = Math.max(50, Math.floor((0.5 - zt) * 200));
      score += add;
      combo += 1;
      if (combo > maxCombo) maxCombo = combo;
      if (hudScore) hudScore.textContent = String(score);
      if (hudCombo) hudCombo.textContent = String(combo);

      // remove note
      removeNoteAtIndex(i);
    }
  }
}

/* spawn hit effect at world position (hand) */
function spawnHitEffectAt(pos) {
  const g = new THREE.SphereGeometry(0.16, 8, 8);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xfff2c8 }));
  m.position.copy(pos);
  scene.add(m);
  setTimeout(() => { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }, 220);
}
function spawnHitEffect(handWorldPos) { spawnHitEffectAt(handWorldPos); }

/* ========== UPDATE LOOP: spawn by pattern, move notes, handle misses ========== */
const clock = new THREE.Clock();

function clearNotes() {
  for (let i = notes.length - 1; i >= 0; i--) removeNoteAtIndex(i);
  activeZCounts.clear();
}

function update(dt) {
  if (!playing || paused) return;

  const now = performance.now() * 0.001 - songStartTime;
  // OBTENER LA VELOCIDAD DE LA CANCIÓN ACTIVA (o usar la predeterminada si no está definida)
  const speed = activeSong?.currentNoteSpeed || NOTE_SPEED; // 👈 USAR LA VELOCIDAD CALCULADA

  // spawn from pattern by timing: spawn when pattern time <= now + timeToTravel (abs(NOTE_SPAWN_Z)/speed)
  const timeToTravel = Math.abs(NOTE_SPAWN_Z) / speed; // USAR LA NUEVA VELOCIDAD
  while (patternIdx < pattern.length && pattern[patternIdx].t <= now + timeToTravel) {
    const p = pattern[patternIdx];
    // spawn note at p.lane
    spawnNoteAtLane(p.lane);
    patternIdx++;
  }

  // Aplicar restricción de movimiento al jugador (usando la cámara para simplificar)
  const maxDist = WORLD_RADIUS - PLAYER_RADIUS;
  const currentDist = Math.sqrt(camera.position.x ** 2 + camera.position.z ** 2);

  if (currentDist > maxDist) {
    // Escalar la posición para que no exceda el límite
    const ratio = maxDist / currentDist;
    camera.position.x *= ratio;
    camera.position.z *= ratio;
    // Opcional: También podrías mover el grupo `playerGroup` si existe.
  }

  // move notes: increase z towards player
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    n.position.z += speed * dt;
    // if passes despawn -> miss
    if (n.position.z > NOTE_DESPAWN_Z) {
      playSfx(windBuffer, 0.25);
      removeNoteAtIndex(i);
      combo = 0;
      if (hudCombo) hudCombo.textContent = String(combo);
    }
  }

  // check hits
  checkHits(now);

  // check end: when song duration passed and no notes
  const songDuration = (activeSong && activeSong.pattern) ? (activeSong.pattern[activeSong.pattern.length - 1]?.t + 4.0) : (activeSong?.duration || 60);
  /*
  if (now > songDuration && notes.length === 0) {
    playing = false;
    if (musicAudio) { try { musicAudio.stop(); } catch (e) { } musicAudio = null; }
    setAmbientVolume(0.4);
    // show results
    finalScoreEl.textContent = String(score);
    finalComboEl.textContent = String(maxCombo);
    resultScreen.style.display = 'block';
  }
  */
  if (now > songDuration && notes.length === 0) {
    playing = false;
    if (musicAudio) { try { musicAudio.stop(); } catch (e) { } musicAudio = null; }
    setAmbientVolume(0.4);
    // show results
    finalScoreEl.textContent = String(score);
    finalComboEl.textContent = String(maxCombo);
    resultScreen.style.display = 'block';

    // ⭐ NUEVO: Ajuste para VR: Reposicionar la pantalla de resultados
    if (renderer.xr.isPresenting) {
      resultScreen.style.transform = 'translate(-50%, -50%) translate3d(0, 0, -1.5m)';
    } else {
        // Aseguramos que solo esté centrado en 2D
        resultScreen.style.transform = 'translate(-50%, -50%)';
    }
  }


}

/* ========== RENDER LOOP ========= */
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);

  // center sky and starfields (if any) on player
  const p = player.position;
  // reposition moon/light if you have it
  // render bg then main scene
  renderer.clear();
  bgCam.projectionMatrix.copy(camera.projectionMatrix);
  bgCam.matrixWorld.copy(camera.matrixWorld);
  bgCam.matrixWorldInverse.copy(camera.matrixWorldInverse);
  renderer.render(bgScene, bgCam);
  renderer.render(scene, camera);
});

/* ========== RESIZE ========= */
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ========== UI BUILD & INITIALIZATION ========== */
buildSongList();

/* autoplay ambient if allowed */
try {
  if (ambientEl) {
    ambientEl.volume = 0.4;
    ambientEl.play().catch(() => { /* blocked until user interacts */ });
  }
} catch (e) { }

/* buttons for start / difficulty handled in buildSongList; startBtn listener sets the song to start */
if (startBtn) {
  startBtn.addEventListener('click', () => {
    const sid = startBtn.dataset.song || SONGS[0].id;
    const diff = startBtn.dataset.diff || 'normal';
    // ensure chosen diff is used; if none selected choose normal
    startSong(sid, diff);
  });
}

/* Small helper to update startBtn dataset when difficulty buttons clicked (already wired earlier) */
document.querySelectorAll('.diff-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    const diff = btn.dataset.diff;
    startBtn.dataset.diff = diff;
  });
});


// Esperar DOM

document.getElementById("menu").style.display = "none";
document.getElementById("introOverlay").style.display = "flex";

window.addEventListener('DOMContentLoaded', () => {
  const introOverlay = document.getElementById('introOverlay');
  const btnStart = document.getElementById('btnStartGame');

  btnStart.addEventListener('click', () => {
    // ocultar overlay
    introOverlay.style.display = 'none';

    // ahora podemos mostrar menu o inicializar juego
    const menu = document.getElementById('menu');
    menu.style.display = 'flex';  // o block, según tu diseño

    // Opcional: si quieres entrar en fullscreen cuando empieza
    // document.documentElement.requestFullscreen()?.catch(e => console.warn("Fullscreen no permitido:", e));

    // Opcional: si quieres que Three.js / VR se inicie aquí en vez de antes
    initGame();  // tu función que inicia escena / render / lógica
  });
});
/* End of file
 - Ajustes finos: MIN_Z_SEPARATION, NOTE_SPEED y NOTE_SPAWN_Z para calibrar ritmo.
 - Para mapas reales sustituye genPatternForDuration por importación de .json beatmaps.
 */
