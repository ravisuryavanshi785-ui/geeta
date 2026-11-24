package com.rsmoviespot.service

import android.Manifest
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaMetadataRetriever
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.ContextCompat
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import kotlin.math.roundToInt

object GallerySaver {
    fun hasLegacyWritePermission(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) return true
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.WRITE_EXTERNAL_STORAGE
        ) == PackageManager.PERMISSION_GRANTED
    }

    fun readVideoDurationSeconds(videoFile: File): Int {
        if (!videoFile.exists()) return 0
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(videoFile.absolutePath)
            val ms = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
            (ms / 1000.0).roundToInt().coerceAtLeast(1)
        } catch (_: Throwable) {
            0
        } finally {
            runCatching { retriever.release() }
        }
    }

    fun saveVideoToGallery(context: Context, videoFile: File, titleHint: String): Uri? {
        if (!videoFile.exists() || videoFile.length() <= 0L) return null
        val slug = sanitizeFileSlug(titleHint)
        val displayName = "${slug}_${System.currentTimeMillis()}.mp4"

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val resolver = context.contentResolver
            val values = ContentValues().apply {
                put(MediaStore.Video.Media.DISPLAY_NAME, displayName)
                put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
                put(MediaStore.Video.Media.RELATIVE_PATH, "${Environment.DIRECTORY_MOVIES}/RS Movie Spot")
                put(MediaStore.Video.Media.DATE_ADDED, System.currentTimeMillis() / 1000L)
                put(MediaStore.Video.Media.DATE_TAKEN, System.currentTimeMillis())
                put(MediaStore.Video.Media.IS_PENDING, 1)
            }
            val collection = MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            val itemUri = resolver.insert(collection, values) ?: return null
            return try {
                resolver.openOutputStream(itemUri)?.use { out ->
                    FileInputStream(videoFile).use { input ->
                        input.copyTo(out)
                    }
                } ?: throw IllegalStateException("Could not open MediaStore output stream.")
                val doneValues = ContentValues().apply {
                    put(MediaStore.Video.Media.IS_PENDING, 0)
                }
                resolver.update(itemUri, doneValues, null, null)
                itemUri
            } catch (err: Throwable) {
                runCatching { resolver.delete(itemUri, null, null) }
                null
            }
        }

        if (!hasLegacyWritePermission(context)) return null
        @Suppress("DEPRECATION")
        val moviesDir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES), "RS Movie Spot")
        if (!moviesDir.exists()) moviesDir.mkdirs()
        val destFile = File(moviesDir, displayName)
        FileInputStream(videoFile).use { input ->
            FileOutputStream(destFile).use { out ->
                input.copyTo(out)
            }
        }
        MediaScannerConnection.scanFile(context, arrayOf(destFile.absolutePath), arrayOf("video/mp4"), null)
        return Uri.fromFile(destFile)
    }

    fun saveImageToGallery(context: Context, imageFile: File, titleHint: String): Uri? {
        if (!imageFile.exists() || imageFile.length() <= 0L) return null
        val slug = sanitizeFileSlug(titleHint)
        val displayName = "${slug}_cover_${System.currentTimeMillis()}.jpg"

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val resolver = context.contentResolver
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, displayName)
                put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
                put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/RS Movie Spot")
                put(MediaStore.Images.Media.IS_PENDING, 1)
            }
            val collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            val itemUri = resolver.insert(collection, values) ?: return null
            return try {
                resolver.openOutputStream(itemUri)?.use { out ->
                    FileInputStream(imageFile).use { input ->
                        input.copyTo(out)
                    }
                } ?: throw IllegalStateException("Could not open MediaStore image output stream.")
                resolver.update(itemUri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
                itemUri
            } catch (_: Throwable) {
                runCatching { resolver.delete(itemUri, null, null) }
                null
            }
        }

        if (!hasLegacyWritePermission(context)) return null
        @Suppress("DEPRECATION")
        val picsDir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "RS Movie Spot")
        if (!picsDir.exists()) picsDir.mkdirs()
        val destFile = File(picsDir, displayName)
        FileInputStream(imageFile).use { input ->
            FileOutputStream(destFile).use { out ->
                input.copyTo(out)
            }
        }
        MediaScannerConnection.scanFile(context, arrayOf(destFile.absolutePath), arrayOf("image/jpeg"), null)
        return Uri.fromFile(destFile)
    }

    private fun sanitizeFileSlug(raw: String): String {
        val cleaned = raw.trim()
            .replace(Regex("[^a-zA-Z0-9_-]+"), "_")
            .trim('_')
            .take(40)
        return if (cleaned.isNotEmpty()) "RS_Movie_Spot_$cleaned" else "RS_Movie_Spot"
    }
}
