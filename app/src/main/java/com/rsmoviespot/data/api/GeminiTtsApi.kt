package com.rsmoviespot.data.api

import android.util.Base64
import com.rsmoviespot.BuildConfig
import com.rsmoviespot.domain.models.VideoLanguage
import com.rsmoviespot.domain.models.VideoSlab
import com.rsmoviespot.domain.models.VoiceGender
import com.rsmoviespot.domain.models.VoiceTone
import com.rsmoviespot.service.BgmSynth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Locale
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

data class WhisperWordSpan(
    val word: String,
    val start: Double,
    val end: Double
)

class GeminiTtsApi(
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(25, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(45, TimeUnit.SECONDS)
        .build()
) {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    companion object {
        private const val PRIMARY_MODEL = "gemini-3.8-flash-tts"
        private const val FALLBACK_MODEL = "gemini-3.8-flash-lite-tts"
        private const val SAMPLE_RATE = BgmSynth.SAMPLE_RATE
    }

    fun isAvailable(): Boolean = BuildConfig.GEMINI_API_KEY.trim().isNotEmpty()

    fun resolveGeminiVoiceName(gender: VoiceGender, voiceTone: VoiceTone): String {
        if (gender == VoiceGender.FEMALE) {
            return if (voiceTone == VoiceTone.ENERGETIC || voiceTone == VoiceTone.FUNNY) "Zephyr" else "Kore"
        }
        return when (voiceTone) {
            VoiceTone.SERIOUS -> "Charon"
            VoiceTone.ENERGETIC -> "Fenrir"
            VoiceTone.NATURAL, VoiceTone.FUNNY, VoiceTone.AUTO -> "Puck"
        }
    }

    private fun buildActingStyleInstruction(
        emotion: String,
        voiceTone: VoiceTone,
        sceneIndex: Int,
        totalScenes: Int,
        language: VideoLanguage
    ): String {
        val emo = emotion.lowercase(Locale.US).trim()
        val emotionDirective = when (emo) {
            "hook" -> "High-energy charismatic YouTube hook, curious and attention-grabbing opening, crisp emphasis, natural human pacing"
            "excited", "roast" -> "Lively expressive storytelling with playful energy, animated vocal smile, crisp comedic or punchy emphasis"
            "climax" -> "Dramatic cinematic climax peak, commanding conviction, weighty impact with rich vocal depth"
            "suspense" -> "Hushed tense mysterious tone, slightly slower deliberate pacing, building curiosity"
            "sad" -> "Soft heartfelt empathetic tone, gentle slower cadence, authentic emotional warmth"
            "question" -> "Curious conversational rising inflection, engaging directly with the listener"
            "warm" -> "Warm friendly approachable creator voice, relaxed conversational rhythm, genuine warmth"
            else -> "Natural conversational creator voice, effortless human cadence with gentle micro-pauses"
        }
        val toneDirective = when (voiceTone) {
            VoiceTone.FUNNY -> "witty playful timing"
            VoiceTone.SERIOUS -> "grounded intense gravitas"
            VoiceTone.ENERGETIC -> "fast upbeat momentum"
            VoiceTone.NATURAL -> "intimate podcast studio mic feel"
            VoiceTone.AUTO -> "expressive human storytelling"
        }
        val positionHint = when (sceneIndex) {
            0 -> "opening hook line"
            totalScenes - 1 -> "satisfying closing line"
            else -> "seamless mid-story beat"
        }
        val langHint = when (language) {
            VideoLanguage.ENGLISH_US -> "clear natural American English"
            VideoLanguage.ENGLISH_IN -> "natural warm Indian English"
            else -> "natural authentic Indian conversational pronunciation across Hindi, Hinglish, and English words"
        }
        return "$emotionDirective; $toneDirective; $positionHint; $langHint"
    }

    private fun cleanSpokenLine(raw: String): String =
        raw.replace("**", "")
            .replace("__", "")
            .replace("`", "")
            .replace(Regex("\\s+"), " ")
            .trim()

    suspend fun synthesizeOneTicketSceneClips(
        slabs: List<VideoSlab>,
        voiceGender: VoiceGender,
        voiceTone: VoiceTone,
        language: VideoLanguage
    ): List<ShortArray>? = withContext(Dispatchers.IO) {
        val apiKey = BuildConfig.GEMINI_API_KEY.trim()
        if (apiKey.isEmpty() || slabs.isEmpty()) return@withContext null

        val wavBytes = requestOneTicketGeminiWav(apiKey, slabs, voiceGender, voiceTone, language)
            ?: return@withContext null

        val rawPcm = decodeUnaryWavTo44100MonoPcm(wavBytes)
        if (rawPcm.size < SAMPLE_RATE / 2) return@withContext null

        val normalizedPcm = trimOuterSilenceAndNormalize(rawPcm)
        val whisperWords = transcribeWavWithGroqWhisper(wavBytes)
        val boundaries = computeAlignedSceneBoundariesSeconds(slabs, normalizedPcm, whisperWords)

        val fadeSamples = (0.005 * SAMPLE_RATE).roundToInt()
        val tailPadSamples = (0.08 * SAMPLE_RATE).roundToInt()

        slabs.indices.map { i ->
            val startSample = (boundaries[i] * SAMPLE_RATE).roundToInt().coerceIn(0, max(0, normalizedPcm.size - 1))
            val endSample = (boundaries[i + 1] * SAMPLE_RATE).roundToInt()
                .coerceIn(min(normalizedPcm.size, startSample + (0.35 * SAMPLE_RATE).roundToInt()), normalizedPcm.size)
            val sliceLen = max(1, endSample - startSample)
            val out = ShortArray(sliceLen + tailPadSamples)
            for (k in 0 until sliceLen) {
                var s = normalizedPcm[startSample + k].toDouble()
                if (i > 0 && k < fadeSamples) {
                    s *= k.toDouble() / fadeSamples
                }
                if (i < slabs.lastIndex && k >= sliceLen - fadeSamples) {
                    s *= max(0, sliceLen - k).toDouble() / fadeSamples
                }
                out[k] = s.roundToInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
            }
            out
        }
    }

    private fun requestOneTicketGeminiWav(
        apiKey: String,
        slabs: List<VideoSlab>,
        voiceGender: VoiceGender,
        voiceTone: VoiceTone,
        language: VideoLanguage
    ): ByteArray? {
        val voiceName = resolveGeminiVoiceName(voiceGender, voiceTone)
        val partsWithMetadata = buildJsonArray {
            slabs.forEachIndexed { idx, slab ->
                val text = cleanSpokenLine(slab.voiceover_text).ifBlank { "." }
                val style = buildActingStyleInstruction(
                    slab.voice_emotion,
                    voiceTone,
                    idx,
                    slabs.size,
                    language
                )
                add(buildJsonObject {
                    put("text", text)
                    put("speechMetadata", buildJsonObject {
                        put("style", style)
                    })
                })
            }
        }
        val combinedText = slabs.map { cleanSpokenLine(it.voiceover_text) }
            .filter { it.isNotEmpty() }
            .joinToString("\n")
        val partsTextOnly = buildJsonArray {
            add(buildJsonObject { put("text", combinedText) })
        }

        data class TtsAttempt(
            val model: String,
            val parts: kotlinx.serialization.json.JsonArray,
            val useSpeechConfig: Boolean
        )

        val attempts = listOf(
            TtsAttempt(PRIMARY_MODEL, partsWithMetadata, true),
            TtsAttempt(FALLBACK_MODEL, partsWithMetadata, true),
            TtsAttempt("gemini-2.5-flash-preview-tts", partsTextOnly, true),
            TtsAttempt(PRIMARY_MODEL, partsTextOnly, true),
            TtsAttempt(FALLBACK_MODEL, partsTextOnly, false)
        )

        for (attempt in attempts) {
            val payload = buildJsonObject {
                put("contents", buildJsonArray {
                    add(buildJsonObject {
                        put("role", "user")
                        put("parts", attempt.parts)
                    })
                })
                put("generationConfig", buildJsonObject {
                    put("responseModalities", buildJsonArray {
                        add(kotlinx.serialization.json.JsonPrimitive("AUDIO"))
                    })
                    if (attempt.useSpeechConfig) {
                        put("speechConfig", buildJsonObject {
                            put("voiceConfig", buildJsonObject {
                                put("prebuiltVoiceConfig", buildJsonObject {
                                    put("voiceName", voiceName)
                                })
                            })
                        })
                    }
                })
            }.toString()

            val url = "https://generativelanguage.googleapis.com/v1beta/models/${attempt.model}:generateContent?key=$apiKey"
            val req = Request.Builder()
                .url(url)
                .header("Content-Type", "application/json")
                .header("User-Agent", "aistudio-build")
                .post(payload.toRequestBody("application/json".toMediaType()))
                .build()
            var fatalStop = false
            val result = runCatching {
                client.newCall(req).execute().use { res ->
                    if (res.code == 429 || res.code == 401 || res.code == 403) {
                        fatalStop = true
                        return@use null
                    }
                    if (!res.isSuccessful) return@use null
                    val bodyStr = res.body?.string().orEmpty()
                    val root = json.parseToJsonElement(bodyStr).jsonObject
                    val parts = root["candidates"]?.jsonArray?.firstOrNull()?.jsonObject
                        ?.get("content")?.jsonObject?.get("parts")?.jsonArray
                    val b64 = parts?.firstNotNullOfOrNull { el ->
                        el.jsonObject["inlineData"]?.jsonObject?.get("data")?.jsonPrimitive?.contentOrNull
                    }
                    b64?.let { Base64.decode(it, Base64.DEFAULT) }?.takeIf { it.size > 1024 }
                }
            }.getOrNull()
            if (result != null) return result
            if (fatalStop) return null
        }
        return null
    }

    private fun decodeUnaryWavTo44100MonoPcm(wavBytes: ByteArray): ShortArray {
        if (wavBytes.size <= 44) return ShortArray(0)
        val bb = ByteBuffer.wrap(wavBytes).order(ByteOrder.LITTLE_ENDIAN)
        var srcSampleRate = 24000
        var srcChannels = 1
        var bitsPerSample = 16
        var dataStart = 44
        var dataSize = wavBytes.size - 44

        var offset = 12
        while (offset + 8 <= wavBytes.size) {
            val id = String(wavBytes, offset, 4, Charsets.US_ASCII)
            val chunkSize = bb.getInt(offset + 4)
            if (id == "fmt " && offset + 24 <= wavBytes.size) {
                srcChannels = max(1, bb.getShort(offset + 10).toInt())
                srcSampleRate = max(8000, bb.getInt(offset + 12))
                bitsPerSample = max(8, bb.getShort(offset + 22).toInt())
            } else if (id == "data") {
                dataStart = offset + 8
                dataSize = chunkSize.coerceIn(0, wavBytes.size - dataStart)
                break
            }
            if (chunkSize < 0) break
            offset += 8 + chunkSize + (chunkSize and 1)
        }

        if (bitsPerSample != 16 || dataSize < 2) return ShortArray(0)
        val frameSize = 2 * srcChannels
        val frameCount = dataSize / frameSize
        if (frameCount <= 0) return ShortArray(0)

        val monoSrc = ShortArray(frameCount)
        for (i in 0 until frameCount) {
            var sum = 0
            for (c in 0 until srcChannels) {
                sum += bb.getShort(dataStart + i * frameSize + c * 2).toInt()
            }
            monoSrc[i] = (sum / srcChannels).toShort()
        }

        if (srcSampleRate == SAMPLE_RATE) return monoSrc

        val outCount = ((frameCount.toLong() * SAMPLE_RATE) / srcSampleRate).toInt().coerceAtLeast(1)
        val out = ShortArray(outCount)
        val ratio = srcSampleRate.toDouble() / SAMPLE_RATE
        for (i in 0 until outCount) {
            val pos = i * ratio
            val idx0 = pos.toInt().coerceIn(0, frameCount - 1)
            val idx1 = min(frameCount - 1, idx0 + 1)
            val frac = pos - idx0
            val sample = monoSrc[idx0] * (1.0 - frac) + monoSrc[idx1] * frac
            out[i] = sample.roundToInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
        }
        return out
    }

    private fun trimOuterSilenceAndNormalize(pcm: ShortArray): ShortArray {
        if (pcm.isEmpty()) return pcm
        val threshold = 420
        var start = 0
        while (start < pcm.size && abs(pcm[start].toInt()) < threshold) start++
        var end = pcm.size - 1
        while (end > start && abs(pcm[end].toInt()) < threshold) end--
        if (end <= start) return pcm

        val leadPad = (0.12 * SAMPLE_RATE).roundToInt()
        val tailPad = (0.14 * SAMPLE_RATE).roundToInt()
        val trimLen = end - start + 1
        val out = ShortArray(leadPad + trimLen + tailPad)

        var maxPeak = 1
        for (i in start..end) {
            val a = abs(pcm[i].toInt())
            if (a > maxPeak) maxPeak = a
        }
        val gain = min(3.2, 26000.0 / maxPeak)
        for (i in 0 until trimLen) {
            out[leadPad + i] = (pcm[start + i] * gain).roundToInt()
                .coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
        }
        return out
    }

    private fun transcribeWavWithGroqWhisper(wavBytes: ByteArray): List<WhisperWordSpan> {
        val groqKey = BuildConfig.GROQ_API_KEY.trim()
        if (groqKey.isEmpty()) return emptyList()
        return runCatching {
            val body = MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart("file", "voice.wav", wavBytes.toRequestBody("audio/wav".toMediaType()))
                .addFormDataPart("model", "whisper-large-v3")
                .addFormDataPart("response_format", "verbose_json")
                .addFormDataPart("timestamp_granularities[]", "word")
                .build()
            val req = Request.Builder()
                .url("https://api.groq.com/openai/v1/audio/transcriptions")
                .header("Authorization", "Bearer $groqKey")
                .post(body)
                .build()
            client.newCall(req).execute().use { res ->
                if (!res.isSuccessful) return@use emptyList()
                val raw = res.body?.string().orEmpty()
                val arr = json.parseToJsonElement(raw).jsonObject["words"]?.jsonArray ?: return@use emptyList()
                arr.mapNotNull { el ->
                    val obj = el.jsonObject
                    val word = obj["word"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                    val s = obj["start"]?.jsonPrimitive?.doubleOrNull
                    val e = obj["end"]?.jsonPrimitive?.doubleOrNull
                    if (word.isNotEmpty() && s != null && e != null) WhisperWordSpan(word, s, e) else null
                }
            }
        }.getOrDefault(emptyList())
    }

    private fun normalizeToken(token: String): String =
        token.lowercase(Locale.US).replace(Regex("[^\\p{L}\\p{N}]+"), "").trim()

    private fun tokensRoughlyMatch(a: String, b: String): Boolean {
        val na = normalizeToken(a)
        val nb = normalizeToken(b)
        if (na.isEmpty() || nb.isEmpty()) return false
        if (na == nb) return true
        return na.length >= 3 && nb.length >= 3 && (na.contains(nb) || nb.contains(na))
    }

    private fun snapBoundaryToSilenceMidpoint(
        samples: ShortArray,
        targetSeconds: Double,
        minSeconds: Double,
        maxSeconds: Double,
        searchWindowSec: Double = 0.28
    ): Double {
        val totalSec = samples.size.toDouble() / SAMPLE_RATE
        val clampedMin = max(0.0, minSeconds)
        val clampedMax = min(totalSec, maxSeconds)
        if (clampedMax <= clampedMin) return clampedMin

        val winStart = max(clampedMin, targetSeconds - searchWindowSec)
        val winEnd = min(clampedMax, targetSeconds + searchWindowSec)
        val hopSamples = (0.01 * SAMPLE_RATE).roundToInt()
        val frameSamples = (0.02 * SAMPLE_RATE).roundToInt()

        val startIdx = max(0, (winStart * SAMPLE_RATE).toInt())
        val endIdx = min(samples.size - frameSamples, (winEnd * SAMPLE_RATE).toInt())
        if (endIdx <= startIdx) return targetSeconds.coerceIn(clampedMin, clampedMax)

        var bestIdx = (targetSeconds.coerceIn(clampedMin, clampedMax) * SAMPLE_RATE).roundToInt()
        var bestScore = Double.POSITIVE_INFINITY

        var i = startIdx
        while (i <= endIdx) {
            var sumSq = 0.0
            for (k in 0 until frameSamples) {
                val v = samples[i + k] / 32768.0
                sumSq += v * v
            }
            val rms = sqrt(sumSq / frameSamples)
            val tSec = (i + frameSamples * 0.5) / SAMPLE_RATE
            val score = rms + abs(tSec - targetSeconds) * 0.035
            if (score < bestScore) {
                bestScore = score
                bestIdx = (i + frameSamples * 0.5).roundToInt()
            }
            i += hopSamples
        }
        return (bestIdx.toDouble() / SAMPLE_RATE).coerceIn(clampedMin, clampedMax)
    }

    private fun computeAlignedSceneBoundariesSeconds(
        slabs: List<VideoSlab>,
        samples: ShortArray,
        whisperWords: List<WhisperWordSpan>
    ): DoubleArray {
        val totalDur = samples.size.toDouble() / SAMPLE_RATE
        val n = slabs.size
        if (n <= 1) return doubleArrayOf(0.0, totalDur)

        val slabWordLists = slabs.map { cleanSpokenLine(it.voiceover_text).split(Regex("\\s+")).filter { w -> w.isNotEmpty() } }
        val charCounts = slabs.map { max(4, cleanSpokenLine(it.voiceover_text).replace(Regex("\\s+"), "").length) }
        val totalChars = max(1, charCounts.sum())

        val cumTargets = DoubleArray(n + 1)
        var runningChars = 0
        for (i in 0 until n) {
            runningChars += charCounts[i]
            cumTargets[i + 1] = (runningChars.toDouble() / totalChars) * totalDur
        }
        cumTargets[n] = totalDur

        val boundaries = mutableListOf(0.0)
        val minSceneDur = 0.55

        if (whisperWords.size >= n) {
            val totalWords = max(1, slabWordLists.sumOf { it.size })
            val scale = whisperWords.size.toDouble() / totalWords
            var wordCursor = 0
            var cumWords = 0

            for (i in 0 until n - 1) {
                val curWords = slabWordLists[i]
                val nextWords = slabWordLists[i + 1]
                cumWords += curWords.size

                val expectedIdx = (cumWords * scale).roundToInt()
                    .coerceIn(wordCursor + 1, whisperWords.size - (n - 1 - i))
                val radius = max(3, (curWords.size * 0.45).roundToInt())
                val lo = max(wordCursor + 1, expectedIdx - radius)
                val hi = min(whisperWords.size - (n - 1 - i), expectedIdx + radius)

                val lastTok = curWords.lastOrNull().orEmpty()
                val nextTok = nextWords.firstOrNull().orEmpty()

                var bestIdx = expectedIdx
                var bestScore = Double.NEGATIVE_INFINITY
                for (k in lo..hi) {
                    val prevW = whisperWords[k - 1]
                    val nextW = whisperWords[k]
                    val gap = max(0.0, nextW.start - prevW.end)
                    val gapScore = min(0.45, gap) * 6.0
                    val endHit = if (tokensRoughlyMatch(prevW.word, lastTok)) 1.8 else 0.0
                    val startHit = if (tokensRoughlyMatch(nextW.word, nextTok)) 1.8 else 0.0
                    val distPen = abs(k - expectedIdx) * 0.25
                    val score = gapScore + endHit + startHit - distPen
                    if (score > bestScore) {
                        bestScore = score
                        bestIdx = k
                    }
                }

                val rawMid = (whisperWords[bestIdx - 1].end + whisperWords[bestIdx].start) * 0.5
                val prevBound = boundaries.last()
                val maxAllowed = max(prevBound + minSceneDur, totalDur - (n - 1 - i) * minSceneDur)
                boundaries.add(snapBoundaryToSilenceMidpoint(samples, rawMid, prevBound + minSceneDur, maxAllowed, 0.28))
                wordCursor = bestIdx
            }
            boundaries.add(totalDur)
            return boundaries.toDoubleArray()
        }

        for (i in 0 until n - 1) {
            val prevBound = boundaries.last()
            val maxAllowed = max(prevBound + minSceneDur, totalDur - (n - 1 - i) * minSceneDur)
            val searchWin = max(0.4, (totalDur / n) * 0.45)
            boundaries.add(snapBoundaryToSilenceMidpoint(samples, cumTargets[i + 1], prevBound + minSceneDur, maxAllowed, searchWin))
        }
        boundaries.add(totalDur)
        return boundaries.toDoubleArray()
    }
}
