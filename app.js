// ============================================================
// 🎸 Virtual Guitar Pro — Bug Fixed
// ============================================================

// =======================
// 🔊 AUDIO SETUP
// =======================

let audioReady = false;

async function ensureAudio() {
  if (audioReady) return;
  try {
    await Tone.start();
    audioReady = true;
  } catch (e) {
    showError("❌ เปิดเสียงไม่ได้: " + e.message);
  }
}

document.addEventListener("click", ensureAudio, { once: true });

// ✅ FIX #2: Audio chain ที่ถูกต้อง
// guitar → masterVol → reverb → Tone.Destination (ลำโพง)
// ไม่ redirect Tone.Destination ไป recorder → เสียงออกลำโพงได้ปกติ
const reverb   = new Tone.Reverb({ decay: 2.5, wet: 0.35 }).toDestination();
const masterVol = new Tone.Volume(6).connect(reverb);

const guitar = new Tone.PluckSynth({
  attackNoise: 1.2,
  dampening: 4000,
  resonance: 0.98
}).connect(masterVol);

// =======================
// 🎤 Auto Gain Control (Mic)
// ✅ FIX #1: ลบ Tone.Gate ออก (ไม่มีใน Tone.js v14+)
//            ใช้ Tone.Compressor อย่างเดียวแทน
// =======================

const audioContext = Tone.getContext().rawContext;
const recordDestination = audioContext.createMediaStreamDestination();

// ✅ FIX #2: ไม่ทำ Tone.Destination.connect(recordDestination)
// แยก branch: กีต้าร์ออกลำโพงผ่าน Tone.Destination ตามปกติ
// recorder จะรับเสียงจาก canvas stream + mic stream แทน

const micCompressor = new Tone.Compressor({
  threshold: -24,
  ratio: 4,
  attack: 0.003,
  release: 0.25
});
// micCompressor ไม่ connect ไป Destination — ใช้สำหรับ record เท่านั้น

let micStream;
let micSource;

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
let isPlaying = false;

// =======================
// 🎸 Strum Physics
// =======================

let prevRightY    = null;
let prevRightTime = null;

async function playStrum(velocity) {
  await ensureAudio();
  if (!audioReady) return;

  const notes = chords[currentChord];
  if (!notes) return;

  // ✅ FIX #6: cancelScheduledValues ก่อน ramp ทุกครั้ง
  masterVol.volume.cancelScheduledValues(Tone.now());
  const volumeDb = -20 + velocity * 20;
  masterVol.volume.rampTo(volumeDb, 0.05);

  // spread: ดีดช้า = กว้าง, ดีดเร็ว = แน่น
  const spread = 0.02 + (1 - velocity) * 0.06;

  // ✅ FIX #4: attackNoise เป็น read-only หลัง construct
  // ใช้ velocity ผ่าน Volume แทน (แก้ไขแล้วข้างบน) — ลบ guitar.attackNoise = ออก

  const now = Tone.now();
  notes.forEach((note, i) => {
    guitar.triggerAttack(note, now + i * spread);
  });
}

// =======================
// 🎼 Song Scroll
// =======================

let songData;
let currentIndex = 0;
let scrollTimer  = null;

function sanitizeJSON(text) {
  return text
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");
}

fetch("song.json")
  .then(res => {
    if (!res.ok) throw new Error("HTTP error: " + res.status);
    return res.text();
  })
  .then(text => JSON.parse(sanitizeJSON(text)))
  .then(data => {
    songData = data;
    renderLyrics();
  })
  .catch(err => {
    console.error("Song load failed:", err);
    showError("❌ โหลดเพลงไม่ได้ กรุณารันผ่าน Web Server");
  });

function showError(msg) {
  const el = document.getElementById("error-msg");
  if (el) { el.textContent = msg; el.style.display = "block"; }
}

function renderLyrics() {
  const container = document.getElementById("lyrics");
  if (container.children.length === 0) {
    songData.lines.forEach((line, index) => {
      const div = document.createElement("div");
      div.className = "line";
      div.id = "line-" + index;
      div.innerHTML = "<b>" + line.chord + "</b> " + line.lyric;
      container.appendChild(div);
    });
  }
  container.querySelectorAll(".line").forEach((el, i) => {
    el.classList.toggle("active", i === currentIndex);
  });

  // ✅ FIX #3: ใช้ scrollTop แทน scrollIntoView (overflow:hidden ขัด scrollIntoView)
  const activeLine = document.getElementById("line-" + currentIndex);
  if (activeLine) {
    const containerRect = container.getBoundingClientRect();
    const lineRect      = activeLine.getBoundingClientRect();
    const offset        = lineRect.top - containerRect.top - (container.clientHeight / 2) + (activeLine.clientHeight / 2);
    container.scrollTop += offset;
  }
}

function startScroll() {
  if (scrollTimer) clearInterval(scrollTimer);
  scrollTimer = setInterval(() => {
    if (!isPlaying || !songData) return;
    currentIndex++;
    if (currentIndex >= songData.lines.length) currentIndex = 0;
    renderLyrics();
  }, songData.scrollSpeed);
}

