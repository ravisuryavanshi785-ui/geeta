import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getPcmWavDurationSeconds,
  mixVoiceBgmSfxWav,
  writeCinematicBgmWav,
} from './bgmSynth.ts';
import { generateDynamicVoiceClipWithMeta } from './edgeTts.ts';
import { isGeminiTtsAvailable, synthesizeOneTicketGeminiVoiceClips } from './geminiTts.ts';
import {
  composeSplitFrame,
  composeStudioFrameFromRealPhoto,
  createFallbackCinemaFrame,
  isMostlyBlackOrCorrupt,
  renderCaptionPng,
  renderCoverThumbnailJpg,
  renderStatBadgePng,
  renderSubscribeEndCardPng,
  renderWatermarkPng,
  stripDecorativeEmojis,
} from './imageComposer.ts';
import {
  resolveLanguageVoice,
  type ContentMode,
  type InputMode,
  type RenderStatusResponse,
  type VideoLanguageKey,
  type VideoScriptResponse,
  type VideoSlab,
  type VisualStyleMode,
  type VoiceGender,
  type VoiceTone,
} from './types.ts';
import {
  downloadInternetVideoClip,
  downloadRealPhoto,
  downloadStockPhotoFallback,
  enforceVoiceGender,
  generateImageForSlab,
  generateScript,
  isNonCelebrityOrRecipeTopic,
  resolveEffectiveVisualStyle,
  resolveEffectiveVoiceTone,
} from './videoRepository.ts';

const SHORTS_WIDTH = 1080;
const SHORTS_HEIGHT = 1920;
const LANDSCAPE_WIDTH = 1920;
const LANDSCAPE_HEIGHT = 1080;
const FRAME_RATE = 25;
const DISSOLVE_FRAMES = 6;
const DISSOLVE_SECONDS = DISSOLVE_FRAMES / FRAME_RATE;
const MIN_SCENE_FRAMES = 15;
const AUDIO_TAIL_PADDING_SECONDS = 0.35;
const IMAGE_GEN_TIMEOUT_MS = 115_000;

interface OverlaySpec {
  file: string;
  xExpr: string;
  yExpr: string;
  enableExpr?: string;
}

interface PopCaptionChunk {
  file: string;
  stripHeight: number;
  startSeconds: number;
  endSeconds: number;
}

interface RenderJob {
  jobId: string;
  state: RenderStatusResponse;
  abortController: AbortController;
  activeProcesses: Set<ChildProcess>;
  videoFilePath: string | null;
  thumbnailFilePath: string | null;
  createdAt: number;
}

const EXPORTS_ROOT = path.join(os.tmpdir(), 'rs-movie-spot-exports');
fs.mkdirSync(EXPORTS_ROOT, { recursive: true });

const jobs = new Map<string, RenderJob>();

export function getRenderJobStatus(jobId: string): RenderStatusResponse | null {
  return jobs.get(jobId)?.state ?? null;
}

export function getRenderJobArtifacts(jobId: string): {
  videoFilePath: string | null;
  thumbnailFilePath: string | null;
  title: string;
} | null {
  const job = jobs.get(jobId);
  if (!job) return null;
  return {
    videoFilePath: job.videoFilePath,
    thumbnailFilePath: job.thumbnailFilePath,
    title: job.state.completedScript?.youtube_title || 'RSMovieSpot',
  };
}

export function cancelRenderJob(jobId: string): RenderStatusResponse | null {
  const job = jobs.get(jobId);
  if (!job) return null;
  job.abortController.abort(new Error('CANCELLED'));
  for (const proc of job.activeProcesses) {
    try {
      proc.kill('SIGKILL');
    } catch {
      // ignore
    }
  }
  job.state = {
    ...job.state,
    isGenerating: false,
    progressText: '',
    statusMessage: 'Video generation cancelled.',
  };
  return job.state;
}

export interface CustomSceneMediaFile {
  path: string;
  mimetype: string;
  originalname: string;
}

export interface StartRenderParams {
  topic: string;
  isShorts: boolean;
  customBgmPath?: string | null;
  customSceneMedia?: Record<string, CustomSceneMediaFile>;
  preGeneratedScript?: VideoScriptResponse | null;
  language: VideoLanguageKey;
  voiceGender: VoiceGender;
  voiceTone: VoiceTone;
  inputMode: InputMode;
  visualStyle?: VisualStyleMode;
  contentMode?: ContentMode;
}

export function startRenderJob(params: StartRenderParams): string {
  cleanupOldExports();

  const jobId = crypto.randomUUID();
  const abortController = new AbortController();
  const job: RenderJob = {
    jobId,
    state: {
      jobId,
      isGenerating: true,
      progressText: 'Starting video generation…',
      progressPercentage: 0,
      statusMessage: '',
      videoUrl: null,
      thumbnailUrl: null,
      completedScript: null,
    },
    abortController,
    activeProcesses: new Set(),
    videoFilePath: null,
    thumbnailFilePath: null,
    createdAt: Date.now(),
  };

  jobs.set(jobId, job);

  void runRenderPipeline(job, params).catch((err) => {
    if (params.customBgmPath && fs.existsSync(params.customBgmPath)) {
      try {
        fs.unlinkSync(params.customBgmPath);
      } catch {
        // ignore
      }
    }
    if (params.customSceneMedia) {
      for (const m of Object.values(params.customSceneMedia)) {
        if (m?.path && fs.existsSync(m.path)) {
          try {
            fs.unlinkSync(m.path);
          } catch {
            // ignore
          }
        }
      }
    }
    if (abortController.signal.aborted) {
      job.state = {
        ...job.state,
        isGenerating: false,
        progressText: '',
        statusMessage: 'Video generation cancelled.',
      };
      return;
    }
    const msg = err instanceof Error && err.message ? `Generation failed: ${err.message}` : 'Generation failed.';
    job.state = {
      ...job.state,
      isGenerating: false,
      statusMessage: msg,
    };
  });

  return jobId;
}

function cleanupOldExports(): void {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, job] of jobs.entries()) {
    if (!job.state.isGenerating && job.createdAt < cutoff) {
      jobs.delete(id);
      const exportDir = path.join(EXPORTS_ROOT, id);
      if (fs.existsSync(exportDir)) {
        fs.rmSync(exportDir, { recursive: true, force: true });
      }
    }
  }
}

