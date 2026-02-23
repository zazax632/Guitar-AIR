// ============================================================
// 🎸 Virtual Guitar Pro — v10 (Final)
//
// MediaPipe Tasks Vision @0.10.3
//   • GestureRecognizer — landmarks + gesture (same index guaranteed)
//   • ObjectDetector    — bounding box real-time
//
// v10 improvements (user requests):
//   UX-1:  Label "STRUM"/"CHORD" วาดเหนือข้อมือ (landmark 0) บน canvas
//   UX-2:  Status indicator แถบเล็กมุมล่างซ้าย แสดงสีมือ + บทบาท
//   STB-1: song.json ใช้ JSON.parse ตรงๆ (แก้ quote ที่ source แล้ว)
//   STB-2: strum threshold 0.03 → 0.055 ป้องกันเสียงเบิ้ล
//   STB-3: Chord Memory — จำ chord ล่าสุดไว้ เมื่อมือหาย chord ไม่เปลี่ยน
//   STB-4: ตรวจ Tone.context.state ก่อน play
//
// v9 bug fixes preserved:
//   FIX-1: GestureRecognizer เดียว (ไม่แยก HandLandmarker) — index sync
//   FIX-2: strumIdx clamp ด้วย handCount จริง
//   FIX-3: resetHandState สำหรับมือที่หายออกจากภาพ
//   FIX-4: fiveFingerHandIdx prevent timer reset เมื่อเปลี่ยนมือ
//   FIX-5: disconnect micSource เก่าก่อน record ซ้ำ
//   FIX-6: video.error?.message ไม่ใช่ event.message
//   FIX-7: retryInit close() model เก่า ก่อน init ใหม่
//   FIX-8: countdownActive reset ใน .catch()
//   FIX-9: Thumb_Up resume เรียก startScroll()
// ============================================================

const { GestureRecognizer, ObjectDetector, FilesetResolver } = window;

// ══════════════════════════════════════════
// 🔊 AUDIO
// ══════════════════════════════════════════

let audioReady = false;
let reverb, masterVol, guitar, audioInitDone = false;

async function ensureAudio() {
  if (audioReady) return;
  try {
    await Tone.start();
    audioReady = true;
    if (!audioInitDone) await initAudio();
  } catch(e) { showError("❌ Audio: " + e.message); }
}

async function initAudio() {
  try {
    audioInitDone = true;
    reverb    = new Tone.Reverb({ decay: 2.2, wet: 0.3 });
    await reverb.generate();
    reverb.toDestination();
    masterVol = new Tone.Volume(0).connect(reverb);
    guitar    = new Tone.PluckSynth({
      attackNoise: 1.5, dampening: 3800, resonance: 0.97
    }).connect(masterVol);
    console.log("✅ Audio ready");
    setStatus("🎸 กด เปิดเสียง แล้วชู 5 นิ้วเพื่อเริ่ม");
  } catch(e) {
    audioInitDone = false;
    showError("❌ Audio init: " + e.message);
  }
}

["click","touchstart","keydown"].forEach(evt =>
  document.addEventListener(evt, ensureAudio, { once: true })
);

// ══════════════════════════════════════════
// 🎸 Chords & Gesture Map
// ══════════════════════════════════════════

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

// STB-3: Chord Memory — currentChord ไม่เปลี่ยนเมื่อมือหายชั่วคราว
// lastValidChord = chord ที่ user ตั้งใจเลือกล่าสุด
let currentChord   = "Gmaj7";
let lastValidChord = "Gmaj7";  // ✅ Chord Memory
let isPlaying      = false;
let lastStrumTime  = 0;

async function playStrum(velocity) {
  // STB-4: ตรวจ AudioContext state ก่อนเล่น
  if (Tone.context.state !== "running") await ensureAudio();
  if (!audioReady || !guitar || !masterVol) return;
  const notes = CHORDS[currentChord];
  if (!notes) return;
  masterVol.volume.cancelScheduledValues(Tone.now());
  masterVol.volume.rampTo(-16 + velocity * 16, 0.04);
  const spread = 0.015 + (1 - velocity) * 0.055;
  const t = Tone.now();
  notes.forEach((n, i) => guitar.triggerAttack(n, t + i * spread));
  console.log("🎸", currentChord, "vel:", velocity.toFixed(2));
}

