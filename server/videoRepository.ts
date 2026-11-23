import crypto from 'node:crypto';
import fs from 'node:fs';
import sharp from 'sharp';
import {
  resolveLanguageVoice,
  type ContentMode,
  type InputMode,
  type VideoLanguageKey,
  type VideoScriptResponse,
  type VideoSlab,
  type VisualStyleMode,
  type VoiceGender,
  type VoiceTone,
  VIDEO_LANGUAGES,
} from './types.ts';
import { validateDownloadedImageDimensions } from './imageComposer.ts';

const FULL_SCRIPT_WORD_THRESHOLD = 25;
const WIKIMEDIA_USER_AGENT = 'RSMovieSpot/1.0 (https://rsmoviespot.app)';
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const SHORTS_IMAGE_WIDTH = 576;
const SHORTS_IMAGE_HEIGHT = 1024;
const LANDSCAPE_IMAGE_WIDTH = 1024;
const LANDSCAPE_IMAGE_HEIGHT = 576;

let cachedChatModels: string[] | null = null;
let cloudflareExhaustedUntilMs = 0;
let pollinationsCooldownUntilMs = 0;
let aiHordeSubmitChain: Promise<void> = Promise.resolve();
let aiHordeLastSubmitMs = 0;

async function paceAiHordeSubmit(): Promise<void> {
  const prev = aiHordeSubmitChain;
  let release!: () => void;
  aiHordeSubmitChain = new Promise<void>((r) => {
    release = r;
  });
  await prev;
  try {
    const waitMs = Math.max(0, 700 - (Date.now() - aiHordeLastSubmitMs));
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    aiHordeLastSubmitMs = Date.now();
  } finally {
    release();
  }
}

const IMAGE_PROMPT_RULES =
  "PRIORITY 0 — USER-DESCRIBED SCENES & TOPIC APPROPRIATENESS ALWAYS WIN (HIGHEST PRIORITY):\n" +
  "- Whenever the user's prompt or script explicitly describes a specific visual scene, character appearance, outfit, location, lighting, style, camera shot, or action (whether in Hindi, Hinglish, or English, e.g., 'pehle scene me...', 'Scene 1:', '[Visual: ...]'), YOU MUST generate that EXACT visual in image_prompt and set visual_source='ai_generated' and real_photo_query=''.\n" +
  "- Front-load the exact described subject, costume/outfit, action, setting, props, and lighting in the FIRST 25-35 words of image_prompt so the image generator prioritizes them!\n" +
  "- If the user asks for a specific style (e.g., anime, 3D Pixar, noir, cyberpunk) or forbids posters/comics/real_photo, strictly honor that style across every scene.\n" +
  "- SCENE-BY-SCENE SUBJECT & ACTION MATCHING: Match EVERY image_prompt 100% to THAT slab's voiceover! For food/cooking recipes show steamy handi, saffron rice, spices, sizzling tadka, ingredients; for history/mythology show period palaces, warriors, landscapes; NEVER put a random person or cinema theater in non-movie scenes! Set has_character=false whenever a scene focuses on food, scenery, props, or secondary subjects.\n\n" +
  "DYNAMIC CLIPS, MEMES, 2-PHOTO SPLITS & STAT BADGES (USE ONLY WHEN TOPIC FITS):\n" +
  "- 'video_clip' (ONLY for movie reviews, trailer breakdowns, celebrity news, or pop-culture roasts — USE 0 video_clips for cooking recipes, tutorials, kids stories, devotional/history explainers, or pure AI animation): Set visual_source='video_clip', layout_mode='single', and give EACH clip a DIFFERENT, concrete 2-3 word recognizable English movie/character/action query (e.g., 'Avengers Endgame', 'Robert Downey Jr', 'Thanos snap'). NEVER repeat queries and NEVER query abstract words like 'rating', 'review', 'stars', 'ending', or 'multiverse'.\n" +
  "- 'meme_clip' (ONLY 1-2 scenes in funny roasts/movie gossip; USE 0 meme_clips in recipes, tutorials, serious/sad, devotional, or educational topics!): Set visual_source='meme_clip', layout_mode='single', and real_photo_query to a named meme template.\n" +
  "- 'split' / 'flip' 2-PHOTO SCENES: For record-comparison, clash, or vs scenes, set layout_mode='split' (or 'flip') with visual_source in {'real_photo','ai_generated'} and fill visual_source_2, real_photo_query_2, image_prompt_2.\n" +
  "- STAT BADGES & SPELLING: Whenever a scene announces a concrete number, cooking timer, budget, or release date, set stat_badge to a crisp 2-4 word UPPERCASE headline with ACCURATE English/Hinglish spelling (e.g., '20 MIN DUM', NOT '20 MIN DAM'; '₹2000 CR BUDGET'; '100% AUTHENTIC'). NEVER use generic placeholder words like 'STAT', 'BADGE', 'TITLE', 'TEXT', 'INFO', 'FACT', 'NUMBER', 'PLACEHOLDER', 'NONE', or 'N/A' — use '' if no concrete stat applies.\n\n" +
  "REAL PHOTO / POSTER vs AI IMAGE RULES (PREFER AI FOR NON-CELEBRITY / RECIPE / ABSTRACT):\n" +
  "  1) REAL-WORLD ACTOR / DIRECTOR / SINGER / PUBLIC FIGURE ONLY named in the scene (e.g., Sooraj Barjatya, Ayushmann Khurrana, Sharvari Wagh, Anupam Kher, Seema Pahwa, Himesh Reshammiya, Shah Rukh Khan): MUST set visual_source='real_photo' and real_photo_query to ONLY their clean English full name (e.g., 'Ayushmann Khurrana', 'Sharvari Wagh') — NEVER set visual_source='ai_generated' when a real celebrity's name is in image_prompt or voiceover_text!\n" +
  "  2) Celebrity DUO OR Director+Movie named in ONE scene: MUST set layout_mode='flip', visual_source='real_photo', real_photo_query='<Name 1>', visual_source_2='real_photo', real_photo_query_2='<Name 2 or Movie Title movie poster>' so BOTH show full-screen!\n" +
  "  3) SPECIFIC MOVIE / TRAILER / WEB SERIES ONLY highlighted in the scene: set visual_source='real_photo' (or 'video_clip' only when an older popular film clip exists) and real_photo_query to '<Exact Clean English Title> movie poster'.\n" +
  "  4) ORIGINAL STORY CHARACTERS INSIDE A FILM (e.g., Purva, unnamed bride/groom), COOKING, RECIPES, FOOD, TUTORIALS, RATINGS, POLLS, & ALL OTHER SCENES: ALWAYS set visual_source='ai_generated' and real_photo_query=''. NEVER query real_photo for fictional wedding character names or generic reactions.\n" +
  "  5) Every scene's real_photo_query MUST be unique unless intentionally contrasting two people via flip/split.\n" +
  "- ALWAYS write a rich, content-matched fallback image_prompt in 100% ASCII ENGLISH (ZERO Hindi/Devanagari/regional words!) for EVERY slab.\n\n" +
  "IMAGE PROMPT RULES (100% ENGLISH — SINGLE UNIFIED SCENE — ZERO TEXT / ZERO UI / ZERO GAUGES):\n" +
  "- STRICT ENGLISH-ONLY RULE: Write ALL image_prompt, image_prompt_2, real_photo_query, real_photo_query_2 strictly in plain ASCII English. ALWAYS transliterate Hindi/regional names into clean English inside queries & prompts.\n" +
  "- Every image_prompt MUST describe ONE SINGLE CONTINUOUS CAMERA SHOT of a concrete physical scene (never collages, grids, split-screen, wallpapers, split cards, or multiple panels).\n" +
  "- NEVER prompt calendars, marked dates, meters, gauges, speedometers, scorecards, rating numbers ('8/10', '2'), charts, bold text, UI icons, streaming icons, posters, logos, signs, or hands gripping microphones — put any number/date/rating inside stat_badge instead and depict an atmospheric cinema/character reaction scene in image_prompt!\n" +
  "- Unless user specifies animation/3D/anime/cartoon, write every image_prompt as a REAL LIVE-ACTION 35mm DSLR PHOTOGRAPH (natural textures, expressive lighting, shallow depth of field).\n" +
  "- Vary camera framing across scenes (wide establishing shot, medium two-shot, close-up portrait, dramatic low-angle).\n\n";

const VOICE_AND_BGM_RULES =
  "VOICE EMOTION, BGM & CHANNEL GROWTH METADATA RULES:\n" +
  "- CHANNEL GROWTH HOOK & RETENTION STRUCTURE: Always craft an explosive 2-second curiosity/shock Hook in Scene 1 (voice_emotion='hook'), a mid-video retention twist or open loop around Scene 5-7 so viewers keep watching to the end, and a debate-sparking question CTA in the finale!\n" +
  "- Pick bgm_mood: 'comedy_roast', 'epic_action', 'suspense_thriller', 'emotional_sad', 'devotional', 'sci_fi_tech', 'motivational', or 'horror_dark'.\n" +
  "- For each scene, match voice_emotion dynamically from: 'hook', 'excited', 'climax', 'suspense', 'sad', 'roast', 'question', 'warm', or 'normal' (avoid repeating 'normal' on every line!).\n" +
  "- Pick valid Edge TTS voice_name (e.g. hi-IN-MadhurNeural, hi-IN-SwaraNeural, en-IN-PrabhatNeural, en-IN-NeerjaNeural, en-US-AndrewNeural, en-US-AvaNeural, etc.).\n" +
  "- Also generate high-CTR youtube_title (under 62 chars, strong curiosity gap + 1 punchy emoji), SEO youtube_description (2-3 crisp keyword-rich lines), 5-7 targeted youtube_hashtags ('#shorts ...'), and a comment-bait poll/question in pinned_comment to drive Shorts algorithm engagement.\n\n";

const JSON_SCHEMA_SPEC =
  "Return ONLY ONE valid JSON object (no markdown fences, no commentary) matching this schema:\n" +
  "{\n" +
  '  "character_bible": "Fixed simple visual look of main character or visual theme in English",\n' +
  '  "visual_style": "Visual medium matching user request (e.g. Raw live-action 35mm film photography or 3D Pixar animation)",\n' +
  '  "bgm_mood": "comedy_roast | epic_action | suspense_thriller | emotional_sad | devotional | sci_fi_tech | motivational | horror_dark",\n' +
  '  "voice_name": "Edge TTS voice shortName matching language and gender",\n' +
  '  "youtube_title": "Catchy viral YouTube title under 75 chars",\n' +
  '  "youtube_description": "2-3 line SEO YouTube description",\n' +
  '  "youtube_hashtags": "#shorts #viral #storytelling",\n' +
  '  "pinned_comment": "Engaging question to boost comments on this video",\n' +
  '  "slabs": [\n' +
  "    {\n" +
  '      "voiceover_text": "Complete standalone sentence ending in . ! ? or । (NEVER end on a comma or hanging word like और/and/or)",\n' +
  '      "voice_emotion": "hook | excited | climax | suspense | sad | roast | question | warm | normal",\n' +
  '      "visual_source": "real_photo | ai_generated | video_clip | meme_clip",\n' +
  '      "real_photo_query": "Clean English query if real_photo/video_clip/meme_clip, else \'\'",\n' +
  '      "layout_mode": "single | split | flip",\n' +
  '      "visual_source_2": "real_photo | ai_generated | \'\'",\n' +
  '      "real_photo_query_2": "2nd photo query if split/flip and real_photo, else \'\'",\n' +
  '      "image_prompt_2": "2nd scene English prompt if split/flip, else \'\'",\n' +
  '      "stat_badge": "Optional 2-4 word accurately spelled UPPERCASE stat (no placeholder words) or \'\'",\n' +
  '      "has_character": false,\n' +
  '      "image_prompt": "Front-loaded crisp English prompt matching THAT scene\'s exact visual shot (no text/words/logos)",\n' +
  '      "sfx_cue": "boom | thunder | sword | fire | whoosh"\n' +
  "    }\n" +
  "  ]\n" +
  "}";

const FULL_SCRIPT_SYSTEM_PROMPT =
  "You are an expert film director and visual editor splitting an existing user-written script into crisp visual scenes.\n" +
  "CRITICAL FULL SCRIPT RULES:\n" +
  "- DO NOT rewrite, paraphrase, translate, summarize, add, drop, or change EVEN A SINGLE WORD of the user's spoken input.\n" +
  "- MERGE TINY HOOKS & SPLIT LONG CLAUSES (CRITICAL): Never isolate a 1-3 word exclamation (like 'रुको!', 'लेकिन एक मिनट!') into its own sub-1-second scene — merge it with the adjacent sentence. ALSO never cram >16 words or 2 separate celebrity pairs into one long slab; break cleanly at clauses/conjunctions so EVERY scene is 6 to 14 words across 11 to 16 scenes.\n" +
  "- NEVER split inside a person's full name, movie title, or currency number, and NEVER cross a sentence period.\n" +
  "- Concatenating all slabs' voiceover_text values with spaces MUST match the user's input word-for-word.\n" +
  "- ENTERTAINMENT / TRAILER / CELEBRITY VISUALS: Even when voiceover_text is in Hindi/regional script, transliterate EVERY real celebrity/director/singer name and EVERY specific movie title into clean English! Whenever a real actor/director/singer is named, MUST set visual_source='real_photo' with real_photo_query='<Full English Name>' (or layout_mode='flip' with visual_source='real_photo' + visual_source_2='real_photo' when two actors or director+movie are named!). NEVER draw an actor as ai_generated. For original plot scenes, ratings, or audience CTA questions, use visual_source='ai_generated' with purely English visual photography prompts (NO Devanagari, NO calendars, NO split-screen, NO meter/gauge/card/UI words).\n" +
  "- Never put unescaped double quotes inside JSON strings (use single quotes if needed) and always close both ']' and '}'.\n\n" +
  IMAGE_PROMPT_RULES +
  VOICE_AND_BGM_RULES +
  JSON_SCHEMA_SPEC;

