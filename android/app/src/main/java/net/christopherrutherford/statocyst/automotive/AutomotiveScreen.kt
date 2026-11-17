package net.christopherrutherford.statocyst.automotive

import android.text.format.DateUtils
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.DirectionsCar
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import coil.compose.AsyncImage

@Composable
fun AutomotiveApp(viewModel: AutomotiveViewModel = viewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    StatocystAutomotiveTheme {
        AutomotiveRoot(
            state = state,
            onSelectTab = viewModel::selectTab,
            onPlayMix = viewModel::playMix,
            onPlayRecent = viewModel::playRecent,
            onPlayFavorite = viewModel::playFavorite,
            onPlayTrack = viewModel::playLibraryTrack,
            onPlayRadio = viewModel::playRadio,
            onTogglePlay = viewModel::togglePlay,
            onNext = viewModel::next,
            onPrevious = viewModel::previous,
            onToggleFavorite = viewModel::toggleFavorite,
        )
    }
}

@Composable
private fun AutomotiveRoot(
    state: AutomotiveUiState,
    onSelectTab: (AutomotiveTab) -> Unit,
    onPlayMix: (AutomotiveMix) -> Unit,
    onPlayRecent: (AutomotiveRecent) -> Unit,
    onPlayFavorite: (AutomotiveTrack) -> Unit,
    onPlayTrack: (AutomotiveTrack) -> Unit,
    onPlayRadio: (AutomotiveTrack) -> Unit,
    onTogglePlay: () -> Unit,
    onNext: () -> Unit,
    onPrevious: () -> Unit,
    onToggleFavorite: () -> Unit,
) {
    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.linearGradient(
                    listOf(
                        AutomotiveColors.Abyss800,
                        AutomotiveColors.Abyss900,
                        AutomotiveColors.Abyss,
                    )
                )
            )
            .padding(14.dp),
    ) {
        val compact = maxWidth < 900.dp
        if (compact) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Sidebar(
                        selected = state.tab,
                        onSelect = onSelectTab,
                        compact = true,
                        modifier = Modifier.width(140.dp).fillMaxHeight(),
                    )
                    MainContent(
                        state = state,
                        onPlayMix = onPlayMix,
                        onPlayRecent = onPlayRecent,
                        onPlayFavorite = onPlayFavorite,
                        onPlayTrack = onPlayTrack,
                        onPlayRadio = onPlayRadio,
                        modifier = Modifier.weight(1f).fillMaxHeight(),
                    )
                }
                CompactNowPlaying(
                    state = state,
                    onTogglePlay = onTogglePlay,
                    onNext = onNext,
                    onPrevious = onPrevious,
                    onToggleFavorite = onToggleFavorite,
                )
            }
        } else {
            Row(
                modifier = Modifier.fillMaxSize(),
                horizontalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                Sidebar(
                    selected = state.tab,
                    onSelect = onSelectTab,
                    modifier = Modifier.width(168.dp).fillMaxHeight(),
                )
                MainContent(
                    state = state,
                    onPlayMix = onPlayMix,
                    onPlayRecent = onPlayRecent,
                    onPlayFavorite = onPlayFavorite,
                    onPlayTrack = onPlayTrack,
                    onPlayRadio = onPlayRadio,
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                )
                NowPlayingPanel(
                    state = state,
                    onTogglePlay = onTogglePlay,
                    onNext = onNext,
                    onPrevious = onPrevious,
                    onToggleFavorite = onToggleFavorite,
                    modifier = Modifier.width(300.dp).fillMaxHeight(),
                )
            }
        }
    }
}

