import fs from 'node:fs';
import path from 'node:path';

export type BgmStyle =
  | 'COMEDY_ROAST'
  | 'EPIC_ACTION'
  | 'SUSPENSE_THRILLER'
  | 'EMOTIONAL_SAD'
  | 'DEVOTIONAL'
  | 'SCI_FI_TECH'
  | 'MOTIVATIONAL'
  | 'HORROR_DARK';

function createSeededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function resolveBgmStyle(mood: string): BgmStyle {
  const normalized = mood.toLowerCase().trim();
  if (
    normalized.includes('roast') ||
    normalized.includes('comedy') ||
    normalized.includes('funny') ||
    normalized.includes('satire')
  ) {
    return 'COMEDY_ROAST';
  }
  if (normalized.includes('horror') || normalized.includes('scary')) {
    return 'HORROR_DARK';
  }
  if (
    normalized.includes('suspense') ||
    normalized.includes('thriller') ||
    normalized.includes('mystery') ||
    normalized.includes('crime')
  ) {
    return 'SUSPENSE_THRILLER';
  }
  if (normalized.includes('emotional') || normalized.includes('sad') || normalized.includes('drama')) {
    return 'EMOTIONAL_SAD';
  }
  if (normalized.includes('devotional') || normalized.includes('spiritual') || normalized.includes('myth')) {
    return 'DEVOTIONAL';
  }
  if (
    normalized.includes('sci') ||
    normalized.includes('tech') ||
    normalized.includes('cyber') ||
    normalized.includes('future')
  ) {
    return 'SCI_FI_TECH';
  }
  if (normalized.includes('motiv') || normalized.includes('inspir') || normalized.includes('success')) {
    return 'MOTIVATIONAL';
  }
  return 'EPIC_ACTION';
}

