// ============================================================
// 🎸 Virtual Guitar Pro — Final Fix
// ============================================================

// =======================
// 🔊 AUDIO SETUP
// =======================

let audioReady = false;

// ✅ FIX B: เรียก ensureAudio ทุกครั้งที่ user interact กับหน้า
//    ไม่ใช่แค่ click once — เพราะ countdown อยู่ใน setInterval
//    ไม่ใช่ direct gesture
async function ensureAudio() {
  if (audioReady) return;
  try {
    await Tone.start();
    audioReady = true;
    console.log("✅ AudioContext started");
  } catch (e) {
    console.error("Audio start failed:", e);
    showError("❌ เปิดเสียงไม่ได้: " + e.message);
  }
}

// ✅ FIX B: ดัก user gesture หลายแบบเพื่อ unlock AudioContext ให้ได้เร็วที่สุด
["click","touchstart","keydown"].forEach(evt =>
  document.addEventListener(evt, ensureAudio, { once: true })
);

// ✅ FIX D: สร้าง audio nodes ทั้งหมดก่อน แล้วค่อย init
//    Reverb ต้อง generate IR (async) ก่อนใช้งาน
let reverb, masterVol, guitar;

async function initAudioNodes() {
  reverb = new Tone.Reverb({ decay: 2.5, wet: 0.35 });
  await reverb.generate(); // ✅ รอ IR generate เสร็จ
  reverb.toDestination();

  masterVol = new Tone.Volume(0).connect(reverb);

  guitar = new Tone.PluckSynth({
    attackNoise: 1.2,
    dampening: 4000,
    resonance: 0.98
  }).connect(masterVol);

  console.log("✅ Audio nodes ready");
}

// เริ่ม init ทันที (ไม่รอ user gesture — node สร้างได้แต่ play ไม่ได้)
initAudioNodes();

// =======================
// 🎤 Mic / Recording
// =======================

const audioContext    = Tone.getContext().rawContext;
const recordDest      = audioContext.createMediaStreamDestination();
let micStream, micSource;

// =======================
// 🎸 Chords
// =======================

const chords = {
  "Gmaj7": ["G3","B3","D4","F#4"],
  "F#m7":  ["F#3","A3","C#4","E4"],
  "Em7":   ["E3","G3","B3","D4"],
  "Dmaj7": ["D3","F#3","A3","C#4"]
};

let currentChord = "Gmaj7";

// ✅ FIX C: isPlaying เริ่มเป็น false รอ 5 นิ้ว แต่ดีดเสียงได้เสมอ
//    แยก isPlaying (scroll) กับ canStrum (เสียง) ออกจากกัน
let isPlaying = false;  // ควบคุม scroll เพลง
let canStrum  = true;   // ✅ ดีดเสียงได้เสมอ ไม่ต้องรอ countdown

// =======================
// 🎸 Strum Physics
// =======================

let prevRightY    = null;
let prevRightTime = null;

async function playStrum(velocity) {
  await ensureAudio();
  if (!audioReady || !guitar || !masterVol) return;

  const notes = chords[currentChord];
  if (!notes) return;

  // velocity → volume
  masterVol.volume.cancelScheduledValues(Tone.now());
  const volumeDb = -18 + velocity * 18;  // -18dB (เบา) → 0dB (แรง)
  masterVol.volume.rampTo(volumeDb, 0.04);

  // velocity → spread
  const spread = 0.015 + (1 - velocity) * 0.055;

  const now = Tone.now();
  notes.forEach((note, i) => {
    guitar.triggerAttack(note, now + i * spread);
  });

  console.log("🎸 strum", currentChord, "vel:", velocity.toFixed(2));
}

// =======================
// 🎼 Song Scroll
// =======================

let songData, currentIndex = 0, scrollTimer = null;

function sanitizeJSON(text) {
  return text
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");
}

fetch("song.json")
  .then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })
  .then(t => JSON.parse(sanitizeJSON(t)))
  .then(data => { songData = data; renderLyrics(); })
  .catch(() => showError("❌ โหลดเพลงไม่ได้ กรุณารันผ่าน Web Server"));