@Composable
private fun Sidebar(
    selected: AutomotiveTab,
    onSelect: (AutomotiveTab) -> Unit,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(22.dp))
            .background(AutomotiveColors.Panel)
            .border(1.dp, AutomotiveColors.Line, RoundedCornerShape(22.dp))
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(34.dp)
                    .clip(CircleShape)
                    .background(
                        Brush.radialGradient(
                            listOf(
                                AutomotiveColors.CyanSoft,
                                AutomotiveColors.CyanDeep,
                                AutomotiveColors.VioletDeep,
                            )
                        )
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Text("S", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = AutomotiveColors.Abyss)
            }
            Column {
                Text(
                    "Statocyst",
                    style = MaterialTheme.typography.titleMedium,
                    color = AutomotiveColors.Text,
                )
                if (!compact) {
                    Text(
                        "Bathypelagic audio",
                        style = MaterialTheme.typography.labelLarge,
                        color = AutomotiveColors.MutedDim,
                    )
                }
            }
        }

        Spacer(Modifier.height(12.dp))
        NavItem("For you", Icons.Filled.Home, selected == AutomotiveTab.FOR_YOU) {
            onSelect(AutomotiveTab.FOR_YOU)
        }
        NavItem("Library", Icons.Filled.Menu, selected == AutomotiveTab.LIBRARY) {
            onSelect(AutomotiveTab.LIBRARY)
        }
        NavItem("Favorites", Icons.Filled.Favorite, selected == AutomotiveTab.FAVORITES) {
            onSelect(AutomotiveTab.FAVORITES)
        }
        NavItem("Radio", Icons.Filled.PlayArrow, selected == AutomotiveTab.RADIO) {
            onSelect(AutomotiveTab.RADIO)
        }

        Spacer(Modifier.weight(1f))
        Text(
            "Local catalog · on this car",
            style = MaterialTheme.typography.labelLarge,
            color = AutomotiveColors.MutedDim,
        )
    }
}

@Composable
private fun NavItem(
    label: String,
    icon: ImageVector,
    active: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (active) Color(0x1238E1FF) else Color.Transparent)
            .border(
                1.dp,
                if (active) AutomotiveColors.LineStrong else Color.Transparent,
                RoundedCornerShape(12.dp),
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = if (active) AutomotiveColors.Cyan else AutomotiveColors.MutedDim,
            modifier = Modifier.size(20.dp),
        )
        Text(
            label,
            style = MaterialTheme.typography.bodyLarge,
            color = if (active) AutomotiveColors.Cyan else AutomotiveColors.Muted,
        )
    }
}

@Composable
private fun MainContent(
    state: AutomotiveUiState,
    onPlayMix: (AutomotiveMix) -> Unit,
    onPlayRecent: (AutomotiveRecent) -> Unit,
    onPlayFavorite: (AutomotiveTrack) -> Unit,
    onPlayTrack: (AutomotiveTrack) -> Unit,
    onPlayRadio: (AutomotiveTrack) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (state.drivingRestricted) {
            StatusBanner(
                Icons.Filled.DirectionsCar,
                "Driving",
                "Browsing is limited. Park to open the full library.",
            )
        }
        if (state.offline) {
            StatusBanner(
                Icons.Filled.CloudOff,
                "Offline",
                "Local and downloaded audio only.",
            )
        }
        if (state.recommendationsStale) {
            StatusBanner(
                Icons.Filled.Refresh,
                "Mix may be out of date",
                "Open Statocyst on your phone to refresh For you.",
            )
        }
        when (state.tab) {
            AutomotiveTab.FOR_YOU -> ForYouTab(state, onPlayMix, onPlayRecent)
            AutomotiveTab.LIBRARY -> LibraryTab(state, onPlayTrack)
            AutomotiveTab.FAVORITES -> FavoritesTab(state, onPlayFavorite)
            AutomotiveTab.RADIO -> RadioTab(state, onPlayRadio)
        }
    }
}

@Composable
private fun ColumnScope.ForYouTab(
    state: AutomotiveUiState,
    onPlayMix: (AutomotiveMix) -> Unit,
    onPlayRecent: (AutomotiveRecent) -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            SectionHead(
                eyebrow = "For you",
                title = "Made from your listening",
                subtitle = "Built on this car. Nothing leaves the device.",
            )
        }

        if (state.mixes.isEmpty()) {
            item {
                EmptyCard(
                    "No mixes yet",
                    "Play a few songs or open Statocyst on your phone to build your first mix.",
                )
            }
        } else {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    state.mixes.chunked(2).forEachIndexed { rowIndex, rowMixes ->
                        Row(
                            modifier = Modifier.fillMaxWidth().height(104.dp),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            rowMixes.forEachIndexed { index, mix ->
                                MixCard(
                                    mix = mix,
                                    paletteIndex = rowIndex * 2 + index,
                                    onClick = { onPlayMix(mix) },
                                    modifier = Modifier.weight(1f).fillMaxHeight(),
                                )
                            }
                            if (rowMixes.size == 1) Spacer(Modifier.weight(1f))
                        }
                    }
                }
            }
        }

        val recent = if (state.drivingRestricted) state.recent.take(DRIVING_LIST_LIMIT) else state.recent
        item {
            SectionLabel("Recently played", "${recent.size} tracks")
        }
        if (recent.isEmpty()) {
            item {
                EmptyCard("Nothing played yet", "Start a mix or pick a song from the library.")
            }
        } else {
            items(recent, key = { it.track.id }) { entry ->
                RecentRow(entry, onClick = { onPlayRecent(entry) })
            }
        }
        if (state.drivingRestricted && state.recent.size > recent.size) {
            item {
                Text(
                    "Park to see the rest of your history.",
                    style = MaterialTheme.typography.labelLarge,
                    color = AutomotiveColors.MutedDim,
                )
            }
        }
    }
}

