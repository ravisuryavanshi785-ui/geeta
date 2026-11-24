import type { ContentMode, VideoSlab } from '../types/video';

export type CharacterArchetype =
  | 'auto'
  | 'critic'
  | 'streamer'
  | 'hero'
  | 'fox'
  | 'chef'
  | 'robot';

export type ResolvedCharacter = Exclude<CharacterArchetype, 'auto'>;

export type CharacterAction =
  | 'walk'
  | 'run'
  | 'jump'
  | 'dance'
  | 'wave'
  | 'talk'
  | 'point'
  | 'roast'
  | 'shock'
  | 'sad'
  | 'cook'
  | 'celebrate';

export const ACTION_OPTIONS: Array<{ value: CharacterAction; label: string }> = [
  { value: 'walk', label: 'Walk' },
  { value: 'run', label: 'Run' },
  { value: 'jump', label: 'Jump' },
  { value: 'dance', label: 'Dance' },
  { value: 'wave', label: 'Wave' },
  { value: 'talk', label: 'Talk' },
  { value: 'point', label: 'Point' },
  { value: 'roast', label: 'Roast' },
  { value: 'shock', label: 'Shock' },
  { value: 'sad', label: 'Sad' },
  { value: 'cook', label: 'Cook' },
  { value: 'celebrate', label: 'Celebrate' },
];

export type CameraPreset = 'wide' | 'follow' | 'closeup' | 'dramatic' | 'orbit';

export type StageMood =
  | 'forest_day'
  | 'moonlit_night'
  | 'sunset_meadow'
  | 'kitchen_studio'
  | 'cinema_stage'
  | 'streamer_studio';

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

  if (contentMode === 'COOKING' || /cook|recipe|kitchen|chef|biryani|paneer|खाना|रसोई|मसाला/.test(hay)) {
    return 'chef';
  }
  if (contentMode === 'REVIEW' || contentMode === 'MOVIE_ROAST') {
    return 'critic';
  }
  if (contentMode === 'REACTION') {
    return 'streamer';
  }
  if (/robot|ai\b|tech|sci-fi|space|cyber|रोबोट|मशीन/.test(hay)) {
    return 'robot';
  }
  if (
    contentMode === 'KIDS_STORY' ||
    /fox|rabbit|lion|animal|jungle|firefly|लोमड़|जंगल|जुगनू|बच्चों/.test(hay)
  ) {
    return 'fox';
  }
  if (contentMode === 'STORY') {
    return 'hero';
  }
  if (/movie|film|trailer|review|roast|फिल्म|रिव्यू/.test(hay)) {
    return 'critic';
  }
  if (/react|viral|trending|podcast|रिएक्शन/.test(hay)) {
    return 'streamer';
  }
  return 'hero';
}