export function writeCinematicBgmWav(outputFile: string, mood: string, bgmSeed: number): void {
  const sampleRate = 44100;
  const style = resolveBgmStyle(mood);

  const semitoneShifts = [-3, -2, 0, 2, 3];
  const semitoneShift = semitoneShifts[(bgmSeed & 0x7fffffff) % semitoneShifts.length];
  const pitchScale = Math.pow(2.0, semitoneShift / 12.0);
  const arpVariant = ((bgmSeed >>> 4) & 0x7fffffff) % 3;

  let beatDuration: number;
  let beatsPerLoop: number;
  let baseChords: number[][];

  switch (style) {
    case 'COMEDY_ROAST':
      beatDuration = 0.5;
      beatsPerLoop = 32;
      baseChords = [
        [261.63, 329.63, 392.0, 523.25],
        [196.0, 246.94, 293.66, 392.0],
        [220.0, 261.63, 329.63, 440.0],
        [174.61, 220.0, 261.63, 349.23],
      ];
      break;
    case 'SUSPENSE_THRILLER':
      beatDuration = 0.75;
      beatsPerLoop = 16;
      baseChords = [
        [164.81, 196.0, 246.94, 329.63],
        [164.81, 174.61, 220.0, 349.23],
        [164.81, 196.0, 246.94, 329.63],
        [155.56, 185.0, 220.0, 311.13],
      ];
      break;
    case 'EMOTIONAL_SAD':
      beatDuration = 0.8;
      beatsPerLoop = 16;
      baseChords = [
        [220.0, 261.63, 329.63, 440.0],
        [174.61, 220.0, 261.63, 349.23],
        [130.81, 196.0, 261.63, 329.63],
        [196.0, 246.94, 293.66, 392.0],
      ];
      break;
    case 'DEVOTIONAL':
      beatDuration = 0.75;
      beatsPerLoop = 16;
      baseChords = [
        [130.81, 196.0, 261.63, 293.66],
        [174.61, 220.0, 261.63, 392.0],
        [196.0, 261.63, 293.66, 392.0],
        [130.81, 196.0, 261.63, 329.63],
      ];
      break;
    case 'SCI_FI_TECH':
      beatDuration = 0.5;
      beatsPerLoop = 32;
      baseChords = [
        [220.0, 261.63, 329.63, 440.0],
        [174.61, 220.0, 261.63, 349.23],
        [146.83, 220.0, 293.66, 349.23],
        [164.81, 207.65, 246.94, 329.63],
      ];
      break;
    case 'MOTIVATIONAL':
      beatDuration = 0.6;
      beatsPerLoop = 32;
      baseChords = [
        [174.61, 220.0, 261.63, 349.23],
        [196.0, 246.94, 293.66, 392.0],
        [164.81, 196.0, 246.94, 329.63],
        [220.0, 261.63, 329.63, 440.0],
      ];
      break;
    case 'HORROR_DARK':
      beatDuration = 0.8;
      beatsPerLoop = 16;
      baseChords = [
        [138.59, 164.81, 207.65, 277.18],
        [138.59, 196.0, 246.94, 293.66],
        [146.83, 174.61, 220.0, 293.66],
        [138.59, 196.0, 233.08, 277.18],
      ];
      break;
    case 'EPIC_ACTION':
    default:
      beatDuration = 0.46875;
      beatsPerLoop = 32;
      baseChords = [
        [146.83, 220.0, 293.66, 349.23],
        [116.54, 174.61, 233.08, 293.66],
        [130.81, 196.0, 261.63, 329.63],
        [110.0, 164.81, 220.0, 277.18],
      ];
      break;
  }

  const chords = baseChords.map((c) => c.map((n) => n * pitchScale));
  const loopDuration = beatsPerLoop * beatDuration;
  const chordDuration = loopDuration / chords.length;
  const totalSamples = Math.round(loopDuration * sampleRate);

  const arpOrder =
    arpVariant === 0
      ? [0, 1, 2, 3, 2, 1, 3, 2]
      : arpVariant === 1
      ? [0, 2, 1, 3, 0, 3, 2, 1]
      : [3, 2, 1, 0, 1, 2, 3, 2];

  const rand = createSeededRandom(bgmSeed);
  const randDouble = () => rand() * 2.0 - 1.0;

  writeMono16BitWav(outputFile, sampleRate, totalSamples, (i) => {
    const t = i / sampleRate;
    const chordIndex = Math.max(0, Math.min(chords.length - 1, Math.floor(t / chordDuration)));
    const chordLocalT = t - chordIndex * chordDuration;
    const chord = chords[chordIndex];
    const beatT = t % beatDuration;
    const beatNumber = Math.floor(t / beatDuration);
    const halfBeatT = t % (beatDuration * 0.5);
    const quarterBeatT = t % (beatDuration * 0.25);

    const loopEnv = Math.min(1.0, t / 0.04) * Math.min(1.0, (loopDuration - t) / 0.04);
    const chordEnv = Math.min(1.0, chordLocalT / 0.12) * Math.min(1.0, (chordDuration - chordLocalT) / 0.12);

    let sample = 0;
    switch (style) {
      case 'COMEDY_ROAST': {
        const stepIdx = Math.floor(t / (beatDuration * 0.5)) % arpOrder.length;
        const pluckFreq = chord[arpOrder[stepIdx]] * 1.5;
        const pluckEnv = Math.exp(-12.0 * halfBeatT);
        const pluck =
          (Math.sin(2.0 * Math.PI * pluckFreq * halfBeatT) +
            0.35 * Math.sin(2.0 * Math.PI * pluckFreq * 2.0 * halfBeatT)) *
          pluckEnv *
          0.36;
        const bassFreq = chord[0] * 0.5;
        const bass = Math.sin(2.0 * Math.PI * bassFreq * beatT) * Math.exp(-7.5 * beatT) * 0.34;
        const snap = beatNumber % 2 === 1 ? randDouble() * Math.exp(-28.0 * beatT) * 0.26 : 0.0;
        sample = pluck + bass + snap;
        break;
      }
      case 'SUSPENSE_THRILLER': {
        const tick =
          (Math.sin(2.0 * Math.PI * 1950.0 * halfBeatT) * 0.5 + randDouble() * 0.5) *
          Math.exp(-55.0 * halfBeatT) *
          0.22;
        const heartbeat =
          beatNumber % 2 === 0 ? Math.sin(2.0 * Math.PI * 72.0 * beatT) * Math.exp(-12.0 * beatT) * 0.4 : 0.0;
        const bellFreq = chord[3] * 2.0;
        const bell = Math.sin(2.0 * Math.PI * bellFreq * chordLocalT) * Math.exp(-1.8 * chordLocalT) * 0.2;
        const lowDrone =
          (Math.sin(2.0 * Math.PI * chord[0] * 0.5 * t) * 0.2 + Math.sin(2.0 * Math.PI * chord[1] * t) * 0.1) *
          chordEnv;
        sample = tick + heartbeat + bell + lowDrone;
        break;
      }
      case 'EMOTIONAL_SAD': {
        const pianoAttack = Math.min(1.0, chordLocalT / 0.025);
        const pianoDecay = Math.exp(-1.4 * chordLocalT);
        let piano = 0.0;
        for (const freq of chord) {
          piano += Math.sin(2.0 * Math.PI * freq * t) * 0.18 + Math.sin(2.0 * Math.PI * freq * 2.0 * t) * 0.05;
        }
        piano *= pianoAttack * pianoDecay;
        const stepIdx = Math.floor(t / beatDuration) % arpOrder.length;
        const melodyFreq = chord[arpOrder[stepIdx]] * 2.0;
        const melody =
          Math.sin(2.0 * Math.PI * melodyFreq * beatT) *
          Math.min(1.0, beatT / 0.015) *
          Math.exp(-2.8 * beatT) *
          0.24;
        const warmPad = Math.sin(2.0 * Math.PI * chord[0] * 0.5 * t) * chordEnv * 0.22;
        sample = piano + melody + warmPad;
        break;
      }
      case 'DEVOTIONAL': {
        const drone =
          (Math.sin(2.0 * Math.PI * chord[0] * 0.5 * t) * 0.22 +
            Math.sin(2.0 * Math.PI * chord[1] * t) * 0.12 +
            Math.sin(2.0 * Math.PI * chord[2] * t) * 0.08) *
          chordEnv;
        const stepIdx = Math.floor(t / beatDuration) % arpOrder.length;
        const fluteFreq = chord[arpOrder[stepIdx]] * 2.0;
        const vibrato = 1.0 + 0.008 * Math.sin(2.0 * Math.PI * 5.2 * t);
        const fluteEnv = Math.pow(Math.sin(Math.PI * Math.max(0.0, Math.min(1.0, beatT / beatDuration))), 0.8);
        const flute = Math.sin(2.0 * Math.PI * fluteFreq * vibrato * t) * fluteEnv * 0.24;
        const bell =
          (Math.sin(2.0 * Math.PI * chord[3] * 2.0 * chordLocalT) +
            0.4 * Math.sin(2.0 * Math.PI * chord[3] * 4.0 * chordLocalT)) *
          Math.exp(-2.6 * chordLocalT) *
          0.16;
        sample = drone + flute + bell;
        break;
      }
      case 'SCI_FI_TECH': {
        const stepIdx = Math.floor(t / (beatDuration * 0.25)) % arpOrder.length;
        const arpFreq = chord[arpOrder[stepIdx]] * 2.0;
        const arp =
          (Math.sin(2.0 * Math.PI * arpFreq * quarterBeatT) +
            0.4 * Math.sin(2.0 * Math.PI * arpFreq * 2.0 * quarterBeatT)) *
          Math.exp(-14.0 * quarterBeatT) *
          0.28;
        const pad =
          (Math.sin(2.0 * Math.PI * chord[0] * t) * 0.16 + Math.sin(2.0 * Math.PI * chord[2] * t) * 0.12) * chordEnv;
        const kickFreq = 58.0 + 130.0 * Math.exp(-30.0 * beatT);
        const kick = Math.sin(2.0 * Math.PI * kickFreq * beatT) * Math.exp(-11.0 * beatT) * 0.36;
        const hat = stepIdx % 2 === 1 ? randDouble() * Math.exp(-45.0 * quarterBeatT) * 0.12 : 0.0;
        sample = arp + pad + kick + hat;
        break;
      }
      case 'MOTIVATIONAL': {
        const stepIdx = Math.floor(t / (beatDuration * 0.5)) % arpOrder.length;
        const arpFreq = chord[arpOrder[stepIdx]] * 1.5;
        const arp = Math.sin(2.0 * Math.PI * arpFreq * halfBeatT) * Math.exp(-7.5 * halfBeatT) * 0.28;
        let pad = 0.0;
        for (const freq of chord) {
          pad += Math.sin(2.0 * Math.PI * freq * t) * 0.12;
        }
        pad *= chordEnv;
        const kickFreq = 62.0 + 95.0 * Math.exp(-22.0 * beatT);
        const kick = Math.sin(2.0 * Math.PI * kickFreq * beatT) * Math.exp(-10.0 * beatT) * 0.34;
        sample = arp + pad + kick;
        break;
      }
      case 'HORROR_DARK': {
        const lfo = 0.7 + 0.3 * Math.sin(2.0 * Math.PI * 0.35 * t);
        const drone =
          (Math.sin(2.0 * Math.PI * chord[0] * 0.5 * t) * 0.28 +
            Math.sin(2.0 * Math.PI * chord[1] * t) * 0.16 +
            Math.sin(2.0 * Math.PI * chord[3] * 1.5 * t) * 0.08) *
          chordEnv *
          lfo;
        const metalHit =
          beatNumber % 4 === 0
            ? (Math.sin(2.0 * Math.PI * 740.0 * beatT) * 0.6 + Math.sin(2.0 * Math.PI * 1185.0 * beatT) * 0.4) *
              Math.exp(-2.4 * beatT) *
              0.22
            : 0.0;
        sample = drone + metalHit;
        break;
      }
      case 'EPIC_ACTION':
      default: {
        let brass = 0.0;
        for (const freq of chord) {
          brass +=
            Math.sin(2.0 * Math.PI * freq * t) * 0.14 +
            Math.sin(2.0 * Math.PI * freq * 2.0 * t) * 0.05 +
            Math.sin(2.0 * Math.PI * freq * 3.0 * t) * 0.012;
        }
        brass *= chordEnv * (0.85 + 0.15 * Math.sin(2.0 * Math.PI * 0.6 * t));
        const stepIdx = Math.floor(t / (beatDuration * 0.5)) % arpOrder.length;
        const motifFreq = chord[arpOrder[stepIdx]] * 1.5;
        const motif = Math.sin(2.0 * Math.PI * motifFreq * halfBeatT) * Math.exp(-9.0 * halfBeatT) * 0.2;
        const drumFreq = 65.0 + 105.0 * Math.exp(-26.0 * beatT);
        const mainDrum = Math.sin(2.0 * Math.PI * drumFreq * beatT) * Math.exp(-13.0 * beatT) * 0.4;
        const doubleHit = Math.sin(2.0 * Math.PI * 88.0 * halfBeatT) * Math.exp(-18.0 * halfBeatT) * 0.18;
        sample = brass + motif + mainDrum + doubleHit;
        break;
      }
    }

    return Math.max(-0.92, Math.min(0.92, sample * loopEnv));
  });
}

