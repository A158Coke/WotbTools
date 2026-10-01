package com.wotbtools.keycloak.wargaming;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AuthEventLogTest {
    @Test
    void retainsNumericProviderCodeAndRestoresCallerMdc() {
        org.jboss.logging.MDC.put("event", "caller");
        try {
            AuthEventLog.rejected("wargaming", "callback", "WG_STATE_INVALID");
            assertEquals("caller", org.jboss.logging.MDC.get("event"));
            assertNull(org.jboss.logging.MDC.get("provider"));
            assertNull(org.jboss.logging.MDC.get("userId"));
            Throwable safe = AuthEventLog.safeThrowable(
                    new WargamingApiClient.WargamingApiException("WG API rejected request: code=404"));
            assertTrue(safe.getMessage().contains("code=404"));
        } finally {
            org.jboss.logging.MDC.remove("event");
        }
    }

    @Test
    void preservesStackCauseAndSuppressedWithoutOAuthSecrets() {
        RuntimeException cause = new RuntimeException("access_token=secret");
        RuntimeException failure = new RuntimeException("state=raw&code=oauth", cause);
        failure.addSuppressed(new IllegalStateException("cookie=secret"));
        Throwable safe = AuthEventLog.safeThrowable(failure);
        assertArrayEquals(failure.getStackTrace(), safe.getStackTrace());
        assertArrayEquals(cause.getStackTrace(), safe.getCause().getStackTrace());
        assertTrue(safe.getMessage().contains(RuntimeException.class.getName()));
        assertFalse(safe.getMessage().contains("raw"));
        assertFalse(safe.getCause().getMessage().contains("secret"));
        assertEquals(1, safe.getSuppressed().length);
        assertFalse(safe.getSuppressed()[0].getMessage().contains("cookie"));
    }
}
