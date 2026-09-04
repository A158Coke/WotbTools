package com.wotbtools.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AuthReturnPolicyTest {

    @Test
    fun validExactCallbackAccepted() {
        assertTrue(
            AuthReturnPolicy.isVerifiedBrokerReturn(
                scheme = "https", host = "auth.wotbtools.com",
                path = "/realms/wotbtools/broker/juhe-qq/endpoint",
                type = "qq", hasState = true, hasCode = true
            )
        )
    }

    @Test
    fun wrongSchemeRejected() {
        assertFalse(
            AuthReturnPolicy.isVerifiedBrokerReturn(
                scheme = "http", host = "auth.wotbtools.com",
                path = "/realms/wotbtools/broker/juhe-qq/endpoint",
                type = "qq", hasState = true, hasCode = true
            )
        )
    }

    @Test
    fun wrongHostRejected() {
        assertFalse(
            AuthReturnPolicy.isVerifiedBrokerReturn(
                scheme = "https", host = "evil.example",
                path = "/realms/wotbtools/broker/juhe-qq/endpoint",
                type = "qq", hasState = true, hasCode = true
            )
        )
    }

    @Test
    fun wrongRealmRejected() {
        assertFalse(
            AuthReturnPolicy.isVerifiedBrokerReturn(
                scheme = "https", host = "auth.wotbtools.com",
                path = "/realms/evil/broker/juhe-qq/endpoint",
                type = "qq", hasState = true, hasCode = true
            )
        )
    }

    @Test
    fun wrongProviderRejected() {
        assertFalse(
            AuthReturnPolicy.isVerifiedBrokerReturn(
                scheme = "https", host = "auth.wotbtools.com",
                path = "/realms/wotbtools/broker/other/endpoint",
                type = "qq", hasState = true, hasCode = true
            )
        )
    }

    @Test
    fun missingStateRejected() {
        assertFalse(
            AuthReturnPolicy.isVerifiedBrokerReturn(
                scheme = "https", host = "auth.wotbtools.com",
                path = "/realms/wotbtools/broker/juhe-qq/endpoint",
                type = "qq", hasState = false, hasCode = true
            )
        )
    }

    @Test
    fun missingCodeRejected() {
        assertFalse(
            AuthReturnPolicy.isVerifiedBrokerReturn(
                scheme = "https", host = "auth.wotbtools.com",
                path = "/realms/wotbtools/broker/juhe-qq/endpoint",
                type = "qq", hasState = true, hasCode = false
            )
        )
    }

    @Test
    fun wrongTypeRejected() {
        assertFalse(
            AuthReturnPolicy.isVerifiedBrokerReturn(
                scheme = "https", host = "auth.wotbtools.com",
                path = "/realms/wotbtools/broker/juhe-qq/endpoint",
                type = "wx", hasState = true, hasCode = true
            )
        )
    }

    @Test
    fun pathConfusionRejected() {
        // 尾部斜杠、后缀、/login 等都必须 reject（精确 path，无 prefix/suffix 匹配）。
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn("https", "auth.wotbtools.com",
                "/realms/wotbtools/broker/juhe-qq/endpoint/", "qq", true, true))
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn("https", "auth.wotbtools.com",
                "/realms/wotbtools/broker/juhe-qq/endpoint-evil", "qq", true, true))
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn("https", "auth.wotbtools.com",
                "/realms/wotbtools/broker/juhe-qq/login", "qq", true, true))
    }

    @Test
    fun hostCaseInsensitive() {
        assertTrue(AuthReturnPolicy.isVerifiedBrokerReturn("HTTPS", "AUTH.WOTBTOOLS.COM",
                "/realms/wotbtools/broker/juhe-qq/endpoint", "qq", true, true))
    }

    @Test
    fun nullAndBlankFieldsRejected() {
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn(null, "auth.wotbtools.com",
                "/realms/wotbtools/broker/juhe-qq/endpoint", "qq", true, true))
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn("https", null,
                "/realms/wotbtools/broker/juhe-qq/endpoint", "qq", true, true))
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn("https", "auth.wotbtools.com",
                null, "qq", true, true))
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn("https", "auth.wotbtools.com",
                "/realms/wotbtools/broker/juhe-qq/endpoint", null, true, true))
    }
}
