import React, { useEffect, useRef, useState } from 'react';
import {
  INPUT_MODES,
  VIDEO_LANGUAGE_OPTIONS,
  VISUAL_STYLE_OPTIONS,
  VOICE_GENDERS,
  VOICE_TONES,
  type InputMode,
  type RenderStatusResponse,
  type VideoLanguageKey,
  type VideoScriptResponse,
  type VisualStyleMode,
  type VoiceGender,
  type VoiceTone,
} from './types/video';

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
  const [inputMode, setInputMode] = useState<InputMode>('AUTO');
  const [isShorts, setIsShorts] = useState(true);
  const [selectedLanguage, setSelectedLanguage] = useState<VideoLanguageKey>('AUTO');
  const [selectedGender, setSelectedGender] = useState<VoiceGender>('MALE');
  const [selectedVoiceTone, setSelectedVoiceTone] = useState<VoiceTone>('AUTO');
  const [selectedVisualStyle, setSelectedVisualStyle] = useState<VisualStyleMode>('AUTO');

  const [selectedBgmFile, setSelectedBgmFile] = useState<File | null>(null);
  const [selectedBgmName, setSelectedBgmName] = useState('Built-in Cinematic BGM');

  const [isLoadingTrending, setIsLoadingTrending] = useState(false);
  const [trendingTopics, setTrendingTopics] = useState<string[]>([]);

  const [isPreviewingScript, setIsPreviewingScript] = useState(false);
  const [draftScript, setDraftScript] = useState<VideoScriptResponse | null>(null);

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
  const [toastText, setToastText] = useState<string | null>(null);

  const bgmInputRef = useRef<HTMLInputElement | null>(null);
  const videoPlayerRef = useRef<HTMLVideoElement | null>(null);

  const busy = isGenerating || isPreviewingScript;

  useEffect(() => {
    if (!toastText) return;
    const t = setTimeout(() => setToastText(null), 2200);
    return () => clearTimeout(t);
  }, [toastText]);

  useEffect(() => {
    if (!activeJobId || !isGenerating) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/render/status/${activeJobId}`);
        if (!res.ok) return;
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

  const showToast = (msg: string) => setToastText(msg);

  const onTopicChanged = (val: string) => {
    setTopic(val);
    setDraftScript(null);
  };

  const onInputModeSelected = (mode: InputMode) => {
    setInputMode(mode);
    setDraftScript(null);
  };

  const onTopicSelectedFromTrending = (idea: string) => {
    setTopic(idea);
    setInputMode('AI_PROMPT');
    setDraftScript(null);
    setStatusMessage('');
  };

  const loadTrendingTopics = async () => {
    if (isLoadingTrending || isGenerating) return;
    setIsLoadingTrending(true);
    try {
      const res = await fetch('/api/trending');
      const data = (await res.json()) as { topics?: string[]; error?: string };
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

  const previewScript = async () => {
    if (busy) return;
    const clean = topic.trim();
    if (!clean) {
      setStatusMessage('Enter a topic or script before previewing.');
      return;
    }

    setIsPreviewingScript(true);
    setStatusMessage('');
    setDraftScript(null);
    try {
      const res = await fetch('/api/script/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: clean,
          isShorts,
          language: selectedLanguage,
          voiceGender: selectedGender,
          inputMode,
          voiceTone: selectedVoiceTone,
          visualStyle: selectedVisualStyle,
        }),
      });
      const data = (await res.json()) as { script?: VideoScriptResponse; error?: string };
      if (!res.ok || !data.script) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setDraftScript(data.script);
    } catch (err) {
      setStatusMessage(`Script error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsPreviewingScript(false);
    }
  };

  const startGeneratingVideo = async () => {
    if (busy) return;
    const clean = topic.trim();
    if (!clean) {
      setStatusMessage('Enter a topic or script before generating a video.');
      return;
    }

    setIsGenerating(true);
    setProgressText('Starting video generation…');
    setProgressPercentage(0);
    setStatusMessage('');
    setGeneratedVideoUrl(null);
    setGeneratedThumbnailUrl(null);
    setCompletedScript(null);
    setShowVideoPlayer(false);

    try {
      const form = new FormData();
      form.append('topic', clean);
      form.append('isShorts', String(isShorts));
      form.append('language', selectedLanguage);
      form.append('voiceGender', selectedGender);
      form.append('voiceTone', selectedVoiceTone);
      form.append('visualStyle', selectedVisualStyle);
      form.append('inputMode', inputMode);
      if (draftScript) {
        form.append('preGeneratedScript', JSON.stringify(draftScript));
      }
      if (selectedBgmFile) {
        form.append('bgmFile', selectedBgmFile);
      }

      const res = await fetch('/api/render/start', {
        method: 'POST',
        body: form,
      });
      const data = (await res.json()) as { jobId?: string; error?: string };
      if (!res.ok || !data.jobId) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setActiveJobId(data.jobId);
    } catch (err) {
      setIsGenerating(false);
      setStatusMessage(`Generation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
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

  const updateSlab = (index: number, updater: (slab: VideoScriptResponse['slabs'][number]) => VideoScriptResponse['slabs'][number]) => {
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

  const inputHint = INPUT_MODES.find((m) => m.value === inputMode)?.hint ?? '';
  const activeKitScript = completedScript ?? draftScript;
  const fullDescriptionWithTags = activeKitScript
    ? [activeKitScript.youtube_description.trim(), activeKitScript.youtube_hashtags.trim()]
        .filter(Boolean)
        .join('\n\n')
    : '';

  const isStatusError =
    statusMessage.toLowerCase().includes('failed') || statusMessage.toLowerCase().includes('error');

  const chipClass = (selected: boolean, disabled = false) =>
    [
      'px-3.5 py-2 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer',
      selected
        ? 'bg-[#1B3A18] border-[#39FF14] text-[#39FF14]'
        : 'bg-[#141A15] border-[#285C22] text-white hover:border-[#39FF14]/70',
      disabled ? 'opacity-50 cursor-not-allowed' : '',
    ].join(' ');

  return (
    <div className="min-h-screen bg-[#0A0E0B] text-white">
      <div className="max-w-3xl mx-auto px-5 py-6 flex flex-col gap-3.5">
        {/* Header */}
        <header className="flex flex-col gap-1.5 pb-1">
          <span className="text-[#39FF14] text-[13px] font-bold tracking-[1.2px] uppercase">
            RS MOVIE SPOT
          </span>
          <h1 className="text-[28px] leading-tight font-extrabold text-white">
            AI Video Generator
          </h1>
          <p className="text-[13px] text-[#A0ACA2] leading-relaxed">
            Paste a ready script (Exact Script) or write a topic/director prompt (AI Prompt). Movie clips, memes &amp; photos are fetched automatically.
          </p>
        </header>

        {/* Topic or Script + Trending Ideas */}
        <div className="flex items-center justify-between gap-3 pt-1">
          <label htmlFor="topic-input" className="text-[15px] font-semibold text-white">
            Topic or Script
          </label>
          <button
            type="button"
            onClick={loadTrendingTopics}
            disabled={isLoadingTrending || isGenerating}
            className="px-4 py-1.5 rounded-[20px] border border-[#285C22] text-[#39FF14] text-xs font-semibold hover:border-[#39FF14] disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
          >
            {isLoadingTrending ? 'Loading…' : 'Trending Ideas'}
          </button>
        </div>

        {trendingTopics.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1 chip-scroll">
            {trendingTopics.map((idea) => (
              <button
                key={idea}
                type="button"
                onClick={() => onTopicSelectedFromTrending(idea)}
                disabled={busy}
                title={idea}
                className={`${chipClass(topic === idea, busy)} max-w-[260px] truncate`}
              >
                {idea}
              </button>
            ))}
          </div>
        )}

        {/* InputMode selector */}
        <div className="flex items-center gap-2 flex-wrap">
          {INPUT_MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              onClick={() => onInputModeSelected(mode.value)}
              disabled={busy}
              className={chipClass(inputMode === mode.value, busy)}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {/* Topic/Script Textarea */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-[#A0ACA2]">{inputHint}</span>
          <textarea
            id="topic-input"
            value={topic}
            onChange={(e) => onTopicChanged(e.target.value)}
            disabled={busy}
            placeholder={inputHint}
            rows={5}
            className="w-full rounded-xl bg-transparent border border-[#285C22] focus:border-[#39FF14] focus:outline-none p-3.5 text-sm text-white placeholder-[#A0ACA2]/60 disabled:opacity-60 resize-y min-h-[130px]"
          />
        </div>

        {/* Video Format */}
        <div className="flex flex-col gap-2">
          <span className="text-[15px] font-semibold text-white">Choose video format</span>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                setIsShorts(true);
                setDraftScript(null);
              }}
              disabled={busy}
              className={chipClass(isShorts, busy)}
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
              className={chipClass(!isShorts, busy)}
            >
              YouTube · 16:9
            </button>
          </div>
        </div>

        {/* Visual Style / 3D Motion Mode */}
        <div className="flex flex-col gap-2">
          <span className="text-[15px] font-semibold text-white">Visual Style &amp; 3D Motion</span>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 chip-scroll">
            {VISUAL_STYLE_OPTIONS.map((styleOpt) => (
              <button
                key={styleOpt.value}
                type="button"
                onClick={() => {
                  setSelectedVisualStyle(styleOpt.value);
                  setDraftScript(null);
                }}
                disabled={busy}
                className={chipClass(selectedVisualStyle === styleOpt.value, busy)}
              >
                {styleOpt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Language & Voice */}
        <div className="flex flex-col gap-2">
          <span className="text-[15px] font-semibold text-white">Language &amp; Voice</span>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 chip-scroll">
            {VIDEO_LANGUAGE_OPTIONS.map((lang) => (
              <button
                key={lang.value}
                type="button"
                onClick={() => {
                  setSelectedLanguage(lang.value);
                  setDraftScript(null);
                }}
                disabled={busy}
                className={chipClass(selectedLanguage === lang.value, busy)}
              >
                {lang.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2.5">
            {VOICE_GENDERS.map((g) => (
              <button
                key={g.value}
                type="button"
                onClick={() => {
                  setSelectedGender(g.value);
                  setDraftScript(null);
                }}
                disabled={busy}
                className={chipClass(selectedGender === g.value, busy)}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        {/* Voice Tone & Studio Polish */}
        <div className="flex flex-col gap-2">
          <span className="text-[15px] font-semibold text-white">Voice Tone &amp; Studio Polish</span>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 chip-scroll">
            {VOICE_TONES.map((tone) => (
              <button
                key={tone.value}
                type="button"
                onClick={() => {
                  setSelectedVoiceTone(tone.value);
                  setDraftScript(null);
                }}
                disabled={busy}
                className={chipClass(selectedVoiceTone === tone.value, busy)}
              >
                {tone.label}
              </button>
            ))}
          </div>
        </div>

        {/* Background music (optional) */}
        <div className="flex flex-col gap-2">
          <span className="text-[15px] font-semibold text-white">Background music (optional)</span>
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
              className="flex-1 px-4 py-2.5 rounded-[24px] border border-[#285C22] text-[#39FF14] text-sm font-medium truncate hover:border-[#39FF14] disabled:opacity-50 cursor-pointer transition-colors"
            >
              {selectedBgmName}
            </button>
            {selectedBgmFile && (
              <button
                type="button"
                onClick={clearBgm}
                disabled={busy}
                className="px-5 py-2.5 rounded-[24px] border border-[#285C22] text-white text-sm font-medium hover:border-[#39FF14] disabled:opacity-50 cursor-pointer shrink-0 transition-colors"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Primary Action Buttons */}
        <div className="flex items-center gap-2.5 pt-1">
          <button
            type="button"
            onClick={previewScript}
            disabled={busy}
            className="flex-1 h-[50px] rounded-[25px] border border-[#285C22] text-[#39FF14] text-sm font-semibold hover:border-[#39FF14] disabled:opacity-50 cursor-pointer transition-colors"
          >
            {isPreviewingScript ? 'Writing…' : draftScript ? 'Regenerate' : 'Preview Script'}
          </button>
          <button
            type="button"
            onClick={startGeneratingVideo}
            disabled={busy}
            className="flex-1 h-[50px] rounded-[25px] bg-[#39FF14] text-black text-sm font-bold hover:brightness-95 disabled:bg-[#233024] disabled:text-[#A0ACA2] cursor-pointer transition-all"
          >
            {isGenerating ? 'Rendering…' : 'Generate Video'}
          </button>
        </div>

        {/* Render Progress Card */}
        {isGenerating && (
          <div className="rounded-[14px] bg-[#141A15] p-4 flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-white flex-1">{progressText || 'Working…'}</span>
              <span className="text-sm font-bold text-[#39FF14] tabular-nums">
                {progressPercentage}%
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-[#263327] overflow-hidden">
              <div
                className="h-full bg-[#39FF14] transition-all duration-300"
                style={{ width: `${Math.max(0, Math.min(100, progressPercentage))}%` }}
              />
            </div>
            <div>
              <button
                type="button"
                onClick={cancelGeneratingVideo}
                className="px-4 py-1.5 rounded-[20px] border border-[#7A3A3A] text-[#FF8A8A] text-xs font-medium hover:bg-[#7A3A3A]/20 cursor-pointer transition-colors"
              >
                Cancel Render
              </button>
            </div>
          </div>
        )}

        {/* Status / Error Message */}
        {statusMessage && (
          <p className={`text-sm ${isStatusError ? 'text-[#FF6B6B]' : 'text-[#39FF14]'}`}>
            {statusMessage}
          </p>
        )}

        {/* Generated Video Controls + Player */}
        {generatedVideoUrl && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setShowVideoPlayer(true);
                  setTimeout(() => videoPlayerRef.current?.play().catch(() => {}), 50);
                }}
                className="flex-1 py-2.5 rounded-[24px] bg-[#39FF14] text-black text-sm font-bold hover:brightness-95 cursor-pointer transition-all"
              >
                Play Video
              </button>
              <button
                type="button"
                onClick={() => shareOrDownloadVideo(generatedVideoUrl)}
                className="flex-1 py-2.5 rounded-[24px] border border-[#39FF14] text-[#39FF14] text-sm font-semibold hover:bg-[#1B3A18] cursor-pointer transition-colors"
              >
                Share / Download Video
              </button>
            </div>

            {showVideoPlayer && (
              <div className="rounded-[14px] bg-[#141A15] p-3 flex justify-center">
                <video
                  ref={videoPlayerRef}
                  src={generatedVideoUrl}
                  controls
                  playsInline
                  className={
                    isShorts
                      ? 'max-h-[540px] w-auto rounded-lg bg-black'
                      : 'w-full rounded-lg bg-black'
                  }
                />
              </div>
            )}
          </div>
        )}

        {/* Cover Thumbnail Ready Card */}
        {generatedThumbnailUrl && (
          <div className="rounded-[12px] bg-[#141A15] p-3 flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-[13px] font-bold text-[#39FF14]">Cover Thumbnail Ready</span>
              <span className="text-[11px] text-[#A0ACA2]">Click View Cover to preview or download</span>
            </div>
            <button
              type="button"
              onClick={() => setShowCoverModal(true)}
              className="px-4 py-1.5 rounded-[18px] border border-[#285C22] text-[#39FF14] text-xs font-medium hover:border-[#39FF14] cursor-pointer shrink-0 transition-colors"
            >
              View Cover
            </button>
          </div>
        )}

        {/* YouTube Upload Kit Card */}
        {activeKitScript &&
          (activeKitScript.youtube_title ||
            activeKitScript.youtube_description ||
            activeKitScript.youtube_hashtags ||
            activeKitScript.pinned_comment) && (
            <div className="rounded-[14px] bg-[#141A15] p-3.5 flex flex-col gap-2">
              <span className="text-sm font-bold text-[#39FF14]">YouTube Upload Kit</span>
              {activeKitScript.youtube_title && (
                <p className="text-xs text-white">Title: {activeKitScript.youtube_title}</p>
              )}
              {fullDescriptionWithTags && (
                <p className="text-[11px] text-[#A0ACA2] whitespace-pre-line line-clamp-5">
                  Description: {fullDescriptionWithTags}
                </p>
              )}
              {activeKitScript.pinned_comment && (
                <p className="text-[11px] text-[#A0ACA2] line-clamp-2">
                  Pinned Comment: {activeKitScript.pinned_comment}
                </p>
              )}
              <div className="flex items-center gap-2 pt-1">
                {activeKitScript.youtube_title && (
                  <button
                    type="button"
                    onClick={() => copyToClipboard('YouTube Title', activeKitScript.youtube_title)}
                    className="flex-1 py-1.5 rounded-[18px] border border-[#285C22] text-[#39FF14] text-[11px] font-medium hover:border-[#39FF14] cursor-pointer transition-colors"
                  >
                    Copy Title
                  </button>
                )}
                {fullDescriptionWithTags && (
                  <button
                    type="button"
                    onClick={() => copyToClipboard('YouTube Description', fullDescriptionWithTags)}
                    className="flex-1 py-1.5 rounded-[18px] border border-[#285C22] text-[#39FF14] text-[11px] font-medium hover:border-[#39FF14] cursor-pointer transition-colors"
                  >
                    Copy Desc
                  </button>
                )}
                {activeKitScript.pinned_comment && (
                  <button
                    type="button"
                    onClick={() => copyToClipboard('Pinned Comment', activeKitScript.pinned_comment)}
                    className="flex-1 py-1.5 rounded-[18px] border border-[#285C22] text-[#39FF14] text-[11px] font-medium hover:border-[#39FF14] cursor-pointer transition-colors"
                  >
                    Copy Pin
                  </button>
                )}
              </div>
            </div>
          )}

        {/* Script Preview Cards */}
        {draftScript && (
          <div className="flex flex-col gap-3 pt-1">
            <span className="text-sm font-bold text-[#39FF14]">
              Script Preview ({draftScript.slabs.length} scenes · {draftScript.voice_name})
            </span>

            {draftScript.slabs.map((slab, index) => (
              <div key={`${slab.id}-${index}`} className="rounded-[12px] bg-[#141A15] p-3 flex flex-col gap-2">
                <span className="text-xs text-[#A0ACA2]">
                  Scene {index + 1} · {slab.voice_emotion} · {slab.sfx_cue}
                </span>

                {/* Visual Source Selector */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 chip-scroll">
                  {VISUAL_SOURCE_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => onSlabVisualSourceChanged(index, opt.key)}
                      disabled={isGenerating}
                      className={chipClass(slab.visual_source.toLowerCase() === opt.key, isGenerating)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Layout Mode Selector */}
                <div className="flex items-center gap-1.5">
                  {LAYOUT_MODE_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => onSlabLayoutModeChanged(index, opt.key)}
                      disabled={isGenerating}
                      className={chipClass(slab.layout_mode.toLowerCase() === opt.key, isGenerating)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {slab.visual_source.toLowerCase() !== 'ai_generated' && (
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-[#A0ACA2]">Internet query (photo / clip / meme)</span>
                    <input
                      type="text"
                      value={slab.real_photo_query}
                      onChange={(e) =>
                        updateSlab(index, (s) => ({ ...s, real_photo_query: e.target.value }))
                      }
                      disabled={isGenerating}
                      className="w-full rounded-lg bg-transparent border border-[#285C22] focus:border-[#39FF14] focus:outline-none px-3 py-2 text-xs text-white disabled:opacity-60"
                    />
                  </label>
                )}

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-[#A0ACA2]">Stat Badge (optional e.g. ₹500 Cr)</span>
                  <input
                    type="text"
                    value={slab.stat_badge}
                    onChange={(e) => updateSlab(index, (s) => ({ ...s, stat_badge: e.target.value }))}
                    disabled={isGenerating}
                    className="w-full rounded-lg bg-transparent border border-[#285C22] focus:border-[#39FF14] focus:outline-none px-3 py-2 text-xs text-white disabled:opacity-60"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-[#A0ACA2]">Voiceover</span>
                  <textarea
                    value={slab.voiceover_text}
                    onChange={(e) => updateSlab(index, (s) => ({ ...s, voiceover_text: e.target.value }))}
                    disabled={isGenerating}
                    rows={2}
                    className="w-full rounded-lg bg-transparent border border-[#285C22] focus:border-[#39FF14] focus:outline-none px-3 py-2 text-xs text-white disabled:opacity-60 resize-y"
                  />
                </label>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cover Thumbnail Modal */}
      {showCoverModal && generatedThumbnailUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setShowCoverModal(false)}
        >
          <div
            className="max-w-lg w-full rounded-[14px] bg-[#141A15] border border-[#285C22] p-4 flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-[#39FF14]">Cover Thumbnail</span>
              <button
                type="button"
                onClick={() => setShowCoverModal(false)}
                className="text-xs text-[#A0ACA2] hover:text-white cursor-pointer"
              >
                Close
              </button>
            </div>
            <img
              src={generatedThumbnailUrl}
              alt="Video Cover Thumbnail"
              className="w-full max-h-[70vh] object-contain rounded-lg bg-black"
            />
            <a
              href={`${generatedThumbnailUrl}?download=1`}
              download="RSMovieSpot_Cover.jpg"
              className="w-full py-2.5 rounded-[24px] bg-[#39FF14] text-black text-center text-sm font-bold hover:brightness-95"
            >
              Download Cover JPG
            </a>
          </div>
        </div>
      )}

      {/* Subtle Toast */}
      {toastText && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-[#1B3A18] border border-[#39FF14] text-[#39FF14] text-xs font-semibold shadow-lg">
          {toastText}
        </div>
      )}
    </div>
  );
}

export default App;