// ══════════════════════════════════════════
// 🎼 Lyrics
// ══════════════════════════════════════════

let songData, currentIndex = 0, scrollTimer = null;

// STB-1: song.json ถูกแก้ quote แล้ว — parse ตรงๆ ไม่ต้องแทนที่ character
fetch("song.json")
  .then(r => r.ok ? r.json() : Promise.reject("HTTP " + r.status))
  .then(d => { songData = d; renderLyrics(); })
  .catch(e => showError("❌ โหลด song.json: " + e));

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
    // FIX-8: reset flag ถ้า audio fail ไม่งั้น countdown stuck
    countdownActive = false;
    showError("❌ เปิดเสียงไม่ได้: " + e.message);
  });
}

function updateTitle() {
  setStatus("🎸 " + currentChord + (isPlaying ? " ▶" : " ⏸"));
}

// ══════════════════════════════════════════
// ✋ Hand Helpers
// ══════════════════════════════════════════

function countOpenFingers(l) {
  return [[8,6],[12,10],[16,14],[20,18]]
    .filter(([t,p]) => l[t].y < l[p].y).length;
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

// FIX-3: reset state สำหรับ hand ที่หายออกจากภาพ
function resetHandState(i) {
  _smoothed[i] = undefined;
  hState[i].prevY     = null;
  hState[i].prevT     = null;
  hState[i].smoothSpd = 0;
  hState[i].dy        = 0;
  hState[i].l         = null;
}

// ══════════════════════════════════════════
// 🖐 Per-hand State
// ══════════════════════════════════════════

const hState = [
  { prevY:null, prevT:null, smoothSpd:0, dy:0, l:null },
  { prevY:null, prevT:null, smoothSpd:0, dy:0, l:null }
];

// FIX-4: track ว่ามือไหน hold 5 นิ้ว
let fiveFingerTime    = null;
let fiveFingerHandIdx = -1;
let lastChordChange   = 0;
let lastThumbToggle   = 0;
const HOLD_MS = 700;

// ══════════════════════════════════════════
// 📷 Canvas + Video
// ══════════════════════════════════════════

const video  = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx    = canvas.getContext("2d");
canvas.width = 640; canvas.height = 480;

// ══════════════════════════════════════════
// 🤚 MediaPipe Init
// ══════════════════════════════════════════

let gestureRecognizer, objectDetector;
let mpReady    = false;
let frameCount = 0;

const OBJ_INTERVAL = 25;
let lastObjResult  = null;

let tsGest = 0;
let tsObj  = 0;

async function initMediaPipe() {
  setStatus("⏳ โหลด MediaPipe Tasks…");
  clearError();

  async function tryDelegate(createFn, opts) {
    try {
      return await createFn({ baseOptions: { ...opts.baseOptions, delegate:"GPU" }, ...opts.rest });
    } catch(e) {
      console.warn("GPU failed, CPU fallback:", e.message);
      return await createFn({ baseOptions: { ...opts.baseOptions, delegate:"CPU" }, ...opts.rest });
    }
  }

  try {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
    );

    gestureRecognizer = await tryDelegate(
      opt => GestureRecognizer.createFromOptions(vision, opt),
      {
        baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task" },
        rest: { runningMode:"VIDEO", numHands:2, minHandDetectionConfidence:0.55, minTrackingConfidence:0.45 }
      }
    );
    console.log("✅ GestureRecognizer ready");

    objectDetector = await tryDelegate(
      opt => ObjectDetector.createFromOptions(vision, opt),
      {
        baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite" },
        rest: { runningMode:"VIDEO", scoreThreshold:0.40, maxResults:5 }
      }
    );
    console.log("✅ ObjectDetector ready");

    mpReady = true;
    setStatus("🎸 กด เปิดเสียง แล้วชู 5 นิ้วเพื่อเริ่ม");
    console.log("✅ All MediaPipe ready");
  } catch(e) {
    showError("❌ MediaPipe init: " + e.message, true);
    console.error(e);
  }
}

