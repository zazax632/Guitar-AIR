// ============================================================
// 🎸 Virtual Guitar Pro — v11
//
// v11 bug fixes (11 จุดจาก deep audit):
//
//   HIGH-1: static import → dynamic import() ใน try/catch
//           ป้องกัน silent หน้าขาวถ้า CDN 404
//   HIGH-2: vision_bundle.mjs อาจไม่มี → fallback .js
//           ลอง .mjs ก่อน ถ้า fail ลอง .js (UMD dynamic)
//
//   MED-1:  playStrum: ถ้า !audioReady → return ทันที
//           ไม่ ensureAudio() ทุก strum (ป้องกัน Tone.start() loop)
//   MED-2:  stopRecording: disconnect oldMicSource ด้วย
//   MED-3:  ปุ่ม HTML disabled จนกว่า module พร้อม (?.() guard)
//           + retryInit: showCountdown(null), countdownActive=false
//
//   LOW-1:  drawHandSkeleton: ครอบ ctx.save/restore
//   LOW-2:  drawHandIndicator: ใช้ strumIdx map label จริง
//   LOW-3:  openN: ส่งเข้า drawHandLabel แสดงบน badge
//   LOW-4:  MediaRecorder.start(1000) timeslice flush ทุก 1 วิ
//   LOW-5:  chordFromFingers: gate ถ้า gScore<0.3 && gesture=None
//   LOW-6:  retryInit: reset countdownActive + ซ่อน overlay
// ============================================================

// ══════════════════════════════════════════
// HIGH-1+2: Dynamic import พร้อม .mjs/.js fallback
// ══════════════════════════════════════════

let FilesetResolver, GestureRecognizer, ObjectDetector;

const CDN_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";
const WASM_PATH = CDN_BASE + "/wasm";

async function loadMediaPipeModule() {
  // ลอง ESM (.mjs) ก่อน — ถ้า 404 fallback UMD (.js via window)
  try {
    const mod = await import(CDN_BASE + "/vision_bundle.mjs");
    FilesetResolver = mod.FilesetResolver;
    GestureRecognizer = mod.GestureRecognizer;
    ObjectDetector = mod.ObjectDetector;
    console.log("✅ Loaded via ESM .mjs");
  } catch (e) {
    console.warn("ESM .mjs failed, trying UMD .js:", e.message);
    // โหลด UMD script tag แล้วรอ
    await new Promise((res, rej) => {
      if (window.FilesetResolver) { res(); return; }
      const s = document.createElement("script");
      s.src = CDN_BASE + "/vision_bundle.js";
      s.onload = res;
      s.onerror = () => rej(new Error("vision_bundle.js โหลดไม่ได้ — ตรวจสอบ network"));
      document.head.appendChild(s);
    });
    FilesetResolver = window.FilesetResolver;
    GestureRecognizer = window.GestureRecognizer;
    ObjectDetector = window.ObjectDetector;
    if (!FilesetResolver) throw new Error("FilesetResolver ไม่พบแม้หลังโหลด UMD bundle");
    console.log("✅ Loaded via UMD .js fallback");
  }
}

// ══════════════════════════════════════════
// Expose globals (module scope → private, HTML onclick ต้องการ window.X)
// enable ปุ่มเมื่อ module พร้อม — FIX MED-3
// ══════════════════════════════════════════

function enableButtons() {
  ["unlock-btn", "btn-record", "btn-stop-rec"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = false;
  });
}

window.unlockAndDismiss = async function () {
  await ensureAudio().catch(() => { });
  // MED UX FIX: ซ่อน banner เฉพาะเมื่อ audio พร้อมจริง — ถ้า fail banner ยังอยู่ให้ลองใหม่ได้
  if (audioReady) {
    document.getElementById("audio-unlock-banner").style.display = "none";
  }
};
window.startRecording = startRecording;
window.stopRecording = stopRecording;
window.retryInit = retryInit;

// ══════════════════════════════════════════
// 🔊 AUDIO ENGINE (rebuilt)
// ══════════════════════════════════════════
// ใช้ PolySynth (เสถียร 100% ใน Tone.js v14) แทน PluckSynth ที่ API เปลี่ยนตามเวอร์ชัน
// PolySynth รองรับ polyphonic จริง → ดีด chord หลาย note พร้อมกันได้

let audioReady = false;
let audioInitDone = false;
let audioInitializing = false; // MED FIX: lock ป้องกัน concurrent initAudio race
let guitarSynth = null;
let pickSynth = null;
let reverb = null;
let chorus = null;
let analyser = null; // For the waveform visualization
let masterVol = null;

// Rock Mode Effects
let overdrive = null;
let distortion = null;
let delay = null;
let isRockMode = false;
let themeColor = "#00ffcc";

async function ensureAudio() {
  if (audioReady) return;
  // MED FIX: ถ้า call แรกกำลัง await reverb.generate() อยู่ → รอแทนการ skip
  // ป้องกัน: call2 เห็น audioInitDone=true → skip initAudio → audioReady=true แต่ guitarSynth=null
  if (audioInitializing) {
    await new Promise(res => {
      const t = setInterval(() => { if (!audioInitializing) { clearInterval(t); res(); } }, 100);
    });
    if (audioReady) return;
  }
  try {
    await Tone.start();
    if (!audioInitDone) {
      audioInitializing = true;
      try { await initAudio(); } finally { audioInitializing = false; }
    }
    audioReady = true;
    console.log("✅ ensureAudio: ready");
  } catch (e) {
    audioInitializing = false;
    showError("❌ Audio: " + e.message);
    throw e;
  }
}

