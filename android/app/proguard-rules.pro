# R8 rules for the release build (minifyEnabled + shrinkResources).
#
# Capacitor, Room, Media3, WorkManager-style libraries ship their own consumer rules; this file only
# covers what the app itself reaches through reflection or the WebView bridge.

# Keep readable stack traces in Play Console crash reports (upload mapping.txt with each release).
-keepattributes SourceFile,LineNumberTable,*Annotation*,Signature,InnerClasses,EnclosingMethod
-renamesourcefileattribute SourceFile

# Capacitor plugin: found by annotation, methods invoked by name from the JS bridge.
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod public <methods>;
    @android.webkit.JavascriptInterface <methods>;
}
-keep class net.christopherrutherford.statocyst.plugin.StatocystPlugin { *; }

# Resolved by name from PlaybackService (Class.forName) and registered in the manifest.
-keep class net.christopherrutherford.statocyst.MainActivity { *; }

# Room entities/DAOs are generated and referenced by name; keep the schema classes intact.
-keep class net.christopherrutherford.statocyst.db.** { *; }

# Local media server serves WebView requests through reflection-free paths, but keep it stable.
-keep class net.christopherrutherford.statocyst.media.LocalMediaServer { *; }
