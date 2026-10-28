package net.christopherrutherford.statocyst.media

import android.content.Context

/**
 * User-managed browse access. A head unit or controller that [ControllerPolicy] does not
 * recognise is denied and remembered here, so Settings can list it and let the user allow it.
 */
object BrowseAccess {
    private const val PREFS = "statocyst"
    private const val ALLOWED = "browse_allowed"
    private const val DENIED = "browse_denied"
    private const val MAX_DENIED = 10

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun allowed(context: Context): Set<String> =
        prefs(context).getStringSet(ALLOWED, emptySet())?.toSet() ?: emptySet()

    /** Most recent first. */
    fun denied(context: Context): List<String> =
        prefs(context).getString(DENIED, "").orEmpty().split(',').filter { it.isNotBlank() }

    @Synchronized
    fun recordDenied(context: Context, packageName: String) {
        val next = (listOf(packageName) + denied(context).filter { it != packageName }).take(MAX_DENIED)
        prefs(context).edit().putString(DENIED, next.joinToString(",")).apply()
    }

    @Synchronized
    fun setAllowed(context: Context, packageName: String, allow: Boolean) {
        val set = allowed(context).toMutableSet()
        if (allow) set.add(packageName) else set.remove(packageName)
        val denied = denied(context).filter { it != packageName }
        prefs(context).edit()
            .putStringSet(ALLOWED, set)
            .putString(DENIED, denied.joinToString(","))
            .apply()
    }
}