async function runRenderPipeline(job: RenderJob, params: StartRenderParams): Promise<void> {
  const { signal } = job.abortController;
  const checkCancelled = () => {
    if (signal.aborted) throw new Error('CANCELLED');
  };
  const updateProgress = (rawPercent: number, message: string) => {
    checkCancelled();
    job.state = {
      ...job.state,
      progressPercentage: Math.max(0, Math.min(100, rawPercent)),
      progressText: message,
    };
  };

  const topic = params.topic.trim();
  if (!topic) throw new Error('Topic must not be blank.');

  const width = params.isShorts ? SHORTS_WIDTH : LANDSCAPE_WIDTH;
  const height = params.isShorts ? SHORTS_HEIGHT : LANDSCAPE_HEIGHT;
  const renderDirectory = fs.mkdtempSync(path.join(os.tmpdir(), `video-render-${job.jobId}-`));

  const activeContentMode: ContentMode = params.contentMode ?? 'AUTO';
  const effectiveVoiceTone = resolveEffectiveVoiceTone(params.voiceTone, activeContentMode);
  const effectiveVisualStyle = resolveEffectiveVisualStyle(params.visualStyle ?? 'AUTO', activeContentMode);

  try {
    let script: VideoScriptResponse;
    if (params.preGeneratedScript && params.preGeneratedScript.slabs.length > 0) {
      updateProgress(4, 'Using your approved script…');
      script = params.preGeneratedScript;
    } else {
      updateProgress(2, 'Generating story script…');
      script = await generateScript({
        topic,
        isShorts: params.isShorts,
        language: params.language,
        voiceGender: params.voiceGender,
        inputMode: params.inputMode,
        voiceTone: params.voiceTone,
        visualStyle: params.visualStyle ?? 'AUTO',
        contentMode: activeContentMode,
      });
    }
    checkCancelled();
    if (!script.slabs || script.slabs.length === 0) {
      throw new Error('The generated script has no slabs.');
    }

    const activeVoiceName =
      params.language !== 'AUTO'
        ? resolveLanguageVoice(params.language, params.voiceGender)
        : enforceVoiceGender(script.voice_name, params.voiceGender);

    const baseSeed = Math.max(1000, Math.abs(hashCode(topic.toLowerCase())) & 0x7fffffff);

    updateProgress(
      7,
      isGeminiTtsAvailable()
        ? 'Recording 1-ticket emotional Gemini voiceover…'
        : 'Recording expressive voiceover…'
    );
    let trimmedVoiceWavs: string[] | null = null;
    if (isGeminiTtsAvailable()) {
      try {
        const geminiRes = await synthesizeOneTicketGeminiVoiceClips({
          renderDirectory,
          slabs: script.slabs,
          voiceGender: params.voiceGender,
          voiceTone: effectiveVoiceTone,
          language: params.language,
          runFfmpegFn: (args) => runFfmpeg(job, args),
        });
        trimmedVoiceWavs = geminiRes.wavFiles;
      } catch (err) {
        trimmedVoiceWavs = null;
        const reason = err instanceof Error ? err.message : 'unavailable';
        console.warn('[GeminiTTS] Fallback to Edge TTS:', reason);
        updateProgress(8, 'Gemini TTS failed, switching to Edge TTS fallback…');
      }
    } else {
      updateProgress(8, 'Gemini API key not set on server, using Edge TTS…');
    }
    if (!trimmedVoiceWavs || trimmedVoiceWavs.length !== script.slabs.length) {
      trimmedVoiceWavs = await synthesizeAndTrimVoiceClips(
        job,
        renderDirectory,
        script.slabs,
        activeVoiceName,
        params.voiceGender,
        effectiveVoiceTone
      );
    }
    checkCancelled();

    const voiceListFile = path.join(renderDirectory, 'voice_parts.txt');
    fs.writeFileSync(
      voiceListFile,
      trimmedVoiceWavs.map((f) => `file '${escapeConcatPath(f)}'`).join('\n') + '\n'
    );
    const fullVoiceFile = path.join(renderDirectory, 'full_voice.wav');
    await runFfmpeg(job, ['-y', '-f', 'concat', '-safe', '0', '-i', voiceListFile, '-c', 'copy', fullVoiceFile]);
    checkCancelled();

    const sceneDurations = trimmedVoiceWavs.map((wav) => Math.max(0.8, getPcmWavDurationSeconds(wav) + 0.12));
    sceneDurations[sceneDurations.length - 1] += AUDIO_TAIL_PADDING_SECONDS;

    const sceneFramesList = sceneDurations.map((dur) =>
      Math.max(MIN_SCENE_FRAMES, Math.ceil(dur * FRAME_RATE))
    );
    const totalFrames = sceneFramesList.reduce((a, b) => a + b, 0);
    const exactVideoDuration = totalFrames / FRAME_RATE;

    const bgmBedFile = await prepareBgmBed(
      job,
      renderDirectory,
      script.bgm_mood,
      params.customBgmPath ?? null,
      baseSeed
    );

    const watermarkPng = path.join(renderDirectory, 'hud_watermark.png');
    await renderWatermarkPng(watermarkPng, params.isShorts);
    const subscribeEndCardPng = path.join(renderDirectory, 'hud_subscribe.png');
    await renderSubscribeEndCardPng(subscribeEndCardPng, params.isShorts);

    const videoSegmentFiles: string[] = [];
    const segmentBaseDurations: number[] = [];
    const slabCount = script.slabs.length;
    const topicContext = [topic, script.character_bible].filter(Boolean).join(' ');
    const usedRealPhotoUrls = new Set<string>();
    const usedImageHashes = new Set<string>();
    const usedClipUrls = new Set<string>();
    let coverBaseImageFile: string | null = null;

    for (let index = 0; index < slabCount; index++) {
      checkCancelled();
      const slab = script.slabs[index];
      const baseProgress = 14 + Math.floor((index * 68) / slabCount);
      const videoSegmentFile = path.join(renderDirectory, `vseg_${index + 1}.mp4`);
      const baseFrames = sceneFramesList[index];
      const baseDurationSeconds = baseFrames / FRAME_RATE;
      const hasDissolveTail = index < slabCount - 1;
      const encodeFrames = hasDissolveTail ? baseFrames + DISSOLVE_FRAMES : baseFrames;

      const popCaptions = await createPopCaptionOverlays(
        renderDirectory,
        index,
        slab.voiceover_text,
        baseDurationSeconds,
        width,
        params.isShorts
      ).catch(() => []);

      let statBadgePng: string | null = null;
      if (slab.stat_badge && slab.stat_badge.trim()) {
        const badgeFile = path.join(renderDirectory, `badge_${index + 1}.png`);
        const ok = await renderStatBadgePng(slab.stat_badge, width, params.isShorts, badgeFile).catch(() => false);
        if (ok) statBadgePng = badgeFile;
      }

      const overlaySpecs = buildSceneOverlaySpecs(
        popCaptions,
        statBadgePng,
        watermarkPng,
        index === slabCount - 1 ? subscribeEndCardPng : null,
        baseDurationSeconds,
        width,
        height,
        params.isShorts
      );

      const activeVisualStyleMode: VisualStyleMode = effectiveVisualStyle;
      const isStylizedStoryMode = activeVisualStyleMode === 'PIXAR_3D' || activeVisualStyleMode === 'ANIME_3D';
      const isStrictAiStoryMode =
        activeContentMode === 'STORY' || activeContentMode === 'KIDS_STORY' || activeContentMode === 'COOKING';
      const is3dVividStyle =
        isStylizedStoryMode ||
        ['3d', 'pixar', 'disney', 'cgi', 'anime', 'cartoon'].some((k) =>
          (script.visual_style || '').toLowerCase().includes(k)
        );
      const isHighEnergyBeat =
        ['hook', 'climax', 'excited'].includes(slab.voice_emotion.toLowerCase()) ||
        ['boom', 'sword', 'thunder'].includes(slab.sfx_cue.toLowerCase());

      const custom1 = params.customSceneMedia?.[`${index}_1`];
      const custom2 = params.customSceneMedia?.[`${index}_2`];
      const isCustomVideo1 = Boolean(
        custom1 &&
          fs.existsSync(custom1.path) &&
          (custom1.mimetype.startsWith('video/') ||
            /\.(mp4|mov|webm|mkv|m4v|avi)$/i.test(custom1.originalname || custom1.path))
      );
      const customImagePath1 =
        custom1 && !isCustomVideo1 && fs.existsSync(custom1.path) ? custom1.path : undefined;
      const isCustomVideo2 = Boolean(
        custom2 &&
          fs.existsSync(custom2.path) &&
          (custom2.mimetype.startsWith('video/') ||
            /\.(mp4|mov|webm|mkv|m4v|avi)$/i.test(custom2.originalname || custom2.path))
      );
      const customImagePath2 =
        custom2 && !isCustomVideo2 && fs.existsSync(custom2.path) ? custom2.path : undefined;

      const isVideoClip =
        !custom1 &&
        !isStylizedStoryMode &&
        !isStrictAiStoryMode &&
        (slab.visual_source.toLowerCase() === 'video_clip' || slab.visual_source.toLowerCase() === 'meme_clip');

      let encodedClip = false;
      if (isCustomVideo1 && custom1) {
        updateProgress(Math.max(14, Math.min(82, baseProgress)), `Using custom clip for scene ${index + 1}…`);
        if (index === 0 && !coverBaseImageFile) {
          const rawCover = path.join(renderDirectory, 'cover_raw_custom_clip.png');
          const gotCover = await runFfmpeg(job, ['-y', '-ss', '0.25', '-i', custom1.path, '-vframes', '1', rawCover])
            .then(() => fs.existsSync(rawCover) && fs.statSync(rawCover).size > 2048)
            .catch(() => false);
          if (gotCover) coverBaseImageFile = rawCover;
        }
        const isClean3dClip = /^scene_3d_/i.test(custom1.originalname || '');
        const renderProgress = 14 + Math.round(((index + 0.5) * 68) / slabCount);
        updateProgress(
          Math.max(14, Math.min(82, renderProgress)),
          isClean3dClip
            ? `Compositing 3D Character Scene ${index + 1} of ${slabCount}…`
            : `Editing custom clip scene ${index + 1} of ${slabCount}…`
        );
        encodedClip = await runFfmpeg(
          job,
          createVideoClipSegmentArguments(
            custom1.path,
            overlaySpecs,
            videoSegmentFile,
            width,
            height,
            encodeFrames,
            index,
            slabCount,
            isClean3dClip
          )
        )
          .then(() => fs.existsSync(videoSegmentFile) && fs.statSync(videoSegmentFile).size > 2048)
          .catch(() => false);
        if (!encodedClip) {
          encodedClip = await runFfmpeg(
            job,
            createVideoClipSegmentArguments(
              custom1.path,
              overlaySpecs,
              videoSegmentFile,
              width,
              height,
              encodeFrames,
              index,
              slabCount,
              true
            )
          )
            .then(() => fs.existsSync(videoSegmentFile) && fs.statSync(videoSegmentFile).size > 2048)
            .catch(() => false);
        }
      } else if (isVideoClip && slab.real_photo_query.trim()) {
        const clipLabel =
          slab.visual_source.toLowerCase() === 'meme_clip'
            ? `Fetching internet meme (${slab.real_photo_query})…`
            : `Fetching movie/trailer clip (${slab.real_photo_query})…`;
        updateProgress(Math.max(14, Math.min(82, baseProgress)), clipLabel);

        const rawClipFile = path.join(renderDirectory, `clip_raw_${index + 1}.mp4`);
        const downloaded = await downloadInternetVideoClip(
          slab.real_photo_query,
          slab.visual_source.toLowerCase() === 'meme_clip',
          usedClipUrls,
          rawClipFile
        ).catch(() => false);
        checkCancelled();

        if (downloaded) {
          if (index === 0 && !coverBaseImageFile) {
            const rawCover = path.join(renderDirectory, 'cover_raw_clip.png');
            const gotCover = await runFfmpeg(job, [
              '-y',
              '-ss',
              '0.35',
              '-i',
              rawClipFile,
              '-vframes',
              '1',
              rawCover,
            ])
              .then(() => fs.existsSync(rawCover) && fs.statSync(rawCover).size > 2048)
              .catch(() => false);
            if (gotCover) coverBaseImageFile = rawCover;
          }

          const renderProgress = 14 + Math.round(((index + 0.5) * 68) / slabCount);
          updateProgress(Math.max(14, Math.min(82, renderProgress)), `Editing clip scene ${index + 1} of ${slabCount}…`);
          encodedClip = await runFfmpeg(
            job,
            createVideoClipSegmentArguments(
              rawClipFile,
              overlaySpecs,
              videoSegmentFile,
              width,
              height,
              encodeFrames,
              index,
              slabCount
            )
          )
            .then(() => fs.existsSync(videoSegmentFile) && fs.statSync(videoSegmentFile).size > 2048)
            .catch(() => false);
        }
        if (fs.existsSync(rawClipFile)) fs.unlinkSync(rawClipFile);
      }

      if (!encodedClip) {
        const layoutMode = (slab.layout_mode || 'single').toLowerCase().trim();
        const isSplitLayout = layoutMode === 'split';
        const hasSecondPrompt =
          Boolean(customImagePath2) ||
          slab.image_prompt_2.trim().length > 0 ||
          (!isStylizedStoryMode &&
            !isStrictAiStoryMode &&
            slab.visual_source_2.toLowerCase() === 'real_photo' &&
            slab.real_photo_query_2.trim().length > 0);
        const useSplitDimensions = isSplitLayout && hasSecondPrompt;
        const panelWidth = useSplitDimensions && height <= width ? Math.floor(width / 2) - 3 : width;
        const panelHeight = useSplitDimensions && height > width ? Math.floor(height / 2) - 3 : height;
        const panelIsShorts = panelHeight > panelWidth;

        const imageFile1 = await resolveSceneImageFile({
          renderDirectory,
          tag: `${index + 1}_1`,
          visualSource:
            isStylizedStoryMode || isStrictAiStoryMode
              ? 'ai_generated'
              : isVideoClip
              ? 'real_photo'
              : slab.visual_source,
          realQuery: isStylizedStoryMode || isStrictAiStoryMode ? '' : slab.real_photo_query,
          scenePrompt: slab.image_prompt,
          voiceoverText: slab.voiceover_text,
          characterBible: script.character_bible,
          visualStyle: script.visual_style,
          visualStyleMode: activeVisualStyleMode,
          contentMode: activeContentMode,
          customImagePath: customImagePath1,
          topicContext,
          hasCharacter: slab.has_character,
          isShorts: useSplitDimensions ? panelIsShorts : params.isShorts,
          width: panelWidth,
          height: panelHeight,
          seed: baseSeed + index * 37,
          usedUrls: usedRealPhotoUrls,
          usedHashes: usedImageHashes,
          progressUpdate: (msg) => updateProgress(Math.max(14, Math.min(82, baseProgress)), msg),
          sceneIndex: index,
          slabCount,
        });
        checkCancelled();

        if (index === 0 && !coverBaseImageFile) {
          coverBaseImageFile = path.join(renderDirectory, 'cover_base.png');
          fs.copyFileSync(imageFile1, coverBaseImageFile);
        }

        if ((layoutMode === 'split' || layoutMode === 'flip') && hasSecondPrompt) {
          const panel2Height = useSplitDimensions && height > width ? height - (Math.floor(height / 2) + 3) : height;
          const panel2Width = useSplitDimensions && height <= width ? width - (Math.floor(width / 2) + 3) : width;
          const imageFile2 = await resolveSceneImageFile({
            renderDirectory,
            tag: `${index + 1}_2`,
            visualSource:
              isStylizedStoryMode || isStrictAiStoryMode
                ? 'ai_generated'
                : slab.visual_source_2 || 'ai_generated',
            realQuery: isStylizedStoryMode || isStrictAiStoryMode ? '' : slab.real_photo_query_2,
            scenePrompt: slab.image_prompt_2 || slab.image_prompt,
            voiceoverText: slab.voiceover_text,
            characterBible: script.character_bible,
            visualStyle: script.visual_style,
            visualStyleMode: activeVisualStyleMode,
            contentMode: activeContentMode,
            customImagePath: customImagePath2,
            topicContext,
            hasCharacter: slab.has_character,
            isShorts: useSplitDimensions ? panel2Height > panel2Width : params.isShorts,
            width: panel2Width,
            height: panel2Height,
            seed: baseSeed + index * 37 + 19,
            usedUrls: usedRealPhotoUrls,
            usedHashes: usedImageHashes,
            progressUpdate: (msg) => updateProgress(Math.max(14, Math.min(82, baseProgress)), msg),
            sceneIndex: index,
            slabCount,
          });
          checkCancelled();

          const renderProgress = 14 + Math.round(((index + 0.5) * 68) / slabCount);
          updateProgress(Math.max(14, Math.min(82, renderProgress)), `Editing scene ${index + 1} of ${slabCount}…`);

          if (layoutMode === 'split') {
            await composeSplitFrame(imageFile1, imageFile2, imageFile1, width, height);
            await runFfmpeg(
              job,
              createVideoOnlySegmentArguments(
                index,
                slabCount,
                imageFile1,
                overlaySpecs,
                videoSegmentFile,
                width,
                height,
                encodeFrames,
                is3dVividStyle,
                isHighEnergyBeat
              )
            );
          } else {
            await runFfmpeg(
              job,
              createFlipVideoSegmentArguments(
                index,
                slabCount,
                imageFile1,
                imageFile2,
                overlaySpecs,
                videoSegmentFile,
                width,
                height,
                encodeFrames,
                baseDurationSeconds,
                is3dVividStyle,
                isHighEnergyBeat
              )
            );
          }
        } else {
          const renderProgress = 14 + Math.round(((index + 0.5) * 68) / slabCount);
          updateProgress(Math.max(14, Math.min(82, renderProgress)), `Editing scene ${index + 1} of ${slabCount}…`);

          await runFfmpeg(
            job,
            createVideoOnlySegmentArguments(
              index,
              slabCount,
              imageFile1,
              overlaySpecs,
              videoSegmentFile,
              width,
              height,
              encodeFrames,
              is3dVividStyle,
              isHighEnergyBeat
            )
          );
        }
      }

      videoSegmentFiles.push(videoSegmentFile);
      segmentBaseDurations.push(baseDurationSeconds);
    }

    updateProgress(85, 'Applying smooth scene dissolves & syncing voiceover…');
    const silentVideoFile = path.join(renderDirectory, 'silent_video.mp4');
    const dissolveOk = await mergeSegmentsWithDissolve(
      job,
      renderDirectory,
      videoSegmentFiles,
      segmentBaseDurations,
      silentVideoFile
    ).catch(() => false);

    if (!dissolveOk || !fs.existsSync(silentVideoFile) || fs.statSync(silentVideoFile).size <= 2048) {
      const concatList = path.join(renderDirectory, 'segments.txt');
      fs.writeFileSync(
        concatList,
        videoSegmentFiles.map((f) => `file '${escapeConcatPath(f)}'`).join('\n') + '\n'
      );
      await runFfmpeg(job, ['-y', '-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', silentVideoFile]);
    }
    checkCancelled();

    if (!coverBaseImageFile) {
      const extractedCover = path.join(renderDirectory, 'cover_extracted.png');
      const ok = await runFfmpeg(job, ['-y', '-ss', '0.5', '-i', silentVideoFile, '-vframes', '1', extractedCover])
        .then(() => fs.existsSync(extractedCover) && fs.statSync(extractedCover).size > 2048)
        .catch(() => false);
      if (ok) coverBaseImageFile = extractedCover;
    }

    updateProgress(90, 'Mastering expressive voice & auto-ducked BGM…');
    const mixedAudioFile = path.join(renderDirectory, 'final_audio.m4a');
    const finalAudioReady = await mixAudioTrackSafely(
      job,
      renderDirectory,
      fullVoiceFile,
      bgmBedFile,
      exactVideoDuration,
      mixedAudioFile
    );

    updateProgress(93, 'Finalizing video file…');
    const finalFile = path.join(renderDirectory, 'final_video.mp4');
    await muxFinalVideo(job, silentVideoFile, finalAudioReady, fullVoiceFile, exactVideoDuration, finalFile);
    checkCancelled();

    updateProgress(96, 'Saving video & cover thumbnail…');
    const exportTitle = script.youtube_title || topic;
    const jobExportDir = path.join(EXPORTS_ROOT, job.jobId);
    fs.mkdirSync(jobExportDir, { recursive: true });

    const safeTitle = safeFileName(exportTitle);
    const outVideoPath = path.join(jobExportDir, `RSMovieSpot_${safeTitle}.mp4`);
    fs.copyFileSync(finalFile, outVideoPath);
    job.videoFilePath = outVideoPath;

    let hasThumb = false;
    if (coverBaseImageFile) {
      const outThumbPath = path.join(jobExportDir, `RSMovieSpot_Cover_${safeTitle}.jpg`);
      await renderCoverThumbnailJpg(coverBaseImageFile, exportTitle, params.isShorts, outThumbPath).catch(() => {});
      if (fs.existsSync(outThumbPath) && fs.statSync(outThumbPath).size > 1024) {
        job.thumbnailFilePath = outThumbPath;
        hasThumb = true;
      }
    }

    const completedScript: VideoScriptResponse = { ...script, voice_name: activeVoiceName };
    job.state = {
      jobId: job.jobId,
      isGenerating: false,
      progressPercentage: 100,
      progressText: 'Video & cover thumbnail ready.',
      statusMessage: 'Video generation complete.',
      videoUrl: `/api/renders/${job.jobId}/video.mp4`,
      thumbnailUrl: hasThumb ? `/api/renders/${job.jobId}/cover.jpg` : null,
      completedScript,
    };
  } finally {
    if (params.customBgmPath && fs.existsSync(params.customBgmPath)) {
      try {
        fs.unlinkSync(params.customBgmPath);
      } catch {
        // ignore
      }
    }
    if (params.customSceneMedia) {
      for (const m of Object.values(params.customSceneMedia)) {
        if (m?.path && fs.existsSync(m.path)) {
          try {
            fs.unlinkSync(m.path);
          } catch {
            // ignore
          }
        }
      }
    }
    fs.rmSync(renderDirectory, { recursive: true, force: true });
  }
}

