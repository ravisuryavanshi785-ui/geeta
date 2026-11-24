package com.rsmoviespot.domain.models

import kotlinx.serialization.Serializable

enum class ContentMode(val label: String, val hint: String) {
    AUTO(
        label = "Auto",
        hint = "Paste any script or topic — AI auto-adapts story, visuals & mood."
    ),
    REVIEW(
        label = "Review",
        hint = "Movie or trailer name / review script — cast photos, official poster & rating badges."
    ),
    MOVIE_ROAST(
        label = "Movie Roast",
        hint = "Movie name or roast script — punchy comedy lines, meme cuts & logic roast."
    ),
    REACTION(
        label = "Reaction",
        hint = "Trailer or viral scene topic — split/flip reactions, high-emotion beats & polls."
    ),
    STORY(
        label = "Story",
        hint = "Story idea or full kahani — locks main character visuals across all AI scenes."
    ),
    KIDS_STORY(
        label = "Kids Story",
        hint = "Kids adventure or moral story — warm playful narration & 3D Pixar storybook visuals."
    ),
    COOKING(
        label = "Cooking",
        hint = "Dish name or recipe steps — appetizing macro food visuals & step badges."
    )
}

enum class InputMode(val label: String, val hint: String) {
    AUTO(
        label = "Auto",
        hint = "Paste a full script or type a topic/director prompt (auto-detected)."
    ),
    EXACT_SCRIPT(
        label = "Exact Script",
        hint = "Paste your exact voiceover script. Every word will be spoken as written."
    ),
    AI_PROMPT(
        label = "AI Prompt",
        hint = "Describe a movie topic, roast, review, or scene instructions for AI to write."
    )
}

enum class VoiceGender(val label: String) {
    MALE("Male"),
    FEMALE("Female")
}

enum class VoiceTone(val label: String) {
    AUTO("Auto"),
    NATURAL("Podcast / Natural"),
    FUNNY("Funny / Roast"),
    SERIOUS("Serious / Intense"),
    ENERGETIC("Energetic / Hype")
}

enum class VisualStyleMode(val label: String) {
    AUTO("Auto Visuals"),
    PIXAR_3D("3D Pixar Story"),
    ANIME_3D("Anime Motion"),
    LIVE_ACTION("Live-Action 35mm")
}

enum class VideoLanguage(
    val label: String,
    val languageInstruction: String,
    val maleVoice: String,
    val femaleVoice: String
) {
    AUTO("Auto", "", "hi-IN-MadhurNeural", "hi-IN-SwaraNeural"),
    HINDI("Hindi", "spoken Hindi in Devanagari script", "hi-IN-MadhurNeural", "hi-IN-SwaraNeural"),
    ENGLISH_IN("English (IN)", "natural Indian English", "en-IN-PrabhatNeural", "en-IN-NeerjaNeural"),
    ENGLISH_US("English (US)", "punchy American English", "en-US-AndrewNeural", "en-US-AvaNeural"),
    MARATHI("Marathi", "natural Marathi in Devanagari script", "mr-IN-ManoharNeural", "mr-IN-AarohiNeural"),
    GUJARATI("Gujarati", "natural Gujarati in Gujarati script", "gu-IN-NiranjanNeural", "gu-IN-DhwaniNeural"),
    BENGALI("Bengali", "natural Bengali in Bengali script", "bn-IN-BashkarNeural", "bn-IN-TanishaaNeural"),
    TAMIL("Tamil", "natural Tamil in Tamil script", "ta-IN-ValluvarNeural", "ta-IN-PallaviNeural"),
    TELUGU("Telugu", "natural Telugu in Telugu script", "te-IN-MohanNeural", "te-IN-ShrutiNeural"),
    KANNADA("Kannada", "natural Kannada in Kannada script", "kn-IN-GaganNeural", "kn-IN-SapnaNeural"),
    MALAYALAM("Malayalam", "natural Malayalam in Malayalam script", "ml-IN-MidhunNeural", "ml-IN-SobhanaNeural"),
    PUNJABI("Punjabi", "natural Punjabi in Gurmukhi script", "pa-IN-OjasNeural", "pa-IN-VaaniNeural"),
    URDU("Urdu", "natural Urdu in Perso-Arabic script", "ur-IN-SalmanNeural", "ur-IN-GulNeural"),
    SPANISH("Spanish", "natural Spanish", "es-ES-AlvaroNeural", "es-ES-ElviraNeural"),
    FRENCH("French", "natural French", "fr-FR-HenriNeural", "fr-FR-DeniseNeural"),
    JAPANESE("Japanese", "natural Japanese", "ja-JP-KeitaNeural", "ja-JP-NanamiNeural"),
    ARABIC("Arabic", "natural Arabic", "ar-SA-HamedNeural", "ar-SA-ZariyahNeural");

    fun resolveVoice(gender: VoiceGender): String {
        return if (gender == VoiceGender.FEMALE) femaleVoice else maleVoice
    }
}

enum class BgmStyle {
    COMEDY_ROAST,
    EPIC_ACTION,
    SUSPENSE_THRILLER,
    EMOTIONAL_SAD,
    DEVOTIONAL,
    SCI_FI_TECH,
    MOTIVATIONAL,
    HORROR_DARK
}

@Serializable
data class VideoSlab(
    val id: Int = 1,
    val voiceover_text: String = "",
    val image_prompt: String = "",
    val sfx_cue: String = "whoosh",
    val has_character: Boolean = false,
    val voice_emotion: String = "normal",
    val visual_source: String = "ai_generated",
    val real_photo_query: String = "",
    val layout_mode: String = "single",
    val visual_source_2: String = "",
    val real_photo_query_2: String = "",
    val image_prompt_2: String = "",
    val stat_badge: String = "",
    val customMediaUri: String = "",
    val customMediaType: String = "",
    val customMediaUri2: String = "",
    val customMediaType2: String = ""
)

@Serializable
data class VideoScriptResponse(
    val character_bible: String = "",
    val visual_style: String = "",
    val bgm_mood: String = "epic_action",
    val voice_name: String = "hi-IN-MadhurNeural",
    val youtube_title: String = "",
    val youtube_description: String = "",
    val youtube_hashtags: String = "",
    val pinned_comment: String = "",
    val slabs: List<VideoSlab> = emptyList()
)

data class MainUiState(
    val topic: String = "",
    val contentMode: ContentMode = ContentMode.AUTO,
    val inputMode: InputMode = InputMode.AUTO,
    val isShorts: Boolean = true,
    val selectedLanguage: VideoLanguage = VideoLanguage.AUTO,
    val selectedGender: VoiceGender = VoiceGender.MALE,
    val selectedVoiceTone: VoiceTone = VoiceTone.AUTO,
    val selectedVisualStyle: VisualStyleMode = VisualStyleMode.AUTO,
    val selectedBgmName: String = "Built-in Cinematic BGM",
    val hasCustomBgm: Boolean = false,
    val isLoadingTrending: Boolean = false,
    val trendingTopics: List<String> = emptyList(),
    val isPreviewingScript: Boolean = false,
    val draftScript: VideoScriptResponse? = null,
    val isGenerating: Boolean = false,
    val progressText: String = "",
    val progressPercentage: Int = 0,
    val statusMessage: String = "",
    val generatedVideoPath: String? = null,
    val generatedThumbnailPath: String? = null,
    val savedGalleryUri: String? = null,
    val videoDurationSec: Int = 0,
    val completedScript: VideoScriptResponse? = null
)
