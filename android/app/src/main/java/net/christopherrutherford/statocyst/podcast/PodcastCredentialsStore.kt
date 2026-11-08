package net.christopherrutherford.statocyst.podcast

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** Podcast Index key/secret in EncryptedSharedPreferences; never in Room or logs. */
class PodcastCredentialsStore(context: Context) {
    private val prefs by lazy {
        val key = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "statocyst_podcast_credentials",
            key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    fun save(apiKey: String, secret: String) {
        prefs.edit().putString(KEY, apiKey).putString(SECRET, secret).apply()
    }

    fun load(): Pair<String, String>? {
        val key = prefs.getString(KEY, null) ?: return null
        val secret = prefs.getString(SECRET, null) ?: return null
        return key to secret
    }

    fun clear() {
        prefs.edit().remove(KEY).remove(SECRET).apply()
    }

    fun configured(): Boolean = load() != null

    private companion object {
        const val KEY = "apiKey"
        const val SECRET = "secret"
    }
}
