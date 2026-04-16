let canvas = document.getElementById("waveCanvas");
let ctx = canvas.getContext("2d");

let audioBuffer;
let audioCtx = new AudioContext();
let source;

let threshold = 0.2;
let dragging = false;

let waveform = [];

// Upload file
document.getElementById("fileInput").onchange = async (e) => {
  let file = e.target.files[0];
  if (!file) return;

  document.getElementById("filename").innerText = file.name;

  let arrayBuffer = await file.arrayBuffer();
  audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

  drawWaveform();
};

// Draw waveform
function drawWaveform() {
  let data = audioBuffer.getChannelData(0);
  waveform = data;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "white";
  ctx.beginPath();

  let step = Math.ceil(data.length / canvas.width);

  for (let i = 0; i < canvas.width; i++) {
    let min = 1.0;
    let max = -1.0;

    for (let j = 0; j < step; j++) {
      let datum = data[(i * step) + j];
      if (datum < min) min = datum;
      if (datum > max) max = datum;
    }

    ctx.moveTo(i, (1 + min) * 100);
    ctx.lineTo(i, (1 + max) * 100);
  }

  ctx.stroke();

  drawThreshold();
}

// Draw suppression line
function drawThreshold() {
  let y = canvas.height * (1 - threshold);

  ctx.strokeStyle = "cyan";
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(canvas.width, y);
  ctx.stroke();
}

// Dragging
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

// Process audio
function processAudio() {
  let output = audioCtx.createBuffer(
    audioBuffer.numberOfChannels,
    audioBuffer.length,
    audioBuffer.sampleRate
  );

  for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
    let input = audioBuffer.getChannelData(c);
    let out = output.getChannelData(c);

    for (let i = 0; i < input.length; i++) {
      let sample = input[i];

      // Suppression based on threshold line
      if (Math.abs(sample) < threshold) sample = 0;

      // Smooth compression
      sample = Math.tanh(sample * 2);

      out[i] = sample;
    }
  }

  return output;
}

// Play
document.getElementById("play").onclick = () => {
  if (!audioBuffer) return;

  let processed = processAudio();

  source = audioCtx.createBufferSource();
  source.buffer = processed;
  source.connect(audioCtx.destination);
  source.start();
};

// Stop
document.getElementById("stop").onclick = () => {
  if (source) source.stop();
};

// Download
document.getElementById("download").onclick = () => {
  let processed = processAudio();

  let wav = bufferToWave(processed);
  let url = URL.createObjectURL(wav);

  let a = document.createElement("a");
  a.href = url;
  a.download = "cleaned.wav";
  a.click();
};

// Convert to WAV
function bufferToWave(abuffer) {
  let numOfChan = abuffer.numberOfChannels,
      length = abuffer.length * numOfChan * 2 + 44,
      buffer = new ArrayBuffer(length),
      view = new DataView(buffer),
      channels = [],
      offset = 0,
      pos = 0;

  function setUint16(data) {
    view.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data) {
    view.setUint32(pos, data, true);
    pos += 4;
  }

  setUint32(0x46464952);
  setUint32(length - 8);
  setUint32(0x45564157);

  setUint32(0x20746d66);
  setUint32(16);
  setUint16(1);
  setUint16(numOfChan);
  setUint32(abuffer.sampleRate);
  setUint32(abuffer.sampleRate * 2 * numOfChan);
  setUint16(numOfChan * 2);
  setUint16(16);

  setUint32(0x61746164);
  setUint32(length - pos - 4);

  for (let i = 0; i < abuffer.numberOfChannels; i++)
    channels.push(abuffer.getChannelData(i));

  while (pos < length) {
    for (let i = 0; i < numOfChan; i++) {
      let sample = Math.max(-1, Math.min(1, channels[i][offset]));
      sample = sample * 32767;
      view.setInt16(pos, sample, true);
      pos += 2;
    }
    offset++;
  }

  return new Blob([buffer], { type: "audio/wav" });
}