const TOPIC_SYSTEM_PROMPT =
  "You are an elite YouTube storyteller, scriptwriter, and film director.\n" +
  "Write crisp, punchy scenes where every scene delivers ONE complete, self-contained thought!\n\n" +
  "RULE 1 — COMPLETE SENTENCES & HIGH-RETENTION PACING (13 TO 16 SCENES):\n" +
  "- Create 13 to 16 ultra-crisp scenes (~7-12 words / ~2.5-3.5s each for Shorts; 14-18 scenes for 16:9 YouTube) with seamless narrative flow so visuals change every ~3 seconds!\n" +
  "- MANDATORY: Every slab's voiceover_text MUST be a complete, finished sentence ending with '.', '!', '?', or '।' — NEVER end a slab on a comma (','), conjunction ('और', 'फिर', 'and', 'or'), or unfinished fragment!\n" +
  "- Put an explosive 2-second hook in Scene 1 with a bold number or shocking question.\n" +
  "- Write how a real Indian creator actually talks on mic — natural conversational Hinglish/Hindi with expressive punctuation ('!', '?', '...') and genuine excitement/curiosity instead of stiff textbook narration.\n" +
  "- When writing in Hindi: use accurate Devanagari spelling (करोड़, बॉक्स ऑफिस, थिएटर, डूम्ज़-डे) and MANDATORY respectful plural pronouns (वे, उनकी, उनका, उन्हें) for deities and elders.\n" +
  "- Never put unescaped double quotes inside JSON strings (use single quotes if needed) and always close both ']' and '}'.\n\n" +
  IMAGE_PROMPT_RULES +
  VOICE_AND_BGM_RULES +
  JSON_SCHEMA_SPEC;

export function resolveEffectiveVoiceTone(voiceTone: VoiceTone, contentMode: ContentMode = 'AUTO'): VoiceTone {
  if (voiceTone !== 'AUTO') return voiceTone;
  switch (contentMode) {
    case 'MOVIE_ROAST':
      return 'FUNNY';
    case 'REACTION':
    case 'REVIEW':
      return 'ENERGETIC';
    case 'STORY':
      return 'SERIOUS';
    case 'KIDS_STORY':
    case 'COOKING':
      return 'NATURAL';
    default:
      return 'AUTO';
  }
}

export function resolveEffectiveVisualStyle(
  visualStyle: VisualStyleMode,
  contentMode: ContentMode = 'AUTO'
): VisualStyleMode {
  if (visualStyle !== 'AUTO') return visualStyle;
  if (contentMode === 'KIDS_STORY') return 'PIXAR_3D';
  return 'AUTO';
}

function buildContentModeDirective(contentMode: ContentMode): string {
  switch (contentMode) {
    case 'REVIEW':
      return [
        'CONTENT MODE ACTIVE — MOVIE / TRAILER REVIEW:',
        '- Structure: Explosive 2s curiosity hook -> spoiler-free setup -> cast, director & music breakdown -> star/hype verdict + audience rating poll.',
        '- VISUALS: Mandatory real_photo (or layout_mode="flip" for pairs like Director+Movie Poster or Lead Cast duo) for EVERY named real actor, director, singer & official movie poster. Use raw 35mm live-action cinema scenes for original plot/reaction beats.',
        '- BADGES & BGM: Include star/hype stat_badge on the verdict scene (e.g. "4/5 STARS", "8/10 HYPE", "MUST WATCH?"). Prefer epic_action or suspense_thriller bgm_mood.',
      ].join('\n');
    case 'MOVIE_ROAST':
      return [
        'CONTENT MODE ACTIVE — FUNNY MOVIE ROAST:',
        '- Structure: Sharp, savage-yet-playful Indian YouTube creator comedy! Roast logic holes, dramatic tropes, and absurd stunts using ultra-crisp 6-10 word punchline scenes.',
        '- VISUALS: Combine real_photo of named actors/movies with 2 to 4 well-timed meme_clip GIF cuts ("Disappointed Fan", "Confused Nick Young", "Facepalm", "Wait What") AND comedic satirical AI scenes.',
        '- BADGES & BGM: Use witty uppercase punch stat_badge cues on roast moments ("LOGIC RIP", "WAIT WHAT?", "100% OVERACTING"). Set bgm_mood="comedy_roast" and vary voice_emotion between "roast", "hook", and "excited".',
      ].join('\n');
    case 'REACTION':
      return [
        'CONTENT MODE ACTIVE — CREATOR / AUDIENCE REACTION:',
        '- Structure: First-person live creator reaction tone ("Bhai ruko! Yahan kya notice kiya?", "Is moment pe goosebumps aaye!"), rewind/pause callouts, and an opinion-split closing poll.',
        '- VISUALS: Use layout_mode="split" or "flip" on 3 to 5 scenes pairing the movie/topic subject on Panel 1 with high-emotion live reaction photography or meme_clip cuts on Panel 2.',
        '- BADGES & BGM: Use crisp reaction stat_badge cues ("MIND BLOWN", "WAIT FOR IT", "GOOSEBUMPS"). Vary voice_emotion between "hook", "excited", "question", "climax".',
      ].join('\n');
    case 'STORY':
      return [
        'CONTENT MODE ACTIVE — CINEMATIC STORYTELLING (KAHANI):',
        '- Structure: Classic high-retention story arc — Scene 1 cliffhanger hook -> Named protagonist & world -> Rising conflict -> Mid-story shocking twist -> Emotional/thrilling climax & ending takeaway.',
        '- VISUALS: STRICTLY visual_source="ai_generated" (real_photo_query="") across ALL scenes so random internet photos NEVER break story immersion! Lock character_bible (exact age, face, hair, clothing colors) across every has_character=true scene and vary wide/medium/close-up camera angles + layout_mode="flip" on climax beats.',
        '- BADGES & BGM: Keep stat_badge empty ("") on most scenes (only optional story chapter/time cues like "THE TWIST" or "10 YEARS LATER"). Use suspense_thriller, emotional_sad, or horror_dark bgm_mood.',
      ].join('\n');
    case 'KIDS_STORY':
      return [
        'CONTENT MODE ACTIVE — KIDS MORAL / BEDTIME STORY:',
        '- Structure: Simple, warm, playful storytelling (cute animals, magic, friendship, adventure) in easy language, ending with a clear heartfelt "Moral of the Story"!',
        '- CONTENT SAFETY MANDATORY: ZERO horror, ZERO gore, ZERO violence, ZERO scary monsters — keep every scene joyful, magical, safe, and child-friendly.',
        '- VISUALS: STRICTLY visual_source="ai_generated" (zero real_photo, zero video_clip/meme_clip!). Bright sunlit 3D Pixar Disney storybook animation aesthetic, cute expressive characters locked via character_bible.',
        '- BADGES & BGM: Keep captions clean and friendly (stat_badge="" or simple "MORAL TIME!"). Set bgm_mood="motivational" and voice_emotion="warm" / "excited".',
      ].join('\n');
    case 'COOKING':
      return [
        'CONTENT MODE ACTIVE — COOKING / RECIPE SHORTS:',
        '- Structure: Mouth-watering 2s hook ("Sirf 10 min me restaurant jaisa...") -> Ingredients showcase -> Step-by-step tadka/cooking -> Secret chef tip -> Sizzling final plating & taste verdict.',
        '- VISUALS: STRICTLY visual_source="ai_generated" (zero real_photo, zero video_clip/meme_clip!) and has_character=false on dish close-ups! Write macro 45-degree DSLR food photography prompts (rising steam, sizzling golden tadka, vibrant spices, warm kitchen lighting).',
        '- BADGES & BGM: Put crisp cooking step stat_badge cues on key stages ("STEP 1", "STEP 2", "SECRET TIP", "READY!"). Set bgm_mood="motivational" and cheerful energetic host delivery.',
      ].join('\n');
    default:
      return '';
  }
}

function buildVoiceToneDirective(voiceTone: VoiceTone): string {
  switch (voiceTone) {
    case 'NATURAL':
      return 'Podcast / Human studio style: warm, conversational, relatable spoken cadence like a real YouTube host talking close to a condenser mic.';
    case 'FUNNY':
      return 'Funny / Comic style: witty, playful sarcasm, punchy setup-and-payoff comedic rhythm, expressive reactions.';
    case 'SERIOUS':
      return 'Serious / Intense style: dramatic trailer-voice gravitas, tense stakes, weighty dramatic pauses.';
    case 'ENERGETIC':
      return 'Energetic / Hype style: fast high-voltage hook, explosive excitement, crisp exclamation beats.';
    default:
      return 'Auto dynamic storytelling style: natural conversational flow matched to each scene\'s emotion.';
  }
}

function buildVisualStyleDirective(visualStyle: VisualStyleMode, contentMode: ContentMode = 'AUTO'): string {
  const effectiveStyle = resolveEffectiveVisualStyle(visualStyle, contentMode);
  switch (effectiveStyle) {
    case 'PIXAR_3D':
      return [
        "VISUAL MEDIUM MANDATORY — 3D PIXAR ANIMATED STORY FILM:",
        "- Set visual_style to '3D Pixar Disney animated feature film, stylized CGI characters, rich global illumination, soft volumetric sunlight'.",
        "- Set character_bible to ONE concrete, repeatable 3D character design (exact age, hairstyle, outfit colors, signature prop) and carry those exact outfit/face traits into every has_character=true scene so the 3D hero looks consistent across the entire video!",
        "- Use visual_source='ai_generated' and real_photo_query='' for EVERY scene (zero real photos, zero video_clip/meme_clip).",
        "- Prefix EVERY image_prompt with '3D Pixar Disney CGI animated scene,' followed by concrete 3D action, lighting, and camera framing.",
        "- MULTI-ANGLE 3D CUTS: Make 2 to 3 peak scenes (Hook Scene 1, Mid-Climax, Finale) use layout_mode='flip' with visual_source='ai_generated', visual_source_2='ai_generated', image_prompt = wide/establishing 3D angle, and image_prompt_2 = dramatic close-up or reverse action angle of that EXACT same 3D moment so the camera cuts dynamically like an animated movie!",
      ].join('\n');
    case 'ANIME_3D':
      return [
        "VISUAL MEDIUM MANDATORY — CINEMATIC ANIME ANIMATION:",
        "- Set visual_style to 'Makoto Shinkai anime feature film, expressive cel-shaded animation, dramatic volumetric light rays, vibrant depth'.",
        "- Lock character_bible (hair color, jacket/outfit, eyes) across every has_character=true scene and keep visual_source='ai_generated', real_photo_query='' for all scenes.",
        "- Prefix EVERY image_prompt with 'Cinematic anime animation film frame,' and use layout_mode='flip' with a 2nd close-up/action angle (image_prompt_2) on 2 to 3 peak scenes!",
      ].join('\n');
    case 'LIVE_ACTION':
      return "VISUAL MEDIUM MANDATORY — RAW LIVE-ACTION 35mm FILM: Keep every ai_generated prompt as a realistic 35mm DSLR live-action film still (no cartoon/3D/anime), and use real_photo/video_clip cleanly when real actors or movies fit.";
    default:
      return "Visual Style Auto: Honor user's requested style if stated (e.g., 3D Pixar, anime); for 3D animated stories, keep character_bible locked across scenes and use layout_mode='flip' on 2-3 peak dramatic beats for dynamic wide-to-closeup 3D camera cuts.";
  }
}

