import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import {
  cancelRenderJob,
  getRenderJobArtifacts,
  getRenderJobStatus,
  startRenderJob,
} from './server/renderEngine.ts';
import type {
  ContentMode,
  InputMode,
  VideoLanguageKey,
  VideoScriptResponse,
  VisualStyleMode,
  VoiceGender,
  VoiceTone,
} from './server/types.ts';
import { generateOneTicketGeminiAudio, isGeminiTtsAvailable } from './server/geminiTts.ts';
import { fetchTrendingMovieTopics, generateScript } from './server/videoRepository.ts';

const PORT = 3000;
const uploadDir = path.join(os.tmpdir(), 'rs-movie-spot-uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 80 * 1024 * 1024, files: 40 } });

async function startServer() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  app.get('/api/trending', async (_req, res) => {
    try {
      const topics = await fetchTrendingMovieTopics();
      res.json({ topics });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Trending fetch failed';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/tts/one-ticket', async (req, res) => {
    try {
      if (!isGeminiTtsAvailable()) {
        res.status(503).json({ error: 'Gemini TTS API key is not configured on the server.' });
        return;
      }
      const body = (req.body ?? {}) as {
        slabs?: Array<{ voiceover_text?: unknown; voice_emotion?: unknown }>;
        voiceGender?: VoiceGender;
        voiceTone?: VoiceTone;
        language?: VideoLanguageKey;
      };
      const rawSlabs = Array.isArray(body.slabs) ? body.slabs : [];
      if (rawSlabs.length === 0 || rawSlabs.length > 30) {
        res.status(400).json({ error: 'Provide between 1 and 30 scenes in slabs.' });
        return;
      }
      const slabs = rawSlabs.map((s) => ({
        voiceover_text: String(s?.voiceover_text ?? '').slice(0, 500),
        voice_emotion: String(s?.voice_emotion ?? 'normal').slice(0, 32),
      }));
      const result = await generateOneTicketGeminiAudio({
        slabs,
        voiceGender: body.voiceGender ?? 'MALE',
        voiceTone: body.voiceTone ?? 'AUTO',
        language: body.language ?? 'AUTO',
      });
      res.json({
        audioBase64: result.wavBuffer.toString('base64'),
        mimeType: 'audio/wav',
        voiceName: result.voiceName,
        model: result.model,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gemini TTS failed';
      const status = /429|RESOURCE_EXHAUSTED|quota/i.test(message) ? 429 : 500;
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/script/preview', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        topic?: string;
        isShorts?: boolean;
        language?: VideoLanguageKey;
        voiceGender?: VoiceGender;
        inputMode?: InputMode;
        voiceTone?: VoiceTone;
        visualStyle?: VisualStyleMode;
        contentMode?: ContentMode;
      };
      const script = await generateScript({
        topic: String(body.topic ?? ''),
        isShorts: body.isShorts ?? true,
        language: body.language ?? 'AUTO',
        voiceGender: body.voiceGender ?? 'MALE',
        inputMode: body.inputMode ?? 'AUTO',
        voiceTone: body.voiceTone ?? 'AUTO',
        visualStyle: body.visualStyle ?? 'AUTO',
        contentMode: body.contentMode ?? 'AUTO',
      });
      res.json({ script });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Script generation error';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/render/start', upload.any(), (req, res) => {
    const uploadedFiles = Array.isArray(req.files) ? req.files : [];
    const cleanupUploaded = () => {
      for (const f of uploadedFiles) {
        if (f?.path && fs.existsSync(f.path)) {
          try {
            fs.unlinkSync(f.path);
          } catch {
            // ignore
          }
        }
      }
    };
    try {
      const body = req.body as Record<string, string | undefined>;
      const topic = String(body.topic ?? '').trim();
      if (!topic) {
        cleanupUploaded();
        res.status(400).json({ error: 'Enter a topic or script before generating a video.' });
        return;
      }

      const isShorts = body.isShorts !== 'false';
      const language = (body.language || 'AUTO') as VideoLanguageKey;
      const voiceGender = (body.voiceGender || 'MALE') as VoiceGender;
      const voiceTone = (body.voiceTone || 'AUTO') as VoiceTone;
      const inputMode = (body.inputMode || 'AUTO') as InputMode;
      const visualStyle = (body.visualStyle || 'AUTO') as VisualStyleMode;
      const contentMode = (body.contentMode || 'AUTO') as ContentMode;

      const bgmUploaded = uploadedFiles.find((f) => f.fieldname === 'bgmFile');
      const customSceneMedia: Record<string, { path: string; mimetype: string; originalname: string }> = {};
      for (const f of uploadedFiles) {
        const m = /^sceneMedia_(\d+)_([12])$/.exec(f.fieldname || '');
        if (m) {
          customSceneMedia[`${m[1]}_${m[2]}`] = {
            path: f.path,
            mimetype: f.mimetype || '',
            originalname: f.originalname || '',
          };
        }
      }

      let preGeneratedScript: VideoScriptResponse | null = null;
      if (body.preGeneratedScript) {
        try {
          preGeneratedScript = JSON.parse(body.preGeneratedScript) as VideoScriptResponse;
        } catch {
          preGeneratedScript = null;
        }
      }

      const jobId = startRenderJob({
        topic,
        isShorts,
        customBgmPath: bgmUploaded?.path ?? null,
        customSceneMedia,
        preGeneratedScript,
        language,
        voiceGender,
        voiceTone,
        inputMode,
        visualStyle,
        contentMode,
      });

      res.json({ jobId });
    } catch (err) {
      cleanupUploaded();
      const message = err instanceof Error ? err.message : 'Failed to start render';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/render/status/:jobId', (req, res) => {
    const status = getRenderJobStatus(req.params.jobId);
    if (!status) {
      res.status(404).json({ error: 'Render job not found' });
      return;
    }
    res.json(status);
  });

  app.post('/api/render/cancel/:jobId', (req, res) => {
    const status = cancelRenderJob(req.params.jobId);
    if (!status) {
      res.status(404).json({ error: 'Render job not found' });
      return;
    }
    res.json(status);
  });

  app.get('/api/renders/:jobId/video.mp4', (req, res) => {
    const artifacts = getRenderJobArtifacts(req.params.jobId);
    if (!artifacts?.videoFilePath || !fs.existsSync(artifacts.videoFilePath)) {
      res.status(404).send('Rendered video not found');
      return;
    }
    if (req.query.download === '1') {
      res.download(artifacts.videoFilePath, path.basename(artifacts.videoFilePath));
      return;
    }
    res.sendFile(artifacts.videoFilePath);
  });

  app.get('/api/renders/:jobId/cover.jpg', (req, res) => {
    const artifacts = getRenderJobArtifacts(req.params.jobId);
    if (!artifacts?.thumbnailFilePath || !fs.existsSync(artifacts.thumbnailFilePath)) {
      res.status(404).send('Cover thumbnail not found');
      return;
    }
    if (req.query.download === '1') {
      res.download(artifacts.thumbnailFilePath, path.basename(artifacts.thumbnailFilePath));
      return;
    }
    res.sendFile(artifacts.thumbnailFilePath);
  });

  app.get('/downloads/RSMovieSpot-debug.apk', (_req, res) => {
    const apkPath = path.resolve(process.cwd(), 'app/build/outputs/apk/debug/app-debug.apk');
    if (!fs.existsSync(apkPath)) {
      res.status(404).send('Debug APK not found. Run Gradle assembleDebug first.');
      return;
    }
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.download(apkPath, 'RSMovieSpot-debug.apk');
  });

  app.get('/downloads/RSMovieSpot-android-project.zip', (_req, res) => {
    const zipPath = path.resolve(
      process.cwd(),
      '.aistudio/artifacts/brain/3073bc98-e555-42e6-9438-c3b56c918306/RSMovieSpot-android-project.zip'
    );
    if (!fs.existsSync(zipPath)) {
      res.status(404).send('Android project zip not found.');
      return;
    }
    res.setHeader('Content-Type', 'application/zip');
    res.download(zipPath, 'RSMovieSpot-android-project.zip');
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`RS Movie Spot server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
