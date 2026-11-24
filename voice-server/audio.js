// Audio helpers: Twilio speaks G.711 μ-law @ 8kHz, Gemini Live wants PCM16 @ 16kHz and answers PCM16 @ 24kHz.

const BIAS = 0x84, CLIP = 32635;

const MULAW_DECODE = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  const u = ~i & 0xff;
  const sign = u & 0x80, exponent = (u >> 4) & 0x07, mantissa = u & 0x0f;
  let s = (((mantissa << 3) + BIAS) << exponent) - BIAS;
  MULAW_DECODE[i] = sign ? -s : s;
}

function encodeSample(sample) {
  let sign = (sample >> 8) & 0x80;
  if (sign) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; exponent--, mask >>= 1);
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** μ-law bytes (8kHz) → PCM16 little-endian bytes (16kHz), linear interpolation. */
function mulaw8kToPcm16k(buf, state) {
  const n = buf.length, out = Buffer.alloc(n * 4);
  let prev = state.last ?? MULAW_DECODE[buf[0]];
  for (let i = 0; i < n; i++) {
    const s = MULAW_DECODE[buf[i]];
    out.writeInt16LE((prev + s) >> 1, i * 4);
    out.writeInt16LE(s, i * 4 + 2);
    prev = s;
  }
  state.last = prev;
  return out;
}

/** PCM16 LE bytes (24kHz) → μ-law bytes (8kHz). Averages every 3 samples (cheap low-pass). Keeps remainder in state. */
function pcm24kToMulaw8k(buf, state) {
  let samples;
  const pending = state.rest || Buffer.alloc(0);
  const all = pending.length ? Buffer.concat([pending, buf]) : buf;
  const total = Math.floor(all.length / 2);
  const usable = total - (total % 3);
  samples = usable / 3;
  const out = Buffer.alloc(samples);
  for (let i = 0; i < samples; i++) {
    const o = i * 6;
    const avg = (all.readInt16LE(o) + all.readInt16LE(o + 2) + all.readInt16LE(o + 4)) / 3;
    out[i] = encodeSample(Math.round(avg));
  }
  state.rest = all.subarray(usable * 2);
  return out;
}

module.exports = { mulaw8kToPcm16k, pcm24kToMulaw8k, encodeSample, MULAW_DECODE };
