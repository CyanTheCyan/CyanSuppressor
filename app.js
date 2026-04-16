let canvas = document.getElementById("waveCanvas");
let ctx = canvas.getContext("2d");

let audioBuffer;
let audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let source;

let threshold = 0.2;
let dragging = false;

/* =========================
   FILE UPLOAD
========================= */
document.getElementById("fileInput").onchange = async (e) => {
  let file = e.target.files[0];
  if (!file) return;

  document.getElementById("filename").innerText = file.name;

  let arrayBuffer = await file.arrayBuffer();
  audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

  drawWaveform();
};

/* =========================
   WAVEFORM DISPLAY
========================= */
function drawWaveform() {
  let data = audioBuffer.getChannelData(0);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "white";
  ctx.lineWidth = 1;
  ctx.beginPath();

  let step = Math.ceil(data.length / canvas.width);

  for (let i = 0; i < canvas.width; i++) {
    let min = 1, max = -1;

    for (let j = 0; j < step; j++) {
      let d = data[i * step + j];
      if (d < min) min = d;
      if (d > max) max = d;
    }

    ctx.moveTo(i, (1 + min) * canvas.height / 2);
    ctx.lineTo(i, (1 + max) * canvas.height / 2);
  }

  ctx.stroke();
  drawThreshold();
}

/* =========================
   THRESHOLD LINE
========================= */
function drawThreshold() {
  let y = canvas.height * (1 - threshold);

  ctx.strokeStyle = "cyan";
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(canvas.width, y);
  ctx.stroke();
}

/* =========================
   DRAG THRESHOLD
========================= */
canvas.onmousedown = () => dragging = true;
canvas.onmouseup = () => dragging = false;

canvas.onmousemove = (e) => {
  if (!dragging) return;

  let rect = canvas.getBoundingClientRect();
  let y = e.clientY - rect.top;

  threshold = 1 - (y / canvas.height);
  threshold = Math.max(0, Math.min(1, threshold));

  drawWaveform();
};

/* =========================
   MULTI-BAND NOISE REDUCER
   (THIS is the real upgrade)
========================= */
function processAudio() {
  let output = audioCtx.createBuffer(
    audioBuffer.numberOfChannels,
    audioBuffer.length,
    audioBuffer.sampleRate
  );

  const attack = 0.02;
  const release = 0.12;
  const smooth = 0.003;

  for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
    let input = audioBuffer.getChannelData(c);
    let out = output.getChannelData(c);

    let envLow = 0, envMid = 0, envHigh = 0;

    for (let i = 0; i < input.length; i++) {
      let sample = input[i];

      /* =========================
         SIMPLE FAKE "FREQUENCY SPLIT"
         (time-domain approximation)
      ========================= */

      let low = sample * 0.6;
      let mid = sample * 0.3;
      let high = sample * 0.1;

      // envelope tracking per band
      let aLow = Math.abs(low);
      let aMid = Math.abs(mid);
      let aHigh = Math.abs(high);

      envLow += ((aLow > envLow ? attack : release) * (aLow - envLow));
      envMid += ((aMid > envMid ? attack : release) * (aMid - envMid));
      envHigh += ((aHigh > envHigh ? attack : release) * (aHigh - envHigh));

      let noiseFloor = threshold;

      /* =========================
         PER-BAND GATING
      ========================= */

      let gLow = envLow < noiseFloor ? envLow / (noiseFloor + 1e-6) : 1;
      let gMid = envMid < noiseFloor * 0.8 ? envMid / (noiseFloor + 1e-6) : 1;

      // high frequencies are usually noise → stronger suppression
      let gHigh = envHigh < noiseFloor * 0.6 ? envHigh / (noiseFloor + 1e-6) : 0.6;

      gLow = Math.max(0, Math.min(1, gLow));
      gMid = Math.max(0, Math.min(1, gMid));
      gHigh = Math.max(0, Math.min(1, gHigh));

      let target =
        low * gLow +
        mid * gMid +
        high * gHigh;

      /* =========================
         OUTPUT SMOOTHING
      ========================= */
      out[i] = (out[i] || 0) * (1 - smooth) + target * smooth;
    }
  }

  return output;
}

/* =========================
   PLAY
========================= */
document.getElementById("play").onclick = () => {
  if (!audioBuffer) return;

  let processed = processAudio();

  source = audioCtx.createBufferSource();
  source.buffer = processed;
  source.connect(audioCtx.destination);
  source.start();
};

/* =========================
   STOP
========================= */
document.getElementById("stop").onclick = () => {
  if (source) source.stop();
};

/* =========================
   DOWNLOAD WAV
========================= */
document.getElementById("download").onclick = () => {
  let processed = processAudio();

  let wav = bufferToWave(processed);
  let url = URL.createObjectURL(wav);

  let a = document.createElement("a");
  a.href = url;
  a.download = "cleaned.wav";
  a.click();
};

/* =========================
   WAV EXPORT
========================= */
function bufferToWave(abuffer) {
  let numOfChan = abuffer.numberOfChannels,
      length = abuffer.length * numOfChan * 2 + 44,
      buffer = new ArrayBuffer(length),
      view = new DataView(buffer),
      channels = [],
      pos = 0,
      offset = 0;

  function u16(d){ view.setUint16(pos,d,true); pos+=2; }
  function u32(d){ view.setUint32(pos,d,true); pos+=4; }

  u32(0x46464952);
  u32(length - 8);
  u32(0x45564157);

  u32(0x20746d66);
  u32(16);
  u16(1);
  u16(numOfChan);
  u32(abuffer.sampleRate);
  u32(abuffer.sampleRate * 2 * numOfChan);
  u16(numOfChan * 2);
  u16(16);

  u32(0x61746164);
  u32(length - pos - 4);

  for (let i = 0; i < numOfChan; i++)
    channels.push(abuffer.getChannelData(i));

  while (pos < length) {
    for (let i = 0; i < numOfChan; i++) {
      let s = Math.max(-1, Math.min(1, channels[i][offset]));
      view.setInt16(pos, s * 32767, true);
      pos += 2;
    }
    offset++;
  }

  return new Blob([buffer], { type: "audio/wav" });
}