function isInstructionOrBriefPrompt(input: string, language: VideoLanguageKey): boolean {
  const lower = input.toLowerCase();
  const metaPromptRegex =
    /(?:\b(act\s+as|act\s+like|behave\s+like|roleplay\s+as|you\s+are\s+(?:a|an|the)?\b|your\s+task\s+is|your\s+job\s+is|prompt\s+engineer|image\s+generation\s+prompts?|critical\s+instructions|data\s+to\s+include|include\s+in\s+(?:the\s+)?script|include\s*:|aspect\s+ratio|9:16|16:9|do\s+not\s+generate|describe\s+(?:him|her|it|the\s+scene)\s+as|video_clip|meme_clip|real_photo|stat_badge|bgm_mood|youtube\s+short\s+style|movie\s+spot\s+director|director\.)\b|9\s*:\s*16|16\s*:\s*9)/i;
  if (metaPromptRegex.test(input)) return true;

  const sceneDirectionRegex =
    /(?:^|\n)\s*(?:scene\s*\d+\s*[:-]|visuals?\s*:|image\s*prompt\s*:|voiceover\s*:|narration\s*:|include\s*:|hook\s*:|climax\s*:|style\s*:|\[visual[^\]]*\])/i;
  if (sceneDirectionRegex.test(input)) return true;

  const writeScriptRegex =
    /\b(write|create|generate|make|prepare|build|craft)\s+(?:me\s+)?(?:a|an|the)?\s*(?:[\w:-]+\s+){0,5}(?:voiceover\s+)?(?:script|short|shorts|video|story|reel|scene|breakdown|review|roast|explainer)\b/i;
  if (writeScriptRegex.test(input)) return true;

  const hindiPromptRegex =
    /(?:\b(script\s+likh\w*|video\s+bana\w*|short\s+bana\w*|reel\s+bana\w*|scene\s+bana\w*|visual\w*\s+bana\w*|par\s+(?:ek\s+)?video|ke\s+baare\s+mein\s+video|hindi\s+mein\s+(?:script|video)|(?:pehle|doosre|dusre|teesre|tisre)\s+scene\s+(?:me|mein)|scene\s+(?:me|mein)\s+.*dikha\w*)\b|स्क्रिप्ट\s+लिख|वीडियो\s+बना|शॉर्ट\s+बना)/i;
  if (hindiPromptRegex.test(input)) return true;

  const lines = input.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const bulletLines = lines.filter(
    (l) => l.startsWith('- ') || l.startsWith('* ') || l.startsWith('• ') || /^\d+[.)]\s+.+/.test(l)
  ).length;
  const hasBriefHeaders = [
    'release date:',
    'advance booking:',
    'prediction:',
    'highlight:',
    'topic:',
    'instructions:',
    'requirements:',
    'note:',
    'include:',
    'hook:',
  ].some((h) => lower.includes(h));
  if (bulletLines >= 2 && hasBriefHeaders) return true;

  if (
    ['HINDI', 'MARATHI', 'GUJARATI', 'BENGALI', 'TAMIL', 'TELUGU', 'KANNADA', 'MALAYALAM', 'PUNJABI'].includes(
      language
    )
  ) {
    let nonAsciiLetters = 0;
    let latinLetters = 0;
    for (const ch of input) {
      const code = ch.charCodeAt(0);
      if (code > 127 && /\p{L}/u.test(ch)) nonAsciiLetters++;
      if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) latinLetters++;
    }
    if (nonAsciiLetters === 0 && latinLetters > 40 && input.split(/\s+/).length <= 55) {
      return true;
    }
  }

  return false;
}

export async function fetchTrendingMovieTopics(): Promise<string[]> {
  const rssUrl =
    'https://news.google.com/rss/search?q=Bollywood+OR+Hollywood+OR+Tollywood+box+office+movie+when:3d&hl=en-IN&gl=IN&ceid=IN:en';
  const xml = await fetchTextString(rssUrl, WIKIMEDIA_USER_AGENT);
  if (!xml) return [];

  const itemTitleRegex = /<item>.*?<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/gis;
  const results: string[] = [];
  const seen = new Set<string>();

  for (const match of xml.matchAll(itemTitleRegex)) {
    let title = (match[1] ?? '')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
    const lastDash = title.lastIndexOf(' - ');
    if (lastDash > 0) title = title.slice(0, lastDash);
    title = title.trim();

    if (title.length >= 12 && !seen.has(title)) {
      seen.add(title);
      results.push(title);
      if (results.length >= 8) break;
    }
  }
  return results;
}

async function resolveCandidateModels(groqApiKey: string): Promise<string[]> {
  if (cachedChatModels && cachedChatModels.length > 0) return cachedChatModels;

  let discovered: string[] = [];
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
        Accept: 'application/json',
      },
    });
    if (res.ok) {
      const root = (await res.json()) as { data?: Array<{ id?: string }> };
      discovered = (root.data ?? [])
        .map((item) => (item.id ?? '').trim())
        .filter((id) => {
          const lower = id.toLowerCase();
          return (
            id.length > 0 &&
            !lower.includes('whisper') &&
            !lower.includes('tts') &&
            !lower.includes('orpheus') &&
            !lower.includes('guard') &&
            !lower.includes('embed') &&
            !lower.includes('compound')
          );
        });
    }
  } catch {
    discovered = [];
  }

  const preferredOrder = [
    'openai/gpt-oss-120b',
    'llama-3.3-70b-versatile',
    'meta-llama/llama-4-maverick-17b-128e-instruct',
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'qwen/qwen3-32b',
    'openai/gpt-oss-20b',
    'llama-3.1-8b-instant',
  ];

  let finalModels: string[];
  if (discovered.length > 0) {
    const sorted: string[] = [];
    for (const pref of preferredOrder) {
      const found = discovered.find((d) => d.toLowerCase() === pref.toLowerCase());
      if (found) sorted.push(found);
    }
    for (const id of discovered) {
      const lower = id.toLowerCase();
      if (!sorted.includes(id) && (lower.includes('qwen') || lower.includes('llama') || lower.includes('gpt-oss'))) {
        sorted.push(id);
      }
    }
    const distinct = [...new Set(sorted)].slice(0, 4);
    finalModels = distinct.length > 0 ? distinct : discovered.slice(0, 3);
    cachedChatModels = finalModels;
  } else {
    finalModels = [
      'openai/gpt-oss-120b',
      'llama-3.3-70b-versatile',
      'openai/gpt-oss-20b',
      'llama-3.1-8b-instant',
    ];
  }
  return finalModels;
}

export async function generateScript(params: {
  topic: string;
  isShorts?: boolean;
  language?: VideoLanguageKey;
  voiceGender?: VoiceGender;
  inputMode?: InputMode;
  voiceTone?: VoiceTone;
  visualStyle?: VisualStyleMode;
  contentMode?: ContentMode;
}): Promise<VideoScriptResponse> {
  const cleanInput = params.topic.trim();
  if (!cleanInput) throw new Error('Topic must not be blank.');

  const groqApiKey = (process.env.GROQ_API_KEY ?? '').trim();
  if (!groqApiKey) {
    throw new Error('GROQ_API_KEY is empty. Please configure GROQ_API_KEY in environment variables.');
  }

  const isShorts = params.isShorts ?? true;
  const language: VideoLanguageKey = params.language ?? 'AUTO';
  const voiceGender: VoiceGender = params.voiceGender ?? 'MALE';
  const inputMode: InputMode = params.inputMode ?? 'AUTO';
  const contentMode: ContentMode = params.contentMode ?? 'AUTO';
  const voiceTone: VoiceTone = resolveEffectiveVoiceTone(params.voiceTone ?? 'AUTO', contentMode);
  const visualStyle: VisualStyleMode = resolveEffectiveVisualStyle(params.visualStyle ?? 'AUTO', contentMode);

  const inputWords = cleanInput.split(/\s+/).filter(Boolean);
  const inputWordCount = inputWords.length;

  const isFullScriptMode =
    inputMode === 'EXACT_SCRIPT'
      ? true
      : inputMode === 'AI_PROMPT'
      ? false
      : inputWordCount > FULL_SCRIPT_WORD_THRESHOLD && !isInstructionOrBriefPrompt(cleanInput, language);

  const systemPrompt = isFullScriptMode ? FULL_SCRIPT_SYSTEM_PROMPT : TOPIC_SYSTEM_PROMPT;
  const targetGenderLabel = voiceGender === 'FEMALE' ? 'Female' : 'Male';
  const toneDirective = buildVoiceToneDirective(voiceTone);
  const styleDirective = buildVisualStyleDirective(visualStyle, contentMode);
  const modeDirective = buildContentModeDirective(contentMode);
  const langConfig = VIDEO_LANGUAGES[language] ?? VIDEO_LANGUAGES.AUTO;

  const languageDirective =
    language === 'AUTO'
      ? `Language: Auto-detect from user request. Default to spoken Hindi (Devanagari) with voice_name '${resolveLanguageVoice(
          'HINDI',
          voiceGender
        )}', UNLESS the user explicitly requested another language (e.g. English, Marathi, Gujarati, Bengali, Tamil, Telugu, Kannada, Malayalam, Punjabi, Urdu, Spanish, French, Japanese, Arabic), in which case write in THAT language and pick the matching ${targetGenderLabel} Edge TTS voice_name.`
      : `Language MANDATORY: Write ALL voiceover_text strictly in ${langConfig.languageInstruction} and set voice_name to '${resolveLanguageVoice(
          language,
          voiceGender
        )}'.`;

  const userPrompt = isFullScriptMode
    ? [
        `MODE: FULL USER SCRIPT (${inputWordCount} words).`,
        "DO NOT rewrite, paraphrase, translate, add, or change a single word. Keep the EXACT user text intact and split sequentially into 11 to 16 cohesive spoken scenes (6-14 words each).",
        "MERGE SHORT HOOKS / SPLIT LONG CAST LINES: Combine tiny 1-3 word exclamations (e.g., 'रुको!', 'लेकिन एक मिनट!') with the following sentence, AND split long 20+ word sentences at commas/conjunctions (e.g., lead pair vs supporting cast in separate scenes). NEVER split inside a full name or cross a period.",
        modeDirective,
        styleDirective,
        "CAST, POSTERS & CLIPS: Whenever ANY real actor, director, or singer is named (and style is not 3D/Anime and Content Mode is not STORY/KIDS_STORY/COOKING), visual_source MUST be 'real_photo' with ONLY their clean English full name (NEVER ai_generated for a real person!). If BOTH a director/actor AND a movie OR TWO actors appear in the same scene, set visual_source='real_photo', layout_mode='flip', visual_source_2='real_photo' (e.g., 'Sooraj Barjatya' + 'Yeh Prem Mol Liya movie poster', 'Ayushmann Khurrana' + 'Sharvari Wagh', 'Anupam Kher' + 'Seema Pahwa').",
        "100% ASCII ENGLISH PROMPTS: NEVER leave Devanagari/Hindi words inside image_prompt or real_photo_query! Also NEVER prompt calendars, split-screen, UI icons, streaming icons, meters, gauges, scorecards, bold text, cards, or rating numbers in image_prompt (put ratings/dates like '8/10 HYPE METER' or '27 NOV' in stat_badge and depict cheering cinema/dramatic reaction scenes in image_prompt).",
        `Set voice_name matching the script's language and ${targetGenderLabel} gender (e.g., Hindi: ${resolveLanguageVoice(
          'HINDI',
          voiceGender
        )}, English IN: ${resolveLanguageVoice('ENGLISH_IN', voiceGender)}, English US: ${resolveLanguageVoice(
          'ENGLISH_US',
          voiceGender
        )}, Marathi: ${resolveLanguageVoice('MARATHI', voiceGender)}).`,
        `Voice delivery style: ${toneDirective}`,
        "Return ONLY ONE complete valid JSON object with properly closed 'slabs' array ']' and root object '}'. Avoid unescaped double quotes inside JSON strings.",
        '',
        'USER SCRIPT:',
        cleanInput,
      ].filter(Boolean).join('\n')
    : [
        `MODE: TOPIC / DIRECTOR PROMPT MODE (${inputWordCount} words). ACT ON EVERY INSTRUCTION BELOW AS THE FILM DIRECTOR:`,
        cleanInput,
        '',
        modeDirective,
        styleDirective,
        '',
        'CRITICAL DIRECTOR & GROWTH PROMPT RULES:',
        "1) NEVER speak or copy meta-instructions ('Act as...', 'Create a fast 9:16...', 'Write a script...', 'Include...', 'Data to include', 'Scene 1:', 'Visual:', 'Image prompts') into voiceover_text! Put ONLY natural spoken storytelling narration in voiceover_text.",
        "2) Whenever the user describes visuals, scenes, camera shots, character appearance/costume, lighting, props, or style (in English, Hindi, or Hinglish), put those EXACT visual details right at the BEGINNING of image_prompt (in crisp English) with visual_source='ai_generated' — NEVER replace described visuals with generic crowds or unrelated real_photo.",
        "3) Match each scene's image_prompt to THAT SPECIFIC scene's action/subject! If a scene focuses on food/ingredients, scenery, or a secondary character, put THAT subject FIRST in image_prompt and set has_character=false. NEVER include gibberish-prone text, logos, cinema marquees, or hands gripping microphones.",
        "4) Keep every scene's voiceover_text as ONE complete, finished sentence ending in '.', '!', '?' or '।' (7-12 words; NEVER leave a trailing comma or unfinished word like 'और'/'and'/'or'). Use 'video_clip'/'meme_clip' ONLY when Content Mode fits (Review, Movie Roast, Reaction); for Story, Kids Story, or Cooking use 'ai_generated'.",
        languageDirective,
        `Voice delivery & writing tone: ${toneDirective}`,
        `Format guideline: ${
          isShorts
            ? 'Vertical 9:16 YouTube Shorts. Unless the user specifies another length, create 13 to 16 fast-paced scenes (7-12 words / ~2.5-3.5s each, ~45-50s total) with a 2s Hook, mid-video twist, and comment CTA!'
            : 'Horizontal 16:9 YouTube video. Unless the user specifies another length, create 14 to 18 tightly connected scenes (~65-80s total).'
        }`,
        "Write an expressive, complete narration across all scenes where each scene ends cleanly on a full thought with varied per-scene voice_emotion ('hook', 'excited', 'climax', 'suspense', 'sad', 'roast', 'question', 'warm', 'normal'), exclamation (!), question (?), and dramatic pauses (...) so voice intonation sounds dynamic and alive — NEVER a flat newsreader.",
        "Return ONLY ONE complete valid JSON object with properly closed 'slabs' array ']' and root object '}'. Avoid unescaped double quotes inside JSON string values; use single quotes if quoting dialogue.",
      ].filter(Boolean).join('\n');

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const candidateModels = await resolveCandidateModels(groqApiKey);
  const attempts: Array<{ modelId: string; useJsonMode: boolean; maxTokens: number }> = [];
  candidateModels.forEach((modelId, idx) => {
    const tokens =
      modelId.toLowerCase().includes('gpt-oss') || modelId.toLowerCase().includes('qwen') ? 16384 : 8192;
    attempts.push({ modelId, useJsonMode: true, maxTokens: tokens });
    if (idx === 0) attempts.push({ modelId, useJsonMode: false, maxTokens: tokens });
  });

  const attemptErrors: string[] = [];
  let lastError: unknown = null;

  for (let idx = 0; idx < attempts.length; idx++) {
    const attempt = attempts[idx];
    try {
      const payload: Record<string, unknown> = {
        model: attempt.modelId,
        messages,
        temperature: isFullScriptMode ? 0.2 : 0.75,
        max_tokens: attempt.maxTokens,
      };
      if (attempt.useJsonMode) {
        payload.response_format = { type: 'json_object' };
      }

      const data = await callWithRetry(async () => {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${groqApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          const err = new Error(`HTTP ${res.status} Error at Groq: ${text.slice(0, 200)}`) as Error & {
            status?: number;
          };
          err.status = res.status;
          throw err;
        }
        return (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      });

      const generatedText = data.choices?.[0]?.message?.content?.trim();
      if (!generatedText) {
        throw new Error(`Groq (${attempt.modelId}) returned empty result.`);
      }

      return parseScriptResponse(generatedText, language, voiceGender);
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message.slice(0, 140) : String(err);
      attemptErrors.push(`${attempt.modelId}(json=${attempt.useJsonMode}): ${msg}`);
      if (idx === attempts.length - 1) {
        throw new Error(attemptErrors.join(' | '));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to generate script.');
}

async function callWithRetry<T>(fn: () => Promise<T>, maxAttempts = 5): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number })?.status;
      const retryable = status === 429 || (status !== undefined && status >= 500 && status <= 599) || !status;
      if (retryable && attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      } else {
        throw err;
      }
    }
  }
  throw lastError;
}

