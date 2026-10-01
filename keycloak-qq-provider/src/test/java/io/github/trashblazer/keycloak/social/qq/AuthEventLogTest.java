package io.github.trashblazer.keycloak.social.qq;

import org.junit.jupiter.api.Test;
import org.keycloak.broker.provider.IdentityBrokerException;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AuthEventLogTest {
    @Test
    void stableBrokerDiagnosticSurvivesWhileNestedOAuthMessagesAreRedacted() {
        var cause = new IllegalArgumentException("code=private&state=private");
        var failure = new IdentityBrokerException("QQ did not return a valid openid", cause);
        failure.addSuppressed(new RuntimeException("token=private"));
        var safe = AuthEventLog.safeOAuthThrowable(failure);
        assertEquals("QQ did not return a valid openid", safe.getMessage());
        assertEquals(IdentityBrokerException.class, safe.getClass());
        assertTrue(safe.toString().startsWith(IdentityBrokerException.class.getName()));
        assertArrayEquals(failure.getStackTrace(), safe.getStackTrace());
        assertArrayEquals(cause.getStackTrace(), safe.getCause().getStackTrace());
        assertFalse(safe.getCause().getMessage().contains("private"));
        assertFalse(safe.getSuppressed()[0].getMessage().contains("private"));
    }
}
