package net.christopherrutherford.statocyst.media

/**
 * Decides which apps may browse the library. Playback controllers (notification,
 * lock screen, Bluetooth) are not affected; this only guards the browse tree and
 * search, which expose the whole catalog.
 */
object ControllerPolicy {
    private val KNOWN_PACKAGES = setOf(
        "com.google.android.projection.gearhead", // Android Auto
        "com.google.android.autosimulator", // Desktop Head Unit
        "com.google.android.carassistant",
        "com.google.android.googlequicksearchbox", // Google Assistant
        "com.google.android.wearable.app",
        "com.android.systemui",
        "com.android.bluetooth", // AVRCP browsing
        "android",
    )
    private val KNOWN_PREFIXES = listOf("com.android.car.", "com.google.android.apps.automotive.")

    /** [trusted] is Media3's check for system apps and holders of media-control permissions. */
    fun mayBrowse(packageName: String, ownPackage: String, trusted: Boolean): Boolean =
        trusted || packageName == ownPackage || packageName in KNOWN_PACKAGES ||
            KNOWN_PREFIXES.any { packageName.startsWith(it) }
}