async function synthesizeAndTrimVoiceClips(
  job: RenderJob,
  renderDirectory: string,
  slabs: VideoSlab[],
  voiceName: string,
  voiceGender: VoiceGender,
  voiceTone: VoiceTone
): Promise<string[]> {
  const rawClips: Array<{ rawMp3: string; usedFallback: boolean }> = new Array(slabs.length);
  let nextIdx = 0;
  const workerCount = Math.min(2, slabs.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        if (job.abortController.signal.aborted) throw new Error('CANCELLED');
        const idx = nextIdx++;
        if (idx >= slabs.length) break;
        const slab = slabs[idx];
        const wordCount = slab.voiceover_text.trim().split(/\s+/).filter(Boolean).length;
        const rawMp3 = path.join(renderDirectory, `raw_voice_${idx + 1}.mp3`);
        let bestBytes: Buffer | null = null;
        let bestUsedFallback = false;

        for (let attempt = 0; attempt < 3; attempt++) {
          if (job.abortController.signal.aborted) throw new Error('CANCELLED');
          try {
            const clipMeta = await generateDynamicVoiceClipWithMeta(
              slab.voiceover_text,
              voiceName,
              slab.voice_emotion,
              voiceTone
            );
            if (clipMeta.audioBytes.length > 0) {
              if (!bestBytes || clipMeta.audioBytes.length > bestBytes.length) {
                bestBytes = clipMeta.audioBytes;
                bestUsedFallback = clipMeta.usedFallback;
              }
              const probeMp3 = path.join(renderDirectory, `probe_voice_${idx + 1}_${attempt}.mp3`);
              const probeWav = path.join(renderDirectory, `probe_voice_${idx + 1}_${attempt}.wav`);
              fs.writeFileSync(probeMp3, clipMeta.audioBytes);
              await runFfmpeg(job, ['-y', '-i', probeMp3, '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', probeWav]).catch(() => {});
              const durSec = fs.existsSync(probeWav) ? getPcmWavDurationSeconds(probeWav) : 0;
              if (fs.existsSync(probeMp3)) fs.unlinkSync(probeMp3);
              if (fs.existsSync(probeWav)) fs.unlinkSync(probeWav);
              if (wordCount <= 3 || durSec >= 0.8) break;
            }
          } catch {
            // retry
          }
          if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }

        if (!bestBytes || bestBytes.length === 0) {
          throw new Error(`Voice generation returned empty audio for scene ${idx + 1}.`);
        }
        fs.writeFileSync(rawMp3, bestBytes);
        rawClips[idx] = { rawMp3, usedFallback: bestUsedFallback };
      }
    })
  );

  const wavFiles: string[] = [];
  for (let i = 0; i < rawClips.length; i++) {
    if (job.abortController.signal.aborted) throw new Error('CANCELLED');
    const { rawMp3, usedFallback } = rawClips[i];
    const pass1Wav = path.join(renderDirectory, `voice_pass1_${i + 1}.wav`);
    const trimmedWav = path.join(renderDirectory, `voice_part_${i + 1}.wav`);
    const wordCount = slabs[i].voiceover_text.trim().split(/\s+/).filter(Boolean).length;
    const microBreath = 0.16; // 160ms trailing silence pad
    const emotion = slabs[i].voice_emotion;

    const pass1Filter = buildPass1VoiceFilter(usedFallback, voiceGender, emotion, microBreath);
    let pass1Ok = false;
    try {
      await runFfmpeg(job, [
        '-y',
        '-i',
        rawMp3,
        '-af',
        pass1Filter,
        '-ar',
        '44100',
        '-ac',
        '1',
        '-c:a',
        'pcm_s16le',
        pass1Wav,
      ]);
      pass1Ok = fs.existsSync(pass1Wav) && fs.statSync(pass1Wav).size > 44;
    } catch {
      pass1Ok = false;
    }

    if (!pass1Ok) {
      await runFfmpeg(job, ['-y', '-i', rawMp3, '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', pass1Wav]);
    }

    let pass2Ok = false;
    try {
      const pass1Dur = fs.existsSync(pass1Wav) ? getPcmWavDurationSeconds(pass1Wav) : 0;
      await runFfmpeg(job, [
        '-y',
        '-i',
        pass1Wav,
        '-af',
        // Trim ONLY leading and trailing dead silence (via areverse) so mid-sentence comma pauses are preserved intact,
        // then pad 150ms start and 160ms end.
        `silenceremove=start_periods=1:start_duration=0.02:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_duration=0.02:start_threshold=-50dB,areverse,adelay=150:all=1,apad=pad_dur=0.16`,
        '-ar',
        '44100',
        '-ac',
        '1',
        '-c:a',
        'pcm_s16le',
        trimmedWav,
      ]);
      const dur = fs.existsSync(trimmedWav) ? getPcmWavDurationSeconds(trimmedWav) : 0;
      const minExpectedDur = Math.max(wordCount > 3 ? 0.8 : 0.45, pass1Dur * 0.55);
      pass2Ok = fs.existsSync(trimmedWav) && fs.statSync(trimmedWav).size > 44 && dur >= minExpectedDur;
    } catch {
      pass2Ok = false;
    }

    if (!pass2Ok) {
      fs.copyFileSync(pass1Wav, trimmedWav);
    }
    if (fs.existsSync(pass1Wav)) fs.unlinkSync(pass1Wav);
    if (fs.existsSync(rawMp3)) fs.unlinkSync(rawMp3);
    wavFiles.push(trimmedWav);
  }
  return wavFiles;
}