function showError(msg) {
  const el = document.getElementById("error-msg");
  if (el) { el.textContent = msg; el.style.display = "block"; }
}

function renderLyrics() {
  const c = document.getElementById("lyrics");
  if (c.children.length === 0) {
    songData.lines.forEach((line, i) => {
      const d = document.createElement("div");
      d.className = "line";
      d.id = "line-" + i;
      d.innerHTML = "<b>" + line.chord + "</b> " + line.lyric;
      c.appendChild(d);
    });
  }
  c.querySelectorAll(".line").forEach((el, i) => el.classList.toggle("active", i === currentIndex));
  const active = document.getElementById("line-" + currentIndex);
  if (active) {
    const offset = active.offsetTop - c.clientHeight / 2 + active.clientHeight / 2;
    c.scrollTop = offset;
  }
}

function startScroll() {
  if (scrollTimer) clearInterval(scrollTimer);
  scrollTimer = setInterval(() => {
    if (!isPlaying || !songData) return;
    currentIndex = (currentIndex + 1) % songData.lines.length;
    renderLyrics();
  }, songData.scrollSpeed);
}

// =======================
// ⏳ Countdown (5-finger gesture)
// =======================

let countdownActive = false, fiveFingerStartTime = null;
const FIVE_FINGER_HOLD = 800;

function showCountdown(num) {
  const el = document.getElementById("countdown-overlay");
  if (!el) return;
  if (num === null) { el.style.display = "none"; return; }
  el.style.display = "flex";
  el.textContent   = num === 0 ? "🎸 GO!" : num + "…";
}

// ✅ FIX B: AudioContext unlock ด้วย button ก่อน countdown
//    triggerCountdown เรียก ensureAudio ตรงๆ และรอให้ ready
async function triggerCountdown() {
  if (countdownActive) return;
  countdownActive     = true;
  fiveFingerStartTime = null;

  // ✅ unlock audio ก่อนนับ
  await ensureAudio();

  let count = 3;
  showCountdown(count);

  const interval = setInterval(() => {
    count--;
    if (count > 0) {
      showCountdown(count);
    } else {
      showCountdown(0);
      isPlaying = true;
      startScroll();
      setTimeout(() => {
        showCountdown(null);
        countdownActive = false;
        updateTitle();
      }, 800);
      clearInterval(interval);
    }
  }, 1000);
}

function updateTitle() {
  document.getElementById("title").innerText =
    "🎸 " + currentChord + (isPlaying ? "" : " (Paused)");
}

// =======================
// 🧠 Debounce
// =======================

let lastChordChange = 0, lastThumbToggle = 0;
function canTrigger(last, delay) { return Date.now() - last > delay; }

// =======================
// 🎯 Smoothing
// =======================

const smoothedLandmarks = { Left: null, Right: null };

function smoothLandmarks(pts, hand) {
  if (!smoothedLandmarks[hand]) {
    smoothedLandmarks[hand] = JSON.parse(JSON.stringify(pts));
    return pts;
  }
  const a = 0.7;
  pts.forEach((p, i) => {
    smoothedLandmarks[hand][i].x = a * smoothedLandmarks[hand][i].x + (1-a) * p.x;
    smoothedLandmarks[hand][i].y = a * smoothedLandmarks[hand][i].y + (1-a) * p.y;
  });
  return smoothedLandmarks[hand];
}

function resetSmoothing(hand) { smoothedLandmarks[hand] = null; }

// =======================
// ✋ Gesture Logic
// =======================

function isFingerOpen(l, tip, pip) { return l[tip].y < l[pip].y; }

function countOpenFingers(l) {
  let n = 0;
  [[8,6],[12,10],[16,14],[20,18]].forEach(([t,p]) => { if (isFingerOpen(l,t,p)) n++; });
  return n;
}

