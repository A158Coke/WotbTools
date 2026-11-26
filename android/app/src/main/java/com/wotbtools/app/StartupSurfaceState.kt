package com.wotbtools.app

internal class StartupSurfaceState {

    var visible = true
        private set

    private var gateOwnsScreen = false

    fun startLoading() {
        gateOwnsScreen = false
        visible = true
    }

    fun contentPainted() {
        visible = false
    }

    fun contentUnavailable() {
        visible = !gateOwnsScreen
    }

    fun gateShown() {
        gateOwnsScreen = true
        visible = false
    }
}
