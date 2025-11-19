// main_beatsaber.js
// Versión modificada para un mini-juego tipo "Beat Saber" sobre la base de main4.js
// --------------------------------------------------------
// Instrucciones rápidas:
// - Reemplace la inclusión de main4.js por este archivo en index4.html
// - Asegúrese de tener /assets/audio/ con las 3 canciones (o cambie las rutas en el array `SONGS`)
// - Agregue los assets (texturas/hdri) en la carpeta assets como en el proyecto original
// - index4.html debe contener elementos DOM: #menu, #songList, #startBtn, #score, #combo
// --------------------------------------------------------

import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

// ========== CONFIG ==========
const WORLD_SIZE = 260; // usado para entorno, límites
const PLAYER_RADIUS = 0.35;
const WORLD_RADIUS = WORLD_SIZE * 0.5 - 1.0;
const HDRI_LOCAL = 'assets/hdr/evening_museum_courtyard_4k.hdr';
const HDRI_FALLBACK = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/moon_lab_4k.hdr';

// Gameplay
const NOTE_SPEED = 14.0; // velocidad a la que vienen los cubos (unidades por segundo)
const NOTE_SPAWN_Z = -45; // distancia inicial de spawn (negativa hacia el jugador en la dirección -z)
const NOTE_HIT_ZONE_Z = -1.8; // zona donde el jugador debe golpear (en relación al player)
const NOTE_DESPAWN_Z = 6.0; // z en que se elimina la nota si pasa
const NOTE_SIZE = 0.6; // tamaño de los cubos
const SONGS = [
  { id: 'song_a', name: 'Pollo mago (demo)', file: 'assets/audio/songs/pollo_mago.mp3', pattern: null },
  { id: 'song_b', name: 'Capibara mistica (demo)', file: 'assets/audio/songs/capibara_mistica.mp3', pattern: null },
  { id: 'song_c', name: 'Song C (demo)', file: 'assets/audio/songs/pollo_mago.mp3', pattern: null }
];

// Zona para elementos DOM
const hudScore = document.getElementById('score');
const hudCombo = document.getElementById('combo');
const menuEl = document.getElementById('menu');
const songListEl = document.getElementById('songList');
const startBtn = document.getElementById('startBtn');

// ========== RENDERER / SCENE / CAMERA ==========
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.xr.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x06101a);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 500);
const player = new THREE.Group();
player.position.set(0, 1.6, 0);
player.add(camera);
scene.add(player);

// small background scene (stars/sky)
const bgScene = new THREE.Scene();
const bgCam = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.1, 5000);

// PMREM for IBL
const pmremGen = new THREE.PMREMGenerator(renderer);
pmremGen.compileEquirectangularShader();
async function setHDRI(url){
  try{
    const hdr = await new Promise((res,rej)=> new RGBELoader().load(url, (t)=>res(t), undefined, rej));
    const env = pmremGen.fromEquirectangular(hdr).texture;
    scene.environment = env; hdr.dispose(); pmremGen.dispose();
  }catch(e){ console.warn('No HDRI', e); }
}
setHDRI(HDRI_LOCAL).catch(()=>setHDRI(HDRI_FALLBACK));

// hemisphere light + moon directional
const hemiLight = new THREE.HemisphereLight(0x8fb2ff, 0x0a0c10, 0.35); scene.add(hemiLight);
const moonLight = new THREE.DirectionalLight(0xcfe2ff, 1.0); moonLight.position.set(30,50,10); scene.add(moonLight);

// ground (textured) - minimal placeholder
const groundMat = new THREE.MeshStandardMaterial({ color: 0x2f2a20, roughness:1 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 8,8), groundMat);
ground.rotation.x = -Math.PI/2; ground.position.y = 0; ground.receiveShadow = true; scene.add(ground);

// sky dome (simple)
const skyGeo = new THREE.SphereGeometry(2000, 32, 16);
const skyMat = new THREE.MeshBasicMaterial({ color: 0x050a12, side: THREE.BackSide });
const sky = new THREE.Mesh(skyGeo, skyMat); bgScene.add(sky);

// ========== AUDIO ==========
const listener = new THREE.AudioListener(); camera.add(listener);
const audioLoader = new THREE.AudioLoader();
let hitBuffer = null; let missBuffer = null; let musicAudio = null;

audioLoader.load('assets/audio/effects/hit.wav', (b)=> hitBuffer = b);
audioLoader.load('assets/audio/effects/miss.wav', (b)=> missBuffer = b);

function playSfx(buffer, vol=0.9){ if(!buffer) return; const s = new THREE.Audio(listener); s.setBuffer(buffer); s.setVolume(vol); s.setLoop(false); s.play(); }

