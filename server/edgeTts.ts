import crypto from 'node:crypto';
import WebSocket from 'ws';
import type { VoiceTone } from './types.ts';

export interface EdgeTtsClipResult {
  audioBytes: Buffer;
  usedFallback: boolean;
}

const DEFAULT_VOICE_RATE = '+24%';
const DEFAULT_VOICE_PITCH = '+1Hz';
const EDGE_TTS_TIMEOUT_MS = 15_000;
const EDGE_COOLDOWN_MS = 60_000;
const MAX_CHUNK_LENGTH = 160;
const MAX_ATTEMPTS = 3;

const EDGE_PRIMARY_WS_URL = 'https://api.msedgeservices.com/tts/cognitiveservices/websocket/v1';
const EDGE_LEGACY_WS_URL = 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const SEC_MS_GEC_VERSION = '1-143.0.3650.75';
const EDGE_ORIGIN = 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold';
const EDGE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0';

let consecutiveEdgeFailures = 0;
let edgeDisabledUntilMs = 0;
let clockSkewSeconds = 0;

let activePermits = 0;
const permitQueue: Array<() => void> = [];

async function withEdgePermit<T>(fn: () => Promise<T>): Promise<T> {
  if (activePermits >= 2) {
    await new Promise<void>((resolve) => permitQueue.push(resolve));
  }
  activePermits++;
  try {
    return await fn();
  } finally {
    activePermits--;
    const next = permitQueue.shift();
    if (next) next();
  }
}