// =======================
// ⏳ Countdown (5-finger gesture)
// =======================

let countdownActive     = false;
let fiveFingerStartTime = null;
const FIVE_FINGER_HOLD  = 800;

function showCountdown(num) {
  const el = document.getElementById("countdown-overlay");
  if (!el) return;
  if (num === null) {
    el.style.display = "none";
    el.textContent   = "";
  } else {
    el.style.display = "flex";
    el.textContent   = num === 0 ? "🎸 GO!" : num + "…";
  }
}

function triggerCountdown() {
  if (countdownActive) return;
  countdownActive     = true;
  fiveFingerStartTime = null;

  let count = 3;
  showCountdown(count);

  const interval = setInterval(async () => {
    count--;
    if (count > 0) {
      showCountdown(count);
    } else {
      showCountdown(0);
      await ensureAudio();
      isPlaying = true;
      startScroll();
      setTimeout(() => {
        showCountdown(null);
        countdownActive = false;
        document.getElementById("title").innerText = "🎸 Current Chord: " + currentChord;
      }, 800);
      clearInterval(interval);
    }
  }, 1000);
}

// =======================
// 🧠 Debounce
// =======================

let lastChordChange = 0;
let lastThumbToggle = 0;

function canTrigger(last, delay) {
  return Date.now() - last > delay;
}

// =======================
// 🎯 Smoothing
// =======================

const smoothedLandmarks = { Left: null, Right: null };

function smoothLandmarks(newLandmarks, hand) {
  if (!smoothedLandmarks[hand]) {
    smoothedLandmarks[hand] = JSON.parse(JSON.stringify(newLandmarks));
    return newLandmarks;
  }
  const alpha = 0.7;
  for (let i = 0; i < newLandmarks.length; i++) {
    smoothedLandmarks[hand][i].x =
      alpha * smoothedLandmarks[hand][i].x + (1 - alpha) * newLandmarks[i].x;
    smoothedLandmarks[hand][i].y =
      alpha * smoothedLandmarks[hand][i].y + (1 - alpha) * newLandmarks[i].y;
  }
  return smoothedLandmarks[hand];
}

function resetSmoothing(hand) {
  smoothedLandmarks[hand] = null;
}

// =======================
// ✋ Gesture Logic
// =======================

function isFingerOpen(l, tip, pip) {
  return l[tip].y < l[pip].y;
}

function countOpenFingers(l) {
  let count = 0;
  if (isFingerOpen(l, 8,  6))  count++;
  if (isFingerOpen(l, 12, 10)) count++;
  if (isFingerOpen(l, 16, 14)) count++;
  if (isFingerOpen(l, 20, 18)) count++;
  return count;
}

function isThumbOpen(l) {
  // ✅ FIX #5: กล้อง mirror → x flip → ต้องใช้ > แทน <
  // Left hand label ใน MediaPipe หลัง mirror = มือขวาจริงของผู้ใช้
  return l[4].x > l[3].x;
}

function isFiveFingers(l) {
  return countOpenFingers(l) >= 4 && isThumbOpen(l);
}

function isThumbUp(l) {
  return l[4].y < l[3].y && countOpenFingers(l) <= 1;
}

function detectChord(l) {
  const open = countOpenFingers(l);
  if (open === 0) return "Dmaj7";
  if (open === 1) return "Gmaj7";
  if (open === 2) return "F#m7";
  if (open >= 3)  return "Em7";
  return currentChord;
}

// =======================
// 🎥 RECORDING
// =======================

let mediaRecorder;
let recordedChunks = [];

async function startRecording() {
  recordedChunks = [];
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    showError("❌ ไม่สามารถเข้าถึงไมโครโฟน: " + err.message);
    return;
  }

  // ✅ FIX #2: mic → compressor → recordDestination (แยกจาก Tone.Destination)
  micSource = audioContext.createMediaStreamSource(micStream);
  const compNode = micCompressor.input;
  micSource.connect(compNode);
  micCompressor.connect(recordDestination);

  const canvasStream   = canvas.captureStream(30);
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...recordDestination.stream.getAudioTracks()
  ]);

  mediaRecorder = new MediaRecorder(combinedStream);
  mediaRecorder.ondataavailable = e => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };
  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: "video/webm" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = "virtual-guitar-live.webm";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  mediaRecorder.start();
  console.log("🎥 Recording started");
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === "inactive") return;
  mediaRecorder.stop();
  if (micStream) micStream.getTracks().forEach(t => t.stop());
}

// =======================
// 🎥 Camera + MediaPipe
// =======================

const video  = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx    = canvas.getContext("2d");

canvas.width  = 640;
canvas.height = 480;

let lastStrumTime = 0;

const hands = new Hands({
  locateFile: file => "https://cdn.jsdelivr.net/npm/@mediapipe/hands/" + file
});

hands.setOptions({
  maxNumHands: 2,
  minDetectionConfidence: 0.7,
  minTrackingConfidence:  0.7
});