// ✅ FIX A: MediaPipe label กับ mirrored camera
// เมื่อกล้อง mirror แล้ว:
//   MediaPipe "Left"  label = มือซ้ายของคนจริง  = ด้านขวาในภาพ
//   MediaPipe "Right" label = มือขวาของคนจริง = ด้านซ้ายในภาพ
// โค้ดเดิมใช้ handed==="Left" เป็น chord hand ซึ่งถูกต้องในแง่ชีวภาพ
// แต่ thumbOpen direction ต้อง account for mirror
//
// นิ้วโป้งมือซ้ายจริง (label="Left") เมื่อกาง: l[4].x > l[3].x (ในพิกัด mediapipe ก่อน mirror)
// หลัง mirror ใน canvas เราวาด (1-x)*W แต่ landmark ยัง raw อยู่
// ดังนั้น isThumbOpen สำหรับ Left hand ใช้ l[4].x > l[3].x ✅

function isThumbOpen(l, hand) {
  if (hand === "Left")  return l[4].x > l[3].x;  // มือซ้ายจริง นิ้วโป้งชี้ขวา
  if (hand === "Right") return l[4].x < l[3].x;  // มือขวาจริง นิ้วโป้งชี้ซ้าย
  return false;
}

function isFiveFingers(l, hand) {
  return countOpenFingers(l) >= 4 && isThumbOpen(l, hand);
}

function isThumbUp(l) {
  return l[4].y < l[2].y && countOpenFingers(l) === 0;
  // นิ้วโป้งสูงกว่า base มือ + 4 นิ้วอื่นหุบ
}

function detectChord(l) {
  const open = countOpenFingers(l);
  if (open === 0) return "Dmaj7";
  if (open === 1) return "Gmaj7";
  if (open === 2) return "F#m7";
  return "Em7";
}

// =======================
// 🎥 Recording
// =======================

let mediaRecorder, recordedChunks = [];

