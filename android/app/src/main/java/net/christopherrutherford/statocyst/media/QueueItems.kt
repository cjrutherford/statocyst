package net.christopherrutherford.statocyst.media

import android.os.Bundle
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata

/**
 * Queue items are identified by a unique entry id (the MediaItem id) and carry
 * the library track id in metadata extras, so the same track can appear twice in
 * a queue and both the WebView and the car address the same slots.
 */
object QueueItems {
    const val EXTRA_TRACK_ID = "trackId"

    /** An unresolved item: the session's onAddMediaItems fills in URI + metadata. */
    fun placeholder(entryId: String, trackId: String): MediaItem =
        MediaItem.Builder()
            .setMediaId(entryId)
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setExtras(Bundle().apply { putString(EXTRA_TRACK_ID, trackId) })
                    .build(),
            )
            .build()

    /** True when the item already is a queue slot (carries a track id extra). */
    fun isSlot(item: MediaItem): Boolean =
        item.mediaMetadata.extras?.getString(EXTRA_TRACK_ID) != null

    fun trackIdOf(item: MediaItem): String =
        item.mediaMetadata.extras?.getString(EXTRA_TRACK_ID)
            ?: BrowseIds.trackEntityId(item.mediaId)
            ?: item.mediaId

    fun newEntryId(): String = "q_${java.util.UUID.randomUUID()}"
}
