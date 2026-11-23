export type InputMode = 'AUTO' | 'EXACT_SCRIPT' | 'AI_PROMPT';

export type ContentMode =
  | 'AUTO'
  | 'REVIEW'
  | 'MOVIE_ROAST'
  | 'REACTION'
  | 'STORY'
  | 'KIDS_STORY'
  | 'COOKING';

export type VoiceGender = 'MALE' | 'FEMALE';

export type VoiceTone = 'AUTO' | 'NATURAL' | 'FUNNY' | 'SERIOUS' | 'ENERGETIC';

export type VisualStyleMode = 'AUTO' | 'PIXAR_3D' | 'ANIME_3D' | 'LIVE_ACTION';

export type VideoLanguageKey =
  | 'AUTO'
  | 'HINDI'
  | 'ENGLISH_IN'
  | 'ENGLISH_US'
  | 'MARATHI'
  | 'GUJARATI'
  | 'BENGALI'
  | 'TAMIL'
  | 'TELUGU'
  | 'KANNADA'
  | 'MALAYALAM'
  | 'PUNJABI'
  | 'URDU'
  | 'SPANISH'
  | 'FRENCH'
  | 'JAPANESE'
  | 'ARABIC';

export interface VideoLanguageConfig {
  key: VideoLanguageKey;
  label: string;
  languageInstruction: string;
  maleVoice: string;
  femaleVoice: string;
}

export const VIDEO_LANGUAGES: Record<VideoLanguageKey, VideoLanguageConfig> = {
  AUTO: {
    key: 'AUTO',
    label: 'Auto',
    languageInstruction: '',
    maleVoice: 'hi-IN-MadhurNeural',
    femaleVoice: 'hi-IN-SwaraNeural',
  },
  HINDI: {
    key: 'HINDI',
    label: 'Hindi',
    languageInstruction: 'spoken Hindi in Devanagari script',
    maleVoice: 'hi-IN-MadhurNeural',
    femaleVoice: 'hi-IN-SwaraNeural',
  },
  ENGLISH_IN: {
    key: 'ENGLISH_IN',
    label: 'English (IN)',
    languageInstruction: 'natural Indian English',
    maleVoice: 'en-IN-PrabhatNeural',
    femaleVoice: 'en-IN-NeerjaNeural',
  },
  ENGLISH_US: {
    key: 'ENGLISH_US',
    label: 'English (US)',
    languageInstruction: 'punchy American English',
    maleVoice: 'en-US-AndrewNeural',
    femaleVoice: 'en-US-AvaNeural',
  },
  MARATHI: {
    key: 'MARATHI',
    label: 'Marathi',
    languageInstruction: 'natural Marathi in Devanagari script',
    maleVoice: 'mr-IN-ManoharNeural',
    femaleVoice: 'mr-IN-AarohiNeural',
  },
  GUJARATI: {
    key: 'GUJARATI',
    label: 'Gujarati',
    languageInstruction: 'natural Gujarati in Gujarati script',
    maleVoice: 'gu-IN-NiranjanNeural',
    femaleVoice: 'gu-IN-DhwaniNeural',
  },
  BENGALI: {
    key: 'BENGALI',
    label: 'Bengali',
    languageInstruction: 'natural Bengali in Bengali script',
    maleVoice: 'bn-IN-BashkarNeural',
    femaleVoice: 'bn-IN-TanishaaNeural',
  },
  TAMIL: {
    key: 'TAMIL',
    label: 'Tamil',
    languageInstruction: 'natural Tamil in Tamil script',
    maleVoice: 'ta-IN-ValluvarNeural',
    femaleVoice: 'ta-IN-PallaviNeural',
  },
  TELUGU: {
    key: 'TELUGU',
    label: 'Telugu',
    languageInstruction: 'natural Telugu in Telugu script',
    maleVoice: 'te-IN-MohanNeural',
    femaleVoice: 'te-IN-ShrutiNeural',
  },
  KANNADA: {
    key: 'KANNADA',
    label: 'Kannada',
    languageInstruction: 'natural Kannada in Kannada script',
    maleVoice: 'kn-IN-GaganNeural',
    femaleVoice: 'kn-IN-SapnaNeural',
  },
  MALAYALAM: {
    key: 'MALAYALAM',
    label: 'Malayalam',
    languageInstruction: 'natural Malayalam in Malayalam script',
    maleVoice: 'ml-IN-MidhunNeural',
    femaleVoice: 'ml-IN-SobhanaNeural',
  },
  PUNJABI: {
    key: 'PUNJABI',
    label: 'Punjabi',
    languageInstruction: 'natural Punjabi in Gurmukhi script',
    maleVoice: 'pa-IN-OjasNeural',
    femaleVoice: 'pa-IN-VaaniNeural',
  },
  URDU: {
    key: 'URDU',
    label: 'Urdu',
    languageInstruction: 'natural Urdu in Perso-Arabic script',
    maleVoice: 'ur-IN-SalmanNeural',
    femaleVoice: 'ur-IN-GulNeural',
  },
  SPANISH: {
    key: 'SPANISH',
    label: 'Spanish',
    languageInstruction: 'natural Spanish',
    maleVoice: 'es-ES-AlvaroNeural',
    femaleVoice: 'es-ES-ElviraNeural',
  },
  FRENCH: {
    key: 'FRENCH',
    label: 'French',
    languageInstruction: 'natural French',
    maleVoice: 'fr-FR-HenriNeural',
    femaleVoice: 'fr-FR-DeniseNeural',
  },
  JAPANESE: {
    key: 'JAPANESE',
    label: 'Japanese',
    languageInstruction: 'natural Japanese',
    maleVoice: 'ja-JP-KeitaNeural',
    femaleVoice: 'ja-JP-NanamiNeural',
  },
  ARABIC: {
    key: 'ARABIC',
    label: 'Arabic',
    languageInstruction: 'natural Arabic',
    maleVoice: 'ar-SA-HamedNeural',
    femaleVoice: 'ar-SA-ZariyahNeural',
  },
};

export function resolveLanguageVoice(language: VideoLanguageKey, gender: VoiceGender): string {
  const cfg = VIDEO_LANGUAGES[language] ?? VIDEO_LANGUAGES.AUTO;
  return gender === 'FEMALE' ? cfg.femaleVoice : cfg.maleVoice;
}

export interface VideoSlab {
  id: number;
  voiceover_text: string;
  image_prompt: string;
  sfx_cue: string;
  has_character: boolean;
  voice_emotion: string;
  visual_source: string;
  real_photo_query: string;
  layout_mode: string;
  visual_source_2: string;
  real_photo_query_2: string;
  image_prompt_2: string;
  stat_badge: string;
}

export interface VideoScriptResponse {
  character_bible: string;
  visual_style: string;
  bgm_mood: string;
  voice_name: string;
  youtube_title: string;
  youtube_description: string;
  youtube_hashtags: string;
  pinned_comment: string;
  slabs: VideoSlab[];
}

export interface RenderStatusResponse {
  jobId: string;
  isGenerating: boolean;
  progressText: string;
  progressPercentage: number;
  statusMessage: string;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  completedScript: VideoScriptResponse | null;
}
