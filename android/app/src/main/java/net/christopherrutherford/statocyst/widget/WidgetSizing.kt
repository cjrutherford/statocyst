package net.christopherrutherford.statocyst.widget

/** Which player layout a widget of a given size shows. */
enum class Tier { COMPACT, LARGE, FULL }

/** How much of the quick picks grid fits: header-less strip, one row, or both rows. */
enum class PicksTier { STRIP, ONE_ROW, TWO_ROWS }

/** Heights (dp) at which the layouts switch; widths only matter to the system's own cell snapping. */
internal object Breakpoints {
    const val SHORT = 110f
    const val MEDIUM = 180f
    const val PICKS_STRIP = 90f
    const val PICKS_TWO_ROWS = 170f
    const val DIAL_GRID = 160f

    /** Used when the launcher reports no size: assume the widget is big enough for everything. */
    const val UNKNOWN = 1000f
}

/** 4x3 player: slim bar, art-forward player, then player plus favorites as the widget grows. */
internal fun nowPlayingTier(widthDp: Float, heightDp: Float): Tier = when {
    heightDp < Breakpoints.SHORT -> Tier.COMPACT
    heightDp < Breakpoints.MEDIUM -> Tier.LARGE
    else -> Tier.FULL
}

/** 4x2 player: art-forward, collapsing to the slim bar when squeezed. */
internal fun nowPlayingLargeTier(widthDp: Float, heightDp: Float): Tier =
    if (heightDp < Breakpoints.SHORT) Tier.COMPACT else Tier.LARGE

/** 4x1 player: slim bar, growing into the art-forward player once there is room. */
internal fun nowPlayingCompactTier(widthDp: Float, heightDp: Float): Tier =
    if (heightDp >= Breakpoints.SHORT) Tier.LARGE else Tier.COMPACT

internal fun quickPicksTier(widthDp: Float, heightDp: Float): PicksTier = when {
    heightDp < Breakpoints.PICKS_STRIP -> PicksTier.STRIP
    heightDp < Breakpoints.PICKS_TWO_ROWS -> PicksTier.ONE_ROW
    else -> PicksTier.TWO_ROWS
}

/** Speed dial: player only (slim bar) until there is room for a row of covers under it. */
internal fun speedDialTier(widthDp: Float, heightDp: Float): Tier =
    if (heightDp < Breakpoints.DIAL_GRID) Tier.COMPACT else Tier.FULL

private const val MIN_W = 180f

/** One (width, height) dp pair per tier, for the size-mapped RemoteViews used on Android 12+. */
internal val nowPlayingSizes = listOf(MIN_W to 56f, MIN_W to Breakpoints.SHORT, MIN_W to Breakpoints.MEDIUM)
internal val nowPlayingLargeSizes = listOf(MIN_W to 56f, MIN_W to Breakpoints.SHORT)
internal val nowPlayingCompactSizes = listOf(MIN_W to 56f, MIN_W to Breakpoints.SHORT)
internal val quickPicksSizes = listOf(MIN_W to 56f, MIN_W to Breakpoints.PICKS_STRIP, MIN_W to Breakpoints.PICKS_TWO_ROWS)
internal val speedDialSizes = listOf(MIN_W to 56f, MIN_W to Breakpoints.DIAL_GRID)