export function enforceVoiceGender(voiceName: string, requestedGender: VoiceGender): string {
  const clean = voiceName.trim();
  const langs = Object.values(VIDEO_LANGUAGES).filter((l) => l.key !== 'AUTO');
  if (clean) {
    const exact = langs.find(
      (l) => l.maleVoice.toLowerCase() === clean.toLowerCase() || l.femaleVoice.toLowerCase() === clean.toLowerCase()
    );
    if (exact) return requestedGender === 'FEMALE' ? exact.femaleVoice : exact.maleVoice;

    const localePrefix = clean.split('-').slice(0, 2).join('-').toLowerCase();
    if (localePrefix) {
      const byLocale = langs.find((l) => l.maleVoice.toLowerCase().startsWith(localePrefix));
      if (byLocale) return requestedGender === 'FEMALE' ? byLocale.femaleVoice : byLocale.maleVoice;
    }

    const langCode = clean.split('-')[0]?.toLowerCase() ?? '';
    if (langCode.length >= 2) {
      const byLang = langs.find((l) => l.maleVoice.toLowerCase().startsWith(`${langCode}-`));
      if (byLang) return requestedGender === 'FEMALE' ? byLang.femaleVoice : byLang.maleVoice;
    }
  }
  return resolveLanguageVoice('HINDI', requestedGender);
}

function parseScriptResponse(
  rawText: string,
  requestedLanguage: VideoLanguageKey,
  requestedGender: VoiceGender
): VideoScriptResponse {
  const extracted = extractJsonPayload(rawText);
  const repaired = repairJsonStructure(extracted).replace(/,\s*([}\]])/g, '$1');
  const root = JSON.parse(repaired) as Record<string, unknown> | unknown[];

  let characterBible = '';
  let visualStyle = '';
  let bgmMood = 'epic_action';
  let parsedVoiceName = '';
  let youtubeTitle = '';
  let youtubeDescription = '';
  let youtubeHashtags = '';
  let pinnedComment = '';
  let slabElements: unknown[] = [];

  if (Array.isArray(root)) {
    slabElements = root;
  } else if (root && typeof root === 'object') {
    characterBible = String(root.character_bible ?? '').trim();
    visualStyle = String(root.visual_style ?? '').trim();
    bgmMood = String(root.bgm_mood ?? '').trim() || 'epic_action';
    parsedVoiceName = String(root.voice_name ?? '').trim();
    youtubeTitle = String(root.youtube_title ?? '').trim();
    youtubeDescription = String(root.youtube_description ?? '').trim();
    youtubeHashtags = String(root.youtube_hashtags ?? '').trim();
    pinnedComment = String(root.pinned_comment ?? '').trim();

    const arr =
      (Array.isArray(root.slabs) && root.slabs) ||
      (Array.isArray(root.scenes) && root.scenes) ||
      (Array.isArray(root.script) && root.script) ||
      (Object.values(root).find((v) => Array.isArray(v)) as unknown[] | undefined);

    if (!arr) throw new Error('Expected a JSON array of scenes in Groq response.');
    slabElements = arr;
  } else {
    throw new Error('Groq response must be a JSON array or object.');
  }

  const allowedSources = new Set(['ai_generated', 'real_photo', 'video_clip', 'meme_clip']);
  const allowedEmotions = new Set([
    'hook',
    'excited',
    'climax',
    'suspense',
    'sad',
    'roast',
    'question',
    'warm',
    'normal',
  ]);

  const toAsciiClean = (s: string) => s.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();

  const slabs: VideoSlab[] = [];
  slabElements.forEach((el, index) => {
    if (!el || typeof el !== 'object') return;
    const dto = el as Record<string, unknown>;
    const voiceover = String(dto.voiceover_text ?? '').trim();
    const rawPrompt = toAsciiClean(String(dto.image_prompt ?? '').trim());
    const prompt = rawPrompt || 'dramatic 35mm live action cinema scene with moody warm lighting';
    if (!voiceover) return;

    const sfxCue = String(dto.sfx_cue ?? '').trim().toLowerCase() || 'whoosh';
    const rawEmotion = String(dto.voice_emotion ?? '').trim().toLowerCase();
    const emotion = allowedEmotions.has(rawEmotion) ? rawEmotion : 'normal';

    const rawQuery = toAsciiClean(String(dto.real_photo_query ?? '').trim());
    const realQuery = ['none', 'null', 'n/a', '-'].includes(rawQuery.toLowerCase()) ? '' : rawQuery;
    const requestedSource = String(dto.visual_source ?? '').trim().toLowerCase();
    const visualSource =
      allowedSources.has(requestedSource) && (requestedSource === 'ai_generated' || realQuery.length > 0)
        ? requestedSource
        : 'ai_generated';

    const rawQuery2 = toAsciiClean(String(dto.real_photo_query_2 ?? '').trim());
    const realQuery2 = ['none', 'null', 'n/a', '-'].includes(rawQuery2.toLowerCase()) ? '' : rawQuery2;
    const prompt2 = toAsciiClean(String(dto.image_prompt_2 ?? '').trim());
    const visualSource2 =
      String(dto.visual_source_2 ?? '').trim().toLowerCase() === 'real_photo' && realQuery2.length > 0
        ? 'real_photo'
        : prompt2.length > 0
        ? 'ai_generated'
        : '';

    const rawLayout = String(dto.layout_mode ?? '').trim().toLowerCase();
    const hasSecondVisual = (visualSource2 === 'real_photo' && realQuery2.length > 0) || prompt2.length > 0;
    const layoutMode =
      visualSource !== 'video_clip' &&
      visualSource !== 'meme_clip' &&
      hasSecondVisual &&
      (rawLayout === 'split' || rawLayout === 'flip')
        ? rawLayout
        : 'single';

    const statBadge = sanitizeStatBadge(String(dto.stat_badge ?? ''));

    slabs.push({
      id: typeof dto.id === 'number' ? dto.id : index + 1,
      voiceover_text: voiceover,
      image_prompt: prompt,
      sfx_cue: sfxCue,
      has_character: Boolean(dto.has_character ?? false),
      voice_emotion: emotion,
      visual_source: visualSource,
      real_photo_query: visualSource !== 'ai_generated' ? realQuery : '',
      layout_mode: layoutMode,
      visual_source_2: layoutMode !== 'single' ? visualSource2 : '',
      real_photo_query_2: layoutMode !== 'single' && visualSource2 === 'real_photo' ? realQuery2 : '',
      image_prompt_2: layoutMode !== 'single' ? prompt2 : '',
      stat_badge: statBadge,
    });
  });

  if (slabs.length === 0) throw new Error('Groq returned an empty script.');

  const finalVoiceName =
    requestedLanguage !== 'AUTO'
      ? resolveLanguageVoice(requestedLanguage, requestedGender)
      : enforceVoiceGender(parsedVoiceName, requestedGender);

  return {
    character_bible: characterBible,
    visual_style: visualStyle,
    bgm_mood: bgmMood,
    voice_name: finalVoiceName,
    youtube_title: youtubeTitle,
    youtube_description: youtubeDescription,
    youtube_hashtags: youtubeHashtags,
    pinned_comment: pinnedComment,
    slabs,
  };
}

function sanitizeStatBadge(raw: string): string {
  const clean = raw.trim().replace(/\s+/g, ' ').slice(0, 32);
  if (!clean) return '';
  const upper = clean.toUpperCase();
  const placeholders = new Set([
    'STAT', 'BADGE', 'STAT BADGE', 'TITLE', 'TEXT', 'INFO', 'FACT',
    'NUMBER', 'PLACEHOLDER', 'HEADLINE', 'NONE', 'NULL', 'N/A', '-', 'TBD',
  ]);
  if (placeholders.has(upper)) return '';
  if (/\b(MIN|MINUTE|MINUTES|COOK|POT|BIRYANI|STEAM)\b/.test(upper)) {
    return upper.replace(/\bDAM\b/g, 'DUM').slice(0, 32);
  }
  return upper;
}

function extractJsonPayload(rawText: string): string {
  const cleaned = rawText
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  const firstBrace = cleaned.indexOf('{');
  const firstArrayMatch = cleaned.match(/\[\s*\{/);
  const firstArrayStart = firstArrayMatch?.index ?? -1;

  let startIndex = -1;
  if (firstBrace !== -1 && (firstArrayStart === -1 || firstBrace < firstArrayStart)) {
    startIndex = firstBrace;
  } else if (firstArrayStart !== -1) {
    startIndex = firstArrayStart;
  } else {
    startIndex = cleaned.indexOf('[');
  }
  return startIndex >= 0 ? cleaned.slice(startIndex) : cleaned;
}

function repairJsonStructure(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;

  const out: string[] = [];
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  const stripTrailing = () => {
    while (out.length > 0 && /\s/.test(out[out.length - 1])) out.pop();
    if (out.length > 0 && (out[out.length - 1] === ',' || out[out.length - 1] === ':')) out.pop();
  };

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inString) {
      if (escaped) {
        out.push(ch);
        escaped = false;
      } else if (ch === '\\') {
        out.push(ch);
        escaped = true;
      } else if (ch === '"') {
        out.push(ch);
        inString = false;
      } else if (ch === '\n') {
        out.push('\\n');
      } else if (ch === '\r') {
        out.push('\\r');
      } else if (ch === '\t') {
        out.push('\\t');
      } else if (ch.charCodeAt(0) < 0x20) {
        out.push(' ');
      } else {
        out.push(ch);
      }
      continue;
    }

    if (ch === '"') {
      out.push(ch);
      inString = true;
    } else if (ch === '{') {
      out.push(ch);
      stack.push('}');
    } else if (ch === '[') {
      out.push(ch);
      stack.push(']');
    } else if (ch === '}' || ch === ']') {
      if (stack.length === 0) break;
      if (stack[stack.length - 1] === ch) {
        out.push(ch);
        stack.pop();
      } else if (stack.includes(ch)) {
        while (stack.length > 0 && stack[stack.length - 1] !== ch) {
          stripTrailing();
          out.push(stack.pop()!);
        }
        if (stack.length > 0 && stack[stack.length - 1] === ch) {
          stripTrailing();
          out.push(ch);
          stack.pop();
        }
      }
      if (stack.length === 0) break;
    } else {
      out.push(ch);
    }
  }

  if (inString) {
    if (escaped && out.length > 0) out.pop();
    out.push('"');
  }
  while (stack.length > 0) {
    stripTrailing();
    out.push(stack.pop()!);
  }
  return out.join('');
}

function buildImageSuffix(promptLower: string, isShorts: boolean): string {
  const aspect = isShorts ? 'vertical 9:16 full-bleed single camera frame' : 'horizontal 16:9 full-bleed single camera frame';
  const is3dAnimated = ['3d', 'pixar', 'disney', 'cgi', 'dreamworks'].some((k) => promptLower.includes(k));
  const isStylized =
    is3dAnimated ||
    ['anime', 'cartoon', 'comic', 'illustration', 'oil painting', 'watercolor', 'sketch'].some((k) =>
      promptLower.includes(k)
    );

  if (is3dAnimated) {
    return `, ONE single unified 3D animated Pixar feature film frame, ${aspect}, cinematic depth of field, rich outdoor 3D environment, soft volumetric sunlight, single cohesive story shot, no repeating pattern, no wallpaper, no sticker sheet, no collage, no grid, no text, no watermark`;
  }
  if (isStylized) {
    return `, ONE single unified ${aspect}, ultra-detailed art direction, sharp focus, dramatic atmospheric lighting, no repeating pattern, no wallpaper, no collage, no grid, no split frames, no text, no watermark, no UI, no logos`;
  }
  return `, raw 35mm DSLR live-action movie set photograph, ONE single unified ${aspect}, candid film still, realistic natural skin pores and authentic textures, shallow depth of field, cinema lighting, clean unlabelled background, no collage, no grid, no multiple panels, no text, no words, no signs, no watermark, no UI, no logos`;
}