async function initAudio() {
  try {
    audioInitDone = true;

    // FX Chain: Synth -> Chorus -> MasterVol -> Reverb -> Destination
    reverb = new Tone.Reverb({ decay: 1.5, wet: 0.25 });
    await reverb.generate();
    reverb.toDestination();

    chorus = new Tone.Chorus(4, 2.5, 0.5).connect(reverb).start();
    analyser = new Tone.Analyser("waveform", 256);

    // Amp Chain Setup
    overdrive = new Tone.Overdrive(0.5).connect(chorus);
    distortion = new Tone.Distortion(0.4).connect(overdrive);
    delay = new Tone.FeedbackDelay("8n", 0.4).connect(distortion);

    // Master routing
    masterVol = new Tone.Volume(-2).connect(analyser);
    chorus.connect(masterVol); // Final output stage

    // Initial mute/bypass for rock effects
    overdrive.wet.value = 0;
    distortion.wet.value = 0;
    delay.wet.value = 0;

    // Realistic Guitar Synthesis
    // Using FMTriangle for a more complex, string-like harmonic structure
    guitarSynth = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 2,
      modulationIndex: 3,
      oscillator: { type: "fmtriangle" },
      envelope: {
        attack: 0.005,
        decay: 1.2,
        sustain: 0.05,
        release: 1.5
      },
      modulation: { type: "square" },
      modulationEnvelope: {
        attack: 0.002,
        decay: 0.3,
        sustain: 0,
        release: 0.1
      },
      volume: -4
    }).connect(delay); // Connect to start of Amp Chain

    // Add a Pick Synth for that 'click' sound when plucking
    pickSynth = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: {
        attack: 0.001,
        decay: 0.03,
        sustain: 0
      },
      volume: -18
    }).connect(masterVol);

    guitarSynth.maxPolyphony = 24;

    console.log("✅ initAudio: guitarSynth + reverb ready");
    setStatus("READY. PRESS 'START SESSION' & SHOW 🖐️");
  } catch (e) {
    audioInitDone = false;
    guitarSynth = null;
    showError("❌ Audio init: " + e.message);
    throw e;
  }
}

// ══════════════════════════════════════════
// ⚡ AMP MODE CONTROLS
// ══════════════════════════════════════════

window.toggleAmpMode = function () {
  isRockMode = !isRockMode;
  const btn = document.getElementById("btn-amp");

  if (isRockMode) {
    // ROCK MODE
    overdrive.wet.rampTo(1, 0.1);
    distortion.wet.rampTo(0.8, 0.1);
    delay.wet.rampTo(0.5, 0.1);
    themeColor = "#ff4400"; // Flame Orange
    if (btn) btn.innerHTML = "<span>🔥</span> MODE: ROCK";
    document.documentElement.style.setProperty('--accent-color', '#ff4400');
    document.documentElement.style.setProperty('--accent-secondary', '#ffcc00');
  } else {
    // ACOUSTIC MODE
    overdrive.wet.rampTo(0, 0.1);
    distortion.wet.rampTo(0, 0.1);
    delay.wet.rampTo(0, 0.1);
    themeColor = "#00ffcc"; // Cyber Cyan
    if (btn) btn.innerHTML = "<span>⚡</span> MODE: ACOUSTIC";
    document.documentElement.style.setProperty('--accent-color', '#00ffcc');
    document.documentElement.style.setProperty('--accent-secondary', '#00aaff');
  }
};

// Retry audio ทุก user interaction (non-once) ป้องกัน context suspend
function _onUserInteract() {
  if (!audioReady) ensureAudio().catch(() => { });
}
["click", "touchstart", "keydown"].forEach(evt =>
  document.addEventListener(evt, _onUserInteract)
);

// ══════════════════════════════════════════
// 🎸 Chords & Gesture Map
// ══════════════════════════════════════════

const CHORDS = {
  "Gmaj7": ["G3", "B3", "D4", "F#4"],
  "F#m7": ["F#3", "A3", "C#4", "E4"],
  "Em7": ["E3", "G3", "B3", "D4"],
  "Dmaj7": ["D3", "F#3", "A3", "C#4"]
};

const GESTURE_CHORD = {
  "Open_Palm": "Gmaj7",
  "Pointing_Up": "Gmaj7",
  "Victory": "F#m7",
  "ILoveYou": "Em7",
  "Closed_Fist": "Dmaj7",
};

let currentChord = "Gmaj7";
let lastValidChord = "Gmaj7";
let isPlaying = false;
let lastStrumTime = 0;

// Strum Zone Config
const STRUM_Y_TOP = 0.38;
const STRUM_Y_BOTTOM = 0.62;
const STRUM_ZONE_X = 0.65; // Right side (normalized 0-1)

// string states for animation
const stringStates = [
  { active: 0, vib: 0 }, { active: 0, vib: 0 },
  { active: 0, vib: 0 }, { active: 0, vib: 0 }
];

// Particle System
class Particle {
  constructor(x, y, color) {
    this.x = x; this.y = y;
    this.vx = (Math.random() - 0.5) * 8;
    this.vy = (Math.random() - 0.5) * 8;
    this.life = 1.0;
    this.color = color;
    this.size = Math.random() * 3 + 2;
  }
  update() {
    this.x += this.vx; this.y += this.vy;
    this.life -= 0.025;
    this.size *= 0.96;
  }
  draw(ctx) {
    ctx.globalAlpha = this.life;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;
  }
}
let particles = [];

function triggerStringVibration(velocity) {
  stringStates.forEach((s, i) => {
    s.active = 1.0;
    s.vib = 15 + Math.random() * 10 * velocity;

    // Add particles along the string
    const y = (canvas.height * 0.4) + (i * 35);
    for (let j = 0; j < 5; j++) {
      const px = (canvas.width * 0.1) + Math.random() * (canvas.width * 0.8);
      particles.push(new Particle(px, y, "#00ffcc"));
    }
  });
}

