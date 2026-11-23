package com.rsmoviespot.ui

import android.content.Intent
import android.graphics.BitmapFactory
import android.widget.MediaController
import android.widget.Toast
import android.widget.VideoView
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.core.content.FileProvider
import com.rsmoviespot.domain.models.InputMode
import com.rsmoviespot.domain.models.VideoLanguage
import com.rsmoviespot.domain.models.VisualStyleMode
import com.rsmoviespot.domain.models.VoiceGender
import com.rsmoviespot.domain.models.VoiceTone
import com.rsmoviespot.ui.theme.BgDark
import com.rsmoviespot.ui.theme.BorderGreen
import com.rsmoviespot.ui.theme.CancelBorder
import com.rsmoviespot.ui.theme.CancelText
import com.rsmoviespot.ui.theme.DisabledButtonBg
import com.rsmoviespot.ui.theme.ErrorRed
import com.rsmoviespot.ui.theme.NeonGreen
import com.rsmoviespot.ui.theme.ProgressTrackBg
import com.rsmoviespot.ui.theme.SelectedChipBg
import com.rsmoviespot.ui.theme.SurfaceDark
import com.rsmoviespot.ui.theme.TextMuted
import com.rsmoviespot.ui.theme.TextPrimary
import java.io.File

private val VISUAL_SOURCES = listOf(
    "ai_generated" to "AI",
    "real_photo" to "Photo",
    "video_clip" to "Clip",
    "meme_clip" to "Meme"
)

private val LAYOUT_MODES = listOf(
    "single" to "Single",
    "split" to "Split 2",
    "flip" to "Flip 2"
)

