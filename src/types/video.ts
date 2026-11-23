export type InputMode = 'AUTO' | 'EXACT_SCRIPT' | 'AI_PROMPT';

export type ContentMode =
  | 'AUTO'
  | 'REVIEW'
  | 'MOVIE_ROAST'
  | 'REACTION'
  | 'STORY'
  | 'KIDS_STORY'
  | 'COOKING';

export const CONTENT_MODES: Array<{ value: ContentMode; label: string; hint: string }> = [
  {
    value: 'AUTO',
    label: 'Auto',
    hint: 'Paste any script or topic — AI automatically adapts storytelling, visuals & mood.',
  },
  {
    value: 'REVIEW',
    label: 'Review',
    hint: 'Movie or trailer name / review script — fetches cast photos, official poster & rating badges.',
  },
  {
    value: 'MOVIE_ROAST',
    label: 'Movie Roast',
    hint: 'Movie name or roast script — punchy comedy lines, meme cuts, logic roast & fast beats.',
  },
  {
    value: 'REACTION',
    label: 'Reaction',
    hint: 'Trailer, scene or viral clip topic — split/flip reactions, high-emotion beats & polls.',
  },
  {
    value: 'STORY',
    label: 'Story',
    hint: 'Story idea or full kahani — locks main character face/outfit across all AI scenes with suspense.',
  },
  {
    value: 'KIDS_STORY',
    label: 'Kids Story',
    hint: 'Kids adventure or moral bedtime story — playful warm narration with 3D Pixar storybook visuals.',
  },
  {
    value: 'COOKING',
    label: 'Cooking',
    hint: 'Dish name or recipe steps — appetizing macro food visuals, step badges & warm kitchen vibes.',
  },
];

export const INPUT_MODES: Array<{ value: InputMode; label: string; hint: string }> = [
  {
    value: 'AUTO',
    label: 'Auto',
    hint: 'Auto: ready script = exact voice, prompt/topic = AI acts on it',
  },
  {
    value: 'EXACT_SCRIPT',
    label: 'Exact Script',
    hint: 'Exact Script: speaks your exact text word-for-word',
  },
  {
    value: 'AI_PROMPT',
    label: 'AI Prompt',
    hint: 'AI Prompt: follows all instructions & writes fresh script',
  },
];

export type VoiceGender = 'MALE' | 'FEMALE';

export const VOICE_GENDERS: Array<{ value: VoiceGender; label: string }> = [
  { value: 'MALE', label: 'Male Voice' },
  { value: 'FEMALE', label: 'Female Voice' },
];

export type VoiceTone = 'AUTO' | 'NATURAL' | 'FUNNY' | 'SERIOUS' | 'ENERGETIC';

export const VOICE_TONES: Array<{ value: VoiceTone; label: string }> = [
  { value: 'AUTO', label: 'Auto (Smart)' },
  { value: 'NATURAL', label: 'Podcast / Human' },
  { value: 'FUNNY', label: 'Funny / Comic' },
  { value: 'SERIOUS', label: 'Serious / Intense' },
  { value: 'ENERGETIC', label: 'Energetic / Hype' },
];

export type VisualStyleMode = 'AUTO' | 'PIXAR_3D' | 'ANIME_3D' | 'LIVE_ACTION';

export const VISUAL_STYLE_OPTIONS: Array<{ value: VisualStyleMode; label: string }> = [
  { value: 'AUTO', label: 'Auto Visuals' },
  { value: 'PIXAR_3D', label: '3D Pixar Story' },
  { value: 'ANIME_3D', label: 'Anime Motion' },
  { value: 'LIVE_ACTION', label: 'Live-Action 35mm' },
];

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

export const VIDEO_LANGUAGE_OPTIONS: Array<{ value: VideoLanguageKey; label: string }> = [
  { value: 'AUTO', label: 'Auto' },
  { value: 'HINDI', label: 'Hindi' },
  { value: 'ENGLISH_IN', label: 'English (IN)' },
  { value: 'ENGLISH_US', label: 'English (US)' },
  { value: 'MARATHI', label: 'Marathi' },
  { value: 'GUJARATI', label: 'Gujarati' },
  { value: 'BENGALI', label: 'Bengali' },
  { value: 'TAMIL', label: 'Tamil' },
  { value: 'TELUGU', label: 'Telugu' },
  { value: 'KANNADA', label: 'Kannada' },
  { value: 'MALAYALAM', label: 'Malayalam' },
  { value: 'PUNJABI', label: 'Punjabi' },
  { value: 'URDU', label: 'Urdu' },
  { value: 'SPANISH', label: 'Spanish' },
  { value: 'FRENCH', label: 'French' },
  { value: 'JAPANESE', label: 'Japanese' },
  { value: 'ARABIC', label: 'Arabic' },
];

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
