// main_beatsaber.js
// Juego tipo Beat-Saber (VR) - versión con pausa, resultados, HDRI fallback,
// sabers más altos, cubos con altura aleatoria, y mezcla de audio ambiente/música.

import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

/* ================== CONFIG ================== */
const WORLD_SIZE = 260;
const WORLD_RADIUS = WORLD_SIZE * 0.5 - 1.0;

const HDRI_LOCAL = 'assets/hdr/evening_museum_courtyard_4k.hdr';
const HDRI_FALLBACK = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/evening_museum_courtyard_4k.hdr';

const NOTE_SPEED = 14.0;
const NOTE_SPAWN_Z = -45;
const NOTE_HIT_ZONE_Z = -1.8;
const NOTE_DESPAWN_Z = 6.0;
const NOTE_SIZE = 0.6;
const noteLanes = [-1.8, -0.6, 0.6, 1.8];

/* Songs: reemplaza rutas si necesitas */
const SONGS = [
  { id: 'song_a', name: 'pollo_mago (demo)', file: 'assets/audio/song/pollo_mago.mp3', pattern: null, duration: 60 },
  { id: 'song_b', name: 'capibara_mistica (demo)', file: 'assets/audio/song/capibara_mistica.mp3', pattern: null, duration: 45 },
  { id: 'song_c', name: 'capibara_candidata (demo)', file: 'assets/audio/song/capibara_candidata.mp3', pattern: null, duration: 50 }
];

/* DOM */
const hudScore = document.getElementById('score');
const hudCombo = document.getElementById('combo');
const menuEl = document.getElementById('menu');
const songListEl = document.getElementById('songList');
const startBtn = document.getElementById('startBtn');

const pauseMenu = document.getElementById('pauseMenu');
const resumeBtn = document.getElementById('resumeBtn');
const restartBtn = document.getElementById('restartBtn');
const backMenuBtn = document.getElementById('backMenuBtn');

const resultScreen = document.getElementById('resultScreen');
const finalScoreEl = document.getElementById('finalScore');
const finalComboEl = document.getElementById('finalCombo');
const resultRestartBtn = document.getElementById('resultRestartBtn');
const resultMenuBtn = document.getElementById('resultMenuBtn');

const ambientEl = document.getElementById('ambient');

/* RENDERER / SCENE / CAMERA */
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
const bgCam = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.1, 5000);

const camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.1, 500);
const player = new THREE.Group();
player.position.set(0, 1.6, 0);
player.add(camera);
scene.add(player);

/* PMREM / HDRI con fallback y logs */
const pmremGen = new THREE.PMREMGenerator(renderer);
pmremGen.compileEquirectangularShader();

async function setHDRI(url) {
  try {
    const tex = await new Promise((res, rej) => new RGBELoader().load(url, t => res(t), undefined, rej));
    const env = pmremGen.fromEquirectangular(tex).texture;
    scene.environment = env;
    tex.dispose();
    pmremGen.dispose();
    console.log('HDRI cargado:', url);
  } catch (e) {
    console.warn('No se pudo cargar HDRI:', url, e);
    throw e;
  }
}
(async ()=> {
  try { await setHDRI(HDRI_LOCAL); }
  catch(e) { 
    try { await setHDRI(HDRI_FALLBACK); }
    catch(e2){ console.warn('No se cargó ningún HDRI. Continuando sin IBL.'); }
  }
})();

/* LUCES */
const hemiLight = new THREE.HemisphereLight(0x8fb2ff, 0x0a0c10, 0.35);
scene.add(hemiLight);
const moonLight = new THREE.DirectionalLight(0xcfe2ff, 1.0);
moonLight.position.set(30, 50, 10);
scene.add(moonLight);

/* GROUND simple */
const groundMat = new THREE.MeshStandardMaterial({ color: 0x2f2a20, roughness: 1 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 8, 8), groundMat);
ground.rotation.x = -Math.PI/2; ground.position.y = 0; ground.receiveShadow = true; scene.add(ground);

