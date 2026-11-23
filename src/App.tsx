import React, { useEffect, useRef, useState } from 'react';
import {
  CONTENT_MODES,
  INPUT_MODES,
  VIDEO_LANGUAGE_OPTIONS,
  VISUAL_STYLE_OPTIONS,
  VOICE_GENDERS,
  VOICE_TONES,
  type ContentMode,
  type InputMode,
  type RenderStatusResponse,
  type VideoLanguageKey,
  type VideoScriptResponse,
  type VisualStyleMode,
  type VoiceGender,
  type VoiceTone,
} from './types/video';
import { ThreeCharacterStudio } from './three/ThreeCharacterStudio';
import { DEFAULT_DEMO_SLABS } from './three/types';

interface CustomSceneMediaEntry {
  file: File;
  previewUrl: string;
  isVideo: boolean;
  name: string;
}

const VISUAL_SOURCE_OPTIONS = [
  { key: 'ai_generated', label: 'AI' },
  { key: 'real_photo', label: 'Photo' },
  { key: 'video_clip', label: 'Clip' },
  { key: 'meme_clip', label: 'Meme' },
] as const;

const LAYOUT_MODE_OPTIONS = [
  { key: 'single', label: 'Single' },
  { key: 'split', label: 'Split 2' },
  { key: 'flip', label: 'Flip 2' },
] as const;

