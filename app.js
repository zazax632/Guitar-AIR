// ============================================================
// 🎸 Virtual Guitar Pro — FINAL (all bugs fixed)
// ============================================================

// =======================
// 🔊 AUDIO
// =======================

let audioReady = false;
let reverb, masterVol, guitar;
let audioInitDone = false;

async function ensureAudio() {
  if (audioReady) return;
  try {
    await Tone.start();
    audioReady = true;
    console.log("✅ AudioContext running");
    // init nodes หลัง AudioContext resume เพื่อไม่ให้ suspended
    if (!audioInitDone) await initAudio();
  } catch(e) {
    showError("❌ Audio: " + e.message);
  }
}

async function initAudio() {
  try {
    audioInitDone = true;
    reverb = new Tone.Reverb({ decay: 2.2, wet: 0.3 });
    await reverb.generate();
    reverb.toDestination();
    masterVol = new Tone.Volume(0).connect(reverb);
    guitar = new Tone.PluckSynth({
      attackNoise: 1.5,
      dampening: 3800,
      resonance: 0.97
    }).connect(masterVol);
    console.log("✅ Audio nodes ready");
  } catch(e) {
    audioInitDone = false;
    showError("❌ Audio init: " + e.message);
  }
}

// unlock AudioContext ด้วย user gesture ทุกแบบ
["click","touchstart","keydown"].forEach(evt =>
  document.addEventListener(evt, ensureAudio, { once: true })
);

// =======================
// 🎸 Chords + State
// =======================

const CHORDS = {
  "Gmaj7": ["G3","B3","D4","F#4"],
  "F#m7":  ["F#3","A3","C#4","E4"],
  "Em7":   ["E3","G3","B3","D4"],
  "Dmaj7": ["D3","F#3","A3","C#4"]
};

let currentChord = "Gmaj7";
let isPlaying    = false;

// =======================
// 🎸 Strum
// =======================

let lastStrumTime = 0;

async function playStrum(velocity) {
  await ensureAudio();
  if (!audioReady || !guitar || !masterVol) return;

  const notes = CHORDS[currentChord];
  if (!notes) return;

  masterVol.volume.cancelScheduledValues(Tone.now());
  masterVol.volume.rampTo(-16 + velocity * 16, 0.04);

  const spread = 0.015 + (1 - velocity) * 0.055;
  const now = Tone.now();
  notes.forEach((n, i) => guitar.triggerAttack(n, now + i * spread));

  console.log("🎸 STRUM", currentChord, "vel:", velocity.toFixed(2));
}

// =======================
// 🎼 Lyrics
// =======================

let songData, currentIndex = 0, scrollTimer = null;

fetch("song.json")
  .then(r => r.ok ? r.text() : Promise.reject("HTTP " + r.status))
  .then(t => JSON.parse(
    t.replace(/[\u201c\u201d]/g,'"').replace(/[\u2018\u2019]/g,"'")
  ))
  .then(d => { songData = d; renderLyrics(); })
  .catch(e => showError("❌ โหลด song.json ไม่ได้: " + e));

function showError(msg) {
  console.error(msg);
  const el = document.getElementById("error-msg");
  if (el) { el.textContent = msg; el.style.display = "block"; }
}

function renderLyrics() {
  const c = document.getElementById("lyrics");
  if (!c || !songData) return;
  if (c.children.length === 0)
    songData.lines.forEach((ln, i) => {
      const d = document.createElement("div");
      d.className = "line";
      d.id = "line-" + i;
      d.innerHTML = "<b>" + ln.chord + "</b> " + ln.lyric;
      c.appendChild(d);
    });
  c.querySelectorAll(".line").forEach((el,i) =>
    el.classList.toggle("active", i === currentIndex));
  const a = document.getElementById("line-" + currentIndex);
  if (a) c.scrollTop = a.offsetTop - c.clientHeight/2 + a.clientHeight/2;
}

function startScroll() {
  if (scrollTimer) clearInterval(scrollTimer);
  scrollTimer = setInterval(() => {
    if (!isPlaying || !songData) return;
    currentIndex = (currentIndex + 1) % songData.lines.length;
    renderLyrics();
  }, songData?.scrollSpeed || 4000);
}