function buildPass1VoiceFilter(
  usedFallback: boolean,
  voiceGender: VoiceGender,
  emotion: string,
  microBreath: number
): string {
  const baseChain =
    usedFallback && voiceGender === 'MALE'
      ? 'aresample=44100,asetrate=37485,aresample=44100,atempo=1.35'
      : usedFallback
      ? 'aresample=44100,atempo=1.18'
      : 'aresample=44100';

  let emotionEq: string;
  switch (emotion.toLowerCase().trim()) {
    case 'hook':
      emotionEq = ',atempo=1.04,equalizer=f=240:t=q:w=1.1:g=2.5,equalizer=f=3400:t=q:w=1.2:g=3.5';
      break;
    case 'excited':
    case 'roast':
      emotionEq = ',atempo=1.05,equalizer=f=280:t=q:w=1.0:g=2.0,equalizer=f=3600:t=q:w=1.2:g=4.0';
      break;
    case 'climax':
      emotionEq = ',atempo=1.03,equalizer=f=140:t=q:w=0.9:g=4.0,equalizer=f=3100:t=q:w=1.3:g=3.2';
      break;
    case 'suspense':
      emotionEq = ',atempo=0.94,equalizer=f=120:t=q:w=0.9:g=4.2,equalizer=f=4500:t=q:w=1.0:g=-3.0';
      break;
    case 'sad':
      emotionEq = ',atempo=0.92,equalizer=f=220:t=q:w=1.1:g=2.2,equalizer=f=4200:t=q:w=1.0:g=-4.0';
      break;
    case 'question':
      emotionEq = ',atempo=1.01,equalizer=f=2800:t=q:w=1.3:g=2.8';
      break;
    case 'warm':
      emotionEq = ',atempo=0.96,equalizer=f=210:t=q:w=1.0:g=3.0,equalizer=f=2200:t=q:w=1.2:g=1.4';
      break;
    default:
      emotionEq = ',equalizer=f=220:t=q:w=1.1:g=1.5';
      break;
  }

  return `${baseChain},highpass=f=75,acompressor=threshold=-20dB:ratio=2.8:attack=8:release=110${emotionEq},apad=pad_dur=${microBreath}`;
}