export function writeMono16BitWav(
  filePath: string,
  sampleRate: number,
  totalSamples: number,
  sampleProvider: (idx: number) => number
): void {
  const dataSize = totalSamples * 2;
  const buf = Buffer.allocUnsafe(44 + dataSize);

  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < totalSamples; i++) {
    const val = Math.max(-1.0, Math.min(1.0, sampleProvider(i)));
    const s = Math.trunc(val * 32767.0);
    buf.writeInt16LE(s, 44 + i * 2);
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buf);
}

export function readMono16BitWavSamples(wavFile: string): Int16Array {
  if (!fs.existsSync(wavFile)) return new Int16Array(0);
  const bytes = fs.readFileSync(wavFile);
  if (bytes.length <= 44) return new Int16Array(0);

  let dataStart = 44;
  let dataLen = bytes.length - 44;

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkId = bytes.subarray(offset, offset + 4).toString('ascii');
    const chunkSize = bytes.readInt32LE(offset + 4);
    if (chunkId === 'data') {
      dataStart = offset + 8;
      dataLen = Math.max(0, Math.min(chunkSize, bytes.length - dataStart));
      break;
    }
    if (chunkSize < 0) break;
    offset += 8 + chunkSize + (chunkSize & 1);
  }

  const sampleCount = Math.floor(dataLen / 2);
  const samples = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = bytes.readInt16LE(dataStart + i * 2);
  }
  return samples;
}