export function sanitizeTtsText(rawText: string): string {
  return rawText
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveProsody(emotion: string, voiceTone: VoiceTone): { rate: string; pitch: string } {
  const emo = emotion.toLowerCase().trim();
  switch (voiceTone) {
    case 'NATURAL':
      switch (emo) {
        case 'hook': return { rate: '+24%', pitch: '+2Hz' };
        case 'excited': return { rate: '+26%', pitch: '+3Hz' };
        case 'climax': return { rate: '+25%', pitch: '+1Hz' };
        case 'suspense': return { rate: '+12%', pitch: '-5Hz' };
        case 'sad': return { rate: '+8%', pitch: '-6Hz' };
        case 'roast': return { rate: '+23%', pitch: '+2Hz' };
        case 'question': return { rate: '+18%', pitch: '+3Hz' };
        case 'warm': return { rate: '+14%', pitch: '-1Hz' };
        default: return { rate: '+20%', pitch: '-1Hz' };
      }
    case 'FUNNY':
      switch (emo) {
        case 'hook': return { rate: '+28%', pitch: '+4Hz' };
        case 'excited': return { rate: '+30%', pitch: '+5Hz' };
        case 'climax': return { rate: '+29%', pitch: '+4Hz' };
        case 'suspense': return { rate: '+15%', pitch: '-3Hz' };
        case 'sad': return { rate: '+10%', pitch: '-4Hz' };
        case 'roast': return { rate: '+27%', pitch: '+4Hz' };
        case 'question': return { rate: '+22%', pitch: '+5Hz' };
        case 'warm': return { rate: '+18%', pitch: '+1Hz' };
        default: return { rate: '+24%', pitch: '+2Hz' };
      }
    case 'SERIOUS':
      switch (emo) {
        case 'hook': return { rate: '+18%', pitch: '-3Hz' };
        case 'excited': return { rate: '+21%', pitch: '-2Hz' };
        case 'climax': return { rate: '+22%', pitch: '-4Hz' };
        case 'suspense': return { rate: '+10%', pitch: '-8Hz' };
        case 'sad': return { rate: '+6%', pitch: '-8Hz' };
        case 'roast': return { rate: '+18%', pitch: '-3Hz' };
        case 'question': return { rate: '+14%', pitch: '-1Hz' };
        case 'warm': return { rate: '+12%', pitch: '-4Hz' };
        default: return { rate: '+15%', pitch: '-5Hz' };
      }
    case 'ENERGETIC':
      switch (emo) {
        case 'hook': return { rate: '+30%', pitch: '+3Hz' };
        case 'excited': return { rate: '+32%', pitch: '+4Hz' };
        case 'climax': return { rate: '+31%', pitch: '+2Hz' };
        case 'suspense': return { rate: '+18%', pitch: '-3Hz' };
        case 'sad': return { rate: '+12%', pitch: '-4Hz' };
        case 'roast': return { rate: '+29%', pitch: '+3Hz' };
        case 'question': return { rate: '+24%', pitch: '+4Hz' };
        case 'warm': return { rate: '+20%', pitch: '0Hz' };
        default: return { rate: '+26%', pitch: '+1Hz' };
      }
    default:
      switch (emo) {
        case 'hook': return { rate: '+24%', pitch: '+2Hz' };
        case 'excited': return { rate: '+27%', pitch: '+4Hz' };
        case 'climax': return { rate: '+26%', pitch: '+1Hz' };
        case 'suspense': return { rate: '+12%', pitch: '-6Hz' };
        case 'sad': return { rate: '+8%', pitch: '-7Hz' };
        case 'roast': return { rate: '+25%', pitch: '+3Hz' };
        case 'question': return { rate: '+18%', pitch: '+3Hz' };
        case 'warm': return { rate: '+14%', pitch: '-2Hz' };
        default: return { rate: '+20%', pitch: '-2Hz' };
      }
  }
}

export async function generateDynamicVoiceClipWithMeta(
  text: string,
  voiceName: string,
  emotion: string,
  voiceTone: VoiceTone = 'AUTO'
): Promise<EdgeTtsClipResult> {
  const cleanSpokenText = sanitizeTtsText(text);
  if (!cleanSpokenText) throw new Error('Voiceover text must not be blank.');

  const { rate, pitch } = resolveProsody(emotion, voiceTone);
  const safeRate = clampSafeRate(rate);
  const safePitch = sanitizeSafePitch(pitch);
  const targetVoice = resolveEdgeVoiceShortName(voiceName || 'hi-IN-MadhurNeural');

  if (Date.now() >= edgeDisabledUntilMs) {
    let edgeBytes: Buffer | null = null;
    try {
      edgeBytes = await withEdgePermit(() =>
        synthesizeViaDirectEdgeWebSocketWithRetry(cleanSpokenText, targetVoice, safeRate, safePitch)
      );
    } catch {
      edgeBytes = null;
    }

    if (edgeBytes && edgeBytes.length > 0) {
      consecutiveEdgeFailures = 0;
      return { audioBytes: edgeBytes, usedFallback: false };
    }

    consecutiveEdgeFailures++;
    if (consecutiveEdgeFailures >= 4) {
      edgeDisabledUntilMs = Date.now() + EDGE_COOLDOWN_MS;
    }
  }

  const fallbackBytes = await synthesizeWithGoogleFallback(cleanSpokenText, targetVoice);
  if (fallbackBytes.length === 0) {
    throw new Error('TTS produced empty audio output.');
  }
  return { audioBytes: fallbackBytes, usedFallback: true };
}

async function synthesizeViaDirectEdgeWebSocketWithRetry(
  text: string,
  voiceName: string,
  rate: string,
  pitch: string
): Promise<Buffer> {
  const endpoints = [EDGE_PRIMARY_WS_URL, EDGE_LEGACY_WS_URL];
  let lastError: unknown = null;

  for (const endpoint of endpoints) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await executeEdgeWebSocket(endpoint, text, voiceName, rate, pitch);
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt === 0 && msg.includes('403')) {
          await syncClockSkewFromEndpoint(endpoint);
        }
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Edge TTS WebSocket synthesis failed.');
}