hands.onResults(results => {
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(results.image, -canvas.width, 0, canvas.width, canvas.height);
  ctx.restore();

  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    prevRightY          = null;
    prevRightTime       = null;
    fiveFingerStartTime = null;
    resetSmoothing("Left");
    resetSmoothing("Right");
    return;
  }

  const handsInFrame = new Set(results.multiHandedness.map(h => h.label));
  if (!handsInFrame.has("Left"))  resetSmoothing("Left");
  if (!handsInFrame.has("Right")) {
    resetSmoothing("Right");
    prevRightY    = null;
    prevRightTime = null;
  }

  for (let i = 0; i < results.multiHandLandmarks.length; i++) {
    const raw    = results.multiHandLandmarks[i];
    const handed = results.multiHandedness[i].label;
    const l      = smoothLandmarks(raw, handed);

    // ---- LEFT HAND ----
    if (handed === "Left") {

      // 5-finger countdown
      if (isFiveFingers(l) && !countdownActive) {
        if (!fiveFingerStartTime) {
          fiveFingerStartTime = Date.now();
        } else if (Date.now() - fiveFingerStartTime > FIVE_FINGER_HOLD) {
          triggerCountdown();
        }
        const progress = Math.min((Date.now() - fiveFingerStartTime) / FIVE_FINGER_HOLD, 1);
        drawFiveFingerIndicator(progress);
      } else if (!countdownActive) {
        fiveFingerStartTime = null;
      }

      // Thumb up = pause/resume
      if (isThumbUp(l) && isPlaying) {
        if (canTrigger(lastThumbToggle, 500)) {
          isPlaying       = !isPlaying;
          lastThumbToggle = Date.now();
          document.getElementById("title").innerText =
            "🎸 " + currentChord + (isPlaying ? "" : " (Paused)");
        }
      }

      // Chord detection
      if (!isFiveFingers(l)) {
        const newChord = detectChord(l);
        if (newChord !== currentChord && canTrigger(lastChordChange, 300)) {
          currentChord    = newChord;
          lastChordChange = Date.now();
          document.getElementById("title").innerText =
            "🎸 Current Chord: " + currentChord + (isPlaying ? "" : " (Paused)");
        }
      }

      drawLandmarks(l, "#00aaff");
    }

    // ---- RIGHT HAND — Strum Physics ----
    if (handed === "Right") {
      const y   = l[8].y;
      const now = Date.now();

      if (prevRightY !== null && prevRightTime !== null && isPlaying) {
        const dy    = y - prevRightY;
        const dt    = (now - prevRightTime) / 1000;
        const speed = Math.abs(dy) / (dt + 0.001);
        const THRESHOLD = 0.04;

        if (Math.abs(dy) > THRESHOLD && (now - lastStrumTime) > 100) {
          const velocity  = Math.min(speed / 4, 1);
          const direction = dy > 0 ? "down" : "up";
          playStrum(velocity);
          lastStrumTime = now;
          drawStrumIndicator(direction, velocity);
        }
      }

      prevRightY    = y;
      prevRightTime = now;
      drawLandmarks(l, "#ff4444");
    }
  }
});

// =======================
// 🖌️ Draw Helpers
// =======================

function drawLandmarks(l, color) {
  ctx.fillStyle = color;
  for (let j = 0; j < l.length; j++) {
    const x = (1 - l[j].x) * canvas.width;
    const y = l[j].y * canvas.height;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, 2 * Math.PI);
    ctx.fill();
  }
}

function drawStrumIndicator(direction, velocity) {
  const arrow = direction === "down" ? "▼ DOWN" : "▲ UP";
  const size  = 20 + velocity * 20;
  const alpha = 0.4 + velocity * 0.6;
  ctx.globalAlpha = alpha;
  ctx.fillStyle   = velocity > 0.6 ? "#ff6600" : "#ffcc00";
  ctx.font        = "bold " + size + "px sans-serif";
  ctx.textAlign   = "center";
  ctx.fillText(arrow, canvas.width / 2, 50);
  ctx.globalAlpha = 1;
  ctx.textAlign   = "left";
}

function drawFiveFingerIndicator(progress) {
  const barW = canvas.width * 0.6;
  const x    = canvas.width * 0.2;
  const y    = canvas.height - 30;
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(x, y, barW, 16);
  ctx.fillStyle = "#00ffcc";
  ctx.fillRect(x, y, barW * progress, 16);
  ctx.fillStyle   = "white";
  ctx.font        = "12px sans-serif";
  ctx.textAlign   = "center";
  ctx.fillText("ชู 5 นิ้วค้างเพื่อเริ่ม...", canvas.width / 2, y - 5);
  ctx.textAlign   = "left";
}

// =======================
// 📷 Start Camera
// =======================

async function startCamera() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" },
      audio: false
    });
  } catch (err) {
    showError("❌ เปิดกล้องไม่ได้: " + err.message);
    return;
  }

  video.srcObject = stream;
  video.onloadedmetadata = () => {
    video.play();
    processFrame();
  };
}

async function processFrame() {
  if (video.readyState >= 2) {
    await hands.send({ image: video });
  }
  requestAnimationFrame(processFrame);
}

startCamera();