// FIX-7: close() model เก่าก่อน init ใหม่
async function retryInit() {
  mpReady = false;
  try { gestureRecognizer?.close(); } catch(e) {}
  try { objectDetector?.close();    } catch(e) {}
  gestureRecognizer = null;
  objectDetector    = null;
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
  } catch(e) {
    console.warn("detection error:", e.message);
  }
}

// ══════════════════════════════════════════
// 🖐 onResults
// ══════════════════════════════════════════

function onResults(gestResult, now) {
  const lms      = gestResult.landmarks;
  const gestures = gestResult.gestures;
  const handCount = lms?.length ?? 0;

  // HUD — chord + status
  ctx.font = "bold 18px sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "#00ffcc";
  ctx.fillText(currentChord + (isPlaying ? " ▶" : " ⏸"), canvas.width / 2, 28);
  ctx.font = "11px monospace";
  ctx.fillStyle = "#555";
  ctx.textAlign = "right";
  ctx.fillText("f:" + frameCount + " h:" + handCount, canvas.width - 6, 18);
  ctx.textAlign = "left";

  // FIX-3: reset state ของ hand ที่หายออกจากภาพ
  for (let i = handCount; i < 2; i++) resetHandState(i);

  // ไม่เจอมือ
  if (handCount === 0) {
    fiveFingerTime    = null;
    fiveFingerHandIdx = -1;
    ctx.font = "bold 15px sans-serif";
    ctx.fillStyle = "rgba(255,255,100,0.85)";
    ctx.textAlign = "center";
    ctx.fillText("👋 ยกมือให้กล้องเห็น", canvas.width / 2, canvas.height / 2);
    ctx.textAlign = "left";
    setGestureUI("—");
    // UX-2: indicator ว่าไม่เจอมือ
    drawHandIndicator(-1, -1);
    return;
  }

  // Gesture UI
  if (gestures?.length > 0) {
    setGestureUI(gestures.map(g =>
      g[0] ? g[0].categoryName.replace(/_/g," ") + " " + (g[0].score*100).toFixed(0) + "%" : "—"
    ).join(" │ "));
  }

  // Single pass: smooth + dy/speed
  for (let i = 0; i < handCount; i++) {
    const l  = smoothLM(lms[i], i);
    const st = hState[i];
    const y  = l[8].y;
    if (st.prevY !== null && st.prevT !== null) {
      const rawDy  = y - st.prevY;
      const dt     = Math.max((now - st.prevT) / 1000, 0.005);
      st.smoothSpd = 0.4 * st.smoothSpd + 0.6 * (Math.abs(rawDy) / dt);
      st.dy        = rawDy;
    } else {
      st.dy = 0; st.smoothSpd = 0;
    }
    st.l     = l;
    st.prevY = y;
    st.prevT = now;
  }

  // FIX-2: strumIdx clamp
  let strumIdx = 0;
  if (handCount === 2)
    strumIdx = hState[0].smoothSpd >= hState[1].smoothSpd ? 0 : 1;
  const chordIdx = handCount === 2 ? 1 - strumIdx : 0;

  // UX-2: indicator แถบมุมล่างซ้าย
  drawHandIndicator(strumIdx, chordIdx);

  let anyFive = false;

  for (let i = 0; i < handCount; i++) {
    const st      = hState[i];
    const l       = st.l;
    const isStrum = i === strumIdx;
    const color   = isStrum ? "#ff5555" : "#55aaff";
    const role    = isStrum ? "STRUM" : "CHORD";
    const openN   = countOpenFingers(l);
    const five    = isFiveFingers(l);
    const gesture = gestures?.[i]?.[0]?.categoryName ?? "None";
    const gScore  = gestures?.[i]?.[0]?.score ?? 0;

    // skeleton
    drawHandSkeleton(l, color);

    // dots
    ctx.fillStyle = color;
    l.forEach(p => {
      ctx.beginPath();
      ctx.arc((1-p.x)*canvas.width, p.y*canvas.height, 5, 0, 2*Math.PI);
      ctx.fill();
    });

    // UX-1: วาด Label "STRUM"/"CHORD" เหนือข้อมือ (landmark 0)
    drawHandLabel(l[0], role, color, gesture, gScore, openN);

    // 5-finger countdown — FIX-4
    if (five && !countdownActive && !isPlaying) {
      if (fiveFingerHandIdx !== i) {
        fiveFingerHandIdx = i;
        fiveFingerTime    = now;
      }
      const prog = Math.min((now - fiveFingerTime) / HOLD_MS, 1);
      drawProgressBar(prog);
      anyFive = true;
      if (prog >= 1) {
        fiveFingerTime    = null;
        fiveFingerHandIdx = -1;
        triggerCountdown();
      }
    } else if (!five && fiveFingerHandIdx === i) {
      fiveFingerTime    = null;
      fiveFingerHandIdx = -1;
    }

    // Chord / pause logic (chord hand only)
    if (i === chordIdx && isPlaying && !five) {
      // FIX-9: Thumb_Up toggle + startScroll on resume
      if (gesture === "Thumb_Up" && gScore > 0.75 && now - lastThumbToggle > 700) {
        isPlaying = !isPlaying;
        lastThumbToggle = now;
        if (isPlaying) startScroll();
        updateTitle();
      }

      // Gesture → chord
      const mapped = GESTURE_CHORD[gesture];
      if (mapped && mapped !== currentChord && gScore > 0.65 && now - lastChordChange > 350) {
        currentChord    = mapped;
        lastValidChord  = mapped; // STB-3: update memory
        lastChordChange = now;
        updateTitle();
      }

      // fallback: นับนิ้ว
      if (!mapped && gesture !== "Thumb_Up") {
        const ch = chordFromFingers(l);
        if (ch !== currentChord && now - lastChordChange > 300) {
          currentChord    = ch;
          lastValidChord  = ch; // STB-3: update memory
          lastChordChange = now;
          updateTitle();
        }
      }
    }
  }

  if (!anyFive && fiveFingerHandIdx !== -1) {
    fiveFingerTime    = null;
    fiveFingerHandIdx = -1;
  }

  // Strum — STB-2: threshold ปรับจาก 0.03 → 0.055
  const sSt = hState[strumIdx];
  if (sSt.l && sSt.prevY !== null &&
      Math.abs(sSt.dy) > 0.055 && now - lastStrumTime > 130) {
    const vel = Math.min(Math.max(sSt.smoothSpd / 4, 0.2), 1.0);
    playStrum(vel);
    lastStrumTime = now;
    drawStrumArrow(sSt.dy > 0 ? "▼" : "▲", vel);
  }
}