/* SKY (bg) */
const skyGeo = new THREE.SphereGeometry(2000, 32, 16);
const skyMat = new THREE.MeshBasicMaterial({ color: 0x050a12, side: THREE.BackSide });
const sky = new THREE.Mesh(skyGeo, skyMat); bgScene.add(sky);

/* AUDIO */
const listener = new THREE.AudioListener(); camera.add(listener);
const audioLoader = new THREE.AudioLoader();
let hitBuffer = null, missBuffer = null;
let musicAudio = null;
let musicBuffers = {};

audioLoader.load('assets/audio/effects/hit.wav', b => hitBuffer = b, undefined, e => console.warn('hit.wav failed', e));
audioLoader.load('assets/audio/effects/miss.wav', b => missBuffer = b, undefined, e => console.warn('miss.wav failed', e));
for (const s of SONGS) {
  audioLoader.load(s.file, (b) => { musicBuffers[s.id] = b; }, undefined, (err)=> console.warn('Song failed to load:', s.file, err));
}

/* controla volumen ambiente cuando suena música */
function setAmbientVolume(v){
  try { if (ambientEl) ambientEl.volume = v; } catch(e){ /* algunos navegadores bloquean si no hay interacción */ }
}

/* sfx simple */
function playSfx(buffer, vol=1.0){
  if (!buffer) return;
  const s = new THREE.Audio(listener);
  s.setBuffer(buffer);
  s.setVolume(vol);
  s.setLoop(false);
  s.play();
}

/* VR BUTTON + CONTROLLERS */
const vrBtn = VRButton.createButton(renderer); vrBtn.classList.add('vr-button'); document.body.appendChild(vrBtn);

const controllerLeft = renderer.xr.getController(0);
const controllerRight = renderer.xr.getController(1);
scene.add(controllerLeft, controllerRight);

const controllerModelFactory = new XRControllerModelFactory();
const grip0 = renderer.xr.getControllerGrip(0);
grip0.add(controllerModelFactory.createControllerModel(grip0));
scene.add(grip0);
const grip1 = renderer.xr.getControllerGrip(1);
grip1.add(controllerModelFactory.createControllerModel(grip1));
scene.add(grip1);

/* SABERS (elevarlos un poco más para que no estén tan abajo) */
function makeSaberMesh(){ 
  const geo = new THREE.CylinderGeometry(0.03, 0.03, 0.9, 8);
  const mat = new THREE.MeshStandardMaterial({ emissive: 0x44ccff, emissiveIntensity: 1.2, metalness: 0.1, roughness: 0.6 });
  const mesh = new THREE.Mesh(geo, mat);
  // rotamos para que el cilindro apunte hacia adelante desde la mano
  mesh.rotation.x = Math.PI/2;
  // posición: lo colocamos más arriba (ajuste pedido)
  mesh.position.set(0, -0.25, 0); // <- antes era -0.45; menos negativo = más arriba
  mesh.castShadow = false;
  return mesh;
}

const saberL = makeSaberMesh(); controllerLeft.add(saberL);
const saberR = makeSaberMesh(); controllerRight.add(saberR);

/* Saber tips para detectar colisiones: colocados cerca del extremo */
const saberTipL = new THREE.Object3D(); saberTipL.position.set(0, -0.7, 0); controllerLeft.add(saberTipL);
const saberTipR = new THREE.Object3D(); saberTipR.position.set(0, -0.7, 0); controllerRight.add(saberTipR);

/* NOTAS (CUBOS) */
const notes = [];

function makeNoteMesh(colorHex = 0xff4444){
  const geo = new THREE.BoxGeometry(NOTE_SIZE, NOTE_SIZE, NOTE_SIZE);
  const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.5, metalness: 0.0, emissive: colorHex, emissiveIntensity: 0.2 });
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = false;
  return m;
}

