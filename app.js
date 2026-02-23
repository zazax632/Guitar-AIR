// ============================================================
// 🎸 Virtual Guitar Pro — v11 (FIXED: Hand Swap & Silent Audio)
// ============================================================

let FilesetResolver, GestureRecognizer, ObjectDetector;

const CDN_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";
const WASM_PATH = CDN_BASE + "/wasm";

// --- เพิ่มตัวแปรสำหรับระบบ Hand Locking (แก้ Bug 1) ---
let lockedStrumIdx = -1; 
let lastRoleSwitch = 0;
const ROLE_SWITCH_COOLDOWN = 1200; // ล็อกตำแหน่งไว้ 1.2 วินาทีป้องกันการสลับมั่ว

async function loadMediaPipeModule() {
  try {
    const mod = await import(CDN_BASE + "/vision_bundle.mjs");
    FilesetResolver   = mod.FilesetResolver;
    GestureRecognizer = mod.GestureRecognizer;
    ObjectDetector    = mod.ObjectDetector;
  } catch(e) {
    await new Promise((res, rej) => {
      if (window.FilesetResolver) { res(); return; }
      const s = document.createElement("script");
      s.src = CDN_BASE + "/vision_bundle.js";
      s.onload = res;
      s.onerror = () => rej(new Error("vision_bundle.js failed"));
      document.head.appendChild(s);
    });
    FilesetResolver   = window.FilesetResolver;
    GestureRecognizer = window.GestureRecognizer;
    ObjectDetector    = window.ObjectDetector;
  }
}

function enableButtons() {
  ["unlock-btn","btn-record","btn-stop-rec"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = false;
  });
}

window.unlockAndDismiss = async function() {
  await ensureAudio();
  document.getElementById("audio-unlock-banner").style.display = "none";
};
window.startRecording = startRecording;
window.stopRecording  = stopRecording;
window.retryInit      = retryInit;

// ══════════════════════════════════════════
// 🔊 AUDIO (แก้ Bug 2: Connection & Initial State)
// ══════════════════════════════════════════

let audioReady = false;
let reverb, masterVol, guitar, audioInitDone = false;

async function ensureAudio() {
  if (audioReady) return;
  try {
    if (Tone.context.state !== 'running') await Tone.start();
    audioReady = true;
    if (!audioInitDone) await initAudio();
    console.log("🔊 Audio Ready State:", Tone.context.state);
  } catch(e) { showError("❌ Audio: " + e.message); }
}

async function initAudio() {
  try {
    audioInitDone = true;
    // ปรับ Volume เริ่มต้นให้เหมาะสม
    masterVol = new Tone.Volume(-6).toDestination(); 
    
    reverb = new Tone.Reverb({ decay: 2.5, wet: 0.25 });
    await reverb.generate();
    
    guitar = new Tone.PluckSynth({
      attackNoise: 1.2, 
      dampening: 4000, 
      resonance: 0.98
    }).connect(reverb);
    
    reverb.connect(masterVol);

    console.log("✅ Audio system connected");
    setStatus("🎸 พร้อมเล่น! ชู 5 นิ้วเพื่อเริ่ม");
  } catch(e) {
    audioInitDone = false;
    showError("❌ Audio init: " + e.message);
  }
}

["click","touchstart","keydown"].forEach(evt =>
  document.addEventListener(evt, ensureAudio, { once: true })
);

const CHORDS = {
  "Gmaj7": ["G3","B3","D4","F#4"],
  "F#m7":  ["F#3","A3","C#4","E4"],
  "Em7":   ["E3","G3","B3","D4"],
  "Dmaj7": ["D3","F#3","A3","C#4"]
};

const GESTURE_CHORD = {
  "Open_Palm":   "Gmaj7",
  "Pointing_Up": "Gmaj7",
  "Victory":     "F#m7",
  "ILoveYou":    "Em7",
  "Closed_Fist": "Dmaj7",
};

let currentChord   = "Gmaj7";
let isPlaying      = false;
let lastStrumTime  = 0;

async function playStrum(velocity) {
  if (!audioReady || !guitar) return;
  
  // บังคับ Resume context กรณีโดน Browser ระงับ (แก้ Bug 2)
  if (Tone.context.state !== 'running') await Tone.context.resume();

  const notes = CHORDS[currentChord];
  if (!notes) return;

  // ปรับการคำนวณความดังให้ชัดขึ้น
  const finalVel = Math.min(Math.max(velocity * 1.3, 0.4), 1.0);
  masterVol.volume.rampTo(-10 + (finalVel * 10), 0.05);

  const t = Tone.now();
  const spread = 0.02 + (1 - finalVel) * 0.045;

  notes.forEach((n, i) => {
    // ใช้ triggerAttackRelease เพื่อให้เสียง Pluck ทำงานสมบูรณ์
    guitar.triggerAttackRelease(n, "2n", t + i * spread, finalVel);
  });
}