@Composable
private fun ColumnScope.LibraryTab(state: AutomotiveUiState, onPlay: (AutomotiveTrack) -> Unit) {
    val tracks = if (state.drivingRestricted) state.tracks.take(DRIVING_LIST_LIMIT) else state.tracks
    SectionHead(
        eyebrow = "Library",
        title = "All tracks",
        subtitle = if (state.drivingRestricted) {
            "Showing first ${tracks.size} while driving"
        } else {
            "${state.tracks.size} songs on this device"
        },
    )
    TrackList(tracks, onPlay, modifier = Modifier.weight(1f))
}

@Composable
private fun ColumnScope.FavoritesTab(state: AutomotiveUiState, onPlay: (AutomotiveTrack) -> Unit) {
    val favorites =
        if (state.drivingRestricted) state.favorites.take(DRIVING_LIST_LIMIT) else state.favorites
    SectionHead(
        eyebrow = "Favorites",
        title = "The ones you keep",
        subtitle = if (state.drivingRestricted) {
            "Showing first ${favorites.size} while driving"
        } else {
            "${state.favorites.size} tracks"
        },
    )
    if (favorites.isEmpty()) {
        EmptyCard("No favorites yet", "Star a song on your phone and it will appear here.")
    } else {
        TrackList(favorites, onPlay, modifier = Modifier.weight(1f))
    }
}

@Composable
private fun ColumnScope.RadioTab(state: AutomotiveUiState, onPlay: (AutomotiveTrack) -> Unit) {
    val seeds =
        if (state.drivingRestricted) state.radioSeeds.take(DRIVING_LIST_LIMIT) else state.radioSeeds
    SectionHead(
        eyebrow = "Radio",
        title = "Start from a song",
        subtitle = if (state.drivingRestricted) {
            "Showing first ${seeds.size} while driving"
        } else {
            "A local radio from your recent plays and favorites"
        },
    )
    if (seeds.isEmpty()) {
        EmptyCard("No seeds yet", "Play or favorite a song to start a radio.")
    } else {
        TrackList(seeds, onPlay, radio = true, modifier = Modifier.weight(1f))
    }
}

@Composable
private fun TrackList(
    tracks: List<AutomotiveTrack>,
    onPlay: (AutomotiveTrack) -> Unit,
    modifier: Modifier = Modifier,
    radio: Boolean = false,
) {
    LazyColumn(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        items(tracks, key = { it.id }) { track ->
            TrackRow(
                track = track,
                onClick = { onPlay(track) },
                trailing = if (radio) "Radio" else null,
            )
        }
    }
}

@Composable
private fun SectionHead(eyebrow: String, title: String, subtitle: String) {
    Column {
        Text(
            eyebrow.uppercase(),
            style = MaterialTheme.typography.labelLarge,
            color = AutomotiveColors.Cyan,
        )
        Text(
            title,
            style = MaterialTheme.typography.headlineMedium,
            color = AutomotiveColors.Text,
        )
        Text(
            subtitle,
            style = MaterialTheme.typography.bodyMedium,
            color = AutomotiveColors.Muted,
        )
    }
}

@Composable
private fun StatusBanner(icon: ImageVector, title: String, detail: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Color(0x1A38E1FF))
            .border(1.dp, AutomotiveColors.LineStrong, RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = AutomotiveColors.Cyan,
            modifier = Modifier.size(20.dp),
        )
        Text(
            "$title · $detail",
            style = MaterialTheme.typography.bodyMedium,
            color = AutomotiveColors.Muted,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun SectionLabel(title: String, trailing: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = 2.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            title.uppercase(),
            style = MaterialTheme.typography.labelLarge,
            color = AutomotiveColors.Muted,
        )
        Text(
            trailing,
            style = MaterialTheme.typography.labelLarge,
            color = AutomotiveColors.MutedDim,
        )
    }
}