export async function generateImageForSlab(
  prompt: string,
  isShorts: boolean,
  seed: number,
  contentMode: ContentMode = 'AUTO'
): Promise<Buffer> {
  const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID ?? '').trim();
  const apiToken = (process.env.CLOUDFLARE_API_TOKEN ?? '').trim();
  const width = isShorts ? SHORTS_IMAGE_WIDTH : LANDSCAPE_IMAGE_WIDTH;
  const height = isShorts ? SHORTS_IMAGE_HEIGHT : LANDSCAPE_IMAGE_HEIGHT;
  const cleanPrompt = prompt.trim().replace(/[,.]+$/, '');
  const modePromptBoost =
    contentMode === 'COOKING' && !/\b(food photography|macro|kitchen|steam|plating)\b/i.test(cleanPrompt)
      ? `${cleanPrompt}, appetizing macro food photography, warm kitchen studio lighting, fresh garnish`
      : cleanPrompt;
  const finalPrompt = modePromptBoost + buildImageSuffix(modePromptBoost.toLowerCase(), isShorts);

  const errors: string[] = [];

  if (accountId && apiToken && Date.now() >= cloudflareExhaustedUntilMs) {
    const isCfTerminalCode = (err: unknown) => {
      const c = (err as { code?: number })?.code;
      return c === 401 || c === 403 || c === 429;
    };
    try {
      return await executeCloudflareWithRetry(() => requestFluxKlein9b(accountId, apiToken, finalPrompt, width, height));
    } catch (err) {
      if (isCfTerminalCode(err)) cloudflareExhaustedUntilMs = Date.now() + 10 * 60_000;
      errors.push(`flux-2-klein-9b: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
    }

    if (Date.now() >= cloudflareExhaustedUntilMs) {
      try {
        return await executeCloudflareWithRetry(() =>
          requestLucidOrigin(accountId, apiToken, finalPrompt, width, height, seed)
        );
      } catch (err) {
        if (isCfTerminalCode(err)) cloudflareExhaustedUntilMs = Date.now() + 10 * 60_000;
        errors.push(`lucid-origin: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
      }
    }

    if (Date.now() >= cloudflareExhaustedUntilMs) {
      try {
        return await executeCloudflareWithRetry(() => requestFluxSchnell(accountId, apiToken, finalPrompt));
      } catch (err) {
        if (isCfTerminalCode(err)) cloudflareExhaustedUntilMs = Date.now() + 10 * 60_000;
        errors.push(`flux-1-schnell: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
      }
    }
  }

  // Tier 2: AI Horde (free, watermark-free; smart live queue-aware model routing)
  const promptLower = modePromptBoost.toLowerCase();
  const is3dPrompt =
    contentMode === 'KIDS_STORY' ||
    ['3d', 'pixar', 'disney', 'cgi', 'dreamworks', 'blender'].some((k) => promptLower.includes(k));
  const isAnimePrompt = !is3dPrompt && ['anime', 'manga', 'cel-shaded', 'ghibli', 'shonen'].some((k) => promptLower.includes(k));
  const hordeTag = is3dPrompt
    ? ', 3D Pixar Disney CGI animation render, volumetric lighting, rich 3D depth, crisp detail, vibrant colors'
    : isAnimePrompt
    ? ', anime film frame, Makoto Shinkai cinematic lighting, crisp cel shading, high detail'
    : contentMode === 'COOKING'
    ? ', appetizing macro DSLR food photography, warm kitchen studio lighting, sharp focus'
    : ', photorealistic, crisp 35mm cinema photography, sharp focus, dramatic lighting';
  const hordeTagShort = is3dPrompt
    ? ', 3D Pixar CGI animated frame'
    : isAnimePrompt
    ? ', anime cinematic frame'
    : ', cinematic photograph';

  const baseNegative =
    'text, words, letters, typography, numbers, digits, watermark, signature, logo, banner, ui overlay, chart, gauge, meter, cards, collage, grid, split screen, deformed face, ugly face, distorted eyes, bad anatomy, extra fingers, mutated hands, blurry, lowres, worst quality, out of focus';
  const hordeNegativePrompt =
    contentMode === 'KIDS_STORY'
      ? `${baseNegative}, scary, horror, blood, gore, dark violence, creepy, nightmare, weapon`
      : baseNegative;

  const hordeStyle: '3d' | 'anime' | 'photo' = is3dPrompt ? '3d' : isAnimePrompt ? 'anime' : 'photo';
  const rankedHordeModels = await resolveFastAiHordeModels(hordeStyle).catch(() =>
    getFallbackHordeModels(hordeStyle)
  );
  const primaryModels = rankedHordeModels.slice(0, 3);
  const backupModels =
    rankedHordeModels.length > 3 ? rankedHordeModels.slice(3, 6) : getFallbackHordeModels(hordeStyle);

  const hordeWidth = isShorts ? 448 : 640;
  const hordeHeight = isShorts ? 704 : 384;
  const hordePrompt = `${modePromptBoost.slice(0, 360)}${hordeTag} ### ${hordeNegativePrompt}`;
  const hordeFallbackPrompt = `${modePromptBoost.slice(0, 220)}${hordeTagShort} ### ${hordeNegativePrompt}`;
  const hordeBuf =
    (await generateViaAiHorde(
      hordePrompt,
      hordeWidth,
      hordeHeight,
      16,
      seed,
      width,
      height,
      primaryModels
    ).catch(() => null)) ??
    (await generateViaAiHorde(
      hordeFallbackPrompt,
      isShorts ? 448 : 576,
      isShorts ? 576 : 448,
      14,
      seed + 13,
      width,
      height,
      backupModels
    ).catch(() => null));
  if (hordeBuf) return hordeBuf;

  // Tier 3: Pollinations (with Retry-After / 402 FREE_LIMIT cooldown handling)
  const pollHeight = isShorts ? height + 80 : height + 56;
  const pollStyleSuffix = is3dPrompt
    ? isShorts
      ? ', vertical 9:16 3D Pixar CGI animated frame, vibrant volumetric lighting, no text, no watermark'
      : ', horizontal 16:9 3D Pixar CGI animated frame, vibrant volumetric lighting, no text, no watermark'
    : isAnimePrompt
    ? isShorts
      ? ', vertical 9:16 anime feature film frame, dramatic lighting, no text, no watermark'
      : ', horizontal 16:9 anime feature film frame, dramatic lighting, no text, no watermark'
    : isShorts
    ? ', vertical 9:16 photo, cinematic lighting, no text, no watermark'
    : ', horizontal 16:9 photo, cinematic lighting, no text, no watermark';
  const pollPrompt = cleanPrompt.slice(0, 350) + pollStyleSuffix;
  const pollBuf =
    (await generateViaPollinations(pollPrompt, width, pollHeight, seed, width, height)) ??
    (await generateViaPollinations(cleanPrompt.slice(0, 180), width, pollHeight, seed + 7, width, height));
  if (pollBuf) return pollBuf;

  throw new Error(`Image generation failed: ${errors.join(' | ')}`);
}

let cachedHordeModelsAtMs = 0;
let cachedHordeModelsList: Array<{ name: string; count: number; eta: number; queued: number }> = [];

function getFallbackHordeModels(style: '3d' | 'anime' | 'photo'): string[] {
  if (style === '3d') {
    return ['Rev Animated', 'DreamShaper', '3D Animation Diffusion', 'AlbedoBase XL (SDXL)', 'Anything Diffusion'];
  }
  if (style === 'anime') {
    return ['Flat-2D Animerge', 'Nova Anime XL', 'MeinaMix', 'Counterfeit', 'Anything Diffusion'];
  }
  return ['Edge Of Realism', 'Rev Animated', 'Deliberate', 'AbsoluteReality', 'Analog Madness'];
}

async function resolveFastAiHordeModels(style: '3d' | 'anime' | 'photo'): Promise<string[]> {
  const preferredPool =
    style === '3d'
      ? [
          'Rev Animated',
          '3D Animation Diffusion',
          'DreamShaper',
          'Disney Pixar Cartoon',
          'AlbedoBase XL (SDXL)',
          'Flat-2D Animerge',
          'Anything Diffusion',
          'Deliberate',
        ]
      : style === 'anime'
      ? [
          'Nova Anime XL',
          'Flat-2D Animerge',
          'MeinaMix',
          'Counterfeit',
          'Anything Diffusion',
          'Abyss OrangeMix',
          'Animagine XL',
          'Rev Animated',
        ]
      : [
          'Edge Of Realism',
          'EpicRealism',
          'AbsoluteReality',
          'Realistic Vision',
          'Analog Madness',
          'Deliberate',
          'AlbedoBase XL (SDXL)',
          'Rev Animated',
        ];

  if (Date.now() - cachedHordeModelsAtMs > 60_000 || cachedHordeModelsList.length === 0) {
    const res = await fetch('https://aihorde.net/api/v2/status/models?type=image', {
      headers: {
        Accept: 'application/json',
        'Client-Agent': 'RSMovieSpot:1.0:rsmoviespot@app.local',
      },
      signal: AbortSignal.timeout(7000),
    });
    if (res.ok) {
      const raw = (await res.json()) as Array<{ name?: string; count?: number; eta?: number; queued?: number }>;
      cachedHordeModelsList = raw
        .filter((m) => m.name && (m.count ?? 0) >= 1 && m.name !== 'stable_diffusion')
        .map((m) => ({
          name: String(m.name),
          count: Number(m.count ?? 0),
          eta: Number(m.eta ?? 999),
          queued: Number(m.queued ?? 0),
        }));
      cachedHordeModelsAtMs = Date.now();
    }
  }

  if (cachedHordeModelsList.length === 0) {
    return getFallbackHordeModels(style);
  }

  const scored: Array<{ name: string; score: number }> = [];
  preferredPool.forEach((candidateName, idx) => {
    const live = cachedHordeModelsList.find((m) => m.name.toLowerCase() === candidateName.toLowerCase());
    if (!live) return;
    // Strongly prefer fast queue (low eta) and style rank
    const fastBonus = live.eta <= 15 ? 400 : live.eta <= 35 ? 250 : live.eta <= 75 ? 90 : -250;
    const styleBonus = (preferredPool.length - idx) * 18;
    const workerBonus = Math.min(40, live.count * 6);
    scored.push({ name: live.name, score: fastBonus + styleBonus + workerBonus - live.eta });
  });

  scored.sort((a, b) => b.score - a.score);
  const picked = scored.map((s) => s.name);
  if (picked.length > 0) return picked;

  // Ultimate fast fallback: any clean non-NSFW online model with shortest queue
  const fastAny = cachedHordeModelsList
    .filter((m) => !/nsfw|hentai|furry|pony|pixel/i.test(m.name) && m.eta <= 45)
    .sort((a, b) => a.eta - b.eta)
    .slice(0, 4)
    .map((m) => m.name);
  return fastAny.length > 0 ? fastAny : getFallbackHordeModels(style);
}

async function generateViaAiHorde(
  prompt: string,
  reqWidth: number,
  reqHeight: number,
  steps: number,
  seed: number,
  targetWidth: number,
  targetHeight: number,
  models?: string[]
): Promise<Buffer | null> {
  let genId = '';
  for (let subAttempt = 0; subAttempt < 2; subAttempt++) {
    await paceAiHordeSubmit();
    const requestBody: Record<string, unknown> = {
      prompt,
      params: {
        width: reqWidth,
        height: reqHeight,
        steps,
        n: 1,
        seed: String(seed + subAttempt),
        sampler_name: 'k_euler_a',
        cfg_scale: 7.0,
      },
      nsfw: false,
      censor_nsfw: true,
      r2: true,
      shared: false,
    };
    if (models && models.length > 0) {
      requestBody.models = models;
    }

    const submitRes = await fetch('https://aihorde.net/api/v2/generate/async', {
      method: 'POST',
      headers: {
        apikey: '0000000000',
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Client-Agent': 'RSMovieSpot:1.0:rsmoviespot@app.local',
        'User-Agent': BROWSER_USER_AGENT,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(15_000),
    });
    if (submitRes.status === 429 && subAttempt === 0) {
      await new Promise((r) => setTimeout(r, 1200));
      continue;
    }
    if (!submitRes.ok) return null;
    const submitData = (await submitRes.json()) as { id?: string };
    genId = (submitData.id ?? '').trim();
    if (genId) break;
  }
  if (!genId) return null;

  for (let poll = 0; poll < 22; poll++) {
    await new Promise((r) => setTimeout(r, 2000));
    const checkRes = await fetch(`https://aihorde.net/api/v2/generate/check/${genId}`, {
      headers: {
        Accept: 'application/json',
        'Client-Agent': 'RSMovieSpot:1.0:rsmoviespot@app.local',
        'User-Agent': BROWSER_USER_AGENT,
      },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!checkRes || !checkRes.ok) continue;
    const check = (await checkRes.json()) as {
      done?: boolean;
      faulted?: boolean;
      is_possible?: boolean;
      wait_time?: number;
      queue_position?: number;
      processing?: number;
    };
    if (check.faulted || check.is_possible === false) return null;
    // Fast-bail congested queues after 2 polls (~4s) so we immediately switch to zero-queue model
    if (
      poll >= 2 &&
      (check.processing ?? 0) === 0 &&
      (check.queue_position ?? 0) > 35 &&
      (check.wait_time ?? 0) > 75
    ) {
      return null;
    }
    if (check.done) {
      const statusRes = await fetch(`https://aihorde.net/api/v2/generate/status/${genId}`, {
        headers: {
          Accept: 'application/json',
          'Client-Agent': 'RSMovieSpot:1.0:rsmoviespot@app.local',
          'User-Agent': BROWSER_USER_AGENT,
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!statusRes.ok) return null;
      const statusData = (await statusRes.json()) as { generations?: Array<{ img?: string }> };
      const imgUrl = (statusData.generations?.[0]?.img ?? '').trim();
      if (!imgUrl.startsWith('http')) return null;

      const imgRes = await fetch(imgUrl, {
        headers: { 'User-Agent': BROWSER_USER_AGENT },
        signal: AbortSignal.timeout(20_000),
      });
      if (!imgRes.ok) return null;
      const buf = Buffer.from(await imgRes.arrayBuffer());
      if (buf.length < 4096) return null;
      try {
        return await sharp(buf)
          .resize(targetWidth, targetHeight, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
          .sharpen({ sigma: 0.85, m1: 0.9, m2: 1.5 })
          .modulate({ saturation: 1.07 })
          .jpeg({ quality: 94 })
          .toBuffer();
      } catch {
        return buf;
      }
    }
  }
  return null;
}

async function generateViaPollinations(
  prompt: string,
  reqWidth: number,
  reqHeight: number,
  seed: number,
  targetWidth: number,
  targetHeight: number
): Promise<Buffer | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const waitRemaining = pollinationsCooldownUntilMs - Date.now();
    if (waitRemaining > 0) {
      if (waitRemaining <= 48_000) {
        await new Promise((r) => setTimeout(r, waitRemaining + 400));
      } else {
        return null;
      }
    }
    try {
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${reqWidth}&height=${reqHeight}&seed=${seed + attempt}&nologo=true`;
      const res = await fetch(url, {
        headers: { 'User-Agent': BROWSER_USER_AGENT },
        signal: AbortSignal.timeout(35_000),
      });
      if (res.status === 402 || res.status === 429) {
        const errText = await res.text().catch(() => '');
        const retryHeader = Number(res.headers.get('retry-after') ?? '');
        const bodyMatch = errText.match(/Retry after (\d+)s/i);
        const bodySec = bodyMatch ? Number(bodyMatch[1]) : NaN;
        const waitSec = Math.max(2, Math.min(46, Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : Number.isFinite(bodySec) ? bodySec : 15));
        pollinationsCooldownUntilMs = Date.now() + waitSec * 1000;
        if (attempt === 0 && waitSec <= 46) {
          await new Promise((r) => setTimeout(r, waitSec * 1000 + 500));
          continue;
        }
        return null;
      }
      if (!res.ok) continue;
      const ct = (res.headers.get('content-type') ?? '').toLowerCase();
      if (ct && !ct.startsWith('image/')) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 4096) continue;
      try {
        const meta = await sharp(buf).metadata();
        const w = meta.width ?? 0;
        const h = meta.height ?? 0;
        if (w >= 100 && h >= 100) {
          const keepH = Math.max(100, Math.round(h * 0.92));
          return await sharp(buf)
            .extract({ left: 0, top: 0, width: w, height: keepH })
            .resize(targetWidth, targetHeight, { fit: 'cover' })
            .jpeg({ quality: 92 })
            .toBuffer();
        }
      } catch {
        // return raw buffer if sharp fails
      }
      return buf;
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 900));
    }
  }
  return null;
}

async function executeCloudflareWithRetry(fn: () => Promise<Buffer>, maxAttempts = 2): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const code = (err as { code?: number })?.code;
      const retryable = code === 429 || (code !== undefined && code >= 500 && code <= 599) || !code;
      if (retryable && attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
      } else {
        throw err;
      }
    }
  }
  throw lastError;
}

async function requestFluxKlein9b(
  accountId: string,
  apiToken: string,
  prompt: string,
  width: number,
  height: number
): Promise<Buffer> {
  const form = new FormData();
  form.append('prompt', prompt);
  form.append('width', String(width));
  form.append('height', String(height));
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-2-klein-9b`;
  return executeCloudflareFetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiToken}` },
    body: form,
  });
}

async function requestLucidOrigin(
  accountId: string,
  apiToken: string,
  prompt: string,
  width: number,
  height: number,
  seed: number
): Promise<Buffer> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/leonardo/lucid-origin`;
  return executeCloudflareFetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ prompt, width, height, guidance: 4.5, seed }),
  });
}

async function requestFluxSchnell(
  accountId: string,
  apiToken: string,
  prompt: string
): Promise<Buffer> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`;
  return executeCloudflareFetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ prompt, steps: 4 }),
  });
}

async function executeCloudflareFetch(url: string, init: RequestInit): Promise<Buffer> {
  const res = await fetch(url, init);
  const rawBytes = Buffer.from(await res.arrayBuffer());
  const contentType = (res.headers.get('content-type') ?? '').toLowerCase();

  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${rawBytes.toString('utf8', 0, 260)}`) as Error & { code?: number };
    err.code = res.status;
    throw err;
  }
  if (rawBytes.length === 0) throw new Error('Cloudflare returned an empty body.');
  if (contentType.startsWith('image/')) {
    if (rawBytes.length < 1024) throw new Error('Cloudflare binary image is too small.');
    return rawBytes;
  }

  const text = rawBytes.toString('utf8').trim();
  if (text.startsWith('{')) {
    const root = JSON.parse(text) as { result?: string | { image?: string; b64_json?: string }; image?: string };
    const b64 =
      typeof root.result === 'string'
        ? root.result
        : root.result?.image ?? root.result?.b64_json ?? root.image ?? '';
    const cleanB64 = b64.includes('base64,') ? b64.split('base64,')[1] : b64;
    const cleaned = cleanB64.replace(/\s+/g, '');
    if (!cleaned) throw new Error('Cloudflare JSON missing result.image');
    const decoded = Buffer.from(cleaned, 'base64');
    if (decoded.length < 1024) throw new Error('Decoded Cloudflare image is too small.');
    return decoded;
  }

  if (rawBytes.length < 1024) throw new Error('Unexpected short Cloudflare payload.');
  return rawBytes;
}

