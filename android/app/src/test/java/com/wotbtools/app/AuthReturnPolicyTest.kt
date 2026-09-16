package com.wotbtools.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AuthReturnPolicyTest {

    private val supportedPaths = listOf(
        "/realms/wotbtools/broker/idp-qq/endpoint",
        "/realms/wotbtools/broker/juhe-qq/endpoint"
    )

    @Test
    fun bothSupportedAliasesAcceptSuccessfulCallback() {
        assertTrue(AuthReturnPolicy.isVerifiedBrokerReturn(
            "https", "auth.wotbtools.com", supportedPaths[0], hasState = true, hasCode = true
        ))
        assertTrue(AuthReturnPolicy.isVerifiedBrokerReturn(
            "https", "auth.wotbtools.com", supportedPaths[1], hasState = true, hasCode = true,
            type = "qq", hasTicket = true
        ))
    }

    @Test
    fun juheAliasRequiresLegacyBridgeParameters() {
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn(
            "https", "auth.wotbtools.com", supportedPaths[1], true, true
        ))
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn(
            "https", "auth.wotbtools.com", supportedPaths[1], true, true,
            type = "wx", hasTicket = true
        ))
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn(
            "https", "auth.wotbtools.com", supportedPaths[1], true, true,
            type = "qq", hasTicket = false
        ))
    }

    @Test
    fun officialAliasAcceptsOAuthErrorCallbackWithState() {
        assertTrue(AuthReturnPolicy.isVerifiedBrokerReturn(
            "https", "auth.wotbtools.com", supportedPaths[0],
            hasState = true, hasCode = false, hasError = true
        ))
    }

    @Test
    fun wrongSchemeHostRealmProviderAndAliasRejected() {
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn(
            "http", "auth.wotbtools.com", supportedPaths[0], true, true
        ))
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn(
            "https", "evil.example", supportedPaths[0], true, true
        ))
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn(
            "https", "auth.wotbtools.com", "/realms/evil/broker/idp-qq/endpoint", true, true
        ))
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn(
            "https", "auth.wotbtools.com", "/realms/wotbtools/broker/qq/endpoint", true, true
        ))
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn(
            "https", "auth.wotbtools.com", "/realms/wotbtools/broker/other/endpoint", true, true
        ))
    }

    @Test
    fun prefixAndSuffixConfusionRejected() {
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn(
            "https", "auth.wotbtools.com", supportedPaths[0] + "/", true, true
        ))
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn(
            "https", "auth.wotbtools.com", supportedPaths[0] + "-evil", true, true
        ))
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn(
            "https", "auth.wotbtools.com", "/x${supportedPaths[0]}", true, true
        ))
    }

    @Test
    fun stateIsRequiredAndSuccessNeedsCode() {
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn(
            "https", "auth.wotbtools.com", supportedPaths[0], false, true
        ))
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn(
            "https", "auth.wotbtools.com", supportedPaths[0], true, false
        ))
    }

    @Test
    fun errorCallbackNeedsStateAndCodeAndErrorCannotBeCombined() {
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn(
            "https", "auth.wotbtools.com", supportedPaths[1], false, false, true
        ))
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn(
            "https", "auth.wotbtools.com", supportedPaths[1], true, true, true
        ))
    }

    @Test
    fun hostAndSchemeAreCaseInsensitiveButPathIsExact() {
        assertTrue(AuthReturnPolicy.isVerifiedBrokerReturn(
            "HTTPS", "AUTH.WOTBTOOLS.COM", supportedPaths[0], true, true
        ))
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn(
            null, "auth.wotbtools.com", supportedPaths[0], true, true
        ))
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn(
            "https", null, supportedPaths[0], true, true
        ))
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn(
            "https", "auth.wotbtools.com", null, true, true
        ))
    }
}
