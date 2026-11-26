package com.wotbtools.app

object GeckoRuntimeConfig {
    const val FILE_NAME = "geckoview-config.yaml"

    fun yaml(): String = "prefs:\n  full-screen-api.allow-trusted-requests-only: false\n"
}