async function prepareBgmBed(
  _job: RenderJob,
  renderDirectory: string,
  mood: string,
  customBgmPath: string | null,
  bgmSeed: number
): Promise<string | null> {
  if (customBgmPath && fs.existsSync(customBgmPath) && fs.statSync(customBgmPath).size > 1024) {
    return customBgmPath;
  }
  const synthFile = path.join(renderDirectory, 'bgm_bed.wav');
  try {
    writeCinematicBgmWav(synthFile, mood, bgmSeed);
    return fs.existsSync(synthFile) && fs.statSync(synthFile).size > 1024 ? synthFile : null;
  } catch {
    return null;
  }
}

async function mixAudioTrackSafely(
  job: RenderJob,
  renderDirectory: string,
  fullVoiceFile: string,
  bgmBedFile: string | null,
  totalDurationSeconds: number,
  outputFile: string
): Promise<string | null> {
  const formattedDuration = totalDurationSeconds.toFixed(2);
  let bgmWavFile: string | null = null;
  if (bgmBedFile && fs.existsSync(bgmBedFile)) {
    if (bgmBedFile.toLowerCase().endsWith('.wav')) {
      bgmWavFile = bgmBedFile;
    } else {
      const converted = path.join(renderDirectory, 'bgm_decoded.wav');
      const ok = await runFfmpeg(job, [
        '-y',
        '-i',
        bgmBedFile,
        '-ar',
        '44100',
        '-ac',
        '1',
        '-c:a',
        'pcm_s16le',
        converted,
      ])
        .then(() => fs.existsSync(converted) && fs.statSync(converted).size > 44)
        .catch(() => false);
      if (ok) bgmWavFile = converted;
    }
  }

  const mixedWavFile = path.join(renderDirectory, 'mixed_audio.wav');
  const mixOk = mixVoiceBgmSfxWav(fullVoiceFile, bgmWavFile, null, totalDurationSeconds, mixedWavFile);
  if (!mixOk) return null;

  const aacOk = await runFfmpeg(job, [
    '-y',
    '-i',
    mixedWavFile,
    '-t',
    formattedDuration,
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '44100',
    '-ac',
    '2',
    outputFile,
  ])
    .then(() => fs.existsSync(outputFile) && fs.statSync(outputFile).size > 0)
    .catch(() => false);

  return aacOk ? outputFile : null;
}

async function muxFinalVideo(
  job: RenderJob,
  silentVideoFile: string,
  mixedAudioFile: string | null,
  fallbackVoiceFile: string,
  totalDurationSeconds: number,
  outputFile: string
): Promise<void> {
  const formattedDuration = totalDurationSeconds.toFixed(2);
  if (mixedAudioFile) {
    await runFfmpeg(job, [
      '-y',
      '-i',
      silentVideoFile,
      '-i',
      mixedAudioFile,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      'copy',
      '-c:a',
      'copy',
      '-t',
      formattedDuration,
      '-movflags',
      '+faststart',
      outputFile,
    ]);
  } else {
    await runFfmpeg(job, [
      '-y',
      '-i',
      silentVideoFile,
      '-i',
      fallbackVoiceFile,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ar',
      '44100',
      '-ac',
      '2',
      '-t',
      formattedDuration,
      '-movflags',
      '+faststart',
      outputFile,
    ]);
  }
}

async function createPopCaptionOverlays(
  renderDirectory: string,
  sceneIndex: number,
  fullSceneText: string,
  sceneDurationSeconds: number,
  videoWidth: number,
  isShorts: boolean
): Promise<PopCaptionChunk[]> {
  const chunksText = splitIntoPopChunks(fullSceneText, isShorts ? 4 : 6);
  if (chunksText.length === 0) return [];

  const weights = chunksText.map((c) => Math.max(1, c.replace(/\s+/g, '').length));
  const totalWeight = Math.max(1, weights.reduce((a, b) => a + b, 0));

  const result: PopCaptionChunk[] = [];
  let cursorTime = 0;

  for (let i = 0; i < chunksText.length; i++) {
    const chunkDur = (weights[i] / totalWeight) * sceneDurationSeconds;
    const startTime = cursorTime;
    const endTime = i === chunksText.length - 1 ? sceneDurationSeconds : cursorTime + chunkDur;
    cursorTime += chunkDur;

    const pngFile = path.join(renderDirectory, `pop_${sceneIndex + 1}_${i + 1}.png`);
    const stripHeight = await renderCaptionPng(chunksText[i], videoWidth, isShorts, pngFile);
    if (stripHeight !== null && fs.existsSync(pngFile)) {
      result.push({ file: pngFile, stripHeight, startSeconds: startTime, endSeconds: endTime });
    }
  }
  return result;
}

function splitIntoPopChunks(text: string, maxWordsPerChunk: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  if (words.length <= maxWordsPerChunk) return [words.join(' ')];

  const chunks: string[] = [];
  let idx = 0;
  while (idx < words.length) {
    const remaining = words.length - idx;
    const takeCount =
      remaining <= maxWordsPerChunk
        ? remaining
        : remaining === maxWordsPerChunk + 1
        ? maxWordsPerChunk - 1
        : maxWordsPerChunk;
    chunks.push(words.slice(idx, idx + takeCount).join(' '));
    idx += takeCount;
  }
  return chunks;
}

function buildSceneOverlaySpecs(
  popCaptions: PopCaptionChunk[],
  statBadgePng: string | null,
  watermarkPng: string,
  subscribeEndCardPng: string | null,
  sceneDurationSeconds: number,
  _videoWidth: number,
  videoHeight: number,
  isShorts: boolean
): OverlaySpec[] {
  const specs: OverlaySpec[] = [];

  for (const chunk of popCaptions) {
    const overlayY = isShorts
      ? Math.max(0, videoHeight - chunk.stripHeight - 360)
      : Math.max(0, videoHeight - chunk.stripHeight - 55);
    specs.push({
      file: chunk.file,
      xExpr: '0',
      yExpr: String(overlayY),
      enableExpr: `gte(t,${chunk.startSeconds.toFixed(2)})*lt(t,${chunk.endSeconds.toFixed(2)})`,
    });
  }

  if (statBadgePng && fs.existsSync(statBadgePng)) {
    specs.push({
      file: statBadgePng,
      xExpr: '(W-w)/2',
      yExpr: String(isShorts ? 210 : 65),
    });
  }

  specs.push({
    file: watermarkPng,
    xExpr: isShorts ? '42' : '48',
    yExpr: isShorts ? '118' : '44',
  });

  if (subscribeEndCardPng && fs.existsSync(subscribeEndCardPng) && sceneDurationSeconds > 1.2) {
    const startSub = Math.max(0.2, sceneDurationSeconds - 1.6).toFixed(2);
    specs.push({
      file: subscribeEndCardPng,
      xExpr: '(W-w)/2',
      yExpr: String(isShorts ? 290 : 135),
      enableExpr: `gte(t,${startSub})`,
    });
  }

  return specs;
}

