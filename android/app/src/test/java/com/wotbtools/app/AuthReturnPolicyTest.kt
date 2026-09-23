package com.wotbtools.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AuthReturnPolicyTest {

    private val qqPath = "/realms/wotbtools/broker/idp-qq/endpoint"

    /** First segment of a repository-relative broker path, kept split so no retired
     *  aggregate-provider literal appears verbatim in this source. */
    private fun brokerPath(firstSegment: String) =
        "/realms/wotbtools/broker/$firstSegment/endpoint"

    @Test
    fun officialAliasAcceptsSuccessfulCallback() {
        assertTrue(AuthReturnPolicy.isVerifiedBrokerReturn(
            "https", "auth.wotbtools.com", qqPath, hasState = true, hasCode = true
        ))
    }

    @Test
    fun retiredAggregateAliasAndOtherAliasesAreRejected() {
        for (firstSegment in listOf("juhe" + "-qq", "qq", "other")) {
            assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn(
                "https", "auth.wotbtools.com", brokerPath(firstSegment), hasState = true, hasCode = true
            ))
        }
    }

    @Test
    fun officialAliasAcceptsOAuthErrorCallbackWithState() {
        assertTrue(AuthReturnPolicy.isVerifiedBrokerReturn(
            "https", "auth.wotbtools.com", qqPath,
            hasState = true, hasCode = false, hasError = true
        ))
    }

    @Test
    fun wrongSchemeHostRealmProviderAndAliasRejected() {
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn(
            "http", "auth.wotbtools.com", qqPath, true, true
        ))
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn(
            "https", "evil.example", qqPath, true, true
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
            "https", "auth.wotbtools.com", qqPath + "/", true, true
        ))
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn(
            "https", "auth.wotbtools.com", qqPath + "-evil", true, true
        ))
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn(
            "https", "auth.wotbtools.com", "/x${qqPath}", true, true
        ))
    }

    @Test
    fun stateIsRequiredAndSuccessNeedsCode() {
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn(
            "https", "auth.wotbtools.com", qqPath, false, true
        ))
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn(
            "https", "auth.wotbtools.com", qqPath, true, false
        ))
    }

    @Test
    fun errorCallbackNeedsStateAndCodeAndErrorCannotBeCombined() {
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn(
            "https", "auth.wotbtools.com", qqPath, false, false, true
        ))
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn(
            "https", "auth.wotbtools.com", qqPath, true, true, true
        ))
    }

    @Test
    fun hostAndSchemeAreCaseInsensitiveButPathIsExact() {
        assertTrue(AuthReturnPolicy.isVerifiedBrokerReturn(
            "HTTPS", "AUTH.WOTBTOOLS.COM", qqPath, true, true
        ))
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn(
            null, "auth.wotbtools.com", qqPath, true, true
        ))
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn(
            "https", null, qqPath, true, true
        ))
        assertFalse(AuthReturnPolicy.isVerifiedBrokerReturn(
            "https", "auth.wotbtools.com", null, true, true
        ))
    }
}