/* PATTERN: placeholder generator (mejor reemplazar por map real) */
function generatePattern(durationSec = 60){
  const pat = [];
  let t = 1.2;
  while (t < durationSec - 1){
    const lane = Math.floor(Math.random() * noteLanes.length);
    pat.push({ t: t, lane });
    t += 0.45 + Math.random() * 0.6;
  }
  return pat;
}

/* Spawn: ahora la altura Y es aleatoria (punto 4) */
function spawnNote(laneIndex){
  const x = noteLanes[laneIndex];
  const z = NOTE_SPAWN_Z + (Math.random() - 0.5) * 2;
  const m = makeNoteMesh(new THREE.Color().setHSL(Math.random(), 0.9, 0.5).getHex());
  // altura aleatoria entre 0.9 y 2.0 (puedes ajustar)
  const y = 0.9 + Math.random() * 1.1;
  m.position.set(x, y, z);
  m.userData = { lane: laneIndex, hit: false };
  scene.add(m);
  notes.push(m);
  return m;
}

/* ESTADO DEL JUEGO */
let activeSong = null;
let songStartTime = 0;
let playing = false;
let paused = false;
let score = 0;
let combo = 0;
let maxCombo = 0;
let pattern = [];
let patternIdx = 0;

/* INICIALIZACIÓN patrones */
for (const s of SONGS) {
  s.pattern = generatePattern(s.duration || 60);
}

/* REPRODUCIR CANCIÓN y control de ambiente (punto 6) */
function startSong(songId){
  const s = SONGS.find(x => x.id === songId);
  if (!s) return;
  activeSong = s;

  // stop audio previo
  if (musicAudio) { musicAudio.stop(); musicAudio = null; }

  // crear y reproducir música si cargada
  if (musicBuffers[s.id]) {
    musicAudio = new THREE.Audio(listener);
    musicAudio.setBuffer(musicBuffers[s.id]);
    musicAudio.setLoop(false);
    musicAudio.setVolume(0.85);
    musicAudio.play();
    // bajar volumen de ambiente para que efectos y música sean claros
    setAmbientVolume(0.12);
  } else {
    console.warn('Audio de la canción no cargado aún:', s.file);
  }

  // reset estado
  score = 0; combo = 0; maxCombo = 0;
  pattern = s.pattern.slice();
  patternIdx = 0;
  songStartTime = performance.now() * 0.001;
  playing = true;
  paused = false;

  // actualizar HUD y UI
  if (hudScore) hudScore.textContent = String(score);
  if (hudCombo) hudCombo.textContent = String(combo);
  menuEl.style.display = 'none';
  pauseMenu.style.display = 'none';
  resultScreen.style.display = 'none';
}

/* PAUSA / RESUME (punto 5 con botón del mando) */
function openPauseMenu(){
  if (!playing) return;
  paused = true;
  pauseMenu.style.display = 'block';
  // pausar música y bajar ambiente un poco
  if (musicAudio && musicAudio.isPlaying) musicAudio.pause();
  setAmbientVolume(0.18);
}

function resumeFromPause(){
  paused = false;
  pauseMenu.style.display = 'none';
  if (musicAudio && !musicAudio.isPlaying) musicAudio.play();
  setAmbientVolume(0.12);
}

/* REINICIAR / VOLVER AL MENÚ (punto 2 - reset) */
function clearNotes(){
  for (const n of notes) {
    scene.remove(n);
    if (n.geometry) n.geometry.dispose();
    if (n.material) n.material.dispose();
  }
  notes.length = 0;
}
function resetToMenu(){
  // stop music
  if (musicAudio) { try { musicAudio.stop(); } catch(e){} musicAudio = null; }
  setAmbientVolume(0.4);
  clearNotes();
  playing = false; paused = false;
  menuEl.style.display = 'block';
  pauseMenu.style.display = 'none';
  resultScreen.style.display = 'none';
  score = 0; combo = 0; maxCombo = 0;
  if (hudScore) hudScore.textContent = '0';
  if (hudCombo) hudCombo.textContent = '0';
}