function playStrum(velocity) {
  // Guard: ต้องพร้อมทั้งหมด
  if (!audioReady || !guitarSynth || !masterVol) return;
  if (Tone.context.state !== "running") {
    // พยายาม resume แบบ fire-and-forget (ถ้า context suspend)
    Tone.context.resume().catch(() => { });
    return;
  }

  const notes = CHORDS[currentChord];
  if (!notes || notes.length === 0) return;

  // Visuals
  triggerStringVibration(velocity);

  // MED FIX: cancel scheduled values ก่อน rampTo ป้องกัน volume ซ้อนทับถ้าดีดเร็ว
  // LOW FIX: range -6+vel*6 → vel=0.15: -5.1dB, vel=1.0: 0dB (เสียงดังขึ้น)
  masterVol.volume.cancelScheduledValues(Tone.now());
  const db = -6 + velocity * 6;
  masterVol.volume.rampTo(db, 0.03);

  // ดีด chord: PolySynth รองรับ polyphonic → notes ทุกตัวดังพร้อมกัน
  // spread = ดีดทีละสาย ห่างกัน ~20ms (เหมือนกีต้าร์จริง)
  const spread = 0.018 + (1 - velocity) * 0.04;
  const now = Tone.now();
  const dur = 1.5;

  // Trigger Pick Noise once per strum
  pickSynth?.triggerAttackRelease("16n", now);

  notes.forEach((note, i) => {
    guitarSynth.triggerAttackRelease(note, dur, now + i * spread);
  });
}

// ══════════════════════════════════════════
// 🎼 Lyrics
// ══════════════════════════════════════════

let songData, currentIndex = 0, scrollTimer = null;

fetch("song.json")
  .then(r => r.ok ? r.json() : Promise.reject("HTTP " + r.status))
  .then(d => { songData = d; renderLyrics(); })
  .catch(e => showError("❌ song.json: " + e));

function showError(msg, showRetry = false) {
  console.error(msg);
  const el = document.getElementById("error-msg");
  if (el) { el.textContent = msg; el.style.display = "block"; }
  const rb = document.getElementById("retry-btn");
  if (rb) rb.style.display = showRetry ? "inline-block" : "none";
}
function clearError() {
  const el = document.getElementById("error-msg");
  if (el) { el.textContent = ""; el.style.display = "none"; }
  const rb = document.getElementById("retry-btn");
  if (rb) rb.style.display = "none";
}
function setStatus(t) {
  const el = document.getElementById("title");
  if (el) el.innerText = t.toUpperCase();
}
function setGestureUI(t) {
  const el = document.getElementById("gesture-text");
  if (el) el.textContent = t;
}
function setObjectUI(t) {
  const el = document.getElementById("object-text");
  if (el) el.textContent = t;
}

function renderLyrics() {
  const c = document.getElementById("lyrics");
  if (!c || !songData) return;
  if (c.children.length === 0)
    songData.lines.forEach((ln, i) => {
      const d = document.createElement("div");
      d.className = "line"; d.id = "line-" + i;
      // LOW-3 FIX: ใช้ textContent แทน innerHTML ป้องกัน XSS
      const b = document.createElement("b");
      b.textContent = ln.chord;
      d.appendChild(b);
      d.appendChild(document.createTextNode(" " + ln.lyric));
      c.appendChild(d);
    });
  c.querySelectorAll(".line").forEach((el, i) =>
    el.classList.toggle("active", i === currentIndex));
  const a = document.getElementById("line-" + currentIndex);
  if (a) c.scrollTop = a.offsetTop - c.clientHeight / 2 + a.clientHeight / 2;
}

function startScroll() {
  if (scrollTimer) clearInterval(scrollTimer);
  scrollTimer = setInterval(() => {
    if (!isPlaying || !songData) return;
    currentIndex = (currentIndex + 1) % songData.lines.length;
    renderLyrics();
  }, songData?.scrollSpeed || 4000);
}

// ══════════════════════════════════════════
// ⏳ Countdown
// ══════════════════════════════════════════

let countdownActive = false;

function showCountdown(n) {
  const el = document.getElementById("countdown-overlay");
  if (!el) return;
  if (n === null) { el.style.display = "none"; return; }
  el.style.display = "flex";
  el.textContent = n === 0 ? "🎸 GO!" : n + "…";
}

function triggerCountdown() {
  if (countdownActive) return;
  countdownActive = true;
  ensureAudio().then(() => {
    let n = 3; showCountdown(n);
    const timer = setInterval(() => {
      n--;
      if (n > 0) { showCountdown(n); return; }
      showCountdown(0);
      isPlaying = true;
      startScroll();
      setTimeout(() => {
        showCountdown(null);
        countdownActive = false;
        updateTitle();
      }, 800);
      clearInterval(timer);
    }, 1000);
  }).catch(e => {
    countdownActive = false;
    showError("❌ เปิดเสียงไม่ได้: " + e.message);
  });
}

function updateTitle() {
  setStatus(currentChord + (isPlaying ? " • PLAYING" : " • PAUSED"));
}

// ══════════════════════════════════════════
// ✋ Hand Helpers
// ══════════════════════════════════════════

function countOpenFingers(l) {
  return [[8, 6], [12, 10], [16, 14], [20, 18]]
    .filter(([t, p]) => l[t].y < l[p].y).length;
}
function isThumbExtended(l) {
  return Math.abs(l[4].x - l[3].x) > 0.04 ||
    Math.abs(l[4].y - l[3].y) > 0.04;
}
function isFiveFingers(l) {
  return countOpenFingers(l) >= 4 && isThumbExtended(l);
}
function chordFromFingers(l) {
  const n = countOpenFingers(l);
  if (n === 0) return "Dmaj7";
  if (n === 1) return "Gmaj7";
  if (n === 2) return "F#m7";
  return "Em7";
}

// ══════════════════════════════════════════
// 🎯 EMA Smoothing
// ══════════════════════════════════════════

const _smoothed = {};

function smoothLM(pts, id) {
  if (!_smoothed[id]) {
    _smoothed[id] = pts.map(p => ({ x: p.x, y: p.y, z: p.z || 0 }));
    return _smoothed[id];
  }
  const a = 0.6;
  pts.forEach((p, i) => {
    _smoothed[id][i].x = a * _smoothed[id][i].x + (1 - a) * p.x;
    _smoothed[id][i].y = a * _smoothed[id][i].y + (1 - a) * p.y;
  });
  return _smoothed[id];
}

function resetHandState(i) {
  _smoothed[i] = undefined;
  hState[i].prevY = hState[i].prevT = hState[i].l = null;
  hState[i].smoothSpd = hState[i].dy = 0;
}

