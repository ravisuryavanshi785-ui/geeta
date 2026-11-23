package com.rsmoviespot.ui

import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.widget.MediaController
import android.widget.Toast
import android.widget.VideoView
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.runtime.mutableIntStateOf
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
import com.rsmoviespot.domain.models.ContentMode
import com.rsmoviespot.domain.models.InputMode
import com.rsmoviespot.domain.models.VideoLanguage
import com.rsmoviespot.domain.models.VisualStyleMode
import com.rsmoviespot.domain.models.VoiceGender
import com.rsmoviespot.domain.models.VoiceTone
import com.rsmoviespot.ui.theme.BgDark
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

private val HairlineBorder = Color(0xFF252E29)
private val InnerFieldBg = Color(0xFF0C100E)

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MainScreen(viewModel: VideoViewModel) {
    val state by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current

    var showVideoPlayer by remember { mutableStateOf(false) }
    var showCoverDialog by remember { mutableStateOf(false) }
    var showAudioSettings by remember { mutableStateOf(false) }
    var styleDropdownOpen by remember { mutableStateOf(false) }
    var languageDropdownOpen by remember { mutableStateOf(false) }
    var toneDropdownOpen by remember { mutableStateOf(false) }
    var pendingScenePickIndex by remember { mutableIntStateOf(-1) }
    var pendingScenePickPanel by remember { mutableIntStateOf(1) }

    val audioPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        viewModel.onCustomBgmPicked(uri)
    }

    val sceneMediaPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null && pendingScenePickIndex >= 0) {
            viewModel.onSceneCustomMediaPicked(pendingScenePickIndex, pendingScenePickPanel, uri)
        }
        pendingScenePickIndex = -1
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
            .padding(horizontal = 16.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Clean Brand Header
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                text = "RS Movie Spot",
                color = TextPrimary,
                fontSize = 24.sp,
                fontWeight = FontWeight.ExtraBold
            )
            Text(
                text = "Pick a mode, write a topic or ready script, and render Shorts or YouTube videos.",
                color = TextMuted,
                fontSize = 13.sp,
                lineHeight = 18.sp
            )
        }

        // Content Mode (Clean Wrapping FlowRow — no clipped scrolling)
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Content Mode", color = TextPrimary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                ContentMode.entries.forEach { mode ->
                    StudioChip(
                        label = mode.label,
                        selected = state.contentMode == mode,
                        enabled = !busy,
                        onClick = { viewModel.onContentModeSelected(mode) }
                    )
                }
            }
        }

        // Script / Topic Card
        val topicHint = when {
            state.inputMode == InputMode.EXACT_SCRIPT -> state.inputMode.hint
            state.contentMode != ContentMode.AUTO -> state.contentMode.hint
            else -> state.inputMode.hint
        }

        Surface(
            color = SurfaceDark,
            shape = RoundedCornerShape(16.dp),
            border = BorderStroke(1.dp, HairlineBorder),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "Topic or Script",
                        color = TextPrimary,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    TextButton(
                        onClick = { viewModel.loadTrendingTopics() },
                        enabled = !state.isLoadingTrending && !state.isGenerating
                    ) {
                        Text(
                            text = if (state.isLoadingTrending) "Loading…" else "Trending Ideas",
                            color = NeonGreen,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                }

                // Clean Segmented Input Mode
                Surface(
                    color = InnerFieldBg,
                    shape = RoundedCornerShape(10.dp),
                    border = BorderStroke(1.dp, HairlineBorder),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(4.dp),
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        InputMode.entries.forEach { mode ->
                            val selected = state.inputMode == mode
                            Surface(
                                onClick = { viewModel.onInputModeSelected(mode) },
                                enabled = !busy,
                                color = if (selected) Color(0xFF1D2721) else Color.Transparent,
                                shape = RoundedCornerShape(8.dp),
                                modifier = Modifier.weight(1f)
                            ) {
                                Box(
                                    contentAlignment = Alignment.Center,
                                    modifier = Modifier.padding(vertical = 8.dp, horizontal = 4.dp)
                                ) {
                                    Text(
                                        text = mode.label,
                                        color = if (selected) NeonGreen else TextMuted,
                                        fontSize = 12.sp,
                                        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }
                            }
                        }
                    }
                }

                if (state.trendingTopics.isNotEmpty()) {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        state.trendingTopics.forEach { idea ->
                            StudioChip(
                                label = idea,
                                selected = state.topic == idea,
                                enabled = !busy,
                                maxWidthDp = 260,
                                onClick = { viewModel.onTopicSelectedFromTrending(idea) }
                            )
                        }
                    }
                }

                OutlinedTextField(
                    value = state.topic,
                    onValueChange = { viewModel.onTopicChanged(it) },
                    enabled = !busy,
                    placeholder = { Text(topicHint, color = TextMuted.copy(alpha = 0.6f), fontSize = 13.sp) },
                    minLines = 4,
                    maxLines = 8,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = NeonGreen.copy(alpha = 0.7f),
                        unfocusedBorderColor = HairlineBorder,
                        focusedContainerColor = InnerFieldBg,
                        unfocusedContainerColor = InnerFieldBg,
                        focusedTextColor = TextPrimary,
                        unfocusedTextColor = TextPrimary,
                        cursorColor = NeonGreen
                    )
                )

                Text(
                    text = topicHint,
                    color = TextMuted,
                    fontSize = 12.sp,
                    lineHeight = 16.sp
                )
            }
        }

        // Production Settings Card (Format + Clean Dropdowns + Collapsible Audio)
        Surface(
            color = SurfaceDark,
            shape = RoundedCornerShape(16.dp),
            border = BorderStroke(1.dp, HairlineBorder),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text("Video Format", color = TextPrimary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)

                Surface(
                    color = InnerFieldBg,
                    shape = RoundedCornerShape(10.dp),
                    border = BorderStroke(1.dp, HairlineBorder),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(4.dp),
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        listOf(true to "Shorts · 9:16", false to "YouTube · 16:9").forEach { (shortsVal, label) ->
                            val selected = state.isShorts == shortsVal
                            Surface(
                                onClick = { viewModel.onFormatSelected(shortsVal) },
                                enabled = !busy,
                                color = if (selected) Color(0xFF1D2721) else Color.Transparent,
                                shape = RoundedCornerShape(8.dp),
                                modifier = Modifier.weight(1f)
                            ) {
                                Box(
                                    contentAlignment = Alignment.Center,
                                    modifier = Modifier.padding(vertical = 10.dp)
                                ) {
                                    Text(
                                        text = label,
                                        color = if (selected) NeonGreen else TextMuted,
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.SemiBold
                                    )
                                }
                            }
                        }
                    }
                }

                // Clean Visual Style & Language Dropdown Row
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Box(modifier = Modifier.weight(1f)) {
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text("Visual Style", color = TextMuted, fontSize = 12.sp)
                            Surface(
                                onClick = { if (!busy) styleDropdownOpen = true },
                                color = InnerFieldBg,
                                shape = RoundedCornerShape(10.dp),
                                border = BorderStroke(1.dp, HairlineBorder),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(
                                    text = "${state.selectedVisualStyle.label} ▾",
                                    color = TextPrimary,
                                    fontSize = 13.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 12.dp)
                                )
                            }
                        }
                        DropdownMenu(
                            expanded = styleDropdownOpen,
                            onDismissRequest = { styleDropdownOpen = false }
                        ) {
                            VisualStyleMode.entries.forEach { style ->
                                DropdownMenuItem(
                                    text = {
                                        Text(
                                            text = style.label,
                                            color = if (state.selectedVisualStyle == style) NeonGreen else TextPrimary
                                        )
                                    },
                                    onClick = {
                                        styleDropdownOpen = false
                                        viewModel.onVisualStyleSelected(style)
                                    }
                                )
                            }
                        }
                    }

                    Box(modifier = Modifier.weight(1f)) {
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text("Language", color = TextMuted, fontSize = 12.sp)
                            Surface(
                                onClick = { if (!busy) languageDropdownOpen = true },
                                color = InnerFieldBg,
                                shape = RoundedCornerShape(10.dp),
                                border = BorderStroke(1.dp, HairlineBorder),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(
                                    text = "${state.selectedLanguage.label} ▾",
                                    color = TextPrimary,
                                    fontSize = 13.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 12.dp)
                                )
                            }
                        }
                        DropdownMenu(
                            expanded = languageDropdownOpen,
                            onDismissRequest = { languageDropdownOpen = false }
                        ) {
                            VideoLanguage.entries.forEach { lang ->
                                DropdownMenuItem(
                                    text = {
                                        Text(
                                            text = lang.label,
                                            color = if (state.selectedLanguage == lang) NeonGreen else TextPrimary
                                        )
                                    },
                                    onClick = {
                                        languageDropdownOpen = false
                                        viewModel.onLanguageSelected(lang)
                                    }
                                )
                            }
                        }
                    }
                }

                HorizontalDivider(color = Color.White.copy(alpha = 0.06f))

                // Collapsible Voice & Background Music Row
                val genderLabel = if (state.selectedGender == VoiceGender.FEMALE) "Female" else "Male"
                val bgmShort = if (state.hasCustomBgm) "Custom BGM" else "Built-in BGM"
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { showAudioSettings = !showAudioSettings }
                        .padding(vertical = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("Voice & Music", color = TextPrimary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    Text(
                        text = "$genderLabel · ${state.selectedVoiceTone.label} · $bgmShort ${if (showAudioSettings) "▲" else "▼"}",
                        color = TextMuted,
                        fontSize = 12.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                if (showAudioSettings) {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                            verticalAlignment = Alignment.Bottom
                        ) {
                            Column(
                                modifier = Modifier.weight(1f),
                                verticalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                Text("Voice", color = TextMuted, fontSize = 12.sp)
                                Surface(
                                    color = InnerFieldBg,
                                    shape = RoundedCornerShape(10.dp),
                                    border = BorderStroke(1.dp, HairlineBorder)
                                ) {
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(4.dp),
                                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                                    ) {
                                        VoiceGender.entries.forEach { g ->
                                            val sel = state.selectedGender == g
                                            Surface(
                                                onClick = { viewModel.onGenderSelected(g) },
                                                enabled = !busy,
                                                color = if (sel) Color(0xFF1D2721) else Color.Transparent,
                                                shape = RoundedCornerShape(8.dp),
                                                modifier = Modifier.weight(1f)
                                            ) {
                                                Box(
                                                    contentAlignment = Alignment.Center,
                                                    modifier = Modifier.padding(vertical = 9.dp)
                                                ) {
                                                    Text(
                                                        text = if (g == VoiceGender.FEMALE) "Female" else "Male",
                                                        color = if (sel) NeonGreen else TextMuted,
                                                        fontSize = 12.sp,
                                                        fontWeight = FontWeight.Medium
                                                    )
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            Box(modifier = Modifier.weight(1f)) {
                                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Text("Voice Tone", color = TextMuted, fontSize = 12.sp)
                                    Surface(
                                        onClick = { if (!busy) toneDropdownOpen = true },
                                        color = InnerFieldBg,
                                        shape = RoundedCornerShape(10.dp),
                                        border = BorderStroke(1.dp, HairlineBorder),
                                        modifier = Modifier.fillMaxWidth()
                                    ) {
                                        Text(
                                            text = "${state.selectedVoiceTone.label} ▾",
                                            color = TextPrimary,
                                            fontSize = 13.sp,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 11.dp)
                                        )
                                    }
                                }
                                DropdownMenu(
                                    expanded = toneDropdownOpen,
                                    onDismissRequest = { toneDropdownOpen = false }
                                ) {
                                    VoiceTone.entries.forEach { tone ->
                                        DropdownMenuItem(
                                            text = {
                                                Text(
                                                    text = tone.label,
                                                    color = if (state.selectedVoiceTone == tone) NeonGreen else TextPrimary
                                                )
                                            },
                                            onClick = {
                                                toneDropdownOpen = false
                                                viewModel.onVoiceToneSelected(tone)
                                            }
                                        )
                                    }
                                }
                            }
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            OutlinedButton(
                                onClick = { audioPicker.launch("audio/*") },
                                enabled = !busy,
                                border = BorderStroke(1.dp, HairlineBorder),
                                shape = RoundedCornerShape(12.dp),
                                modifier = Modifier.weight(1f)
                            ) {
                                Text(
                                    text = "Music: ${state.selectedBgmName}",
                                    color = TextPrimary,
                                    fontSize = 12.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                            if (state.hasCustomBgm) {
                                OutlinedButton(
                                    onClick = { viewModel.clearCustomBgm() },
                                    enabled = !busy,
                                    border = BorderStroke(1.dp, HairlineBorder),
                                    shape = RoundedCornerShape(12.dp)
                                ) {
                                    Text("Reset", color = TextPrimary, fontSize = 12.sp)
                                }
                            }
                        }
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
                border = BorderStroke(1.dp, Color.White.copy(alpha = 0.16f)),
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier
                    .weight(1f)
                    .height(48.dp)
            ) {
                Text(
                    text = when {
                        state.isPreviewingScript -> "Writing…"
                        state.draftScript != null -> "Regenerate"
                        else -> "Preview Scenes"
                    },
                    color = TextPrimary,
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
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = NeonGreen,
                    contentColor = Color.Black,
                    disabledContainerColor = DisabledButtonBg,
                    disabledContentColor = TextMuted
                ),
                modifier = Modifier
                    .weight(1f)
                    .height(48.dp)
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
                shape = RoundedCornerShape(16.dp),
                border = BorderStroke(1.dp, HairlineBorder),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
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
                            .height(7.dp)
                            .clip(RoundedCornerShape(4.dp)),
                        color = NeonGreen,
                        trackColor = ProgressTrackBg
                    )
                    OutlinedButton(
                        onClick = { viewModel.cancelGeneratingVideo() },
                        border = BorderStroke(1.dp, CancelBorder),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        Text("Cancel Render", color = CancelText, fontSize = 12.sp)
                    }
                }
            }
        }

        // Status / Error
        if (state.statusMessage.isNotBlank()) {
            val isError = "failed" in state.statusMessage.lowercase() || "error" in state.statusMessage.lowercase()
            Surface(
                color = if (isError) Color(0xFF281214) else Color(0xFF132616),
                shape = RoundedCornerShape(12.dp),
                border = BorderStroke(1.dp, if (isError) ErrorRed.copy(alpha = 0.4f) else NeonGreen.copy(alpha = 0.4f)),
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    text = state.statusMessage,
                    color = if (isError) ErrorRed else NeonGreen,
                    fontSize = 13.sp,
                    modifier = Modifier.padding(12.dp)
                )
            }
        }

        // Generated Video Player + Controls
        val videoPath = state.generatedVideoPath
        if (videoPath != null) {
            Surface(
                color = SurfaceDark,
                shape = RoundedCornerShape(16.dp),
                border = BorderStroke(1.dp, HairlineBorder),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Button(
                            onClick = { showVideoPlayer = true },
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = NeonGreen, contentColor = Color.Black),
                            modifier = Modifier.weight(1f)
                        ) {
                            Text("Play Video", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                        }
                        OutlinedButton(
                            onClick = { shareFile(videoPath, "video/mp4", "Share RS Movie Spot Video") },
                            border = BorderStroke(1.dp, Color.White.copy(alpha = 0.16f)),
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.weight(1f)
                        ) {
                            Text("Share / Save", color = TextPrimary, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                        }
                    }

                    if (showVideoPlayer) {
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
                                .clip(RoundedCornerShape(12.dp))
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
                shape = RoundedCornerShape(16.dp),
                border = BorderStroke(1.dp, HairlineBorder),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier.padding(14.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Cover Thumbnail Ready", color = TextPrimary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                        Text("Tap View Cover to preview or share", color = TextMuted, fontSize = 11.sp)
                    }
                    OutlinedButton(
                        onClick = { showCoverDialog = true },
                        border = BorderStroke(1.dp, HairlineBorder),
                        shape = RoundedCornerShape(10.dp)
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
                shape = RoundedCornerShape(16.dp),
                border = BorderStroke(1.dp, HairlineBorder),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text("YouTube Upload Kit", color = TextPrimary, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                    if (activeKit.youtube_title.isNotBlank()) {
                        Text("Title: ${activeKit.youtube_title}", color = TextPrimary, fontSize = 12.sp)
                    }
                    if (fullDesc.isNotBlank()) {
                        Text(fullDesc, color = TextMuted, fontSize = 11.sp, maxLines = 4, overflow = TextOverflow.Ellipsis)
                    }
                    if (activeKit.pinned_comment.isNotBlank()) {
                        Text("Pinned: ${activeKit.pinned_comment}", color = TextMuted, fontSize = 11.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        if (activeKit.youtube_title.isNotBlank()) {
                            OutlinedButton(
                                onClick = { copyText("YouTube Title", activeKit.youtube_title) },
                                border = BorderStroke(1.dp, HairlineBorder),
                                shape = RoundedCornerShape(10.dp),
                                modifier = Modifier.weight(1f)
                            ) {
                                Text("Copy Title", color = TextPrimary, fontSize = 11.sp)
                            }
                        }
                        if (fullDesc.isNotBlank()) {
                            OutlinedButton(
                                onClick = { copyText("YouTube Description", fullDesc) },
                                border = BorderStroke(1.dp, HairlineBorder),
                                shape = RoundedCornerShape(10.dp),
                                modifier = Modifier.weight(1f)
                            ) {
                                Text("Copy Desc", color = TextPrimary, fontSize = 11.sp)
                            }
                        }
                        if (activeKit.pinned_comment.isNotBlank()) {
                            OutlinedButton(
                                onClick = { copyText("Pinned Comment", activeKit.pinned_comment) },
                                border = BorderStroke(1.dp, HairlineBorder),
                                shape = RoundedCornerShape(10.dp),
                                modifier = Modifier.weight(1f)
                            ) {
                                Text("Copy Pin", color = TextPrimary, fontSize = 11.sp)
                            }
                        }
                    }
                }
            }
        }

        // Editable Scene Storyboard
        val draft = state.draftScript
        if (draft != null) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    text = "Scene Storyboard (${draft.slabs.size} scenes · ${draft.voice_name})",
                    color = TextPrimary,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold
                )
                draft.slabs.forEachIndexed { idx, slab ->
                    Surface(
                        color = SurfaceDark,
                        shape = RoundedCornerShape(16.dp),
                        border = BorderStroke(1.dp, HairlineBorder),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(
                            modifier = Modifier.padding(14.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            Text(
                                text = "Scene ${idx + 1} · ${slab.voice_emotion} · ${slab.sfx_cue}",
                                color = TextMuted,
                                fontSize = 12.sp
                            )
                            val hasCustom1 = slab.customMediaUri.isNotBlank()
                            val hasCustom2 = slab.customMediaUri2.isNotBlank()
                            val isDualPanel = !slab.layout_mode.equals("single", ignoreCase = true)
                            val custom1Name = remember(slab.customMediaUri) { viewModel.resolveUriDisplayName(slab.customMediaUri) }
                            val custom2Name = remember(slab.customMediaUri2) { viewModel.resolveUriDisplayName(slab.customMediaUri2) }
                            val custom1Thumb = remember(slab.customMediaUri, slab.customMediaType) {
                                if (slab.customMediaUri.isNotBlank() && slab.customMediaType != "video") {
                                    runCatching {
                                        context.contentResolver.openInputStream(Uri.parse(slab.customMediaUri))?.use {
                                            BitmapFactory.decodeStream(it)
                                        }
                                    }.getOrNull()
                                } else null
                            }

                            Surface(
                                color = InnerFieldBg,
                                shape = RoundedCornerShape(12.dp),
                                border = BorderStroke(1.dp, HairlineBorder),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Column(
                                    modifier = Modifier.padding(10.dp),
                                    verticalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        if (custom1Thumb != null) {
                                            Image(
                                                bitmap = custom1Thumb.asImageBitmap(),
                                                contentDescription = "Custom scene image",
                                                contentScale = ContentScale.Crop,
                                                modifier = Modifier
                                                    .size(42.dp)
                                                    .clip(RoundedCornerShape(8.dp))
                                            )
                                        }
                                        Column(modifier = Modifier.weight(1f)) {
                                            Text(
                                                text = if (hasCustom1) custom1Name else "Custom Clip or Photo (optional)",
                                                color = if (hasCustom1) NeonGreen else TextPrimary,
                                                fontSize = 12.sp,
                                                fontWeight = FontWeight.Medium,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis
                                            )
                                            Text(
                                                text = when {
                                                    hasCustom1 && slab.customMediaType == "video" -> "Custom video clip attached"
                                                    hasCustom1 -> "Custom photo attached"
                                                    else -> "Use your own clip or photo for this scene"
                                                },
                                                color = TextMuted,
                                                fontSize = 11.sp
                                            )
                                        }
                                        OutlinedButton(
                                            onClick = {
                                                pendingScenePickIndex = idx
                                                pendingScenePickPanel = 1
                                                sceneMediaPicker.launch(arrayOf("image/*", "video/*"))
                                            },
                                            enabled = !state.isGenerating,
                                            border = BorderStroke(1.dp, HairlineBorder),
                                            shape = RoundedCornerShape(8.dp)
                                        ) {
                                            Text(if (hasCustom1) "Change" else "Attach", color = TextPrimary, fontSize = 11.sp)
                                        }
                                        if (hasCustom1) {
                                            OutlinedButton(
                                                onClick = { viewModel.clearSceneCustomMedia(idx, 1) },
                                                enabled = !state.isGenerating,
                                                border = BorderStroke(1.dp, CancelBorder),
                                                shape = RoundedCornerShape(8.dp)
                                            ) {
                                                Text("Remove", color = CancelText, fontSize = 11.sp)
                                            }
                                        }
                                    }

                                    if (isDualPanel && slab.customMediaType != "video") {
                                        Row(
                                            modifier = Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                                            verticalAlignment = Alignment.CenterVertically
                                        ) {
                                            Text(
                                                text = if (hasCustom2) "Panel 2: $custom2Name" else "Panel 2 Custom Photo (optional)",
                                                color = if (hasCustom2) NeonGreen else TextMuted,
                                                fontSize = 11.sp,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis,
                                                modifier = Modifier.weight(1f)
                                            )
                                            OutlinedButton(
                                                onClick = {
                                                    pendingScenePickIndex = idx
                                                    pendingScenePickPanel = 2
                                                    sceneMediaPicker.launch(arrayOf("image/*"))
                                                },
                                                enabled = !state.isGenerating,
                                                border = BorderStroke(1.dp, HairlineBorder),
                                                shape = RoundedCornerShape(8.dp)
                                            ) {
                                                Text(if (hasCustom2) "Change" else "+ Panel 2", color = TextPrimary, fontSize = 11.sp)
                                            }
                                            if (hasCustom2) {
                                                OutlinedButton(
                                                    onClick = { viewModel.clearSceneCustomMedia(idx, 2) },
                                                    enabled = !state.isGenerating,
                                                    border = BorderStroke(1.dp, CancelBorder),
                                                    shape = RoundedCornerShape(8.dp)
                                                ) {
                                                    Text("Remove", color = CancelText, fontSize = 11.sp)
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            // Visual source segmented bar
                            Surface(
                                color = InnerFieldBg,
                                shape = RoundedCornerShape(10.dp),
                                border = BorderStroke(1.dp, HairlineBorder),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(4.dp),
                                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                                ) {
                                    VISUAL_SOURCES.forEach { (key, label) ->
                                        val selected = slab.visual_source.equals(key, ignoreCase = true)
                                        Surface(
                                            onClick = {
                                                viewModel.updateSlab(idx) { target ->
                                                    val fb = if (key != "ai_generated" && target.real_photo_query.isBlank()) {
                                                        state.topic.trim().take(60)
                                                    } else target.real_photo_query
                                                    target.copy(visual_source = key, real_photo_query = fb)
                                                }
                                            },
                                            enabled = !state.isGenerating,
                                            color = if (selected) Color(0xFF1D2721) else Color.Transparent,
                                            shape = RoundedCornerShape(8.dp),
                                            modifier = Modifier.weight(1f)
                                        ) {
                                            Box(
                                                contentAlignment = Alignment.Center,
                                                modifier = Modifier.padding(vertical = 8.dp)
                                            ) {
                                                Text(
                                                    text = label,
                                                    color = if (selected) NeonGreen else TextMuted,
                                                    fontSize = 11.sp,
                                                    fontWeight = FontWeight.Medium
                                                )
                                            }
                                        }
                                    }
                                }
                            }

                            // Layout mode segmented bar
                            Surface(
                                color = InnerFieldBg,
                                shape = RoundedCornerShape(10.dp),
                                border = BorderStroke(1.dp, HairlineBorder),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(4.dp),
                                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                                ) {
                                    LAYOUT_MODES.forEach { (key, label) ->
                                        val selected = slab.layout_mode.equals(key, ignoreCase = true)
                                        Surface(
                                            onClick = {
                                                viewModel.updateSlab(idx) { target ->
                                                    val s2 = if (key != "single" && target.visual_source_2.isBlank()) "ai_generated" else target.visual_source_2
                                                    val p2 = if (key != "single" && target.image_prompt_2.isBlank()) target.image_prompt else target.image_prompt_2
                                                    target.copy(layout_mode = key, visual_source_2 = s2, image_prompt_2 = p2)
                                                }
                                            },
                                            enabled = !state.isGenerating,
                                            color = if (selected) Color(0xFF1D2721) else Color.Transparent,
                                            shape = RoundedCornerShape(8.dp),
                                            modifier = Modifier.weight(1f)
                                        ) {
                                            Box(
                                                contentAlignment = Alignment.Center,
                                                modifier = Modifier.padding(vertical = 8.dp)
                                            ) {
                                                Text(
                                                    text = label,
                                                    color = if (selected) NeonGreen else TextMuted,
                                                    fontSize = 11.sp,
                                                    fontWeight = FontWeight.Medium
                                                )
                                            }
                                        }
                                    }
                                }
                            }

                            if (!hasCustom1 && !slab.visual_source.equals("ai_generated", ignoreCase = true)) {
                                OutlinedTextField(
                                    value = slab.real_photo_query,
                                    onValueChange = { v -> viewModel.updateSlab(idx) { it.copy(real_photo_query = v) } },
                                    label = { Text("Media search query", fontSize = 11.sp, color = TextMuted) },
                                    enabled = !state.isGenerating,
                                    singleLine = true,
                                    modifier = Modifier.fillMaxWidth(),
                                    shape = RoundedCornerShape(10.dp),
                                    colors = OutlinedTextFieldDefaults.colors(
                                        focusedBorderColor = NeonGreen.copy(alpha = 0.7f),
                                        unfocusedBorderColor = HairlineBorder,
                                        focusedContainerColor = InnerFieldBg,
                                        unfocusedContainerColor = InnerFieldBg,
                                        focusedTextColor = TextPrimary,
                                        unfocusedTextColor = TextPrimary
                                    )
                                )
                            }
                            OutlinedTextField(
                                value = slab.stat_badge,
                                onValueChange = { v -> viewModel.updateSlab(idx) { it.copy(stat_badge = v) } },
                                label = { Text("Badge text (optional)", fontSize = 11.sp, color = TextMuted) },
                                enabled = !state.isGenerating,
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(10.dp),
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedBorderColor = NeonGreen.copy(alpha = 0.7f),
                                    unfocusedBorderColor = HairlineBorder,
                                    focusedContainerColor = InnerFieldBg,
                                    unfocusedContainerColor = InnerFieldBg,
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
                                shape = RoundedCornerShape(10.dp),
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedBorderColor = NeonGreen.copy(alpha = 0.7f),
                                    unfocusedBorderColor = HairlineBorder,
                                    focusedContainerColor = InnerFieldBg,
                                    unfocusedContainerColor = InnerFieldBg,
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
                shape = RoundedCornerShape(16.dp),
                border = BorderStroke(1.dp, HairlineBorder)
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
                        Text("Cover Thumbnail", color = TextPrimary, fontSize = 14.sp, fontWeight = FontWeight.Bold)
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
                                .clip(RoundedCornerShape(10.dp))
                                .background(Color.Black)
                        )
                    }
                    Button(
                        onClick = { shareFile(dialogThumbPath, "image/jpeg", "Share Cover Thumbnail") },
                        shape = RoundedCornerShape(12.dp),
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
        shape = RoundedCornerShape(10.dp),
        border = BorderStroke(1.dp, if (selected) NeonGreen.copy(alpha = 0.75f) else HairlineBorder),
        modifier = if (maxWidthDp != null) Modifier.widthIn(max = maxWidthDp.dp) else Modifier
    ) {
        Box(modifier = Modifier.padding(horizontal = 12.dp, vertical = 9.dp)) {
            Text(
                text = label,
                color = if (selected) NeonGreen else TextPrimary,
                fontSize = 12.sp,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}