export function getPcmWavDurationSeconds(wavFile: string): number {
  if (!fs.existsSync(wavFile)) return 0;
  const stats = fs.statSync(wavFile);
  const dataBytes = Math.max(0, stats.size - 44);
  return dataBytes / (44100.0 * 2.0);
}

export function mixVoiceBgmSfxWav(
  voiceWavFile: string,
  bgmWavFile: string | null,
  sfxWavFile: string | null,
  totalDurationSeconds: number,
  outWavFile: string
): boolean {
  const voiceSamples = readMono16BitWavSamples(voiceWavFile);
  const bgmSamples = bgmWavFile ? readMono16BitWavSamples(bgmWavFile) : new Int16Array(0);
  const sfxSamples = sfxWavFile ? readMono16BitWavSamples(sfxWavFile) : new Int16Array(0);

  const totalSamples = Math.max(voiceSamples.length, Math.round(totalDurationSeconds * 44100.0));
  if (totalSamples <= 0) return false;

  const blockSize = 441;
  const bgmGains = new Float32Array(totalSamples);
  let smoothedGain = 0.14;
  let cursor = 0;

  while (cursor < totalSamples) {
    const end = Math.min(cursor + blockSize, totalSamples);
    let peak = 0;
    const voiceEnd = Math.min(end, voiceSamples.length);
    for (let k = cursor; k < voiceEnd; k++) {
      const a = Math.abs(voiceSamples[k]);
      if (a > peak) peak = a;
    }
    const targetGain = peak > 900 ? 0.08 : 0.22;
    const coeff = targetGain < smoothedGain ? 0.35 : 0.08;
    smoothedGain += (targetGain - smoothedGain) * coeff;
    for (let k = cursor; k < end; k++) {
      bgmGains[k] = smoothedGain;
    }
    cursor = end;
  }

  writeMono16BitWav(outWavFile, 44100, totalSamples, (idx) => {
    const v = idx < voiceSamples.length ? voiceSamples[idx] / 32768.0 : 0.0;
    const b = bgmSamples.length > 0 ? (bgmSamples[idx % bgmSamples.length] / 32768.0) * bgmGains[idx] : 0.0;
    const s = idx < sfxSamples.length ? (sfxSamples[idx] / 32768.0) * 0.35 : 0.0;
    return Math.max(-0.96, Math.min(0.96, v + b + s));
  });

  return fs.existsSync(outWavFile) && fs.statSync(outWavFile).size > 44;
}