/* REINICIAR LA CANCIÓN ACTIVA */
function restartSong(){
  // stop and clear
  if (musicAudio) { try { musicAudio.stop(); } catch(e){} musicAudio = null; }
  clearNotes();
  if (!activeSong) { resetToMenu(); return; }
  // restart
  startSong(activeSong.id);
}

/* HIT / COLLISIONS: comprobación simple por distancia al tip */
function checkHits(now){
  const DIST_THRESHOLD = 0.9;
  // revisamos notas activas
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    if (n.userData.hit) continue;

    // convertimos posicion del tip y nota al world y medimos distancia
    const tipL = new THREE.Vector3(); saberTipL.getWorldPosition(tipL);
    const tipR = new THREE.Vector3(); saberTipR.getWorldPosition(tipR);
    const notePos = new THREE.Vector3(); n.getWorldPosition(notePos);

    // zona temporal en Z -> aproximado por distancia z respecto al hit zone
    const dz = Math.abs(n.position.z - NOTE_HIT_ZONE_Z);
    const zToTime = dz / NOTE_SPEED; // aproximación a segundos

    const dL = tipL.distanceTo(notePos);
    const dR = tipR.distanceTo(notePos);

    // Si está suficientemente cerca en z (llegando a la zona) y tip cerca -> hit
    if (zToTime <= 0.5 && (dL < DIST_THRESHOLD || dR < DIST_THRESHOLD)) {
      // mark hit
      n.userData.hit = true;
      // efecto visual/sfx
      spawnHitEffect(notePos);
      playSfx(hitBuffer, 1.0);

      // scoring: mejor puntuación si más cerca al centro (zToTime pequeño)
      const add = Math.max(50, Math.floor((0.5 - zToTime) * 200));
      score += add;
      combo += 1;
      if (combo > maxCombo) maxCombo = combo;
      // actualizar HUD
      if (hudScore) hudScore.textContent = String(score);
      if (hudCombo) hudCombo.textContent = String(combo);

      // eliminar nota
      scene.remove(n);
      notes.splice(i, 1);
      // liberar memoria breve
      if (n.geometry) n.geometry.dispose();
      if (n.material) n.material.dispose();
    }
  }
}

/* Hit visual */
function spawnHitEffect(pos){
  const g = new THREE.SphereGeometry(0.22, 6, 6);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffaa }));
  m.position.copy(pos);
  scene.add(m);
  setTimeout(()=>{ scene.remove(m); m.geometry.dispose(); m.material.dispose(); }, 220);
}

/* UPDATE / SPAWNING por pattern */
const clock = new THREE.Clock();

function update(dt){
  if (!playing || paused) return;

  const now = performance.now() * 0.001 - songStartTime;

  // spawn según pattern (timing aproximado por spawn distance)
  while (patternIdx < pattern.length && pattern[patternIdx].t <= now + Math.abs(NOTE_SPAWN_Z) / NOTE_SPEED) {
    const p = pattern[patternIdx];
    spawnNote(p.lane);
    patternIdx++;
  }

  // mover notas hacia el jugador (z aumenta)
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    n.position.z += NOTE_SPEED * dt;

    // si pasa la zona de despawn = miss
    if (n.position.z > NOTE_DESPAWN_Z) {
      // miss
      playSfx(missBuffer, 0.7);
      scene.remove(n);
      if (n.geometry) n.geometry.dispose();
      if (n.material) n.material.dispose();
      notes.splice(i, 1);
      combo = 0;
      if (hudCombo) hudCombo.textContent = String(combo);
    }
  }

  // chequear hits
  checkHits(now);

  // comprobar fin de canción: cuando el tiempo de canción pasó y no quedan notas
  const songDuration = (activeSong && activeSong.pattern) ? (activeSong.pattern[activeSong.pattern.length - 1]?.t + 4.0) : (activeSong?.duration || 60);
  if (now > songDuration && notes.length === 0) {
    // fin de canción
    playing = false;
    // detener música
    if (musicAudio) { try { musicAudio.stop(); } catch(e){} musicAudio = null; }
    setAmbientVolume(0.4);

    // mostrar resultado
    finalScoreEl.textContent = String(score);
    finalComboEl.textContent = String(maxCombo);
    resultScreen.style.display = 'block';
    // actualizar HUD un último
    if (hudScore) hudScore.textContent = String(score);
    if (hudCombo) hudCombo.textContent = String(combo);
  }
}

