import type { ContentMode, VideoSlab } from '../types/video';

export type CharacterArchetype = 'auto' | 'fox' | 'hero' | 'robot' | 'chef';
export type ResolvedCharacter = Exclude<CharacterArchetype, 'auto'>;

export type CharacterAction =
  | 'walk'
  | 'run'
  | 'talk'
  | 'sad'
  | 'jump'
  | 'celebrate'
  | 'cook'
  | 'heroic';

export type CameraPreset = 'wide' | 'follow' | 'closeup' | 'dramatic' | 'orbit';

export type StageMood =
  | 'forest_day'
  | 'moonlit_night'
  | 'sunset_meadow'
  | 'kitchen_studio'
  | 'cinema_stage';

export interface SceneChoreography {
  sceneIndex: number;
  action: CharacterAction;
  camera: CameraPreset;
  mood: StageMood;
  startX: number;
  startZ: number;
  endX: number;
  endZ: number;
  facingAngle: number;
  durationSec: number;
  showCompanion: boolean;
}

export function resolveCharacterArchetype(
  selected: CharacterArchetype,
  contentMode: ContentMode,
  topic: string,
  characterBible: string
): ResolvedCharacter {
  if (selected !== 'auto') return selected;
  const hay = `${topic} ${characterBible}`.toLowerCase();
  if (contentMode === 'COOKING' || /cook|recipe|kitchen|chef|biryani|paneer|खाना|रसोई/.test(hay)) {
    return 'chef';
  }
  if (/robot|ai|tech|sci-fi|space|cyber|रोबोट|मशीन/.test(hay)) {
    return 'robot';
  }
  if (
    contentMode === 'KIDS_STORY' ||
    /fox|rabbit|lion|animal|jungle|firefly|चंदावन|जंगल|जुगनू|लोमड़|शेर|चूहा|हाथी|बच्चों/.test(hay)
  ) {
    return 'fox';
  }
  return 'hero';
}

export function analyzeSceneChoreography(
  slab: VideoSlab,
  index: number,
  total: number,
  contentMode: ContentMode,
  topic: string
): SceneChoreography {
  const text = `${slab.voiceover_text} ${slab.image_prompt} ${slab.voice_emotion} ${slab.sfx_cue}`.toLowerCase();
  const emotion = slab.voice_emotion.toLowerCase();

  let mood: StageMood = 'forest_day';
  if (contentMode === 'COOKING' || /kitchen|cook|pan|stove|recipe|dish|रसोई|पका/.test(text)) {
    mood = 'kitchen_studio';
  } else if (
    contentMode === 'REVIEW' ||
    contentMode === 'MOVIE_ROAST' ||
    contentMode === 'REACTION'
  ) {
    mood = 'cinema_stage';
  } else if (/night|moon|dark|star|firefly|चाँद|रात|अंधेरे|जुगनू|तारे/.test(text)) {
    mood = 'moonlit_night';
  } else if (/sunset|sun|gold|morning|victory|स्वर्ण|सूरज|मुस्कुरा|आसमान/.test(text) || index === total - 1) {
    mood = 'sunset_meadow';
  }

  let action: CharacterAction = 'talk';
  if (contentMode === 'COOKING' && !/hook|outro/.test(emotion)) {
    action = 'cook';
  } else if (/sad|cry|lost|alone|dark|worried|उदास|डर|अंधेरे|हँसते/.test(text) || emotion === 'sad') {
    action = 'sad';
  } else if (
    /celebrate|happy|win|smile|glow|shine|चमक|मुस्कुरा|जगमगा|सीख|खुश/.test(text) ||
    index === total - 1
  ) {
    action = index === total - 1 ? 'celebrate' : 'jump';
  } else if (/fly|climb|run|rush|travel|उड़|भाग|चोटी|दौड़|रास्ता/.test(text)) {
    action = 'run';
  } else if (/walk|forest|jungle|enter|रहता|जंगल|चल/.test(text) || index === 0) {
    action = 'walk';
  } else if (emotion === 'hook' || emotion === 'climax' || emotion === 'excited') {
    action = 'heroic';
  }

  const waypoints: Array<[number, number, number, number]> = [
    [-2.4, 1.2, -0.4, 0.5],
    [-0.4, 0.5, 1.4, -0.2],
    [1.4, -0.2, 0.2, 1.1],
    [0.2, 1.1, -1.3, 0.0],
    [-1.3, 0.0, 0.0, 0.6],
    [0.0, 0.6, 0.0, 0.8],
  ];
  const wp = waypoints[index % waypoints.length];
  const [startX, startZ, endX, endZ] = wp;

  const cameras: CameraPreset[] = ['wide', 'follow', 'closeup', 'dramatic', 'follow', 'orbit'];
  let camera = cameras[index % cameras.length];
  if (action === 'sad' || action === 'talk') camera = 'closeup';
  if (action === 'celebrate') camera = 'orbit';
  if (index === 0) camera = 'wide';

  const dx = endX - startX;
  const dz = endZ - startZ;
  const facingAngle = Math.hypot(dx, dz) > 0.15 ? Math.atan2(dx, dz) : 0.15;

  const wordCount = slab.voiceover_text.trim().split(/\s+/).filter(Boolean).length;
  const durationSec = Math.min(5.5, Math.max(3.2, wordCount * 0.26));

  const showCompanion =
    contentMode === 'KIDS_STORY' ||
    /firefly|जुगनू|magic|star|जादू/.test(`${topic} ${text}`.toLowerCase());

  return {
    sceneIndex: index,
    action,
    camera,
    mood,
    startX,
    startZ,
    endX,
    endZ,
    facingAngle,
    durationSec,
    showCompanion,
  };
}