@Composable
private fun MixCard(
    mix: AutomotiveMix,
    paletteIndex: Int,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = mixPalette(paletteIndex)
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(18.dp))
            .background(Brush.linearGradient(colors))
            .border(1.dp, AutomotiveColors.Line, RoundedCornerShape(18.dp))
            .clickable(onClick = onClick),
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val center = Offset(size.width * 0.24f, size.height * 0.26f)
            drawCircle(
                color = Color(0x5538E1FF),
                radius = size.minDimension * 0.08f,
                center = center,
            )
            for (ring in 1..5) {
                drawCircle(
                    color = Color(0x3338E1FF),
                    radius = size.minDimension * 0.08f + ring * size.minDimension * 0.10f,
                    center = center,
                    style = Stroke(width = 1.4.dp.toPx()),
                )
            }
        }
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        listOf(Color.Transparent, Color(0xB303070F)),
                        startY = 20f,
                    )
                )
        )
        Column(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(14.dp),
        ) {
            Text(
                mix.title,
                style = MaterialTheme.typography.titleLarge,
                color = AutomotiveColors.Text,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                mix.subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = AutomotiveColors.Muted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Box(
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(12.dp)
                .size(38.dp)
                .clip(CircleShape)
                .background(Color(0xAA38E1FF)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Filled.PlayArrow,
                contentDescription = "Play ${mix.title}",
                tint = AutomotiveColors.Abyss,
                modifier = Modifier.size(22.dp),
            )
        }
    }
}

private fun mixPalette(index: Int): List<Color> = when (index % 4) {
    0 -> listOf(Color(0xFF0B5A80), Color(0xFF07182F))
    1 -> listOf(Color(0xFF3A2A78), Color(0xFF081326))
    2 -> listOf(Color(0xFF041D2B), Color(0xFF050A18))
    else -> listOf(Color(0xFF293061), Color(0xFF081326))
}

