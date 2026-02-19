// =======================
// 🎸 Guitar Sound (Pro Version)
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

const reverb = new Tone.Reverb({
  decay: 2,
  wet: 0.3
}).toDestination();

const guitar = new Tone.PluckSynth({
  attackNoise: 1,
  dampening: 3500,
  resonance: 0.95
}).connect(reverb);

const chords = {
  "Gmaj7": ["G3","B3","D4","F#4"],
  "F#m7":  ["F#3","A3","C#4","E4"],
  "Em7":   ["E3","G3","B3","D4"],
  "Dmaj7": ["D3","F#3","A3","C#4"]
};

let currentChord = "Gmaj7";
let isPlaying = true;

async function playStrum(direction) {
  await ensureAudio();
  if (!audioReady) return;

  const notes = chords[currentChord];
  if (!notes) return;

  const now = Tone.now();
  const seq = direction === "down" ? notes : [...notes].reverse();
  seq.forEach((note, i) => {
    guitar.triggerAttack(note, now + i * 0.035);
  });
}

// =======================
// 🎧 AUDIO ROUTING (Mic + Guitar)
// =======================

const audioContext = Tone.getContext().rawContext;
const destination = audioContext.createMediaStreamDestination();

Tone.Destination.connect(destination);

let micStream;
let micSource;

// =======================
// 🎼 Song Scroll
// =======================

let songData;
let currentIndex = 0;

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
    startScroll();
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
  const activeLine = document.getElementById("line-" + currentIndex);
  if (activeLine) activeLine.scrollIntoView({ behavior: "smooth", block: "center" });
}

function startScroll() {
  setInterval(() => {
    if (!isPlaying || !songData) return;
    currentIndex++;
    if (currentIndex >= songData.lines.length) currentIndex = 0;
    renderLyrics();
  }, songData.scrollSpeed);
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

function isThumbUp(l) {
  return l[4].y < l[3].y;
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

  micSource = audioContext.createMediaStreamSource(micStream);
  micSource.connect(destination);

  const canvasStream = canvas.captureStream(30);

  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...destination.stream.getAudioTracks()
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
  if (!mediaRecorder || mediaRecorder.state === "inactive") {
    console.warn("Recording not started yet.");
    return;
  }
  mediaRecorder.stop();
  if (micStream) {
    micStream.getTracks().forEach(track => track.stop());
  }
  console.log("⏹ Recording stopped");
}

// =======================
// 🎥 MediaPipe + Camera
// ✅ แก้ไข: ใช้ getUserMedia โดยตรงแทน Camera class จาก @mediapipe/camera_utils
//    เพราะ Camera class มีปัญหา CORS / module loading บน GitHub Pages
// =======================

const video  = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx    = canvas.getContext("2d");

canvas.width  = 640;
canvas.height = 480;

let lastRightY = null;
let lastStrumTime = 0;

const hands = new Hands({
  locateFile: file =>
    "https://cdn.jsdelivr.net/npm/@mediapipe/hands/" + file
});

hands.setOptions({
  maxNumHands: 2,
  minDetectionConfidence: 0.7,
  minTrackingConfidence:  0.7
});

hands.onResults(results => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(results.image, -canvas.width, 0, canvas.width, canvas.height);
  ctx.restore();

  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    lastRightY = null;
    resetSmoothing("Left");
    resetSmoothing("Right");
    return;
  }

  const handsInFrame = new Set(
    results.multiHandedness.map(h => h.label)
  );
  if (!handsInFrame.has("Left"))  resetSmoothing("Left");
  if (!handsInFrame.has("Right")) { resetSmoothing("Right"); lastRightY = null; }

  for (let i = 0; i < results.multiHandLandmarks.length; i++) {
    const raw    = results.multiHandLandmarks[i];
    const handed = results.multiHandedness[i].label;

    const l = smoothLandmarks(raw, handed);

    if (handed === "Left") {
      if (isThumbUp(l)) {
        if (canTrigger(lastThumbToggle, 500)) {
          isPlaying = !isPlaying;
          lastThumbToggle = Date.now();
        }
      }

      const newChord = detectChord(l);
      if (newChord !== currentChord && canTrigger(lastChordChange, 300)) {
        currentChord    = newChord;
        lastChordChange = Date.now();
        document.getElementById("title").innerText =
          "🎸 Current Chord: " + currentChord + (isPlaying ? "" : " (Paused)");
      }
    }

    if (handed === "Right") {
      const y = l[8].y;

      if (lastRightY !== null) {
        const now = Date.now();
        if (now - lastStrumTime > 120) {
          if (y - lastRightY > 0.07 && isPlaying) {
            playStrum("down");
            lastStrumTime = now;
          } else if (lastRightY - y > 0.07 && isPlaying) {
            playStrum("up");
            lastStrumTime = now;
          }
        }
      }

      lastRightY = y;
    }
  }
});

async function startCamera() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" },
      audio: false
    });
  } catch (err) {
    showError("❌ ไม่สามารถเปิดกล้องได้: " + err.message + " — กรุณาอนุญาต Camera permission");
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