async function resolveSceneImageFile(opts: {
  renderDirectory: string;
  tag: string;
  visualSource: string;
  realQuery: string;
  scenePrompt: string;
  voiceoverText: string;
  characterBible: string;
  visualStyle: string;
  visualStyleMode?: VisualStyleMode;
  contentMode?: ContentMode;
  customImagePath?: string;
  topicContext: string;
  hasCharacter: boolean;
  isShorts: boolean;
  width: number;
  height: number;
  seed: number;
  usedUrls: Set<string>;
  usedHashes: Set<string>;
  progressUpdate: (msg: string) => void;
  sceneIndex: number;
  slabCount: number;
}): Promise<string> {
  const imageFile = path.join(opts.renderDirectory, `slab_${opts.tag}.png`);
  if (opts.customImagePath && fs.existsSync(opts.customImagePath)) {
    opts.progressUpdate(`Using custom image for scene ${opts.sceneIndex + 1}…`);
    const customOk =
      (await composeStudioFrameFromRealPhoto(opts.customImagePath, imageFile, opts.width, opts.height).catch(
        () => false
      )) && !(await isMostlyBlackOrCorrupt(imageFile));
    if (customOk) {
      return imageFile;
    }
  }

  const contentMode: ContentMode = opts.contentMode ?? 'AUTO';
  const isStrictAiMode = contentMode === 'STORY' || contentMode === 'KIDS_STORY' || contentMode === 'COOKING';
  const forcedStylized = opts.visualStyleMode === 'PIXAR_3D' || opts.visualStyleMode === 'ANIME_3D';
  const preferAi =
    forcedStylized ||
    isStrictAiMode ||
    isNonCelebrityOrRecipeTopic(opts.realQuery.trim() || opts.scenePrompt, opts.topicContext);
  const wantsRealPhoto = !preferAi && opts.visualSource.toLowerCase() === 'real_photo' && opts.realQuery.trim().length > 0;

  if (wantsRealPhoto) {
    opts.progressUpdate(`Fetching real photo (${opts.realQuery})…`);
    const rawRealFile = path.join(opts.renderDirectory, `real_raw_${opts.tag}.img`);
    const downloaded = await downloadRealPhoto(
      opts.realQuery,
      opts.usedUrls,
      rawRealFile,
      opts.isShorts,
      opts.topicContext,
      opts.usedHashes
    ).catch(() => false);
    const prepared = downloaded
      ? (await composeStudioFrameFromRealPhoto(rawRealFile, imageFile, opts.width, opts.height)) &&
        !(await isMostlyBlackOrCorrupt(imageFile))
      : false;
    if (fs.existsSync(rawRealFile)) fs.unlinkSync(rawRealFile);
    if (prepared) {
      return imageFile;
    }
  }

  opts.progressUpdate(`Generating AI scene ${opts.sceneIndex + 1} of ${opts.slabCount}…`);
  const primaryPrompt = buildSceneImagePrompt(
    opts.characterBible,
    opts.visualStyle,
    opts.scenePrompt,
    opts.hasCharacter,
    opts.visualStyleMode
  );

  const primaryOk = await tryGenerateImageWithTimeout(
    primaryPrompt,
    opts.isShorts,
    opts.seed,
    imageFile,
    opts.usedHashes,
    contentMode
  );
  if (primaryOk) {
    return imageFile;
  }

  const safeSceneTopic = sanitizePromptText(opts.scenePrompt).slice(0, 140);
  const is3d =
    contentMode === 'KIDS_STORY' ||
    ['3d', 'pixar', 'disney', 'cartoon', 'anime'].some(
      (k) => opts.scenePrompt.toLowerCase().includes(k) || opts.visualStyle.toLowerCase().includes(k)
    );
  const safePrompt = safeSceneTopic
    ? is3d
      ? `3D Pixar Disney animated scene, ${safeSceneTopic}, vibrant sunlight, rich detail`
      : `raw 35mm DSLR photograph of ${safeSceneTopic}, natural lighting, sharp focus`
    : is3d
    ? '3D Pixar Disney cartoon animation, vibrant sunny storybook meadow with soft sunlight'
    : 'dramatic 35mm live-action film photograph, rich warm cinematic lighting, sharp focus';

  const retryOk = await tryGenerateImageWithTimeout(
    safePrompt,
    opts.isShorts,
    opts.seed + 101,
    imageFile,
    opts.usedHashes,
    contentMode
  );
  if (retryOk) {
    return imageFile;
  }

  opts.progressUpdate(`Fetching HD stock photo fallback for scene ${opts.sceneIndex + 1}…`);
  const stockQuery = buildStockFallbackQuery(opts.realQuery, opts.scenePrompt, opts.voiceoverText);
  if (stockQuery) {
    const rawStockFile = path.join(opts.renderDirectory, `stock_raw_${opts.tag}.img`);
    const stockDownloaded = await downloadStockPhotoFallback(
      stockQuery,
      opts.usedUrls,
      rawStockFile,
      opts.isShorts,
      opts.topicContext,
      opts.usedHashes
    ).catch(() => false);
    const stockPrepared = stockDownloaded
      ? (await composeStudioFrameFromRealPhoto(rawStockFile, imageFile, opts.width, opts.height)) &&
        !(await isMostlyBlackOrCorrupt(imageFile))
      : false;
    if (fs.existsSync(rawStockFile)) fs.unlinkSync(rawStockFile);
    if (stockPrepared) {
      return imageFile;
    }
  }

  await createFallbackCinemaFrame(imageFile, opts.width, opts.height, opts.sceneIndex);
  return imageFile;
}

async function tryGenerateImageWithTimeout(
  prompt: string,
  isShorts: boolean,
  seed: number,
  outFile: string,
  usedHashes?: Set<string>,
  contentMode: ContentMode = 'AUTO'
): Promise<boolean> {
  try {
    const buf = await Promise.race([
      generateImageForSlab(prompt, isShorts, seed, contentMode),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Image generation timed out')), IMAGE_GEN_TIMEOUT_MS)
      ),
    ]);
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    if (usedHashes && usedHashes.has(hash)) return false;
    fs.writeFileSync(outFile, buf);
    if (!fs.existsSync(outFile) || fs.statSync(outFile).size < 64) return false;
    const head = buf.subarray(0, 16).toString('utf8').trimStart();
    if (head.startsWith('{') || head.startsWith('<')) return false;
    const corrupt = await isMostlyBlackOrCorrupt(outFile);
    if (corrupt) return false;
    if (usedHashes) usedHashes.add(hash);
    return true;
  } catch {
    return false;
  }
}

function buildStockFallbackQuery(realQuery: string, scenePrompt: string, voiceoverText: string): string {
  if (realQuery.trim()) return realQuery.trim();
  const cleaned = sanitizePromptText(scenePrompt)
    .replace(
      /\b(35mm|dslr|photograph|photo|camera|wide|medium|close-up|closeup|low-angle|over-the-shoulder|shot|frame|vertical|horizontal|9:16|16:9|lighting|depth of field|cinematic|film set|still|pixar|disney|3d|anime|cartoon)\b/gi,
      ' '
    )
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned) {
    return cleaned
      .split(' ')
      .filter((w) => w.length >= 3)
      .slice(0, 4)
      .join(' ');
  }
  return voiceoverText
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length >= 3)
    .slice(0, 3)
    .join(' ');
}

function sanitizePromptText(raw: string): string {
  return raw
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(
      /\b(comment box|subscribe button|subscribe|social media|website|ui overlay|user interface|title card|movie poster|poster[- ]?like\s*still|poster|text overlay|stat badge|youtube shorts?|video_clip|meme_clip|split[- ]?layout|split[- ]?composition|split[- ]?screen|act as|collage|photo grid|grid of|panels|bold\s+(?:retro\s+)?lettering|lettering|typography)\b/gi,
      ''
    )
    .replace(
      /\b(graphic[- ]?style\s*)?(glowing\s*)?(hype\s*)?(meter\s*gauge|gauge\s*meter|hype\s*meter|speedometer|progress\s*bar|meter|scorecard|scoreboard|rating\s*chart|rating\s*cards?|rating\s*stars?|infographic|ui\s*icons?|streaming\s*icons?|icons?|play\s*button)\b/gi,
      'cheering Bollywood cinema audience under warm golden theater lights'
    )
    .replace(/\b(?:a\s+)?calendar(?:\s+marked[^,.]*)?\b/gi, 'grand red carpet movie theater entrance at night')
    .replace(/\b(?:showing|displaying|announcing|reading|with|marked)\s+(?:the\s+)?(?:release\s+date[^,.]*|\d+\s*\/\s*\d+|\d+\s*out\s*of\s*\d+|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}|bold\s+(?:hindi|english)?\s*text|hindi\s*text|english\s*text|text|numbers?)\b/gi, '')
    .replace(/\b(?:date\s*highlighted|highlighted\s*date|contract\s+with\s+bold\s*text)\b/gi, 'dramatic wedding paper envelope on wooden table')
    .replace(/\banimal\s+(?:movie|film|teaser|trailer)\b/gi, 'intense Bollywood action film')
    .replace(/\bspirit\s+(?:movie|film|teaser|trailer)\b/gi, 'fierce police thriller')
    .replace(/\bdark violence\b|\bbrutal violence\b|\bviolence\b/gi, 'dramatic action confrontation in moody lighting')
    .replace(/\bblood rivers?\b|\brivers of blood\b/gi, 'dramatic crimson-lit action showdown with flying sparks')
    .replace(/\bbox[- ]?office\b/gi, 'cheering packed cinema hall')
    .replace(/\bunreal engine(?:\s*5)?\b/gi, 'cinema film still')
    .replace(/\babstract\b/gi, 'detailed scene')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[, .]+|[, .]+$/g, '');
}