// ══════════════════════════════════════════
// 🎼 Lyrics & UI Helpers
// ══════════════════════════════════════════

let songData, currentIndex = 0, scrollTimer = null;

fetch("song.json")
  .then(r => r.ok ? r.json() : Promise.reject("HTTP " + r.status))
  .then(d => { songData = d; renderLyrics(); })
  .catch(e => showError("❌ song.json: " + e));

function showError(msg, showRetry = false) {
  const el = document.getElementById("error-msg");
  if (el) { el.textContent = msg; el.style.display = "block"; }
  const rb = document.getElementById("retry-btn");
  if (rb) rb.style.display = showRetry ? "inline-block" : "none";
}
function clearError() {
  const el = document.getElementById("error-msg");
  if (el) el.style.display = "none";
}
function setStatus(t) {
  const el = document.getElementById("title");
  if (el) el.innerText = t;
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
      d.innerHTML = "<b>" + ln.chord + "</b> " + ln.lyric;
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
// ⏳ Countdown & Logic Hand Selection
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
  setStatus("🎸 " + currentChord + (isPlaying ? " ▶" : " ⏸"));
}

function countOpenFingers(l) {
  return [[8,6],[12,10],[16,14],[20,18]]
    .filter(([t,p]) => l[t].y < l[p].y).length;
}
function isFiveFingers(l) {
  const n = countOpenFingers(l);
  const thumb = Math.abs(l[4].x - l[3].x) > 0.04 || Math.abs(l[4].y - l[3].y) > 0.04;
  return n >= 4 && thumb;
}
function chordFromFingers(l) {
  const n = countOpenFingers(l);
  if (n === 0) return "Dmaj7";
  if (n === 1) return "Gmaj7";
  if (n === 2) return "F#m7";
  return "Em7";
}

const _smoothed = {};
function smoothLM(pts, id) {
  if (!_smoothed[id]) {
    _smoothed[id] = pts.map(p => ({ x:p.x, y:p.y, z:p.z||0 }));
    return _smoothed[id];
  }
  const a = 0.6;
  pts.forEach((p, i) => {
    _smoothed[id][i].x = a * _smoothed[id][i].x + (1-a) * p.x;
    _smoothed[id][i].y = a * _smoothed[id][i].y + (1-a) * p.y;
  });
  return _smoothed[id];
}

function resetHandState(i) {
  _smoothed[i] = undefined;
  hState[i].prevY = hState[i].prevT = hState[i].l = null;
  hState[i].smoothSpd = hState[i].dy = 0;
}

const hState = [
  { prevY:null, prevT:null, smoothSpd:0, dy:0, l:null },
  { prevY:null, prevT:null, smoothSpd:0, dy:0, l:null }
];

let fiveFingerTime = null;
let fiveFingerHandIdx = -1;
let lastChordChange = 0;
let lastThumbToggle = 0;
const HOLD_MS = 700;

// ══════════════════════════════════════════
// 📷 MediaPipe Loop
// ══════════════════════════════════════════

const video  = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx    = canvas.getContext("2d");
canvas.width = 640; canvas.height = 480;

let gestureRecognizer, objectDetector;
let mpReady = false;
let frameCount = 0;
const OBJ_INTERVAL = 25;
let lastObjResult = null;
let tsGest = 0, tsObj = 0;

async function initMediaPipe() {
  setStatus("⏳ โหลด MediaPipe…");
  clearError();
  try {
    await loadMediaPipeModule();
    const vision = await FilesetResolver.forVisionTasks(WASM_PATH);

    gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
      baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task", delegate:"GPU" },
      runningMode:"VIDEO", numHands:2, minHandDetectionConfidence:0.55, minTrackingConfidence:0.45
    });

    objectDetector = await ObjectDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite", delegate:"GPU" },
      runningMode:"VIDEO", scoreThreshold:0.40, maxResults:5
    });

    mpReady = true;
    setStatus("🎸 พร้อมใช้งาน! ชู 5 นิ้ว");
  } catch(e) { showError("❌ MediaPipe: " + e.message, true); }
}

async function retryInit() {
  mpReady = false; showCountdown(null); countdownActive = false;
  await initMediaPipe();
}

function processFrame() {
  requestAnimationFrame(processFrame);
  if (!mpReady || video.readyState < 2) return;
  _runDetection();
}