interface PhotoCandidate {
  url: string;
  width: number;
  height: number;
  priority: number;
  fallbackUrl?: string;
}

function isPortraitOrSquare(c: PhotoCandidate): boolean {
  return c.width > 0 && c.height > 0 && c.height >= c.width * 0.92;
}

export function isNonCelebrityOrRecipeTopic(query: string, topicContext = ''): boolean {
  const combined = `${query} ${topicContext}`.toLowerCase();
  const intent = detectVisualIntent(query);
  if (intent === 'MOVIE_POSTER' || intent === 'CHARACTER') return false;
  const recipeOrAbstractHints = [
    'biryani', 'recipe', 'cooking', 'cook ', 'masala', 'dum', 'kitchen', 'dish',
    'food', 'curry', 'paneer', 'chicken', 'spice', 'rice', 'boil', 'fry', 'roast',
    'bake', 'ingredients', 'howto', 'how to', 'tutorial', 'tips', 'facts',
    'science', 'physics', 'chemistry', 'biology', 'motivation', 'mindset',
    'psychology', 'mythology', 'history', 'abstract', 'benefits', 'health',
  ];
  return recipeOrAbstractHints.some((k) => combined.includes(k));
}

function anchorPhotoQueryWithTopic(query: string, topicContext: string): string {
  const cleanQuery = query.trim();
  const cleanTopic = topicContext.trim();
  if (!cleanTopic) return cleanQuery;
  if (detectVisualIntent(cleanQuery) === 'MOVIE_POSTER') return cleanQuery;

  const topicWords = extractCoreQueryWords(cleanTopic).slice(0, 3);
  if (topicWords.length === 0) return cleanQuery;
  const lowerQ = cleanQuery.toLowerCase();
  const missing = topicWords.filter((w) => !lowerQ.includes(w));
  return missing.length === 0 ? cleanQuery : `${cleanQuery} ${missing.join(' ')}`;
}

export async function downloadStockPhotoFallback(
  query: string,
  usedUrls: Set<string>,
  destinationFile: string,
  preferPortrait = true,
  topicContext = '',
  usedHashes: Set<string> = new Set()
): Promise<boolean> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return false;
  const anchored = anchorPhotoQueryWithTopic(cleanQuery, topicContext);
  const topicCore = extractCoreQueryWords(topicContext);
  const requiredWords = [...new Set([...extractCoreQueryWords(cleanQuery), ...topicCore])];

  const candidates = new Map<string, PhotoCandidate>();
  await collectOpenversePhotoCandidates(anchored, candidates, topicCore).catch(() => {});

  const coreWords = extractCoreQueryWords(anchored);
  if (candidates.size === 0 && coreWords.length > 0) {
    const tightQuery = coreWords.slice(0, 4).join(' ');
    await collectOpenversePhotoCandidates(tightQuery, candidates, topicCore).catch(() => {});
    if (candidates.size === 0) {
      await collectWikimediaCommonsCandidates(tightQuery, candidates, requiredWords).catch(() => {});
    }
  } else if (candidates.size < 3 && coreWords.length > 0) {
    await collectWikimediaCommonsCandidates(coreWords.slice(0, 4).join(' '), candidates, requiredWords).catch(() => {});
  }

  const ordered = [...candidates.values()].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return (preferPortrait && isPortraitOrSquare(b) ? 1 : 0) - (preferPortrait && isPortraitOrSquare(a) ? 1 : 0);
  });

  for (const candidate of ordered) {
    if (usedUrls.has(candidate.url)) continue;
    const ok = await downloadAndValidateImageUrl(candidate.url, destinationFile, usedHashes).catch(() => false);
    if (ok) {
      usedUrls.add(candidate.url);
      return true;
    }
  }
  return false;
}

export async function downloadRealPhoto(
  query: string,
  usedUrls: Set<string>,
  destinationFile: string,
  preferPortrait = true,
  topicContext = '',
  usedHashes: Set<string> = new Set()
): Promise<boolean> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return false;
  if (isNonCelebrityOrRecipeTopic(cleanQuery, topicContext)) return false;

  const intent = detectVisualIntent(cleanQuery);
  const subject = extractCleanSubject(cleanQuery);
  const subjectWords = extractSubjectMatchWords(subject);
  const strictAllWords = intent === 'PERSON' && subjectWords.length <= 2;
  const anchored = anchorPhotoQueryWithTopic(cleanQuery, topicContext);
  const candidates = new Map<string, PhotoCandidate>();

  if (intent === 'MOVIE_POSTER') {
    await collectImdbPhotoCandidates(subject, candidates, true, false, subjectWords).catch(() => {});
    await collectItunesMovieCandidates(subject, candidates, ['IN', 'US'], subjectWords).catch(() => {});
    await collectWikipediaSummaryCandidates(`${subject} (film)`, candidates, true, subjectWords, false).catch(() => {});
    await collectWikipediaSummaryCandidates(subject, candidates, true, subjectWords, false).catch(() => {});
    if (candidates.size === 0) {
      await collectWikipediaSearchCandidates(`${subject} film`, candidates, true, subjectWords, false).catch(() => {});
    }
  } else if (intent === 'CHARACTER') {
    await collectWikipediaSummaryCandidates(`${subject} (Marvel Cinematic Universe)`, candidates, false, subjectWords, strictAllWords).catch(() => {});
    await collectWikipediaSummaryCandidates(`${subject} (character)`, candidates, false, subjectWords, strictAllWords).catch(() => {});
    if (subjectWords.length >= 2) {
      await collectWikipediaSummaryCandidates(subject, candidates, false, subjectWords, strictAllWords).catch(() => {});
      await collectImdbPhotoCandidates(subject, candidates, true, false, subjectWords).catch(() => {});
      await collectWikipediaSearchCandidates(`${subject} character`, candidates, false, subjectWords, true).catch(() => {});
      await collectItunesMovieCandidates(subject, candidates, ['US', 'IN'], subjectWords).catch(() => {});
    }
    if (candidates.size === 0 && subjectWords.length >= 2) {
      await collectWikimediaCommonsCandidates(anchored, candidates, subjectWords, strictAllWords).catch(() => {});
    }
  } else {
    await collectWikipediaSummaryCandidates(subject, candidates, false, subjectWords, strictAllWords).catch(() => {});
    await collectImdbPhotoCandidates(subject, candidates, false, true, subjectWords).catch(() => {});
    if (candidates.size === 0) {
      await collectWikipediaSearchCandidates(subject, candidates, false, subjectWords, strictAllWords).catch(() => {});
    }
    if (candidates.size === 0) {
      await collectWikimediaCommonsCandidates(subject, candidates, subjectWords, strictAllWords).catch(() => {});
    }
  }

  const ordered = [...candidates.values()].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return (preferPortrait && isPortraitOrSquare(b) ? 1 : 0) - (preferPortrait && isPortraitOrSquare(a) ? 1 : 0);
  });

  for (const candidate of ordered) {
    if (usedUrls.has(candidate.url)) continue;
    if (candidate.fallbackUrl && usedUrls.has(candidate.fallbackUrl)) continue;

    let ok = await downloadAndValidateImageUrl(candidate.url, destinationFile, usedHashes).catch(() => false);
    if (!ok && candidate.fallbackUrl) {
      ok = await downloadAndValidateImageUrl(candidate.fallbackUrl, destinationFile, usedHashes).catch(() => false);
    }

    if (ok) {
      usedUrls.add(candidate.url);
      if (candidate.fallbackUrl) usedUrls.add(candidate.fallbackUrl);
      return true;
    }
  }
  return false;
}

