package com.rsmoviespot.service

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.renderscript.Allocation
import android.renderscript.Element
import android.renderscript.RenderScript
import android.renderscript.ScriptIntrinsicBlur
import android.content.Context
import java.io.File
import java.io.FileOutputStream
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

object ImageComposer {
    fun stripDecorativeEmojis(text: String): String {
        val sb = StringBuilder()
        var i = 0
        while (i < text.length) {
            val cp = text.codePointAt(i)
            val charCount = Character.charCount(cp)
            val isEmoji = (cp in 0x1F000..0x1FAFF) ||
                (cp in 0x2600..0x27BF) ||
                cp == 0xFE0F ||
                cp == 0x200D
            if (!isEmoji) {
                sb.appendCodePoint(cp)
            }
            i += charCount
        }
        return sb.toString().replace(Regex("\\s+"), " ").trim()
    }

    fun decodeImageDimensions(file: File): Pair<Int, Int>? {
        if (!file.exists() || file.length() < 1024) return null
        val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, opts)
        return if (opts.outWidth >= 100 && opts.outHeight >= 100) {
            opts.outWidth to opts.outHeight
        } else {
            null
        }
    }

    fun isMostlyBlackOrCorrupt(bitmap: Bitmap): Boolean {
        val w = bitmap.width
        val h = bitmap.height
        if (w < 100 || h < 100) return true
        val stepX = max(1, w / 24)
        val stepY = max(1, h / 24)
        var sumLum = 0.0
        var count = 0
        var y = 0
        while (y < h) {
            var x = 0
            while (x < w) {
                val px = bitmap.getPixel(x, y)
                val r = Color.red(px)
                val g = Color.green(px)
                val b = Color.blue(px)
                sumLum += 0.299 * r + 0.587 * g + 0.114 * b
                count++
                x += stepX
            }
            y += stepY
        }
        return count == 0 || (sumLum / count) < 6.0
    }

    fun createFallbackCinemaBitmap(width: Int, height: Int, seedOffset: Int): Bitmap {
        val bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        val topColor = if (seedOffset % 2 == 0) Color.parseColor("#2A1519") else Color.parseColor("#112233")
        val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(
                0f, 0f, width.toFloat(), height.toFloat(),
                topColor, Color.parseColor("#0A0D12"),
                Shader.TileMode.CLAMP
            )
        }
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), bgPaint)

        val cx = width * 0.5f
        val cy = height * 0.42f
        val radius = max(width, height) * 0.55f
        val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = RadialGradient(
                cx, cy, radius,
                intArrayOf(Color.argb(65, 255, 168, 38), Color.argb(18, 255, 168, 38), Color.TRANSPARENT),
                floatArrayOf(0f, 0.55f, 1f),
                Shader.TileMode.CLAMP
            )
        }
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), glowPaint)
        return bmp
    }

    fun trimBottomRatio(src: Bitmap, keepRatio: Float = 0.92f): Bitmap {
        val keepH = max(100, (src.height * keepRatio).roundToInt().coerceAtMost(src.height))
        if (keepH >= src.height) return src.copy(Bitmap.Config.ARGB_8888, false)
        return Bitmap.createBitmap(src, 0, 0, src.width, keepH)
    }

    fun centerCropBitmap(src: Bitmap, targetWidth: Int, targetHeight: Int, biasTop: Boolean = false): Bitmap {
        val out = Bitmap.createBitmap(targetWidth, targetHeight, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        val scale = max(targetWidth.toFloat() / src.width, targetHeight.toFloat() / src.height)
        val scaledW = src.width * scale
        val scaledH = src.height * scale
        val dx = (targetWidth - scaledW) * 0.5f
        val dy = if (biasTop) 0f else (targetHeight - scaledH) * 0.5f
        val dst = RectF(dx, dy, dx + scaledW, dy + scaledH)
        canvas.drawBitmap(src, null, dst, Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG))
        return out
    }

    fun composeSplitBitmap(bmp1: Bitmap, bmp2: Bitmap, width: Int, height: Int): Bitmap {
        val out = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        canvas.drawColor(Color.BLACK)
        val barPaint = Paint().apply { color = Color.parseColor("#FFE135") }

        if (height > width) {
            val halfH = height / 2
            val topCrop = centerCropBitmap(bmp1, width, halfH - 3, biasTop = true)
            val botCrop = centerCropBitmap(bmp2, width, height - (halfH + 3), biasTop = true)
            canvas.drawBitmap(topCrop, 0f, 0f, null)
            canvas.drawBitmap(botCrop, 0f, (halfH + 3).toFloat(), null)
            canvas.drawRect(0f, (halfH - 3).toFloat(), width.toFloat(), (halfH + 3).toFloat(), barPaint)
            topCrop.recycle()
            botCrop.recycle()
        } else {
            val halfW = width / 2
            val leftCrop = centerCropBitmap(bmp1, halfW - 3, height, biasTop = true)
            val rightCrop = centerCropBitmap(bmp2, width - (halfW + 3), height, biasTop = true)
            canvas.drawBitmap(leftCrop, 0f, 0f, null)
            canvas.drawBitmap(rightCrop, (halfW + 3).toFloat(), 0f, null)
            canvas.drawRect((halfW - 3).toFloat(), 0f, (halfW + 3).toFloat(), height.toFloat(), barPaint)
            leftCrop.recycle()
            rightCrop.recycle()
        }
        return out
    }

    fun composeStudioBitmapFromRealPhoto(
        context: Context,
        src: Bitmap,
        targetWidth: Int,
        targetHeight: Int
    ): Bitmap {
        val srcAspect = src.width.toFloat() / max(1, src.height)
        val targetAspect = targetWidth.toFloat() / max(1, targetHeight)
        if (targetHeight > targetWidth && srcAspect in 0.5f..0.78f) {
            return centerCropBitmap(src, targetWidth, targetHeight, biasTop = true)
        }
        if (kotlin.math.abs(srcAspect - targetAspect) <= 0.16f && src.height >= src.width * 0.75f) {
            return centerCropBitmap(src, targetWidth, targetHeight, biasTop = true)
        }

        val out = Bitmap.createBitmap(targetWidth, targetHeight, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)

        val bgSmall = centerCropBitmap(src, max(120, targetWidth / 4), max(120, targetHeight / 4), biasTop = false)
        val blurredBg = fastBlurBitmap(context, bgSmall, 22f)
        bgSmall.recycle()
        canvas.drawBitmap(
            blurredBg,
            null,
            RectF(0f, 0f, targetWidth.toFloat(), targetHeight.toFloat()),
            Paint(Paint.FILTER_BITMAP_FLAG)
        )
        blurredBg.recycle()
        canvas.drawColor(Color.argb(85, 0, 0, 0))

        val isTallCanvas = targetHeight > targetWidth * 1.2f
        val maxW = targetWidth * (if (isTallCanvas) 0.92f else 0.88f)
        val maxH = targetHeight * (if (isTallCanvas) 0.68f else 0.82f)
        val scale = min(maxW / src.width, maxH / src.height)
        val fgW = src.width * scale
        val fgH = src.height * scale
        val left = (targetWidth - fgW) * 0.5f
        val minTop = if (isTallCanvas) 110f else 24f
        val idealTop = (targetHeight - fgH) * (if (isTallCanvas) 0.36f else 0.30f)
        val top = min(max(0f, targetHeight - fgH), max(minTop, idealTop))
        val fgRect = RectF(left, top, left + fgW, top + fgH)
        canvas.drawBitmap(src, null, fgRect, Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG))
        return out
    }

    @Suppress("DEPRECATION")
    private fun fastBlurBitmap(context: Context, bitmap: Bitmap, radius: Float): Bitmap {
        return try {
            val out = Bitmap.createBitmap(bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888)
            val rs = RenderScript.create(context)
            val input = Allocation.createFromBitmap(rs, bitmap)
            val output = Allocation.createTyped(rs, input.type)
            val script = ScriptIntrinsicBlur.create(rs, Element.U8_4(rs))
            script.setRadius(radius.coerceIn(1f, 25f))
            script.setInput(input)
            script.forEach(output)
            output.copyTo(out)
            input.destroy()
            output.destroy()
            script.destroy()
            rs.destroy()
            out
        } catch (_: Throwable) {
            bitmap.copy(Bitmap.Config.ARGB_8888, false)
        }
    }

    fun drawWatermarkOverlay(canvas: Canvas, width: Int, height: Int, isShorts: Boolean) {
        val text = "@RSMovieSpot"
        val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            textSize = if (isShorts) 24f else 22f
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
            textAlign = Paint.Align.CENTER
        }
        val boxW = if (isShorts) 260f else 240f
        val boxH = 52f
        val left = (width - boxW) * 0.5f
        val top = if (isShorts) 56f else 28f
        val rect = RectF(left, top, left + boxW, top + boxH)

        val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(135, 0, 0, 0)
            style = Paint.Style.FILL
        }
        val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(155, 57, 255, 20)
            style = Paint.Style.STROKE
            strokeWidth = 2.5f
        }
        canvas.drawRoundRect(rect, 26f, 26f, bgPaint)
        canvas.drawRoundRect(rect, 26f, 26f, borderPaint)
        val textY = rect.centerY() - (textPaint.descent() + textPaint.ascent()) * 0.5f
        canvas.drawText(text, rect.centerX(), textY, textPaint)
    }

    fun drawStatBadgeOverlay(canvas: Canvas, badgeText: String, width: Int, isShorts: Boolean) {
        val clean = badgeText.trim().uppercase()
        if (clean.isEmpty()) return

        val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK
            textSize = if (isShorts) 34f else 30f
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
            textAlign = Paint.Align.CENTER
        }
        val measured = textPaint.measureText(clean)
        val boxW = min((width - 80).toFloat(), max(160f, measured + 64f))
        val boxH = if (isShorts) 68f else 60f
        val left = (width - boxW) * 0.5f
        val top = if (isShorts) 130f else 98f
        val rect = RectF(left, top, left + boxW, top + boxH)

        val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.parseColor("#FFD600")
            style = Paint.Style.FILL
        }
        val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            style = Paint.Style.STROKE
            strokeWidth = 3f
        }
        canvas.drawRoundRect(rect, 20f, 20f, bgPaint)
        canvas.drawRoundRect(rect, 20f, 20f, borderPaint)
        val textY = rect.centerY() - (textPaint.descent() + textPaint.ascent()) * 0.5f
        canvas.drawText(clean, rect.centerX(), textY, textPaint)
    }

    fun drawSubscribeEndCard(canvas: Canvas, width: Int, height: Int, isShorts: Boolean) {
        val boxW = if (isShorts) 430f else 380f
        val boxH = 74f
        val left = (width - boxW) * 0.5f
        val top = if (isShorts) height * 0.70f else height * 0.72f
        val rect = RectF(left, top, left + boxW, top + boxH)

        val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.parseColor("#E50914")
            style = Paint.Style.FILL
        }
        val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            textSize = if (isShorts) 28f else 25f
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
            textAlign = Paint.Align.CENTER
        }
        canvas.drawRoundRect(rect, 37f, 37f, bgPaint)
        val textY = rect.centerY() - (textPaint.descent() + textPaint.ascent()) * 0.5f
        canvas.drawText("SUBSCRIBE FOR MORE!", rect.centerX(), textY, textPaint)
    }

    fun drawPopCaptionOverlay(canvas: Canvas, text: String, width: Int, height: Int, isShorts: Boolean) {
        val clean = text.trim()
        if (clean.isEmpty()) return

        val fontSize = if (isShorts) 48f else 40f
        val maxChars = if (isShorts) 24 else 38
        val lines = wrapTextLines(clean, maxChars, 2)
        if (lines.isEmpty()) return

        val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.parseColor("#FFE135")
            textSize = fontSize
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
            textAlign = Paint.Align.CENTER
        }
        val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK
            textSize = fontSize
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
            textAlign = Paint.Align.CENTER
            style = Paint.Style.STROKE
            strokeWidth = if (isShorts) 10f else 8f
            strokeJoin = Paint.Join.ROUND
        }

        val lineHeight = fontSize * 1.24f
        val longestW = lines.maxOf { fillPaint.measureText(it) }
        val boxPadX = if (isShorts) 32f else 36f
        val boxPadY = 18f
        val boxW = min((width - 48).toFloat(), max(180f, longestW + boxPadX * 2f))
        val boxH = lines.size * lineHeight + boxPadY * 2f
        val boxLeft = (width - boxW) * 0.5f
        val boxBottom = height - (if (isShorts) 210f else 88f)
        val boxTop = boxBottom - boxH
        val rect = RectF(boxLeft, boxTop, boxLeft + boxW, boxBottom)

        val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(172, 0, 0, 0)
            style = Paint.Style.FILL
        }
        val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(120, 255, 225, 53)
            style = Paint.Style.STROKE
            strokeWidth = 3f
        }
        canvas.drawRoundRect(rect, 24f, 24f, bgPaint)
        canvas.drawRoundRect(rect, 24f, 24f, borderPaint)

        val startY = boxTop + boxPadY + fontSize * 0.88f
        lines.forEachIndexed { idx, line ->
            val y = startY + idx * lineHeight
            canvas.drawText(line, width * 0.5f, y, strokePaint)
            canvas.drawText(line, width * 0.5f, y, fillPaint)
        }
    }

    fun renderCoverThumbnailJpg(
        sourceFrame: Bitmap,
        headline: String,
        outputFile: File,
        isShorts: Boolean
    ) {
        val width = if (isShorts) 1080 else 1280
        val height = if (isShorts) 1920 else 720
        val out = centerCropBitmap(sourceFrame, width, height, biasTop = false)
        val canvas = Canvas(out)

        val grad = Paint().apply {
            shader = LinearGradient(
                0f, height * 0.48f, 0f, height.toFloat(),
                Color.TRANSPARENT, Color.argb(225, 0, 0, 0),
                Shader.TileMode.CLAMP
            )
        }
        canvas.drawRect(0f, height * 0.48f, width.toFloat(), height.toFloat(), grad)

        val cleanHeadline = stripDecorativeEmojis(headline).ifBlank { "RS MOVIE SPOT" }.uppercase()
        val fontSize = if (isShorts) 64f else 54f
        val lines = wrapTextLines(cleanHeadline, if (isShorts) 18 else 26, 3)

        val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.parseColor("#FFE135")
            textSize = fontSize
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
            textAlign = Paint.Align.CENTER
        }
        val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK
            textSize = fontSize
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
            textAlign = Paint.Align.CENTER
            style = Paint.Style.STROKE
            strokeWidth = 12f
            strokeJoin = Paint.Join.ROUND
        }

        val lineH = fontSize * 1.18f
        val startY = height - (lines.size * lineH) - 90f
        lines.forEachIndexed { idx, line ->
            val y = startY + idx * lineH
            canvas.drawText(line, width * 0.5f, y, strokePaint)
            canvas.drawText(line, width * 0.5f, y, fillPaint)
        }
        drawWatermarkOverlay(canvas, width, height, isShorts)

        outputFile.parentFile?.mkdirs()
        FileOutputStream(outputFile).use { fos ->
            out.compress(Bitmap.CompressFormat.JPEG, 92, fos)
        }
        out.recycle()
    }

    private fun wrapTextLines(text: String, maxCharsPerLine: Int, maxLines: Int): List<String> {
        val words = text.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (words.isEmpty()) return emptyList()
        val lines = mutableListOf<String>()
        var current = ""
        for (w in words) {
            val next = if (current.isNotEmpty()) "$current $w" else w
            if (next.length > maxCharsPerLine && current.isNotEmpty()) {
                lines.add(current)
                current = w
                if (lines.size >= maxLines - 1) continue
            } else {
                current = next
            }
        }
        if (current.isNotEmpty()) {
            if (lines.size >= maxLines) {
                lines[maxLines - 1] = "${lines[maxLines - 1]} $current".take(maxCharsPerLine + 4)
            } else {
                lines.add(current)
            }
        }
        return lines.take(maxLines)
    }
}