// ══════════════════════════════════════════
// 🖌️ Draw Helpers
// ══════════════════════════════════════════

const HAND_CONN = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],
  [0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20],
  [5,9],[9,13],[13,17]
];

function drawHandSkeleton(l, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth   = 2;
  ctx.globalAlpha = 0.5;
  HAND_CONN.forEach(([a,b]) => {
    ctx.beginPath();
    ctx.moveTo((1-l[a].x)*canvas.width, l[a].y*canvas.height);
    ctx.lineTo((1-l[b].x)*canvas.width, l[b].y*canvas.height);
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
  ctx.lineWidth   = 1;
}

// UX-1: วาด label ติดที่มือ (เหนือ landmark 0 = ข้อมือ)
function drawHandLabel(wrist, role, color, gesture, gScore, openN) {
  ctx.save();
  const wx = (1 - wrist.x) * canvas.width;
  const wy = wrist.y * canvas.height - 28; // เหนือข้อมือ 28px

  // badge bg
  const label  = role;
  const detail = gesture.replace(/_/g," ") + " " + (gScore*100).toFixed(0) + "%";
  const fw = 112, fh = 36, fr = 6;
  const fx = Math.max(4, Math.min(wx - fw/2, canvas.width - fw - 4));
  const fy = Math.max(4, wy - fh);

  // badge shadow
  ctx.shadowColor = color;
  ctx.shadowBlur  = 8;
  ctx.fillStyle   = "rgba(0,0,0,0.72)";
  roundRect(fx, fy, fw, fh, fr);
  ctx.fill();
  ctx.shadowBlur = 0;

  // badge border
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1.5;
  roundRect(fx, fy, fw, fh, fr);
  ctx.stroke();

  // role text
  ctx.font      = "bold 13px sans-serif";
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.fillText(label, fx + fw/2, fy + 15);

  // gesture detail
  ctx.font      = "10px monospace";
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillText(detail, fx + fw/2, fy + 28);

  // connector line จาก badge ลงข้อมือ
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1;
  ctx.globalAlpha = 0.4;
  ctx.setLineDash([3,3]);
  ctx.beginPath();
  ctx.moveTo(wx, Math.min(wy, fy + fh));
  ctx.lineTo(wx, Math.min(wrist.y * canvas.height, canvas.height - 4));
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.restore();
}

// helper roundRect (สำหรับ badge)
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y);
  ctx.quadraticCurveTo(x+w, y, x+w, y+r);
  ctx.lineTo(x+w, y+h-r);
  ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h);
  ctx.quadraticCurveTo(x, y+h, x, y+h-r);
  ctx.lineTo(x, y+r);
  ctx.quadraticCurveTo(x, y, x+r, y);
  ctx.closePath();
}