function executeEdgeWebSocket(
  baseHttpsUrl: string,
  text: string,
  voiceName: string,
  rate: string,
  pitch: string
): Promise<Buffer> {
  const connectionId = crypto.randomUUID().replace(/-/g, '');
  const requestId = crypto.randomUUID().replace(/-/g, '');
  const secMsGec = generateSecMsGec(clockSkewSeconds);

  const urlObj = new URL(baseHttpsUrl);
  urlObj.searchParams.set('TrustedClientToken', TRUSTED_CLIENT_TOKEN);
  urlObj.searchParams.set('Sec-MS-GEC', secMsGec);
  urlObj.searchParams.set('Sec-MS-GEC-Version', SEC_MS_GEC_VERSION);
  urlObj.searchParams.set('ConnectionId', connectionId);
  const wsUrl = urlObj.toString().replace(/^https:\/\//, 'wss://');

  const locale = voiceName.split('-').slice(0, 2).join('-') || 'en-US';
  const escapedText = escapeXml(text);
  const timestamp = edgeTimestamp();

  const speechConfigMsg =
    `X-Timestamp:${timestamp}\r\n` +
    `Content-Type:application/json; charset=utf-8\r\n` +
    `Path:speech.config\r\n\r\n` +
    `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`;

  const ssmlBody =
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${locale}'>` +
    `<voice name='${voiceName}'>` +
    `<prosody pitch='${pitch}' rate='${rate}' volume='+0%'>${escapedText}</prosody>` +
    `</voice></speak>`;

  const ssmlMsg =
    `X-RequestId:${requestId}\r\n` +
    `Content-Type:application/ssml+xml\r\n` +
    `X-Timestamp:${timestamp}\r\n` +
    `Path:ssml\r\n\r\n${ssmlBody}`;

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;

    const ws = new WebSocket(wsUrl, {
      headers: {
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
        Origin: EDGE_ORIGIN,
        'User-Agent': EDGE_USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9',
      },
      handshakeTimeout: 12_000,
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          ws.terminate();
        } catch {
          // ignore
        }
        reject(new Error(`Edge TTS timed out after ${EDGE_TTS_TIMEOUT_MS / 1000}s`));
      }
    }, EDGE_TTS_TIMEOUT_MS);

    const finishSuccess = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      try {
        ws.close(1000, 'done');
      } catch {
        // ignore
      }
      if (buf.length > 0) {
        resolve(buf);
      } else {
        reject(new Error('Edge TTS returned empty audio stream.'));
      }
    };

    const finishError = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.terminate();
      } catch {
        // ignore
      }
      reject(err);
    };

    ws.on('open', () => {
      ws.send(speechConfigMsg);
      ws.send(ssmlMsg);
    });

    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        const str = data.toString('utf8');
        if (str.toLowerCase().includes('path:turn.end')) {
          finishSuccess();
        }
        return;
      }

      const arr = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      if (arr.length < 2) return;
      const headerLen = ((arr[0] & 0xff) << 8) | (arr[1] & 0xff);
      const dataOffset = 2 + headerLen;
      if (headerLen > 0 && dataOffset <= arr.length) {
        const header = arr.subarray(2, dataOffset).toString('ascii');
        if (header.toLowerCase().includes('path:audio') && dataOffset < arr.length) {
          chunks.push(arr.subarray(dataOffset));
        }
      }
    });

    ws.on('unexpected-response', (_req, res) => {
      const dateHeader = res.headers['date'];
      if (typeof dateHeader === 'string') {
        updateClockSkewFromDateHeader(dateHeader);
      }
      finishError(new Error(`Edge TTS failed: HTTP ${res.statusCode ?? 0}`));
    });

    ws.on('error', (err) => {
      finishError(new Error(`Edge TTS failed: ${err.message}`));
    });

    ws.on('close', (code, reason) => {
      if (!settled) {
        const buf = Buffer.concat(chunks);
        if (buf.length > 0) {
          finishSuccess();
        } else {
          finishError(new Error(`Edge TTS closed (${code}): ${reason.toString()}`));
        }
      }
    });
  });
}

function generateSecMsGec(skewSec: number): string {
  const unixSeconds = Math.floor(Date.now() / 1000) + skewSec;
  const windowsSeconds = BigInt(unixSeconds) + 11_644_473_600n;
  const roundedSeconds = windowsSeconds - (windowsSeconds % 300n);
  const fileTimeTicks = roundedSeconds * 10_000_000n;
  const raw = `${fileTimeTicks.toString()}${TRUSTED_CLIENT_TOKEN}`;
  return crypto.createHash('sha256').update(raw, 'ascii').digest('hex').toUpperCase();
}

async function syncClockSkewFromEndpoint(endpointUrl: string): Promise<void> {
  try {
    const parsed = new URL(endpointUrl);
    const rootUrl = `${parsed.protocol}//${parsed.host}/`;
    const res = await fetch(rootUrl, {
      method: 'HEAD',
      headers: { 'User-Agent': EDGE_USER_AGENT },
    });
    const dateHeader = res.headers.get('date');
    if (dateHeader) updateClockSkewFromDateHeader(dateHeader);
  } catch {
    // ignore
  }
}

function updateClockSkewFromDateHeader(dateHeader: string): void {
  const ms = Date.parse(dateHeader);
  if (!Number.isNaN(ms)) {
    clockSkewSeconds = Math.floor(ms / 1000) - Math.floor(Date.now() / 1000);
  }
}