// =======================
// ⏳ Countdown
// =======================

let countdownActive = false;

function showCountdown(n) {
  const el = document.getElementById("countdown-overlay");
  if (!el) return;
  if (n === null) { el.style.display = "none"; return; }
  el.style.display = "flex";
  el.textContent = n === 0 ? "🎸 GO!" : n + "…";
}

// ✅ FIX: ตั้ง countdownActive = true ทันที (sync) ก่อน await
//    ป้องกัน triggerCountdown ถูกเรียกซ้ำจาก frame ถัดไป
function triggerCountdown() {
  if (countdownActive) return;
  countdownActive = true;     // ← sync, ทันที

  ensureAudio().then(() => {  // ← async ตาม
    let n = 3;
    showCountdown(n);
    const t = setInterval(() => {
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
      clearInterval(t);
    }, 1000);
  });
}

function updateTitle() {
  document.getElementById("title").innerText =
    "🎸 " + currentChord + (isPlaying ? " ▶" : " ⏸");
}

// =======================
// ✋ Gesture helpers
// =======================

function fingerOpen(l, tip, pip) { return l[tip].y < l[pip].y; }

function countOpenFingers(l) {
  return [[8,6],[12,10],[16,14],[20,18]]
    .filter(([t,p]) => fingerOpen(l,t,p)).length;
}

function isThumbExtended(l) {
  // ไม่สนใจ Left/Right label: นิ้วโป้งห่างจาก knuckle ทั้งแกน x และ y
  const dx = Math.abs(l[4].x - l[3].x);
  const dy = Math.abs(l[4].y - l[3].y);
  return dx > 0.04 || dy > 0.04;
}

function isFiveFingers(l) {
  return countOpenFingers(l) >= 4 && isThumbExtended(l);
}

function detectChord(l) {
  const n = countOpenFingers(l);
  if (n === 0) return "Dmaj7";
  if (n === 1) return "Gmaj7";
  if (n === 2) return "F#m7";
  return "Em7";
}

// =======================
// 🎯 Smoothing (EMA)
// =======================

const smoothed = {};

function smooth(pts, id) {
  if (!smoothed[id]) {
    smoothed[id] = pts.map(p => ({ x: p.x, y: p.y }));
    return smoothed[id];
  }
  const a = 0.6;
  pts.forEach((p, i) => {
    smoothed[id][i].x = a * smoothed[id][i].x + (1-a) * p.x;
    smoothed[id][i].y = a * smoothed[id][i].y + (1-a) * p.y;
  });
  return smoothed[id];
}

// =======================
// 🎥 Recording
// =======================

let recDest, micStream, mediaRecorder, recChunks = [];

