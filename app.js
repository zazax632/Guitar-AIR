// =======================
// 🎸 Guitar Sound (Pro Version)
// =======================

// ✅ FIX P0#1: Tone.start() ต้องรอ user gesture (Chrome policy)
// ย้ายไปเรียกครั้งแรกตอนผู้ใช้กด / strum แทนการ await ตอนโหลด
let audioReady = false;

async function ensureAudio() {
if (audioReady) return;
try {
await Tone.start();
audioReady = true;
} catch (e) {
showError(“❌ เปิดเสียงไม่ได้: “ + e.message);
}
}

// เรียก ensureAudio() เมื่อผู้ใช้คลิกครั้งแรกที่หน้า
document.addEventListener(“click”, ensureAudio, { once: true });

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
“Gmaj7”: [“G3”,“B3”,“D4”,“F#4”],
“F#m7”:  [“F#3”,“A3”,“C#4”,“E4”],
“Em7”:   [“E3”,“G3”,“B3”,“D4”],
“Dmaj7”: [“D3”,“F#3”,“A3”,“C#4”]
};

let currentChord = “Gmaj7”;
let isPlaying = true;

async function playStrum(direction) {
// ✅ FIX P0#1: ensure AudioContext ก่อนเล่นเสียงทุกครั้ง
await ensureAudio();
if (!audioReady) return;

const notes = chords[currentChord];
if (!notes) return;

const now = Tone.now();
const seq = direction === “down” ? notes : […notes].reverse();
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

// ✅ FIX P0#2: sanitize smart quotes ที่อาจมาจากการพิมพ์ใน Mac/Word
function sanitizeJSON(text) {
return text
.replace(/[\u201c\u201d]/g, ‘”’)  // “ “ → “
.replace(/[\u2018\u2019]/g, “’”); // ’ ’ → ’
}

fetch(“song.json”)
.then(res => {
if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
return res.text();
})
.then(text => JSON.parse(sanitizeJSON(text)))
.then(data => {
songData = data;
renderLyrics();
startScroll();
})
.catch(err => {
console.error(“Song load failed:”, err);
showError(“❌ โหลดเพลงไม่ได้ กรุณารันผ่าน Web Server (อย่าเปิดแบบ file://)”);
});

function showError(msg) {
const el = document.getElementById(“error-msg”);
if (el) { el.textContent = msg; el.style.display = “block”; }
}

// ✅ FIX #5: แก้ renderLyrics ไม่สร้าง DOM ใหม่ทุกครั้ง — ใช้ scrollIntoView แทน
function renderLyrics() {
const container = document.getElementById(“lyrics”);
// สร้าง DOM ครั้งแรกครั้งเดียว
if (container.children.length === 0) {
songData.lines.forEach((line, index) => {
const div = document.createElement(“div”);
div.className = “line”;
div.id = `line-${index}`;
div.innerHTML = `<b>${line.chord}</b> ${line.lyric}`;
container.appendChild(div);
});
}
// update active class เฉพาะ element ที่เปลี่ยน
container.querySelectorAll(”.line”).forEach((el, i) => {
el.classList.toggle(“active”, i === currentIndex);
});
// เลื่อน scroll ไปหา active line
const activeLine = document.getElementById(`line-${currentIndex}`);
if (activeLine) activeLine.scrollIntoView({ behavior: “smooth”, block: “center” });
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

let lastChordChange  = 0;
let lastThumbToggle  = 0;

function canTrigger(last, delay) {
return Date.now() - last > delay;
}

// =======================
// 🎯 Smoothing
// ✅ FIX #3: แยก smoothedLandmarks ตามมือ Left/Right ไม่ทับกัน
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

// ✅ FIX #3b: Reset smoothing เมื่อไม่พบมือนั้นในเฟรม
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
if (open === 0) return “Dmaj7”;
if (open === 1) return “Gmaj7”;
if (open === 2) return “F#m7”;
if (open >= 3)  return “Em7”;
return currentChord;
}

// =======================
// 🎥 RECORDING (Video + Mic + Guitar)
// =======================

let mediaRecorder;
let recordedChunks = [];

async function startRecording() {
recordedChunks = [];

// ✅ FIX: ขอ mic พร้อม error handling
try {
micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
} catch (err) {
showError(“❌ ไม่สามารถเข้าถึงไมโครโฟน: “ + err.message);
return;
}

micSource = audioContext.createMediaStreamSource(micStream);
micSource.connect(destination);

const canvasStream = canvas.captureStream(30);

const combinedStream = new MediaStream([
…canvasStream.getVideoTracks(),
…destination.stream.getAudioTracks()
]);

mediaRecorder = new MediaRecorder(combinedStream);

mediaRecorder.ondataavailable = e => {
if (e.data.size > 0) recordedChunks.push(e.data);
};

mediaRecorder.onstop = () => {
const blob = new Blob(recordedChunks, { type: “video/webm” });
const url  = URL.createObjectURL(blob);
const a    = document.createElement(“a”);
a.href     = url;
a.download = “virtual-guitar-live.webm”;
a.click();
// ✅ FIX: revoke URL เพื่อป้องกัน memory leak
setTimeout(() => URL.revokeObjectURL(url), 1000);
};

mediaRecorder.start();
console.log(“🎥 Recording started”);
}

function stopRecording() {
// ✅ FIX #2: Guard ป้องกัน crash เมื่อยังไม่ได้ start recording
if (!mediaRecorder || mediaRecorder.state === “inactive”) {
console.warn(“Recording not started yet.”);
return;
}
mediaRecorder.stop();
if (micStream) {
micStream.getTracks().forEach(track => track.stop());
}
console.log(“⏹ Recording stopped”);
}

// =======================
// 🎥 MediaPipe
// =======================

const video  = document.getElementById(“video”);
const canvas = document.getElementById(“canvas”);
const ctx    = canvas.getContext(“2d”);

// ✅ FIX: canvas size ตรงกับ camera ทำให้ landmark scale ถูกต้อง
canvas.width  = 400;
canvas.height = 300;

let lastRightY = null;
let lastStrumTime = 0; // ✅ FIX P0#3: debounce strum

const hands = new Hands({
locateFile: file =>
`https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
maxNumHands: 2,
minDetectionConfidence: 0.7,
minTrackingConfidence:  0.7
});

hands.onResults(results => {
ctx.clearRect(0, 0, canvas.width, canvas.height);
ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

// ✅ FIX #4: ถ้าไม่พบมือในเฟรม reset lastRightY และ smoothing ป้องกัน ghost strum
if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
lastRightY = null;
resetSmoothing(“Left”);
resetSmoothing(“Right”);
return;
}

// track ว่า hand ไหนปรากฏในเฟรมนี้
const handsInFrame = new Set(
results.multiHandedness.map(h => h.label)
);
if (!handsInFrame.has(“Left”))  resetSmoothing(“Left”);
if (!handsInFrame.has(“Right”)) { resetSmoothing(“Right”); lastRightY = null; }

for (let i = 0; i < results.multiHandLandmarks.length; i++) {
const raw    = results.multiHandLandmarks[i];
const handed = results.multiHandedness[i].label;

```
// ✅ FIX #3: ส่ง hand label เข้า smoothLandmarks
const l = smoothLandmarks(raw, handed);

// LEFT HAND — chord detection
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

// RIGHT HAND — strum detection
if (handed === "Right") {
  const y = l[8].y;

  if (lastRightY !== null) {
    const now = Date.now();
    // ✅ FIX P0#3: เพิ่ม lastStrumTime debounce 120ms + raise threshold 0.07
    // ป้องกัน ghost strum เมื่อมือเข้า/ออกเฟรมหรือมือสั่น
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
```

}
});

// ✅ FIX: ขอ camera พร้อม error handling
const camera = new Camera(video, {
onFrame: async () => {
await hands.send({ image: video });
},
width:  400,
height: 300
});

camera.start().catch(err => {
showError(“❌ ไม่สามารถเปิดกล้องได้: “ + err.message + “ — กรุณาอนุญาต Camera permission”);
});