function buildSceneImagePrompt(
  characterBible: string,
  visualStyle: string,
  scenePrompt: string,
  hasCharacter: boolean,
  visualStyleMode?: VisualStyleMode
): string {
  const cleanScene = sanitizePromptText(scenePrompt);
  const cleanBible = sanitizePromptText(characterBible);
  const cleanStyle = sanitizePromptText(visualStyle);
  const lower = cleanScene.toLowerCase();
  let prefix = '';
  if (visualStyleMode === 'PIXAR_3D' && !['3d', 'pixar', 'disney', 'cgi'].some((k) => lower.includes(k))) {
    prefix = '3D Pixar Disney CGI animated scene, ';
  } else if (visualStyleMode === 'ANIME_3D' && !['anime', 'cel-shaded', 'ghibli'].some((k) => lower.includes(k))) {
    prefix = 'Cinematic anime animation film frame, ';
  }
  let out = prefix + cleanScene;
  if (hasCharacter && cleanBible) out += `. Main character look: ${cleanBible}`;
  if (cleanStyle) out += `. Style: ${cleanStyle}`;
  return out;
}

function buildEdgeFades(sceneIndex: number, totalScenes: number, frames: number): string {
  const durationSeconds = frames / FRAME_RATE;
  const fadeOutStart = Math.max(0.05, durationSeconds - 0.28).toFixed(2);
  let fades = '';
  if (sceneIndex === 0) fades += 'fade=t=in:st=0:d=0.18,';
  if (sceneIndex === totalScenes - 1) fades += `fade=t=out:st=${fadeOutStart}:d=0.26,`;
  return fades;
}

function buildMotionAndGradeFilter(
  sceneIndex: number,
  width: number,
  height: number,
  frames: number,
  is3dVivid = false,
  isHighEnergy = false
): string {
  const denom = Math.max(1, frames - 1);
  const upWidth = Math.floor(width * 2.2);
  const upHeight = Math.floor(height * 2.2);
  const ease = `0.5*(1-cos(PI*on/${denom}))`;
  const arc = `sin(PI*on/${denom})`;

  let motionFilter: string;
  if (isHighEnergy && sceneIndex % 2 === 0) {
    // Dynamic 2.5D action punch-in + smooth floating drift for hook/climax beats
    motionFilter = `zoompan=z='1.03+0.15*(1-exp(-on*0.20))+0.04*(on/${denom})':x='(iw-iw/zoom)*(0.5+0.04*sin(on*0.28))':y='(ih-ih/zoom)*(0.5+0.03*cos(on*0.24))':d=${frames}:s=${width}x${height}:fps=${FRAME_RATE}`;
  } else {
    switch (sceneIndex % 8) {
      case 0:
        motionFilter = `zoompan=z='1.02+0.16*${ease}':x='(iw-iw/zoom)*(0.5+0.08*${arc})':y='(ih-ih/zoom)*(0.52-0.14*(on/${denom}))':d=${frames}:s=${width}x${height}:fps=${FRAME_RATE}`;
        break;
      case 1:
        motionFilter = `zoompan=z='1.20-0.16*${ease}':x='(iw-iw/zoom)*0.5':y='(ih-ih/zoom)*(0.45+0.08*${arc})':d=${frames}:s=${width}x${height}:fps=${FRAME_RATE}`;
        break;
      case 2:
        motionFilter = `zoompan=z='1.12+0.06*${arc}':x='(iw-iw/zoom)*${ease}':y='(ih-ih/zoom)*(0.5-0.06*${arc})':d=${frames}:s=${width}x${height}:fps=${FRAME_RATE}`;
        break;
      case 3:
        motionFilter = `zoompan=z='1.14+0.05*${arc}':x='(iw-iw/zoom)*(1-${ease})':y='(ih-ih/zoom)*(0.5+0.06*${arc})':d=${frames}:s=${width}x${height}:fps=${FRAME_RATE}`;
        break;
      case 4:
        motionFilter = `zoompan=z='1.14+0.04*${ease}':x='(iw-iw/zoom)*(0.5-0.05*${arc})':y='(ih-ih/zoom)*(1-${ease})':d=${frames}:s=${width}x${height}:fps=${FRAME_RATE}`;
        break;
      case 5:
        motionFilter = `zoompan=z='1.12+0.06*${ease}':x='(iw-iw/zoom)*(0.5+0.05*${arc})':y='(ih-ih/zoom)*${ease}':d=${frames}:s=${width}x${height}:fps=${FRAME_RATE}`;
        break;
      case 6:
        motionFilter = `zoompan=z='1.05+0.15*${ease}':x='(iw-iw/zoom)*${ease}':y='(ih-ih/zoom)*(0.68-0.36*${ease})':d=${frames}:s=${width}x${height}:fps=${FRAME_RATE}`;
        break;
      default:
        motionFilter = `zoompan=z='1.19-0.14*${ease}':x='(iw-iw/zoom)*(1-${ease})':y='(ih-ih/zoom)*(0.32+0.34*${ease})':d=${frames}:s=${width}x${height}:fps=${FRAME_RATE}`;
        break;
    }
  }

  const baseGrade = is3dVivid
    ? 'eq=contrast=1.10:saturation=1.20:brightness=0.02,unsharp=5:5:0.46,vignette=PI/7'
    : 'eq=contrast=1.08:saturation=1.13:brightness=0.01,unsharp=3:3:0.38,vignette=PI/6';
  return `scale=${upWidth}:${upHeight}:force_original_aspect_ratio=increase:flags=lanczos,crop=${upWidth}:${upHeight},setsar=1,${motionFilter},${baseGrade}`;
}

function appendOverlayChain(
  args: string[],
  filterParts: string[],
  initialLabel: string,
  overlaySpecs: OverlaySpec[],
  startInputIndex: number,
  edgeFades: string
): void {
  if (overlaySpecs.length === 0) {
    filterParts.push(`[${initialLabel}]${edgeFades}format=yuv420p[vout]`);
    return;
  }
  let currentLabel = initialLabel;
  overlaySpecs.forEach((spec, idx) => {
    args.push('-i', spec.file);
    const inputIdx = startInputIndex + idx;
    const nextLabel = `ov_${idx}`;
    const enableClause = spec.enableExpr ? `:enable='${spec.enableExpr}'` : '';
    filterParts.push(
      `[${currentLabel}][${inputIdx}:v]overlay=${spec.xExpr}:${spec.yExpr}:eof_action=repeat${enableClause}[${nextLabel}]`
    );
    currentLabel = nextLabel;
  });
  filterParts.push(`[${currentLabel}]${edgeFades}format=yuv420p[vout]`);
}

function createVideoOnlySegmentArguments(
  sceneIndex: number,
  totalScenes: number,
  imageFile: string,
  overlaySpecs: OverlaySpec[],
  outputFile: string,
  width: number,
  height: number,
  segmentFrames: number,
  is3dVivid = false,
  isHighEnergy = false
): string[] {
  const frames = Math.max(MIN_SCENE_FRAMES, segmentFrames);
  const motionAndGrade = buildMotionAndGradeFilter(sceneIndex, width, height, frames, is3dVivid, isHighEnergy);
  const edgeFades = buildEdgeFades(sceneIndex, totalScenes, frames);

  const args = ['-y', '-i', imageFile];
  const filterParts = [`[0:v]${motionAndGrade}[bgbase]`];
  appendOverlayChain(args, filterParts, 'bgbase', overlaySpecs, 1, edgeFades);

  args.push(
    '-filter_complex',
    filterParts.join(';'),
    '-map',
    '[vout]',
    '-frames:v',
    String(frames),
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '21',
    '-threads',
    '2',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(FRAME_RATE),
    outputFile
  );
  return args;
}