export async function downloadInternetVideoClip(
  query: string,
  isMeme: boolean,
  usedUrls: Set<string>,
  destinationFile: string
): Promise<boolean> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return false;

  const coreWords = extractCoreQueryWords(cleanQuery);
  if (coreWords.length === 0 || isWeakClipQuery(cleanQuery, coreWords, isMeme)) return false;

  const candidates: Array<{ url: string; score: number }> = [];
  if (isMeme) {
    await collectTenorMemeClips(cleanQuery, coreWords, candidates).catch(() => {});
    await collectCoubVideoClips(cleanQuery, coreWords, candidates).catch(() => {});
    if (candidates.every((c) => usedUrls.has(c.url)) && coreWords.length >= 3) {
      const tight = coreWords.slice(0, 2).join(' ');
      await collectTenorMemeClips(tight, coreWords.slice(0, 2), candidates).catch(() => {});
      await collectCoubVideoClips(tight, coreWords.slice(0, 2), candidates).catch(() => {});
    }
  } else {
    await collectCoubVideoClips(cleanQuery, coreWords, candidates).catch(() => {});
    if (candidates.every((c) => usedUrls.has(c.url)) && coreWords.length >= 3) {
      const tight = coreWords.slice(0, 2).join(' ');
      await collectCoubVideoClips(tight, coreWords.slice(0, 2), candidates).catch(() => {});
    }
    if (candidates.every((c) => usedUrls.has(c.url)) && coreWords.length >= 2) {
      await collectTenorMemeClips(cleanQuery, coreWords, candidates).catch(() => {});
    }
  }

  const seen = new Set<string>();
  const ordered = candidates
    .filter((c) => {
      if (seen.has(c.url)) return false;
      seen.add(c.url);
      return true;
    })
    .sort((a, b) => b.score - a.score);

  for (const candidate of ordered) {
    if (usedUrls.has(candidate.url)) continue;
    const ok = await downloadAndValidateVideoUrl(candidate.url, destinationFile).catch(() => false);
    if (ok) {
      usedUrls.add(candidate.url);
      return true;
    }
  }
  return false;
}

function detectVisualIntent(rawQuery: string): 'MOVIE_POSTER' | 'CHARACTER' | 'PERSON' {
  const lower = rawQuery.toLowerCase().trim();
  const movieKeywords = ['movie', 'film', 'poster', 'web series', 'tv series', 'series', 'cinema', 'trailer', 'box office'];
  if (movieKeywords.some((k) => lower.includes(k))) return 'MOVIE_POSTER';

  const characterKeywords = [
    'character', 'superhero', 'supervillain', 'villain', 'comic', 'anime',
    'marvel', 'dc comics', 'mcu', 'iron man', 'ironman', 'superman',
    'batman', 'spider-man', 'spiderman', 'thor', 'hulk', 'captain america',
    'doctor strange', 'doctor doom', 'black panther', 'deadpool', 'wolverine', 'joker',
    'thanos', 'loki', 'flash', 'aquaman', 'wonder woman', 'venom',
    'ant-man', 'hawkeye', 'scarlet witch', 'black widow', 'goku', 'naruto',
    'luffy', 'krrish', 'shaktimaan', 'baahubali', 'pushpa raj', 'rocky bhai',
  ];
  if (characterKeywords.some((k) => lower.includes(k))) return 'CHARACTER';
  return 'PERSON';
}

function extractCleanSubject(rawQuery: string): string {
  let cleaned = rawQuery
    .trim()
    .replace(
      /\b(official\s+poster|movie\s+poster|film\s+poster|character\s+poster|music\s+director|poster|movie|film|web\s+series|tv\s+series|series|trailer|teaser|scene|clip|video|review|breakdown|actor|actress|director|filmmaker|producer|singer|musician|composer|starcast|star|celebrity|cast|character|superhero|supervillain|villain|picture|photo|portrait|headshot|image|still|stills|wallpaper|biography|wiki|hd|4k)\b/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .replace(/^[ -:,."']+|[ -:,."']+$/g, '');

  if (!cleaned) cleaned = rawQuery.trim();
  switch (cleaned.toLowerCase()) {
    case 'ironman': return 'Iron Man';
    case 'spiderman': return 'Spider-Man';
    case 'antman': return 'Ant-Man';
    case 'xmen':
    case 'x men': return 'X-Men';
    case 'russo brothers': return 'Russo brothers';
    default: return cleaned;
  }
}

function extractSubjectMatchWords(subject: string): string[] {
  const shortStop = new Set([
    'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'and', 'or', 'for', 'with',
    'from', 'by', 'is', 'as', 'it', 'no', 'so', 'up', 'vs',
  ]);
  const words = subject
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !shortStop.has(w));
  return [...new Set(words)];
}

function matchesCandidateSubject(textLower: string, subjectWords: string[], strictAll = false): boolean {
  if (subjectWords.length === 0) return true;
  const hits = subjectWords.filter((w) => new RegExp(`(?<![a-z0-9])${escapeRegExp(w)}(?![a-z0-9])`).test(textLower)).length;
  if (strictAll || subjectWords.length <= 2) {
    return hits === subjectWords.length;
  }
  const minNeeded = Math.min(subjectWords.length, Math.max(2, Math.ceil(subjectWords.length * 0.65)));
  return hits >= minNeeded;
}

function extractCoreQueryWords(query: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'and', 'or', 'for', 'with', 'from',
    'out', 'movie', 'film', 'cinema', 'scene', 'trailer', 'teaser', 'clip', 'video',
    'meme', 'funny', 'reaction', 'official', 'hd', '4k', 'whatsapp', 'status',
    'shorts', 'bollywood', 'hollywood', 'indian', 'raw', '35mm', 'dslr', 'shot',
    'close', 'closeup', 'wide', 'medium', 'overhead', 'angle', 'vertical', 'horizontal',
    'cinematic', 'lighting', 'warm', 'cozy', 'dramatic', 'rich', 'golden', 'steaming',
    'aromatic', 'vibrant', 'soft', 'bright', 'dark', 'deep', 'single', 'unified', 'frame',
    'make', 'making', 'best', 'easy', 'style', 'secrets', 'secret', 'recipe',
    'actor', 'actress', 'director', 'singer', 'composer', 'poster',
  ]);
  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w));
  return [...new Set(words)];
}

function isWeakClipQuery(rawQuery: string, coreWords: string[], isMeme: boolean): boolean {
  const lower = rawQuery.toLowerCase();
  const forbidden = ['out of 5', 'stars', 'rating', 'review', 'subscribe', 'comment', 'ending', 'part 1', 'part 2', 'box office', 'multiverse', 'cigar'];
  if (forbidden.some((f) => lower.includes(f))) return true;
  const generic = new Set(['out', 'five', 'four', 'three', 'two', 'one', 'stars', 'star', 'rating', 'review', 'best', 'worst', 'good', 'bad', 'top', 'epic', 'awesome', 'amazing', 'cinema', 'theater', 'theatre', 'audience']);
  const substantive = coreWords.filter((w) => !generic.has(w) && !/^\d+$/.test(w));
  if (isMeme) return substantive.length === 0;
  return substantive.length === 0 || (coreWords.length === 1 && coreWords[0].length < 4);
}

function hasDisallowedPhotoArtifactKeywords(combinedLower: string, queryLower: string): boolean {
  const blocked = [
    'book cover', 'bookcover', 'hardcover', 'paperback', 'isbn', 'textbook', 'novel',
    'encyclopedia', 'handbook', 'manual', 'magazine', 'newspaper', 'front page',
    'fossil', 'specimen', 'holotype', 'scale bar', 'ruler', 'cm scale', 'herbarium',
    'museum specimen', 'skeleton', 'diagram', 'infographic', 'flowchart', 'chart',
    'graph', 'schematic', 'blueprint', 'map of', 'scanned', 'manuscript',
    'handwritten', 'recipe card', 'document', 'letter', 'statue', 'locomotive',
    'train', 'illustration', 'comic', 'screenshot', 'clipart', 'vector', 'logo',
    'wordmark', 'text overlay', 'banner', 'flyer', 'brochure',
  ];
  return blocked.some((b) => combinedLower.includes(b) && !queryLower.includes(b));
}

async function collectOpenversePhotoCandidates(
  searchQuery: string,
  outMap: Map<string, PhotoCandidate>,
  topicCore: string[] = []
): Promise<void> {
  const coreWords = extractCoreQueryWords(searchQuery);
  const q = coreWords.length > 0 ? coreWords.slice(0, 4).join(' ') : searchQuery;
  const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&category=photograph&extension=jpg,png&mature=false&page_size=20`;
  const body = await fetchJsonString(url);
  if (!body) return;
  const root = JSON.parse(body) as { results?: Array<{ url?: string; width?: number; height?: number; title?: string; tags?: Array<{ name?: string }> }> };
  const qLower = searchQuery.toLowerCase();
  for (const item of root.results ?? []) {
    const imgUrl = (item.url ?? '').trim();
    const title = (item.title ?? '').toLowerCase();
    const tags = (item.tags ?? []).map((t) => (t.name ?? '').toLowerCase()).join(' ');
    const combined = `${title} ${tags} ${imgUrl.toLowerCase()}`;
    if (hasDisallowedPhotoArtifactKeywords(combined, qLower)) continue;
    if (coreWords.length > 0 && !coreWords.some((w) => combined.includes(w))) continue;
    if (topicCore.length > 0 && !topicCore.some((w) => combined.includes(w))) continue;
    const width = item.width ?? 0;
    const height = item.height ?? 0;
    if (!imgUrl.startsWith('http')) continue;
    if ((width >= 1 && width <= 399) || (height >= 1 && height <= 399)) continue;
    if (!isCleanPhotoUrl(imgUrl)) continue;
    if (!outMap.has(imgUrl)) outMap.set(imgUrl, { url: imgUrl, width, height, priority: 4 });
  }
}

async function collectCoubVideoClips(
  cleanQuery: string,
  coreWords: string[],
  outList: Array<{ url: string; score: number }>
): Promise<void> {
  const url = `https://coub.com/api/v2/search/coubs?per_page=24&q=${encodeURIComponent(cleanQuery)}`;
  const body = await fetchTextString(url, BROWSER_USER_AGENT, 'application/json');
  if (!body) return;
  const root = JSON.parse(body) as { coubs?: Array<Record<string, unknown>> };
  const requiredHits = coreWords.length <= 2 ? coreWords.length : Math.max(2, Math.floor((coreWords.length * 2 + 2) / 3));
  const phraseLower = coreWords.join(' ');
  const bannedTags = ['gaming', 'gameplay', 'fortnite', 'minecraft', 'roblox', 'valorant', 'pubg', 'freefire', 'mannequin', 'asmr', 'amv', 'tiktok', 'reels', 'selfie', 'bathroom', 'mirror', 'shirtless', 'gym', 'dance', 'twerk', 'couple', 'kiss', 'fanedit', 'velocity', 'phonk', 'anime edit', 'sigma edit'];

  for (const obj of root.coubs ?? []) {
    const title = String(obj.title ?? '');
    const tagsText = Array.isArray(obj.tags) ? obj.tags.map((t: { title?: string }) => t?.title ?? '').join(' ') : '';
    const searchable = `${title} ${tagsText}`.toLowerCase();
    if (bannedTags.some((tag) => new RegExp(`\\b${escapeRegExp(tag)}\\b`).test(searchable))) continue;

    const wordHits = coreWords.filter((w) => new RegExp(`\\b${escapeRegExp(w)}\\b`).test(searchable)).length;
    if (wordHits < requiredHits) continue;

    const titleHits = coreWords.filter((w) => new RegExp(`\\b${escapeRegExp(w)}\\b`).test(title.toLowerCase())).length;
    const likes = Number(obj.likes_count ?? 0);
    if (titleHits === 0 && likes < 15) continue;

    const fileVersions = obj.file_versions as { html5?: { video?: { high?: { url?: string }; med?: { url?: string } } } } | undefined;
    const mp4Url = fileVersions?.html5?.video?.high?.url ?? fileVersions?.html5?.video?.med?.url;
    if (!mp4Url || !mp4Url.startsWith('http')) continue;

    const phraseBonus = phraseLower && title.toLowerCase().includes(phraseLower) ? 90 : phraseLower && searchable.includes(phraseLower) ? 50 : 0;
    const score = wordHits * 100 + titleHits * 55 + phraseBonus + Math.min(50, Math.floor(likes / 10)) + 40;
    outList.push({ url: mp4Url, score });
  }
}

async function collectTenorMemeClips(
  cleanQuery: string,
  coreWords: string[],
  outList: Array<{ url: string; score: number }>
): Promise<void> {
  const slug = cleanQuery.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) return;
  const html = await fetchTextString(`https://tenor.com/search/${slug}-gifs`, BROWSER_USER_AGENT);
  if (!html) return;
  const matches = [...new Set(html.match(/https:\/\/media\.tenor\.com\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.mp4/g) ?? [])];
  for (const mp4Url of matches) {
    const fileSlug = mp4Url.split('/').pop()?.toLowerCase() ?? '';
    const slugHits = coreWords.filter((w) => fileSlug.includes(w)).length;
    if (slugHits < 1 && coreWords.length > 0) continue;
    const qualityBonus = mp4Url.includes('AAAPo') ? 55 : 15;
    outList.push({ url: mp4Url, score: slugHits * 90 + qualityBonus });
  }
}

function upgradeImdbUrl(url: string): string {
  const idx = url.indexOf('._V1_');
  if (idx === -1) return url;
  const extRaw = url.split('.').pop()?.toLowerCase() ?? 'jpg';
  const ext = ['jpg', 'jpeg', 'png', 'webp'].includes(extRaw) ? extRaw : 'jpg';
  return `${url.slice(0, idx)}._V1_SX1000_.${ext}`;
}

