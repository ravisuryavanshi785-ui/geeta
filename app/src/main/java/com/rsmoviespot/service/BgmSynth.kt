package com.rsmoviespot.service

import com.rsmoviespot.domain.models.BgmStyle
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin

object BgmSynth {
    const val SAMPLE_RATE = 44100

    fun resolveBgmStyle(mood: String): BgmStyle {
        val n = mood.lowercase().trim()
        return when {
            "roast" in n || "comedy" in n || "funny" in n || "satire" in n -> BgmStyle.COMEDY_ROAST
            "horror" in n || "scary" in n -> BgmStyle.HORROR_DARK
            "suspense" in n || "thriller" in n || "mystery" in n || "crime" in n -> BgmStyle.SUSPENSE_THRILLER
            "emotional" in n || "sad" in n || "drama" in n -> BgmStyle.EMOTIONAL_SAD
            "devotional" in n || "spiritual" in n || "myth" in n -> BgmStyle.DEVOTIONAL
            "sci" in n || "tech" in n || "cyber" in n || "future" in n -> BgmStyle.SCI_FI_TECH
            "motiv" in n || "inspir" in n || "success" in n -> BgmStyle.MOTIVATIONAL
            else -> BgmStyle.EPIC_ACTION
        }
    }

    fun synthesizeBgmPcm(mood: String, bgmSeed: Int): ShortArray {
        val style = resolveBgmStyle(mood)
        val semitoneShifts = intArrayOf(-3, -2, 0, 2, 3)
        val semitoneShift = semitoneShifts[(bgmSeed and 0x7FFFFFFF) % semitoneShifts.size]
        val pitchScale = 2.0.pow(semitoneShift / 12.0)
        val arpVariant = ((bgmSeed ushr 4) and 0x7FFFFFFF) % 3

        val beatDuration: Double
        val beatsPerLoop: Int
        val baseChords: Array<DoubleArray>

        when (style) {
            BgmStyle.COMEDY_ROAST -> {
                beatDuration = 0.5
                beatsPerLoop = 32
                baseChords = arrayOf(
                    doubleArrayOf(261.63, 329.63, 392.0, 523.25),
                    doubleArrayOf(196.0, 246.94, 293.66, 392.0),
                    doubleArrayOf(220.0, 261.63, 329.63, 440.0),
                    doubleArrayOf(174.61, 220.0, 261.63, 349.23)
                )
            }
            BgmStyle.SUSPENSE_THRILLER -> {
                beatDuration = 0.75
                beatsPerLoop = 16
                baseChords = arrayOf(
                    doubleArrayOf(164.81, 196.0, 246.94, 329.63),
                    doubleArrayOf(164.81, 174.61, 220.0, 349.23),
                    doubleArrayOf(164.81, 196.0, 246.94, 329.63),
                    doubleArrayOf(155.56, 185.0, 220.0, 311.13)
                )
            }
            BgmStyle.EMOTIONAL_SAD -> {
                beatDuration = 0.8
                beatsPerLoop = 16
                baseChords = arrayOf(
                    doubleArrayOf(220.0, 261.63, 329.63, 440.0),
                    doubleArrayOf(174.61, 220.0, 261.63, 349.23),
                    doubleArrayOf(130.81, 196.0, 261.63, 329.63),
                    doubleArrayOf(196.0, 246.94, 293.66, 392.0)
                )
            }
            BgmStyle.DEVOTIONAL -> {
                beatDuration = 0.75
                beatsPerLoop = 16
                baseChords = arrayOf(
                    doubleArrayOf(130.81, 196.0, 261.63, 293.66),
                    doubleArrayOf(174.61, 220.0, 261.63, 392.0),
                    doubleArrayOf(196.0, 261.63, 293.66, 392.0),
                    doubleArrayOf(130.81, 196.0, 261.63, 329.63)
                )
            }
            BgmStyle.SCI_FI_TECH -> {
                beatDuration = 0.5
                beatsPerLoop = 32
                baseChords = arrayOf(
                    doubleArrayOf(220.0, 261.63, 329.63, 440.0),
                    doubleArrayOf(174.61, 220.0, 261.63, 349.23),
                    doubleArrayOf(146.83, 220.0, 293.66, 349.23),
                    doubleArrayOf(164.81, 207.65, 246.94, 329.63)
                )
            }
            BgmStyle.MOTIVATIONAL -> {
                beatDuration = 0.6
                beatsPerLoop = 32
                baseChords = arrayOf(
                    doubleArrayOf(174.61, 220.0, 261.63, 349.23),
                    doubleArrayOf(196.0, 246.94, 293.66, 392.0),
                    doubleArrayOf(164.81, 196.0, 246.94, 329.63),
                    doubleArrayOf(220.0, 261.63, 329.63, 440.0)
                )
            }
            BgmStyle.HORROR_DARK -> {
                beatDuration = 0.8
                beatsPerLoop = 16
                baseChords = arrayOf(
                    doubleArrayOf(138.59, 164.81, 207.65, 277.18),
                    doubleArrayOf(138.59, 196.0, 246.94, 293.66),
                    doubleArrayOf(146.83, 174.61, 220.0, 293.66),
                    doubleArrayOf(138.59, 196.0, 233.08, 277.18)
                )
            }
            BgmStyle.EPIC_ACTION -> {
                beatDuration = 0.46875
                beatsPerLoop = 32
                baseChords = arrayOf(
                    doubleArrayOf(146.83, 220.0, 293.66, 349.23),
                    doubleArrayOf(116.54, 174.61, 233.08, 293.66),
                    doubleArrayOf(130.81, 196.0, 261.63, 329.63),
                    doubleArrayOf(110.0, 164.81, 220.0, 277.18)
                )
            }
        }

        val chords = baseChords.map { c -> c.map { it * pitchScale }.toDoubleArray() }
        val loopDuration = beatsPerLoop * beatDuration
        val chordDuration = loopDuration / chords.size
        val totalSamples = (loopDuration * SAMPLE_RATE).roundToInt()

        val arpOrder = when (arpVariant) {
            0 -> intArrayOf(0, 1, 2, 3, 2, 1, 3, 2)
            1 -> intArrayOf(0, 2, 1, 3, 0, 3, 2, 1)
            else -> intArrayOf(3, 2, 1, 0, 1, 2, 3, 2)
        }

        var rngState = if (bgmSeed == 0) 1L else bgmSeed.toLong() and 0xFFFFFFFFL
        fun nextRandDouble(): Double {
            rngState = (1664525L * rngState + 1013904223L) and 0xFFFFFFFFL
            return (rngState.toDouble() / 4294967296.0) * 2.0 - 1.0
        }

        val out = ShortArray(totalSamples)
        for (i in 0 until totalSamples) {
            val t = i.toDouble() / SAMPLE_RATE
            val chordIndex = (t / chordDuration).toInt().coerceIn(0, chords.size - 1)
            val chordLocalT = t - chordIndex * chordDuration
            val chord = chords[chordIndex]
            val beatT = t % beatDuration
            val beatNumber = (t / beatDuration).toInt()
            val halfBeatT = t % (beatDuration * 0.5)
            val quarterBeatT = t % (beatDuration * 0.25)

            val loopEnv = min(1.0, t / 0.04) * min(1.0, (loopDuration - t) / 0.04)
            val chordEnv = min(1.0, chordLocalT / 0.12) * min(1.0, (chordDuration - chordLocalT) / 0.12)

            val sample = when (style) {
                BgmStyle.COMEDY_ROAST -> {
                    val stepIdx = (t / (beatDuration * 0.5)).toInt() % arpOrder.size
                    val pluckFreq = chord[arpOrder[stepIdx]] * 1.5
                    val pluckEnv = exp(-12.0 * halfBeatT)
                    val pluck = (sin(2.0 * PI * pluckFreq * halfBeatT) + 0.35 * sin(2.0 * PI * pluckFreq * 2.0 * halfBeatT)) * pluckEnv * 0.36
                    val bass = sin(2.0 * PI * (chord[0] * 0.5) * beatT) * exp(-7.5 * beatT) * 0.34
                    val snap = if (beatNumber % 2 == 1) nextRandDouble() * exp(-28.0 * beatT) * 0.26 else 0.0
                    pluck + bass + snap
                }
                BgmStyle.SUSPENSE_THRILLER -> {
                    val tick = (sin(2.0 * PI * 1950.0 * halfBeatT) * 0.5 + nextRandDouble() * 0.5) * exp(-55.0 * halfBeatT) * 0.22
                    val heartbeat = if (beatNumber % 2 == 0) sin(2.0 * PI * 72.0 * beatT) * exp(-12.0 * beatT) * 0.4 else 0.0
                    val bell = sin(2.0 * PI * (chord[3] * 2.0) * chordLocalT) * exp(-1.8 * chordLocalT) * 0.2
                    val lowDrone = (sin(2.0 * PI * (chord[0] * 0.5) * t) * 0.2 + sin(2.0 * PI * chord[1] * t) * 0.1) * chordEnv
                    tick + heartbeat + bell + lowDrone
                }
                BgmStyle.EMOTIONAL_SAD -> {
                    val pianoAttack = min(1.0, chordLocalT / 0.025)
                    val pianoDecay = exp(-1.4 * chordLocalT)
                    var piano = 0.0
                    for (freq in chord) {
                        piano += sin(2.0 * PI * freq * t) * 0.18 + sin(2.0 * PI * freq * 2.0 * t) * 0.05
                    }
                    piano *= pianoAttack * pianoDecay
                    val stepIdx = (t / beatDuration).toInt() % arpOrder.size
                    val melody = sin(2.0 * PI * (chord[arpOrder[stepIdx]] * 2.0) * beatT) * min(1.0, beatT / 0.015) * exp(-2.8 * beatT) * 0.24
                    val warmPad = sin(2.0 * PI * (chord[0] * 0.5) * t) * chordEnv * 0.22
                    piano + melody + warmPad
                }
                BgmStyle.DEVOTIONAL -> {
                    val drone = (sin(2.0 * PI * (chord[0] * 0.5) * t) * 0.22 + sin(2.0 * PI * chord[1] * t) * 0.12 + sin(2.0 * PI * chord[2] * t) * 0.08) * chordEnv
                    val stepIdx = (t / beatDuration).toInt() % arpOrder.size
                    val fluteFreq = chord[arpOrder[stepIdx]] * 2.0
                    val vibrato = 1.0 + 0.008 * sin(2.0 * PI * 5.2 * t)
                    val fluteEnv = sin(PI * (beatT / beatDuration).coerceIn(0.0, 1.0)).pow(0.8)
                    val flute = sin(2.0 * PI * fluteFreq * vibrato * t) * fluteEnv * 0.24
                    val bell = (sin(2.0 * PI * (chord[3] * 2.0) * chordLocalT) + 0.4 * sin(2.0 * PI * (chord[3] * 4.0) * chordLocalT)) * exp(-2.6 * chordLocalT) * 0.16
                    drone + flute + bell
                }
                BgmStyle.SCI_FI_TECH -> {
                    val stepIdx = (t / (beatDuration * 0.25)).toInt() % arpOrder.size
                    val arpFreq = chord[arpOrder[stepIdx]] * 2.0
                    val arp = (sin(2.0 * PI * arpFreq * quarterBeatT) + 0.4 * sin(2.0 * PI * arpFreq * 2.0 * quarterBeatT)) * exp(-14.0 * quarterBeatT) * 0.28
                    val pad = (sin(2.0 * PI * chord[0] * t) * 0.16 + sin(2.0 * PI * chord[2] * t) * 0.12) * chordEnv
                    val kickFreq = 58.0 + 130.0 * exp(-30.0 * beatT)
                    val kick = sin(2.0 * PI * kickFreq * beatT) * exp(-11.0 * beatT) * 0.36
                    val hat = if (stepIdx % 2 == 1) nextRandDouble() * exp(-45.0 * quarterBeatT) * 0.12 else 0.0
                    arp + pad + kick + hat
                }
                BgmStyle.MOTIVATIONAL -> {
                    val stepIdx = (t / (beatDuration * 0.5)).toInt() % arpOrder.size
                    val arp = sin(2.0 * PI * (chord[arpOrder[stepIdx]] * 1.5) * halfBeatT) * exp(-7.5 * halfBeatT) * 0.28
                    var pad = 0.0
                    for (freq in chord) pad += sin(2.0 * PI * freq * t) * 0.12
                    pad *= chordEnv
                    val kick = sin(2.0 * PI * (62.0 + 95.0 * exp(-22.0 * beatT)) * beatT) * exp(-10.0 * beatT) * 0.34
                    arp + pad + kick
                }
                BgmStyle.HORROR_DARK -> {
                    val lfo = 0.7 + 0.3 * sin(2.0 * PI * 0.35 * t)
                    val drone = (sin(2.0 * PI * (chord[0] * 0.5) * t) * 0.28 + sin(2.0 * PI * chord[1] * t) * 0.16 + sin(2.0 * PI * (chord[3] * 1.5) * t) * 0.08) * chordEnv * lfo
                    val metal = if (beatNumber % 4 == 0) (sin(2.0 * PI * 740.0 * beatT) * 0.6 + sin(2.0 * PI * 1185.0 * beatT) * 0.4) * exp(-2.4 * beatT) * 0.22 else 0.0
                    drone + metal
                }
                BgmStyle.EPIC_ACTION -> {
                    var brass = 0.0
                    for (freq in chord) {
                        brass += sin(2.0 * PI * freq * t) * 0.14 + sin(2.0 * PI * freq * 2.0 * t) * 0.05 + sin(2.0 * PI * freq * 3.0 * t) * 0.012
                    }
                    brass *= chordEnv * (0.85 + 0.15 * sin(2.0 * PI * 0.6 * t))
                    val stepIdx = (t / (beatDuration * 0.5)).toInt() % arpOrder.size
                    val motif = sin(2.0 * PI * (chord[arpOrder[stepIdx]] * 1.5) * halfBeatT) * exp(-9.0 * halfBeatT) * 0.2
                    val mainDrum = sin(2.0 * PI * (65.0 + 105.0 * exp(-26.0 * beatT)) * beatT) * exp(-13.0 * beatT) * 0.4
                    val doubleHit = sin(2.0 * PI * 88.0 * halfBeatT) * exp(-18.0 * halfBeatT) * 0.18
                    brass + motif + mainDrum + doubleHit
                }
            }

            val clipped = (sample * loopEnv).coerceIn(-0.92, 0.92)
            out[i] = (clipped * 32767.0).roundToInt().coerceIn(-32768, 32767).toShort()
        }
        return out
    }

