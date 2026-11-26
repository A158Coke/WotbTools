package com.wotbtools.app.auth

internal object OidcRedirectStrategy {

    internal const val APP_LINK_HOST = "auth.wotbtools.com"

    internal fun redirectUri(): String = OidcConfiguration.PRIVATE_REDIRECT_URI

    internal fun decide(@Suppress("UNUSED_PARAMETER") appLinkUsable: Boolean): String =
        OidcConfiguration.PRIVATE_REDIRECT_URI
}