// ══════════════════════════════════════════
// 🖐 Per-hand State
// ══════════════════════════════════════════

const hState = [
  { prevY: null, prevT: null, smoothSpd: 0, dy: 0, l: null },
  { prevY: null, prevT: null, smoothSpd: 0, dy: 0, l: null }
];

let fiveFingerTime = null;
let fiveFingerHandIdx = -1;
let lastChordChange = 0;
let lastThumbToggle = 0;
const HOLD_MS = 700;

// BUG1 FIX: Strum Role Lock — ป้องกันสลับมือกะทันหัน
let lockedStrumIdx = 0;    // มือที่ล็อคเป็น strum
let lastRoleSwitch = 0;    // เวลาที่สลับบทบาทล่าสุด
const STRUM_LOCK_MS = 600;  // ms ล็อคหลังดีด
const ROLE_SWITCH_COOLDOWN = 1200; // ms cooldown ระหว่างสลับ
const HANDSWITCH_RATIO = 2.5;  // มือใหม่ต้องเร็วกว่า 2.5x จึงสลับ

// MEDIUM-2 FIX: glitch tolerance — ไม่ reset lock เมื่อ mediapipe หลุดชั่วคราว
let handMissingFrames = 0;       // นับ frame ที่ handCount < 2
const HAND_MISSING_RESET = 8;    // reset lock หลังหาย 8 frame (~270ms) ติดต่อกัน

// ══════════════════════════════════════════
// 📷 Canvas + Video
// ══════════════════════════════════════════

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
canvas.width = 640; canvas.height = 480;

// ══════════════════════════════════════════
// 🤚 MediaPipe Init
// ══════════════════════════════════════════

let gestureRecognizer, objectDetector;
let mpReady = false;
let frameCount = 0;

const OBJ_INTERVAL = 25;
let lastObjResult = null;
let tsGest = 0, tsObj = 0;