    fun synthesizeSfxPcm(cue: String, durationSeconds: Double = 0.55): ShortArray {
        val count = max(1, (durationSeconds * SAMPLE_RATE).roundToInt())
        val out = ShortArray(count)
        var rng = 98765L
        fun noise(): Double {
            rng = (1664525L * rng + 1013904223L) and 0xFFFFFFFFL
            return (rng.toDouble() / 4294967296.0) * 2.0 - 1.0
        }
        val norm = cue.lowercase().trim()
        for (i in 0 until count) {
            val t = i.toDouble() / SAMPLE_RATE
            val s = when {
                "boom" in norm -> sin(2.0 * PI * (110.0 * exp(-4.5 * t) + 38.0) * t) * exp(-5.0 * t) * 0.75
                "thunder" in norm -> (noise() * 0.55 + sin(2.0 * PI * 52.0 * t) * 0.45) * exp(-3.6 * t) * 0.65
                "sword" in norm -> (sin(2.0 * PI * 1450.0 * t) * 0.5 + sin(2.0 * PI * 2320.0 * t) * 0.35 + noise() * 0.15) * exp(-9.0 * t) * 0.55
                "fire" in norm -> noise() * exp(-4.2 * t) * 0.45 + sin(2.0 * PI * 140.0 * t) * exp(-6.0 * t) * 0.25
                else -> noise() * sin(PI * (t / durationSeconds).coerceIn(0.0, 1.0)) * 0.38
            }
            out[i] = (s.coerceIn(-0.9, 0.9) * 32767.0).roundToInt().coerceIn(-32768, 32767).toShort()
        }
        return out
    }