export const DEFAULT_DEMO_SLABS: VideoSlab[] = [
  {
    id: 1,
    voiceover_text: 'क्या एक छोटी सी मक्खी जितना जुगनू पूरे आसमान के चाँद को खुश कर सकता है?',
    image_prompt: 'Little orange fox with red scarf standing at forest entrance',
    sfx_cue: 'whoosh',
    has_character: true,
    voice_emotion: 'hook',
    visual_source: 'ai_generated',
    real_photo_query: '',
    layout_mode: 'single',
    visual_source_2: '',
    real_photo_query_2: '',
    image_prompt_2: '',
    stat_badge: 'SCENE 1',
  },
  {
    id: 2,
    voiceover_text: 'हरे-भरे चंदावन जंगल में टीटू नाम का नन्हा दोस्त रोज़ घूमने निकलता था।',
    image_prompt: 'Little fox walking happily through sunlit green forest',
    sfx_cue: 'chime',
    has_character: true,
    voice_emotion: 'warm',
    visual_source: 'ai_generated',
    real_photo_query: '',
    layout_mode: 'single',
    visual_source_2: '',
    real_photo_query_2: '',
    image_prompt_2: '',
    stat_badge: 'SCENE 2',
  },
  {
    id: 3,
    voiceover_text: 'एक रात काले बादलों की वजह से पूरा जंगल अंधेरे में डूब गया और वह उदास हो गया।',
    image_prompt: 'Little character looking sad in moonlit dark forest',
    sfx_cue: 'boom',
    has_character: true,
    voice_emotion: 'sad',
    visual_source: 'ai_generated',
    real_photo_query: '',
    layout_mode: 'single',
    visual_source_2: '',
    real_photo_query_2: '',
    image_prompt_2: '',
    stat_badge: 'SCENE 3',
  },
  {
    id: 4,
    voiceover_text: 'तभी एक नन्हा जुगनू आकर बोला—हिम्मत मत हारो, चलो सबसे ऊँची पहाड़ी पर चलें!',
    image_prompt: 'Glowing firefly guiding the character forward',
    sfx_cue: 'whoosh',
    has_character: true,
    voice_emotion: 'excited',
    visual_source: 'ai_generated',
    real_photo_query: '',
    layout_mode: 'single',
    visual_source_2: '',
    real_photo_query_2: '',
    image_prompt_2: '',
    stat_badge: 'SCENE 4',
  },
  {
    id: 5,
    voiceover_text: 'टीटू बिना डरे आगे दौड़ा और पूरे जंगल के जुगनुओं को एक साथ बुला लिया!',
    image_prompt: 'Character running energetically under starry night sky',
    sfx_cue: 'thunder',
    has_character: true,
    voice_emotion: 'climax',
    visual_source: 'ai_generated',
    real_photo_query: '',
    layout_mode: 'single',
    visual_source_2: '',
    real_photo_query_2: '',
    image_prompt_2: '',
    stat_badge: 'SCENE 5',
  },
  {
    id: 6,
    voiceover_text: 'चाँद मुस्कुरा उठा और जंगल को सीख मिली—कोई भी छोटा नहीं होता, बस दिल में हिम्मत होनी चाहिए!',
    image_prompt: 'Character jumping and celebrating in golden sunset meadow',
    sfx_cue: 'chime',
    has_character: true,
    voice_emotion: 'warm',
    visual_source: 'ai_generated',
    real_photo_query: '',
    layout_mode: 'single',
    visual_source_2: '',
    real_photo_query_2: '',
    image_prompt_2: '',
    stat_badge: 'MORAL',
  },
];