/* UI: construir lista de canciones */
function buildMenu(){
  if (!songListEl) return;
  songListEl.innerHTML = '';
  for (const s of SONGS) {
    const el = document.createElement('div');
    el.className = 'song-item';
    el.textContent = `${s.name} (${Math.round(s.duration)}s)`;
    el.dataset.song = s.id;
    el.addEventListener('click', () => {
      document.querySelectorAll('.song-item').forEach(x => x.classList.remove('selected'));
      el.classList.add('selected');
      startBtn.dataset.song = s.id;
    });
    songListEl.appendChild(el);
  }
}

/* Event listeners UI (botones) */
if (startBtn) startBtn.addEventListener('click', () => { const id = startBtn.dataset.song || SONGS[0].id; startSong(id); });
if (resumeBtn) resumeBtn.addEventListener('click', () => resumeFromPause());
if (restartBtn) restartBtn.addEventListener('click', () => restartSong());
if (backMenuBtn) backMenuBtn.addEventListener('click', () => { resetToMenu(); });
if (resultRestartBtn) resultRestartBtn.addEventListener('click', () => { restartSong(); resultScreen.style.display = 'none'; });
if (resultMenuBtn) resultMenuBtn.addEventListener('click', () => { resetToMenu(); resultScreen.style.display = 'none'; });

/* DETECCIÓN de botón del mando para PAUSA (punto 5).
   Usamos 'squeezestart' en cualquiera de los controladores para abrir pausa.
*/
controllerLeft.addEventListener('squeezestart', () => {
  if (!playing) return;
  if (paused) resumeFromPause(); else openPauseMenu();
});
controllerRight.addEventListener('squeezestart', () => {
  if (!playing) return;
  if (paused) resumeFromPause(); else openPauseMenu();
});

/* RENDER LOOP */
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);

  // mantener sky centrado
  const p = player.position; sky.position.copy(p);

  renderer.clear();
  bgCam.projectionMatrix.copy(camera.projectionMatrix);
  bgCam.matrixWorld.copy(camera.matrixWorld);
  bgCam.matrixWorldInverse.copy(camera.matrixWorldInverse);
  renderer.render(bgScene, bgCam);
  renderer.render(scene, camera);
});

/* RESIZE */
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* INICIAL */
buildMenu();
/* reproducir audio ambient si se puede; muchos navegadores requieren interacción para play() */
try {
  if (ambientEl) {
    ambientEl.volume = 0.4;
    ambientEl.play().catch(()=>{ /* bloqueo por autoplay */ });
  }
} catch(e){}

/* NOTAS FINALES / SUGERENCIAS
 - Si HDRI sigue sin cargarse en tu entorno local verifica CORS y la ruta (si abres el HTML por file:// puede fallar).
 - Para mapas rítmicos reales hay archivos beatmaps (.json) que definen lane/time/direction; reemplaza generatePattern.
 - Para un feedback visual más rico: agrega trails a los sabers (line renderer o instanced geometry).
 - Si quieres que la pausa se abra con otro botón cambia 'squeezestart' por 'selectstart' u otro evento.
*/