async function initMediaPipe() {
  setStatus("INITIALIZING MEDIAPIPE...");
  clearError();

  // HIGH-1+2: โหลด module ก่อน (พร้อม .mjs/.js fallback)
  try {
    await loadMediaPipeModule();
  } catch (e) {
    showError("❌ โหลด MediaPipe library: " + e.message, true);
    return;
  }

  async function tryDelegate(createFn, baseOpts, restOpts) {
    try {
      return await createFn({ baseOptions: { ...baseOpts, delegate: "GPU" }, ...restOpts });
    } catch (e) {
      console.warn("GPU → CPU fallback:", e.message);
      return await createFn({ baseOptions: { ...baseOpts, delegate: "CPU" }, ...restOpts });
    }
  }

  try {
    const vision = await FilesetResolver.forVisionTasks(WASM_PATH);

    gestureRecognizer = await tryDelegate(
      opt => GestureRecognizer.createFromOptions(vision, opt),
      { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task" },
      { runningMode: "VIDEO", numHands: 2, minHandDetectionConfidence: 0.55, minTrackingConfidence: 0.45 }
    );
    console.log("✅ GestureRecognizer ready");

    objectDetector = await tryDelegate(
      opt => ObjectDetector.createFromOptions(vision, opt),
      { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite" },
      { runningMode: "VIDEO", scoreThreshold: 0.40, maxResults: 5 }
    );
    console.log("✅ ObjectDetector ready");

    mpReady = true;
    setStatus("SYSTEM READY. SHOW 🖐️ TO START");

  } catch (e) {
    showError("❌ MediaPipe init: " + e.message, true);
    console.error(e);
  }
}

async function retryInit() {
  mpReady = false;
  showCountdown(null);
  countdownActive = false;
  // cleanup audio
  try { guitarSynth?.dispose(); } catch (e) { }
  try { pickSynth?.dispose(); } catch (e) { }
  try { chorus?.dispose(); } catch (e) { }
  try { overdrive?.dispose(); } catch (e) { }
  try { distortion?.dispose(); } catch (e) { }
  try { delay?.dispose(); } catch (e) { }
  try { reverb?.dispose(); } catch (e) { }
  try { masterVol?.dispose(); } catch (e) { }
  guitarSynth = null; pickSynth = null; chorus = null;
  overdrive = null; distortion = null; delay = null;
  reverb = null; masterVol = null;
  audioReady = false; audioInitDone = false;
  try { gestureRecognizer?.close(); } catch (e) { }
  try { objectDetector?.close(); } catch (e) { }
  gestureRecognizer = null;
  objectDetector = null;
  await initMediaPipe();
}

// ══════════════════════════════════════════
// 🎬 Frame Loop
// ══════════════════════════════════════════

let pendingFrame = false;

function processFrame() {
  requestAnimationFrame(processFrame);
  if (!mpReady || video.readyState < 2 || video.videoWidth === 0) return;
  if (pendingFrame) return;
  pendingFrame = true;
  _runDetection().finally(() => { pendingFrame = false; });
}

async function _runDetection() {
  frameCount++;
  const now = Date.now();

  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
  ctx.restore();

  drawVirtualStrings();
  drawStrumReferenceLines();
  updateAndDrawParticles();
  drawAudioVisualizer();
  drawRhythmPulse();
  if (lastObjResult) drawObjectBoxes(lastObjResult);

  try {
    const t = performance.now();
    tsGest = Math.max(tsGest + 1, t);
    tsObj = Math.max(tsObj + 1, t + 0.1);

    const gestResult = gestureRecognizer.recognizeForVideo(video, tsGest);

    if (frameCount % OBJ_INTERVAL === 0) {
      lastObjResult = objectDetector.detectForVideo(video, tsObj);
      renderObjectUI(lastObjResult);
    }

    onResults(gestResult, now);
  } catch (e) {
    console.warn("frame err:", e.message);
  }
}

// ══════════════════════════════════════════
// 🖐 onResults
// ══════════════════════════════════════════

function onResults(gestResult, now) {
  const lms = gestResult.landmarks;
  const gestures = gestResult.gestures;
  const handCount = lms?.length ?? 0;

  // HUD
  ctx.font = "bold 18px sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "#00ffcc";
  ctx.fillText(currentChord + (isPlaying ? " • PLAYING" : " • PAUSED"), canvas.width / 2, 28);
  ctx.font = "10px 'JetBrains Mono'";
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.textAlign = "right";
  ctx.fillText("f:" + frameCount + " h:" + handCount, canvas.width - 6, 18);
  ctx.textAlign = "left";

  for (let i = handCount; i < 2; i++) resetHandState(i);
  // MEDIUM-2 FIX: glitch tolerance — reset lock เฉพาะเมื่อหาย N frame ติดต่อกัน
  if (handCount < 2) {
    handMissingFrames++;
    if (handMissingFrames >= HAND_MISSING_RESET) {
      lockedStrumIdx = 0; lastRoleSwitch = 0;
    }
  } else {
    handMissingFrames = 0;
  }

  if (handCount === 0) {
    fiveFingerTime = null; fiveFingerHandIdx = -1;
    ctx.font = "bold 15px sans-serif";
    ctx.fillStyle = "rgba(0, 255, 204, 0.7)";
    ctx.textAlign = "center";
    ctx.fillText("SHOW YOUR HAND TO BEGIN", canvas.width / 2, canvas.height / 2);
    ctx.textAlign = "left";
    setGestureUI("—");
    drawHandIndicator(-1, -1);
    return;
  }

  if (gestures?.length > 0)
    setGestureUI(gestures.map(g =>
      g[0] ? g[0].categoryName.replace(/_/g, " ") + " " + (g[0].score * 100).toFixed(0) + "%" : "—"
    ).join(" │ "));

  // smooth + dy/speed — LOW-1 FIX: ใช้ landmark 0 (ข้อมือ) แทน 8 (นิ้วชี้) — stable กว่า
  for (let i = 0; i < handCount; i++) {
    const l = smoothLM(lms[i], i);
    const st = hState[i];
    const y = l[0].y;  // ← landmark 0 = ข้อมือ (stable, ไม่ขยับตามนิ้ว)
    if (st.prevY !== null && st.prevT !== null) {
      const rawDy = y - st.prevY;
      const dt = Math.max((now - st.prevT) / 1000, 0.005);
      st.smoothSpd = 0.4 * st.smoothSpd + 0.6 * (Math.abs(rawDy) / dt);
      st.dy = rawDy;
    } else { st.dy = 0; st.smoothSpd = 0; }
    st.l = l; st.prevY = y; st.prevT = now;
  }

  // ── BUG1 FIX: Strum Role Lock + Hysteresis ──────────────────────────
  // ปัญหาเดิม: strumIdx เปลี่ยนทุก frame ตาม smoothSpd ทันที
  //   → มือ chord ขยับนิดเดียวก็กลายเป็น strum ได้
  // วิธีแก้:
  //   1. ล็อค strumIdx ด้วย STRUM_LOCK_MS (800ms) หลังดีดครั้งล่าสุด
  //   2. เปลี่ยนได้เฉพาะเมื่อมือใหม่เร็วกว่า HANDSWITCH_RATIO เท่า (2x)
  //   3. เมื่อมือใดมือหนึ่งหาย → reset lock
  let strumIdx = lockedStrumIdx < handCount ? lockedStrumIdx : 0;

  if (handCount === 2) {
    const spd0 = hState[0].smoothSpd;
    const spd1 = hState[1].smoothSpd;
    const sinceStrum = now - lastStrumTime;
    const sinceSwitch = now - lastRoleSwitch;

    // อนุญาตให้เปลี่ยนได้เฉพาะ:
    //   - ไม่ได้เพิ่งดีด (> STRUM_LOCK_MS) หรือ
    //   - มือใหม่เร็วกว่าเดิมมาก (> HANDSWITCH_RATIO) และ cooldown ผ่านแล้ว
    const candidate = spd0 >= spd1 ? 0 : 1;
    const faster = candidate === 0 ? spd0 / Math.max(spd1, 0.001)
      : spd1 / Math.max(spd0, 0.001);
    const canSwitch = sinceStrum > STRUM_LOCK_MS &&
      sinceSwitch > ROLE_SWITCH_COOLDOWN &&
      faster > HANDSWITCH_RATIO;

    if (canSwitch && candidate !== lockedStrumIdx) {
      lockedStrumIdx = candidate;
      lastRoleSwitch = now;
    }
    strumIdx = lockedStrumIdx;
  } else {
    // มือเดียว → เป็น strum เสมอ
    lockedStrumIdx = 0;
    strumIdx = 0;
  }

  const chordIdx = handCount === 2 ? 1 - strumIdx : 0;

  // FIX LOW-2: ส่ง strumIdx จริงให้ indicator map ถูก
  drawHandIndicator(strumIdx, handCount);

  let anyFive = false;

  for (let i = 0; i < handCount; i++) {
    const st = hState[i];
    const l = st.l;
    const isStrum = i === strumIdx;
    const color = isStrum ? themeColor : "#00aaff";
    const role = isStrum ? "STRUM" : "CHORD";
    const gesture = gestures?.[i]?.[0]?.categoryName ?? "None";
    const gScore = gestures?.[i]?.[0]?.score ?? 0;
    // FIX LOW-3: openN ส่งเข้า drawHandLabel เพื่อแสดงบน badge
    const openN = countOpenFingers(l);

    // FIX LOW-1: drawHandSkeleton ครอบ ctx.save/restore ใน function ใหม่แล้ว
    drawHandSkeleton(l, color);

    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    l.forEach((p, idx) => {
      ctx.beginPath();
      // Tips (4,8,12,16,20) are slightly larger
      const r = [4, 8, 12, 16, 20].includes(idx) ? 6 : 4;
      ctx.arc((1 - p.x) * canvas.width, p.y * canvas.height, r, 0, 2 * Math.PI);
      ctx.fill();
    });
    ctx.shadowBlur = 0;

    drawHandLabel(l[0], role, color, gesture, gScore, openN);

    // 5-finger countdown
    const five = isFiveFingers(l);
    if (five && !countdownActive && !isPlaying) {
      if (fiveFingerHandIdx !== i) { fiveFingerHandIdx = i; fiveFingerTime = now; }
      const prog = Math.min((now - fiveFingerTime) / HOLD_MS, 1);
      drawProgressBar(prog);
      anyFive = true;
      if (prog >= 1) { fiveFingerTime = null; fiveFingerHandIdx = -1; triggerCountdown(); }
    } else if (!five && fiveFingerHandIdx === i) {
      fiveFingerTime = null; fiveFingerHandIdx = -1;
    }

    // chord / pause
    // MEDIUM-1 FIX: อนุญาตให้เปลี่ยน chord ได้แม้ก่อน isPlaying (ลบ `&& isPlaying` guard)
    // ยกเว้น: Thumb_Up pause ยังคง check isPlaying เหมือนเดิม
    if (i === chordIdx && !five) {
      // HIGH-1 FIX: มือเดียว — ห้ามเปลี่ยน chord ขณะกำลังดีด (dy สูง)
      // ป้องกัน gesture เปลี่ยนระหว่างแกว่งมือ
      // MED FIX: ลด strumMotion จาก 0.035 → 0.018 (ต่ำกว่า strum threshold 0.022)
      // ป้องกัน: ดีดเบา (0.022<dy<0.035) เสียงออกแต่ chord เปลี่ยนระหว่างดีด
      const strumMotion = (handCount === 1 && Math.abs(hState[i].dy) > 0.018);

      if (!strumMotion) {
        if (gesture === "Thumb_Up" && gScore > 0.75 && isPlaying && now - lastThumbToggle > 700) {
          isPlaying = !isPlaying;
          lastThumbToggle = now;
          if (isPlaying) {
            startScroll();
          } else {
            // LOW FIX: clear scrollTimer ตอน pause ป้องกัน interval ค้าง (memory/CPU leak)
            if (scrollTimer) { clearInterval(scrollTimer); scrollTimer = null; }
          }
          updateTitle();
        }
        const mapped = GESTURE_CHORD[gesture];
        if (mapped && mapped !== currentChord && gScore > 0.65 && now - lastChordChange > 350) {
          currentChord = lastValidChord = mapped;
          lastChordChange = now; updateTitle();
          // Visual Feedback for chord change
          triggerStringVibration(0.3); // Gentle glow on change
        }

        if (!mapped && gesture !== "Thumb_Up" && gesture !== "None" && gScore > 0.45) {
          const ch = chordFromFingers(l);
          if (ch !== currentChord && now - lastChordChange > 300) {
            currentChord = lastValidChord = ch;
            lastChordChange = now; updateTitle();
            triggerStringVibration(0.3); // Gentle glow on change
          }
        }
      }
    }
  }

  if (!anyFive && fiveFingerHandIdx !== -1) {
    fiveFingerTime = null; fiveFingerHandIdx = -1;
  }

  // Strum — threshold 0.022 สำหรับ l[0].y (ข้อมือ)
  const sSt = hState[strumIdx];
  if (sSt.l && sSt.prevY !== null &&
    Math.abs(sSt.dy) > 0.022 && now - lastStrumTime > 130) {
    const vel = Math.min(Math.max(sSt.smoothSpd / 1.2, 0.15), 1.0);
    playStrum(vel);   // sync แล้ว ไม่ต้อง await
    lastStrumTime = now;
    drawStrumArrow(sSt.dy > 0 ? "▼" : "▲", vel);
  }
}

// ══════════════════════════════════════════
// 🖌️ Draw Helpers
// ══════════════════════════════════════════

const HAND_CONN = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12], [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20], [5, 9], [9, 13], [13, 17]
];