export function App() {
  const [topic, setTopic] = useState('');
  const [contentMode, setContentMode] = useState<ContentMode>('AUTO');
  const [inputMode, setInputMode] = useState<InputMode>('AUTO');
  const [isShorts, setIsShorts] = useState(true);
  const [selectedLanguage, setSelectedLanguage] = useState<VideoLanguageKey>('AUTO');
  const [selectedGender, setSelectedGender] = useState<VoiceGender>('MALE');
  const [selectedVoiceTone, setSelectedVoiceTone] = useState<VoiceTone>('AUTO');
  const [selectedVisualStyle, setSelectedVisualStyle] = useState<VisualStyleMode>('AUTO');
  const [showAudioSettings, setShowAudioSettings] = useState(false);

  const [selectedBgmFile, setSelectedBgmFile] = useState<File | null>(null);
  const [selectedBgmName, setSelectedBgmName] = useState('Built-in Cinematic BGM');

  const [isLoadingTrending, setIsLoadingTrending] = useState(false);
  const [trendingTopics, setTrendingTopics] = useState<string[]>([]);

  const [isPreviewingScript, setIsPreviewingScript] = useState(false);
  const [draftScript, setDraftScript] = useState<VideoScriptResponse | null>(null);
  const [customSceneMedia, setCustomSceneMedia] = useState<Record<string, CustomSceneMediaEntry>>({});

  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [progressPercentage, setProgressPercentage] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
  const [generatedThumbnailUrl, setGeneratedThumbnailUrl] = useState<string | null>(null);
  const [completedScript, setCompletedScript] = useState<VideoScriptResponse | null>(null);

  const [showVideoPlayer, setShowVideoPlayer] = useState(false);
  const [showCoverModal, setShowCoverModal] = useState(false);
  const [showAndroidModal, setShowAndroidModal] = useState(false);
  const [rightView, setRightView] = useState<'stage3d' | 'output'>('stage3d');
  const [toastText, setToastText] = useState<string | null>(null);

  const bgmInputRef = useRef<HTMLInputElement | null>(null);
  const sceneMediaRefs = useRef<Record<string, CustomSceneMediaEntry>>({});
  const videoPlayerRef = useRef<HTMLVideoElement | null>(null);

  const busy = isGenerating || isPreviewingScript;

  useEffect(() => {
    sceneMediaRefs.current = customSceneMedia;
  }, [customSceneMedia]);

  useEffect(() => {
    return () => {
      for (const entry of Object.values(sceneMediaRefs.current)) {
        URL.revokeObjectURL(entry.previewUrl);
      }
    };
  }, []);

  useEffect(() => {
    if (!toastText) return;
    const t = setTimeout(() => setToastText(null), 2200);
    return () => clearTimeout(t);
  }, [toastText]);

  const fetchJsonWithRetry = async <T,>(
    url: string,
    makeInit?: () => RequestInit,
    maxAttempts = 4
  ): Promise<{ res: Response; data: T }> => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fetch(url, makeInit ? makeInit() : undefined);
        const contentType = res.headers.get('content-type') || '';
        const isTransientGateway = [502, 503, 504, 520, 522, 524].includes(res.status);
        if (isTransientGateway && attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 1200 * attempt));
          continue;
        }
        if (!contentType.includes('application/json')) {
          const text = await res.text().catch(() => '');
          if (attempt < maxAttempts && (res.status >= 500 || text.trim().startsWith('<'))) {
            await new Promise((r) => setTimeout(r, 1200 * attempt));
            continue;
          }
          throw new Error(
            res.ok
              ? 'Unexpected server response format.'
              : `Server temporarily unavailable (HTTP ${res.status}). Please try again.`
          );
        }
        const data = (await res.json()) as T;
        return { res, data };
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        const isNetwork =
          err instanceof TypeError || /failed to fetch|networkerror|load failed|network request failed/i.test(msg);
        if (isNetwork && attempt < maxAttempts) {
          await fetch('/api/health').catch(() => {});
          await new Promise((r) => setTimeout(r, 1200 * attempt));
          continue;
        }
        throw err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Network request failed');
  };

  useEffect(() => {
    const wakeServer = () => {
      if (document.visibilityState === 'visible') {
        void fetch('/api/health').catch(() => {});
      }
    };
    void fetch('/api/health').catch(() => {});
    document.addEventListener('visibilitychange', wakeServer);
    return () => document.removeEventListener('visibilitychange', wakeServer);
  }, []);

  useEffect(() => {
    if (!activeJobId || !isGenerating) return;
    let cancelled = false;
    let missingCount = 0;

    const poll = async () => {
      try {
        const res = await fetch(`/api/render/status/${activeJobId}`);
        if (res.status === 404) {
          missingCount += 1;
          if (missingCount >= 3 && !cancelled) {
            setIsGenerating(false);
            setProgressText('');
            setStatusMessage('Generation failed: Server restarted mid-render. Please tap Generate Video again.');
          }
          return;
        }
        if (!res.ok) return;
        missingCount = 0;
        const data = (await res.json()) as RenderStatusResponse;
        if (cancelled) return;

        setProgressText(data.progressText);
        setProgressPercentage(data.progressPercentage);
        setStatusMessage(data.statusMessage);
        setGeneratedVideoUrl(data.videoUrl);
        setGeneratedThumbnailUrl(data.thumbnailUrl);
        setCompletedScript(data.completedScript);

        if (!data.isGenerating) {
          setIsGenerating(false);
          if (data.videoUrl) setShowVideoPlayer(true);
        }
      } catch {
        // transient poll error; keep polling
      }
    };

    const interval = setInterval(poll, 1000);
    void poll();
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeJobId, isGenerating]);

  const clearAllSceneMedia = () => {
    setCustomSceneMedia((prev) => {
      for (const entry of Object.values(prev)) {
        URL.revokeObjectURL(entry.previewUrl);
      }
      return {};
    });
  };

  const resetDraft = () => {
    setDraftScript(null);
    clearAllSceneMedia();
  };

  const showToast = (msg: string) => setToastText(msg);

  const onTopicChanged = (val: string) => {
    setTopic(val);
    resetDraft();
  };

  const onContentModeSelected = (mode: ContentMode) => {
    setContentMode(mode);
    resetDraft();
  };

  const onInputModeSelected = (mode: InputMode) => {
    setInputMode(mode);
    resetDraft();
  };

  const onTopicSelectedFromTrending = (idea: string) => {
    setTopic(idea);
    setContentMode('REVIEW');
    setInputMode('AI_PROMPT');
    resetDraft();
    setStatusMessage('');
  };

  const loadTrendingTopics = async () => {
    if (isLoadingTrending || isGenerating) return;
    setIsLoadingTrending(true);
    try {
      const { res, data } = await fetchJsonWithRetry<{ topics?: string[]; error?: string }>('/api/trending');
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const list = data.topics ?? [];
      setTrendingTopics(list);
      setStatusMessage(list.length === 0 ? 'Could not load trending movie news right now.' : '');
    } catch (err) {
      setStatusMessage(`Trending fetch failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsLoadingTrending(false);
    }
  };

  const onBgmFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedBgmFile(file);
    setSelectedBgmName(file.name || 'Custom Audio');
  };

  const clearBgm = () => {
    setSelectedBgmFile(null);
    setSelectedBgmName('Built-in Cinematic BGM');
    if (bgmInputRef.current) bgmInputRef.current.value = '';
  };

  const onSceneMediaChange = (index: number, panel: 1 | 2, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|webm|mkv|m4v|avi)$/i.test(file.name);
    if (panel === 2 && isVideo) {
      showToast('Panel 2 supports custom images; use Panel 1 for custom video clips');
      e.target.value = '';
      return;
    }
    const key = `${index}_${panel}`;
    const previewUrl = URL.createObjectURL(file);
    setCustomSceneMedia((prev) => {
      if (prev[key]) URL.revokeObjectURL(prev[key].previewUrl);
      return {
        ...prev,
        [key]: {
          file,
          previewUrl,
          isVideo,
          name: file.name || (isVideo ? 'Custom Clip' : 'Custom Photo'),
        },
      };
    });
    e.target.value = '';
  };

  const removeSceneMedia = (index: number, panel: 1 | 2) => {
    const key = `${index}_${panel}`;
    setCustomSceneMedia((prev) => {
      const target = prev[key];
      if (!target) return prev;
      URL.revokeObjectURL(target.previewUrl);
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const previewScript = async () => {
    if (busy) return;
    const clean = topic.trim();
    if (!clean) {
      setStatusMessage('Enter a topic or script before previewing.');
      return;
    }

    setIsPreviewingScript(true);
    setStatusMessage('');
    resetDraft();
    try {
      const { res, data } = await fetchJsonWithRetry<{ script?: VideoScriptResponse; error?: string }>(
        '/api/script/preview',
        () => ({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic: clean,
            isShorts,
            language: selectedLanguage,
            voiceGender: selectedGender,
            inputMode,
            contentMode,
            voiceTone: selectedVoiceTone,
            visualStyle: selectedVisualStyle,
          }),
        })
      );
      if (!res.ok || !data.script) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setDraftScript(data.script);
      showToast(`${data.script.slabs.length} scenes ready in 3D Stage & Storyboard`);
    } catch (err) {
      setStatusMessage(`Script error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsPreviewingScript(false);
    }
  };

  const handleAttachCapturedClips = (clips: Array<{ sceneIndex: number; file: File }>) => {
    if (clips.length === 0) return;
    if (!draftScript) {
      const demoText = DEFAULT_DEMO_SLABS.map((s) => s.voiceover_text).join('\n\n');
      if (!topic.trim()) setTopic(demoText);
      setDraftScript({
        character_bible: 'Cute stylized 3D animated character moving across forest and starry night scenes',
        visual_style: '3D Pixar Disney animated story',
        bgm_mood: 'motivational',
        voice_name: selectedGender === 'FEMALE' ? 'hi-IN-SwaraNeural' : 'hi-IN-MadhurNeural',
        youtube_title: 'नन्हा जुगनू और उदास चाँद | 3D Kids Story',
        youtube_description: '3D animated Hindi kids moral story made with RS Movie Spot.',
        youtube_hashtags: '#shorts #kidsstory #3danimation',
        pinned_comment: 'Kahani ka kaunsa scene sabse achha laga?',
        slabs: DEFAULT_DEMO_SLABS,
      });
    }
    setCustomSceneMedia((prev) => {
      const next = { ...prev };
      for (const { sceneIndex, file } of clips) {
        const key = `${sceneIndex}_1`;
        if (next[key]) URL.revokeObjectURL(next[key].previewUrl);
        next[key] = {
          file,
          previewUrl: URL.createObjectURL(file),
          isVideo: true,
          name: file.name,
        };
      }
      return next;
    });
    setRightView('output');
    showToast(`${clips.length} 3D clips attached — tap Generate Video`);
  };

  const startGeneratingVideo = async () => {
    if (busy) return;
    const clean = topic.trim();
    if (!clean) {
      setStatusMessage('Enter a topic or script before generating a video.');
      return;
    }

    setRightView('output');
    setIsGenerating(true);
    setProgressText('Starting video generation…');
    setProgressPercentage(0);
    setStatusMessage('');
    setGeneratedVideoUrl(null);
    setGeneratedThumbnailUrl(null);
    setCompletedScript(null);
    setShowVideoPlayer(false);

    try {
      const { res, data } = await fetchJsonWithRetry<{ jobId?: string; error?: string }>(
        '/api/render/start',
        () => {
          const form = new FormData();
          form.append('topic', clean);
          form.append('isShorts', String(isShorts));
          form.append('language', selectedLanguage);
          form.append('voiceGender', selectedGender);
          form.append('voiceTone', selectedVoiceTone);
          form.append('visualStyle', selectedVisualStyle);
          form.append('inputMode', inputMode);
          form.append('contentMode', contentMode);
          if (draftScript) {
            form.append('preGeneratedScript', JSON.stringify(draftScript));
          }
          if (selectedBgmFile) {
            form.append('bgmFile', selectedBgmFile);
          }
          for (const [key, entry] of Object.entries(customSceneMedia)) {
            form.append(`sceneMedia_${key}`, entry.file);
          }
          return {
            method: 'POST',
            body: form,
          };
        }
      );
      if (!res.ok || !data.jobId) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setActiveJobId(data.jobId);
    } catch (err) {
      setIsGenerating(false);
      const rawMsg = err instanceof Error ? err.message : 'Unknown error';
      const friendly = /failed to fetch|networkerror|load failed/i.test(rawMsg)
        ? 'Connection interrupted while starting render. Please check internet and tap Generate Video again.'
        : rawMsg;
      setStatusMessage(`Generation failed: ${friendly}`);
    }
  };

  const cancelGeneratingVideo = async () => {
    if (!activeJobId) return;
    try {
      const res = await fetch(`/api/render/cancel/${activeJobId}`, { method: 'POST' });
      if (res.ok) {
        const data = (await res.json()) as RenderStatusResponse;
        setIsGenerating(false);
        setProgressText('');
        setStatusMessage(data.statusMessage || 'Video generation cancelled.');
      }
    } catch {
      setIsGenerating(false);
      setStatusMessage('Video generation cancelled.');
    }
  };

  const updateSlab = (
    index: number,
    updater: (slab: VideoScriptResponse['slabs'][number]) => VideoScriptResponse['slabs'][number]
  ) => {
    setDraftScript((prev) => {
      if (!prev || index < 0 || index >= prev.slabs.length) return prev;
      const slabs = [...prev.slabs];
      slabs[index] = updater(slabs[index]);
      return { ...prev, slabs };
    });
  };

  const onSlabVisualSourceChanged = (index: number, newSource: string) => {
    updateSlab(index, (target) => {
      const fallbackQuery =
        newSource !== 'ai_generated' && !target.real_photo_query.trim()
          ? topic.trim().slice(0, 60)
          : target.real_photo_query;
      return {
        ...target,
        visual_source: newSource,
        real_photo_query: fallbackQuery,
      };
    });
  };

  const onSlabLayoutModeChanged = (index: number, newLayoutMode: string) => {
    updateSlab(index, (target) => {
      const secondSource =
        newLayoutMode !== 'single' && !target.visual_source_2.trim()
          ? 'ai_generated'
          : target.visual_source_2;
      const secondPrompt =
        newLayoutMode !== 'single' && !target.image_prompt_2.trim()
          ? target.image_prompt
          : target.image_prompt_2;
      return {
        ...target,
        layout_mode: newLayoutMode,
        visual_source_2: secondSource,
        image_prompt_2: secondPrompt,
      };
    });
  };

  const copyToClipboard = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${label} copied`);
    } catch {
      showToast(`Could not copy ${label}`);
    }
  };

  const shareOrDownloadVideo = async (videoUrl: string) => {
    try {
      if (navigator.share) {
        const res = await fetch(videoUrl);
        const blob = await res.blob();
        const file = new File([blob], 'RS_Movie_Spot_Video.mp4', { type: 'video/mp4' });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({
            title: completedScript?.youtube_title || 'RS Movie Spot Video',
            files: [file],
          });
          return;
        }
      }
    } catch {
      // fall through to download
    }
    const a = document.createElement('a');
    a.href = `${videoUrl}?download=1`;
    a.download = 'RS_Movie_Spot_Video.mp4';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const contentModeHint = CONTENT_MODES.find((m) => m.value === contentMode)?.hint ?? '';
  const inputHint =
    inputMode === 'EXACT_SCRIPT'
      ? INPUT_MODES.find((m) => m.value === inputMode)?.hint ?? ''
      : contentMode !== 'AUTO'
      ? contentModeHint
      : INPUT_MODES.find((m) => m.value === inputMode)?.hint ?? '';

  const activeKitScript = completedScript ?? draftScript;
  const fullDescriptionWithTags = activeKitScript
    ? [activeKitScript.youtube_description.trim(), activeKitScript.youtube_hashtags.trim()]
        .filter(Boolean)
        .join('\n\n')
    : '';

  const isStatusError =
    statusMessage.toLowerCase().includes('failed') || statusMessage.toLowerCase().includes('error');

  const voiceToneLabel = VOICE_TONES.find((t) => t.value === selectedVoiceTone)?.label ?? 'Auto';
  const voiceGenderLabel = selectedGender === 'FEMALE' ? 'Female' : 'Male';
  const hasStudioOutput = Boolean(isGenerating || generatedVideoUrl || draftScript || activeKitScript);

  return (
    <div className="min-h-screen bg-[#0B0F0D] text-[#F2F7F3]">
      {/* Clean Single-Row Top Bar */}
      <header className="border-b border-white/[0.07] bg-[#0B0F0D]/90 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-6">
          <span className="text-base sm:text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0">
            RS Movie Spot
          </span>
          <button
            type="button"
            onClick={() => setShowAndroidModal(true)}
            className="px-3.5 py-2 rounded-xl bg-[#151C18] border border-white/10 text-xs font-medium text-neutral-200 hover:border-[#39FF14]/60 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer min-h-[38px]"
          >
            Android App &amp; APK
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-5 sm:py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
          {/* Left Column: Clean Creator Studio */}
          <section className="lg:col-span-6 flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white text-balance">
                AI Video Studio
              </h1>
              <p className="text-sm text-neutral-400 leading-relaxed">
                Pick a mode, drop a topic or ready script, and render Shorts or YouTube videos.
              </p>
            </div>

            {/* Content Mode: Clean Wrapping Buttons (No cut-off horizontal strip) */}
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-neutral-300">Content Mode</span>
              <div className="flex flex-wrap gap-2">
                {CONTENT_MODES.map((mode) => {
                  const selected = contentMode === mode.value;
                  return (
                    <button
                      key={mode.value}
                      type="button"
                      onClick={() => onContentModeSelected(mode.value)}
                      disabled={busy}
                      className={`min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer border ${
                        selected
                          ? 'bg-[#39FF14]/15 border-[#39FF14]/75 text-[#39FF14]'
                          : 'bg-[#131916] border-white/[0.08] text-neutral-200 hover:border-white/25'
                      } disabled:opacity-50`}
                    >
                      {mode.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Script & Topic Editor Card */}
            <div className="rounded-2xl bg-[#121714] border border-white/[0.08] p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[#0B0F0D] border border-white/[0.06] flex-1 min-w-[220px]">
                  {INPUT_MODES.map((mode) => {
                    const active = inputMode === mode.value;
                    return (
                      <button
                        key={mode.value}
                        type="button"
                        onClick={() => onInputModeSelected(mode.value)}
                        disabled={busy}
                        className={`min-h-[36px] px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                          active
                            ? 'bg-[#1D2721] text-[#39FF14] shadow-sm'
                            : 'text-neutral-400 hover:text-white'
                        } disabled:opacity-50`}
                      >
                        {mode.label}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={loadTrendingTopics}
                  disabled={isLoadingTrending || isGenerating}
                  className="min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-semibold text-[#39FF14] hover:bg-[#39FF14]/10 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
                >
                  {isLoadingTrending ? 'Loading…' : 'Trending Ideas'}
                </button>
              </div>

              {trendingTopics.length > 0 && (
                <div className="flex flex-col gap-2 pt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-neutral-400">
                      Tap a trending topic to load
                    </span>
                    <button
                      type="button"
                      onClick={() => setTrendingTopics([])}
                      className="text-[11px] text-neutral-400 hover:text-white cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {trendingTopics.map((idea) => (
                      <button
                        key={idea}
                        type="button"
                        onClick={() => onTopicSelectedFromTrending(idea)}
                        disabled={busy}
                        title={idea}
                        className={`max-w-full truncate px-3 py-1.5 rounded-lg text-xs border transition-colors cursor-pointer ${
                          topic === idea
                            ? 'bg-[#39FF14]/15 border-[#39FF14]/70 text-[#39FF14]'
                            : 'bg-[#0B0F0D] border-white/[0.08] text-neutral-300 hover:border-white/25'
                        }`}
                      >
                        {idea}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <textarea
                id="topic-input"
                value={topic}
                onChange={(e) => onTopicChanged(e.target.value)}
                disabled={busy}
                placeholder={inputHint}
                rows={5}
                className="w-full rounded-xl bg-[#0B0F0D]/80 border border-white/[0.08] focus:border-[#39FF14]/70 focus:outline-none p-3.5 text-[15px] leading-relaxed text-white placeholder-neutral-500 disabled:opacity-60 resize-y min-h-[140px]"
              />

              <p className="text-xs text-neutral-400 leading-relaxed">{inputHint}</p>
            </div>

            {/* Clean Format, Style & Language Controls */}
            <div className="rounded-2xl bg-[#121714] border border-white/[0.08] p-4 flex flex-col gap-4">
              {/* Format Segmented Control */}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-neutral-300">Video Format</span>
                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[#0B0F0D] border border-white/[0.06]">
                  <button
                    type="button"
                    onClick={() => {
                      setIsShorts(true);
                      setDraftScript(null);
                    }}
                    disabled={busy}
                    className={`min-h-[40px] rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                      isShorts ? 'bg-[#1D2721] text-[#39FF14]' : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    Shorts · 9:16
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsShorts(false);
                      setDraftScript(null);
                    }}
                    disabled={busy}
                    className={`min-h-[40px] rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                      !isShorts ? 'bg-[#1D2721] text-[#39FF14]' : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    YouTube · 16:9
                  </button>
                </div>
              </div>

              {/* Clean Dropdowns for Visual Style & Language (No clipped scrollers) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-neutral-300">Visual Style</span>
                  <select
                    value={selectedVisualStyle}
                    disabled={busy}
                    onChange={(e) => {
                      setSelectedVisualStyle(e.target.value as VisualStyleMode);
                      setDraftScript(null);
                    }}
                    className="min-h-[44px] w-full rounded-xl bg-[#0B0F0D] border border-white/[0.08] focus:border-[#39FF14]/70 focus:outline-none px-3 text-sm text-white disabled:opacity-50"
                  >
                    {VISUAL_STYLE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value} className="bg-[#121714] text-white">
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-neutral-300">Language</span>
                  <select
                    value={selectedLanguage}
                    disabled={busy}
                    onChange={(e) => {
                      setSelectedLanguage(e.target.value as VideoLanguageKey);
                      setDraftScript(null);
                    }}
                    className="min-h-[44px] w-full rounded-xl bg-[#0B0F0D] border border-white/[0.08] focus:border-[#39FF14]/70 focus:outline-none px-3 text-sm text-white disabled:opacity-50"
                  >
                    {VIDEO_LANGUAGE_OPTIONS.map((lang) => (
                      <option key={lang.value} value={lang.value} className="bg-[#121714] text-white">
                        {lang.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* Collapsible Audio & Voice Drawer */}
              <div className="border-t border-white/[0.06] pt-3 flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => setShowAudioSettings((v) => !v)}
                  className="w-full min-h-[40px] flex items-center justify-between gap-2 text-left cursor-pointer"
                >
                  <span className="text-xs font-semibold text-neutral-200">Voice &amp; Background Music</span>
                  <span className="text-xs text-neutral-400 truncate">
                    {voiceGenderLabel} · {voiceToneLabel} · {selectedBgmFile ? 'Custom Audio' : 'Built-in BGM'}{' '}
                    {showAudioSettings ? '▲' : '▼'}
                  </span>
                </button>

                {showAudioSettings && (
                  <div className="flex flex-col gap-3 pt-1">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs text-neutral-400">Voice</span>
                        <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#0B0F0D] border border-white/[0.06]">
                          {VOICE_GENDERS.map((g) => (
                            <button
                              key={g.value}
                              type="button"
                              onClick={() => {
                                setSelectedGender(g.value);
                                setDraftScript(null);
                              }}
                              disabled={busy}
                              className={`min-h-[38px] rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                                selectedGender === g.value
                                  ? 'bg-[#1D2721] text-[#39FF14]'
                                  : 'text-neutral-400 hover:text-white'
                              }`}
                            >
                              {g.value === 'MALE' ? 'Male' : 'Female'}
                            </button>
                          ))}
                        </div>
                      </div>

                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs text-neutral-400">Voice Tone</span>
                        <select
                          value={selectedVoiceTone}
                          disabled={busy}
                          onChange={(e) => {
                            setSelectedVoiceTone(e.target.value as VoiceTone);
                            setDraftScript(null);
                          }}
                          className="min-h-[44px] w-full rounded-xl bg-[#0B0F0D] border border-white/[0.08] focus:border-[#39FF14]/70 focus:outline-none px-3 text-sm text-white disabled:opacity-50"
                        >
                          {VOICE_TONES.map((tone) => (
                            <option key={tone.value} value={tone.value} className="bg-[#121714] text-white">
                              {tone.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        ref={bgmInputRef}
                        type="file"
                        accept="audio/*"
                        onChange={onBgmFileChange}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => bgmInputRef.current?.click()}
                        disabled={busy}
                        className="flex-1 min-h-[42px] px-4 rounded-xl bg-[#0B0F0D] border border-white/[0.08] text-xs font-medium text-neutral-200 truncate hover:border-white/25 disabled:opacity-50 cursor-pointer text-left"
                      >
                        Music: {selectedBgmName}
                      </button>
                      {selectedBgmFile && (
                        <button
                          type="button"
                          onClick={clearBgm}
                          disabled={busy}
                          className="min-h-[42px] px-4 rounded-xl border border-white/15 text-xs font-medium text-neutral-300 hover:text-white cursor-pointer shrink-0"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Primary Actions */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={previewScript}
                disabled={busy}
                className="min-h-[48px] rounded-xl bg-[#151C18] border border-white/12 text-white text-sm font-semibold hover:border-white/30 disabled:opacity-50 cursor-pointer transition-colors"
              >
                {isPreviewingScript ? 'Writing…' : draftScript ? 'Regenerate' : 'Preview Scenes'}
              </button>
              <button
                type="button"
                onClick={startGeneratingVideo}
                disabled={busy}
                className="min-h-[48px] rounded-xl bg-[#39FF14] text-black text-sm font-bold hover:brightness-95 disabled:bg-[#222B25] disabled:text-neutral-400 cursor-pointer transition-all"
              >
                {isGenerating ? 'Rendering…' : 'Generate Video'}
              </button>
            </div>

            {statusMessage && (
              <div
                className={`rounded-xl px-4 py-3 text-sm border ${
                  isStatusError
                    ? 'bg-red-950/35 border-red-500/35 text-red-300'
                    : 'bg-[#39FF14]/10 border-[#39FF14]/35 text-[#39FF14]'
                }`}
              >
                {statusMessage}
              </div>
            )}
          </section>

          {/* Right Column: 3D Character Stage, Render Output & Scene Storyboard */}
          <section className="lg:col-span-6 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[#121714] border border-white/[0.08]">
              <button
                type="button"
                onClick={() => setRightView('stage3d')}
                className={`min-h-[40px] rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  rightView === 'stage3d' ? 'bg-[#1D2721] text-[#39FF14]' : 'text-neutral-400 hover:text-white'
                }`}
              >
                3D Character Stage ({draftScript?.slabs.length ?? DEFAULT_DEMO_SLABS.length} Scenes)
              </button>
              <button
                type="button"
                onClick={() => setRightView('output')}
                className={`min-h-[40px] rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  rightView === 'output' ? 'bg-[#1D2721] text-[#39FF14]' : 'text-neutral-400 hover:text-white'
                }`}
              >
                Scenes &amp; MP4 Output
              </button>
            </div>

            {rightView === 'stage3d' && (
              <ThreeCharacterStudio
                slabs={draftScript?.slabs ?? null}
                contentMode={contentMode}
                topic={topic}
                characterBible={draftScript?.character_bible ?? ''}
                isShorts={isShorts}
                onAttachCapturedClips={handleAttachCapturedClips}
              />
            )}

            {rightView === 'output' && !hasStudioOutput && (
              <div className="rounded-2xl bg-[#121714] border border-white/[0.08] p-6 flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <h2 className="text-base font-semibold text-white">Studio Output</h2>
                  <p className="text-sm text-neutral-400">
                    Your video preview, scene storyboard, and YouTube upload kit will appear here.
                  </p>
                </div>
                <div className="border-t border-white/[0.06] pt-4 flex flex-col gap-3 text-sm text-neutral-300">
                  <div className="flex items-start gap-3">
                    <span className="text-xs font-mono text-[#39FF14] pt-0.5 tabular-nums">01</span>
                    <span>Choose a Content Mode and write a topic or paste your exact script.</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="text-xs font-mono text-[#39FF14] pt-0.5 tabular-nums">02</span>
                    <span>Tap Preview Scenes or use the 3D Character Stage to record moving 3D clips for each scene.</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="text-xs font-mono text-[#39FF14] pt-0.5 tabular-nums">03</span>
                    <span>Generate HD MP4 with voiceover, subtitles, BGM ducking, and cover thumbnail.</span>
                  </div>
                </div>
              </div>
            )}

            {/* Render Progress */}
            {rightView === 'output' && isGenerating && (
              <div className="rounded-2xl bg-[#121714] border border-white/[0.08] p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-white flex-1">{progressText || 'Working…'}</span>
                  <span className="text-sm font-bold text-[#39FF14] tabular-nums">{progressPercentage}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-white/[0.08] overflow-hidden">
                  <div
                    className="h-full bg-[#39FF14] transition-all duration-300"
                    style={{ width: `${Math.max(0, Math.min(100, progressPercentage))}%` }}
                  />
                </div>
                <div>
                  <button
                    type="button"
                    onClick={cancelGeneratingVideo}
                    className="min-h-[38px] px-4 py-1.5 rounded-xl border border-red-500/35 text-red-300 text-xs font-medium hover:bg-red-950/30 cursor-pointer transition-colors"
                  >
                    Cancel Render
                  </button>
                </div>
              </div>
            )}

            {/* Video Result + Cover */}
            {rightView === 'output' && generatedVideoUrl && (
              <div className="rounded-2xl bg-[#121714] border border-white/[0.08] p-4 flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setShowVideoPlayer(true);
                      setTimeout(() => videoPlayerRef.current?.play().catch(() => {}), 50);
                    }}
                    className="min-h-[44px] rounded-xl bg-[#39FF14] text-black text-sm font-bold hover:brightness-95 cursor-pointer transition-all"
                  >
                    Play Video
                  </button>
                  <button
                    type="button"
                    onClick={() => shareOrDownloadVideo(generatedVideoUrl)}
                    className="min-h-[44px] rounded-xl bg-[#18211C] border border-white/15 text-white text-sm font-semibold hover:border-[#39FF14]/60 cursor-pointer transition-colors"
                  >
                    Save / Share MP4
                  </button>
                </div>

                {showVideoPlayer && (
                  <div className="rounded-xl bg-black p-2 flex justify-center">
                    <video
                      ref={videoPlayerRef}
                      src={generatedVideoUrl}
                      controls
                      playsInline
                      className={isShorts ? 'max-h-[520px] w-auto rounded-lg bg-black' : 'w-full rounded-lg bg-black'}
                    />
                  </div>
                )}

                {generatedThumbnailUrl && (
                  <div className="border-t border-white/[0.06] pt-3 flex items-center justify-between gap-3">
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold text-white">Cover Thumbnail Ready</span>
                      <span className="text-xs text-neutral-400">Preview or download JPG cover</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowCoverModal(true)}
                      className="min-h-[38px] px-4 py-1.5 rounded-xl bg-[#0B0F0D] border border-white/12 text-xs font-medium text-white hover:border-[#39FF14]/60 cursor-pointer shrink-0"
                    >
                      View Cover
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Standalone Cover if video URL absent */}
            {rightView === 'output' && !generatedVideoUrl && generatedThumbnailUrl && (
              <div className="rounded-2xl bg-[#121714] border border-white/[0.08] p-4 flex items-center justify-between gap-3">
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-white">Cover Thumbnail Ready</span>
                  <span className="text-xs text-neutral-400">Preview or download JPG cover</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCoverModal(true)}
                  className="min-h-[38px] px-4 py-1.5 rounded-xl bg-[#0B0F0D] border border-white/12 text-xs font-medium text-white hover:border-[#39FF14]/60 cursor-pointer shrink-0"
                >
                  View Cover
                </button>
              </div>
            )}

            {/* YouTube Upload Kit */}
            {rightView === 'output' &&
              activeKitScript &&
              (activeKitScript.youtube_title ||
                activeKitScript.youtube_description ||
                activeKitScript.youtube_hashtags ||
                activeKitScript.pinned_comment) && (
                <div className="rounded-2xl bg-[#121714] border border-white/[0.08] p-4 flex flex-col gap-2.5">
                  <span className="text-sm font-semibold text-white">YouTube Upload Kit</span>
                  {activeKitScript.youtube_title && (
                    <p className="text-xs text-neutral-200 leading-relaxed">
                      <span className="text-neutral-400">Title: </span>
                      {activeKitScript.youtube_title}
                    </p>
                  )}
                  {fullDescriptionWithTags && (
                    <p className="text-xs text-neutral-400 whitespace-pre-line line-clamp-4 leading-relaxed">
                      {fullDescriptionWithTags}
                    </p>
                  )}
                  {activeKitScript.pinned_comment && (
                    <p className="text-xs text-neutral-400 line-clamp-2">
                      <span className="text-neutral-500">Pinned: </span>
                      {activeKitScript.pinned_comment}
                    </p>
                  )}
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    {activeKitScript.youtube_title && (
                      <button
                        type="button"
                        onClick={() => copyToClipboard('YouTube Title', activeKitScript.youtube_title)}
                        className="min-h-[38px] rounded-xl bg-[#0B0F0D] border border-white/10 text-xs font-medium text-neutral-200 hover:border-[#39FF14]/60 cursor-pointer"
                      >
                        Copy Title
                      </button>
                    )}
                    {fullDescriptionWithTags && (
                      <button
                        type="button"
                        onClick={() => copyToClipboard('YouTube Description', fullDescriptionWithTags)}
                        className="min-h-[38px] rounded-xl bg-[#0B0F0D] border border-white/10 text-xs font-medium text-neutral-200 hover:border-[#39FF14]/60 cursor-pointer"
                      >
                        Copy Desc
                      </button>
                    )}
                    {activeKitScript.pinned_comment && (
                      <button
                        type="button"
                        onClick={() => copyToClipboard('Pinned Comment', activeKitScript.pinned_comment)}
                        className="min-h-[38px] rounded-xl bg-[#0B0F0D] border border-white/10 text-xs font-medium text-neutral-200 hover:border-[#39FF14]/60 cursor-pointer"
                      >
                        Copy Pin
                      </button>
                    )}
                  </div>
                </div>
              )}

            {/* Editable Scene Storyboard */}
            {rightView === 'output' && draftScript && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-white">Scene Storyboard</h2>
                  <span className="text-xs text-neutral-400 tabular-nums">
                    {draftScript.slabs.length} scenes · {draftScript.voice_name}
                  </span>
                </div>

                {draftScript.slabs.map((slab, index) => {
                  const custom1 = customSceneMedia[`${index}_1`];
                  const custom2 = customSceneMedia[`${index}_2`];
                  const isDualPanel = slab.layout_mode.toLowerCase() !== 'single';
                  return (
                    <div
                      key={`${slab.id}-${index}`}
                      className="rounded-2xl bg-[#121714] border border-white/[0.08] p-4 flex flex-col gap-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-neutral-400 tabular-nums">
                          Scene {String(index + 1).padStart(2, '0')} · {slab.voice_emotion} · {slab.sfx_cue}
                        </span>
                        {custom1 && (
                          <span className="text-xs font-medium text-[#39FF14]">
                            {custom1.isVideo ? 'Clip attached' : 'Photo attached'}
                          </span>
                        )}
                      </div>

                      {/* Custom Media Attachment Row */}
                      <div className="rounded-xl bg-[#0B0F0D] border border-white/[0.06] p-3 flex flex-col gap-2.5">
                        <div className="flex items-center gap-2.5">
                          {custom1 &&
                            (custom1.isVideo ? (
                              <video
                                src={custom1.previewUrl}
                                muted
                                loop
                                playsInline
                                autoPlay
                                className="w-11 h-11 rounded-lg object-cover bg-black shrink-0"
                              />
                            ) : (
                              <img
                                src={custom1.previewUrl}
                                alt={`Scene ${index + 1} custom`}
                                className="w-11 h-11 rounded-lg object-cover bg-black shrink-0"
                              />
                            ))}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-white truncate">
                              {custom1 ? custom1.name : 'Custom Clip or Photo (optional)'}
                            </p>
                            <p className="text-[11px] text-neutral-400 truncate">
                              {custom1 ? 'Overrides AI visual for this scene' : 'Use your own video clip or image'}
                            </p>
                          </div>
                          <label
                            className={`min-h-[36px] px-3 py-1.5 rounded-lg bg-[#161E19] border border-white/10 text-xs font-medium text-white flex items-center cursor-pointer hover:border-[#39FF14]/60 shrink-0 ${
                              isGenerating ? 'opacity-50 pointer-events-none' : ''
                            }`}
                          >
                            {custom1 ? 'Change' : 'Attach'}
                            <input
                              type="file"
                              accept="image/*,video/*"
                              disabled={isGenerating}
                              onChange={(e) => onSceneMediaChange(index, 1, e)}
                              className="hidden"
                            />
                          </label>
                          {custom1 && (
                            <button
                              type="button"
                              onClick={() => removeSceneMedia(index, 1)}
                              disabled={isGenerating}
                              className="min-h-[36px] px-2.5 py-1.5 rounded-lg border border-red-500/30 text-xs text-red-300 hover:bg-red-950/30 cursor-pointer shrink-0"
                            >
                              Remove
                            </button>
                          )}
                        </div>

                        {isDualPanel && !custom1?.isVideo && (
                          <div className="flex items-center gap-2.5 pt-2.5 border-t border-white/[0.06]">
                            {custom2 && (
                              <img
                                src={custom2.previewUrl}
                                alt={`Scene ${index + 1} panel 2`}
                                className="w-9 h-9 rounded-md object-cover bg-black shrink-0"
                              />
                            )}
                            <span className="flex-1 min-w-0 text-xs text-neutral-400 truncate">
                              {custom2 ? `Panel 2: ${custom2.name}` : 'Panel 2 Custom Photo (optional)'}
                            </span>
                            <label
                              className={`min-h-[34px] px-3 py-1 rounded-lg bg-[#161E19] border border-white/10 text-xs font-medium text-neutral-200 flex items-center cursor-pointer hover:border-[#39FF14]/60 shrink-0 ${
                                isGenerating ? 'opacity-50 pointer-events-none' : ''
                              }`}
                            >
                              {custom2 ? 'Change' : '+ Panel 2'}
                              <input
                                type="file"
                                accept="image/*"
                                disabled={isGenerating}
                                onChange={(e) => onSceneMediaChange(index, 2, e)}
                                className="hidden"
                              />
                            </label>
                            {custom2 && (
                              <button
                                type="button"
                                onClick={() => removeSceneMedia(index, 2)}
                                disabled={isGenerating}
                                className="min-h-[34px] px-2.5 py-1 rounded-lg border border-red-500/30 text-xs text-red-300 cursor-pointer shrink-0"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Segmented Controls for Source & Layout */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-[#0B0F0D] border border-white/[0.06]">
                          {VISUAL_SOURCE_OPTIONS.map((opt) => {
                            const active = slab.visual_source.toLowerCase() === opt.key;
                            return (
                              <button
                                key={opt.key}
                                type="button"
                                onClick={() => onSlabVisualSourceChanged(index, opt.key)}
                                disabled={isGenerating}
                                className={`min-h-[34px] rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                                  active ? 'bg-[#1D2721] text-[#39FF14]' : 'text-neutral-400 hover:text-white'
                                }`}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>

                        <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[#0B0F0D] border border-white/[0.06]">
                          {LAYOUT_MODE_OPTIONS.map((opt) => {
                            const active = slab.layout_mode.toLowerCase() === opt.key;
                            return (
                              <button
                                key={opt.key}
                                type="button"
                                onClick={() => onSlabLayoutModeChanged(index, opt.key)}
                                disabled={isGenerating}
                                className={`min-h-[34px] rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                                  active ? 'bg-[#1D2721] text-[#39FF14]' : 'text-neutral-400 hover:text-white'
                                }`}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {!custom1 && slab.visual_source.toLowerCase() !== 'ai_generated' && (
                        <label className="flex flex-col gap-1">
                          <span className="text-[11px] text-neutral-400">Media search query</span>
                          <input
                            type="text"
                            value={slab.real_photo_query}
                            onChange={(e) =>
                              updateSlab(index, (s) => ({ ...s, real_photo_query: e.target.value }))
                            }
                            disabled={isGenerating}
                            className="w-full rounded-xl bg-[#0B0F0D] border border-white/[0.08] focus:border-[#39FF14]/70 focus:outline-none px-3 py-2 text-xs text-white"
                          />
                        </label>
                      )}

                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-neutral-400">Badge text (optional)</span>
                        <input
                          type="text"
                          value={slab.stat_badge}
                          onChange={(e) => updateSlab(index, (s) => ({ ...s, stat_badge: e.target.value }))}
                          disabled={isGenerating}
                          className="w-full rounded-xl bg-[#0B0F0D] border border-white/[0.08] focus:border-[#39FF14]/70 focus:outline-none px-3 py-2 text-xs text-white"
                        />
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-neutral-400">Voiceover</span>
                        <textarea
                          value={slab.voiceover_text}
                          onChange={(e) => updateSlab(index, (s) => ({ ...s, voiceover_text: e.target.value }))}
                          disabled={isGenerating}
                          rows={2}
                          className="w-full rounded-xl bg-[#0B0F0D] border border-white/[0.08] focus:border-[#39FF14]/70 focus:outline-none px-3 py-2 text-xs text-white resize-y"
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Cover Thumbnail Modal */}
      {showCoverModal && generatedThumbnailUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowCoverModal(false)}
        >
          <div
            className="max-w-lg w-full rounded-2xl bg-[#121714] border border-white/12 p-4 flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white">Cover Thumbnail</span>
              <button
                type="button"
                onClick={() => setShowCoverModal(false)}
                className="text-xs text-neutral-400 hover:text-white cursor-pointer px-2 py-1"
              >
                Close
              </button>
            </div>
            <img
              src={generatedThumbnailUrl}
              alt="Video Cover Thumbnail"
              className="w-full max-h-[70vh] object-contain rounded-xl bg-black"
            />
            <a
              href={`${generatedThumbnailUrl}?download=1`}
              download="RSMovieSpot_Cover.jpg"
              className="w-full min-h-[44px] flex items-center justify-center rounded-xl bg-[#39FF14] text-black text-sm font-bold hover:brightness-95"
            >
              Download Cover JPG
            </a>
          </div>
        </div>
      )}

      {/* Android App & APK Download Modal */}
      {showAndroidModal && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowAndroidModal(false)}
        >
          <div
            className="max-w-md w-full rounded-2xl bg-[#121714] border border-white/12 p-5 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-white">Android App &amp; APK</h2>
              <button
                type="button"
                onClick={() => setShowAndroidModal(false)}
                className="text-xs text-neutral-400 hover:text-white cursor-pointer px-2 py-1"
              >
                Close
              </button>
            </div>

            <p className="text-xs text-neutral-300 leading-relaxed">
              The updated Android Studio &amp; Jetpack Compose source project includes the cleaned-up UI, Content Modes,
              custom per-scene clip/photo picker, and smooth video renderer.
            </p>

            <a
              href="/downloads/RSMovieSpot-android-project.zip"
              download="RSMovieSpot-android-project.zip"
              className="w-full min-h-[46px] flex items-center justify-center rounded-xl bg-[#39FF14] text-black text-sm font-bold hover:brightness-95"
            >
              Download Android Project (.zip)
            </a>

            <div className="rounded-xl bg-[#0B0F0D] border border-white/[0.06] p-3.5 flex flex-col gap-2 text-xs text-neutral-300 leading-relaxed">
              <span className="font-semibold text-white">How to get installable APK:</span>
              <span>
                1. Push this project to GitHub and open the <strong>Actions</strong> tab — the included{' '}
                <code className="text-[#39FF14]">Android CI Build</code> workflow builds and gives a downloadable{' '}
                <strong>RSMovieSpot-debug-apk</strong> file automatically.
              </span>
              <span>
                2. Or open the downloaded ZIP in Android Studio and run <code className="text-[#39FF14]">Build APK</code>.
              </span>
              <span>
                3. For instant use on your phone right now without installing an APK, open Chrome menu and tap{' '}
                <strong>Add to Home screen</strong>.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Subtle Toast */}
      {toastText && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-[#18211C] border border-[#39FF14]/60 text-[#39FF14] text-xs font-semibold shadow-lg">
          {toastText}
        </div>
      )}
    </div>
  );
}

export default App;
