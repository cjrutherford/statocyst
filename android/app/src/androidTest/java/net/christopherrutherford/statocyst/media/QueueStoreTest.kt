package net.christopherrutherford.statocyst.media

import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class QueueStoreTest {
    private val store = QueueStore(InstrumentationRegistry.getInstrumentation().targetContext)
    private val slots = listOf(QueueSlot("q_a", "t1"), QueueSlot("q_b", "t2"), QueueSlot("q_c", "t3"))

    @After
    fun tearDown() = store.clear()

    @Test
    fun savePositionUpdatesOnlyIndexAndPosition() {
        store.clear()
        store.save(SavedQueue(slots, 0, 1_000, shuffle = true, repeatMode = 2))
        store.savePosition(2, 95_000)
        val loaded = store.load()!!
        assertEquals(slots, loaded.slots)
        assertEquals(2, loaded.index)
        assertEquals(95_000, loaded.positionMs)
        assertEquals(true, loaded.shuffle)
        assertEquals(2, loaded.repeatMode)
    }

    @Test
    fun savePositionWithoutASavedQueueDoesNothing() {
        store.clear()
        store.savePosition(3, 5_000)
        assertNull(store.load())
    }
}