// ========== VR CONTROLLERS / SABERS ==========
const vrBtn = VRButton.createButton(renderer); vrBtn.classList.add('vr-button'); document.body.appendChild(vrBtn);
const controllerLeft = renderer.xr.getController(0); const controllerRight = renderer.xr.getController(1);
scene.add(controllerLeft, controllerRight);
const controllerModelFactory = new XRControllerModelFactory();
const grip0 = renderer.xr.getControllerGrip(0); grip0.add(controllerModelFactory.createControllerModel(grip0)); scene.add(grip0);
const grip1 = renderer.xr.getControllerGrip(1); grip1.add(controllerModelFactory.createControllerModel(grip1)); scene.add(grip1);

// Create simple saber meshes (thin cylinders) and attach to controllers
function makeSaberMesh(){
  const geo = new THREE.CylinderGeometry(0.03, 0.03, 0.9, 8);
  const mat = new THREE.MeshStandardMaterial({ emissive: 0x44ccff, emissiveIntensity: 1.2, metalness: 0.1, roughness: 0.6 });
  const m = new THREE.Mesh(geo, mat); m.rotation.x = Math.PI/2; m.position.set(0, -0.45, 0); m.castShadow = false; m.receiveShadow = false; return m;
}
const saberL = makeSaberMesh(); controllerLeft.add(saberL); saberL.visible = true;
const saberR = makeSaberMesh(); controllerRight.add(saberR); saberR.visible = true;

// collider helper for sabers (simple sphere at the tip)
const saberTipL = new THREE.Object3D(); saberTipL.position.set(0, -0.9, 0); controllerLeft.add(saberTipL);
const saberTipR = new THREE.Object3D(); saberTipR.position.set(0, -0.9, 0); controllerRight.add(saberTipR);

// ========== NOTES (CUBES) ==========
const notes = []; // array of {mesh, lane, time, hit}
const noteLanes = [-1.8, -0.6, 0.6, 1.8]; // x positions of lanes (4 lanes like Beat Saber)

function makeNoteMesh(color=0xff4444){
  const geo = new THREE.BoxGeometry(NOTE_SIZE, NOTE_SIZE, NOTE_SIZE);
  const mat = new THREE.MeshStandardMaterial({ color, roughness:0.5, metalness:0.0, emissive: color, emissiveIntensity: 0.2 });
  const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = false; return m;
}

// Simple generator: pattern is array of {t: seconds since song start, lane: 0..3}
function generatePatternForSong(duration=30){
  const pat = [];
  let t = 1.2;
  while(t < duration - 1){
    const lane = Math.floor(Math.random()*noteLanes.length);
    pat.push({ t: t, lane });
    t += 0.45 + Math.random()*0.6; // spacing
  }
  return pat;
}

// spawn logic: spawn note at NOTE_SPAWN_Z but relative to player-forward direction
function spawnNote(laneIndex){
  const x = noteLanes[laneIndex];
  const z = NOTE_SPAWN_Z + (Math.random()-0.5)*2; // slight jitter
  const m = makeNoteMesh( new THREE.Color().setHSL(Math.random(), 0.9, 0.5).getHex() );
  m.position.set(x, 1.2, z);
  m.userData = { lane: laneIndex, hit: false };
  scene.add(m);
  notes.push(m);
  return m;
}

// ========== GAME STATE ==========
let activeSong = null;
let songStartTime = 0;
let playing = false;
let score = 0;
let combo = 0;
let pattern = [];
let patternIdx = 0;

// preload music and patterns
const musicBuffers = {};
for (const s of SONGS){
  audioLoader.load(s.file, (buf)=>{ musicBuffers[s.id] = buf; });
  // generate placeholder patterns for each song (will be replaced with manual patterns if provided)
  s.pattern = generatePatternForSong(60);
}

function startSong(songId){
  // find song object
  const s = SONGS.find(x=>x.id===songId);
  if(!s) return;
  activeSong = s;
  // setup audio
  if(musicAudio){ musicAudio.stop(); musicAudio = null; }
  if(musicBuffers[s.id]){
    musicAudio = new THREE.Audio(listener); musicAudio.setBuffer(musicBuffers[s.id]); musicAudio.setLoop(false); musicAudio.setVolume(0.7); musicAudio.play();
  } else {
    console.warn('Archivo de audio no cargado aún:', s.file);
  }
  // reset state
  score = 0; combo = 0; pattern = s.pattern.slice(); patternIdx = 0; songStartTime = performance.now()*0.001; playing = true;
  if(hudScore) hudScore.textContent = String(score);
  if(hudCombo) hudCombo.textContent = String(combo);
  menuEl.style.display = 'none';
}

