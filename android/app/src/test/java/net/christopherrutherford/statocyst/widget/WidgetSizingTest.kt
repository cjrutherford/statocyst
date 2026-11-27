package net.christopherrutherford.statocyst.widget

import org.junit.Assert.assertEquals
import org.junit.Test

class WidgetSizingTest {
    @Test
    fun nowPlayingGrowsFromBarToPlayerToFavorites() {
        assertEquals(Tier.COMPACT, nowPlayingTier(250f, 56f))
        assertEquals(Tier.COMPACT, nowPlayingTier(250f, 109f))
        assertEquals(Tier.LARGE, nowPlayingTier(250f, 110f))
        assertEquals(Tier.LARGE, nowPlayingTier(250f, 179f))
        assertEquals(Tier.FULL, nowPlayingTier(250f, 180f))
        assertEquals(Tier.FULL, nowPlayingTier(400f, 500f))
    }

    @Test
    fun largePlayerCollapsesOnlyWhenShort() {
        assertEquals(Tier.COMPACT, nowPlayingLargeTier(250f, 70f))
        assertEquals(Tier.LARGE, nowPlayingLargeTier(250f, 110f))
        assertEquals(Tier.LARGE, nowPlayingLargeTier(250f, 400f))
    }

    @Test
    fun compactPlayerGrowsWhenTall() {
        assertEquals(Tier.COMPACT, nowPlayingCompactTier(250f, 56f))
        assertEquals(Tier.COMPACT, nowPlayingCompactTier(250f, 109f))
        assertEquals(Tier.LARGE, nowPlayingCompactTier(250f, 110f))
    }

    @Test
    fun quickPicksShowsAsManyRowsAsFit() {
        assertEquals(PicksTier.STRIP, quickPicksTier(250f, 56f))
        assertEquals(PicksTier.ONE_ROW, quickPicksTier(250f, 90f))
        assertEquals(PicksTier.ONE_ROW, quickPicksTier(250f, 169f))
        assertEquals(PicksTier.TWO_ROWS, quickPicksTier(250f, 170f))
    }

    @Test
    fun speedDialShowsTheGridOnlyWithRoomForIt() {
        assertEquals(Tier.COMPACT, speedDialTier(250f, 110f))
        assertEquals(Tier.COMPACT, speedDialTier(250f, 159f))
        assertEquals(Tier.FULL, speedDialTier(250f, 160f))
    }

    @Test
    fun everyTierHasASizeThatSelectsIt() {
        nowPlayingSizes.map { nowPlayingTier(it.first, it.second) }.let { assertEquals(Tier.values().toList(), it) }
        quickPicksSizes.map { quickPicksTier(it.first, it.second) }.let { assertEquals(PicksTier.values().toList(), it) }
        speedDialSizes.map { speedDialTier(it.first, it.second) }.let { assertEquals(listOf(Tier.COMPACT, Tier.FULL), it) }
    }
}
