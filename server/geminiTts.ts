import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs';
import path from 'node:path';
import { readMono16BitWavSamples, writeMono16BitWav } from './bgmSynth.ts';
import type { VideoLanguageKey, VideoSlab, VoiceGender, VoiceTone } from './types.ts';

export interface OneTicketGeminiTtsResult {
  wavBuffer: Buffer;
  voiceName: string;
  model: string;
}

export interface WhisperWordTimestamp {
  word: string;
  start: number;
  end: number;
}

const GEMINI_PRIMARY_TTS_MODEL = 'gemini-3.8-flash-tts';
const GEMINI_FALLBACK_TTS_MODEL = 'gemini-3.8-flash-lite-tts';
const SAMPLE_RATE = 44100;

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = (process.env.GEMINI_API_KEY ?? '').trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function isGeminiTtsAvailable(): boolean {
  return Boolean((process.env.GEMINI_API_KEY ?? '').trim());
}

export function resolveGeminiVoiceName(gender: VoiceGender, voiceTone: VoiceTone): string {
  if (gender === 'FEMALE') {
    return voiceTone === 'ENERGETIC' || voiceTone === 'FUNNY' ? 'Zephyr' : 'Kore';
  }
  switch (voiceTone) {
    case 'SERIOUS':
      return 'Charon';
    case 'ENERGETIC':
      return 'Fenrir';
    case 'NATURAL':
    case 'FUNNY':
    case 'AUTO':
    default:
      return 'Puck';
  }
}

export function buildActingStyleInstruction(
  emotion: string,
  voiceTone: VoiceTone,
  sceneIndex: number,
  totalScenes: number,
  language: VideoLanguageKey
): string {
  const emo = emotion.toLowerCase().trim();
  let emotionDirective: string;
  switch (emo) {
    case 'hook':
      emotionDirective =
        'High-energy charismatic YouTube hook, curious and attention-grabbing opening, crisp emphasis, natural human pacing';
      break;
    case 'excited':
    case 'roast':
      emotionDirective =
        'Lively expressive storytelling with playful energy, animated vocal smile, crisp comedic or punchy emphasis';
      break;
    case 'climax':
      emotionDirective =
        'Dramatic cinematic climax peak, commanding conviction, weighty impact with rich vocal depth';
      break;
    case 'suspense':
      emotionDirective =
        'Hushed tense mysterious tone, slightly slower deliberate pacing, building curiosity';
      break;
    case 'sad':
      emotionDirective =
        'Soft heartfelt empathetic tone, gentle slower cadence, authentic emotional warmth';
      break;
    case 'question':
      emotionDirective =
        'Curious conversational rising inflection, engaging directly with the listener';
      break;
    case 'warm':
      emotionDirective =
        'Warm friendly approachable creator voice, relaxed conversational rhythm, genuine warmth';
      break;
    default:
      emotionDirective =
        'Natural conversational creator voice, effortless human cadence with gentle micro-pauses';
      break;
  }

  let toneDirective = '';
  switch (voiceTone) {
    case 'FUNNY':
      toneDirective = 'witty playful timing';
      break;
    case 'SERIOUS':
      toneDirective = 'grounded intense gravitas';
      break;
    case 'ENERGETIC':
      toneDirective = 'fast upbeat momentum';
      break;
    case 'NATURAL':
      toneDirective = 'intimate podcast studio mic feel';
      break;
    case 'AUTO':
    default:
      toneDirective = 'expressive human storytelling';
      break;
  }

  const positionHint =
    sceneIndex === 0
      ? 'opening hook line'
      : sceneIndex === totalScenes - 1
      ? 'satisfying closing line'
      : 'seamless mid-story beat';

  const langHint =
    language === 'ENGLISH_US'
      ? 'clear natural American English'
      : language === 'ENGLISH_IN'
      ? 'natural warm Indian English'
      : 'natural authentic Indian conversational pronunciation across Hindi, Hinglish, and English words';

  return `${emotionDirective}; ${toneDirective}; ${positionHint}; ${langHint}`;
}

