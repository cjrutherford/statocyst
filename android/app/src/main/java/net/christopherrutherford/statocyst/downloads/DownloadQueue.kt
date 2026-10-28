package net.christopherrutherford.statocyst.downloads

import java.util.concurrent.Executors
import java.util.concurrent.ThreadFactory

enum class DownloadState { QUEUED, ACTIVE, RETRYING, WAITING, FAILED, DONE }

data class QueueEntry(
    val trackId: String,
    val state: DownloadState,
    val receivedBytes: Long,
    val totalBytes: Long?,
    val attempt: Int,
    val error: String?,
) {
    val pending: Boolean get() = state != DownloadState.FAILED && state != DownloadState.DONE
}

data class QueueSnapshot(val entries: List<QueueEntry>) {
    val total: Int get() = entries.size
    val done: Int get() = entries.count { it.state == DownloadState.DONE }
    val failed: Int get() = entries.count { it.state == DownloadState.FAILED }
    val pending: Int get() = entries.count { it.pending }
    val active: Int get() = entries.count { it.state == DownloadState.ACTIVE || it.state == DownloadState.RETRYING }
    val finished: Boolean get() = entries.isNotEmpty() && pending == 0
    val receivedBytes: Long get() = entries.sumOf { it.receivedBytes }

    /** Sum of known sizes; null until at least one size is known. */
    val totalBytes: Long?
        get() = entries.mapNotNull { it.totalBytes }.takeIf { it.isNotEmpty() }?.sum()

    /** True when every non-finished entry has reported a size, so byte progress is not misleading. */
    val sizesKnown: Boolean get() = entries.all { it.state == DownloadState.DONE || it.totalBytes != null }
}

/**
 * Process-wide download queue: a small worker pool over [runner] with
 * per-track state, aggregate progress and persistence of what is still pending
 * (so a killed process can pick the work back up). Pure JVM, no Android types.
 */
class DownloadQueue(
    private val runner: (trackId: String, events: DownloadEvents) -> Unit,
    private val persist: (List<String>) -> Unit = {},
    private val networkUp: () -> Boolean = { true },
    concurrency: Int = 2,
    private val clock: () -> Long = System::currentTimeMillis,
    private val emitIntervalMs: Long = 250,
) {
    private class Mutable(val trackId: String) {
        var state = DownloadState.QUEUED
        var received = 0L
        var total: Long? = null
        var attempt = 0
        var error: String? = null
        val pending: Boolean get() = state != DownloadState.FAILED && state != DownloadState.DONE
        fun snapshot() = QueueEntry(trackId, state, received, total, attempt, error)
    }

    private val entries = LinkedHashMap<String, Mutable>()
    private val cancelled = HashSet<String>()
    private var lastEmit = 0L

    private val listeners = java.util.concurrent.CopyOnWriteArrayList<(QueueSnapshot) -> Unit>()

    fun addListener(listener: (QueueSnapshot) -> Unit) { listeners.add(listener) }

    fun removeListener(listener: (QueueSnapshot) -> Unit) { listeners.remove(listener) }

    private val pool = Executors.newFixedThreadPool(
        concurrency,
        ThreadFactory { r -> Thread(r, "download-worker").apply { isDaemon = true } },
    )

    @Synchronized
    fun snapshot(): QueueSnapshot = QueueSnapshot(entries.values.map { it.snapshot() })

    /** Adds tracks. A finished batch is replaced; failed tracks are queued again. Returns how many were queued. */
    fun enqueue(trackIds: Collection<String>): Int = enqueue(trackIds, startNewBatch = true)

    private fun enqueue(trackIds: Collection<String>, startNewBatch: Boolean): Int {
        val toRun = ArrayList<String>()
        synchronized(this) {
            if (startNewBatch && entries.isNotEmpty() && entries.values.none { it.pending }) {
                entries.values.removeAll { it.state == DownloadState.DONE }
            }
            for (id in trackIds.distinct()) {
                val existing = entries[id]
                if (existing != null && existing.state != DownloadState.FAILED) continue
                cancelled.remove(id)
                entries[id] = Mutable(id)
                toRun.add(id)
            }
        }
        if (toRun.isEmpty()) return 0
        publish(force = true)
        toRun.forEach { id -> pool.execute { run(id) } }
        return toRun.size
    }

    fun retryFailed(): Int {
        val failed = synchronized(this) { entries.values.filter { it.state == DownloadState.FAILED }.map { it.trackId } }
        return enqueue(failed, startNewBatch = false)
    }

    /** Cancels everything that has not finished. Queued tracks vanish now; running ones stop within a buffer. */
    fun cancelAll() {
        synchronized(this) {
            val pending = entries.values.filter { it.pending }
            pending.forEach { cancelled.add(it.trackId) }
            pending.filter { it.state == DownloadState.QUEUED }.forEach { entries.remove(it.trackId) }
        }
        persistPending()
        publish(force = true)
    }

    /** Forgets finished and failed entries so the status disappears. */
    fun dismiss() {
        synchronized(this) { entries.values.removeAll { !it.pending } }
        publish(force = true)
    }

    private fun run(id: String) {
        val entry = synchronized(this) {
            val e = entries[id]
            if (e == null || id in cancelled) {
                cancelled.remove(id)
                entries.remove(id)
                null
            } else {
                e.state = DownloadState.ACTIVE
                e.error = null
                e
            }
        } ?: run { persistPending(); publish(force = true); return }
        publish(force = true)

        val events = object : DownloadEvents {
            override fun cancelled() = synchronized(this@DownloadQueue) { id in cancelled }
            override fun online() = networkUp()
            override fun waiting() = change(entry) { state = DownloadState.WAITING }
            override fun retrying(attempt: Int, reason: String) = change(entry) {
                state = DownloadState.RETRYING
                this.attempt = attempt
                error = reason
            }
            override fun progress(received: Long, total: Long?) {
                val resumed = synchronized(this@DownloadQueue) { entry.state != DownloadState.ACTIVE }
                if (resumed) {
                    change(entry) { state = DownloadState.ACTIVE; error = null; this.received = received; this.total = total }
                } else {
                    synchronized(this@DownloadQueue) { entry.received = received; entry.total = total }
                    publish(force = false)
                }
            }
        }
        try {
            runner(id, events)
            change(entry) {
                state = DownloadState.DONE
                total = total ?: received
                received = total ?: received
                error = null
            }
        } catch (_: DownloadCancelled) {
            synchronized(this) { cancelled.remove(id); entries.remove(id) }
            publish(force = true)
        } catch (error: Throwable) {
            change(entry) {
                state = DownloadState.FAILED
                this.error = error.message ?: error.javaClass.simpleName
            }
        }
        persistPending()
    }

    private fun change(entry: Mutable, block: Mutable.() -> Unit) {
        synchronized(this) { entry.block() }
        publish(force = true)
    }

    private fun persistPending() {
        val pending = synchronized(this) { entries.values.filter { it.pending }.map { it.trackId } }
        persist(pending)
    }

    private fun publish(force: Boolean) {
        val snapshot: QueueSnapshot
        synchronized(this) {
            val now = clock()
            if (!force && now - lastEmit < emitIntervalMs) return
            lastEmit = now
            snapshot = QueueSnapshot(entries.values.map { it.snapshot() })
        }
        listeners.forEach { it(snapshot) }
    }
}