    fun mixVoiceBgmSfx(
        voiceSamples: ShortArray,
        bgmSamples: ShortArray,
        sfxEvents: List<Pair<Int, ShortArray>>,
        totalDurationSeconds: Double
    ): ShortArray {
        val totalSamples = max(voiceSamples.size, (totalDurationSeconds * SAMPLE_RATE).roundToInt())
        if (totalSamples <= 0) return ShortArray(0)

        val blockSize = 441
        val bgmGains = FloatArray(totalSamples)
        var smoothedGain = 0.14f
        var cursor = 0

        while (cursor < totalSamples) {
            val end = min(cursor + blockSize, totalSamples)
            var peak = 0
            val voiceEnd = min(end, voiceSamples.size)
            for (k in cursor until voiceEnd) {
                val a = abs(voiceSamples[k].toInt())
                if (a > peak) peak = a
            }
            val targetGain = if (peak > 900) 0.08f else 0.22f
            val coeff = if (targetGain < smoothedGain) 0.35f else 0.08f
            smoothedGain += (targetGain - smoothedGain) * coeff
            for (k in cursor until end) {
                bgmGains[k] = smoothedGain
            }
            cursor = end
        }

        val mixed = ShortArray(totalSamples)
        val sfxBuffer = FloatArray(totalSamples)
        for ((startIdx, sfxPcm) in sfxEvents) {
            for (j in sfxPcm.indices) {
                val pos = startIdx + j
                if (pos in 0 until totalSamples) {
                    sfxBuffer[pos] += (sfxPcm[j] / 32768.0f) * 0.35f
                }
            }
        }

        for (i in 0 until totalSamples) {
            val v = if (i < voiceSamples.size) voiceSamples[i] / 32768.0f else 0.0f
            val b = if (bgmSamples.isNotEmpty()) (bgmSamples[i % bgmSamples.size] / 32768.0f) * bgmGains[i] else 0.0f
            val total = (v + b + sfxBuffer[i]).coerceIn(-0.96f, 0.96f)
            mixed[i] = (total * 32767.0f).roundToInt().coerceIn(-32768, 32767).toShort()
        }
        return mixed
    }

    fun writeMono16BitWav(outFile: File, samples: ShortArray, sampleRate: Int = SAMPLE_RATE) {
        val dataSize = samples.size * 2
        val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray(Charsets.US_ASCII))
            putInt(36 + dataSize)
            put("WAVE".toByteArray(Charsets.US_ASCII))
            put("fmt ".toByteArray(Charsets.US_ASCII))
            putInt(16)
            putShort(1.toShort())
            putShort(1.toShort())
            putInt(sampleRate)
            putInt(sampleRate * 2)
            putShort(2.toShort())
            putShort(16.toShort())
            put("data".toByteArray(Charsets.US_ASCII))
            putInt(dataSize)
        }.array()

        val dataBytes = ByteBuffer.allocate(dataSize).order(ByteOrder.LITTLE_ENDIAN)
        for (s in samples) dataBytes.putShort(s)

        outFile.parentFile?.mkdirs()
        FileOutputStream(outFile).use { fos ->
            fos.write(header)
            fos.write(dataBytes.array())
        }
    }
}
