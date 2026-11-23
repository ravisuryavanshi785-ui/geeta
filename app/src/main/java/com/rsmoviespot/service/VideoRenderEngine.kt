package com.rsmoviespot.service

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.MediaMuxer
import android.net.Uri
import com.rsmoviespot.data.api.EdgeTtsApi
import com.rsmoviespot.data.api.GeminiTtsApi
import com.rsmoviespot.data.api.repository.VideoRepository
import com.rsmoviespot.domain.models.InputMode
import com.rsmoviespot.domain.models.VideoLanguage
import com.rsmoviespot.domain.models.VideoScriptResponse
import com.rsmoviespot.domain.models.VideoSlab
import com.rsmoviespot.domain.models.VisualStyleMode
import com.rsmoviespot.domain.models.VoiceGender
import com.rsmoviespot.domain.models.VoiceTone
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.util.Collections
import java.util.UUID
import kotlin.coroutines.coroutineContext
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

data class RenderResult(
    val videoFile: File,
    val thumbnailFile: File?,
    val script: VideoScriptResponse
)

class VideoRenderEngine(
    private val context: Context,
    private val repository: VideoRepository = VideoRepository(),
    private val edgeTts: EdgeTtsApi = EdgeTtsApi(),
    private val geminiTts: GeminiTtsApi = GeminiTtsApi()
) {
    companion object {
        private const val SHORTS_WIDTH = 720
        private const val SHORTS_HEIGHT = 1280
        private const val LANDSCAPE_WIDTH = 1280
        private const val LANDSCAPE_HEIGHT = 720
        private const val FPS = 24
        private const val AUDIO_TAIL_SECONDS = 0.35
    }

    suspend fun renderVideo(
        topic: String,
        isShorts: Boolean,
        customBgmUri: Uri?,
        preGeneratedScript: VideoScriptResponse?,
        language: VideoLanguage,
        voiceGender: VoiceGender,
        voiceTone: VoiceTone,
        inputMode: InputMode,
        visualStyle: VisualStyleMode = VisualStyleMode.AUTO,
        onProgress: (percent: Int, message: String) -> Unit
    ): RenderResult = withContext(Dispatchers.Default) {
        val cleanTopic = topic.trim()
        require(cleanTopic.isNotEmpty()) { "Topic must not be blank." }

        val width = if (isShorts) SHORTS_WIDTH else LANDSCAPE_WIDTH
        val height = if (isShorts) SHORTS_HEIGHT else LANDSCAPE_HEIGHT
        val jobId = UUID.randomUUID().toString()
        val workDir = File(context.cacheDir, "render_$jobId").apply { mkdirs() }
        val exportDir = File(context.filesDir, "renders/$jobId").apply { mkdirs() }

        try {
            val script = if (preGeneratedScript != null && preGeneratedScript.slabs.isNotEmpty()) {
                onProgress(4, "Using your approved script…")
                preGeneratedScript
            } else {
                onProgress(2, "Generating story script…")
                repository.generateScript(cleanTopic, isShorts, language, voiceGender, inputMode, voiceTone, visualStyle)
            }
            coroutineContext.ensureActive()
            require(script.slabs.isNotEmpty()) { "The generated script has no scenes." }

            val activeVoice = if (language != VideoLanguage.AUTO) {
                language.resolveVoice(voiceGender)
            } else {
                repository.enforceVoiceGender(script.voice_name, voiceGender)
            }
            val baseSeed = max(1000, abs(cleanTopic.lowercase().hashCode()))

            onProgress(
                10,
                if (geminiTts.isAvailable()) "Recording 1-ticket emotional Gemini voiceover…"
                else "Recording expressive voiceover…"
            )
            val geminiClips = if (geminiTts.isAvailable()) {
                runCatching {
                    geminiTts.synthesizeOneTicketSceneClips(
                        slabs = script.slabs,
                        voiceGender = voiceGender,
                        voiceTone = voiceTone,
                        language = language
                    )
                }.getOrNull()
            } else {
                null
            }
            val sceneAudioPcms = if (geminiClips != null && geminiClips.size == script.slabs.size) {
                geminiClips
            } else {
                if (geminiTts.isAvailable()) {
                    onProgress(12, "Switching to fallback voice engine…")
                }
                synthesizeAndTrimVoiceClips(
                    slabs = script.slabs,
                    activeVoice = activeVoice,
                    voiceTone = voiceTone,
                    workDir = workDir
                )
            }
            coroutineContext.ensureActive()

            onProgress(35, "Preparing scenes & visuals…")
            val topicContext = listOf(cleanTopic, script.character_bible)
                .filter { it.isNotBlank() }
                .joinToString(" ")
            val usedMediaUrls = Collections.synchronizedSet(mutableSetOf<String>())
            val usedImageHashes = Collections.synchronizedSet(mutableSetOf<String>())
            val visualSemaphore = Semaphore(2)
            val sceneBitmaps = coroutineScope {
                script.slabs.mapIndexed { idx, slab ->
                    async(Dispatchers.IO) {
                        coroutineContext.ensureActive()
                        visualSemaphore.withPermit {
                            val done = buildSceneVisualPair(
                                slab = slab,
                                index = idx,
                                isShorts = isShorts,
                                width = width,
                                height = height,
                                seed = baseSeed + idx * 31,
                                workDir = workDir,
                                topicContext = topicContext,
                                visualStyleMode = visualStyle,
                                usedUrls = usedMediaUrls,
                                usedHashes = usedImageHashes
                            )
                            onProgress(35 + ((idx + 1) * 35 / script.slabs.size), "Prepared scene ${idx + 1} of ${script.slabs.size}…")
                            done
                        }
                    }
                }.awaitAll()
            }
            coroutineContext.ensureActive()

            onProgress(72, "Mixing studio voiceover & BGM…")
            val sceneStartSamples = IntArray(script.slabs.size)
            val sceneDurations = DoubleArray(script.slabs.size)
            val sceneFrameCounts = IntArray(script.slabs.size)
            val combinedVoiceStream = mutableListOf<ShortArray>()
            var totalVoiceSamples = 0

            for (i in script.slabs.indices) {
                sceneStartSamples[i] = totalVoiceSamples
                val pcm = sceneAudioPcms[i]
                val spokenSec = pcm.size.toDouble() / BgmSynth.SAMPLE_RATE
                val paddedSec = max(1.6, spokenSec + AUDIO_TAIL_SECONDS)
                sceneDurations[i] = paddedSec
                val frameCount = max(FPS, ceil(paddedSec * FPS).toInt())
                sceneFrameCounts[i] = frameCount
                val frameAlignedSamples = ceil((frameCount.toDouble() / FPS) * BgmSynth.SAMPLE_RATE).toInt()
                val sceneSamples = max(pcm.size, frameAlignedSamples)
                val padded = ShortArray(sceneSamples)
                pcm.copyInto(padded, 0, 0, pcm.size)
                combinedVoiceStream.add(padded)
                totalVoiceSamples += sceneSamples
            }

            val fullVoicePcm = ShortArray(totalVoiceSamples)
            var offset = 0
            for (chunk in combinedVoiceStream) {
                chunk.copyInto(fullVoicePcm, offset)
                offset += chunk.size
            }

            val bgmPcm = if (customBgmUri != null) {
                runCatching {
                    val customFile = File(workDir, "custom_bgm.audio")
                    context.contentResolver.openInputStream(customBgmUri)?.use { input ->
                        FileOutputStream(customFile).use { output -> input.copyTo(output) }
                    }
                    val decoded = decodeAudioToMono44100Pcm(customFile)
                    if (decoded.size > BgmSynth.SAMPLE_RATE) decoded else null
                }.getOrNull()
            } else {
                null
            } ?: BgmSynth.synthesizeBgmPcm(script.bgm_mood, baseSeed)

            val sfxEvents = script.slabs.mapIndexedNotNull { idx, slab ->
                if (idx == 0 || slab.sfx_cue.isNotBlank()) {
                    sceneStartSamples[idx] to BgmSynth.synthesizeSfxPcm(slab.sfx_cue)
                } else {
                    null
                }
            }

            val totalDurationSec = totalVoiceSamples.toDouble() / BgmSynth.SAMPLE_RATE
            val mixedPcm = BgmSynth.mixVoiceBgmSfx(fullVoicePcm, bgmPcm, sfxEvents, totalDurationSec)

            onProgress(80, "Encoding final MP4 video…")
            val outVideo = File(exportDir, "RS_Movie_Spot_${System.currentTimeMillis()}.mp4")
            encodeMp4(
                outVideo = outVideo,
                width = width,
                height = height,
                isShorts = isShorts,
                slabs = script.slabs,
                sceneVisuals = sceneBitmaps,
                sceneFrameCounts = sceneFrameCounts,
                mixedPcm = mixedPcm,
                onProgress = { pct ->
                    onProgress(80 + (pct * 18 / 100), "Encoding MP4 video ($pct%)…")
                }
            )

            onProgress(99, "Generating cover thumbnail…")
            val coverFile = File(exportDir, "RS_Movie_Spot_Cover.jpg")
            val coverSource = sceneBitmaps.firstOrNull()?.first
            if (coverSource != null) {
                ImageComposer.renderCoverThumbnailJpg(
                    sourceFrame = coverSource,
                    headline = script.youtube_title.ifBlank { cleanTopic },
                    outputFile = coverFile,
                    isShorts = isShorts
                )
            }

            sceneBitmaps.forEach { (a, b) ->
                a.recycle()
                b?.recycle()
            }

            onProgress(100, "Video ready!")
            RenderResult(
                videoFile = outVideo,
                thumbnailFile = coverFile.takeIf { it.exists() },
                script = script
            )
        } catch (ce: CancellationException) {
            throw ce
        } finally {
            workDir.deleteRecursively()
        }
    }

    private suspend fun synthesizeAndTrimVoiceClips(
        slabs: List<VideoSlab>,
        activeVoice: String,
        voiceTone: VoiceTone,
        workDir: File
    ): List<ShortArray> = coroutineScope {
        val ttsSemaphore = Semaphore(3)
        slabs.mapIndexed { idx, slab ->
            async(Dispatchers.IO) {
                coroutineContext.ensureActive()
                ttsSemaphore.withPermit {
                    val wordCount = slab.voiceover_text.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.size
                    var bestPcm = ShortArray(0)
                    for (attempt in 0..2) {
                        coroutineContext.ensureActive()
                        val clip = runCatching {
                            edgeTts.generateDynamicVoiceClipWithMeta(
                                text = slab.voiceover_text,
                                voiceName = activeVoice,
                                emotion = slab.voice_emotion,
                                voiceTone = voiceTone
                            )
                        }.getOrNull()
                        if (clip != null && clip.audioBytes.isNotEmpty()) {
                            val rawMp3 = File(workDir, "voice_${idx}_$attempt.mp3")
                            FileOutputStream(rawMp3).use { it.write(clip.audioBytes) }
                            val decoded = decodeAudioToMono44100Pcm(rawMp3)
                            rawMp3.delete()
                            val trimmed = trimSilenceAndNormalize(decoded)
                            if (trimmed.size > bestPcm.size) {
                                bestPcm = trimmed
                            }
                            val durationSec = trimmed.size.toDouble() / BgmSynth.SAMPLE_RATE
                            if (trimmed.isNotEmpty() && (wordCount <= 3 || durationSec >= 0.8)) {
                                return@withPermit trimmed
                            }
                        }
                        if (attempt < 2) {
                            delay(350L * (attempt + 1))
                        }
                    }
                    if (bestPcm.isEmpty()) {
                        error("Voice generation returned empty audio for scene ${idx + 1}.")
                    }
                    bestPcm
                }
            }
        }.awaitAll()
    }

    private fun sanitizePromptText(raw: String): String {
        return raw
            .replace(Regex("[^\\x20-\\x7E]"), " ")
            .replace(
                Regex("\\b(comment box|subscribe button|subscribe|social media|website|ui overlay|user interface|title card|movie poster|poster[- ]?like\\s*still|poster|text overlay|stat badge|youtube shorts?|video_clip|meme_clip|split[- ]?layout|split[- ]?composition|split[- ]?screen|act as|collage|photo grid|grid of|panels|bold\\s+(?:retro\\s+)?lettering|lettering|typography)\\b", RegexOption.IGNORE_CASE),
                ""
            )
            .replace(
                Regex("\\b(graphic[- ]?style\\s*)?(glowing\\s*)?(hype\\s*)?(meter\\s*gauge|gauge\\s*meter|hype\\s*meter|speedometer|progress\\s*bar|meter|scorecard|scoreboard|rating\\s*chart|rating\\s*cards?|rating\\s*stars?|infographic|ui\\s*icons?|streaming\\s*icons?|icons?|play\\s*button)\\b", RegexOption.IGNORE_CASE),
                "cheering Bollywood cinema audience under warm golden theater lights"
            )
            .replace(Regex("\\b(?:a\\s+)?calendar(?:\\s+marked[^,.]*)?\\b", RegexOption.IGNORE_CASE), "grand red carpet movie theater entrance at night")
            .replace(Regex("\\b(?:showing|displaying|announcing|reading|with|marked)\\s+(?:the\\s+)?(?:release\\s+date[^,.]*|\\d+\\s*/\\s*\\d+|\\d+\\s*out\\s*of\\s*\\d+|(?:january|february|march|april|may|june|july|august|september|october|november|december)\\s+\\d{1,2}|bold\\s+(?:hindi|english)?\\s*text|hindi\\s*text|english\\s*text|text|numbers?)\\b", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\b(?:date\\s*highlighted|highlighted\\s*date|contract\\s+with\\s+bold\\s*text)\\b", RegexOption.IGNORE_CASE), "dramatic wedding paper envelope on wooden table")
            .replace(Regex("\\s{2,}"), " ")
            .trim(' ', ',', '.')
    }

    private suspend fun buildSceneVisualPair(
        slab: VideoSlab,
        index: Int,
        isShorts: Boolean,
        width: Int,
        height: Int,
        seed: Int,
        workDir: File,
        topicContext: String,
        visualStyleMode: VisualStyleMode,
        usedUrls: MutableSet<String>,
        usedHashes: MutableSet<String>
    ): Pair<Bitmap, Bitmap?> {
        val forcedStylized = visualStyleMode == VisualStyleMode.PIXAR_3D || visualStyleMode == VisualStyleMode.ANIME_3D
        val layout = slab.layout_mode.lowercase().trim()
        val isSplit = layout == "split"
        val panel1W = if (isSplit && height <= width) (width / 2) - 3 else width
        val panel1H = if (isSplit && height > width) (height / 2) - 3 else height
        val primary = fetchVisualBitmap(
            source = if (forcedStylized) "ai_generated" else slab.visual_source,
            query = if (forcedStylized) "" else slab.real_photo_query,
            prompt = slab.image_prompt,
            isShorts = if (isSplit) panel1H > panel1W else isShorts,
            width = panel1W,
            height = panel1H,
            seed = seed,
            tag = "s${index}_1",
            workDir = workDir,
            topicContext = topicContext,
            visualStyleMode = visualStyleMode,
            usedUrls = usedUrls,
            usedHashes = usedHashes
        )
        if (layout == "split" || layout == "flip") {
            val panel2W = if (isSplit && height <= width) width - ((width / 2) + 3) else width
            val panel2H = if (isSplit && height > width) height - ((height / 2) + 3) else height
            val secondary = fetchVisualBitmap(
                source = if (forcedStylized) "ai_generated" else slab.visual_source_2.ifBlank { "ai_generated" },
                query = if (forcedStylized) "" else slab.real_photo_query_2,
                prompt = slab.image_prompt_2.ifBlank { slab.image_prompt },
                isShorts = if (isSplit) panel2H > panel2W else isShorts,
                width = panel2W,
                height = panel2H,
                seed = seed + 17,
                tag = "s${index}_2",
                workDir = workDir,
                topicContext = topicContext,
                visualStyleMode = visualStyleMode,
                usedUrls = usedUrls,
                usedHashes = usedHashes
            )
            return if (layout == "split") {
                val merged = ImageComposer.composeSplitBitmap(primary, secondary, width, height)
                primary.recycle()
                secondary.recycle()
                merged to null
            } else {
                primary to secondary
            }
        }
        return primary to null
    }

    private fun sha256Hex(bytes: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
        return digest.joinToString("") { "%02x".format(it) }
    }

    private suspend fun fetchVisualBitmap(
        source: String,
        query: String,
        prompt: String,
        isShorts: Boolean,
        width: Int,
        height: Int,
        seed: Int,
        tag: String,
        workDir: File,
        topicContext: String,
        visualStyleMode: VisualStyleMode,
        usedUrls: MutableSet<String>,
        usedHashes: MutableSet<String>
    ): Bitmap {
        val normSource = source.lowercase().trim()
        val forcedStylized = visualStyleMode == VisualStyleMode.PIXAR_3D || visualStyleMode == VisualStyleMode.ANIME_3D
        val preferAi = forcedStylized || repository.isNonCelebrityOrRecipeTopic(query.ifBlank { prompt }, topicContext)

        if (!preferAi && (normSource == "video_clip" || normSource == "meme_clip")) {
            val clipFile = File(workDir, "$tag.mp4")
            val gotClip = query.isNotBlank() && repository.downloadInternetVideoClip(
                query = query,
                isMeme = normSource == "meme_clip",
                usedUrls = usedUrls,
                destinationFile = clipFile
            )
            if (gotClip) {
                val frame = extractFrameFromVideo(clipFile)
                clipFile.delete()
                if (frame != null && !ImageComposer.isMostlyBlackOrCorrupt(frame)) {
                    val studio = ImageComposer.composeStudioBitmapFromRealPhoto(context, frame, width, height)
                    frame.recycle()
                    return studio
                }
                frame?.recycle()
            }
        }

        if (!preferAi && (normSource == "real_photo" || normSource == "video_clip" || normSource == "meme_clip")) {
            val imgFile = File(workDir, "${tag}_photo.jpg")
            val gotReal = query.isNotBlank() && repository.downloadRealPhoto(
                query = query,
                usedUrls = usedUrls,
                destinationFile = imgFile,
                preferPortrait = isShorts,
                topicContext = topicContext,
                usedHashes = usedHashes
            )
            if (gotReal) {
                val raw = BitmapFactory.decodeFile(imgFile.absolutePath)
                imgFile.delete()
                if (raw != null && !ImageComposer.isMostlyBlackOrCorrupt(raw)) {
                    val studio = ImageComposer.composeStudioBitmapFromRealPhoto(context, raw, width, height)
                    raw.recycle()
                    return studio
                }
                raw?.recycle()
            }
        }

        // Fresh AI image generation (primary for non-celebrity/recipe/abstract, or fallback when real photo fails/duplicates)
        val cleanPrompt = sanitizePromptText(prompt).ifBlank { "dramatic 35mm live action cinema scene with moody warm lighting" }
        val promptLower = cleanPrompt.lowercase()
        val is3dStyle = visualStyleMode == VisualStyleMode.PIXAR_3D ||
            listOf("3d", "pixar", "disney", "cgi").any { it in promptLower }
        val isAnimeStyle = !is3dStyle && (visualStyleMode == VisualStyleMode.ANIME_3D ||
            listOf("anime", "cel-shaded", "ghibli").any { it in promptLower })
        val prefixedPrimary = when {
            visualStyleMode == VisualStyleMode.PIXAR_3D && !listOf("3d", "pixar", "disney", "cgi").any { it in promptLower } ->
                "3D Pixar Disney CGI animated scene, $cleanPrompt"
            visualStyleMode == VisualStyleMode.ANIME_3D && !listOf("anime", "cel-shaded", "ghibli").any { it in promptLower } ->
                "Cinematic anime animation film frame, $cleanPrompt"
            else -> cleanPrompt
        }
        val retryTail = when {
            is3dStyle -> "3D Pixar Disney animated CGI scene, vibrant volumetric lighting, rich detail"
            isAnimeStyle -> "Cinematic anime film frame, dramatic lighting, sharp detail"
            else -> "candid studio photograph, rich warm lighting, sharp focus"
        }

        for (attempt in 0..1) {
            val effectiveSeed = if (attempt == 0) seed else seed + 101
            val effectivePrompt = if (attempt == 0) {
                prefixedPrimary
            } else {
                "${prefixedPrimary.trim().take(180)}, $retryTail"
            }
            val aiResult = runCatching {
                repository.generateImageForSlabWithMeta(effectivePrompt, isShorts, effectiveSeed)
            }.getOrNull() ?: continue
            val hash = sha256Hex(aiResult.bytes)
            if (!usedHashes.add(hash)) continue
            val raw = BitmapFactory.decodeByteArray(aiResult.bytes, 0, aiResult.bytes.size)
            if (raw != null && !ImageComposer.isMostlyBlackOrCorrupt(raw)) {
                val prepared = if (aiResult.fromPollinations) {
                    val trimmed = ImageComposer.trimBottomRatio(raw, 0.92f)
                    raw.recycle()
                    trimmed
                } else {
                    raw
                }
                val cropped = ImageComposer.centerCropBitmap(prepared, width, height, biasTop = true)
                prepared.recycle()
                return cropped
            }
            raw?.recycle()
        }

        val fallbackQuery = query.ifBlank { prompt }
        val stockFile = File(workDir, "${tag}_stock.jpg")
        if (fallbackQuery.isNotBlank() && repository.downloadStockPhotoFallback(
                query = fallbackQuery,
                usedUrls = usedUrls,
                destinationFile = stockFile,
                preferPortrait = isShorts,
                topicContext = topicContext,
                usedHashes = usedHashes
            )
        ) {
            val raw = BitmapFactory.decodeFile(stockFile.absolutePath)
            stockFile.delete()
            if (raw != null && !ImageComposer.isMostlyBlackOrCorrupt(raw)) {
                val studio = ImageComposer.composeStudioBitmapFromRealPhoto(context, raw, width, height)
                raw.recycle()
                return studio
            }
            raw?.recycle()
        }

        return ImageComposer.createFallbackCinemaBitmap(width, height, seed)
    }

    private fun extractFrameFromVideo(videoFile: File): Bitmap? {
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(videoFile.absolutePath)
            retriever.getFrameAtTime(500_000L, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                ?: retriever.frameAtTime
        } catch (_: Throwable) {
            null
        } finally {
            runCatching { retriever.release() }
        }
    }

    private fun decodeAudioToMono44100Pcm(file: File): ShortArray {
        val extractor = MediaExtractor()
        extractor.setDataSource(file.absolutePath)
        var trackIndex = -1
        var format: MediaFormat? = null
        for (i in 0 until extractor.trackCount) {
            val f = extractor.getTrackFormat(i)
            val mime = f.getString(MediaFormat.KEY_MIME).orEmpty()
            if (mime.startsWith("audio/")) {
                trackIndex = i
                format = f
                break
            }
        }
        if (trackIndex < 0 || format == null) {
            extractor.release()
            return ShortArray(0)
        }
        extractor.selectTrack(trackIndex)
        val mime = format.getString(MediaFormat.KEY_MIME).orEmpty()
        val srcSampleRate = if (format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) format.getInteger(MediaFormat.KEY_SAMPLE_RATE) else 24000
        val srcChannels = if (format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) format.getInteger(MediaFormat.KEY_CHANNEL_COUNT) else 1

        val codec = MediaCodec.createDecoderByType(mime)
        codec.configure(format, null, null, 0)
        codec.start()

        val pcmBytes = ByteArrayOutputStream()
        val info = MediaCodec.BufferInfo()
        var inputDone = false
        var outputDone = false

        try {
            while (!outputDone) {
                if (!inputDone) {
                    val inIdx = codec.dequeueInputBuffer(10_000)
                    if (inIdx >= 0) {
                        val buf = codec.getInputBuffer(inIdx)!!
                        val sampleSize = extractor.readSampleData(buf, 0)
                        if (sampleSize < 0) {
                            codec.queueInputBuffer(inIdx, 0, 0, 0L, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            codec.queueInputBuffer(inIdx, 0, sampleSize, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }
                val outIdx = codec.dequeueOutputBuffer(info, 10_000)
                if (outIdx >= 0) {
                    val outBuf = codec.getOutputBuffer(outIdx)
                    if (outBuf != null && info.size > 0) {
                        outBuf.position(info.offset)
                        outBuf.limit(info.offset + info.size)
                        val chunk = ByteArray(info.size)
                        outBuf.get(chunk)
                        pcmBytes.write(chunk)
                    }
                    codec.releaseOutputBuffer(outIdx, false)
                    if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                        outputDone = true
                    }
                }
            }
        } finally {
            runCatching { codec.stop() }
            runCatching { codec.release() }
            runCatching { extractor.release() }
        }

        val rawBytes = pcmBytes.toByteArray()
        val totalShorts = rawBytes.size / 2
        val bb = ByteBuffer.wrap(rawBytes).order(ByteOrder.LITTLE_ENDIAN)
        val monoCount = totalShorts / max(1, srcChannels)
        val monoSrc = ShortArray(monoCount)
        for (i in 0 until monoCount) {
            var sum = 0
            for (ch in 0 until srcChannels) {
                sum += bb.short.toInt()
            }
            monoSrc[i] = (sum / max(1, srcChannels)).toShort()
        }

        return resampleTo44100(monoSrc, srcSampleRate)
    }

    private fun resampleTo44100(src: ShortArray, srcRate: Int): ShortArray {
        if (src.isEmpty() || srcRate == BgmSynth.SAMPLE_RATE) return src
        val ratio = srcRate.toDouble() / BgmSynth.SAMPLE_RATE.toDouble()
        val targetCount = max(1, (src.size / ratio).roundToInt())
        val out = ShortArray(targetCount)
        for (i in 0 until targetCount) {
            val pos = i * ratio
            val idx0 = pos.toInt().coerceIn(0, src.size - 1)
            val idx1 = min(src.size - 1, idx0 + 1)
            val frac = pos - idx0
            val s = src[idx0] * (1.0 - frac) + src[idx1] * frac
            out[i] = s.roundToInt().coerceIn(-32768, 32767).toShort()
        }
        return out
    }

    private fun trimSilenceAndNormalize(pcm: ShortArray): ShortArray {
        if (pcm.isEmpty()) return pcm
        val threshold = 200
        var start = 0
        while (start < pcm.size && abs(pcm[start].toInt()) < threshold) start++
        var end = pcm.size - 1
        while (end > start && abs(pcm[end].toInt()) < threshold) end--

        val minLeadPadSamples = (0.15 * BgmSynth.SAMPLE_RATE).roundToInt() // 150ms leading pad
        val minTailPadSamples = (0.16 * BgmSynth.SAMPLE_RATE).roundToInt() // 160ms trailing pad
        val existingLeadPad = min(start, minLeadPadSamples)
        val extraPreZeros = (minLeadPadSamples - existingLeadPad).coerceAtLeast(0)
        val safeStart = max(0, start - existingLeadPad)

        val availTail = max(0, (pcm.size - 1) - end)
        val existingTailPad = min(availTail, minTailPadSamples)
        val extraPostZeros = (minTailPadSamples - existingTailPad).coerceAtLeast(0)
        val safeEnd = min(pcm.size - 1, end + existingTailPad)

        val coreLen = if (safeEnd >= safeStart) safeEnd - safeStart + 1 else pcm.size
        val trimmed = ShortArray(extraPreZeros + coreLen + extraPostZeros)
        if (safeEnd >= safeStart) {
            pcm.copyInto(trimmed, extraPreZeros, safeStart, safeEnd + 1)
        } else {
            pcm.copyInto(trimmed, extraPreZeros, 0, pcm.size)
        }

        var peak = 1
        for (s in trimmed) peak = max(peak, abs(s.toInt()))
        val targetPeak = 24500f
        val gain = (targetPeak / peak).coerceIn(0.6f, 3.0f)
        return ShortArray(trimmed.size) { i ->
            (trimmed[i] * gain).roundToInt().coerceIn(-32768, 32767).toShort()
        }
    }

    private suspend fun encodeMp4(
        outVideo: File,
        width: Int,
        height: Int,
        isShorts: Boolean,
        slabs: List<VideoSlab>,
        sceneVisuals: List<Pair<Bitmap, Bitmap?>>,
        sceneFrameCounts: IntArray,
        mixedPcm: ShortArray,
        onProgress: (Int) -> Unit
    ) {
        val muxer = MediaMuxer(outVideo.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)

        val videoFormat = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, if (isShorts) 3_500_000 else 4_500_000)
            setInteger(MediaFormat.KEY_FRAME_RATE, FPS)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
        }
        val videoEncoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        videoEncoder.configure(videoFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        val inputSurface = videoEncoder.createInputSurface()
        videoEncoder.start()

        val audioFormat = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, BgmSynth.SAMPLE_RATE, 1).apply {
            setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
            setInteger(MediaFormat.KEY_BIT_RATE, 192_000)
            setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16384)
        }
        val audioEncoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
        audioEncoder.configure(audioFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        audioEncoder.start()

        var videoTrackIdx = -1
        var audioTrackIdx = -1
        var muxerStarted = false

        fun tryStartMuxer() {
            if (!muxerStarted && videoTrackIdx >= 0 && audioTrackIdx >= 0) {
                muxer.start()
                muxerStarted = true
            }
        }

        val vInfo = MediaCodec.BufferInfo()
        val aInfo = MediaCodec.BufferInfo()

        fun drainVideo(eos: Boolean) {
            if (eos) videoEncoder.signalEndOfInputStream()
            while (true) {
                val outIdx = videoEncoder.dequeueOutputBuffer(vInfo, if (eos) 10_000 else 0)
                when {
                    outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        if (videoTrackIdx < 0) {
                            videoTrackIdx = muxer.addTrack(videoEncoder.outputFormat)
                            tryStartMuxer()
                        }
                    }
                    outIdx >= 0 -> {
                        val buf = videoEncoder.getOutputBuffer(outIdx)
                        if ((vInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0 && vInfo.size > 0 && muxerStarted) {
                            buf?.position(vInfo.offset)
                            buf?.limit(vInfo.offset + vInfo.size)
                            muxer.writeSampleData(videoTrackIdx, buf!!, vInfo)
                        }
                        videoEncoder.releaseOutputBuffer(outIdx, false)
                        if ((vInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) break
                    }
                    else -> if (!eos) break
                }
            }
        }

        val totalFrames = sceneFrameCounts.sum()
        var frameCounter = 0
        val matrix = Matrix()
        val drawPaint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
        val crossfadePaint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
        val crossfadeFrames = 6

        // Feed all video frames first while capturing format, then encode audio once muxer starts or simultaneously
        // Wait: MediaMuxer requires BOTH tracks added before muxer.start(), so we prime both encoders together!
        var audioSampleCursor = 0
        var audioInputDone = false
        var audioOutputDone = false

        fun stepAudioEncoder(flushAll: Boolean) {
            while (!audioOutputDone) {
                if (!audioInputDone) {
                    val inIdx = audioEncoder.dequeueInputBuffer(0)
                    if (inIdx >= 0) {
                        val buf = audioEncoder.getInputBuffer(inIdx)!!
                        buf.clear()
                        if (audioSampleCursor >= mixedPcm.size) {
                            audioEncoder.queueInputBuffer(inIdx, 0, 0, (audioSampleCursor * 1_000_000L) / BgmSynth.SAMPLE_RATE, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            audioInputDone = true
                        } else {
                            val maxSamples = buf.remaining() / 2
                            val count = min(maxSamples, mixedPcm.size - audioSampleCursor)
                            val ptsUs = (audioSampleCursor.toLong() * 1_000_000L) / BgmSynth.SAMPLE_RATE
                            for (k in 0 until count) {
                                val s = mixedPcm[audioSampleCursor + k].toInt()
                                buf.put((s and 0xFF).toByte())
                                buf.put(((s ushr 8) and 0xFF).toByte())
                            }
                            audioSampleCursor += count
                            audioEncoder.queueInputBuffer(inIdx, 0, count * 2, ptsUs, 0)
                        }
                    }
                }
                val outIdx = audioEncoder.dequeueOutputBuffer(aInfo, 0)
                when {
                    outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        if (audioTrackIdx < 0) {
                            audioTrackIdx = muxer.addTrack(audioEncoder.outputFormat)
                            tryStartMuxer()
                        }
                    }
                    outIdx >= 0 -> {
                        val buf = audioEncoder.getOutputBuffer(outIdx)
                        if ((aInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0 && aInfo.size > 0 && muxerStarted) {
                            buf?.position(aInfo.offset)
                            buf?.limit(aInfo.offset + aInfo.size)
                            muxer.writeSampleData(audioTrackIdx, buf!!, aInfo)
                        }
                        audioEncoder.releaseOutputBuffer(outIdx, false)
                        if ((aInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                            audioOutputDone = true
                        }
                    }
                    else -> if (!flushAll || audioInputDone && outIdx == MediaCodec.INFO_TRY_AGAIN_LATER) break
                }
                if (!flushAll) break
            }
        }

        // Prime audio format track
        for (i in 0 until 20) {
            if (audioTrackIdx >= 0) break
            stepAudioEncoder(false)
        }

        try {
            slabs.forEachIndexed { sIdx, slab ->
                val count = sceneFrameCounts[sIdx]
                val (bmpA, bmpB) = sceneVisuals[sIdx]
                val prevBmp = if (sIdx > 0) sceneVisuals[sIdx - 1].first else null
                val captionWords = slab.voiceover_text.split(Regex("\\s+")).filter { it.isNotEmpty() }
                val midWord = max(1, captionWords.size / 2)
                val part1Text = captionWords.take(midWord).joinToString(" ")
                val part2Text = captionWords.drop(midWord).joinToString(" ")
                val isLastScene = sIdx == slabs.lastIndex

                for (f in 0 until count) {
                    coroutineContext.ensureActive()
                    val tNorm = if (count > 1) f.toFloat() / (count - 1) else 0f
                    val isSecondShot = bmpB != null && f >= count / 2
                    val activeBmp = if (isSecondShot) bmpB!! else bmpA
                    val shotIndex = if (isSecondShot) sIdx + 3 else sIdx
                    val isHighEnergy = slab.voice_emotion.lowercase() in setOf("hook", "climax", "excited") ||
                        slab.sfx_cue.lowercase() in setOf("boom", "sword", "thunder")
                    val easeT = ((1.0 - kotlin.math.cos(tNorm * Math.PI)) * 0.5).toFloat()

                    val canvas: Canvas = inputSurface.lockCanvas(null)
                    try {
                        canvas.drawColor(Color.BLACK)
                        val zoom = when {
                            isHighEnergy && shotIndex % 2 == 0 -> 1.04f + 0.14f * easeT
                            shotIndex % 6 == 0 -> 1.02f + 0.12f * easeT
                            shotIndex % 6 == 1 -> 1.15f - 0.11f * easeT
                            else -> 1.09f + 0.03f * easeT
                        }
                        var panX = when (shotIndex % 6) {
                            2 -> (easeT - 0.5f) * width * 0.06f
                            3 -> (0.5f - easeT) * width * 0.06f
                            else -> 0f
                        }
                        var panY = when (shotIndex % 6) {
                            4 -> (0.5f - easeT) * height * 0.045f
                            5 -> (easeT - 0.5f) * height * 0.045f
                            else -> 0f
                        }
                        if (isHighEnergy) {
                            panX += (kotlin.math.sin(f * 0.42) * 3.5).toFloat()
                            panY += (kotlin.math.cos(f * 0.35) * 2.5).toFloat()
                        }
                        matrix.reset()
                        matrix.postScale(zoom, zoom, width * 0.5f, height * 0.5f)
                        matrix.postTranslate(panX, panY)
                        canvas.drawBitmap(activeBmp, matrix, drawPaint)

                        if (prevBmp != null && f < crossfadeFrames) {
                            val alpha = ((1f - (f.toFloat() / crossfadeFrames)) * 255f).roundToInt().coerceIn(0, 255)
                            crossfadePaint.alpha = alpha
                            canvas.drawBitmap(prevBmp, 0f, 0f, crossfadePaint)
                        }

                        ImageComposer.drawWatermarkOverlay(canvas, width, height, isShorts)
                        if (slab.stat_badge.isNotBlank()) {
                            ImageComposer.drawStatBadgeOverlay(canvas, slab.stat_badge, width, isShorts)
                        }
                        val activeCaption = if (part2Text.isNotEmpty() && f >= count / 2) part2Text else part1Text
                        ImageComposer.drawPopCaptionOverlay(canvas, activeCaption, width, height, isShorts)
                        if (isLastScene && f >= (count * 0.45f).roundToInt()) {
                            ImageComposer.drawSubscribeEndCard(canvas, width, height, isShorts)
                        }
                    } finally {
                        inputSurface.unlockCanvasAndPost(canvas)
                    }

                    frameCounter++
                    drainVideo(false)
                    stepAudioEncoder(false)
                    if (frameCounter % 12 == 0 && totalFrames > 0) {
                        onProgress((frameCounter * 100 / totalFrames).coerceIn(0, 99))
                    }
                }
            }

            drainVideo(true)
            while (!audioOutputDone) {
                stepAudioEncoder(true)
            }
        } finally {
            runCatching { videoEncoder.stop() }
            runCatching { videoEncoder.release() }
            runCatching { inputSurface.release() }
            runCatching { audioEncoder.stop() }
            runCatching { audioEncoder.release() }
            if (muxerStarted) runCatching { muxer.stop() }
            runCatching { muxer.release() }
        }
    }
}