// UX-2: แถบ Indicator มุมล่างซ้าย (แสดงสถานะ strum/chord hands)
function drawHandIndicator(strumIdx, chordIdx) {
  ctx.save();
  const bx = 6, by = canvas.height - 60;
  const bw = 120, bh = 54, br = 7;

  ctx.fillStyle   = "rgba(0,0,0,0.6)";
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth   = 1;
  roundRect(bx, by, bw, bh, br);
  ctx.fill();
  roundRect(bx, by, bw, bh, br);
  ctx.stroke();

  // Title
  ctx.font      = "bold 9px sans-serif";
  ctx.fillStyle = "#aaa";
  ctx.textAlign = "left";
  ctx.fillText("HAND ROLES", bx + 8, by + 12);

  if (strumIdx === -1) {
    // ไม่เจอมือ
    ctx.font      = "11px sans-serif";
    ctx.fillStyle = "rgba(255,255,100,0.8)";
    ctx.fillText("👋 ไม่พบมือ", bx + 8, by + 34);
  } else {
    const rows = [
      { label: "STRUM 🎸", color: "#ff5555" },
      { label: "CHORD 🎵", color: "#55aaff" }
    ];
    rows.forEach((r, ri) => {
      const y = by + 24 + ri * 16;
      // dot
      ctx.beginPath();
      ctx.arc(bx + 14, y, 5, 0, 2*Math.PI);
      ctx.fillStyle = r.color;
      ctx.fill();
      // label
      ctx.font      = "bold 11px sans-serif";
      ctx.fillStyle = r.color;
      ctx.fillText(r.label, bx + 24, y + 4);
    });
  }
  ctx.restore();
}

function drawStrumArrow(arrow, vel) {
  ctx.save();
  ctx.globalAlpha = 0.5 + vel * 0.5;
  ctx.fillStyle   = vel > 0.6 ? "#ff6600" : "#ffdd00";
  ctx.font        = "bold " + (22 + vel*22) + "px sans-serif";
  ctx.textAlign   = "center";
  ctx.fillText(arrow + " STRUM", canvas.width/2, 60);
  ctx.restore();
}

function drawProgressBar(prog) {
  ctx.save();
  const bx = canvas.width * 0.15, by = canvas.height - 44, bw = canvas.width * 0.7;
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(bx, by, bw, 22);
  const g = ctx.createLinearGradient(bx, 0, bx+bw, 0);
  g.addColorStop(0, "#00ffcc"); g.addColorStop(1, "#00aaff");
  ctx.fillStyle = g;
  ctx.fillRect(bx, by, bw * prog, 22);
  ctx.fillStyle   = "white";
  ctx.font        = "bold 13px sans-serif";
  ctx.textAlign   = "center";
  ctx.fillText("✋ ชู 5 นิ้วค้างไว้เพื่อเริ่ม…", canvas.width/2, by - 6);
  ctx.restore();
}