@Composable
private fun RecentRow(recent: AutomotiveRecent, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Artwork(recent.track.artUri, 44.dp, 10.dp)
        Column(Modifier.weight(1f)) {
            Text(
                recent.track.title,
                style = MaterialTheme.typography.titleMedium,
                color = AutomotiveColors.Text,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                recent.track.artist,
                style = MaterialTheme.typography.bodyMedium,
                color = AutomotiveColors.Muted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Text(
            relativeTime(recent.playedAt),
            style = MaterialTheme.typography.labelLarge,
            color = AutomotiveColors.MutedDim,
        )
        Icon(
            Icons.Filled.PlayArrow,
            contentDescription = "Play ${recent.track.title}",
            tint = AutomotiveColors.Cyan,
            modifier = Modifier.size(22.dp),
        )
    }
}

@Composable
private fun TrackRow(
    track: AutomotiveTrack,
    onClick: () -> Unit,
    trailing: String? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Artwork(track.artUri, 44.dp, 10.dp)
        Column(Modifier.weight(1f)) {
            Text(
                track.title,
                style = MaterialTheme.typography.titleMedium,
                color = AutomotiveColors.Text,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                listOf(track.artist, track.album).filter { it.isNotBlank() }.joinToString(" · "),
                style = MaterialTheme.typography.bodyMedium,
                color = AutomotiveColors.Muted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (trailing != null) {
            Text(
                trailing,
                style = MaterialTheme.typography.labelLarge,
                color = AutomotiveColors.Cyan,
            )
        } else {
            Icon(
                Icons.Filled.PlayArrow,
                contentDescription = "Play ${track.title}",
                tint = AutomotiveColors.Cyan,
                modifier = Modifier.size(22.dp),
            )
        }
    }
}

@Composable
private fun Artwork(uri: String?, size: Dp, radius: Dp) {
    Box(
        modifier = Modifier
            .size(size)
            .clip(RoundedCornerShape(radius))
            .background(
                Brush.linearGradient(
                    listOf(AutomotiveColors.CyanDeep, AutomotiveColors.Abyss700, AutomotiveColors.VioletDeep)
                )
            )
            .border(1.dp, AutomotiveColors.Line, RoundedCornerShape(radius)),
    ) {
        if (uri != null) {
            AsyncImage(
                model = uri,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

@Composable
private fun EmptyCard(title: String, detail: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(AutomotiveColors.Panel)
            .border(1.dp, AutomotiveColors.Line, RoundedCornerShape(14.dp))
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(
            Icons.Filled.PlayArrow,
            contentDescription = null,
            tint = AutomotiveColors.Cyan,
            modifier = Modifier.size(28.dp),
        )
        Column {
            Text(title, style = MaterialTheme.typography.titleMedium, color = AutomotiveColors.Text)
            Text(detail, style = MaterialTheme.typography.bodyMedium, color = AutomotiveColors.Muted)
        }
    }
}

@Composable
private fun CompactNowPlaying(
    state: AutomotiveUiState,
    onTogglePlay: () -> Unit,
    onNext: () -> Unit,
    onPrevious: () -> Unit,
    onToggleFavorite: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(AutomotiveColors.PanelStrong)
            .border(1.dp, AutomotiveColors.Line, RoundedCornerShape(18.dp))
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Artwork(state.nowPlaying?.artUri, 48.dp, 10.dp)
            Column(Modifier.weight(1f)) {
                Text(
                    state.nowPlaying?.title ?: "Nothing playing",
                    style = MaterialTheme.typography.titleMedium,
                    color = AutomotiveColors.Text,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    state.nowPlaying?.artist?.takeIf { it.isNotBlank() } ?: "Pick a mix to start",
                    style = MaterialTheme.typography.labelLarge,
                    color = AutomotiveColors.Muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            IconButton(onClick = onPrevious) {
                Icon(
                    Icons.Filled.SkipPrevious,
                    contentDescription = "Previous track",
                    tint = AutomotiveColors.Muted,
                    modifier = Modifier.size(24.dp),
                )
            }
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(
                        Brush.linearGradient(
                            listOf(AutomotiveColors.Cyan, AutomotiveColors.CyanDeep, AutomotiveColors.VioletDeep)
                        )
                    )
                    .clickable(onClick = onTogglePlay),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (state.isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                    contentDescription = if (state.isPlaying) "Pause" else "Play",
                    tint = AutomotiveColors.Abyss,
                    modifier = Modifier.size(26.dp),
                )
            }
            IconButton(onClick = onNext) {
                Icon(
                    Icons.Filled.SkipNext,
                    contentDescription = "Next track",
                    tint = AutomotiveColors.Muted,
                    modifier = Modifier.size(24.dp),
                )
            }
            IconButton(onClick = onToggleFavorite) {
                Icon(
                    if (state.currentIsFavorite) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
                    contentDescription = if (state.currentIsFavorite) "Remove favorite" else "Favorite",
                    tint = if (state.currentIsFavorite) AutomotiveColors.Cyan else AutomotiveColors.Muted,
                    modifier = Modifier.size(22.dp),
                )
            }
        }
        val fraction = if (state.durationMs > 0) {
            (state.positionMs.toFloat() / state.durationMs.toFloat()).coerceIn(0f, 1f)
        } else {
            0f
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(3.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(Color(0x3394C5FF))
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(fraction)
                    .fillMaxHeight()
                    .background(
                        Brush.horizontalGradient(
                            listOf(AutomotiveColors.Cyan, AutomotiveColors.Violet)
                        )
                    )
            )
        }
    }
}

@Composable
private fun NowPlayingPanel(
    state: AutomotiveUiState,
    onTogglePlay: () -> Unit,
    onNext: () -> Unit,
    onPrevious: () -> Unit,
    onToggleFavorite: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(24.dp))
            .background(AutomotiveColors.PanelStrong)
            .border(1.dp, AutomotiveColors.Line, RoundedCornerShape(24.dp))
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            "NOW PLAYING",
            style = MaterialTheme.typography.labelLarge,
            color = AutomotiveColors.Cyan,
        )
        Box(
            modifier = Modifier
                .fillMaxWidth(0.82f)
                .aspectRatio(1f)
                .align(Alignment.CenterHorizontally)
                .clip(RoundedCornerShape(18.dp))
                .background(
                    Brush.linearGradient(
                        listOf(AutomotiveColors.CyanDeep, AutomotiveColors.Abyss700, AutomotiveColors.VioletDeep)
                    )
                )
                .border(1.dp, AutomotiveColors.Line, RoundedCornerShape(18.dp)),
        ) {
            state.nowPlaying?.artUri?.let { uri ->
                AsyncImage(
                    model = uri,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
            }
            if (state.nowPlaying == null) {
                Box(
                    Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        "Nothing playing",
                        style = MaterialTheme.typography.titleMedium,
                        color = AutomotiveColors.Muted,
                    )
                }
            }
        }

        state.nowPlaying?.let { track ->
            Column {
                Text(
                    track.title,
                    style = MaterialTheme.typography.headlineMedium,
                    color = AutomotiveColors.Text,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    track.artist,
                    style = MaterialTheme.typography.bodyLarge,
                    color = AutomotiveColors.Muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }

        Progress(state.positionMs, state.durationMs)

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onPrevious) {
                Icon(
                    Icons.Filled.SkipPrevious,
                    contentDescription = "Previous track",
                    tint = AutomotiveColors.Muted,
                    modifier = Modifier.size(30.dp),
                )
            }
            Surface(
                color = Color.Transparent,
                shape = CircleShape,
            ) {
                Box(
                    modifier = Modifier
                        .size(58.dp)
                        .clip(CircleShape)
                        .background(
                            Brush.linearGradient(
                                listOf(AutomotiveColors.Cyan, AutomotiveColors.CyanDeep, AutomotiveColors.VioletDeep)
                            )
                        )
                        .clickable(onClick = onTogglePlay),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        if (state.isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                        contentDescription = if (state.isPlaying) "Pause" else "Play",
                        tint = AutomotiveColors.Abyss,
                        modifier = Modifier.size(32.dp),
                    )
                }
            }
            IconButton(onClick = onNext) {
                Icon(
                    Icons.Filled.SkipNext,
                    contentDescription = "Next track",
                    tint = AutomotiveColors.Muted,
                    modifier = Modifier.size(30.dp),
                )
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onToggleFavorite) {
                Icon(
                    if (state.currentIsFavorite) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
                    contentDescription = if (state.currentIsFavorite) "Remove favorite" else "Favorite",
                    tint = if (state.currentIsFavorite) AutomotiveColors.Cyan else AutomotiveColors.Muted,
                    modifier = Modifier.size(24.dp),
                )
            }
            Text(
                if (state.currentIsFavorite) "Favorite" else "Add favorite",
                style = MaterialTheme.typography.labelLarge,
                color = if (state.currentIsFavorite) AutomotiveColors.Cyan else AutomotiveColors.Muted,
            )
        }

        if (state.upNext.isNotEmpty()) {
            SectionLabel("Up next", "Queue")
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                state.upNext.forEach { track ->
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Artwork(track.artUri, 30.dp, 7.dp)
                        Column(Modifier.weight(1f)) {
                            Text(
                                track.title,
                                style = MaterialTheme.typography.bodyMedium,
                                color = AutomotiveColors.Text,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                track.artist,
                                style = MaterialTheme.typography.labelLarge,
                                color = AutomotiveColors.MutedDim,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            }
        }

        state.error?.let { error ->
            Text(
                error,
                style = MaterialTheme.typography.labelLarge,
                color = AutomotiveColors.Danger,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun Progress(positionMs: Long, durationMs: Long) {
    val fraction = if (durationMs > 0) {
        (positionMs.toFloat() / durationMs.toFloat()).coerceIn(0f, 1f)
    } else {
        0f
    }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(4.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(Color(0x3394C5FF))
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(fraction)
                    .fillMaxHeight()
                    .background(
                        Brush.horizontalGradient(
                            listOf(AutomotiveColors.Cyan, AutomotiveColors.Violet)
                        )
                    )
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(formatTime(positionMs), style = MaterialTheme.typography.labelLarge, color = AutomotiveColors.MutedDim)
            Text(formatTime(durationMs), style = MaterialTheme.typography.labelLarge, color = AutomotiveColors.MutedDim)
        }
    }
}

private fun formatTime(ms: Long): String {
    val totalSeconds = (ms / 1000).coerceAtLeast(0)
    val minutes = totalSeconds / 60
    val seconds = totalSeconds % 60
    return "%d:%02d".format(minutes, seconds)
}

private const val DRIVING_LIST_LIMIT = 6

private fun relativeTime(epochMs: Long): String =
    DateUtils.getRelativeTimeSpanString(
        epochMs,
        System.currentTimeMillis(),
        DateUtils.MINUTE_IN_MILLIS,
        DateUtils.FORMAT_ABBREV_RELATIVE,
    ).toString()