@Composable
fun MainScreen(viewModel: VideoViewModel) {
    val state by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current

    var showVideoPlayer by remember { mutableStateOf(false) }
    var showCoverDialog by remember { mutableStateOf(false) }

    val audioPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        viewModel.onCustomBgmPicked(uri)
    }

    val busy = state.isGenerating || state.isPreviewingScript
    val activeKit = state.completedScript ?: state.draftScript

    fun copyText(label: String, value: String) {
        clipboard.setText(AnnotatedString(value))
        Toast.makeText(context, "$label copied", Toast.LENGTH_SHORT).show()
    }

    fun shareFile(path: String, mimeType: String, chooserTitle: String) {
        val file = File(path)
        if (!file.exists()) {
            Toast.makeText(context, "File not found.", Toast.LENGTH_SHORT).show()
            return
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = mimeType
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(intent, chooserTitle))
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(BgDark)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 18.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        // Header
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                text = "RS MOVIE SPOT",
                color = NeonGreen,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 1.2.sp
            )
            Text(
                text = "AI Video Generator",
                color = TextPrimary,
                fontSize = 28.sp,
                fontWeight = FontWeight.ExtraBold
            )
            Text(
                text = "Paste a ready script (Exact Script) or write a topic/director prompt (AI Prompt). Movie clips, memes & photos are fetched automatically.",
                color = TextMuted,
                fontSize = 13.sp,
                lineHeight = 18.sp
            )
        }

        // Topic or Script + Trending Ideas
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "Topic or Script",
                color = TextPrimary,
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold
            )
            OutlinedButton(
                onClick = { viewModel.loadTrendingTopics() },
                enabled = !state.isLoadingTrending && !state.isGenerating,
                border = BorderStroke(1.dp, BorderGreen),
                shape = RoundedCornerShape(20.dp)
            ) {
                Text(
                    text = if (state.isLoadingTrending) "Loading…" else "Trending Ideas",
                    color = NeonGreen,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }
        }

        if (state.trendingTopics.isNotEmpty()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                state.trendingTopics.forEach { idea ->
                    StudioChip(
                        label = idea,
                        selected = state.topic == idea,
                        enabled = !busy,
                        maxWidthDp = 250,
                        onClick = { viewModel.onTopicSelectedFromTrending(idea) }
                    )
                }
            }
        }

        // Input Mode
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            InputMode.entries.forEach { mode ->
                StudioChip(
                    label = mode.label,
                    selected = state.inputMode == mode,
                    enabled = !busy,
                    onClick = { viewModel.onInputModeSelected(mode) }
                )
            }
        }

        // Topic / Script Field
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                text = state.inputMode.hint,
                color = TextMuted,
                fontSize = 12.sp
            )
            OutlinedTextField(
                value = state.topic,
                onValueChange = { viewModel.onTopicChanged(it) },
                enabled = !busy,
                placeholder = { Text(state.inputMode.hint, color = TextMuted.copy(alpha = 0.6f), fontSize = 13.sp) },
                minLines = 4,
                maxLines = 8,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = NeonGreen,
                    unfocusedBorderColor = BorderGreen,
                    focusedTextColor = TextPrimary,
                    unfocusedTextColor = TextPrimary,
                    cursorColor = NeonGreen
                )
            )
        }

        // Video Format
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Choose video format", color = TextPrimary, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                StudioChip(
                    label = "Shorts · 9:16",
                    selected = state.isShorts,
                    enabled = !busy,
                    onClick = { viewModel.onFormatSelected(true) }
                )
                StudioChip(
                    label = "YouTube · 16:9",
                    selected = !state.isShorts,
                    enabled = !busy,
                    onClick = { viewModel.onFormatSelected(false) }
                )
            }
        }

        // Visual Style & 3D Motion
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Visual Style & 3D Motion", color = TextPrimary, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                VisualStyleMode.entries.forEach { style ->
                    StudioChip(
                        label = style.label,
                        selected = state.selectedVisualStyle == style,
                        enabled = !busy,
                        onClick = { viewModel.onVisualStyleSelected(style) }
                    )
                }
            }
        }

        // Language & Voice
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Language & Voice", color = TextPrimary, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                VideoLanguage.entries.forEach { lang ->
                    StudioChip(
                        label = lang.label,
                        selected = state.selectedLanguage == lang,
                        enabled = !busy,
                        onClick = { viewModel.onLanguageSelected(lang) }
                    )
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                VoiceGender.entries.forEach { g ->
                    StudioChip(
                        label = g.label,
                        selected = state.selectedGender == g,
                        enabled = !busy,
                        onClick = { viewModel.onGenderSelected(g) }
                    )
                }
            }
        }

        // Voice Tone
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Voice Tone & Studio Polish", color = TextPrimary, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                VoiceTone.entries.forEach { tone ->
                    StudioChip(
                        label = tone.label,
                        selected = state.selectedVoiceTone == tone,
                        enabled = !busy,
                        onClick = { viewModel.onVoiceToneSelected(tone) }
                    )
                }
            }
        }

        // Background music
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Background music (optional)", color = TextPrimary, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                OutlinedButton(
                    onClick = { audioPicker.launch("audio/*") },
                    enabled = !busy,
                    border = BorderStroke(1.dp, BorderGreen),
                    shape = RoundedCornerShape(24.dp),
                    modifier = Modifier.weight(1f)
                ) {
                    Text(
                        text = state.selectedBgmName,
                        color = NeonGreen,
                        fontSize = 13.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                if (state.hasCustomBgm) {
                    OutlinedButton(
                        onClick = { viewModel.clearCustomBgm() },
                        enabled = !busy,
                        border = BorderStroke(1.dp, BorderGreen),
                        shape = RoundedCornerShape(24.dp)
                    ) {
                        Text("Reset", color = TextPrimary, fontSize = 13.sp)
                    }
                }
            }
        }

        // Primary Action Buttons
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            OutlinedButton(
                onClick = { viewModel.previewScript() },
                enabled = !busy,
                border = BorderStroke(1.dp, BorderGreen),
                shape = RoundedCornerShape(25.dp),
                modifier = Modifier
                    .weight(1f)
                    .height(50.dp)
            ) {
                Text(
                    text = when {
                        state.isPreviewingScript -> "Writing…"
                        state.draftScript != null -> "Regenerate"
                        else -> "Preview Script"
                    },
                    color = NeonGreen,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }
            Button(
                onClick = {
                    showVideoPlayer = false
                    viewModel.startGeneratingVideo()
                },
                enabled = !busy,
                shape = RoundedCornerShape(25.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = NeonGreen,
                    contentColor = Color.Black,
                    disabledContainerColor = DisabledButtonBg,
                    disabledContentColor = TextMuted
                ),
                modifier = Modifier
                    .weight(1f)
                    .height(50.dp)
            ) {
                Text(
                    text = if (state.isGenerating) "Rendering…" else "Generate Video",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold
                )
            }
        }

        // Render Progress Card
        if (state.isGenerating) {
            Surface(
                color = SurfaceDark,
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            text = state.progressText.ifBlank { "Working…" },
                            color = TextPrimary,
                            fontSize = 13.sp,
                            modifier = Modifier.weight(1f)
                        )
                        Text(
                            text = "${state.progressPercentage}%",
                            color = NeonGreen,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                    LinearProgressIndicator(
                        progress = { (state.progressPercentage.coerceIn(0, 100)) / 100f },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(8.dp)
                            .clip(RoundedCornerShape(4.dp)),
                        color = NeonGreen,
                        trackColor = ProgressTrackBg
                    )
                    OutlinedButton(
                        onClick = { viewModel.cancelGeneratingVideo() },
                        border = BorderStroke(1.dp, CancelBorder),
                        shape = RoundedCornerShape(20.dp)
                    ) {
                        Text("Cancel Render", color = CancelText, fontSize = 12.sp)
                    }
                }
            }
        }

        // Status / Error
        if (state.statusMessage.isNotBlank()) {
            val isError = "failed" in state.statusMessage.lowercase() || "error" in state.statusMessage.lowercase()
            Text(
                text = state.statusMessage,
                color = if (isError) ErrorRed else NeonGreen,
                fontSize = 13.sp
            )
        }

        // Generated Video Player + Controls
        val videoPath = state.generatedVideoPath
        if (videoPath != null) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Button(
                        onClick = { showVideoPlayer = true },
                        shape = RoundedCornerShape(24.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = NeonGreen, contentColor = Color.Black),
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("Play Video", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    }
                    OutlinedButton(
                        onClick = { shareFile(videoPath, "video/mp4", "Share RS Movie Spot Video") },
                        border = BorderStroke(1.dp, NeonGreen),
                        shape = RoundedCornerShape(24.dp),
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("Share / Save", color = NeonGreen, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                    }
                }

                if (showVideoPlayer) {
                    Surface(
                        color = SurfaceDark,
                        shape = RoundedCornerShape(14.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        AndroidView(
                            factory = { ctx ->
                                VideoView(ctx).apply {
                                    val mc = MediaController(ctx)
                                    mc.setAnchorView(this)
                                    setMediaController(mc)
                                    setVideoPath(videoPath)
                                    start()
                                }
                            },
                            update = { view ->
                                if (view.tag != videoPath) {
                                    view.tag = videoPath
                                    view.setVideoPath(videoPath)
                                    view.start()
                                }
                            },
                            modifier = Modifier
                                .fillMaxWidth()
                                .aspectRatio(if (state.isShorts) 9f / 16f else 16f / 9f)
                        )
                    }
                }
            }
        }

        // Cover Thumbnail Card
        val thumbPath = state.generatedThumbnailPath
        if (thumbPath != null) {
            Surface(
                color = SurfaceDark,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier.padding(12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Cover Thumbnail Ready", color = NeonGreen, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        Text("Tap View Cover to preview or share", color = TextMuted, fontSize = 11.sp)
                    }
                    OutlinedButton(
                        onClick = { showCoverDialog = true },
                        border = BorderStroke(1.dp, BorderGreen),
                        shape = RoundedCornerShape(18.dp)
                    ) {
                        Text("View Cover", color = NeonGreen, fontSize = 12.sp)
                    }
                }
            }
        }

        // YouTube Upload Kit Card
        if (activeKit != null && (activeKit.youtube_title.isNotBlank() || activeKit.youtube_description.isNotBlank() || activeKit.youtube_hashtags.isNotBlank() || activeKit.pinned_comment.isNotBlank())) {
            val fullDesc = listOf(activeKit.youtube_description.trim(), activeKit.youtube_hashtags.trim())
                .filter { it.isNotEmpty() }
                .joinToString("\n\n")
            Surface(
                color = SurfaceDark,
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text("YouTube Upload Kit", color = NeonGreen, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                    if (activeKit.youtube_title.isNotBlank()) {
                        Text("Title: ${activeKit.youtube_title}", color = TextPrimary, fontSize = 12.sp)
                    }
                    if (fullDesc.isNotBlank()) {
                        Text("Description: $fullDesc", color = TextMuted, fontSize = 11.sp, maxLines = 5, overflow = TextOverflow.Ellipsis)
                    }
                    if (activeKit.pinned_comment.isNotBlank()) {
                        Text("Pinned Comment: ${activeKit.pinned_comment}", color = TextMuted, fontSize = 11.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        if (activeKit.youtube_title.isNotBlank()) {
                            OutlinedButton(
                                onClick = { copyText("YouTube Title", activeKit.youtube_title) },
                                border = BorderStroke(1.dp, BorderGreen),
                                shape = RoundedCornerShape(18.dp),
                                modifier = Modifier.weight(1f)
                            ) {
                                Text("Copy Title", color = NeonGreen, fontSize = 11.sp)
                            }
                        }
                        if (fullDesc.isNotBlank()) {
                            OutlinedButton(
                                onClick = { copyText("YouTube Description", fullDesc) },
                                border = BorderStroke(1.dp, BorderGreen),
                                shape = RoundedCornerShape(18.dp),
                                modifier = Modifier.weight(1f)
                            ) {
                                Text("Copy Desc", color = NeonGreen, fontSize = 11.sp)
                            }
                        }
                        if (activeKit.pinned_comment.isNotBlank()) {
                            OutlinedButton(
                                onClick = { copyText("Pinned Comment", activeKit.pinned_comment) },
                                border = BorderStroke(1.dp, BorderGreen),
                                shape = RoundedCornerShape(18.dp),
                                modifier = Modifier.weight(1f)
                            ) {
                                Text("Copy Pin", color = NeonGreen, fontSize = 11.sp)
                            }
                        }
                    }
                }
            }
        }

        // Editable Script Preview Scenes
        val draft = state.draftScript
        if (draft != null) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    text = "Script Preview (${draft.slabs.size} scenes · ${draft.voice_name})",
                    color = NeonGreen,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold
                )
                draft.slabs.forEachIndexed { idx, slab ->
                    Surface(
                        color = SurfaceDark,
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(
                            modifier = Modifier.padding(12.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Text(
                                text = "Scene ${idx + 1} · ${slab.voice_emotion} · ${slab.sfx_cue}",
                                color = TextMuted,
                                fontSize = 12.sp
                            )
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .horizontalScroll(rememberScrollState()),
                                horizontalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                VISUAL_SOURCES.forEach { (key, label) ->
                                    StudioChip(
                                        label = label,
                                        selected = slab.visual_source.equals(key, ignoreCase = true),
                                        enabled = !state.isGenerating,
                                        onClick = {
                                            viewModel.updateSlab(idx) { target ->
                                                val fb = if (key != "ai_generated" && target.real_photo_query.isBlank()) {
                                                    state.topic.trim().take(60)
                                                } else target.real_photo_query
                                                target.copy(visual_source = key, real_photo_query = fb)
                                            }
                                        }
                                    )
                                }
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                LAYOUT_MODES.forEach { (key, label) ->
                                    StudioChip(
                                        label = label,
                                        selected = slab.layout_mode.equals(key, ignoreCase = true),
                                        enabled = !state.isGenerating,
                                        onClick = {
                                            viewModel.updateSlab(idx) { target ->
                                                val s2 = if (key != "single" && target.visual_source_2.isBlank()) "ai_generated" else target.visual_source_2
                                                val p2 = if (key != "single" && target.image_prompt_2.isBlank()) target.image_prompt else target.image_prompt_2
                                                target.copy(layout_mode = key, visual_source_2 = s2, image_prompt_2 = p2)
                                            }
                                        }
                                    )
                                }
                            }
                            if (!slab.visual_source.equals("ai_generated", ignoreCase = true)) {
                                OutlinedTextField(
                                    value = slab.real_photo_query,
                                    onValueChange = { v -> viewModel.updateSlab(idx) { it.copy(real_photo_query = v) } },
                                    label = { Text("Internet query (photo / clip / meme)", fontSize = 11.sp, color = TextMuted) },
                                    enabled = !state.isGenerating,
                                    singleLine = true,
                                    modifier = Modifier.fillMaxWidth(),
                                    colors = OutlinedTextFieldDefaults.colors(
                                        focusedBorderColor = NeonGreen,
                                        unfocusedBorderColor = BorderGreen,
                                        focusedTextColor = TextPrimary,
                                        unfocusedTextColor = TextPrimary
                                    )
                                )
                            }
                            OutlinedTextField(
                                value = slab.stat_badge,
                                onValueChange = { v -> viewModel.updateSlab(idx) { it.copy(stat_badge = v) } },
                                label = { Text("Stat Badge (optional e.g. ₹500 Cr)", fontSize = 11.sp, color = TextMuted) },
                                enabled = !state.isGenerating,
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedBorderColor = NeonGreen,
                                    unfocusedBorderColor = BorderGreen,
                                    focusedTextColor = TextPrimary,
                                    unfocusedTextColor = TextPrimary
                                )
                            )
                            OutlinedTextField(
                                value = slab.voiceover_text,
                                onValueChange = { v -> viewModel.updateSlab(idx) { it.copy(voiceover_text = v) } },
                                label = { Text("Voiceover", fontSize = 11.sp, color = TextMuted) },
                                enabled = !state.isGenerating,
                                minLines = 2,
                                maxLines = 4,
                                modifier = Modifier.fillMaxWidth(),
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedBorderColor = NeonGreen,
                                    unfocusedBorderColor = BorderGreen,
                                    focusedTextColor = TextPrimary,
                                    unfocusedTextColor = TextPrimary
                                )
                            )
                        }
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(24.dp))
    }

    val dialogThumbPath = state.generatedThumbnailPath
    if (showCoverDialog && dialogThumbPath != null) {
        val bmp = remember(dialogThumbPath) { BitmapFactory.decodeFile(dialogThumbPath) }
        Dialog(onDismissRequest = { showCoverDialog = false }) {
            Surface(
                color = SurfaceDark,
                shape = RoundedCornerShape(14.dp),
                border = BorderStroke(1.dp, BorderGreen)
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Cover Thumbnail", color = NeonGreen, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                        TextButton(onClick = { showCoverDialog = false }) {
                            Text("Close", color = TextMuted, fontSize = 12.sp)
                        }
                    }
                    if (bmp != null) {
                        Image(
                            bitmap = bmp.asImageBitmap(),
                            contentDescription = "Cover Thumbnail",
                            contentScale = ContentScale.Fit,
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(320.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(Color.Black)
                        )
                    }
                    Button(
                        onClick = { shareFile(dialogThumbPath, "image/jpeg", "Share Cover Thumbnail") },
                        shape = RoundedCornerShape(24.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = NeonGreen, contentColor = Color.Black),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Share / Save Cover JPG", fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}

@Composable
private fun StudioChip(
    label: String,
    selected: Boolean,
    enabled: Boolean,
    maxWidthDp: Int? = null,
    onClick: () -> Unit
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        color = if (selected) SelectedChipBg else SurfaceDark,
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, if (selected) NeonGreen else BorderGreen),
        modifier = if (maxWidthDp != null) Modifier.widthIn(max = maxWidthDp.dp) else Modifier
    ) {
        Box(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
            Text(
                text = label,
                color = if (selected) NeonGreen else TextPrimary,
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}