// FIX LOW-1: ครอบ ctx.save/restore ป้องกัน globalAlpha leak
function drawHandSkeleton(l, color) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.globalAlpha = 0.5;
  HAND_CONN.forEach(([a, b]) => {
    ctx.beginPath();
    ctx.moveTo((1 - l[a].x) * canvas.width, l[a].y * canvas.height);
    ctx.lineTo((1 - l[b].x) * canvas.width, l[b].y * canvas.height);
    ctx.stroke();
  });
  ctx.restore();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// FIX LOW-3: badge แสดง openN จำนวนนิ้วด้วย
function drawHandLabel(wrist, role, color, gesture, gScore, openN) {
  ctx.save();
  const wx = (1 - wrist.x) * canvas.width;
  const wy = wrist.y * canvas.height;
  const fw = 124, fh = 38, fr = 6;
  const fx = Math.max(4, Math.min(wx - fw / 2, canvas.width - fw - 4));
  const fy = Math.max(4, wy - fh - 32);

  ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 12;
  ctx.fillStyle = "rgba(10, 12, 15, 0.85)";
  roundRect(fx, fy, fw, fh, fr); ctx.fill();
  ctx.shadowBlur = 0;

  ctx.strokeStyle = color; ctx.lineWidth = 2;
  roundRect(fx, fy, fw, fh, fr); ctx.stroke();

  ctx.font = "bold 13px sans-serif"; ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.fillText(role, fx + fw / 2, fy + 15);

  ctx.font = "10px monospace"; ctx.fillStyle = "rgba(255,255,255,0.75)";
  const gName = gesture.replace(/_/g, " ");
  const detail = gName + " " + (gScore * 100).toFixed(0) + "%  ✋" + openN;
  ctx.fillText(detail, fx + fw / 2, fy + 30);

  // connector line
  ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.globalAlpha = 0.35;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(wx, fy + fh);
  ctx.lineTo(wx, Math.min(wy, canvas.height - 4));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// FIX LOW-2: indicator map ตาม strumIdx จริง (ไม่ fixed rows)
function drawHandIndicator(strumIdx, handCount) {
  ctx.save();
  const bx = 6, by = canvas.height - 66, bw = 128, bh = 60, br = 7;
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 1;
  roundRect(bx, by, bw, bh, br); ctx.fill();
  roundRect(bx, by, bw, bh, br); ctx.stroke();

  ctx.font = "bold 9px sans-serif"; ctx.fillStyle = "#888"; ctx.textAlign = "left";
  ctx.fillText("HAND ROLES", bx + 8, by + 13);

  if (strumIdx === -1 || handCount === 0) {
    ctx.font = "11px sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.fillText("NO HANDS DETECTED", bx + 8, by + 38);
  } else {
    // แสดงตาม index จริง: มือ 0 และ 1 แต่ label ตาม strumIdx
    for (let i = 0; i < Math.min(handCount, 2); i++) {
      const isS = i === strumIdx;
      const label = isS ? "H" + (i + 1) + " » STRUM" : "H" + (i + 1) + " » CHORD";
      const color = isS ? "#00ffcc" : "#00aaff";
      const y = by + 26 + i * 18;
      ctx.beginPath(); ctx.arc(bx + 13, y, 5, 0, 2 * Math.PI);
      ctx.fillStyle = color; ctx.fill();
      ctx.font = "bold 10px sans-serif"; ctx.fillStyle = color;
      ctx.fillText(label, bx + 24, y + 4);
    }
  }
  ctx.restore();
}

function drawVirtualStrings() {
  ctx.save();
  const startY = canvas.height * 0.4;
  const spacing = 35;
  const width = canvas.width * 0.8;
  const startX = (canvas.width - width) / 2;

  stringStates.forEach((s, i) => {
    const y = startY + i * spacing;

    // update vibration & active state
    s.vib *= 0.85; // decay vibration
    s.active *= 0.92; // decay glow

    ctx.beginPath();
    ctx.lineWidth = 1 + (i * 0.5); // lower strings are thicker

    // Draw string with vibration (sin wave)
    ctx.moveTo(startX, y);
    if (s.vib > 0.5) {
      for (let x = 0; x <= width; x += 20) {
        const off = Math.sin(x * 0.05 + Date.now() * 0.02) * s.vib;
        ctx.lineTo(startX + x, y + off);
      }
    } else {
      ctx.lineTo(startX + width, y);
    }

    // Gradient styling
    const opacity = 0.1 + s.active * 0.6;
    ctx.strokeStyle = `rgba(0, 255, 204, ${opacity})`;
    if (s.active > 0.1) {
      ctx.shadowColor = "#00ffcc";
      ctx.shadowBlur = 10 * s.active;
    }
    ctx.stroke();

    // String "Glow" points at edges
    ctx.fillStyle = `rgba(255, 255, 255, ${opacity * 0.5})`;
    ctx.beginPath();
    ctx.arc(startX, y, 2, 0, Math.PI * 2);
    ctx.arc(startX + width, y, 2, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.restore();
}

function drawStrumReferenceLines() {
  ctx.save();
  const xStart = (1 - STRUM_ZONE_X) * canvas.width; // Mirroring adjustment
  const width = canvas.width - xStart - 10;

  const drawLine = (yNorm, label, active) => {
    const y = yNorm * canvas.height;
    ctx.beginPath();
    ctx.lineWidth = active ? 4 : 2;
    ctx.setLineDash(active ? [] : [5, 5]);
    ctx.strokeStyle = active ? "#00ffcc" : "rgba(255, 255, 255, 0.2)";
    if (active) {
      ctx.shadowColor = "#00ffcc";
      ctx.shadowBlur = 15;
    }

    ctx.moveTo(xStart, y);
    ctx.lineTo(xStart + width, y);
    ctx.stroke();

    // Label
    ctx.font = "bold 10px 'JetBrains Mono'";
    ctx.fillStyle = active ? "#00ffcc" : "rgba(255, 255, 255, 0.3)";
    ctx.textAlign = "right";
    ctx.fillText(label, xStart + width, y - 8);
    ctx.shadowBlur = 0;
  };

  // Check if strum hand is near lines
  const sSt = hState[lockedStrumIdx];
  const handY = sSt?.l ? sSt.l[0].y : -1;
  const isUpActive = handY > 0 && Math.abs(handY - STRUM_Y_TOP) < 0.05;
  const isDownActive = handY > 0 && Math.abs(handY - STRUM_Y_BOTTOM) < 0.05;

  drawLine(STRUM_Y_TOP, "UPPER LIMIT", isUpActive);
  drawLine(STRUM_Y_BOTTOM, "LOWER LIMIT", isDownActive);

  // Connect them with a faint side bar
  ctx.beginPath();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
  ctx.lineWidth = 1;
  ctx.moveTo(xStart, STRUM_Y_TOP * canvas.height);
  ctx.lineTo(xStart, STRUM_Y_BOTTOM * canvas.height);
  ctx.stroke();

  ctx.restore();
}

function updateAndDrawParticles() {
  particles = particles.filter(p => p.life > 0);
  particles.forEach(p => {
    p.update();
    p.draw(ctx);
  });
}

function drawAudioVisualizer() {
  if (!analyser) return;
  const values = analyser.getValue();
  ctx.save();
  ctx.beginPath();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0, 255, 204, 0.5)";
  ctx.shadowColor = "#00ffcc";
  ctx.shadowBlur = 15;

  const sliceWidth = canvas.width / values.length;
  let x = 0;

  for (let i = 0; i < values.length; i++) {
    const v = values[i] * 1.5;
    const y = (v + 1) / 2 * (canvas.height * 0.2) + (canvas.height * 0.78);

    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    x += sliceWidth;
  }
  ctx.stroke();
  ctx.restore();
}

function drawRhythmPulse() {
  if (!isPlaying) return;
  ctx.save();
  // Double beat pulse (Thump-thump)
  const time = Date.now() * 0.006;
  const pulse = Math.pow(Math.sin(time), 10) * 0.2 + Math.pow(Math.sin(time + 0.4), 10) * 0.1;
  const opacity = pulse;

  ctx.strokeStyle = `rgba(0, 255, 204, ${opacity})`;
  ctx.lineWidth = 10 * pulse;
  ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);

  // Vignette effect
  const grad = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, 0, canvas.width / 2, canvas.height / 2, canvas.width);
  grad.addColorStop(0, "transparent");
  grad.addColorStop(1, `rgba(0, 255, 204, ${opacity * 0.2})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.restore();
}

function drawStrumArrow(arrow, vel) {
  ctx.save();
  ctx.globalAlpha = 0.5 + vel * 0.5;
  ctx.fillStyle = vel > 0.6 ? "#00ffcc" : "#00aaff";
  ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 20;
  ctx.font = "bold " + (24 + vel * 24) + "px 'Outfit'";
  ctx.textAlign = "center";
  ctx.fillText(arrow + " STRUM", canvas.width / 2, 60);
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawProgressBar(prog) {
  ctx.save();
  const bx = canvas.width * 0.15, by = canvas.height - 44, bw = canvas.width * 0.7;
  ctx.fillStyle = "rgba(0,0,0,0.65)"; ctx.fillRect(bx, by, bw, 22);
  const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  g.addColorStop(0, "#00ffcc"); g.addColorStop(1, "#00aaff");
  ctx.fillStyle = g; ctx.fillRect(bx, by, bw * prog, 22);
  ctx.fillStyle = "white"; ctx.font = "bold 13px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("HOLD 🖐️ FOR 1s TO BEGIN SESSION", canvas.width / 2, by - 8);
  ctx.restore();
}

function drawObjectBoxes(result) {
  if (!result?.detections?.length) return;
  result.detections.forEach(det => {
    const bb = det.boundingBox;
    const label = det.categories[0]?.categoryName ?? "?";
    const score = ((det.categories[0]?.score ?? 0) * 100).toFixed(0);
    const mx = canvas.width - (bb.originX + bb.width);
    const labelY = Math.max(bb.originY, 24);
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = "#ffaa00"; ctx.lineWidth = 2;
    ctx.strokeRect(mx, bb.originY, bb.width, bb.height);
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(mx, labelY - 22, bb.width, 22);
    ctx.fillStyle = "#ffaa00"; ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(label + " " + score + "%", mx + 4, labelY - 6);
    ctx.restore();
  });
}

function renderObjectUI(result) {
  if (!result?.detections?.length) { setObjectUI("—"); return; }
  setObjectUI(result.detections.slice(0, 3).map(d =>
    (d.categories[0]?.categoryName ?? "?") + " " +
    ((d.categories[0]?.score ?? 0) * 100).toFixed(0) + "%"
  ).join(", "));
}

// ══════════════════════════════════════════
// 🎥 Recording
// ══════════════════════════════════════════

let recDest, micStream, oldMicSource, mediaRecorder, recChunks = [];

async function startRecording() {
  if (mediaRecorder?.state === "recording") return;

  await ensureAudio();

  // 1. Create Destination and connect Tone.js Master Output
  if (!recDest) {
    recDest = Tone.context.createMediaStreamDestination();
  }

  // Connect Tone.js global output to recording destination
  Tone.Destination.connect(recDest);

  recChunks = [];

  // 2. Setup Microphone
  if (micStream) micStream.getTracks().forEach(t => t.stop());
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Mix mic into the same recDest
    if (oldMicSource) { try { oldMicSource.disconnect(); } catch (e) { } }
    oldMicSource = Tone.context.createMediaStreamSource(micStream);
    oldMicSource.connect(recDest);
  } catch (e) {
    console.warn("🎤 Recording without Mic:", e.message);
    // Continue without mic if denied
  }

  // 3. Combine Tracks
  const videoStream = canvas.captureStream(30);
  const combined = new MediaStream([
    ...videoStream.getVideoTracks(),
    ...recDest.stream.getAudioTracks()
  ]);

  // 4. Initialize MediaRecorder
  const options = { mimeType: 'video/webm;codecs=vp8,opus' };
  if (!MediaRecorder.isTypeSupported(options.mimeType)) {
    delete options.mimeType; // Fallback to default
  }

  mediaRecorder = new MediaRecorder(combined, options);
  mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recChunks.push(e.data); };

  mediaRecorder.onstop = () => {
    // Cleanup UI
    updateRecordButtons(false);

    const blob = new Blob(recChunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = url;
    a.download = `VirtualGuitar_${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 2000);
  };

  mediaRecorder.start(1000);
  updateRecordButtons(true);
  console.log("🎥 Recording started");
}

function updateRecordButtons(isRecording) {
  const btnRec = document.getElementById("btn-record");
  const btnStop = document.getElementById("btn-stop-rec");
  if (btnRec) {
    btnRec.disabled = isRecording;
    btnRec.innerHTML = isRecording ? "<span>⭕</span> RECORDING..." : "<span>🔴</span> RECORD";
    btnRec.style.borderColor = isRecording ? "#ff4444" : "";
  }
  if (btnStop) {
    btnStop.disabled = !isRecording;
  }
}

function stopRecording() {
  if (mediaRecorder?.state !== "inactive") mediaRecorder?.stop();

  // Decouple Tone.js from recording destination
  if (recDest) {
    Tone.Destination.disconnect(recDest);
  }

  if (oldMicSource) {
    try { oldMicSource.disconnect(); } catch (e) { }
    oldMicSource = null;
  }
  if (micStream) micStream.getTracks().forEach(t => t.stop());
  micStream = null;
}

// ══════════════════════════════════════════
// 📷 Camera
// ══════════════════════════════════════════

async function startCamera() {
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" }, audio: false
    });
    video.srcObject = stream;
    await new Promise((res, rej) => {
      video.onloadedmetadata = res;
      video.onerror = () => rej(new Error(video.error?.message || "video error"));
    });
    await video.play();
    console.log("✅ Camera", video.videoWidth, "x", video.videoHeight);
  } catch (e) {
    stream?.getTracks().forEach(t => t.stop());
    showError("❌ กล้อง: " + e.message);
  }
}

// ══════════════════════════════════════════
// 🚀 Bootstrap
// ══════════════════════════════════════════

await initMediaPipe();
await startCamera();
// FIX MED-3: enable ปุ่มหลัง module init เสร็จ
enableButtons();
processFrame();