function drawObjectBoxes(result) {
  if (!result?.detections?.length) return;
  result.detections.forEach(det => {
    const bb    = det.boundingBox;
    const label = det.categories[0]?.categoryName ?? "?";
    const score = ((det.categories[0]?.score ?? 0) * 100).toFixed(0);
    const mx    = canvas.width - (bb.originX + bb.width);
    const labelY = Math.max(bb.originY, 24); // FIX LOW-4: clamp
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = "#ffaa00"; ctx.lineWidth = 2;
    ctx.strokeRect(mx, bb.originY, bb.width, bb.height);
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(mx, labelY - 22, bb.width, 22);
    ctx.fillStyle   = "#ffaa00";
    ctx.font        = "bold 12px sans-serif";
    ctx.textAlign   = "left";
    ctx.fillText(label + " " + score + "%", mx + 4, labelY - 6);
    ctx.restore();
  });
}

function renderObjectUI(result) {
  if (!result?.detections?.length) { setObjectUI("—"); return; }
  setObjectUI(result.detections.slice(0,3).map(d =>
    (d.categories[0]?.categoryName??"?") + " " +
    ((d.categories[0]?.score??0)*100).toFixed(0) + "%"
  ).join(", "));
}

// ══════════════════════════════════════════
// 🎥 Recording
// ══════════════════════════════════════════

let recDest, micStream, oldMicSource, mediaRecorder, recChunks = [];

async function startRecording() {
  await ensureAudio();
  if (!recDest)
    recDest = Tone.getContext().rawContext.createMediaStreamDestination();
  recChunks = [];
  // FIX-5: disconnect เก่าก่อน
  if (oldMicSource) { try { oldMicSource.disconnect(); } catch(e) {} oldMicSource = null; }
  if (micStream) micStream.getTracks().forEach(t => t.stop());
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio:true });
  } catch(e) { showError("❌ ไมค์: " + e.message); return; }
  oldMicSource = Tone.getContext().rawContext.createMediaStreamSource(micStream);
  oldMicSource.connect(recDest);
  const combined = new MediaStream([
    ...canvas.captureStream(30).getVideoTracks(),
    ...recDest.stream.getAudioTracks()
  ]);
  mediaRecorder = new MediaRecorder(combined);
  mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recChunks.push(e.data); };
  mediaRecorder.onstop = () => {
    const url = URL.createObjectURL(new Blob(recChunks, {type:"video/webm"}));
    const a   = document.createElement("a");
    a.href = url; a.download = "guitar.webm"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  mediaRecorder.start();
  console.log("🎥 Recording started");
}

function stopRecording() {
  if (mediaRecorder?.state !== "inactive") mediaRecorder?.stop();
  if (micStream) micStream.getTracks().forEach(t => t.stop());
}

// ══════════════════════════════════════════
// 📷 Camera
// ══════════════════════════════════════════

async function startCamera() {
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width:640, height:480, facingMode:"user" },
      audio: false
    });
    video.srcObject = stream;
    await new Promise((res, rej) => {
      video.onloadedmetadata = res;
      // FIX-6: ใช้ video.error?.message ไม่ใช่ event.message
      video.onerror = () => rej(new Error(video.error?.message || "video load failed"));
    });
    await video.play();
    console.log("✅ Camera", video.videoWidth, "x", video.videoHeight);
  } catch(e) {
    // FIX LOW-2: stop tracks ป้องกัน LED ค้าง
    stream?.getTracks().forEach(t => t.stop());
    showError("❌ กล้อง: " + e.message);
  }
}

// ══════════════════════════════════════════
// 🚀 Bootstrap
// ══════════════════════════════════════════

(async () => {
  await initMediaPipe();
  await startCamera();
  processFrame();
})();
