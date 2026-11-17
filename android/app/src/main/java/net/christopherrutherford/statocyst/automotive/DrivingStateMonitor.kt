package net.christopherrutherford.statocyst.automotive

import android.car.Car
import android.car.drivingstate.CarUxRestrictions
import android.car.drivingstate.CarUxRestrictionsManager
import android.content.Context
import android.content.pm.PackageManager
import android.util.Log

/**
 * Reads the car's distraction-optimization state. The platform `android.car`
 * classes only exist on Android Automotive; this monitor is never constructed
 * on a phone, where MainActivity launches the WebView instead.
 */
class DrivingStateMonitor(context: Context) {
    private val appContext = context.applicationContext
    private var car: Car? = null
    private var manager: CarUxRestrictionsManager? = null
    private var listener: CarUxRestrictionsManager.OnUxRestrictionsChangedListener? = null

    var restricted: Boolean = false
        private set

    fun start(onChanged: (Boolean) -> Unit) {
        if (!appContext.packageManager.hasSystemFeature(PackageManager.FEATURE_AUTOMOTIVE)) {
            return
        }
        try {
            val created = Car.createCar(appContext)
            car = created
            val restrictions = created?.getCarManager(Car.CAR_UX_RESTRICTION_SERVICE)
                as? CarUxRestrictionsManager
            manager = restrictions
            if (restrictions == null) return

            val callback = CarUxRestrictionsManager.OnUxRestrictionsChangedListener { state ->
                update(state, onChanged)
            }
            listener = callback
            restrictions.registerListener(callback)
            restrictions.currentCarUxRestrictions?.let { update(it, onChanged) }
        } catch (error: Exception) {
            Log.w(TAG, "Car UX restrictions unavailable", error)
        }
    }

    fun stop() {
        runCatching { manager?.unregisterListener() }
        runCatching { car?.disconnect() }
        listener = null
        manager = null
        car = null
    }

    private fun update(
        restrictions: CarUxRestrictions,
        onChanged: (Boolean) -> Unit,
    ) {
        val next = restrictions.isRequiresDistractionOptimization
        if (next != restricted) {
            restricted = next
            onChanged(next)
        }
    }

    private companion object {
        const val TAG = "StatocystDrivingState"
    }
}