async function _runDetection() {
  frameCount++;
  const now = Date.now();
  ctx.save(); ctx.scale(-1, 1);
  ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
  ctx.restore();

  if (lastObjResult) drawObjectBoxes(lastObjResult);

  try {
    const t = performance.now();
    tsGest = Math.max(tsGest + 1, t);
    tsObj  = Math.max(tsObj  + 1, t + 0.1);

    const gestResult = gestureRecognizer.recognizeForVideo(video, tsGest);
    if (frameCount % OBJ_INTERVAL === 0) {
      lastObjResult = objectDetector.detectForVideo(video, tsObj);
      renderObjectUI(lastObjResult);
    }
    onResults(gestResult, now);
  } catch(e) {}
}

// ══════════════════════════════════════════
// 🖐 onResults (CORE LOGIC FIXED)
// ══════════════════════════════════════════

function onResults(gestResult, now) {
  const lms = gestResult.landmarks || [];
  const gestures = gestResult.gestures || [];
  const handCount = lms.length;

  for (let i = handCount; i < 2; i++) resetHandState(i);

  if (handCount === 0) {
    fiveFingerTime = null; setGestureUI("—");
    drawHandIndicator(-1, 0);
    return;
  }

  // Calculate speed
  for (let i = 0; i < handCount; i++) {
    const l = smoothLM(lms[i], i);
    const st = hState[i];
    const y = l[8].y;
    if (st.prevY !== null) {
      const dt = Math.max((now - st.prevT) / 1000, 0.005);
      st.smoothSpd = 0.4 * st.smoothSpd + 0.6 * (Math.abs(y - st.prevY) / dt);
      st.dy = y - st.prevY;
    }
    st.l = l; st.prevY = y; st.prevT = now;
  }

  // --- ระบบตัดสินใจเลือกมือดีด (แก้ Bug 1) ---
  let strumIdx = 0;
  if (handCount === 2) {
    const s0 = hState[0].smoothSpd;
    const s1 = hState[1].smoothSpd;

    // ถ้ายังไม่มีมือที่ถูกล็อก หรือผ่านช่วง Cooldown มาแล้ว
    if (lockedStrumIdx === -1 || (now - lastRoleSwitch > ROLE_SWITCH_COOLDOWN)) {
      if (s0 > s1 * 1.8 && s0 > 8) { // มือ 0 เร็วกว่าเห็นได้ชัด
        if (lockedStrumIdx !== 0) { lockedStrumIdx = 0; lastRoleSwitch = now; }
      } else if (s1 > s0 * 1.8 && s1 > 8) { // มือ 1 เร็วกว่าเห็นได้ชัด
        if (lockedStrumIdx !== 1) { lockedStrumIdx = 1; lastRoleSwitch = now; }
      }
    }
    strumIdx = (lockedStrumIdx !== -1) ? lockedStrumIdx : (s0 >= s1 ? 0 : 1);
  } else {
    strumIdx = 0; lockedStrumIdx = -1;
  }
  const chordIdx = handCount === 2 ? 1 - strumIdx : 0;

  drawHandIndicator(strumIdx, handCount);

  let anyFive = false;
  for (let i = 0; i < handCount; i++) {
    const isStrum = (i === strumIdx);
    const color = isStrum ? "#ff5555" : "#55aaff";
    const l = hState[i].l;
    const gesture = gestures[i]?.[0]?.categoryName ?? "None";
    const gScore  = gestures[i]?.[0]?.score ?? 0;
    const openN   = countOpenFingers(l);

    drawHandSkeleton(l, color);
    drawHandLabel(l[0], isStrum ? "STRUM" : "CHORD", color, gesture, gScore, openN);

    // Countdown check
    if (isFiveFingers(l) && !isPlaying && !countdownActive) {
      if (fiveFingerHandIdx !== i) { fiveFingerHandIdx = i; fiveFingerTime = now; }
      const prog = Math.min((now - fiveFingerTime) / HOLD_MS, 1);
      drawProgressBar(prog); anyFive = true;
      if (prog >= 1) { triggerCountdown(); }
    }

    // Chord Change (Chord Hand only)
    if (i === chordIdx && isPlaying && !isFiveFingers(l)) {
      if (gesture === "Thumb_Up" && gScore > 0.8 && now - lastThumbToggle > 800) {
        isPlaying = !isPlaying; lastThumbToggle = now; updateTitle();
        if (isPlaying) startScroll();
      }
      const mapped = GESTURE_CHORD[gesture];
      if (mapped && mapped !== currentChord && gScore > 0.7) {
        currentChord = mapped; updateTitle();
      } else if (!mapped && gesture !== "Thumb_Up" && gScore > 0.4) {
        const ch = chordFromFingers(l);
        if (ch !== currentChord && now - lastChordChange > 400) {
          currentChord = ch; lastChordChange = now; updateTitle();
        }
      }
    }
  }

  if (!anyFive) { fiveFingerHandIdx = -1; fiveFingerTime = null; }

  // Strumming detection
  const sSt = hState[strumIdx];
  if (sSt.l && Math.abs(sSt.dy) > 0.06 && now - lastStrumTime > 130) {
    const vel = Math.min(Math.max(sSt.smoothSpd / 5, 0.3), 1.0);
    playStrum(vel);
    lastStrumTime = now;
    drawStrumArrow(sSt.dy > 0 ? "▼" : "▲", vel);
  }
}