function cleanSpokenLine(raw: string): string {
  return raw
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function generateOneTicketGeminiAudio(params: {
  slabs: Array<{ voiceover_text: string; voice_emotion: string }>;
  voiceGender: VoiceGender;
  voiceTone: VoiceTone;
  language: VideoLanguageKey;
}): Promise<OneTicketGeminiTtsResult> {
  const ai = getGeminiClient();
  if (!ai) {
    throw new Error('GEMINI_API_KEY is not configured in server environment.');
  }

  const validSlabs = params.slabs
    .map((s) => ({
      text: cleanSpokenLine(s.voiceover_text),
      emotion: (s.voice_emotion || 'normal').trim(),
    }))
    .filter((s) => s.text.length > 0);

  if (validSlabs.length === 0) {
    throw new Error('No non-empty voiceover lines provided.');
  }

  const voiceName = resolveGeminiVoiceName(params.voiceGender, params.voiceTone);
  const partsWithMetadata = validSlabs.map((slab, idx) => ({
    text: slab.text,
    speechMetadata: {
      style: buildActingStyleInstruction(
        slab.emotion,
        params.voiceTone,
        idx,
        validSlabs.length,
        params.language
      ),
    },
  }));

  const combinedTextOnly = validSlabs.map((s) => s.text).join('\n');

  const attempts: Array<{
    model: string;
    apiVersion?: string;
    parts: Array<Record<string, unknown>>;
    useSpeechConfig: boolean;
  }> = [
    {
      model: GEMINI_PRIMARY_TTS_MODEL,
      apiVersion: 'v1beta',
      parts: partsWithMetadata,
      useSpeechConfig: true,
    },
    {
      model: GEMINI_FALLBACK_TTS_MODEL,
      apiVersion: 'v1beta',
      parts: partsWithMetadata,
      useSpeechConfig: true,
    },
    {
      model: 'gemini-2.5-flash-preview-tts',
      apiVersion: 'v1beta',
      parts: [{ text: combinedTextOnly }],
      useSpeechConfig: true,
    },
    {
      model: GEMINI_PRIMARY_TTS_MODEL,
      apiVersion: 'v1beta',
      parts: [{ text: combinedTextOnly }],
      useSpeechConfig: true,
    },
    {
      model: GEMINI_FALLBACK_TTS_MODEL,
      apiVersion: 'v1beta',
      parts: [{ text: combinedTextOnly }],
      useSpeechConfig: false,
    },
  ];

  const rawKey = (process.env.GEMINI_API_KEY ?? '').trim();
  let lastError: unknown = null;

  for (const cfg of attempts) {
    try {
      const client = cfg.apiVersion
        ? new GoogleGenAI({
            apiKey: rawKey,
            apiVersion: cfg.apiVersion,
            httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
          })
        : ai;
      const response = await client.models.generateContent({
        model: cfg.model,
        contents: [
          {
            role: 'user',
            parts: cfg.parts as never,
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          ...(cfg.useSpeechConfig
            ? {
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName },
                  },
                },
              }
            : {}),
        },
      });

      const responseParts = response.candidates?.[0]?.content?.parts ?? [];
      const audioPart = responseParts.find((p) => p.inlineData?.data);
      const base64Audio = audioPart?.inlineData?.data;
      if (base64Audio) {
        const wavBuffer = Buffer.from(base64Audio, 'base64');
        if (wavBuffer.length > 1024) {
          return { wavBuffer, voiceName, model: cfg.model };
        }
      }
      lastError = new Error(`Model ${cfg.model} returned empty audio payload.`);
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isQuota = /429|RESOURCE_EXHAUSTED|quota/i.test(msg);
      const isAuth = /401|403|API_KEY_INVALID|PERMISSION_DENIED/i.test(msg);
      if (isQuota || isAuth) {
        throw err instanceof Error ? err : new Error(msg);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Gemini 1-ticket TTS failed.');
}

export async function transcribeWithGroqWhisperWords(mp3File: string): Promise<WhisperWordTimestamp[]> {
  const groqKey = (process.env.GROQ_API_KEY ?? '').trim();
  if (!groqKey || !fs.existsSync(mp3File)) return [];

  try {
    const audioBytes = fs.readFileSync(mp3File);
    const form = new FormData();
    form.append('file', new Blob([audioBytes], { type: 'audio/mpeg' }), 'voice.mp3');
    form.append('model', 'whisper-large-v3');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${groqKey}`,
      },
      body: form,
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      words?: Array<{ word?: string; start?: number; end?: number }>;
    };
    return (data.words ?? [])
      .filter((w) => typeof w.start === 'number' && typeof w.end === 'number' && (w.word ?? '').trim().length > 0)
      .map((w) => ({
        word: String(w.word).trim(),
        start: Number(w.start),
        end: Number(w.end),
      }));
  } catch {
    return [];
  }
}

function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

function tokensRoughlyMatch(a: string, b: string): boolean {
  const na = normalizeToken(a);
  const nb = normalizeToken(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 3 && nb.length >= 3 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

/**
 * Finds the quietest 20ms RMS midpoint near targetSeconds inside [targetSeconds - searchWindowSec, targetSeconds + searchWindowSec].
 * Guarantees scene splits never slice mid-phoneme.
 */
export function snapBoundaryToSilenceMidpoint(
  samples: Int16Array,
  targetSeconds: number,
  minSeconds: number,
  maxSeconds: number,
  searchWindowSec = 0.28
): number {
  const totalSec = samples.length / SAMPLE_RATE;
  const clampedMin = Math.max(0, minSeconds);
  const clampedMax = Math.min(totalSec, maxSeconds);
  if (clampedMax <= clampedMin) return clampedMin;

  const winStart = Math.max(clampedMin, targetSeconds - searchWindowSec);
  const winEnd = Math.min(clampedMax, targetSeconds + searchWindowSec);
  const stepSamples = Math.round(0.01 * SAMPLE_RATE); // 10ms hop
  const frameSamples = Math.round(0.02 * SAMPLE_RATE); // 20ms window

  const startIdx = Math.max(0, Math.floor(winStart * SAMPLE_RATE));
  const endIdx = Math.min(samples.length - frameSamples, Math.floor(winEnd * SAMPLE_RATE));
  if (endIdx <= startIdx) {
    return Math.max(clampedMin, Math.min(clampedMax, targetSeconds));
  }

  let bestIdx = Math.round(Math.max(clampedMin, Math.min(clampedMax, targetSeconds)) * SAMPLE_RATE);
  let bestScore = Number.POSITIVE_INFINITY;

  for (let i = startIdx; i <= endIdx; i += stepSamples) {
    let sumSq = 0;
    for (let k = 0; k < frameSamples; k++) {
      const s = samples[i + k] / 32768.0;
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / frameSamples);
    const tSec = (i + frameSamples * 0.5) / SAMPLE_RATE;
    const distPenalty = Math.abs(tSec - targetSeconds) * 0.035;
    const score = rms + distPenalty;
    if (score < bestScore) {
      bestScore = score;
      bestIdx = Math.round(i + frameSamples * 0.5);
    }
  }

  const snappedSec = bestIdx / SAMPLE_RATE;
  return Math.max(clampedMin, Math.min(clampedMax, snappedSec));
}

export function computeAlignedSceneBoundariesSeconds(
  slabs: VideoSlab[],
  samples: Int16Array,
  whisperWords: WhisperWordTimestamp[]
): number[] {
  const totalDurationSec = samples.length / SAMPLE_RATE;
  const n = slabs.length;
  if (n <= 1) return [0, totalDurationSec];

  const slabWordArrays = slabs.map((s) =>
    cleanSpokenLine(s.voiceover_text)
      .split(/\s+/)
      .filter(Boolean)
  );
  const charCounts = slabs.map((s) => Math.max(4, cleanSpokenLine(s.voiceover_text).replace(/\s+/g, '').length));
  const totalChars = Math.max(1, charCounts.reduce((a, b) => a + b, 0));

  const cumTargetsSec: number[] = [0];
  let runningChars = 0;
  for (let i = 0; i < n; i++) {
    runningChars += charCounts[i];
    cumTargetsSec.push((runningChars / totalChars) * totalDurationSec);
  }
  cumTargetsSec[n] = totalDurationSec;

  const boundaries: number[] = [0];
  const minSceneDur = 0.55;

  if (whisperWords.length >= n) {
    const totalScriptWords = Math.max(1, slabWordArrays.reduce((sum, w) => sum + w.length, 0));
    const scaleRatio = whisperWords.length / totalScriptWords;
    let wordCursor = 0;
    let cumScriptWords = 0;

    for (let i = 0; i < n - 1; i++) {
      const curSlabWords = slabWordArrays[i];
      const nextSlabWords = slabWordArrays[i + 1];
      cumScriptWords += curSlabWords.length;

      const expectedWordIdx = Math.min(
        whisperWords.length - (n - 1 - i),
        Math.max(wordCursor + 1, Math.round(cumScriptWords * scaleRatio))
      );
      const searchRadius = Math.max(3, Math.round(curSlabWords.length * 0.45));
      const lo = Math.max(wordCursor + 1, expectedWordIdx - searchRadius);
      const hi = Math.min(whisperWords.length - (n - 1 - i), expectedWordIdx + searchRadius);

      const lastToken = curSlabWords[curSlabWords.length - 1] ?? '';
      const firstNextToken = nextSlabWords[0] ?? '';

      let bestSplitWordIdx = expectedWordIdx;
      let bestScore = Number.NEGATIVE_INFINITY;

      for (let k = lo; k <= hi; k++) {
        const prevW = whisperWords[k - 1];
        const nextW = whisperWords[k];
        if (!prevW || !nextW) continue;

        const gapSec = Math.max(0, nextW.start - prevW.end);
        const gapScore = Math.min(0.45, gapSec) * 6.0;
        const endMatch = tokensRoughlyMatch(prevW.word, lastToken) ? 1.8 : 0;
        const startMatch = tokensRoughlyMatch(nextW.word, firstNextToken) ? 1.8 : 0;
        const distPenalty = Math.abs(k - expectedWordIdx) * 0.25;
        const score = gapScore + endMatch + startMatch - distPenalty;

        if (score > bestScore) {
          bestScore = score;
          bestSplitWordIdx = k;
        }
      }

      const prevWord = whisperWords[bestSplitWordIdx - 1];
      const nextWord = whisperWords[bestSplitWordIdx];
      const rawMidpoint =
        prevWord && nextWord
          ? (prevWord.end + nextWord.start) * 0.5
          : cumTargetsSec[i + 1];

      const prevBound = boundaries[i];
      const maxAllowed = totalDurationSec - (n - 1 - i) * minSceneDur;
      const snapped = snapBoundaryToSilenceMidpoint(
        samples,
        rawMidpoint,
        prevBound + minSceneDur,
        Math.max(prevBound + minSceneDur, maxAllowed),
        0.28
      );
      boundaries.push(snapped);
      wordCursor = bestSplitWordIdx;
    }
    boundaries.push(totalDurationSec);
    return boundaries;
  }

  // Fallback alignment using proportional script characters snapped to real PCM pause valleys
  for (let i = 0; i < n - 1; i++) {
    const prevBound = boundaries[i];
    const maxAllowed = totalDurationSec - (n - 1 - i) * minSceneDur;
    const targetSec = cumTargetsSec[i + 1];
    const searchWin = Math.max(0.4, (totalDurationSec / n) * 0.45);
    const snapped = snapBoundaryToSilenceMidpoint(
      samples,
      targetSec,
      prevBound + minSceneDur,
      Math.max(prevBound + minSceneDur, maxAllowed),
      searchWin
    );
    boundaries.push(snapped);
  }
  boundaries.push(totalDurationSec);
  return boundaries;
}

export async function synthesizeOneTicketGeminiVoiceClips(params: {
  renderDirectory: string;
  slabs: VideoSlab[];
  voiceGender: VoiceGender;
  voiceTone: VoiceTone;
  language: VideoLanguageKey;
  runFfmpegFn: (args: string[]) => Promise<void>;
}): Promise<{ wavFiles: string[]; voiceName: string; model: string }> {
  const { wavBuffer, voiceName, model } = await generateOneTicketGeminiAudio({
    slabs: params.slabs,
    voiceGender: params.voiceGender,
    voiceTone: params.voiceTone,
    language: params.language,
  });

  const rawGeminiWav = path.join(params.renderDirectory, 'gemini_raw_24k.wav');
  const masteredFullWav = path.join(params.renderDirectory, 'gemini_mastered_44k.wav');
  const whisperProbeMp3 = path.join(params.renderDirectory, 'gemini_whisper_probe.mp3');

  fs.writeFileSync(rawGeminiWav, wavBuffer);

  // Decode 24kHz unary WAV -> studio broadcast-mastered 44.1kHz mono PCM + trim only outer dead air
  await params.runFfmpegFn([
    '-y',
    '-i',
    rawGeminiWav,
    '-af',
    'aresample=44100,highpass=f=75,acompressor=threshold=-20dB:ratio=2.8:attack=8:release=110,equalizer=f=180:t=q:w=1.1:g=1.8,equalizer=f=3200:t=q:w=1.2:g=1.5,silenceremove=start_periods=1:start_duration=0.02:start_threshold=-52dB,areverse,silenceremove=start_periods=1:start_duration=0.02:start_threshold=-52dB,areverse,adelay=120:all=1,apad=pad_dur=0.14',
    '-ar',
    '44100',
    '-ac',
    '1',
    '-c:a',
    'pcm_s16le',
    masteredFullWav,
  ]);

  if (!fs.existsSync(masteredFullWav) || fs.statSync(masteredFullWav).size <= 44) {
    throw new Error('Failed to decode Gemini 1-ticket WAV audio.');
  }

  // Extract lightweight 16kHz MP3 for Groq Whisper word-level scene alignment
  await params.runFfmpegFn([
    '-y',
    '-i',
    masteredFullWav,
    '-ar',
    '16000',
    '-ac',
    '1',
    '-b:a',
    '48k',
    whisperProbeMp3,
  ]).catch(() => {});

  const whisperWords = await transcribeWithGroqWhisperWords(whisperProbeMp3);
  const fullSamples = readMono16BitWavSamples(masteredFullWav);
  if (fullSamples.length < SAMPLE_RATE / 2) {
    throw new Error('Gemini 1-ticket audio was unexpectedly short.');
  }

  const boundaries = computeAlignedSceneBoundariesSeconds(params.slabs, fullSamples, whisperWords);
  const wavFiles: string[] = [];
  const fadeSamples = Math.round(0.005 * SAMPLE_RATE); // 5ms de-click crossfade at boundaries
  const tailPadSamples = Math.round(0.08 * SAMPLE_RATE); // subtle 80ms visual breathing room

  for (let i = 0; i < params.slabs.length; i++) {
    const startSample = Math.max(0, Math.min(fullSamples.length - 1, Math.round(boundaries[i] * SAMPLE_RATE)));
    const endSample = Math.max(
      startSample + Math.round(0.35 * SAMPLE_RATE),
      Math.min(fullSamples.length, Math.round(boundaries[i + 1] * SAMPLE_RATE))
    );
    const sliceLen = Math.max(1, endSample - startSample);
    const outSamples = sliceLen + tailPadSamples;
    const partFile = path.join(params.renderDirectory, `voice_part_${i + 1}.wav`);

    writeMono16BitWav(partFile, SAMPLE_RATE, outSamples, (idx) => {
      if (idx >= sliceLen) return 0;
      let sample = fullSamples[startSample + idx] / 32768.0;
      if (i > 0 && idx < fadeSamples) {
        sample *= idx / fadeSamples;
      }
      if (i < params.slabs.length - 1 && idx >= sliceLen - fadeSamples) {
        sample *= Math.max(0, sliceLen - idx) / fadeSamples;
      }
      return sample;
    });
    wavFiles.push(partFile);
  }

  if (fs.existsSync(rawGeminiWav)) fs.unlinkSync(rawGeminiWav);
  if (fs.existsSync(whisperProbeMp3)) fs.unlinkSync(whisperProbeMp3);
  if (fs.existsSync(masteredFullWav)) fs.unlinkSync(masteredFullWav);

  return { wavFiles, voiceName, model };
}
