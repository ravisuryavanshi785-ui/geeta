package com.rsmoviespot.ui

import android.app.Application
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.rsmoviespot.data.api.repository.VideoRepository
import com.rsmoviespot.domain.models.ContentMode
import com.rsmoviespot.domain.models.InputMode
import com.rsmoviespot.domain.models.MainUiState
import com.rsmoviespot.domain.models.VideoLanguage
import com.rsmoviespot.domain.models.VideoSlab
import com.rsmoviespot.domain.models.VisualStyleMode
import com.rsmoviespot.domain.models.VoiceGender
import com.rsmoviespot.domain.models.VoiceTone
import com.rsmoviespot.service.VideoRenderEngine
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class VideoViewModel(application: Application) : AndroidViewModel(application) {
    private val repository = VideoRepository()
    private val renderEngine = VideoRenderEngine(application.applicationContext, repository)

    private val _uiState = MutableStateFlow(MainUiState())
    val uiState: StateFlow<MainUiState> = _uiState.asStateFlow()

    private var customBgmUri: Uri? = null
    private var renderJob: Job? = null

    fun onTopicChanged(value: String) {
        _uiState.update { it.copy(topic = value, draftScript = null) }
    }

    fun onContentModeSelected(mode: ContentMode) {
        _uiState.update { it.copy(contentMode = mode, draftScript = null) }
    }

    fun onInputModeSelected(mode: InputMode) {
        _uiState.update { it.copy(inputMode = mode, draftScript = null) }
    }

    fun onTopicSelectedFromTrending(idea: String) {
        _uiState.update {
            it.copy(
                topic = idea,
                contentMode = ContentMode.REVIEW,
                inputMode = InputMode.AI_PROMPT,
                draftScript = null,
                statusMessage = ""
            )
        }
    }

    fun onFormatSelected(isShorts: Boolean) {
        _uiState.update { it.copy(isShorts = isShorts, draftScript = null) }
    }

    fun onLanguageSelected(language: VideoLanguage) {
        _uiState.update { it.copy(selectedLanguage = language, draftScript = null) }
    }

    fun onGenderSelected(gender: VoiceGender) {
        _uiState.update { it.copy(selectedGender = gender, draftScript = null) }
    }

    fun onVoiceToneSelected(tone: VoiceTone) {
        _uiState.update { it.copy(selectedVoiceTone = tone, draftScript = null) }
    }

    fun onVisualStyleSelected(style: VisualStyleMode) {
        _uiState.update { it.copy(selectedVisualStyle = style, draftScript = null) }
    }

    fun onCustomBgmPicked(uri: Uri?) {
        if (uri == null) return
        customBgmUri = uri
        val name = resolveFileName(uri) ?: "Custom Audio"
        _uiState.update { it.copy(selectedBgmName = name, hasCustomBgm = true) }
    }

    fun clearCustomBgm() {
        customBgmUri = null
        _uiState.update { it.copy(selectedBgmName = "Built-in Cinematic BGM", hasCustomBgm = false) }
    }

    fun onSceneCustomMediaPicked(index: Int, panel: Int, uri: Uri?) {
        if (uri == null) return
        val resolver = getApplication<Application>().contentResolver
        runCatching {
            resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val mime = resolver.getType(uri).orEmpty().lowercase()
        val fileName = resolveFileName(uri).orEmpty().lowercase()
        val isVideo = mime.startsWith("video/") ||
            fileName.endsWith(".mp4") ||
            fileName.endsWith(".mov") ||
            fileName.endsWith(".mkv") ||
            fileName.endsWith(".webm") ||
            fileName.endsWith(".m4v")
        if (panel == 2 && isVideo) {
            _uiState.update { it.copy(statusMessage = "Panel 2 supports custom images; use Panel 1 for custom video clips.") }
            return
        }
        val mediaType = if (isVideo) "video" else "image"
        updateSlab(index) { slab ->
            if (panel == 2) {
                slab.copy(customMediaUri2 = uri.toString(), customMediaType2 = mediaType)
            } else {
                slab.copy(customMediaUri = uri.toString(), customMediaType = mediaType)
            }
        }
    }

    fun clearSceneCustomMedia(index: Int, panel: Int) {
        updateSlab(index) { slab ->
            if (panel == 2) {
                slab.copy(customMediaUri2 = "", customMediaType2 = "")
            } else {
                slab.copy(customMediaUri = "", customMediaType = "")
            }
        }
    }

    fun resolveUriDisplayName(uriString: String): String {
        if (uriString.isBlank()) return ""
        return runCatching { resolveFileName(Uri.parse(uriString)) }.getOrNull() ?: "Custom Media"
    }

    fun loadTrendingTopics() {
        val current = _uiState.value
        if (current.isLoadingTrending || current.isGenerating) return
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingTrending = true) }
            try {
                val topics = repository.fetchTrendingMovieTopics()
                _uiState.update {
                    it.copy(
                        isLoadingTrending = false,
                        trendingTopics = topics,
                        statusMessage = if (topics.isEmpty()) "Could not load trending movie news right now." else ""
                    )
                }
            } catch (err: Throwable) {
                _uiState.update {
                    it.copy(
                        isLoadingTrending = false,
                        statusMessage = "Trending fetch failed: ${err.message ?: "Unknown error"}"
                    )
                }
            }
        }
    }

    fun previewScript() {
        val current = _uiState.value
        if (current.isGenerating || current.isPreviewingScript) return
        val clean = current.topic.trim()
        if (clean.isEmpty()) {
            _uiState.update { it.copy(statusMessage = "Enter a topic or script before previewing.") }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isPreviewingScript = true, statusMessage = "", draftScript = null) }
            try {
                val script = repository.generateScript(
                    topic = clean,
                    isShorts = current.isShorts,
                    language = current.selectedLanguage,
                    voiceGender = current.selectedGender,
                    inputMode = current.inputMode,
                    voiceTone = current.selectedVoiceTone,
                    visualStyle = current.selectedVisualStyle,
                    contentMode = current.contentMode
                )
                _uiState.update { it.copy(isPreviewingScript = false, draftScript = script) }
            } catch (err: Throwable) {
                _uiState.update {
                    it.copy(
                        isPreviewingScript = false,
                        statusMessage = "Script error: ${err.message ?: "Unknown error"}"
                    )
                }
            }
        }
    }

    fun updateSlab(index: Int, updater: (VideoSlab) -> VideoSlab) {
        _uiState.update { state ->
            val script = state.draftScript ?: return@update state
            if (index !in script.slabs.indices) return@update state
            val mutable = script.slabs.toMutableList()
            mutable[index] = updater(mutable[index])
            state.copy(draftScript = script.copy(slabs = mutable))
        }
    }

    fun startGeneratingVideo() {
        val current = _uiState.value
        if (current.isGenerating || current.isPreviewingScript) return
        val clean = current.topic.trim()
        if (clean.isEmpty()) {
            _uiState.update { it.copy(statusMessage = "Enter a topic or script before generating a video.") }
            return
        }

        renderJob?.cancel()
        renderJob = viewModelScope.launch {
            _uiState.update {
                it.copy(
                    isGenerating = true,
                    progressText = "Starting video generation…",
                    progressPercentage = 0,
                    statusMessage = "",
                    generatedVideoPath = null,
                    generatedThumbnailPath = null,
                    completedScript = null
                )
            }
            try {
                val result = renderEngine.renderVideo(
                    topic = clean,
                    isShorts = current.isShorts,
                    customBgmUri = customBgmUri,
                    preGeneratedScript = current.draftScript,
                    language = current.selectedLanguage,
                    voiceGender = current.selectedGender,
                    voiceTone = current.selectedVoiceTone,
                    visualStyle = current.selectedVisualStyle,
                    inputMode = current.inputMode,
                    contentMode = current.contentMode,
                    onProgress = { pct, text ->
                        _uiState.update {
                            it.copy(progressPercentage = pct.coerceIn(0, 100), progressText = text)
                        }
                    }
                )
                _uiState.update {
                    it.copy(
                        isGenerating = false,
                        progressPercentage = 100,
                        progressText = "Video ready!",
                        statusMessage = "Video generated successfully!",
                        generatedVideoPath = result.videoFile.absolutePath,
                        generatedThumbnailPath = result.thumbnailFile?.absolutePath,
                        completedScript = result.script
                    )
                }
            } catch (_: CancellationException) {
                _uiState.update {
                    it.copy(
                        isGenerating = false,
                        progressText = "",
                        statusMessage = "Video generation cancelled."
                    )
                }
            } catch (err: Throwable) {
                _uiState.update {
                    it.copy(
                        isGenerating = false,
                        statusMessage = "Generation failed: ${err.message ?: "Unknown error"}"
                    )
                }
            }
        }
    }

    fun cancelGeneratingVideo() {
        renderJob?.cancel()
        renderJob = null
        _uiState.update {
            it.copy(
                isGenerating = false,
                progressText = "",
                statusMessage = "Video generation cancelled."
            )
        }
    }

    private fun resolveFileName(uri: Uri): String? {
        return runCatching {
            getApplication<Application>().contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (idx >= 0 && cursor.moveToFirst()) cursor.getString(idx) else null
            }
        }.getOrNull()
    }
}