export function analyzeSceneChoreography(
  slab: VideoSlab,
  index: number,
  total: number,
  contentMode: ContentMode,
  topic: string,
  overrideAction?: CharacterAction
): SceneChoreography {
  const text = `${slab.voiceover_text} ${slab.image_prompt} ${slab.voice_emotion} ${slab.sfx_cue}`.toLowerCase();
  const emotion = slab.voice_emotion.toLowerCase();

  let mood: StageMood = 'cinema_stage';
  if (contentMode === 'COOKING' || /kitchen|cook|pan|stove|recipe|dish|रसोई|पका/.test(text)) {
    mood = 'kitchen_studio';
  } else if (contentMode === 'REVIEW' || contentMode === 'MOVIE_ROAST') {
    mood = 'cinema_stage';
  } else if (contentMode === 'REACTION') {
    mood = 'streamer_studio';
  } else if (/night|moon|dark|star|firefly|चाँद|रात|अंधेरे|जुगनू|तारे/.test(text)) {
    mood = 'moonlit_night';
  } else if (/sunset|sun|gold|morning|victory|स्वर्ण|सूरज|मुस्कुरा|आसमान/.test(text) || index === total - 1) {
    mood = 'sunset_meadow';
  } else if (
    contentMode === 'KIDS_STORY' ||
    contentMode === 'STORY' ||
    /forest|jungle|tree|mountain|जंगल|पहाड़|रास्ता/.test(text)
  ) {
    mood = 'forest_day';
  } else {
    mood = 'cinema_stage';
  }

  // Varied non-repetitive default sequence per ContentMode + keyword awareness
  let action: CharacterAction;
  if (overrideAction) {
    action = overrideAction;
  } else if (/sad|cry|lost|alone|dark|worried|उदास|डर|अंधेरे|रो/.test(text) || emotion === 'sad') {
    action = 'sad';
  } else if (/shock|omg|wait|what|twist|अरे|चौंक|धमाका|हैरान/.test(text)) {
    action = 'shock';
  } else if (/dance|party|naach|नाच|धमाल|संगीत/.test(text)) {
    action = 'dance';
  } else if (/celebrate|win|smile|glow|shine|चमक|मुस्कुरा|जगमगा|सीख|खुश|अंत/.test(text) || index === total - 1) {
    action = index === total - 1 ? 'celebrate' : 'jump';
  } else if (/fly|climb|run|rush|travel|उड़|भाग|चोटी|दौड़/.test(text)) {
    action = 'run';
  } else if (/walk|forest|jungle|enter|घूमने|जंगल|चल|निकला/.test(text)) {
    action = 'walk';
  } else if (contentMode === 'COOKING') {
    const cookBeats: CharacterAction[] = ['wave', 'point', 'cook', 'shock', 'cook', 'celebrate'];
    action = cookBeats[index % cookBeats.length];
  } else if (contentMode === 'MOVIE_ROAST') {
    const roastBeats: CharacterAction[] = ['wave', 'roast', 'shock', 'point', 'roast', 'dance'];
    action = roastBeats[index % roastBeats.length];
  } else if (contentMode === 'REVIEW') {
    const reviewBeats: CharacterAction[] = ['wave', 'talk', 'point', 'shock', 'roast', 'celebrate'];
    action = reviewBeats[index % reviewBeats.length];
  } else if (contentMode === 'REACTION') {
    const reactBeats: CharacterAction[] = ['wave', 'shock', 'point', 'talk', 'dance', 'celebrate'];
    action = reactBeats[index % reactBeats.length];
  } else {
    const storyBeats: CharacterAction[] = ['walk', 'talk', 'point', 'run', 'jump', 'celebrate'];
    action = storyBeats[index % storyBeats.length];
  }

  // Distinct spatial waypoints per scene so character clearly traverses the stage
  const stageWaypoints: Array<[number, number, number, number]> =
    mood === 'cinema_stage' || mood === 'streamer_studio' || mood === 'kitchen_studio'
      ? [
          [-1.35, 0.55, 0.0, 0.35],
          [0.0, 0.35, 0.95, 0.48],
          [0.95, 0.48, -0.75, 0.42],
          [-0.75, 0.42, 0.35, 0.58],
          [0.35, 0.58, -0.35, 0.32],
          [-0.35, 0.32, 0.0, 0.48],
        ]
      : [
          [-2.2, 1.0, -0.35, 0.45],
          [-0.35, 0.45, 1.25, -0.15],
          [1.25, -0.15, 0.2, 0.95],
          [0.2, 0.95, -1.2, 0.05],
          [-1.2, 0.05, 0.1, 0.55],
          [0.1, 0.55, 0.0, 0.72],
        ];
  const wp = stageWaypoints[index % stageWaypoints.length];
  const [startX, startZ, endX, endZ] = wp;

  const cameras: CameraPreset[] = ['wide', 'closeup', 'follow', 'dramatic', 'follow', 'orbit'];
  let camera = cameras[index % cameras.length];
  if (action === 'sad' || action === 'talk' || action === 'shock' || action === 'wave') camera = 'closeup';
  if (action === 'roast' || action === 'point') camera = 'dramatic';
  if (action === 'celebrate' || action === 'dance') camera = 'orbit';
  if (index === 0) camera = 'wide';

  const dx = endX - startX;
  const dz = endZ - startZ;
  const facingAngle = Math.hypot(dx, dz) > 0.15 ? Math.atan2(dx, dz) : 0.12;

  const wordCount = slab.voiceover_text.trim().split(/\s+/).filter(Boolean).length;
  const durationSec = Math.min(5.0, Math.max(2.8, wordCount * 0.24));

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
    voiceover_text: 'हरे-भरे जंगल में एक नन्हा लोमड़ सुबह घूमने निकला, और रास्ते में नए दोस्त खोजने लगा।',
    image_prompt: 'Little orange fox with red scarf walking through sunlit green forest',
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
    voiceover_text: 'अचानक रात हो गई और चाँद बादलों के पीछे छिप गया, जिससे पूरा जंगल अंधेरे में उदास हो गया।',
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
    stat_badge: 'SCENE 2',
  },
  {
    id: 3,
    voiceover_text: 'तभी एक छोटा जुगनू पास आया और प्यार से बोला—घबराओ मत, हम मिलकर रास्ता ढूँढ लेंगे!',
    image_prompt: 'Glowing firefly guiding the character forward',
    sfx_cue: 'chime',
    has_character: true,
    voice_emotion: 'warm',
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
    voiceover_text: 'अब दोनों ने हिम्मत बांधी और सबसे ऊँची पहाड़ी की चोटी की तरफ तेज़ी से दौड़ लगा दी।',
    image_prompt: 'Character running energetically under starry night sky',
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
    voiceover_text: 'ऊपर पहुँचते ही जुगनुओं का पूरा झुंड चमक उठा और लोमड़ खुशी से हवा में कूद पड़ा!',
    image_prompt: 'Character jumping happily as fireflies illuminate the sky',
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
    voiceover_text: 'चाँद भी मुस्कुरा उठा और सबको सीख मिली—छोटी सी हिम्मत बड़े से बड़ा अंधेरा मिटा देती है!',
    image_prompt: 'Character celebrating in golden sunset meadow',
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
