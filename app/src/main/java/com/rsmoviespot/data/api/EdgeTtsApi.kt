package com.rsmoviespot.data.api

import com.rsmoviespot.domain.models.VoiceTone
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

data class EdgeTtsClipResult(
    val audioBytes: ByteArray,
    val usedFallback: Boolean
)

class EdgeTtsApi(
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .build()
) {
    private val permit = Semaphore(2)
    private val consecutiveEdgeFailures = AtomicInteger(0)
    private val edgeDisabledUntilMs = AtomicLong(0L)
    private val clockSkewSeconds = AtomicLong(0L)

    companion object {
        private const val DEFAULT_VOICE_RATE = "+24%"
        private const val DEFAULT_VOICE_PITCH = "+1Hz"
        private const val EDGE_TTS_TIMEOUT_MS = 15_000L
        private const val EDGE_COOLDOWN_MS = 60_000L
        private const val MAX_CHUNK_LENGTH = 160
        private const val MAX_ATTEMPTS = 3

        private const val EDGE_PRIMARY_WS_URL =
            "https://api.msedgeservices.com/tts/cognitiveservices/websocket/v1"
        private const val EDGE_LEGACY_WS_URL =
            "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1"

        private const val TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"
        private const val SEC_MS_GEC_VERSION = "1-143.0.3650.75"
        private const val EDGE_ORIGIN = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold"
        private const val EDGE_USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0"
    }

    fun sanitizeTtsText(rawText: String): String {
        return rawText
            .replace("**", "")
            .replace("__", "")
            .replace("`", "")
            .replace(Regex("\\s+"), " ")
            .trim()
    }

    fun resolveProsody(emotion: String, voiceTone: VoiceTone): Pair<String, String> {
        val emo = emotion.lowercase().trim()
        return when (voiceTone) {
            VoiceTone.NATURAL -> when (emo) {
                "hook" -> "+24%" to "+2Hz"
                "excited" -> "+26%" to "+3Hz"
                "climax" -> "+25%" to "+1Hz"
                "suspense" -> "+12%" to "-5Hz"
                "sad" -> "+8%" to "-6Hz"
                "roast" -> "+23%" to "+2Hz"
                "question" -> "+18%" to "+3Hz"
                "warm" -> "+14%" to "-1Hz"
                else -> "+20%" to "-1Hz"
            }
            VoiceTone.FUNNY -> when (emo) {
                "hook" -> "+28%" to "+4Hz"
                "excited" -> "+30%" to "+5Hz"
                "climax" -> "+29%" to "+4Hz"
                "suspense" -> "+15%" to "-3Hz"
                "sad" -> "+10%" to "-4Hz"
                "roast" -> "+27%" to "+4Hz"
                "question" -> "+22%" to "+5Hz"
                "warm" -> "+18%" to "+1Hz"
                else -> "+24%" to "+2Hz"
            }
            VoiceTone.SERIOUS -> when (emo) {
                "hook" -> "+18%" to "-3Hz"
                "excited" -> "+21%" to "-2Hz"
                "climax" -> "+22%" to "-4Hz"
                "suspense" -> "+10%" to "-8Hz"
                "sad" -> "+6%" to "-8Hz"
                "roast" -> "+18%" to "-3Hz"
                "question" -> "+14%" to "-1Hz"
                "warm" -> "+12%" to "-4Hz"
                else -> "+15%" to "-5Hz"
            }
            VoiceTone.ENERGETIC -> when (emo) {
                "hook" -> "+30%" to "+3Hz"
                "excited" -> "+32%" to "+4Hz"
                "climax" -> "+31%" to "+2Hz"
                "suspense" -> "+18%" to "-3Hz"
                "sad" -> "+12%" to "-4Hz"
                "roast" -> "+29%" to "+3Hz"
                "question" -> "+24%" to "+4Hz"
                "warm" -> "+20%" to "0Hz"
                else -> "+26%" to "+1Hz"
            }
            VoiceTone.AUTO -> when (emo) {
                "hook" -> "+24%" to "+2Hz"
                "excited" -> "+27%" to "+4Hz"
                "climax" -> "+26%" to "+1Hz"
                "suspense" -> "+12%" to "-6Hz"
                "sad" -> "+8%" to "-7Hz"
                "roast" -> "+25%" to "+3Hz"
                "question" -> "+18%" to "+3Hz"
                "warm" -> "+14%" to "-2Hz"
                else -> "+20%" to "-2Hz"
            }
        }
    }

    suspend fun generateDynamicVoiceClipWithMeta(
        text: String,
        voiceName: String,
        emotion: String,
        voiceTone: VoiceTone = VoiceTone.AUTO
    ): EdgeTtsClipResult = withContext(Dispatchers.IO) {
        val cleanText = sanitizeTtsText(text)
        require(cleanText.isNotEmpty()) { "Voiceover text must not be blank." }

        val (rate, pitch) = resolveProsody(emotion, voiceTone)
        val safeRate = clampSafeRate(rate)
        val safePitch = sanitizeSafePitch(pitch)
        val targetVoice = resolveEdgeVoiceShortName(voiceName.ifBlank { "hi-IN-MadhurNeural" })

        if (System.currentTimeMillis() >= edgeDisabledUntilMs.get()) {
            val edgeBytes = try {
                permit.withPermit {
                    synthesizeViaDirectEdgeWebSocketWithRetry(cleanText, targetVoice, safeRate, safePitch)
                }
            } catch (_: Throwable) {
                null
            }

            if (edgeBytes != null && edgeBytes.isNotEmpty()) {
                consecutiveEdgeFailures.set(0)
                return@withContext EdgeTtsClipResult(edgeBytes, usedFallback = false)
            }

            if (consecutiveEdgeFailures.incrementAndGet() >= 4) {
                edgeDisabledUntilMs.set(System.currentTimeMillis() + EDGE_COOLDOWN_MS)
            }
        }

        val fallbackBytes = synthesizeWithGoogleFallback(cleanText, targetVoice)
        if (fallbackBytes.isEmpty()) {
            error("TTS produced empty audio output.")
        }
        EdgeTtsClipResult(fallbackBytes, usedFallback = true)
    }

    private suspend fun synthesizeViaDirectEdgeWebSocketWithRetry(
        text: String,
        voiceName: String,
        rate: String,
        pitch: String
    ): ByteArray {
        val endpoints = listOf(EDGE_PRIMARY_WS_URL, EDGE_LEGACY_WS_URL)
        var lastError: Throwable? = null
        for (endpoint in endpoints) {
            for (attempt in 0 until 2) {
                try {
                    return executeEdgeWebSocket(endpoint, text, voiceName, rate, pitch)
                } catch (err: Throwable) {
                    lastError = err
                    if (attempt == 0 && (err.message?.contains("403") == true)) {
                        syncClockSkewFromEndpoint(endpoint)
                    }
                }
            }
        }
        throw (lastError ?: IllegalStateException("Edge TTS WebSocket synthesis failed."))
    }

    private suspend fun executeEdgeWebSocket(
        baseHttpsUrl: String,
        text: String,
        voiceName: String,
        rate: String,
        pitch: String
    ): ByteArray {
        val connectionId = UUID.randomUUID().toString().replace("-", "")
        val requestId = UUID.randomUUID().toString().replace("-", "")
        val secMsGec = generateSecMsGec(clockSkewSeconds.get())

        val wsHttpsUrl = baseHttpsUrl.toHttpUrl().newBuilder()
            .addQueryParameter("TrustedClientToken", TRUSTED_CLIENT_TOKEN)
            .addQueryParameter("Sec-MS-GEC", secMsGec)
            .addQueryParameter("Sec-MS-GEC-Version", SEC_MS_GEC_VERSION)
            .addQueryParameter("ConnectionId", connectionId)
            .build()
        val wsUrl = wsHttpsUrl.toString().replaceFirst("https://", "wss://")

        val locale = voiceName.split("-").take(2).joinToString("-").ifBlank { "en-US" }
        val escapedText = escapeXml(text)
        val timestamp = edgeTimestamp()

        val speechConfigMsg =
            "X-Timestamp:$timestamp\r\n" +
                "Content-Type:application/json; charset=utf-8\r\n" +
                "Path:speech.config\r\n\r\n" +
                """{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}"""

        val ssmlBody =
            "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='$locale'>" +
                "<voice name='$voiceName'>" +
                "<prosody pitch='$pitch' rate='$rate' volume='+0%'>$escapedText</prosody>" +
                "</voice></speak>"

        val ssmlMsg =
            "X-RequestId:$requestId\r\n" +
                "Content-Type:application/ssml+xml\r\n" +
                "X-Timestamp:$timestamp\r\n" +
                "Path:ssml\r\n\r\n$ssmlBody"

        val deferred = CompletableDeferred<ByteArray>()
        val audioOut = ByteArrayOutputStream()
        val settled = AtomicBoolean(false)

        val req = Request.Builder()
            .url(wsUrl)
            .header("Pragma", "no-cache")
            .header("Cache-Control", "no-cache")
            .header("Origin", EDGE_ORIGIN)
            .header("User-Agent", EDGE_USER_AGENT)
            .header("Accept-Language", "en-US,en;q=0.9")
            .build()

        val ws = client.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send(speechConfigMsg)
                webSocket.send(ssmlMsg)
            }

            override fun onMessage(webSocket: WebSocket, textMsg: String) {
                if (textMsg.lowercase(Locale.US).contains("path:turn.end")) {
                    if (settled.compareAndSet(false, true)) {
                        val bytes = synchronized(audioOut) { audioOut.toByteArray() }
                        webSocket.close(1000, "done")
                        if (bytes.isNotEmpty()) {
                            deferred.complete(bytes)
                        } else {
                            deferred.completeExceptionally(IllegalStateException("Edge TTS returned empty audio stream."))
                        }
                    }
                }
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                val arr = bytes.toByteArray()
                if (arr.size < 2) return
                val headerLen = ((arr[0].toInt() and 0xFF) shl 8) or (arr[1].toInt() and 0xFF)
                val dataOffset = 2 + headerLen
                if (headerLen > 0 && dataOffset <= arr.size) {
                    val header = String(arr, 2, headerLen, Charsets.US_ASCII)
                    if (header.lowercase(Locale.US).contains("path:audio") && dataOffset < arr.size) {
                        synchronized(audioOut) {
                            audioOut.write(arr, dataOffset, arr.size - dataOffset)
                        }
                    }
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                response?.header("Date")?.let { updateClockSkewFromDateHeader(it) }
                if (settled.compareAndSet(false, true)) {
                    val code = response?.code
                    val msg = if (code != null) "Edge TTS failed: HTTP $code (${t.message})" else "Edge TTS failed: ${t.message}"
                    deferred.completeExceptionally(IllegalStateException(msg, t))
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (settled.compareAndSet(false, true)) {
                    val bytes = synchronized(audioOut) { audioOut.toByteArray() }
                    if (bytes.isNotEmpty()) {
                        deferred.complete(bytes)
                    } else {
                        deferred.completeExceptionally(IllegalStateException("Edge TTS closed ($code): $reason"))
                    }
                }
            }
        })

        return try {
            withTimeout(EDGE_TTS_TIMEOUT_MS) {
                deferred.await()
            }
        } catch (err: Throwable) {
            ws.cancel()
            throw err
        }
    }

    private fun generateSecMsGec(skewSec: Long): String {
        val unixSeconds = (System.currentTimeMillis() / 1000L) + skewSec
        val windowsSeconds = unixSeconds + 11_644_473_600L
        val roundedSeconds = windowsSeconds - (windowsSeconds % 300L)
        val fileTimeTicks = roundedSeconds * 10_000_000L
        val raw = "$fileTimeTicks$TRUSTED_CLIENT_TOKEN"
        val digest = MessageDigest.getInstance("SHA-256").digest(raw.toByteArray(Charsets.US_ASCII))
        return digest.joinToString("") { "%02X".format(it) }
    }

    private fun syncClockSkewFromEndpoint(endpointUrl: String) {
        try {
            val parsed = endpointUrl.toHttpUrl()
            val rootUrl = "${parsed.scheme}://${parsed.host}/"
            val req = Request.Builder()
                .url(rootUrl)
                .head()
                .header("User-Agent", EDGE_USER_AGENT)
                .build()
            client.newCall(req).execute().use { res ->
                res.header("Date")?.let { updateClockSkewFromDateHeader(it) }
            }
        } catch (_: Throwable) {
            // ignore
        }
    }

    private fun updateClockSkewFromDateHeader(dateHeader: String) {
        try {
            val fmt = SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("GMT")
            }
            val parsed = fmt.parse(dateHeader) ?: return
            clockSkewSeconds.set((parsed.time / 1000L) - (System.currentTimeMillis() / 1000L))
        } catch (_: Throwable) {
            // ignore
        }
    }

    private fun edgeTimestamp(): String {
        val fmt = SimpleDateFormat("EEE MMM dd yyyy HH:mm:ss 'GMT+0000 (Coordinated Universal Time)'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }
        return fmt.format(Date())
    }

    private fun escapeXml(input: String): String {
        return input
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\"", "&quot;")
            .replace("'", "&apos;")
    }

    private fun resolveEdgeVoiceShortName(requestedVoice: String): String {
        val trimmed = requestedVoice.trim()
        return if (trimmed.lowercase(Locale.US).contains("neural") && trimmed.count { it == '-' } >= 2) {
            trimmed
        } else {
            "hi-IN-MadhurNeural"
        }
    }

    private fun clampSafeRate(rawRate: String): String {
        val match = Regex("([+-]?\\d+)%").find(rawRate.trim()) ?: return DEFAULT_VOICE_RATE
        val valInt = (match.groupValues[1].toIntOrNull() ?: 22).coerceIn(-25, 35)
        return if (valInt >= 0) "+$valInt%" else "$valInt%"
    }

    private fun sanitizeSafePitch(rawPitch: String): String {
        val match = Regex("([+-]?\\d+)Hz", RegexOption.IGNORE_CASE).find(rawPitch.trim()) ?: return DEFAULT_VOICE_PITCH
        var valInt = (match.groupValues[1].toIntOrNull() ?: 1).coerceIn(-12, 12)
        if (valInt == 0) valInt = 1
        return if (valInt > 0) "+${valInt}Hz" else "${valInt}Hz"
    }

    private suspend fun synthesizeWithGoogleFallback(cleanText: String, voiceName: String): ByteArray {
        val languageCode = resolveLanguageCode(voiceName)
        val chunks = splitIntoChunks(cleanText, MAX_CHUNK_LENGTH)
        require(chunks.isNotEmpty()) { "No speakable text chunks found." }

        val out = ByteArrayOutputStream()
        chunks.forEachIndexed { idx, chunk ->
            val bytes = fetchChunkWithRetry(chunk, languageCode)
            val finalBytes = if (idx > 0) stripId3v2Header(bytes) else bytes
            out.write(finalBytes)
        }
        return out.toByteArray()
    }

    private suspend fun fetchChunkWithRetry(chunk: String, languageCode: String): ByteArray {
        var lastError: Throwable? = null
        for (attempt in 0 until MAX_ATTEMPTS) {
            try {
                return fetchTtsChunk(chunk, languageCode)
            } catch (err: Throwable) {
                lastError = err
                if (attempt < MAX_ATTEMPTS - 1) {
                    delay(450L * (attempt + 1))
                }
            }
        }
        throw IllegalStateException("TTS synthesis failed after $MAX_ATTEMPTS attempts: ${lastError?.message}")
    }

    private fun fetchTtsChunk(chunk: String, languageCode: String): ByteArray {
        val url = "https://translate.google.com/translate_tts".toHttpUrl().newBuilder()
            .addQueryParameter("ie", "UTF-8")
            .addQueryParameter("tl", languageCode)
            .addQueryParameter("client", "tw-ob")
            .addQueryParameter("q", chunk)
            .build()

        val req = Request.Builder()
            .url(url)
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .build()

        client.newCall(req).execute().use { res ->
            if (!res.isSuccessful) error("TTS HTTP ${res.code}")
            val contentType = (res.header("Content-Type") ?: "").lowercase(Locale.US)
            if (contentType.isNotEmpty() && !contentType.contains("audio") && !contentType.contains("octet-stream")) {
                error("Unexpected TTS Content-Type: $contentType")
            }
            val bytes = res.body?.bytes() ?: ByteArray(0)
            if (bytes.isEmpty()) error("TTS returned 0 audio bytes.")
            return bytes
        }
    }

    private fun splitIntoChunks(text: String, maxLength: Int): List<String> {
        val tokens = text.split(Regex("\\s+")).filter { it.isNotEmpty() }
        val chunks = mutableListOf<String>()
        var current = ""
        for (token in tokens) {
            if (token.length > maxLength) {
                if (current.isNotEmpty()) {
                    chunks.add(current)
                    current = ""
                }
                var i = 0
                while (i < token.length) {
                    chunks.add(token.substring(i, minOf(i + maxLength, token.length)))
                    i += maxLength
                }
                continue
            }
            val sepLen = if (current.isNotEmpty()) 1 else 0
            if (current.length + sepLen + token.length > maxLength) {
                chunks.add(current)
                current = token
            } else {
                current = if (current.isNotEmpty()) "$current $token" else token
            }
        }
        if (current.isNotEmpty()) chunks.add(current)
        return chunks
    }

    private fun stripId3v2Header(bytes: ByteArray): ByteArray {
        if (bytes.size <= 10) return bytes
        if (bytes[0] != 0x49.toByte() || bytes[1] != 0x44.toByte() || bytes[2] != 0x33.toByte()) return bytes
        val tagSize = ((bytes[6].toInt() and 0x7F) shl 21) or
            ((bytes[7].toInt() and 0x7F) shl 14) or
            ((bytes[8].toInt() and 0x7F) shl 7) or
            (bytes[9].toInt() and 0x7F)
        val audioStart = 10 + tagSize
        return if (audioStart in 10 until bytes.size) bytes.copyOfRange(audioStart, bytes.size) else bytes
    }

    private fun resolveLanguageCode(voice: String): String {
        val prefix = voice.split("-").firstOrNull()?.trim()?.lowercase(Locale.US) ?: ""
        return if (prefix.length in 2..3 && prefix.all { it in 'a'..'z' }) prefix else "hi"
    }
}
