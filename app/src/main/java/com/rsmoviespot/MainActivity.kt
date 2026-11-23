package com.rsmoviespot

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import com.rsmoviespot.ui.MainScreen
import com.rsmoviespot.ui.VideoViewModel
import com.rsmoviespot.ui.theme.RSMovieSpotTheme

class MainActivity : ComponentActivity() {
    private val viewModel: VideoViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            RSMovieSpotTheme {
                MainScreen(viewModel = viewModel)
            }
        }
    }
}
