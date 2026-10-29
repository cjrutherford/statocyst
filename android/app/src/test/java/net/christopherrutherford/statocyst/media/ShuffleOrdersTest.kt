package net.christopherrutherford.statocyst.media

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ShuffleOrdersTest {
    @Test
    fun permutationCheckRejectsDuplicatesGapsAndWrongSize() {
        assertTrue(ShuffleOrders.isPermutation(listOf(2, 0, 1), 3))
        assertFalse(ShuffleOrders.isPermutation(listOf(0, 0, 1), 3))
        assertFalse(ShuffleOrders.isPermutation(listOf(0, 1, 3), 3))
        assertFalse(ShuffleOrders.isPermutation(listOf(0, 1), 3))
        assertFalse(ShuffleOrders.isPermutation(listOf(-1, 0, 1), 3))
        assertTrue(ShuffleOrders.isPermutation(emptyList(), 0))
    }

    @Test
    fun remapWithNothingDroppedKeepsTheOrder() {
        assertEquals(listOf(3, 1, 0, 2), ShuffleOrders.remap(listOf(3, 1, 0, 2), 4, listOf(0, 1, 2, 3)))
    }

    @Test
    fun remapDropsMissingSlotsAndRenumbersTheRest() {
        // Old slots 0..4; slots 1 and 3 could not be resolved, survivors become new 0,1,2.
        // Old shuffle order 3,0,4,2,1 -> keep 0,4,2 -> new 0,2,1.
        assertEquals(listOf(0, 2, 1), ShuffleOrders.remap(listOf(3, 0, 4, 2, 1), 5, listOf(0, 2, 4)))
    }

    @Test
    fun remapRejectsMissingOrInvalidOrders() {
        assertNull(ShuffleOrders.remap(null, 3, listOf(0, 1, 2)))
        assertNull(ShuffleOrders.remap(listOf(0, 0, 1), 3, listOf(0, 1, 2)))
        assertNull(ShuffleOrders.remap(listOf(0, 1), 3, listOf(0, 1, 2)))
        assertNull(ShuffleOrders.remap(listOf(0, 1, 2), 3, emptyList()))
    }

    @Test
    fun encodeDecodeRoundTripsAndToleratesGarbage() {
        assertEquals(listOf(4, 0, 2), ShuffleOrders.decode(ShuffleOrders.encode(listOf(4, 0, 2))))
        assertNull(ShuffleOrders.decode(null))
        assertNull(ShuffleOrders.decode(""))
        assertNull(ShuffleOrders.decode("1,x,3"))
    }
}