async function collectImdbPhotoCandidates(
  searchTerm: string,
  outMap: Map<string, PhotoCandidate>,
  preferMovies: boolean,
  allowPeople: boolean,
  subjectWordsInput?: string[]
): Promise<void> {
  const normalized = searchTerm.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!normalized) return;
  const firstChar = normalized[0]?.match(/[a-z0-9]/) ? normalized[0] : 'x';
  const url = `https://v3.sg.media-imdb.com/suggestion/${firstChar}/${encodeURIComponent(normalized)}.json`;
  const body = await fetchJsonString(url);
  if (!body) return;
  const root = JSON.parse(body) as { d?: Array<Record<string, unknown>> };
  const queryClean = searchTerm.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const queryWords = subjectWordsInput && subjectWordsInput.length > 0 ? subjectWordsInput : extractSubjectMatchWords(searchTerm);

  for (const obj of root.d ?? []) {
    const label = String(obj.l ?? '').toLowerCase();
    const labelNorm = label.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const labelWords = labelNorm.split(' ').filter(Boolean);
    const id = String(obj.id ?? '');
    const qid = String(obj.qid ?? '').toLowerCase();
    const qLabel = String(obj.q ?? '').toLowerCase();
    const releaseYear = Number(obj.y ?? 0);

    const isMovieOrSeries =
      ['movie', 'tvseries', 'tvminiseries', 'tvmovie'].includes(qid) ||
      (id.startsWith('tt') && !['musicvideo', 'video', 'podcastepisode'].includes(qid) && (qLabel.includes('feature') || qLabel.includes('series') || !qid));
    const isPerson = id.startsWith('nm');
    if (!allowPeople && isPerson) continue;
    if (preferMovies && !allowPeople && !isMovieOrSeries) continue;

    const hits = queryWords.filter((w) => new RegExp(`(?<![a-z0-9])${escapeRegExp(w)}(?![a-z0-9])`).test(labelNorm)).length;
    const isMononymMatch =
      isPerson &&
      queryWords.length >= 2 &&
      labelWords.length === 1 &&
      labelWords[0] === queryWords[0];
    const matchesStrict =
      queryWords.length === 0 ||
      hits === queryWords.length ||
      (queryWords.length >= 3 && hits >= Math.ceil(queryWords.length * 0.65)) ||
      isMononymMatch;
    if (!matchesStrict) continue;

    const imgObj = obj.i as { imageUrl?: string; width?: number; height?: number } | undefined;
    const rawUrl = (imgObj?.imageUrl ?? '').trim();
    if (!rawUrl.startsWith('http')) continue;

    const w = imgObj?.width ?? 0;
    const h = imgObj?.height ?? 0;
    const upgradedUrl = upgradeImdbUrl(rawUrl);
    const isHd = upgradedUrl !== rawUrl;
    if (!isHd && ((w >= 1 && w <= 299) || (h >= 1 && h <= 299))) continue;

    const finalW = isHd && w >= 1 && w <= 999 ? 1000 : w;
    const finalH = isHd && w > 0 && h > 0 && w < 1000 ? Math.round(h * (1000 / w)) : h;
    const fallbackUrl = isHd && (w === 0 || w >= 300) && (h === 0 || h >= 300) ? rawUrl : undefined;

    const exactTitleBoost =
      labelNorm === queryClean ? 6 : hits === queryWords.length ? 4 : labelNorm.startsWith(queryClean) ? 3 : 1;
    const recencyBoost = isPerson ? 0 : releaseYear >= 2022 ? 3 : releaseYear >= 2015 ? 1 : 0;
    const typeBoost = preferMovies && isMovieOrSeries ? 6 : !preferMovies && isPerson ? 7 : isMovieOrSeries || isPerson ? 2 : 0;

    if (!outMap.has(upgradedUrl)) {
      outMap.set(upgradedUrl, {
        url: upgradedUrl,
        width: finalW,
        height: finalH,
        priority: exactTitleBoost + recencyBoost + typeBoost,
        fallbackUrl,
      });
    }
  }
}

async function collectItunesMovieCandidates(
  searchTerm: string,
  outMap: Map<string, PhotoCandidate>,
  countries: string[] = ['IN', 'US'],
  subjectWordsInput?: string[]
): Promise<void> {
  const queryClean = searchTerm.toLowerCase().trim();
  const queryWords = subjectWordsInput && subjectWordsInput.length > 0 ? subjectWordsInput : extractSubjectMatchWords(searchTerm);
  for (const country of countries) {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&media=movie&entity=movie&limit=8&country=${country}`;
    const body = await fetchJsonString(url);
    if (!body) continue;
    const root = JSON.parse(body) as { results?: Array<{ trackName?: string; artworkUrl100?: string; releaseDate?: string }> };
    for (const item of root.results ?? []) {
      const trackName = (item.trackName ?? '').toLowerCase();
      if (!matchesCandidateSubject(trackName, queryWords, queryWords.length <= 2)) continue;
      const artwork100 = (item.artworkUrl100 ?? '').trim();
      if (!artwork100.startsWith('http')) continue;
      const releaseYear = Number((item.releaseDate ?? '').split('-')[0] ?? 0);
      const recencyBoost = releaseYear >= 2021 ? 3 : releaseYear >= 2015 ? 1 : 0;
      const artworkHd = artwork100.replace(/\d+x\d+bb/, '1400x1400bb');
      const artworkFallback = artwork100.replace(/\d+x\d+bb/, '1000x1000bb');
      const exactBoost = trackName === queryClean ? 5 : trackName.startsWith(queryClean) ? 3 : 1;
      if (!outMap.has(artworkHd)) {
        outMap.set(artworkHd, {
          url: artworkHd,
          width: 933,
          height: 1400,
          priority: 4 + exactBoost + recencyBoost,
          fallbackUrl: artworkFallback !== artworkHd ? artworkFallback : undefined,
        });
      }
    }
  }
}

function isNonEntertainmentWikiSummary(description: string, extract: string, requireEntertainment: boolean): boolean {
  if (!requireEntertainment) return false;
  const combined = `${description} ${extract}`.toLowerCase();
  const hints = ['film', 'movie', 'cinema', 'directed by', 'starring', 'screenplay', 'box office', 'television', 'web series', 'tv series', 'season', 'animated', 'soundtrack', 'franchise', 'superhero', 'marvel', 'dc comics'];
  return !hints.some((h) => combined.includes(h));
}

async function collectWikipediaSummaryCandidates(
  pageQuery: string,
  outMap: Map<string, PhotoCandidate>,
  requireEntertainment: boolean,
  requiredWords: string[] = [],
  strictAll = false
): Promise<void> {
  const title = pageQuery.replace(/ /g, '_');
  const encodedTitle = encodeURIComponent(title);
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodedTitle}`;
  const body = await fetchJsonString(url);
  if (!body) return;
  const root = JSON.parse(body) as Record<string, unknown>;
  if (String(root.type ?? '').toLowerCase() === 'disambiguation') return;
  const desc = String(root.description ?? '');
  const ext = String(root.extract ?? '');
  if (isNonEntertainmentWikiSummary(desc, ext, requireEntertainment)) return;
  const combined = `${String(root.title ?? '')} ${desc} ${ext}`.toLowerCase();
  if (hasDisallowedPhotoArtifactKeywords(combined, pageQuery.toLowerCase())) return;
  if (!matchesCandidateSubject(combined, requiredWords, strictAll)) return;

  for (const key of ['originalimage', 'thumbnail']) {
    const img = root[key] as { source?: string; width?: number; height?: number } | undefined;
    if (img?.source && isCleanPhotoUrl(img.source) && !hasDisallowedPhotoArtifactKeywords(img.source.toLowerCase(), pageQuery.toLowerCase()) && !outMap.has(img.source)) {
      outMap.set(img.source, { url: img.source, width: img.width ?? 0, height: img.height ?? 0, priority: 5 });
    }
  }
}

async function collectWikipediaSearchCandidates(
  searchQuery: string,
  outMap: Map<string, PhotoCandidate>,
  requireEntertainment: boolean,
  requiredWords: string[] = [],
  strictAll = false
): Promise<void> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(
    searchQuery
  )}&gsrlimit=6&prop=pageimages|extracts&exintro=1&explaintext=1&exsentences=2&piprop=original|thumbnail&pithumbsize=1200&format=json`;
  const body = await fetchJsonString(url);
  if (!body) return;
  const root = JSON.parse(body) as { query?: { pages?: Record<string, Record<string, unknown>> } };
  const pages = root.query?.pages;
  if (!pages) return;
  const qLower = searchQuery.toLowerCase();

  for (const page of Object.values(pages)) {
    const pTitle = String(page.title ?? '');
    const pExtract = String(page.extract ?? '');
    if (isNonEntertainmentWikiSummary(pTitle, pExtract, requireEntertainment)) continue;
    const combined = `${pTitle} ${pExtract}`.toLowerCase();
    if (hasDisallowedPhotoArtifactKeywords(combined, qLower)) continue;
    if (!matchesCandidateSubject(combined, requiredWords, strictAll)) continue;
    for (const key of ['original', 'thumbnail']) {
      const img = page[key] as { source?: string; width?: number; height?: number } | undefined;
      if (img?.source && isCleanPhotoUrl(img.source) && !hasDisallowedPhotoArtifactKeywords(img.source.toLowerCase(), qLower) && !outMap.has(img.source)) {
        outMap.set(img.source, { url: img.source, width: img.width ?? 0, height: img.height ?? 0, priority: 3 });
      }
    }
  }
}

async function collectWikimediaCommonsCandidates(
  cleanQuery: string,
  outMap: Map<string, PhotoCandidate>,
  requiredWords: string[] = [],
  strictAll = false
): Promise<void> {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(
    cleanQuery
  )}&gsrlimit=12&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=1200&format=json`;
  const body = await fetchJsonString(url);
  if (!body) return;
  const root = JSON.parse(body) as { query?: { pages?: Record<string, Record<string, unknown>> } };
  const pages = root.query?.pages;
  if (!pages) return;
  const qLower = cleanQuery.toLowerCase();

  for (const page of Object.values(pages)) {
    const title = String(page.title ?? '');
    const titleLower = title.toLowerCase();
    if (hasDisallowedPhotoArtifactKeywords(titleLower, qLower)) continue;
    if (!matchesCandidateSubject(titleLower, requiredWords, strictAll)) continue;
    const info = (page.imageinfo as Array<Record<string, unknown>> | undefined)?.[0];
    if (!info) continue;
    const mime = String(info.mime ?? '').toLowerCase();
    const width = Number(info.width ?? 0);
    const height = Number(info.height ?? 0);
    if (mime !== 'image/jpeg' && mime !== 'image/png') continue;
    if (width < 400 || height < 400) continue;
    const chosen = String(info.thumburl ?? info.url ?? '');
    if (chosen && isCleanPhotoUrl(title) && isCleanPhotoUrl(chosen) && !hasDisallowedPhotoArtifactKeywords(chosen.toLowerCase(), qLower) && !outMap.has(chosen)) {
      outMap.set(chosen, { url: chosen, width, height, priority: 0 });
    }
  }
}

function isCleanPhotoUrl(urlOrTitle: string): boolean {
  const lower = urlOrTitle.toLowerCase();
  if (lower.endsWith('.svg') || lower.endsWith('.gif') || lower.endsWith('.pdf')) return false;
  const banned = [
    'signature', 'autograph', 'logo', 'icon', 'flag', 'map', 'diagram', 'chart',
    'coat_of_arms', 'emblem', 'stamp', 'locator', 'wordmark', 'symbol',
    'book_cover', 'bookcover', 'specimen', 'fossil', 'ruler', 'scale_bar',
    'herbarium', 'manuscript', 'scan',
  ];
  return !banned.some((b) => lower.includes(b));
}

async function fetchJsonString(url: string): Promise<string | null> {
  return fetchTextString(url, WIKIMEDIA_USER_AGENT, 'application/json');
}

async function fetchTextString(url: string, userAgent: string, acceptHeader?: string): Promise<string | null> {
  try {
    const headers: Record<string, string> = { 'User-Agent': userAgent };
    if (acceptHeader) headers.Accept = acceptHeader;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const txt = await res.text();
    return txt.trim() ? txt : null;
  } catch {
    return null;
  }
}

async function downloadAndValidateImageUrl(
  url: string,
  destinationFile: string,
  usedHashes: Set<string> = new Set()
): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': WIKIMEDIA_USER_AGENT },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return false;
    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    if (ct && (!ct.startsWith('image/') || ct.includes('svg'))) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    if (usedHashes.has(hash)) return false;
    fs.writeFileSync(destinationFile, buf);
    const valid = await validateDownloadedImageDimensions(destinationFile);
    if (!valid) {
      if (fs.existsSync(destinationFile)) fs.unlinkSync(destinationFile);
      return false;
    }
    usedHashes.add(hash);
    return true;
  } catch {
    if (fs.existsSync(destinationFile)) fs.unlinkSync(destinationFile);
    return false;
  }
}

async function downloadAndValidateVideoUrl(url: string, destinationFile: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_USER_AGENT },
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return false;
    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    if (ct.includes('text/html')) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 20_000 || buf.length > 25_000_000) return false;
    const headerStr = buf.subarray(0, 64).toString('latin1');
    if (!headerStr.includes('ftyp')) return false;
    fs.writeFileSync(destinationFile, buf);
    return true;
  } catch {
    if (fs.existsSync(destinationFile)) fs.unlinkSync(destinationFile);
    return false;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