// ========== COLLISION / HIT LOGIC ==========
// simple distance check between saber tip world position and note bounding box center
function checkHits(now){
  const hitWindow = 0.35; // seconds allowed around the note time
  for (let i = notes.length-1; i >= 0; i--){
    const n = notes[i];
    if (n.userData.hit) continue;
    // note time approx (we compute from z position instead of exact time)
    const noteZ = n.position.z;

    // z of hit zone relative to player: player at z=0, notes move positive z (towards player) in our system
    const dz = Math.abs(noteZ - NOTE_HIT_ZONE_Z);
    // distance threshold in z -> map to time threshold
    const zToTime = dz / NOTE_SPEED;
    // check both saber tips
    const tipWorldL = new THREE.Vector3(); saberTipL.getWorldPosition(tipWorldL);
    const tipWorldR = new THREE.Vector3(); saberTipR.getWorldPosition(tipWorldR);
    const noteWorld = new THREE.Vector3(); n.getWorldPosition(noteWorld);
    const dL = tipWorldL.distanceTo(noteWorld);
    const dR = tipWorldR.distanceTo(noteWorld);
    const DIST_THRESHOLD = 0.9; // how close saber tip must be

    if (zToTime <= 0.5 && (dL < DIST_THRESHOLD || dR < DIST_THRESHOLD)){
      // hit!
      n.userData.hit = true;
      // visual feedback
      spawnHitEffect(noteWorld);
      playSfx(hitBuffer, 1.0);
      scene.remove(n);
      notes.splice(i,1);

      // scoring (simple): better score for closer to hit zone
      const scoreAdd = Math.max(50, Math.floor((0.5 - zToTime) * 200));
      score += scoreAdd; combo += 1;
      if(hudScore) hudScore.textContent = String(score);
      if(hudCombo) hudCombo.textContent = String(combo);
    }
  }
}

function spawnHitEffect(pos){
  // small particle: for simplicity spawn a brief sphere that fades
  const g = new THREE.SphereGeometry(0.2,6,6);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffaa }));
  m.position.copy(pos);
  scene.add(m);
  setTimeout(()=>{ scene.remove(m); m.geometry.dispose(); m.material.dispose(); }, 220);
}

// ========== UPDATE / SPAWN BY PATTERN ==========
const clock = new THREE.Clock();
function update(dt){
  if (playing){
    const now = performance.now()*0.001 - songStartTime; // seconds since song started
    // spawn notes from pattern when their time is close to being visible
    while (patternIdx < pattern.length && pattern[patternIdx].t <= now + Math.abs(NOTE_SPAWN_Z)/NOTE_SPEED){
      const p = pattern[patternIdx]; spawnNote(p.lane); patternIdx++;
    }

    // move notes towards player (increase z)
    for (let i = notes.length-1; i >= 0; i--){
      const n = notes[i];
      n.position.z += NOTE_SPEED * dt;
      // if passes despawn z -> miss
      if (n.position.z > NOTE_DESPAWN_Z){
        // missed
        scene.remove(n); notes.splice(i,1);
        playSfx(missBuffer, 0.7);
        combo = 0; if(hudCombo) hudCombo.textContent = String(combo);
      }
    }

    // detect hits
    checkHits(now);

    // end condition: when song finishes and no notes left
    const songDuration = (activeSong && activeSong.pattern) ? (activeSong.pattern[activeSong.pattern.length-1]?.t + 4.0) : 60;
    if (now > songDuration && notes.length === 0){
      playing = false; menuEl.style.display = 'block';
      if (musicAudio) { musicAudio.stop(); musicAudio = null; }
      alert(`Fin de la canción! Score: ${score}`);
    }
  }
}

// ========== UI: menú simple ==========
function buildMenu(){
  if (!songListEl) return;
  songListEl.innerHTML = '';
  for (const s of SONGS){
    const btn = document.createElement('button'); btn.textContent = s.name; btn.className = 'songBtn';
    btn.addEventListener('click', ()=>{ document.querySelectorAll('.songBtn').forEach(x=>x.classList.remove('sel')); btn.classList.add('sel'); startBtn.dataset.song = s.id; });
    songListEl.appendChild(btn);
  }
}

if (startBtn){ startBtn.addEventListener('click', ()=>{ const id = startBtn.dataset.song || SONGS[0].id; startSong(id); }); }
buildMenu();

// ========== RENDER LOOP ==========
renderer.setAnimationLoop(()=>{
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);

  // keep bg centered on player
  const p = player.position; sky.position.copy(p);

  renderer.clear();
  bgCam.projectionMatrix.copy(camera.projectionMatrix);
  bgCam.matrixWorld.copy(camera.matrixWorld);
  bgCam.matrixWorldInverse.copy(camera.matrixWorldInverse);
  renderer.render(bgScene, bgCam);
  renderer.render(scene, camera);
});

// ========== RESIZE ==========
addEventListener('resize', ()=>{ camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ========== NOTAS y TIPS ===========
// - Este archivo es una versión enfocada al gameplay: cubos (notes), detección simple de colisiones con el tip
//   de las mandos (saber tips) y un menú DOM muy básico con 3 canciones.
// - Para mejorar: usar gltf/fbx para cubos con flechas, sincronizar con BPM/beatmap reales (mapas .json),
//   mejorar scoring (precision: perfect/good/miss), animaciones de materiales al golpear, sistema de combo/targets.
// - Para AR (en vez de VR): puede integrarse WebXR AR session (hit-testing, world-anchoring) y posicionar el "track"
//   relativo a un plano detectado por AR. El flujo básico de notas y detección del tip se mantiene.
// - Comentarios inline explican los bloques principales.

