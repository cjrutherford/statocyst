package net.christopherrutherford.statocyst.automotive

/**
 * Debug-only switches for the automotive surface. The activity only sets these
 * when BuildConfig.DEBUG is true; release behavior always comes from the car.
 */
object AutomotiveDebug {
    @Volatile
    var forceDriving: Boolean = false
}