function edgeTimestamp(): string {
  const d = new Date();
  return d.toUTCString().replace('GMT', 'GMT+0000 (Coordinated Universal Time)');
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function resolveEdgeVoiceShortName(requestedVoice: string): string {
  const trimmed = requestedVoice.trim();
  if (trimmed.toLowerCase().includes('neural') && (trimmed.match(/-/g) ?? []).length >= 2) {
    return trimmed;
  }
  return 'hi-IN-MadhurNeural';
}

function clampSafeRate(rawRate: string): string {
  const match = rawRate.trim().match(/([+-]?\d+)%/);
  if (!match) return DEFAULT_VOICE_RATE;
  const val = Math.max(-25, Math.min(35, Number.parseInt(match[1], 10) || 22));
  return val >= 0 ? `+${val}%` : `${val}%`;
}

function sanitizeSafePitch(rawPitch: string): string {
  const match = rawPitch.trim().match(/([+-]?\d+)Hz/i);
  if (!match) return DEFAULT_VOICE_PITCH;
  let val = Math.max(-12, Math.min(12, Number.parseInt(match[1], 10) || 1));
  if (val === 0) val = 1;
  return val > 0 ? `+${val}Hz` : `${val}Hz`;
}

async function synthesizeWithGoogleFallback(cleanText: string, voiceName: string): Promise<Buffer> {
  const languageCode = resolveLanguageCode(voiceName);
  const chunks = splitIntoChunks(cleanText, MAX_CHUNK_LENGTH);
  if (chunks.length === 0) throw new Error('No speakable text chunks found.');

  const buffers: Buffer[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunkBytes = await fetchChunkWithRetry(chunks[i], languageCode);
    buffers.push(i > 0 ? stripId3v2Header(chunkBytes) : chunkBytes);
  }
  return Buffer.concat(buffers);
}

async function fetchChunkWithRetry(chunk: string, languageCode: string): Promise<Buffer> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await fetchTtsChunk(chunk, languageCode);
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, 450 * (attempt + 1)));
      }
    }
  }
  throw new Error(
    `TTS synthesis failed after ${MAX_ATTEMPTS} attempts: ${
      lastError instanceof Error ? lastError.message : 'Unknown error'
    }`
  );
}

async function fetchTtsChunk(chunk: string, languageCode: string): Promise<Buffer> {
  const url = new URL('https://translate.google.com/translate_tts');
  url.searchParams.set('ie', 'UTF-8');
  url.searchParams.set('tl', languageCode);
  url.searchParams.set('client', 'tw-ob');
  url.searchParams.set('q', chunk);

  const res = await fetch(url.toString(), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });
  if (!res.ok) {
    throw new Error(`TTS HTTP ${res.status}: ${res.statusText}`);
  }
  const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
  if (contentType && !contentType.includes('audio') && !contentType.includes('octet-stream')) {
    throw new Error(`Unexpected TTS Content-Type: ${contentType}`);
  }
  const arr = Buffer.from(await res.arrayBuffer());
  if (arr.length === 0) {
    throw new Error('TTS returned 0 audio bytes.');
  }
  return arr;
}

function splitIntoChunks(text: string, maxLength: number): string[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  for (const token of tokens) {
    if (token.length > maxLength) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      for (let i = 0; i < token.length; i += maxLength) {
        chunks.push(token.slice(i, i + maxLength));
      }
      continue;
    }

    const sepLen = current ? 1 : 0;
    if (current.length + sepLen + token.length > maxLength) {
      chunks.push(current);
      current = token;
    } else {
      current = current ? `${current} ${token}` : token;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function stripId3v2Header(bytes: Buffer): Buffer {
  if (bytes.length <= 10) return bytes;
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return bytes;
  const tagSize =
    ((bytes[6] & 0x7f) << 21) |
    ((bytes[7] & 0x7f) << 14) |
    ((bytes[8] & 0x7f) << 7) |
    (bytes[9] & 0x7f);
  const audioStart = 10 + tagSize;
  return audioStart >= 10 && audioStart < bytes.length ? bytes.subarray(audioStart) : bytes;
}

function resolveLanguageCode(voice: string): string {
  const prefix = voice.split('-')[0]?.trim().toLowerCase() ?? '';
  return prefix.length >= 2 && prefix.length <= 3 && /^[a-z]+$/.test(prefix) ? prefix : 'hi';
}
