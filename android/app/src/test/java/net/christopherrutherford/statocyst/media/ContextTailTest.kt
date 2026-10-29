package net.christopherrutherford.statocyst.media

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ContextTailTest {
    private val ids = (0 until 2000).map { "t$it" }

    @Test
    fun smallContextHasNoTail() {
        val (window, at) = BrowseTree.window(ids.take(100), 10)
        assertNull(ContextTail.after(ids.take(100), (10 - at) + window.size, "e"))
    }

    @Test
    fun largeContextDrainsInChunksUntilEveryTrackIsQueued() {
        val (window, at) = BrowseTree.window(ids, 1000)
        val from = 1000 - at
        val queued = window.toMutableList()
        val tail = ContextTail.after(ids, from + window.size, "end0")!!
        assertEquals(ids.size - (from + window.size), tail.remaining)
        var anchor = "end0"
        var guard = 0
        while (tail.remaining > 0 && guard++ < 20) {
            assertTrue(tail.continues(anchor))
            queued += tail.next()
            anchor = "end$guard"
            tail.reanchor(anchor)
        }
        assertEquals(0, tail.remaining)
        assertEquals(ids.subList(from, ids.size), queued)
    }

    @Test
    fun dueOnlyNearTheEndOrWhenShuffled() {
        val tail = ContextTail(ids, "e")
        assertFalse(tail.due(itemsAhead = 200, shuffle = false))
        assertTrue(tail.due(itemsAhead = ContextTail.LOW_WATER, shuffle = false))
        assertTrue(tail.due(itemsAhead = 200, shuffle = true))
    }

    @Test
    fun staleWhenQueueNoLongerEndsAtTheAnchor() {
        val tail = ContextTail(ids, "e")
        assertTrue(tail.continues("e"))
        assertFalse(tail.continues("other"))
        assertFalse(tail.continues(null))
    }
}