async function startRecording() {
  await ensureAudio();
  // ✅ FIX: lazy init recDest หลัง AudioContext resume
  if (!recDest) {
    const ctx = Tone.getContext().rawContext;
    recDest = ctx.createMediaStreamDestination();
  }

  recChunks = [];
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch(e) {
    showError("❌ ไมค์: " + e.message); return;
  }

  Tone.getContext().rawContext
    .createMediaStreamSource(micStream)
    .connect(recDest);

  const combined = new MediaStream([
    ...canvas.captureStream(30).getVideoTracks(),
    ...recDest.stream.getAudioTracks()
  ]);

  mediaRecorder = new MediaRecorder(combined);
  mediaRecorder.ondataavailable = e => {
    if (e.data.size > 0) recChunks.push(e.data);
  };
  mediaRecorder.onstop = () => {
    const url = URL.createObjectURL(
      new Blob(recChunks, { type: "video/webm" })
    );
    const a = document.createElement("a");
    a.href = url; a.download = "guitar.webm"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  mediaRecorder.start();
  console.log("🎥 Recording started");
}

function stopRecording() {
  if (mediaRecorder?.state !== "inactive") mediaRecorder?.stop();
  micStream?.getTracks().forEach(t => t.stop());
}

// =======================
// 🎥 Camera + MediaPipe
// =======================

const video  = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx    = canvas.getContext("2d");
canvas.width = 640; canvas.height = 480;

const hands = new Hands({
  locateFile: f => "https://cdn.jsdelivr.net/npm/@mediapipe/hands/" + f
});
hands.setOptions({
  maxNumHands: 2,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.65
});

// ✅ FIX (CRITICAL): แยก state ออกเป็น per-hand object
//    เก็บ prevY ก่อน update เพื่อคำนวณ dy ที่ถูกต้อง
const hState = [
  { prevY: null, prevT: null, speed: 0, smoothSpd: 0, l: null },
  { prevY: null, prevT: null, speed: 0, smoothSpd: 0, l: null }
];

let fiveFingerIdx  = null;
let fiveFingerTime = null;
const HOLD_MS      = 700;

let lastChordChange = 0;
let lastThumbToggle = 0;

hands.onResults(results => {
  // ── วาด mirror frame ──
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(results.image, -canvas.width, 0, canvas.width, canvas.height);
  ctx.restore();

  // ── HUD: chord + status ──
  ctx.font = "bold 20px sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "#00ffcc";
  ctx.fillText(currentChord + (isPlaying ? " ▶" : " ⏸"), canvas.width/2, 32);
  ctx.textAlign = "left";

  const lms = results.multiHandLandmarks;

  // ── ไม่มีมือ: reset state ──
  if (!lms || lms.length === 0) {
    hState[0].prevY = hState[0].prevT = null;
    hState[1].prevY = hState[1].prevT = null;
    hState[0].l = hState[1].l = null;
    fiveFingerIdx = fiveFingerTime = null;
    smoothed[0] = smoothed[1] = undefined;
    return;
  }

  const now = Date.now();

  // ── SINGLE PASS: smooth + update speed + เก็บ l ──
  // ✅ FIX CRITICAL: เก็บ prevY ก่อน update เพื่อใช้คำนวณ dy
  for (let i = 0; i < lms.length; i++) {
    const st   = hState[i];
    const l    = smooth(lms[i], i);
    st.l       = l;
    const y    = l[8].y;   // index finger tip

    // คำนวณ dy และ speed จาก prevY ที่เก็บไว้ก่อน
    let dy = 0;
    if (st.prevY !== null && st.prevT !== null) {
      dy = y - st.prevY;                          // ← prevY = frame ที่แล้ว ✅
      const dt = Math.max((now - st.prevT) / 1000, 0.001);
      const rawSpd = Math.abs(dy) / dt;
      // ✅ smooth speed ด้วย EMA เพื่อลด noise จาก fps ไม่สม่ำเสมอ
      st.smoothSpd = 0.4 * st.smoothSpd + 0.6 * rawSpd;
    }
    st.dy    = dy;          // เก็บ dy ของ frame นี้ไว้ใช้ด้านล่าง
    st.prevY = y;           // ← update หลังใช้แล้ว ✅
    st.prevT = now;
  }

  // ── กำหนด strumHand = มือที่เคลื่อนที่เร็วที่สุด ──
  let strumIdx = 0;
  if (lms.length === 2) {
    strumIdx = hState[0].smoothSpd >= hState[1].smoothSpd ? 0 : 1;
  }
  const chordIdx = lms.length === 2 ? 1 - strumIdx : 0;

  // ── วาด landmarks + debug ──
  for (let i = 0; i < lms.length; i++) {
    const isStrum = i === strumIdx;
    const color   = isStrum ? "#ff5555" : "#55aaff";
    const st      = hState[i];
    if (!st.l) continue;

    // dots
    ctx.fillStyle = color;
    st.l.forEach(p => {
      ctx.beginPath();
      ctx.arc((1-p.x)*canvas.width, p.y*canvas.height, 5, 0, 2*Math.PI);
      ctx.fill();
    });

    // debug line
    const openN = countOpenFingers(st.l);
    const five  = isFiveFingers(st.l);
    ctx.font = "bold 13px monospace";
    ctx.fillStyle = color;
    ctx.fillText(
      (isStrum ? "[STRUM]" : "[CHORD]")
      + " f:" + openN
      + " 5:" + five
      + " spd:" + st.smoothSpd.toFixed(2)
      + " dy:" + (st.dy || 0).toFixed(3),
      10, 75 + i * 20
    );
  }

  // ── 5-finger countdown (ตรวจทุกมือ) ──
  let anyFive = false;
  for (let i = 0; i < lms.length; i++) {
    if (!hState[i].l) continue;
    if (isFiveFingers(hState[i].l) && !countdownActive && !isPlaying) {
      anyFive = true;
      if (fiveFingerIdx !== i) { fiveFingerIdx = i; fiveFingerTime = now; }
      const prog = Math.min((now - fiveFingerTime) / HOLD_MS, 1);
      drawProgressBar(prog);
      if (prog >= 1) {
        fiveFingerIdx = fiveFingerTime = null;
        triggerCountdown();  // ✅ countdownActive = true sync ภายในฟังก์ชัน
      }
      break;
    }
  }
  if (!anyFive && !countdownActive) {
    fiveFingerIdx = fiveFingerTime = null;
  }

  // ── Chord detection ──
  const cSt = hState[chordIdx];
  if (cSt?.l && !isFiveFingers(cSt.l)) {
    // Thumb up (นิ้วโป้งสูง + 4 นิ้วหุบ) = pause/resume
    const openN   = countOpenFingers(cSt.l);
    const thumbUp = cSt.l[4].y < cSt.l[2].y && openN === 0;
    if (thumbUp && isPlaying && now - lastThumbToggle > 700) {
      isPlaying = !isPlaying;
      lastThumbToggle = now;
      updateTitle();
    }

    if (isPlaying) {
      const ch = detectChord(cSt.l);
      if (ch !== currentChord && now - lastChordChange > 300) {
        currentChord    = ch;
        lastChordChange = now;
        updateTitle();
      }
    }
  }

  // ── Strum detection ──
  // ✅ FIX CRITICAL: ใช้ st.dy ที่คำนวณก่อน update prevY ✅
  const sSt = hState[strumIdx];
  if (sSt?.l && sSt.dy !== undefined) {
    const THRESH = 0.032;
    if (Math.abs(sSt.dy) > THRESH && now - lastStrumTime > 110) {
      // velocity จาก smoothed speed, clamp 0.2–1.0
      const vel = Math.min(Math.max(sSt.smoothSpd / 4, 0.2), 1.0);
      playStrum(vel);
      lastStrumTime = now;
      drawStrumArrow(sSt.dy > 0 ? "▼" : "▲", vel);
    }
  }
});

// =======================
// 🖌️ Draw helpers
// =======================

function drawStrumArrow(arrow, vel) {
  const sz = 22 + vel * 22;
  ctx.save();
  ctx.globalAlpha = 0.5 + vel * 0.5;
  ctx.fillStyle   = vel > 0.6 ? "#ff6600" : "#ffdd00";
  ctx.font        = "bold " + sz + "px sans-serif";
  ctx.textAlign   = "center";
  ctx.fillText(arrow + " STRUM", canvas.width/2, 68);
  ctx.restore();
}

function drawProgressBar(prog) {
  const bx = canvas.width * 0.15;
  const by = canvas.height - 42;
  const bw = canvas.width * 0.7;
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(bx, by, bw, 20);
  ctx.fillStyle = "#00ffcc";
  ctx.fillRect(bx, by, bw * prog, 20);
  ctx.fillStyle = "white";
  ctx.font = "bold 13px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("✋ ชู 5 นิ้วค้างไว้เพื่อเริ่ม…", canvas.width/2, by - 8);
  ctx.textAlign = "left";
}

// =======================
// 📷 Camera
// =======================

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" },
      audio: false
    });
    video.srcObject = stream;
    await new Promise(r => { video.onloadedmetadata = r; });
    await video.play();
    processFrame();
    console.log("✅ Camera ready");
  } catch(e) {
    showError("❌ กล้อง: " + e.message);
  }
}

async function processFrame() {
  if (video.readyState >= 2) await hands.send({ image: video });
  requestAnimationFrame(processFrame);
}

startCamera();
