package com.rsmoviespot.data.api.repository

import android.util.Base64
import com.rsmoviespot.BuildConfig
import com.rsmoviespot.domain.models.ContentMode
import com.rsmoviespot.domain.models.InputMode
import com.rsmoviespot.domain.models.VideoLanguage
import com.rsmoviespot.domain.models.VideoScriptResponse
import com.rsmoviespot.domain.models.VideoSlab
import com.rsmoviespot.domain.models.VisualStyleMode
import com.rsmoviespot.domain.models.VoiceGender
import com.rsmoviespot.domain.models.VoiceTone
import com.rsmoviespot.service.ImageComposer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.FileOutputStream
import java.util.Locale
import java.util.concurrent.TimeUnit

data class GeneratedImageResult(
    val bytes: ByteArray,
    val fromPollinations: Boolean
)

class VideoRepository(
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(25, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS)
        .writeTimeout(45, TimeUnit.SECONDS)
        .build()
) {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }
    @Volatile
    private var cachedChatModels: List<String>? = null
    @Volatile
    private var cloudflareExhaustedUntilMs: Long = 0L
    @Volatile
    private var pollinationsCooldownUntilMs: Long = 0L
    @Volatile
    private var aiHordeLastSubmitMs: Long = 0L
    private val aiHordeSubmitMutex = kotlinx.coroutines.sync.Mutex()

    companion object {
        private const val FULL_SCRIPT_WORD_THRESHOLD = 25
        private const val WIKIMEDIA_USER_AGENT = "RSMovieSpot/1.0 (https://rsmoviespot.app)"
        private const val BROWSER_USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

        private const val SHORTS_IMAGE_WIDTH = 576
        private const val SHORTS_IMAGE_HEIGHT = 1024
        private const val LANDSCAPE_IMAGE_WIDTH = 1024
        private const val LANDSCAPE_IMAGE_HEIGHT = 576

        private const val IMAGE_PROMPT_RULES =
            "PRIORITY 0 — USER-DESCRIBED SCENES & TOPIC APPROPRIATENESS ALWAYS WIN (HIGHEST PRIORITY):\n" +
                "- Whenever the user's prompt or script explicitly describes a specific visual scene, character appearance, outfit, location, lighting, style, camera shot, or action, YOU MUST generate that EXACT visual in image_prompt and set visual_source='ai_generated' and real_photo_query=''.\n" +
                "- Front-load the exact described subject, costume/outfit, action, setting, props, and lighting in the FIRST 25-35 words of image_prompt.\n" +
                "- Match EVERY image_prompt 100% to THAT slab's voiceover! Set has_character=false whenever a scene focuses on food, scenery, props, or secondary subjects.\n\n" +
                "DYNAMIC CLIPS, MEMES, 2-PHOTO SPLITS & STAT BADGES (USE ONLY WHEN TOPIC FITS):\n" +
                "- 'video_clip' (ONLY for movie reviews, trailer breakdowns, celebrity news, or pop-culture roasts): Set visual_source='video_clip', layout_mode='single', and give EACH clip a DIFFERENT, concrete 2-3 word recognizable English movie/character/action query.\n" +
                "- 'meme_clip' (ONLY 1-2 scenes in funny roasts/movie gossip): Set visual_source='meme_clip', layout_mode='single', and real_photo_query to a named meme template.\n" +
                "- 'split' / 'flip' 2-PHOTO SCENES: For record-comparison, clash, or vs scenes, set layout_mode='split' (or 'flip') with visual_source in {'real_photo','ai_generated'} and fill visual_source_2, real_photo_query_2, image_prompt_2.\n" +
                "- STAT BADGES & SPELLING: Whenever a scene announces a concrete number, cooking timer, budget, or release date, set stat_badge to a crisp 2-4 word UPPERCASE headline with ACCURATE English/Hinglish spelling (e.g., '20 MIN DUM', NOT '20 MIN DAM'; '500 CRORE CLUB'; '100% AUTHENTIC'). NEVER use generic placeholder words like 'STAT', 'BADGE', 'TITLE', 'TEXT', 'INFO', 'FACT', 'NUMBER', 'PLACEHOLDER', 'NONE', or 'N/A' — use '' if no concrete stat applies.\n\n" +
                "REAL PHOTO / POSTER vs AI IMAGE RULES (PREFER AI FOR NON-CELEBRITY / RECIPE / ABSTRACT):\n" +
                "  1) REAL-WORLD ACTOR / DIRECTOR / SINGER / PUBLIC FIGURE ONLY: visual_source MUST be 'real_photo' with real_photo_query set to ONLY their clean English full name (e.g., 'Sooraj Barjatya', 'Ayushmann Khurrana', 'Seema Pahwa') — NEVER draw real celebrities as ai_generated!\n" +
                "  2) Celebrity DUO OR Director+Movie named in ONE scene: MUST set layout_mode='flip', visual_source='real_photo', real_photo_query='<Name 1>', visual_source_2='real_photo', real_photo_query_2='<Name 2 or Movie Title movie poster>'!\n" +
                "  3) SPECIFIC MOVIE / TRAILER / WEB SERIES ONLY: visual_source='real_photo' (or 'video_clip' only when an older popular clip exists) and real_photo_query to '<Exact Clean English Title> movie poster'.\n" +
                "  4) ORIGINAL STORY CHARACTERS INSIDE A FILM (e.g., Purva), COOKING, RECIPES, FOOD, RATINGS, POLLS, ABSTRACT, STORY SCENES: ALWAYS set visual_source='ai_generated' and real_photo_query=''.\n" +
                "  5) When real_photo IS used across multiple scenes, EVERY scene MUST have a unique real_photo_query.\n" +
                "- STRICT ENGLISH-ONLY RULE FOR PROMPTS & QUERIES: NEVER put Hindi/Devanagari/regional words inside image_prompt, image_prompt_2, real_photo_query, or real_photo_query_2! Transliterate every person/movie name into English. NEVER prompt calendars, split-screen, UI icons, streaming icons, meters, gauges, scorecards, bold text, cards, or rating numbers inside image_prompt — put ratings/dates in stat_badge instead!\n\n"

        private const val VOICE_AND_BGM_RULES =
            "VOICE EMOTION, BGM & CHANNEL GROWTH METADATA RULES:\n" +
                "- CHANNEL GROWTH HOOK & RETENTION STRUCTURE: Always craft an explosive 2-second curiosity/shock Hook in Scene 1 (voice_emotion='hook'), a mid-video retention twist/open loop around Scene 5-7, and an interactive debate question CTA in the finale!\n" +
                "- Pick bgm_mood: 'comedy_roast', 'epic_action', 'suspense_thriller', 'emotional_sad', 'devotional', 'sci_fi_tech', 'motivational', or 'horror_dark'.\n" +
                "- For each scene, match voice_emotion dynamically from: 'hook', 'excited', 'climax', 'suspense', 'sad', 'roast', 'question', 'warm', or 'normal'.\n" +
                "- Pick valid Edge TTS voice_name (e.g. hi-IN-MadhurNeural, hi-IN-SwaraNeural, en-IN-PrabhatNeural, en-US-AndrewNeural).\n" +
                "- Also generate high-CTR youtube_title (<62 chars + 1 emoji), SEO youtube_description (2-3 lines), 5-7 youtube_hashtags, and engaging poll/debate pinned_comment.\n\n"

        private const val JSON_SCHEMA_SPEC =
            "Return ONLY ONE valid JSON object (no markdown fences, no commentary) matching this schema:\n" +
                "{\n" +
                "  \"character_bible\": \"Fixed visual theme in English\",\n" +
                "  \"visual_style\": \"Visual medium matching user request\",\n" +
                "  \"bgm_mood\": \"comedy_roast | epic_action | suspense_thriller | emotional_sad | devotional | sci_fi_tech | motivational | horror_dark\",\n" +
                "  \"voice_name\": \"Edge TTS voice shortName\",\n" +
                "  \"youtube_title\": \"Catchy viral YouTube title under 75 chars\",\n" +
                "  \"youtube_description\": \"2-3 line SEO YouTube description\",\n" +
                "  \"youtube_hashtags\": \"#shorts #viral #storytelling\",\n" +
                "  \"pinned_comment\": \"Engaging question to boost comments\",\n" +
                "  \"slabs\": [\n" +
                "    {\n" +
                "      \"voiceover_text\": \"Complete finished sentence of 7-12 words ending in . ! ? or । (NEVER end on a comma or hanging word like और/and/or)\",\n" +
                "      \"voice_emotion\": \"hook | excited | climax | suspense | sad | roast | question | warm | normal\",\n" +
                "      \"visual_source\": \"real_photo | ai_generated | video_clip | meme_clip\",\n" +
                "      \"real_photo_query\": \"Clean English query or ''\",\n" +
                "      \"layout_mode\": \"single | split | flip\",\n" +
                "      \"visual_source_2\": \"real_photo | ai_generated | ''\",\n" +
                "      \"real_photo_query_2\": \"2nd photo query or ''\",\n" +
                "      \"image_prompt_2\": \"2nd scene English prompt or ''\",\n" +
                "      \"stat_badge\": \"Optional 2-4 word accurately spelled UPPERCASE stat (no placeholder words) or ''\",\n" +
                "      \"has_character\": false,\n" +
                "      \"image_prompt\": \"Crisp 100% ASCII English prompt matching THAT scene's visual shot (no Devanagari, no text/words/logos/gauges)\",\n" +
                "      \"sfx_cue\": \"boom | thunder | sword | fire | whoosh\"\n" +
                "    }\n" +
                "  ]\n" +
                "}"

        private const val FULL_SCRIPT_SYSTEM_PROMPT =
            "You are an expert film director splitting an existing user-written script into crisp visual scenes.\n" +
                "DO NOT rewrite, paraphrase, translate, add, or change a single word of the user's spoken input.\n" +
                "MERGE TINY HOOKS & SPLIT LONG CAST LINES: Never isolate a 1-3 word exclamation (e.g., 'रुको!', 'लेकिन एक मिनट!') into its own scene; merge it with the adjacent sentence, AND split long 20+ word cast lines so every scene is 6-14 words across 11 to 16 strong scenes without breaking mid-word or across periods.\n" +
                "ENTERTAINMENT / TRAILER VISUALS: Even when voiceover_text is in Hindi/regional script, transliterate EVERY real celebrity/director/singer name and movie title to English! Set visual_source='real_photo' with ONLY '<Clean English Name>' (or layout_mode='flip' with real_photo + real_photo_query_2 for celebrity duos or director+movie pairs) and NEVER draw real celebrities as ai_generated. NEVER prompt calendars, split-screen, or UI icons.\n\n" +
                IMAGE_PROMPT_RULES + VOICE_AND_BGM_RULES + JSON_SCHEMA_SPEC

        private const val TOPIC_SYSTEM_PROMPT =
            "You are an elite YouTube storyteller, scriptwriter, and film director.\n" +
                "Create 13 to 16 ultra-crisp scenes (~7-12 words each for Shorts; 14-18 for 16:9 YouTube) with an explosive Scene 1 hook.\n" +
                "Write how a real Indian creator actually talks on mic — natural conversational Hinglish/Hindi with expressive punctuation ('!', '?', '...') instead of stiff textbook narration.\n" +
                "MANDATORY: Every slab's voiceover_text MUST be a complete, finished spoken sentence ending with '.', '!', '?' or '।' — NEVER end on a comma (','), hanging word ('और', 'फिर', 'and', 'or'), or incomplete fragment.\n\n" +
                IMAGE_PROMPT_RULES + VOICE_AND_BGM_RULES + JSON_SCHEMA_SPEC
    }

    private fun buildVoiceToneDirective(voiceTone: VoiceTone): String = when (voiceTone) {
        VoiceTone.NATURAL -> "Podcast / Human studio style: warm, conversational, relatable spoken cadence."
        VoiceTone.FUNNY -> "Funny / Comic style: witty, playful sarcasm, punchy setup-and-payoff comedic rhythm."
        VoiceTone.SERIOUS -> "Serious / Intense style: dramatic trailer-voice gravitas, tense stakes, weighty pauses."
        VoiceTone.ENERGETIC -> "Energetic / Hype style: fast high-voltage hook, explosive excitement, crisp beats."
        VoiceTone.AUTO -> "Auto dynamic storytelling style: natural conversational flow matched to each scene's emotion."
    }

    private fun isInstructionOrBriefPrompt(input: String, language: VideoLanguage): Boolean {
        val lower = input.lowercase(Locale.US)
        val metaRegex = Regex(
            "(?:\\b(act\\s+as|act\\s+like|you\\s+are\\s+(?:a|an|the)?|your\\s+task\\s+is|include\\s*:|aspect\\s+ratio|9:16|16:9|video_clip|meme_clip|real_photo|stat_badge|bgm_mood)\\b|9\\s*:\\s*16|16\\s*:\\s*9)",
            RegexOption.IGNORE_CASE
        )
        if (metaRegex.containsMatchIn(input)) return true
        val sceneRegex = Regex("(?:^|\\n)\\s*(?:scene\\s*\\d+\\s*[:-]|visuals?\\s*:|image\\s*prompt\\s*:|voiceover\\s*:|narration\\s*:|hook\\s*:|climax\\s*:)", RegexOption.IGNORE_CASE)
        if (sceneRegex.containsMatchIn(input)) return true
        val writeRegex = Regex("\\b(write|create|generate|make|prepare|build|craft)\\s+(?:me\\s+)?(?:a|an|the)?\\s*(?:[\\w:-]+\\s+){0,5}(?:voiceover\\s+)?(?:script|short|shorts|video|story|reel|scene|breakdown|review|roast|explainer)\\b", RegexOption.IGNORE_CASE)
        if (writeRegex.containsMatchIn(input)) return true
        if (language in listOf(VideoLanguage.HINDI, VideoLanguage.MARATHI, VideoLanguage.GUJARATI, VideoLanguage.BENGALI, VideoLanguage.TAMIL, VideoLanguage.TELUGU, VideoLanguage.KANNADA, VideoLanguage.MALAYALAM, VideoLanguage.PUNJABI)) {
            val nonAscii = input.count { it.code > 127 && Character.isLetter(it) }
            val latin = input.count { it in 'a'..'z' || it in 'A'..'Z' }
            if (nonAscii == 0 && latin > 40 && input.split(Regex("\\s+")).size <= 55) return true
        }
        return false
    }

    suspend fun fetchTrendingMovieTopics(): List<String> = withContext(Dispatchers.IO) {
        val rssUrl =
            "https://news.google.com/rss/search?q=Bollywood+OR+Hollywood+OR+Tollywood+box+office+movie+when:3d&hl=en-IN&gl=IN&ceid=IN:en"
        val xml = fetchTextString(rssUrl, WIKIMEDIA_USER_AGENT) ?: return@withContext emptyList()
        val itemRegex = Regex("<item>.*?<title>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?</title>", setOf(RegexOption.DOT_MATCHES_ALL, RegexOption.IGNORE_CASE))
        val results = mutableListOf<String>()
        val seen = mutableSetOf<String>()

        for (match in itemRegex.findAll(xml)) {
            var title = match.groupValues[1]
                .replace("&amp;", "&")
                .replace("&quot;", "\"")
                .replace("&#39;", "'")
                .replace("&apos;", "'")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
            val lastDash = title.lastIndexOf(" - ")
            if (lastDash > 0) title = title.substring(0, lastDash)
            title = title.trim()
            if (title.length >= 12 && seen.add(title)) {
                results.add(title)
                if (results.size >= 8) break
            }
        }
        results
    }

    private fun resolveCandidateModels(groqApiKey: String): List<String> {
        cachedChatModels?.takeIf { it.isNotEmpty() }?.let { return it }

        val discovered = try {
            val req = Request.Builder()
                .url("https://api.groq.com/openai/v1/models")
                .header("Authorization", "Bearer $groqApiKey")
                .header("Accept", "application/json")
                .build()
            client.newCall(req).execute().use { res ->
                if (!res.isSuccessful) emptyList()
                else {
                    val body = res.body?.string().orEmpty()
                    val root = json.parseToJsonElement(body).jsonObject
                    root["data"]?.jsonArray.orEmpty().mapNotNull { el ->
                        el.jsonObject["id"]?.jsonPrimitive?.contentOrNull?.trim()
                    }.filter { id ->
                        val lower = id.lowercase(Locale.US)
                        id.isNotEmpty() &&
                            "whisper" !in lower && "tts" !in lower &&
                            "orpheus" !in lower && "guard" !in lower &&
                            "embed" !in lower && "compound" !in lower
                    }
                }
            }
        } catch (_: Throwable) {
            emptyList()
        }

        val preferred = listOf(
            "openai/gpt-oss-120b",
            "llama-3.3-70b-versatile",
            "meta-llama/llama-4-maverick-17b-128e-instruct",
            "meta-llama/llama-4-scout-17b-16e-instruct",
            "qwen/qwen3-32b",
            "openai/gpt-oss-20b",
            "llama-3.1-8b-instant"
        )

        return if (discovered.isNotEmpty()) {
            val sorted = mutableListOf<String>()
            for (p in preferred) {
                discovered.firstOrNull { it.equals(p, ignoreCase = true) }?.let { sorted.add(it) }
            }
            for (id in discovered) {
                val lower = id.lowercase(Locale.US)
                if (id !in sorted && ("qwen" in lower || "llama" in lower || "gpt-oss" in lower)) {
                    sorted.add(id)
                }
            }
            val finalList = sorted.distinct().take(4).ifEmpty { discovered.take(3) }
            cachedChatModels = finalList
            finalList
        } else {
            listOf("openai/gpt-oss-120b", "llama-3.3-70b-versatile", "openai/gpt-oss-20b", "llama-3.1-8b-instant")
        }
    }

    fun resolveEffectiveVoiceTone(voiceTone: VoiceTone, contentMode: ContentMode = ContentMode.AUTO): VoiceTone {
        if (voiceTone != VoiceTone.AUTO) return voiceTone
        return when (contentMode) {
            ContentMode.MOVIE_ROAST -> VoiceTone.FUNNY
            ContentMode.REACTION, ContentMode.REVIEW -> VoiceTone.ENERGETIC
            ContentMode.STORY -> VoiceTone.SERIOUS
            ContentMode.KIDS_STORY, ContentMode.COOKING -> VoiceTone.NATURAL
            ContentMode.AUTO -> VoiceTone.AUTO
        }
    }

    fun resolveEffectiveVisualStyle(visualStyle: VisualStyleMode, contentMode: ContentMode = ContentMode.AUTO): VisualStyleMode {
        if (visualStyle != VisualStyleMode.AUTO) return visualStyle
        return if (contentMode == ContentMode.KIDS_STORY) VisualStyleMode.PIXAR_3D else VisualStyleMode.AUTO
    }

    private fun buildContentModeDirective(contentMode: ContentMode): String = when (contentMode) {
        ContentMode.REVIEW -> """
            CONTENT MODE ACTIVE — MOVIE / TRAILER REVIEW:
            - Structure: 2s curiosity hook -> spoiler-free setup -> cast, director & music breakdown -> star/hype verdict + audience poll CTA.
            - VISUALS: Mandatory real_photo (or layout_mode='flip' for pairs like Director+Movie Poster or Lead duo) for named real celebrities & official movie posters.
            - BADGES & BGM: Star/hype stat_badge on verdict scene (e.g. '4/5 STARS', '8/10 HYPE').
        """.trimIndent()
        ContentMode.MOVIE_ROAST -> """
            CONTENT MODE ACTIVE — FUNNY MOVIE ROAST:
            - Structure: Sharp playful Hinglish/Hindi comedy! Roast logic holes & dramatic tropes using punchy 6-10 word cuts.
            - VISUALS: Mix actor/movie real_photo with 2-4 funny meme_clip GIFs and comedic AI scenes.
            - BADGES & BGM: Witty punch stat_badge cues ('LOGIC RIP', 'WAIT WHAT?', '100% CRINGE'). Set bgm_mood='comedy_roast' and voice_emotion 'roast'/'hook'.
        """.trimIndent()
        ContentMode.REACTION -> """
            CONTENT MODE ACTIVE — CREATOR / AUDIENCE REACTION:
            - Structure: First-person creator reaction ('Bhai ruko! Yahan kya notice kiya?', 'Goosebumps!') + closing debate poll.
            - VISUALS: Use layout_mode='split' or 'flip' on 3-5 scenes pairing movie/topic subject on Panel 1 with expressive reaction/meme on Panel 2.
            - BADGES & BGM: Crisp reaction stat_badge ('MIND BLOWN', 'WAIT FOR IT', 'GOOSEBUMPS').
        """.trimIndent()
        ContentMode.STORY -> """
            CONTENT MODE ACTIVE — CINEMATIC STORYTELLING (KAHANI):
            - Structure: High-retention arc — Scene 1 hook -> Hero & world -> Conflict -> Mid-video twist -> Climax & takeaway.
            - VISUALS: STRICTLY visual_source='ai_generated' (real_photo_query='') across ALL scenes! Lock character_bible across every has_character=true scene and vary camera angles.
            - BADGES & BGM: Minimal stat_badge ('' or chapter cue like 'THE TWIST'). Use suspense_thriller / emotional_sad / horror_dark bgm_mood.
        """.trimIndent()
        ContentMode.KIDS_STORY -> """
            CONTENT MODE ACTIVE — KIDS MORAL / BEDTIME STORY:
            - Structure: Simple warm playful storytelling (cute animals, magic, friendship) ending with a clear 'Moral of the Story'!
            - CONTENT SAFETY MANDATORY: ZERO horror, ZERO gore, ZERO violence, ZERO scary monsters — keep every scene joyful and safe.
            - VISUALS: STRICTLY visual_source='ai_generated' (zero real_photo/clips!). Bright 3D Pixar Disney storybook animation aesthetic, cute characters locked via character_bible.
            - BADGES & BGM: Clean captions (stat_badge='' or 'MORAL TIME!'). Set bgm_mood='motivational' and voice_emotion 'warm'/'excited'.
        """.trimIndent()
        ContentMode.COOKING -> """
            CONTENT MODE ACTIVE — COOKING / RECIPE SHORTS:
            - Structure: 2s food hook ('Sirf 10 min me restaurant jaisa...') -> Ingredients -> Step-by-step tadka -> Secret tip -> Final sizzling plating.
            - VISUALS: STRICTLY visual_source='ai_generated' (zero real_photo/clips!) and has_character=false on food closeups! Macro DSLR food photography prompts (steam, golden spices, warm lighting).
            - BADGES & BGM: Step stat_badge cues ('STEP 1', 'STEP 2', 'SECRET TIP', 'READY!'). Set bgm_mood='motivational'.
        """.trimIndent()
        ContentMode.AUTO -> ""
    }

    private fun buildVisualStyleDirective(visualStyle: VisualStyleMode, contentMode: ContentMode = ContentMode.AUTO): String = when (resolveEffectiveVisualStyle(visualStyle, contentMode)) {
        VisualStyleMode.PIXAR_3D -> """
            VISUAL MEDIUM MANDATORY — 3D PIXAR ANIMATED STORY FILM:
            - Set visual_style to '3D Pixar Disney animated feature film, stylized CGI characters, rich global illumination, soft volumetric sunlight'.
            - Set character_bible to ONE concrete repeatable 3D character design (age, hair, outfit colors, prop) and carry those traits into every has_character=true scene.
            - Use visual_source='ai_generated' and real_photo_query='' for EVERY scene (zero real_photo, zero video_clip/meme_clip).
            - Prefix EVERY image_prompt with '3D Pixar Disney CGI animated scene,' followed by concrete 3D action, lighting, and camera framing.
            - MULTI-ANGLE 3D CUTS: Make 2 to 3 peak scenes (Hook Scene 1, Mid-Climax, Finale) use layout_mode='flip' with visual_source='ai_generated', visual_source_2='ai_generated', image_prompt = wide 3D angle, and image_prompt_2 = dramatic close-up/action angle of that same 3D moment!
        """.trimIndent()
        VisualStyleMode.ANIME_3D -> """
            VISUAL MEDIUM MANDATORY — CINEMATIC ANIME ANIMATION:
            - Set visual_style to 'Makoto Shinkai anime feature film, expressive cel-shaded animation, dramatic volumetric light rays, vibrant depth'.
            - Lock character_bible across every has_character=true scene and keep visual_source='ai_generated', real_photo_query='' for all scenes.
            - Prefix EVERY image_prompt with 'Cinematic anime animation film frame,' and use layout_mode='flip' with image_prompt_2 on 2 to 3 peak scenes!
        """.trimIndent()
        VisualStyleMode.LIVE_ACTION ->
            "VISUAL MEDIUM MANDATORY — RAW LIVE-ACTION 35mm FILM: Keep every ai_generated prompt as a realistic 35mm DSLR live-action film still (no cartoon/3D/anime)."
        VisualStyleMode.AUTO ->
            "Visual Style Auto: Honor user's requested style if stated (e.g., 3D Pixar, anime); for 3D animated stories, keep character_bible locked across scenes and use layout_mode='flip' on 2-3 peak dramatic beats."
    }

    suspend fun generateScript(
        topic: String,
        isShorts: Boolean,
        language: VideoLanguage,
        voiceGender: VoiceGender,
        inputMode: InputMode,
        voiceTone: VoiceTone,
        visualStyle: VisualStyleMode = VisualStyleMode.AUTO,
        contentMode: ContentMode = ContentMode.AUTO
    ): VideoScriptResponse = withContext(Dispatchers.IO) {
        val cleanInput = topic.trim()
        require(cleanInput.isNotEmpty()) { "Topic must not be blank." }

        val groqApiKey = BuildConfig.GROQ_API_KEY.trim()
        if (groqApiKey.isEmpty()) {
            error("GROQ_API_KEY is empty. Add GROQ_API_KEY to .env and rebuild.")
        }

        val words = cleanInput.split(Regex("\\s+")).filter { it.isNotEmpty() }
        val isFullScriptMode = when (inputMode) {
            InputMode.EXACT_SCRIPT -> true
            InputMode.AI_PROMPT -> false
            InputMode.AUTO -> words.size > FULL_SCRIPT_WORD_THRESHOLD && !isInstructionOrBriefPrompt(cleanInput, language)
        }

        val effectiveTone = resolveEffectiveVoiceTone(voiceTone, contentMode)
        val effectiveStyle = resolveEffectiveVisualStyle(visualStyle, contentMode)
        val systemPrompt = if (isFullScriptMode) FULL_SCRIPT_SYSTEM_PROMPT else TOPIC_SYSTEM_PROMPT
        val genderLabel = if (voiceGender == VoiceGender.FEMALE) "Female" else "Male"
        val toneDirective = buildVoiceToneDirective(effectiveTone)
        val styleDirective = buildVisualStyleDirective(effectiveStyle, contentMode)
        val modeDirective = buildContentModeDirective(contentMode)

        val languageDirective = if (language == VideoLanguage.AUTO) {
            "Language: Auto-detect from user request. Default to spoken Hindi (Devanagari) with voice_name '${VideoLanguage.HINDI.resolveVoice(voiceGender)}', UNLESS user explicitly requested another language."
        } else {
            "Language MANDATORY: Write ALL voiceover_text strictly in ${language.languageInstruction} and set voice_name to '${language.resolveVoice(voiceGender)}'."
        }

        val userPrompt = if (isFullScriptMode) {
            buildString {
                appendLine("MODE: FULL USER SCRIPT (${words.size} words).")
                appendLine("DO NOT rewrite, paraphrase, translate, add, or change a single word. Keep the EXACT user text intact and split sequentially into 11 to 16 scenes (6-14 words each). Merge 1-3 word hooks like 'रुको!' with the next sentence and split 20+ word cast sentences into separate beats.")
                if (modeDirective.isNotBlank()) appendLine(modeDirective)
                appendLine(styleDirective)
                appendLine("CAST & POSTERS: Whenever ANY real actor/director/singer is named (and style is not 3D/Anime and Content Mode is not STORY/KIDS_STORY/COOKING), visual_source MUST be 'real_photo' with ONLY their clean English full name (NEVER ai_generated for real people!). Use layout_mode='flip' + visual_source_2='real_photo' when TWO actors OR director+movie appear in one scene.")
                appendLine("100% ASCII ENGLISH: NEVER leave Hindi/Devanagari words or calendars, split-screen, UI icons, gauge/meter/card/text descriptions inside image_prompt or real_photo_query!")
                appendLine("Set voice_name matching language and $genderLabel gender.")
                appendLine("Voice delivery style: $toneDirective")
                appendLine("Return ONLY ONE complete valid JSON object.")
                appendLine()
                appendLine("USER SCRIPT:")
                append(cleanInput)
            }
        } else {
            buildString {
                appendLine("MODE: TOPIC / DIRECTOR PROMPT MODE (${words.size} words). ACT ON EVERY INSTRUCTION BELOW:")
                appendLine(cleanInput)
                appendLine()
                if (modeDirective.isNotBlank()) appendLine(modeDirective)
                appendLine(styleDirective)
                appendLine()
                appendLine(languageDirective)
                appendLine("Voice delivery & writing tone: $toneDirective")
                appendLine(
                    if (isShorts) "Format guideline: Vertical 9:16 YouTube Shorts, 13 to 16 fast-paced scenes (~45-50s total) with a 2s Hook, mid-video twist, and comment CTA."
                    else "Format guideline: Horizontal 16:9 YouTube video, 14 to 18 scenes (~65-80s total)."
                )
                appendLine("Return ONLY ONE complete valid JSON object.")
            }
        }

        val models = resolveCandidateModels(groqApiKey)
        data class Attempt(val modelId: String, val jsonMode: Boolean, val maxTokens: Int)
        val attempts = buildList {
            models.forEachIndexed { idx, modelId ->
                val tokens = if ("gpt-oss" in modelId.lowercase() || "qwen" in modelId.lowercase()) 16384 else 8192
                add(Attempt(modelId, true, tokens))
                if (idx == 0) add(Attempt(modelId, false, tokens))
            }
        }

        val errors = mutableListOf<String>()
        for (attempt in attempts) {
            try {
                val payload = buildJsonObject {
                    put("model", attempt.modelId)
                    put("messages", buildJsonArray {
                        add(buildJsonObject { put("role", "system"); put("content", systemPrompt) })
                        add(buildJsonObject { put("role", "user"); put("content", userPrompt) })
                    })
                    put("temperature", if (isFullScriptMode) 0.2 else 0.75)
                    put("max_tokens", attempt.maxTokens)
                    if (attempt.jsonMode) {
                        put("response_format", buildJsonObject { put("type", "json_object") })
                    }
                }.toString()

                val content = callWithRetry {
                    val req = Request.Builder()
                        .url("https://api.groq.com/openai/v1/chat/completions")
                        .header("Authorization", "Bearer $groqApiKey")
                        .header("Content-Type", "application/json")
                        .post(payload.toRequestBody("application/json".toMediaType()))
                        .build()
                    client.newCall(req).execute().use { res ->
                        val body = res.body?.string().orEmpty()
                        if (!res.isSuccessful) {
                            throw HttpStatusException(res.code, "HTTP ${res.code} at Groq: ${body.take(200)}")
                        }
                        val root = json.parseToJsonElement(body).jsonObject
                        root["choices"]?.jsonArray?.firstOrNull()?.jsonObject
                            ?.get("message")?.jsonObject?.get("content")?.jsonPrimitive?.contentOrNull?.trim()
                            ?: ""
                    }
                }

                if (content.isBlank()) error("Groq (${attempt.modelId}) returned empty result.")
                return@withContext parseScriptResponse(content, language, voiceGender)
            } catch (err: Throwable) {
                errors.add("${attempt.modelId}(json=${attempt.jsonMode}): ${err.message?.take(140)}")
            }
        }
        error(errors.joinToString(" | "))
    }

    private suspend fun <T> callWithRetry(maxAttempts: Int = 4, block: () -> T): T {
        var lastErr: Throwable? = null
        for (attempt in 0 until maxAttempts) {
            try {
                return block()
            } catch (err: Throwable) {
                lastErr = err
                val code = (err as? HttpStatusException)?.statusCode
                val retryable = code == null || code == 429 || code in 500..599
                if (retryable && attempt < maxAttempts - 1) {
                    delay(1400L * (attempt + 1))
                } else {
                    throw err
                }
            }
        }
        throw (lastErr ?: IllegalStateException("Request failed"))
    }

    fun enforceVoiceGender(voiceName: String, requestedGender: VoiceGender): String {
        val clean = voiceName.trim()
        val langs = VideoLanguage.entries.filter { it != VideoLanguage.AUTO }
        if (clean.isNotEmpty()) {
            langs.firstOrNull {
                it.maleVoice.equals(clean, true) || it.femaleVoice.equals(clean, true)
            }?.let { return it.resolveVoice(requestedGender) }

            val prefix = clean.split("-").take(2).joinToString("-").lowercase(Locale.US)
            if (prefix.isNotEmpty()) {
                langs.firstOrNull { it.maleVoice.lowercase(Locale.US).startsWith(prefix) }
                    ?.let { return it.resolveVoice(requestedGender) }
            }

            val langCode = clean.split("-").firstOrNull()?.lowercase(Locale.US).orEmpty()
            if (langCode.length >= 2) {
                langs.firstOrNull { it.maleVoice.lowercase(Locale.US).startsWith("$langCode-") }
                    ?.let { return it.resolveVoice(requestedGender) }
            }
        }
        return VideoLanguage.HINDI.resolveVoice(requestedGender)
    }

    private fun parseScriptResponse(
        rawText: String,
        requestedLanguage: VideoLanguage,
        requestedGender: VoiceGender
    ): VideoScriptResponse {
        val extracted = extractJsonPayload(rawText)
        val repaired = repairJsonStructure(extracted).replace(Regex(",\\s*([}\\]])"), "$1")
        val rootEl = json.parseToJsonElement(repaired)

        var characterBible = ""
        var visualStyle = ""
        var bgmMood = "epic_action"
        var parsedVoiceName = ""
        var youtubeTitle = ""
        var youtubeDescription = ""
        var youtubeHashtags = ""
        var pinnedComment = ""
        val slabElements: JsonArray

        when (rootEl) {
            is JsonArray -> slabElements = rootEl
            is JsonObject -> {
                characterBible = rootEl.str("character_bible")
                visualStyle = rootEl.str("visual_style")
                bgmMood = rootEl.str("bgm_mood").ifBlank { "epic_action" }
                parsedVoiceName = rootEl.str("voice_name")
                youtubeTitle = rootEl.str("youtube_title")
                youtubeDescription = rootEl.str("youtube_description")
                youtubeHashtags = rootEl.str("youtube_hashtags")
                pinnedComment = rootEl.str("pinned_comment")

                slabElements = (rootEl["slabs"] as? JsonArray)
                    ?: (rootEl["scenes"] as? JsonArray)
                    ?: (rootEl["script"] as? JsonArray)
                    ?: rootEl.values.firstOrNull { it is JsonArray } as? JsonArray
                    ?: error("Expected a JSON array of scenes in Groq response.")
            }
            else -> error("Groq response must be a JSON array or object.")
        }

        val allowedSources = setOf("ai_generated", "real_photo", "video_clip", "meme_clip")
        val allowedEmotions = setOf("hook", "excited", "climax", "suspense", "sad", "roast", "question", "warm", "normal")

        val toAsciiClean: (String) -> String = { s ->
            s.replace(Regex("[^\\x20-\\x7E]"), " ").replace(Regex("\\s+"), " ").trim()
        }

        val slabs = mutableListOf<VideoSlab>()
        slabElements.forEachIndexed { index, el ->
            val dto = el as? JsonObject ?: return@forEachIndexed
            val voiceover = dto.str("voiceover_text")
            val prompt = toAsciiClean(dto.str("image_prompt")).ifBlank {
                "dramatic 35mm live action cinema scene with moody warm lighting"
            }
            if (voiceover.isEmpty()) return@forEachIndexed

            val sfxCue = dto.str("sfx_cue").lowercase(Locale.US).ifBlank { "whoosh" }
            val rawEmotion = dto.str("voice_emotion").lowercase(Locale.US)
            val emotion = if (rawEmotion in allowedEmotions) rawEmotion else "normal"

            val rawQuery = toAsciiClean(dto.str("real_photo_query"))
            val realQuery = if (rawQuery.lowercase(Locale.US) in setOf("none", "null", "n/a", "-")) "" else rawQuery
            val reqSource = dto.str("visual_source").lowercase(Locale.US)
            val visualSource = if (reqSource in allowedSources && (reqSource == "ai_generated" || realQuery.isNotEmpty())) reqSource else "ai_generated"

            val rawQuery2 = toAsciiClean(dto.str("real_photo_query_2"))
            val realQuery2 = if (rawQuery2.lowercase(Locale.US) in setOf("none", "null", "n/a", "-")) "" else rawQuery2
            val prompt2 = toAsciiClean(dto.str("image_prompt_2"))
            val visualSource2 = when {
                dto.str("visual_source_2").equals("real_photo", true) && realQuery2.isNotEmpty() -> "real_photo"
                prompt2.isNotEmpty() -> "ai_generated"
                else -> ""
            }
            val rawLayout = dto.str("layout_mode").lowercase(Locale.US)
            val hasSecond = (visualSource2 == "real_photo" && realQuery2.isNotEmpty()) || prompt2.isNotEmpty()
            val layoutMode = if (visualSource !in setOf("video_clip", "meme_clip") && hasSecond && rawLayout in setOf("split", "flip")) rawLayout else "single"

            slabs.add(
                VideoSlab(
                    id = dto["id"]?.jsonPrimitive?.intOrNull ?: (index + 1),
                    voiceover_text = voiceover,
                    image_prompt = prompt,
                    sfx_cue = sfxCue,
                    has_character = dto["has_character"]?.jsonPrimitive?.booleanOrNull ?: false,
                    voice_emotion = emotion,
                    visual_source = visualSource,
                    real_photo_query = if (visualSource != "ai_generated") realQuery else "",
                    layout_mode = layoutMode,
                    visual_source_2 = if (layoutMode != "single") visualSource2 else "",
                    real_photo_query_2 = if (layoutMode != "single" && visualSource2 == "real_photo") realQuery2 else "",
                    image_prompt_2 = if (layoutMode != "single") prompt2 else "",
                    stat_badge = sanitizeStatBadge(dto.str("stat_badge"))
                )
            )
        }

        if (slabs.isEmpty()) error("Groq returned an empty script.")
        val finalVoice = if (requestedLanguage != VideoLanguage.AUTO) {
            requestedLanguage.resolveVoice(requestedGender)
        } else {
            enforceVoiceGender(parsedVoiceName, requestedGender)
        }

        return VideoScriptResponse(
            character_bible = characterBible,
            visual_style = visualStyle,
            bgm_mood = bgmMood,
            voice_name = finalVoice,
            youtube_title = youtubeTitle,
            youtube_description = youtubeDescription,
            youtube_hashtags = youtubeHashtags,
            pinned_comment = pinnedComment,
            slabs = slabs
        )
    }

    private fun sanitizeStatBadge(raw: String): String {
        val clean = raw.trim().replace(Regex("\\s+"), " ").take(32)
        if (clean.isEmpty()) return ""
        val upper = clean.uppercase(Locale.US)
        val placeholders = setOf(
            "STAT", "BADGE", "STAT BADGE", "TITLE", "TEXT", "INFO", "FACT",
            "NUMBER", "PLACEHOLDER", "HEADLINE", "NONE", "NULL", "N/A", "-", "TBD"
        )
        if (upper in placeholders) return ""
        val fixed = if (Regex("\\b(MIN|MINUTE|MINUTES|COOK|POT|BIRYANI|STEAM)\\b").containsMatchIn(upper)) {
            upper.replace(Regex("\\bDAM\\b"), "DUM")
        } else {
            upper
        }
        return fixed.take(32)
    }

    private fun JsonObject.str(key: String): String =
        (this[key] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()

    private fun extractJsonPayload(rawText: String): String {
        val cleaned = rawText
            .replace(Regex("<think>[\\s\\S]*?</think>", RegexOption.IGNORE_CASE), "")
            .trim()
            .replace(Regex("^```(?:json)?\\s*", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\s*```$"), "")
            .trim()
        val firstBrace = cleaned.indexOf('{')
        val firstArr = Regex("\\[\\s*\\{").find(cleaned)?.range?.first ?: -1
        val start = when {
            firstBrace != -1 && (firstArr == -1 || firstBrace < firstArr) -> firstBrace
            firstArr != -1 -> firstArr
            else -> cleaned.indexOf('[')
        }
        return if (start >= 0) cleaned.substring(start) else cleaned
    }

    private fun repairJsonStructure(input: String): String {
        val trimmed = input.trim()
        if (trimmed.isEmpty()) return trimmed
        val out = StringBuilder()
        val stack = ArrayDeque<Char>()
        var inString = false
        var escaped = false

        fun stripTrailing() {
            while (out.isNotEmpty() && out.last().isWhitespace()) out.deleteCharAt(out.length - 1)
            if (out.isNotEmpty() && (out.last() == ',' || out.last() == ':')) out.deleteCharAt(out.length - 1)
        }

        for (ch in trimmed) {
            if (inString) {
                when {
                    escaped -> { out.append(ch); escaped = false }
                    ch == '\\' -> { out.append(ch); escaped = true }
                    ch == '"' -> { out.append(ch); inString = false }
                    ch == '\n' -> out.append("\\n")
                    ch == '\r' -> out.append("\\r")
                    ch == '\t' -> out.append("\\t")
                    ch.code < 0x20 -> out.append(' ')
                    else -> out.append(ch)
                }
                continue
            }
            when (ch) {
                '"' -> { out.append(ch); inString = true }
                '{' -> { out.append(ch); stack.addLast('}') }
                '[' -> { out.append(ch); stack.addLast(']') }
                '}', ']' -> {
                    if (stack.isEmpty()) break
                    if (stack.last() == ch) {
                        out.append(ch); stack.removeLast()
                    } else if (ch in stack) {
                        while (stack.isNotEmpty() && stack.last() != ch) {
                            stripTrailing(); out.append(stack.removeLast())
                        }
                        if (stack.isNotEmpty() && stack.last() == ch) {
                            stripTrailing(); out.append(ch); stack.removeLast()
                        }
                    }
                    if (stack.isEmpty()) break
                }
                else -> out.append(ch)
            }
        }
        if (inString) {
            if (escaped && out.isNotEmpty()) out.deleteCharAt(out.length - 1)
            out.append('"')
        }
        while (stack.isNotEmpty()) {
            stripTrailing()
            out.append(stack.removeLast())
        }
        return out.toString()
    }

    suspend fun generateImageForSlab(
        prompt: String,
        isShorts: Boolean,
        seed: Int,
        contentMode: ContentMode = ContentMode.AUTO
    ): ByteArray = generateImageForSlabWithMeta(prompt, isShorts, seed, contentMode).bytes

    suspend fun generateImageForSlabWithMeta(
        prompt: String,
        isShorts: Boolean,
        seed: Int,
        contentMode: ContentMode = ContentMode.AUTO
    ): GeneratedImageResult = withContext(Dispatchers.IO) {
        val accountId = BuildConfig.CLOUDFLARE_ACCOUNT_ID.trim()
        val apiToken = BuildConfig.CLOUDFLARE_API_TOKEN.trim()
        val width = if (isShorts) SHORTS_IMAGE_WIDTH else LANDSCAPE_IMAGE_WIDTH
        val height = if (isShorts) SHORTS_IMAGE_HEIGHT else LANDSCAPE_IMAGE_HEIGHT
        val cleanPrompt = prompt.trim().trimEnd(',', '.')
        val modePromptBoost = if (
            contentMode == ContentMode.COOKING &&
            !Regex("\\b(food photography|macro|kitchen|steam|plating)\\b", RegexOption.IGNORE_CASE).containsMatchIn(cleanPrompt)
        ) {
            "$cleanPrompt, appetizing macro food photography, warm kitchen studio lighting, fresh garnish"
        } else {
            cleanPrompt
        }
        val finalPrompt = modePromptBoost + buildImageSuffix(modePromptBoost.lowercase(Locale.US), isShorts)

        val errors = mutableListOf<String>()
        if (accountId.isNotEmpty() && apiToken.isNotEmpty() && System.currentTimeMillis() >= cloudflareExhaustedUntilMs) {
            val isCfTerminal = { e: Throwable ->
                val code = (e as? HttpStatusException)?.statusCode
                code == 401 || code == 403 || code == 429
            }
            try {
                val bytes = executeCloudflareWithRetry {
                    val body = MultipartBody.Builder().setType(MultipartBody.FORM)
                        .addFormDataPart("prompt", finalPrompt)
                        .addFormDataPart("width", width.toString())
                        .addFormDataPart("height", height.toString())
                        .build()
                    executeCloudflareRequest(
                        "https://api.cloudflare.com/client/v4/accounts/$accountId/ai/run/@cf/black-forest-labs/flux-2-klein-9b",
                        apiToken,
                        body
                    )
                }
                return@withContext GeneratedImageResult(bytes, fromPollinations = false)
            } catch (e: Throwable) {
                if (isCfTerminal(e)) {
                    cloudflareExhaustedUntilMs = System.currentTimeMillis() + 10 * 60_000L
                }
                errors.add("flux-2-klein-9b: ${e.message?.take(100)}")
            }

            if (System.currentTimeMillis() >= cloudflareExhaustedUntilMs) {
                try {
                    val bytes = executeCloudflareWithRetry {
                        val payload = buildJsonObject {
                            put("prompt", finalPrompt); put("width", width); put("height", height)
                            put("guidance", 4.5); put("seed", seed)
                        }.toString().toRequestBody("application/json".toMediaType())
                        executeCloudflareRequest(
                            "https://api.cloudflare.com/client/v4/accounts/$accountId/ai/run/@cf/leonardo/lucid-origin",
                            apiToken,
                            payload
                        )
                    }
                    return@withContext GeneratedImageResult(bytes, fromPollinations = false)
                } catch (e: Throwable) {
                    if (isCfTerminal(e)) {
                        cloudflareExhaustedUntilMs = System.currentTimeMillis() + 10 * 60_000L
                    }
                    errors.add("lucid-origin: ${e.message?.take(100)}")
                }
            }

            if (System.currentTimeMillis() >= cloudflareExhaustedUntilMs) {
                try {
                    val bytes = executeCloudflareWithRetry {
                        val payload = buildJsonObject {
                            put("prompt", finalPrompt); put("steps", 4)
                        }.toString().toRequestBody("application/json".toMediaType())
                        executeCloudflareRequest(
                            "https://api.cloudflare.com/client/v4/accounts/$accountId/ai/run/@cf/black-forest-labs/flux-1-schnell",
                            apiToken,
                            payload
                        )
                    }
                    return@withContext GeneratedImageResult(bytes, fromPollinations = false)
                } catch (e: Throwable) {
                    if (isCfTerminal(e)) {
                        cloudflareExhaustedUntilMs = System.currentTimeMillis() + 10 * 60_000L
                    }
                    errors.add("flux-1-schnell: ${e.message?.take(100)}")
                }
            }
        }

        // Tier 2: AI Horde (free, watermark-free; smart live queue-aware model routing)
        val promptLower = modePromptBoost.lowercase(Locale.US)
        val is3dPrompt = contentMode == ContentMode.KIDS_STORY ||
            listOf("3d", "pixar", "disney", "cgi", "dreamworks", "blender").any { it in promptLower }
        val isAnimePrompt = !is3dPrompt && listOf("anime", "manga", "cel-shaded", "ghibli", "shonen").any { it in promptLower }
        val hordeTag = when {
            is3dPrompt -> ", 3D Pixar Disney CGI animation render, volumetric lighting, rich 3D depth, crisp detail, vibrant colors"
            isAnimePrompt -> ", anime film frame, Makoto Shinkai cinematic lighting, crisp cel shading, high detail"
            contentMode == ContentMode.COOKING -> ", appetizing macro DSLR food photography, warm kitchen studio lighting, sharp focus"
            else -> ", photorealistic, crisp 35mm cinema photography, sharp focus, dramatic lighting"
        }
        val hordeTagShort = when {
            is3dPrompt -> ", 3D Pixar CGI animated frame"
            isAnimePrompt -> ", anime cinematic frame"
            else -> ", cinematic photograph"
        }
        val baseNegative =
            "text, words, letters, typography, numbers, digits, watermark, signature, logo, banner, ui overlay, chart, gauge, meter, cards, collage, grid, split screen, deformed face, ugly face, distorted eyes, bad anatomy, extra fingers, mutated hands, blurry, lowres, worst quality, out of focus"
        val hordeNegativePrompt = if (contentMode == ContentMode.KIDS_STORY) {
            "$baseNegative, scary, horror, blood, gore, dark violence, creepy, nightmare, weapon"
        } else {
            baseNegative
        }
        val hordeStyle = when {
            is3dPrompt -> "3d"
            isAnimePrompt -> "anime"
            else -> "photo"
        }
        val rankedHordeModels = runCatching { resolveFastAiHordeModels(hordeStyle) }
            .getOrElse { getFallbackHordeModels(hordeStyle) }
        val primaryModels = rankedHordeModels.take(3)
        val backupModels = if (rankedHordeModels.size > 3) rankedHordeModels.drop(3).take(3)
            else getFallbackHordeModels(hordeStyle)

        val hordeWidth = if (isShorts) 448 else 640
        val hordeHeight = if (isShorts) 704 else 384
        val hordePrompt = "${modePromptBoost.take(360)}$hordeTag ### $hordeNegativePrompt"
        val hordeFallbackPrompt = "${modePromptBoost.take(220)}$hordeTagShort ### $hordeNegativePrompt"
        val hordeBytes = runCatching {
            generateViaAiHorde(hordePrompt, hordeWidth, hordeHeight, 16, seed, primaryModels)
        }.getOrNull() ?: runCatching {
            generateViaAiHorde(
                hordeFallbackPrompt,
                if (isShorts) 448 else 576,
                if (isShorts) 576 else 448,
                14,
                seed + 13,
                backupModels
            )
        }.getOrNull()
        if (hordeBytes != null) {
            return@withContext GeneratedImageResult(hordeBytes, fromPollinations = false)
        }

        // Tier 3: Pollinations (with Retry-After / 402 FREE_LIMIT cooldown handling)
        val pollHeight = if (isShorts) height + 80 else height + 56
        val pollStyleSuffix = when {
            is3dPrompt -> if (isShorts) ", vertical 9:16 3D Pixar CGI animated frame, vibrant volumetric lighting, no text, no watermark"
            else ", horizontal 16:9 3D Pixar CGI animated frame, vibrant volumetric lighting, no text, no watermark"
            isAnimePrompt -> if (isShorts) ", vertical 9:16 anime feature film frame, dramatic lighting, no text, no watermark"
            else ", horizontal 16:9 anime feature film frame, dramatic lighting, no text, no watermark"
            else -> if (isShorts) ", vertical 9:16 photo, cinematic lighting, no text, no watermark"
            else ", horizontal 16:9 photo, cinematic lighting, no text, no watermark"
        }
        val pollPrompt = cleanPrompt.take(350) + pollStyleSuffix
        val pollBytes = generateViaPollinations(pollPrompt, width, pollHeight, seed)
            ?: generateViaPollinations(cleanPrompt.take(180), width, pollHeight, seed + 7)
        if (pollBytes != null) {
            return@withContext GeneratedImageResult(pollBytes, fromPollinations = true)
        }

        error("Image generation failed: ${errors.joinToString(" | ")}")
    }

    @Volatile private var cachedHordeModelsAtMs = 0L
    @Volatile private var cachedHordeModelsList: List<Triple<String, Int, Int>> = emptyList()

    private fun getFallbackHordeModels(style: String): List<String> = when (style) {
        "3d" -> listOf("Rev Animated", "DreamShaper", "3D Animation Diffusion", "AlbedoBase XL (SDXL)", "Anything Diffusion")
        "anime" -> listOf("Flat-2D Animerge", "Nova Anime XL", "MeinaMix", "Counterfeit", "Anything Diffusion")
        else -> listOf("Edge Of Realism", "Rev Animated", "Deliberate", "AbsoluteReality", "Analog Madness")
    }

    private fun resolveFastAiHordeModels(style: String): List<String> {
        val preferredPool = when (style) {
            "3d" -> listOf("Rev Animated", "3D Animation Diffusion", "DreamShaper", "Disney Pixar Cartoon", "AlbedoBase XL (SDXL)", "Flat-2D Animerge", "Anything Diffusion", "Deliberate")
            "anime" -> listOf("Nova Anime XL", "Flat-2D Animerge", "MeinaMix", "Counterfeit", "Anything Diffusion", "Abyss OrangeMix", "Animagine XL", "Rev Animated")
            else -> listOf("Edge Of Realism", "EpicRealism", "AbsoluteReality", "Realistic Vision", "Analog Madness", "Deliberate", "AlbedoBase XL (SDXL)", "Rev Animated")
        }

        val now = System.currentTimeMillis()
        if (now - cachedHordeModelsAtMs > 60_000L || cachedHordeModelsList.isEmpty()) {
            val req = Request.Builder()
                .url("https://aihorde.net/api/v2/status/models?type=image")
                .header("Accept", "application/json")
                .header("Client-Agent", "RSMovieSpot:1.0:rsmoviespot@app.local")
                .build()
            runCatching {
                client.newCall(req).execute().use { res ->
                    if (res.isSuccessful) {
                        val arr = json.parseToJsonElement(res.body?.string().orEmpty()).jsonArray
                        val parsed = arr.mapNotNull { el ->
                            val obj = el.jsonObject
                            val name = obj.str("name")
                            val count = obj["count"]?.jsonPrimitive?.intOrNull ?: 0
                            val eta = obj["eta"]?.jsonPrimitive?.intOrNull ?: 999
                            if (name.isNotBlank() && count >= 1 && name != "stable_diffusion") Triple(name, count, eta) else null
                        }
                        if (parsed.isNotEmpty()) {
                            cachedHordeModelsList = parsed
                            cachedHordeModelsAtMs = now
                        }
                    }
                }
            }
        }

        val liveList = cachedHordeModelsList
        if (liveList.isEmpty()) return getFallbackHordeModels(style)

        val scored = mutableListOf<Pair<String, Int>>()
        preferredPool.forEachIndexed { idx, candidate ->
            val live = liveList.firstOrNull { it.first.equals(candidate, ignoreCase = true) } ?: return@forEachIndexed
            val (_, count, eta) = live
            val fastBonus = when {
                eta <= 15 -> 400
                eta <= 35 -> 250
                eta <= 75 -> 90
                else -> -250
            }
            val styleBonus = (preferredPool.size - idx) * 18
            val workerBonus = minOf(40, count * 6)
            scored.add(live.first to (fastBonus + styleBonus + workerBonus - eta))
        }
        scored.sortByDescending { it.second }
        if (scored.isNotEmpty()) return scored.map { it.first }

        val fastAny = liveList
            .filter { (name, _, eta) -> eta <= 45 && !Regex("nsfw|hentai|furry|pony|pixel", RegexOption.IGNORE_CASE).containsMatchIn(name) }
            .sortedBy { it.third }
            .take(4)
            .map { it.first }
        return if (fastAny.isNotEmpty()) fastAny else getFallbackHordeModels(style)
    }

    private suspend fun generateViaAiHorde(
        prompt: String,
        width: Int,
        height: Int,
        steps: Int,
        seed: Int,
        models: List<String>? = null
    ): ByteArray? {
        var genId = ""
        for (subAttempt in 0 until 2) {
            aiHordeSubmitMutex.lock()
            try {
                val waitMs = maxOf(0L, 700L - (System.currentTimeMillis() - aiHordeLastSubmitMs))
                if (waitMs > 0L) delay(waitMs)
                aiHordeLastSubmitMs = System.currentTimeMillis()
            } finally {
                aiHordeSubmitMutex.unlock()
            }

            val submitPayload = buildJsonObject {
                put("prompt", prompt)
                put("params", buildJsonObject {
                    put("width", width)
                    put("height", height)
                    put("steps", steps)
                    put("n", 1)
                    put("seed", (seed + subAttempt).toString())
                    put("sampler_name", "k_euler_a")
                    put("cfg_scale", 7.0)
                })
                if (!models.isNullOrEmpty()) {
                    put("models", buildJsonArray { models.forEach { add(JsonPrimitive(it)) } })
                }
                put("nsfw", false)
                put("censor_nsfw", true)
                put("r2", true)
                put("shared", false)
            }.toString()

            val submitReq = Request.Builder()
                .url("https://aihorde.net/api/v2/generate/async")
                .header("apikey", "0000000000")
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .header("Client-Agent", "RSMovieSpot:1.0:rsmoviespot@app.local")
                .header("User-Agent", BROWSER_USER_AGENT)
                .post(submitPayload.toRequestBody("application/json".toMediaType()))
                .build()

            var retryRateLimit = false
            genId = client.newCall(submitReq).execute().use { res ->
                if (res.code == 429 && subAttempt == 0) {
                    retryRateLimit = true
                    return@use ""
                }
                if (!res.isSuccessful) return null
                val body = res.body?.string().orEmpty()
                json.parseToJsonElement(body).jsonObject.str("id")
            }
            if (retryRateLimit) {
                delay(1200L)
                continue
            }
            if (genId.isNotBlank()) break
        }
        if (genId.isBlank()) return null

        for (poll in 0 until 22) {
            delay(2000L)
            val checkReq = Request.Builder()
                .url("https://aihorde.net/api/v2/generate/check/$genId")
                .header("Accept", "application/json")
                .header("Client-Agent", "RSMovieSpot:1.0:rsmoviespot@app.local")
                .header("User-Agent", BROWSER_USER_AGENT)
                .build()
            val checkObj = runCatching {
                client.newCall(checkReq).execute().use { res ->
                    if (!res.isSuccessful) null
                    else json.parseToJsonElement(res.body?.string().orEmpty()).jsonObject
                }
            }.getOrNull() ?: continue

            if (checkObj["faulted"]?.jsonPrimitive?.booleanOrNull == true) return null
            if (checkObj["is_possible"]?.jsonPrimitive?.booleanOrNull == false) return null
            val processing = checkObj["processing"]?.jsonPrimitive?.intOrNull ?: 0
            val queuePos = checkObj["queue_position"]?.jsonPrimitive?.intOrNull ?: 0
            val waitSec = checkObj["wait_time"]?.jsonPrimitive?.intOrNull ?: 0
            if (poll >= 2 && processing == 0 && queuePos > 35 && waitSec > 75) return null
            if (checkObj["done"]?.jsonPrimitive?.booleanOrNull == true) {
                val statusReq = Request.Builder()
                    .url("https://aihorde.net/api/v2/generate/status/$genId")
                    .header("Accept", "application/json")
                    .header("Client-Agent", "RSMovieSpot:1.0:rsmoviespot@app.local")
                    .header("User-Agent", BROWSER_USER_AGENT)
                    .build()
                val imgUrl = client.newCall(statusReq).execute().use { res ->
                    if (!res.isSuccessful) return null
                    val root = json.parseToJsonElement(res.body?.string().orEmpty()).jsonObject
                    root["generations"]?.jsonArray?.firstOrNull()?.jsonObject?.str("img").orEmpty()
                }
                if (!imgUrl.startsWith("http")) return null
                val imgReq = Request.Builder()
                    .url(imgUrl)
                    .header("User-Agent", BROWSER_USER_AGENT)
                    .build()
                client.newCall(imgReq).execute().use { imgRes ->
                    if (!imgRes.isSuccessful) return null
                    val bytes = imgRes.body?.bytes() ?: return null
                    if (bytes.size >= 4096) return bytes
                }
                return null
            }
        }
        return null
    }

    private suspend fun generateViaPollinations(prompt: String, width: Int, height: Int, seed: Int): ByteArray? {
        for (attempt in 0 until 2) {
            val waitRemaining = pollinationsCooldownUntilMs - System.currentTimeMillis()
            if (waitRemaining > 0L) {
                if (waitRemaining <= 48_000L) delay(waitRemaining + 400L)
                else return null
            }
            try {
                val encoded = java.net.URLEncoder.encode(prompt, "UTF-8").replace("+", "%20")
                val url = "https://image.pollinations.ai/prompt/$encoded?width=$width&height=$height&seed=${seed + attempt}&nologo=true"
                val req = Request.Builder()
                    .url(url)
                    .header("User-Agent", BROWSER_USER_AGENT)
                    .build()
                client.newCall(req).execute().use { res ->
                    if (res.code == 402 || res.code == 429) {
                        val errText = res.body?.string().orEmpty()
                        val retryHeaderSec = res.header("Retry-After")?.toLongOrNull()
                        val bodySec = Regex("Retry after (\\d+)s", RegexOption.IGNORE_CASE)
                            .find(errText)?.groupValues?.getOrNull(1)?.toLongOrNull()
                        val waitSec = (retryHeaderSec ?: bodySec ?: 15L).coerceIn(2L, 46L)
                        pollinationsCooldownUntilMs = System.currentTimeMillis() + waitSec * 1000L
                        if (attempt == 0 && waitSec <= 46L) {
                            delay(waitSec * 1000L + 500L)
                        } else {
                            return null
                        }
                        continue
                    }
                    if (!res.isSuccessful) continue
                    val ct = (res.header("Content-Type") ?: "").lowercase(Locale.US)
                    if (ct.isNotEmpty() && !ct.startsWith("image/")) continue
                    val bytes = res.body?.bytes() ?: continue
                    if (bytes.size >= 4096) return bytes
                }
            } catch (_: Throwable) {
                if (attempt == 0) delay(900)
            }
        }
        return null
    }

    private fun buildImageSuffix(promptLower: String, isShorts: Boolean): String {
        val aspect = if (isShorts) "vertical 9:16 full-bleed single camera frame" else "horizontal 16:9 full-bleed single camera frame"
        return when {
            listOf("3d", "pixar", "disney", "cgi", "dreamworks").any { it in promptLower } ->
                ", ONE single unified 3D animated Pixar feature film frame, $aspect, cinematic depth of field, no collage, no text, no watermark"
            listOf("anime", "cartoon", "comic", "illustration", "oil painting", "watercolor", "sketch").any { it in promptLower } ->
                ", ONE single unified $aspect, ultra-detailed art direction, sharp focus, no collage, no grid, no text, no watermark"
            else ->
                ", raw 35mm DSLR live-action movie set photograph, ONE single unified $aspect, candid film still, shallow depth of field, no collage, no text, no watermark, no logos"
        }
    }

    private suspend fun executeCloudflareWithRetry(block: () -> ByteArray): ByteArray {
        var lastErr: Throwable? = null
        for (attempt in 0 until 2) {
            try { return block() } catch (err: Throwable) {
                lastErr = err
                val code = (err as? HttpStatusException)?.statusCode
                if ((code == null || code == 429 || code in 500..599) && attempt == 0) delay(900)
                else throw err
            }
        }
        throw (lastErr ?: IllegalStateException("Cloudflare request failed"))
    }

    private fun executeCloudflareRequest(url: String, apiToken: String, body: okhttp3.RequestBody): ByteArray {
        val req = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $apiToken")
            .header("Accept", "application/json")
            .post(body)
            .build()
        client.newCall(req).execute().use { res ->
            val rawBytes = res.body?.bytes() ?: ByteArray(0)
            val ct = (res.header("Content-Type") ?: "").lowercase(Locale.US)
            if (!res.isSuccessful) {
                throw HttpStatusException(res.code, "HTTP ${res.code}: ${String(rawBytes.copyOf(minOf(240, rawBytes.size)), Charsets.UTF_8)}")
            }
            if (rawBytes.isEmpty()) error("Cloudflare returned empty body.")
            if (ct.startsWith("image/")) {
                if (rawBytes.size < 1024) error("Cloudflare image too small.")
                return rawBytes
            }
            val text = String(rawBytes, Charsets.UTF_8).trim()
            if (text.startsWith("{")) {
                val root = json.parseToJsonElement(text).jsonObject
                val resEl = root["result"]
                val b64 = when (resEl) {
                    is JsonPrimitive -> resEl.contentOrNull.orEmpty()
                    is JsonObject -> resEl.str("image").ifBlank { resEl.str("b64_json") }
                    else -> root.str("image")
                }
                val clean = (if ("base64," in b64) b64.substringAfter("base64,") else b64).replace(Regex("\\s+"), "")
                if (clean.isEmpty()) error("Cloudflare JSON missing image")
                val decoded = Base64.decode(clean, Base64.DEFAULT)
                if (decoded.size < 1024) error("Decoded Cloudflare image too small.")
                return decoded
            }
            if (rawBytes.size < 1024) error("Unexpected short Cloudflare payload.")
            return rawBytes
        }
    }

    private data class PhotoCandidate(
        val url: String,
        val width: Int,
        val height: Int,
        val priority: Int,
        val fallbackUrl: String? = null
    )

    fun isNonCelebrityOrRecipeTopic(query: String, topicContext: String = ""): Boolean {
        val combined = "$query $topicContext".lowercase(Locale.US)
        val intent = detectVisualIntent(query)
        if (intent == "MOVIE_POSTER" || intent == "CHARACTER") return false
        val recipeOrAbstractHints = listOf(
            "biryani", "recipe", "cooking", "cook ", "masala", "dum", "kitchen", "dish",
            "food", "curry", "paneer", "chicken", "spice", "rice", "boil", "fry", "roast",
            "bake", "ingredients", "howto", "how to", "tutorial", "tips", "facts",
            "science", "physics", "chemistry", "biology", "motivation", "mindset",
            "psychology", "mythology", "history", "abstract", "benefits", "health"
        )
        return recipeOrAbstractHints.any { it in combined }
    }

    private fun anchorPhotoQueryWithTopic(query: String, topicContext: String): String {
        val cleanQuery = query.trim()
        val cleanTopic = topicContext.trim()
        if (cleanTopic.isEmpty()) return cleanQuery
        val intent = detectVisualIntent(cleanQuery)
        if (intent == "MOVIE_POSTER") return cleanQuery

        val topicWords = extractCoreQueryWords(cleanTopic).take(3)
        if (topicWords.isEmpty()) return cleanQuery
        val lowerQ = cleanQuery.lowercase(Locale.US)
        val missing = topicWords.filter { it !in lowerQ }
        return if (missing.isEmpty()) cleanQuery else "$cleanQuery ${missing.joinToString(" ")}"
    }

    suspend fun downloadRealPhoto(
        query: String,
        usedUrls: MutableSet<String>,
        destinationFile: File,
        preferPortrait: Boolean = true,
        topicContext: String = "",
        usedHashes: MutableSet<String> = mutableSetOf()
    ): Boolean = withContext(Dispatchers.IO) {
        val clean = query.trim()
        if (clean.isEmpty()) return@withContext false

        if (isNonCelebrityOrRecipeTopic(clean, topicContext)) {
            return@withContext false
        }

        val intent = detectVisualIntent(clean)
        val subject = extractCleanSubject(clean)
        val subjectWords = extractSubjectMatchWords(subject)
        val strictAll = intent == "PERSON" && subjectWords.size <= 2
        val anchored = anchorPhotoQueryWithTopic(clean, topicContext)
        val candidates = linkedMapOf<String, PhotoCandidate>()

        when (intent) {
            "MOVIE_POSTER" -> {
                runCatching { collectImdbPhotoCandidates(subject, candidates, true, false, subjectWords) }
                runCatching { collectItunesMovieCandidates(subject, candidates, listOf("IN", "US"), subjectWords) }
                runCatching { collectWikipediaSummaryCandidates("$subject (film)", candidates, true, subjectWords, false) }
                runCatching { collectWikipediaSummaryCandidates(subject, candidates, true, subjectWords, false) }
                if (candidates.isEmpty()) {
                    runCatching { collectWikipediaSearchCandidates("$subject film", candidates, true, subjectWords, false) }
                }
            }
            "CHARACTER" -> {
                runCatching { collectWikipediaSummaryCandidates("$subject (Marvel Cinematic Universe)", candidates, false, subjectWords, strictAll) }
                runCatching { collectWikipediaSummaryCandidates("$subject (character)", candidates, false, subjectWords, strictAll) }
                if (subjectWords.size >= 2) {
                    runCatching { collectWikipediaSummaryCandidates(subject, candidates, false, subjectWords, strictAll) }
                    runCatching { collectImdbPhotoCandidates(subject, candidates, true, false, subjectWords) }
                    runCatching { collectWikipediaSearchCandidates("$subject character", candidates, false, subjectWords, true) }
                    runCatching { collectItunesMovieCandidates(subject, candidates, listOf("US", "IN"), subjectWords) }
                }
                if (candidates.isEmpty() && subjectWords.size >= 2) {
                    runCatching { collectWikimediaCommonsCandidates(anchored, candidates, subjectWords, strictAll) }
                }
            }
            else -> {
                runCatching { collectWikipediaSummaryCandidates(subject, candidates, false, subjectWords, strictAll) }
                runCatching { collectImdbPhotoCandidates(subject, candidates, false, true, subjectWords) }
                if (candidates.isEmpty()) {
                    runCatching { collectWikipediaSearchCandidates(subject, candidates, false, subjectWords, strictAll) }
                }
                if (candidates.isEmpty()) {
                    runCatching { collectWikimediaCommonsCandidates(subject, candidates, subjectWords, strictAll) }
                }
            }
        }

        tryCandidates(candidates, usedUrls, usedHashes, destinationFile, preferPortrait)
    }

    suspend fun downloadStockPhotoFallback(
        query: String,
        usedUrls: MutableSet<String>,
        destinationFile: File,
        preferPortrait: Boolean = true,
        topicContext: String = "",
        usedHashes: MutableSet<String> = mutableSetOf()
    ): Boolean = withContext(Dispatchers.IO) {
        val clean = query.trim()
        if (clean.isEmpty()) return@withContext false
        val anchored = anchorPhotoQueryWithTopic(clean, topicContext)
        val topicCore = extractCoreQueryWords(topicContext)
        val queryCore = extractCoreQueryWords(clean)
        val requiredWords = (queryCore + topicCore).distinct()
        val candidates = linkedMapOf<String, PhotoCandidate>()
        runCatching { collectOpenversePhotoCandidates(anchored, candidates, topicCore) }
        val core = extractCoreQueryWords(anchored)
        if (candidates.size < 3 && core.isNotEmpty()) {
            runCatching { collectWikimediaCommonsCandidates(core.take(4).joinToString(" "), candidates, requiredWords) }
        }
        tryCandidates(candidates, usedUrls, usedHashes, destinationFile, preferPortrait)
    }

    suspend fun downloadInternetVideoClip(
        query: String,
        isMeme: Boolean,
        usedUrls: MutableSet<String>,
        destinationFile: File
    ): Boolean = withContext(Dispatchers.IO) {
        val clean = query.trim()
        if (clean.isEmpty()) return@withContext false
        val core = extractCoreQueryWords(clean)
        if (core.isEmpty()) return@withContext false

        val list = mutableListOf<Pair<String, Int>>()
        if (isMeme) {
            runCatching { collectTenorMemeClips(clean, core, list) }
            runCatching { collectCoubVideoClips(clean, core, list) }
        } else {
            runCatching { collectCoubVideoClips(clean, core, list) }
            if (list.isEmpty()) runCatching { collectTenorMemeClips(clean, core, list) }
        }
        val ordered = list.distinctBy { it.first }.sortedByDescending { it.second }
        for ((url, _) in ordered) {
            if (url in usedUrls) continue
            if (downloadAndValidateVideoUrl(url, destinationFile)) {
                usedUrls.add(url)
                return@withContext true
            }
        }
        false
    }

    private fun tryCandidates(
        candidates: Map<String, PhotoCandidate>,
        usedUrls: MutableSet<String>,
        usedHashes: MutableSet<String>,
        destinationFile: File,
        preferPortrait: Boolean
    ): Boolean {
        val ordered = candidates.values.sortedWith(
            compareByDescending<PhotoCandidate> { it.priority }
                .thenByDescending { preferPortrait && it.width > 0 && it.height >= it.width * 0.92 }
        )
        for (c in ordered) {
            if (c.url in usedUrls) continue
            if (c.fallbackUrl != null && c.fallbackUrl in usedUrls) continue
            var ok = downloadAndValidateImageUrl(c.url, destinationFile, usedHashes)
            if (!ok && c.fallbackUrl != null) {
                ok = downloadAndValidateImageUrl(c.fallbackUrl, destinationFile, usedHashes)
            }
            if (ok) {
                usedUrls.add(c.url)
                c.fallbackUrl?.let { usedUrls.add(it) }
                return true
            }
        }
        return false
    }

    private fun detectVisualIntent(raw: String): String {
        val lower = raw.lowercase(Locale.US).trim()
        if (listOf("movie", "film", "poster", "web series", "tv series", "series", "cinema", "trailer", "box office").any { it in lower }) {
            return "MOVIE_POSTER"
        }
        if (listOf("character", "superhero", "villain", "comic", "anime", "marvel", "dc comics", "iron man", "superman", "batman", "spider-man", "thor", "hulk", "deadpool", "thanos", "baahubali").any { it in lower }) {
            return "CHARACTER"
        }
        return "PERSON"
    }

    private fun extractCleanSubject(raw: String): String {
        val cleaned = raw.trim()
            .replace(
                Regex("\\b(official\\s+poster|movie\\s+poster|film\\s+poster|character\\s+poster|music\\s+director|poster|movie|film|web\\s+series|tv\\s+series|series|trailer|teaser|scene|clip|video|review|breakdown|actor|actress|director|filmmaker|producer|singer|musician|composer|starcast|star|celebrity|cast|character|superhero|supervillain|villain|picture|photo|portrait|headshot|image|still|stills|wallpaper|biography|wiki|hd|4k)\\b", RegexOption.IGNORE_CASE),
                " "
            )
            .replace(Regex("\\s+"), " ")
            .trim(' ', '-', ':', ',', '.', '"', '\'')
            .ifBlank { raw.trim() }
        return when (cleaned.lowercase(Locale.US)) {
            "ironman" -> "Iron Man"
            "spiderman" -> "Spider-Man"
            "antman" -> "Ant-Man"
            "xmen", "x men" -> "X-Men"
            else -> cleaned
        }
    }

    private fun extractSubjectMatchWords(subject: String): List<String> {
        val stop = setOf("the", "a", "an", "of", "in", "on", "at", "to", "and", "or", "for", "with", "from", "by", "is", "as", "it", "no", "so", "up", "vs")
        return subject.lowercase(Locale.US)
            .replace(Regex("[^a-z0-9\\s]"), " ")
            .split(Regex("\\s+"))
            .filter { it.length >= 2 && it !in stop }
            .distinct()
    }

    private fun matchesCandidateSubject(textLower: String, subjectWords: List<String>, strictAll: Boolean = false): Boolean {
        if (subjectWords.isEmpty()) return true
        val hits = subjectWords.count { w ->
            Regex("(?<![a-z0-9])${Regex.escape(w)}(?![a-z0-9])").containsMatchIn(textLower)
        }
        if (strictAll || subjectWords.size <= 2) return hits == subjectWords.size
        val minNeeded = minOf(subjectWords.size, maxOf(2, kotlin.math.ceil(subjectWords.size * 0.65).toInt()))
        return hits >= minNeeded
    }

    private fun extractCoreQueryWords(query: String): List<String> {
        val stop = setOf(
            "the", "a", "an", "of", "in", "on", "at", "to", "and", "or", "for", "with", "from",
            "movie", "film", "cinema", "scene", "trailer", "clip", "video", "meme", "funny",
            "reaction", "official", "hd", "4k", "shorts", "raw", "35mm", "dslr", "shot",
            "close", "closeup", "wide", "medium", "overhead", "angle", "vertical", "horizontal",
            "cinematic", "lighting", "warm", "cozy", "dramatic", "rich", "golden", "steaming",
            "aromatic", "vibrant", "soft", "bright", "dark", "deep", "single", "unified", "frame",
            "make", "making", "best", "easy", "style", "secrets", "secret", "recipe",
            "actor", "actress", "director", "singer", "composer", "poster"
        )
        return query.lowercase(Locale.US).replace(Regex("[^a-z0-9\\s]"), " ")
            .split(Regex("\\s+"))
            .filter { it.length >= 3 && it !in stop }
            .distinct()
    }

    private fun hasDisallowedPhotoArtifactKeywords(combinedLower: String, queryLower: String): Boolean {
        val blocked = listOf(
            "book cover", "bookcover", "hardcover", "paperback", "isbn", "textbook", "novel",
            "encyclopedia", "handbook", "manual", "magazine", "newspaper", "front page",
            "fossil", "specimen", "holotype", "scale bar", "ruler", "cm scale", "herbarium",
            "museum specimen", "skeleton", "diagram", "infographic", "flowchart", "chart",
            "graph", "schematic", "blueprint", "map of", "scanned", "manuscript",
            "handwritten", "recipe card", "document", "letter", "statue", "locomotive",
            "train", "illustration", "comic", "screenshot", "clipart", "vector", "logo",
            "wordmark", "text overlay", "banner", "flyer", "brochure"
        )
        return blocked.any { it in combinedLower && it !in queryLower }
    }

    private fun collectOpenversePhotoCandidates(
        q: String,
        out: MutableMap<String, PhotoCandidate>,
        topicCore: List<String> = emptyList()
    ) {
        val coreWords = extractCoreQueryWords(q)
        val searchQ = if (coreWords.isNotEmpty()) coreWords.take(4).joinToString(" ") else q
        val url = "https://api.openverse.org/v1/images/".toHttpUrl().newBuilder()
            .addQueryParameter("q", searchQ)
            .addQueryParameter("category", "photograph")
            .addQueryParameter("extension", "jpg,png")
            .addQueryParameter("mature", "false")
            .addQueryParameter("page_size", "20")
            .build().toString()
        val body = fetchTextString(url, WIKIMEDIA_USER_AGENT, "application/json") ?: return
        val results = json.parseToJsonElement(body).jsonObject["results"]?.jsonArray ?: return
        val qLower = q.lowercase(Locale.US)
        for (el in results) {
            val obj = el.jsonObject
            val imgUrl = obj.str("url")
            val title = obj.str("title").lowercase(Locale.US)
            val tagsText = obj["tags"]?.jsonArray?.joinToString(" ") { it.jsonObject.str("name") }?.lowercase(Locale.US).orEmpty()
            val combined = "$title $tagsText ${imgUrl.lowercase(Locale.US)}"
            if (hasDisallowedPhotoArtifactKeywords(combined, qLower)) continue
            if (coreWords.isNotEmpty() && coreWords.none { it in combined }) continue
            if (topicCore.isNotEmpty() && topicCore.none { it in combined }) continue
            val w = obj["width"]?.jsonPrimitive?.intOrNull ?: 0
            val h = obj["height"]?.jsonPrimitive?.intOrNull ?: 0
            if (imgUrl.startsWith("http") && (w == 0 || w >= 400) && (h == 0 || h >= 400) && isCleanPhotoUrl(imgUrl)) {
                out.putIfAbsent(imgUrl, PhotoCandidate(imgUrl, w, h, 4))
            }
        }
    }

    private fun collectCoubVideoClips(q: String, core: List<String>, out: MutableList<Pair<String, Int>>) {
        val url = "https://coub.com/api/v2/search/coubs".toHttpUrl().newBuilder()
            .addQueryParameter("per_page", "20").addQueryParameter("q", q).build().toString()
        val body = fetchTextString(url, BROWSER_USER_AGENT, "application/json") ?: return
        val coubs = json.parseToJsonElement(body).jsonObject["coubs"]?.jsonArray ?: return
        val reqHits = if (core.size <= 2) core.size else maxOf(2, (core.size * 2 + 2) / 3)
        for (el in coubs) {
            val obj = el.jsonObject
            val title = obj.str("title")
            val searchable = title.lowercase(Locale.US)
            val hits = core.count { it in searchable }
            if (hits < reqHits) continue
            val videoObj = obj["file_versions"]?.jsonObject?.get("html5")?.jsonObject?.get("video")?.jsonObject ?: continue
            val mp4 = videoObj["high"]?.jsonObject?.str("url").orEmpty().ifBlank { videoObj["med"]?.jsonObject?.str("url").orEmpty() }
            if (mp4.startsWith("http")) out.add(mp4 to (hits * 100 + 40))
        }
    }

    private fun collectTenorMemeClips(q: String, core: List<String>, out: MutableList<Pair<String, Int>>) {
        val slug = q.lowercase(Locale.US).replace(Regex("[^a-z0-9]+"), "-").trim('-')
        if (slug.isEmpty()) return
        val html = fetchTextString("https://tenor.com/search/$slug-gifs", BROWSER_USER_AGENT) ?: return
        val matches = Regex("https://media\\.tenor\\.com/[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+\\.mp4").findAll(html).map { it.value }.distinct()
        for (mp4 in matches) {
            val fileSlug = mp4.substringAfterLast('/').lowercase(Locale.US)
            val hits = core.count { it in fileSlug }
            if (hits > 0 || core.isEmpty()) {
                out.add(mp4 to (hits * 90 + if ("AAAPo" in mp4) 55 else 15))
            }
        }
    }

    private fun collectImdbPhotoCandidates(
        term: String,
        out: MutableMap<String, PhotoCandidate>,
        preferMovies: Boolean,
        allowPeople: Boolean,
        subjectWordsInput: List<String>? = null
    ) {
        val norm = term.lowercase(Locale.US).replace(Regex("[^a-z0-9]+"), "_").trim('_')
        if (norm.isEmpty()) return
        val ch = if (norm[0].isLetterOrDigit()) norm[0] else 'x'
        val url = "https://v3.sg.media-imdb.com/suggestion/$ch/${java.net.URLEncoder.encode(norm, "UTF-8")}.json"
        val body = fetchTextString(url, WIKIMEDIA_USER_AGENT, "application/json") ?: return
        val arr = json.parseToJsonElement(body).jsonObject["d"]?.jsonArray ?: return
        val queryClean = term.lowercase(Locale.US).replace(Regex("[^a-z0-9\\s]"), " ").replace(Regex("\\s+"), " ").trim()
        val queryWords = subjectWordsInput?.takeIf { it.isNotEmpty() } ?: extractSubjectMatchWords(term)

        for (el in arr) {
            val obj = el.jsonObject
            val label = obj.str("l").lowercase(Locale.US)
            val labelNorm = label.replace(Regex("[^a-z0-9\\s]"), " ").replace(Regex("\\s+"), " ").trim()
            val labelWords = labelNorm.split(' ').filter { it.isNotEmpty() }
            val id = obj.str("id")
            val qid = obj.str("qid").lowercase(Locale.US)
            val qLabel = obj.str("q").lowercase(Locale.US)

            val isMovieOrSeries = qid in setOf("movie", "tvseries", "tvminiseries", "tvmovie") ||
                (id.startsWith("tt") && qid !in setOf("musicvideo", "video", "podcastepisode") && ("feature" in qLabel || "series" in qLabel || qid.isEmpty()))
            val isPerson = id.startsWith("nm")
            if (!allowPeople && isPerson) continue
            if (preferMovies && !allowPeople && !isMovieOrSeries) continue

            val hits = queryWords.count { w -> Regex("(?<![a-z0-9])${Regex.escape(w)}(?![a-z0-9])").containsMatchIn(labelNorm) }
            val isMononym = isPerson && queryWords.size >= 2 && labelWords.size == 1 && labelWords[0] == queryWords[0]
            val matchesStrict = queryWords.isEmpty() ||
                hits == queryWords.size ||
                (queryWords.size >= 3 && hits >= kotlin.math.ceil(queryWords.size * 0.65).toInt()) ||
                isMononym
            if (!matchesStrict) continue

            val img = obj["i"]?.jsonObject ?: continue
            val rawUrl = img.str("imageUrl")
            if (!rawUrl.startsWith("http")) continue
            val w = img["width"]?.jsonPrimitive?.intOrNull ?: 0
            val h = img["height"]?.jsonPrimitive?.intOrNull ?: 0
            val upgraded = if ("._V1_" in rawUrl) rawUrl.substringBefore("._V1_") + "._V1_SX1000_.jpg" else rawUrl
            val exactBoost = when {
                labelNorm == queryClean -> 6
                hits == queryWords.size -> 4
                labelNorm.startsWith(queryClean) -> 3
                else -> 1
            }
            val typeBoost = when {
                preferMovies && isMovieOrSeries -> 6
                !preferMovies && isPerson -> 7
                isMovieOrSeries || isPerson -> 2
                else -> 0
            }
            out.putIfAbsent(upgraded, PhotoCandidate(upgraded, w, h, exactBoost + typeBoost, rawUrl))
        }
    }

    private fun collectItunesMovieCandidates(
        term: String,
        out: MutableMap<String, PhotoCandidate>,
        countries: List<String>,
        subjectWordsInput: List<String>? = null
    ) {
        val queryWords = subjectWordsInput?.takeIf { it.isNotEmpty() } ?: extractSubjectMatchWords(term)
        for (c in countries) {
            val url = "https://itunes.apple.com/search".toHttpUrl().newBuilder()
                .addQueryParameter("term", term).addQueryParameter("media", "movie")
                .addQueryParameter("entity", "movie").addQueryParameter("limit", "6")
                .addQueryParameter("country", c).build().toString()
            val body = fetchTextString(url, WIKIMEDIA_USER_AGENT, "application/json") ?: continue
            val arr = json.parseToJsonElement(body).jsonObject["results"]?.jsonArray ?: continue
            for (el in arr) {
                val obj = el.jsonObject
                val trackName = obj.str("trackName").lowercase(Locale.US)
                if (!matchesCandidateSubject(trackName, queryWords, queryWords.size <= 2)) continue
                val art100 = obj.str("artworkUrl100")
                if (!art100.startsWith("http")) continue
                val hd = art100.replace(Regex("\\d+x\\d+bb"), "1400x1400bb")
                val fb = art100.replace(Regex("\\d+x\\d+bb"), "1000x1000bb")
                out.putIfAbsent(hd, PhotoCandidate(hd, 933, 1400, 6, fb))
            }
        }
    }

    private fun collectWikipediaSummaryCandidates(
        query: String,
        out: MutableMap<String, PhotoCandidate>,
        requireEnt: Boolean,
        requiredWords: List<String> = emptyList(),
        strictAll: Boolean = false
    ) {
        val title = java.net.URLEncoder.encode(query.replace(' ', '_'), "UTF-8")
        val body = fetchTextString("https://en.wikipedia.org/api/rest_v1/page/summary/$title", WIKIMEDIA_USER_AGENT, "application/json") ?: return
        val root = json.parseToJsonElement(body).jsonObject
        if (root.str("type").equals("disambiguation", true)) return
        val comb = (root.str("title") + " " + root.str("description") + " " + root.str("extract")).lowercase(Locale.US)
        if (requireEnt) {
            if (listOf("film", "movie", "cinema", "directed by", "starring", "series", "animated", "superhero").none { it in comb }) return
        }
        if (hasDisallowedPhotoArtifactKeywords(comb, query.lowercase(Locale.US))) return
        if (!matchesCandidateSubject(comb, requiredWords, strictAll)) return
        for (key in listOf("originalimage", "thumbnail")) {
            val img = root[key]?.jsonObject ?: continue
            val src = img.str("source")
            if (src.startsWith("http") && isCleanPhotoUrl(src) && !hasDisallowedPhotoArtifactKeywords(src.lowercase(Locale.US), query.lowercase(Locale.US))) {
                out.putIfAbsent(src, PhotoCandidate(src, img["width"]?.jsonPrimitive?.intOrNull ?: 0, img["height"]?.jsonPrimitive?.intOrNull ?: 0, 5))
            }
        }
    }

    private fun collectWikipediaSearchCandidates(
        query: String,
        out: MutableMap<String, PhotoCandidate>,
        requireEnt: Boolean,
        requiredWords: List<String> = emptyList(),
        strictAll: Boolean = false
    ) {
        val url = "https://en.wikipedia.org/w/api.php".toHttpUrl().newBuilder()
            .addQueryParameter("action", "query").addQueryParameter("generator", "search")
            .addQueryParameter("gsrsearch", query).addQueryParameter("gsrlimit", "6")
            .addQueryParameter("prop", "pageimages|extracts").addQueryParameter("exintro", "1")
            .addQueryParameter("explaintext", "1").addQueryParameter("piprop", "original|thumbnail")
            .addQueryParameter("pithumbsize", "1200").addQueryParameter("format", "json").build().toString()
        val body = fetchTextString(url, WIKIMEDIA_USER_AGENT, "application/json") ?: return
        val pages = json.parseToJsonElement(body).jsonObject["query"]?.jsonObject?.get("pages")?.jsonObject ?: return
        val qLower = query.lowercase(Locale.US)
        for (p in pages.values) {
            val page = p.jsonObject
            val metaText = (page.str("title") + " " + page.str("extract")).lowercase(Locale.US)
            if (requireEnt && listOf("film", "movie", "cinema", "directed", "starring", "series", "character").none { it in metaText }) continue
            if (hasDisallowedPhotoArtifactKeywords(metaText, qLower)) continue
            if (!matchesCandidateSubject(metaText, requiredWords, strictAll)) continue
            for (key in listOf("original", "thumbnail")) {
                val img = page[key]?.jsonObject ?: continue
                val src = img.str("source")
                if (src.startsWith("http") && isCleanPhotoUrl(src) && !hasDisallowedPhotoArtifactKeywords(src.lowercase(Locale.US), qLower)) {
                    out.putIfAbsent(src, PhotoCandidate(src, img["width"]?.jsonPrimitive?.intOrNull ?: 0, img["height"]?.jsonPrimitive?.intOrNull ?: 0, 3))
                }
            }
        }
    }

    private fun collectWikimediaCommonsCandidates(
        q: String,
        out: MutableMap<String, PhotoCandidate>,
        requiredWords: List<String> = emptyList(),
        strictAll: Boolean = false
    ) {
        val url = "https://commons.wikimedia.org/w/api.php".toHttpUrl().newBuilder()
            .addQueryParameter("action", "query").addQueryParameter("generator", "search")
            .addQueryParameter("gsrnamespace", "6").addQueryParameter("gsrsearch", q)
            .addQueryParameter("gsrlimit", "12").addQueryParameter("prop", "imageinfo")
            .addQueryParameter("iiprop", "url|size|mime").addQueryParameter("iiurlwidth", "1200")
            .addQueryParameter("format", "json").build().toString()
        val body = fetchTextString(url, WIKIMEDIA_USER_AGENT, "application/json") ?: return
        val pages = json.parseToJsonElement(body).jsonObject["query"]?.jsonObject?.get("pages")?.jsonObject ?: return
        val qLower = q.lowercase(Locale.US)
        for (p in pages.values) {
            val pageObj = p.jsonObject
            val fileTitle = pageObj.str("title").lowercase(Locale.US)
            if (hasDisallowedPhotoArtifactKeywords(fileTitle, qLower)) continue
            if (!matchesCandidateSubject(fileTitle, requiredWords, strictAll)) continue
            val info = pageObj["imageinfo"]?.jsonArray?.firstOrNull()?.jsonObject ?: continue
            val mime = info.str("mime").lowercase(Locale.US)
            val w = info["width"]?.jsonPrimitive?.intOrNull ?: 0
            val h = info["height"]?.jsonPrimitive?.intOrNull ?: 0
            if (mime !in setOf("image/jpeg", "image/png") || w < 400 || h < 400) continue
            val chosen = info.str("thumburl").ifBlank { info.str("url") }
            if (chosen.startsWith("http") && isCleanPhotoUrl(chosen) && !hasDisallowedPhotoArtifactKeywords(chosen.lowercase(Locale.US), qLower)) {
                out.putIfAbsent(chosen, PhotoCandidate(chosen, w, h, 1))
            }
        }
    }

    private fun isCleanPhotoUrl(s: String): Boolean {
        val lower = s.lowercase(Locale.US)
        if (lower.endsWith(".svg") || lower.endsWith(".gif") || lower.endsWith(".pdf")) return false
        return listOf(
            "signature", "autograph", "logo", "icon", "flag", "map", "diagram",
            "chart", "emblem", "wordmark", "book_cover", "bookcover", "specimen",
            "fossil", "ruler", "scale_bar", "herbarium", "manuscript", "scan"
        ).none { it in lower }
    }

    private fun fetchTextString(url: String, userAgent: String, accept: String? = null): String? {
        return try {
            val builder = Request.Builder().url(url).header("User-Agent", userAgent)
            if (accept != null) builder.header("Accept", accept)
            client.newCall(builder.build()).execute().use { res ->
                if (!res.isSuccessful) null else res.body?.string()?.takeIf { it.isNotBlank() }
            }
        } catch (_: Throwable) {
            null
        }
    }

    private fun sha256Hex(bytes: ByteArray): String {
        val digest = java.security.MessageDigest.getInstance("SHA-256").digest(bytes)
        return digest.joinToString("") { "%02x".format(it) }
    }

    private fun downloadAndValidateImageUrl(
        url: String,
        dest: File,
        usedHashes: MutableSet<String> = mutableSetOf()
    ): Boolean {
        return try {
            val req = Request.Builder().url(url).header("User-Agent", WIKIMEDIA_USER_AGENT).build()
            client.newCall(req).execute().use { res ->
                if (!res.isSuccessful) return false
                val ct = (res.header("Content-Type") ?: "").lowercase(Locale.US)
                if (ct.isNotEmpty() && (!ct.startsWith("image/") || "svg" in ct)) return false
                val bytes = res.body?.bytes() ?: return false
                val hash = sha256Hex(bytes)
                if (hash in usedHashes) return false
                dest.parentFile?.mkdirs()
                FileOutputStream(dest).use { it.write(bytes) }
                val ok = ImageComposer.decodeImageDimensions(dest) != null
                if (!ok) {
                    dest.delete()
                    return false
                }
                usedHashes.add(hash)
                true
            }
        } catch (_: Throwable) {
            dest.delete()
            false
        }
    }

    private fun downloadAndValidateVideoUrl(url: String, dest: File): Boolean {
        return try {
            val req = Request.Builder().url(url).header("User-Agent", BROWSER_USER_AGENT).build()
            client.newCall(req).execute().use { res ->
                if (!res.isSuccessful) return false
                val ct = (res.header("Content-Type") ?: "").lowercase(Locale.US)
                if ("text/html" in ct) return false
                val bytes = res.body?.bytes() ?: return false
                if (bytes.size !in 20_000..25_000_000) return false
                val header = String(bytes.copyOf(minOf(64, bytes.size)), Charsets.ISO_8859_1)
                if ("ftyp" !in header) return false
                dest.parentFile?.mkdirs()
                FileOutputStream(dest).use { it.write(bytes) }
                true
            }
        } catch (_: Throwable) {
            dest.delete()
            false
        }
    }

    private class HttpStatusException(val statusCode: Int, message: String) : Exception(message)
}