function createFlipVideoSegmentArguments(
  sceneIndex: number,
  totalScenes: number,
  imageFile1: string,
  imageFile2: string,
  overlaySpecs: OverlaySpec[],
  outputFile: string,
  width: number,
  height: number,
  segmentFrames: number,
  switchBaseDurationSeconds: number,
  is3dVivid = false,
  isHighEnergy = false
): string[] {
  const frames = Math.max(MIN_SCENE_FRAMES, segmentFrames);
  const edgeFades = buildEdgeFades(sceneIndex, totalScenes, frames);
  const xfadeFrames = frames >= 36 ? 8 : 0;

  const args = ['-y', '-i', imageFile1, '-i', imageFile2];
  let filterParts: string[];
  if (xfadeFrames > 0) {
    const desiredSwitch = Math.round(switchBaseDurationSeconds * 0.5 * FRAME_RATE);
    const switchFrame = Math.max(12, Math.min(frames - 12, desiredSwitch));
    const p1Frames = switchFrame + xfadeFrames;
    const p2Frames = frames - switchFrame;
    const offsetSec = (switchFrame / FRAME_RATE).toFixed(3);
    const xfadeDur = (xfadeFrames / FRAME_RATE).toFixed(3);
    const flipTransitions = ['smoothleft', 'smoothright', 'wipeup', 'circleopen'];
    const transition = flipTransitions[sceneIndex % flipTransitions.length];
    const motionShot1 = buildMotionAndGradeFilter(sceneIndex, width, height, p1Frames, is3dVivid, isHighEnergy);
    const motionShot2 = buildMotionAndGradeFilter(sceneIndex + 3, width, height, p2Frames, is3dVivid, true);
    filterParts = [
      `[0:v]${motionShot1}[p1]`,
      `[1:v]${motionShot2}[p2]`,
      `[p1][p2]xfade=transition=${transition}:duration=${xfadeDur}:offset=${offsetSec}[flipbase]`,
    ];
  } else {
    const motionShot1 = buildMotionAndGradeFilter(sceneIndex, width, height, frames, is3dVivid, isHighEnergy);
    const motionShot2 = buildMotionAndGradeFilter(sceneIndex + 3, width, height, frames, is3dVivid, true);
    const switchSec = (switchBaseDurationSeconds * 0.5).toFixed(2);
    filterParts = [
      `[0:v]${motionShot1}[p1]`,
      `[1:v]${motionShot2}[p2]`,
      `[p1][p2]overlay=0:0:enable='gte(t,${switchSec})'[flipbase]`,
    ];
  }
  appendOverlayChain(args, filterParts, 'flipbase', overlaySpecs, 2, edgeFades);

  args.push(
    '-filter_complex',
    filterParts.join(';'),
    '-map',
    '[vout]',
    '-frames:v',
    String(frames),
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '21',
    '-threads',
    '2',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(FRAME_RATE),
    outputFile
  );
  return args;
}

function createVideoClipSegmentArguments(
  clipFile: string,
  overlaySpecs: OverlaySpec[],
  outputFile: string,
  width: number,
  height: number,
  frames: number,
  sceneIndex: number,
  totalScenes: number,
  clean3dClip = false
): string[] {
  const safeFrames = Math.max(MIN_SCENE_FRAMES, frames);
  let blurW = Math.max(32, Math.floor(width / 16));
  if (blurW % 2 !== 0) blurW += 1;
  let blurH = Math.max(32, Math.floor(height / 16));
  if (blurH % 2 !== 0) blurH += 1;
  const edgeFades = buildEdgeFades(sceneIndex, totalScenes, safeFrames);

  const safeCrop =
    "crop='if(gt(iw,ih),trunc(iw*0.90/2)*2,trunc(iw*0.95/2)*2)':'if(gt(iw,ih),trunc(ih*0.86/2)*2,trunc(ih*0.92/2)*2)':'(iw-ow)/2':'(ih-oh)/2'";

  const args = ['-y', '-stream_loop', '-1', '-i', clipFile];
  const filterParts = clean3dClip
    ? [
        `[0:v]fps=${FRAME_RATE},format=yuv420p,setsar=1,scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height},eq=contrast=1.06:saturation=1.10,unsharp=5:5:0.45:5:5:0.0[clipbase]`,
      ]
    : [
        `[0:v]fps=${FRAME_RATE},format=yuv420p,setsar=1,${safeCrop},split=2[bgsrc][fgsrc]`,
        `[bgsrc]scale=${blurW}:${blurH}:force_original_aspect_ratio=increase,crop=${blurW}:${blurH},scale=${width}:${height}:flags=bilinear,eq=brightness=-0.20:saturation=0.85[bg0]`,
        `[fgsrc]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2[fg]`,
        `[bg0][fg]overlay=(W-w)/2:(H-h)/2,eq=contrast=1.07:saturation=1.12,unsharp=3:3:0.30,vignette=PI/6[clipbase]`,
      ];
  appendOverlayChain(args, filterParts, 'clipbase', overlaySpecs, 1, edgeFades);

  args.push(
    '-filter_complex',
    filterParts.join(';'),
    '-map',
    '[vout]',
    '-frames:v',
    String(safeFrames),
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '21',
    '-threads',
    '2',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(FRAME_RATE),
    outputFile
  );
  return args;
}

async function mergeSegmentsWithDissolve(
  job: RenderJob,
  renderDirectory: string,
  segments: string[],
  baseDurations: number[],
  outputFile: string
): Promise<boolean> {
  if (segments.length === 0) return false;
  if (segments.length === 1) {
    fs.copyFileSync(segments[0], outputFile);
    return fs.existsSync(outputFile) && fs.statSync(outputFile).size > 2048;
  }

  const batchSize = 4;
  let currentFiles = segments;
  let currentDurations = baseDurations;
  let passIndex = 0;

  while (currentFiles.length > 1) {
    const nextFiles: string[] = [];
    const nextDurations: number[] = [];
    const isFinalPass = currentFiles.length <= batchSize;
    let idx = 0;

    while (idx < currentFiles.length) {
      const end = Math.min(idx + batchSize, currentFiles.length);
      const chunkFiles = currentFiles.slice(idx, end);
      const chunkDurs = currentDurations.slice(idx, end);
      const hasFollowingChunk = end < currentFiles.length;

      if (chunkFiles.length === 1) {
        nextFiles.push(chunkFiles[0]);
        nextDurations.push(chunkDurs[0]);
      } else {
        const outTarget =
          isFinalPass && idx === 0 && !hasFollowingChunk
            ? outputFile
            : path.join(renderDirectory, `dissolve_p${passIndex}_${nextFiles.length}.mp4`);

        await runDissolveBatch(job, chunkFiles, chunkDurs, outTarget);
        if (!fs.existsSync(outTarget) || fs.statSync(outTarget).size <= 2048) return false;
        nextFiles.push(outTarget);
        nextDurations.push(chunkDurs.reduce((a, b) => a + b, 0));
      }
      idx = end;
    }

    currentFiles = nextFiles;
    currentDurations = nextDurations;
    passIndex++;
  }

  if (currentFiles[0] !== outputFile) {
    fs.copyFileSync(currentFiles[0], outputFile);
  }
  return fs.existsSync(outputFile) && fs.statSync(outputFile).size > 2048;
}

async function runDissolveBatch(
  job: RenderJob,
  chunkFiles: string[],
  chunkBaseDurations: number[],
  outputFile: string
): Promise<void> {
  const args = ['-y'];
  for (const file of chunkFiles) {
    args.push('-i', file);
  }

  const filterParts: string[] = [];
  let currentLabel = '0:v';
  let cumulativeOffset = chunkBaseDurations[0];

  const transitions = ['fade', 'smoothleft', 'dissolve', 'smoothright', 'fade'];
  for (let i = 1; i < chunkFiles.length; i++) {
    const outLabel = i === chunkFiles.length - 1 ? 'vout' : `xf_${i}`;
    const offsetStr = Math.max(0.25, cumulativeOffset).toFixed(3);
    const durStr = DISSOLVE_SECONDS.toFixed(3);
    const tx = transitions[(i - 1) % transitions.length];
    filterParts.push(`[${currentLabel}][${i}:v]xfade=transition=${tx}:duration=${durStr}:offset=${offsetStr}[${outLabel}]`);
    currentLabel = outLabel;
    cumulativeOffset += chunkBaseDurations[i];
  }

  args.push(
    '-filter_complex',
    filterParts.join(';'),
    '-map',
    '[vout]',
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-threads',
    '2',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(FRAME_RATE),
    outputFile
  );

  await runFfmpeg(job, args);
}

function runFfmpeg(job: RenderJob, args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (job.abortController.signal.aborted) {
      reject(new Error('CANCELLED'));
      return;
    }

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    job.activeProcesses.add(proc);

    let stderr = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 8000) stderr = stderr.slice(-4000);
    });

    proc.on('error', (err) => {
      job.activeProcesses.delete(proc);
      reject(new Error(`FFmpeg startup error: ${err.message}`));
    });

    proc.on('close', (code) => {
      job.activeProcesses.delete(proc);
      if (job.abortController.signal.aborted) {
        reject(new Error('CANCELLED'));
        return;
      }
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg failed (code ${code}): ${stderr.slice(-800)}`));
      }
    });
  });
}

function safeFileName(value: string): string {
  const cleaned = stripDecorativeEmojis(value)
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 45);
  return cleaned || 'Video';
}

function escapeConcatPath(filePath: string): string {
  return filePath.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}