async function startRecording() {
  recordedChunks = [];
  try { micStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { showError("❌ ไมค์: " + e.message); return; }

  micSource = audioContext.createMediaStreamSource(micStream);
  micSource.connect(recordDest);

  const combined = new MediaStream([
    ...canvas.captureStream(30).getVideoTracks(),
    ...recordDest.stream.getAudioTracks()
  ]);

  mediaRecorder = new MediaRecorder(combined);
  mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onstop = () => {
    const url = URL.createObjectURL(new Blob(recordedChunks, { type:"video/webm" }));
    Object.assign(document.createElement("a"), { href: url, download: "guitar.webm" }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  mediaRecorder.start();
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  if (micStream) micStream.getTracks().forEach(t => t.stop());
}

// =======================
// 🎥 Camera + MediaPipe
// =======================

const video  = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx    = canvas.getContext("2d");
canvas.width = 640; canvas.height = 480;

let lastStrumTime = 0;

const hands = new Hands({ locateFile: f => "https://cdn.jsdelivr.net/npm/@mediapipe/hands/" + f });
hands.setOptions({ maxNumHands: 2, minDetectionConfidence: 0.7, minTrackingConfidence: 0.7 });

// ✅ เพิ่ม debug overlay บน canvas เพื่อเห็นว่า detect อะไรอยู่
function drawDebugInfo(handed, openFingers, thumbOpen) {
  ctx.fillStyle = handed === "Left" ? "#00aaff" : "#ff4444";
  ctx.font = "bold 14px monospace";
  ctx.textAlign = "left";
  const y = handed === "Left" ? 80 : 100;
  ctx.fillText(handed + " | fingers:" + openFingers + " | thumb:" + thumbOpen + " | play:" + isPlaying, 10, y);
}

hands.onResults(results => {
  // วาด mirror
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(results.image, -canvas.width, 0, canvas.width, canvas.height);
  ctx.restore();

  // ✅ วาด chord + status ตลอดเวลา
  ctx.fillStyle = "#00ffcc";
  ctx.font = "bold 18px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(currentChord + (isPlaying ? " ▶" : " ⏸"), canvas.width / 2, 30);
  ctx.textAlign = "left";

  if (!results.multiHandLandmarks?.length) {
    prevRightY = prevRightTime = null;
    fiveFingerStartTime = null;
    resetSmoothing("Left"); resetSmoothing("Right");
    return;
  }

  const inFrame = new Set(results.multiHandedness.map(h => h.label));
  if (!inFrame.has("Left"))  resetSmoothing("Left");
  if (!inFrame.has("Right")) { resetSmoothing("Right"); prevRightY = prevRightTime = null; }

  for (let i = 0; i < results.multiHandLandmarks.length; i++) {
    const handed = results.multiHandedness[i].label;
    const l      = smoothLandmarks(results.multiHandLandmarks[i], handed);
    const openN  = countOpenFingers(l);
    const tOpen  = isThumbOpen(l, handed);

    drawDebugInfo(handed, openN, tOpen);

    // ---- LEFT HAND = Chord + 5-finger ----
    if (handed === "Left") {

      // 5-finger hold → countdown
      if (isFiveFingers(l, handed) && !countdownActive) {
        if (!fiveFingerStartTime) fiveFingerStartTime = Date.now();
        else if (Date.now() - fiveFingerStartTime > FIVE_FINGER_HOLD) triggerCountdown();
        drawFiveFingerIndicator(Math.min((Date.now()-fiveFingerStartTime)/FIVE_FINGER_HOLD, 1));
      } else if (!countdownActive) {
        fiveFingerStartTime = null;
      }

      // Thumb up = pause/resume
      if (isThumbUp(l) && canTrigger(lastThumbToggle, 600)) {
        isPlaying = !isPlaying;
        lastThumbToggle = Date.now();
        updateTitle();
      }

      // Chord
      if (!isFiveFingers(l, handed)) {
        const ch = detectChord(l);
        if (ch !== currentChord && canTrigger(lastChordChange, 300)) {
          currentChord = ch;
          lastChordChange = Date.now();
          updateTitle();
        }
      }

      drawLandmarks(l, "#00aaff");
    }

    // ---- RIGHT HAND = Strum ----
    // ✅ FIX C: canStrum = true เสมอ ไม่ต้องรอ isPlaying
    if (handed === "Right") {
      const y   = l[8].y;
      const now = Date.now();

      if (prevRightY !== null && prevRightTime !== null) {
        const dy    = y - prevRightY;
        const dt    = (now - prevRightTime) / 1000;
        const speed = Math.abs(dy) / (dt + 0.001);

        if (Math.abs(dy) > 0.04 && (now - lastStrumTime) > 100) {
          const vel = Math.min(speed / 4, 1);
          playStrum(vel);
          lastStrumTime = now;
          drawStrumIndicator(dy > 0 ? "down" : "up", vel);
        }
      }
      prevRightY = y; prevRightTime = now;
      drawLandmarks(l, "#ff4444");
    }
  }
});

// =======================
// 🖌️ Draw Helpers
// =======================

function drawLandmarks(l, color) {
  ctx.fillStyle = color;
  l.forEach(p => {
    ctx.beginPath();
    ctx.arc((1-p.x)*canvas.width, p.y*canvas.height, 5, 0, 2*Math.PI);
    ctx.fill();
  });
}

function drawStrumIndicator(dir, vel) {
  const size = 22 + vel * 22;
  ctx.globalAlpha = 0.5 + vel * 0.5;
  ctx.fillStyle   = vel > 0.6 ? "#ff6600" : "#ffcc00";
  ctx.font        = "bold " + size + "px sans-serif";
  ctx.textAlign   = "center";
  ctx.fillText(dir === "down" ? "▼ STRUM" : "▲ STRUM", canvas.width/2, 65);
  ctx.globalAlpha = 1;
  ctx.textAlign   = "left";
}

function drawFiveFingerIndicator(progress) {
  const bx = canvas.width * 0.2, by = canvas.height - 35, bw = canvas.width * 0.6;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(bx, by, bw, 18);
  ctx.fillStyle = "#00ffcc";
  ctx.fillRect(bx, by, bw * progress, 18);
  ctx.fillStyle = "white";
  ctx.font = "bold 13px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("✋ ชู 5 นิ้วค้างเพื่อเริ่ม", canvas.width/2, by - 6);
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
    await new Promise(r => video.onloadedmetadata = r);
    video.play();
    processFrame();
    console.log("✅ Camera ready");
  } catch (e) {
    showError("❌ กล้อง: " + e.message);
  }
}

async function processFrame() {
  if (video.readyState >= 2) await hands.send({ image: video });
  requestAnimationFrame(processFrame);
}

startCamera();