// ══════════════════════════════════════════
// 🖌️ Drawing Helpers
// ══════════════════════════════════════════

const HAND_CONN = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],[0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17]];

function drawHandSkeleton(l, color) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.globalAlpha = 0.5;
  HAND_CONN.forEach(([a,b]) => {
    ctx.beginPath();
    ctx.moveTo((1-l[a].x)*canvas.width, l[a].y*canvas.height);
    ctx.lineTo((1-l[b].x)*canvas.width, l[b].y*canvas.height);
    ctx.stroke();
  });
  ctx.restore();
}

function drawHandLabel(wrist, role, color, gesture, gScore, openN) {
  ctx.save();
  const wx = (1 - wrist.x) * canvas.width, wy = wrist.y * canvas.height;
  ctx.fillStyle = "rgba(0,0,0,0.7)"; ctx.strokeStyle = color;
  ctx.fillRect(wx-60, wy-70, 120, 40); ctx.strokeRect(wx-60, wy-70, 120, 40);
  ctx.fillStyle = color; ctx.textAlign = "center";
  ctx.font = "bold 14px sans-serif"; ctx.fillText(role, wx, wy-55);
  ctx.font = "10px monospace"; ctx.fillStyle = "#fff";
  ctx.fillText(gesture + " " + (gScore*100).toFixed(0) + "% ✋" + openN, wx, wy-38);
  ctx.restore();
}

function drawHandIndicator(strumIdx, handCount) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(10, canvas.height-70, 140, 60);
  ctx.fillStyle = "#fff"; ctx.font = "bold 10px sans-serif";
  ctx.fillText("HAND ROLES:", 20, canvas.height-55);
  if (handCount === 0) ctx.fillText("No Hands detected", 20, canvas.height-35);
  else {
    for (let i=0; i<handCount; i++) {
      const isS = (i === strumIdx);
      ctx.fillStyle = isS ? "#ff5555" : "#55aaff";
      ctx.fillText("Hand " + (i+1) + ": " + (isS ? "STRUM 🎸" : "CHORD 🎵"), 20, canvas.height-35+(i*15));
    }
  }
  ctx.restore();
}

function drawProgressBar(prog) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(100, canvas.height-40, 440, 20);
  ctx.fillStyle = "#00ffcc"; ctx.fillRect(100, canvas.height-40, 440*prog, 20);
  ctx.restore();
}

function drawStrumArrow(txt, vel) {
  ctx.save(); ctx.fillStyle = "#ffaa00"; ctx.font = "bold " + (30+vel*20) + "px sans-serif";
  ctx.textAlign = "center"; ctx.fillText(txt + " STRUM", canvas.width/2, 80);
  ctx.restore();
}

function drawObjectBoxes(res) {
  res.detections.forEach(d => {
    const bb = d.boundingBox; const mx = canvas.width - (bb.originX + bb.width);
    ctx.strokeStyle = "#ffaa00"; ctx.strokeRect(mx, bb.originY, bb.width, bb.height);
  });
}

function renderObjectUI(res) {
  setObjectUI(res.detections.map(d => d.categories[0].categoryName).join(", ") || "—");
}

// ══════════════════════════════════════════
// 🎥 Recording & Camera
// ══════════════════════════════════════════

let mediaRecorder, recChunks = [];
async function startRecording() {
  await ensureAudio();
  const stream = new MediaStream([...canvas.captureStream(30).getTracks(), ...(await navigator.mediaDevices.getUserMedia({audio:true})).getTracks()]);
  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = e => recChunks.push(e.data);
  mediaRecorder.onstop = () => {
    const url = URL.createObjectURL(new Blob(recChunks, {type:"video/webm"}));
    const a = document.createElement("a"); a.href = url; a.download="guitar.webm"; a.click();
  };
  mediaRecorder.start();
}
function stopRecording() { mediaRecorder?.stop(); }

async function startCamera() {
  video.srcObject = await navigator.mediaDevices.getUserMedia({video:{width:640, height:480}, audio:false});
  await video.play();
}

// 🚀 Init
await initMediaPipe();
await startCamera();
enableButtons();
processFrame();
