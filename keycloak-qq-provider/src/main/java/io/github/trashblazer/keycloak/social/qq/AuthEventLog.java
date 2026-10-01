package io.github.trashblazer.keycloak.social.qq;

import java.util.IdentityHashMap;
import java.util.HashMap;
import java.util.Map;
import org.jboss.logging.MDC;
import org.jboss.logging.Logger;

/** Secret-safe authentication diagnostics for this independently built provider JAR. */
final class AuthEventLog {
    private static final Logger LOG = Logger.getLogger(AuthEventLog.class);
    private AuthEventLog() { }

    static void rejected(String provider, String stage, String errorCode) {
        emit(Logger.Level.WARN, "auth_rejected", provider, stage, errorCode, "rejected", null);
    }

    static void degraded(String provider, String stage, String errorCode) {
        emit(Logger.Level.WARN, "auth_fallback", provider, stage, errorCode, "degraded", null);
    }

    static void success(String provider) {
        emit(Logger.Level.INFO, "auth_broker_verified", provider, "identity", "NONE", "success", null);
    }

    static void failure(String provider, String stage, String errorCode, Throwable failure) {
        emit(Logger.Level.ERROR, "auth_failure", provider, stage, errorCode, "failed", safeOAuthThrowable(failure));
    }

    private static void emit(Logger.Level level, String event, String provider, String stage,
                             String errorCode, String outcome, Throwable failure) {
        Map<String, String> fields = Map.of("service", "keycloak", "event", event, "provider", provider,
                "stage", stage, "errorCode", errorCode, "outcome", outcome);
        Map<String, Object> previous = new HashMap<>();
        fields.forEach((key, value) -> { previous.put(key, MDC.get(key)); MDC.put(key, value); });
        try {
            LOG.log(level, "event=" + event + " service=keycloak provider=" + provider
                    + " stage=" + stage + " errorCode=" + errorCode + " outcome=" + outcome, failure);
        } finally {
            previous.forEach((key, value) -> { if (value == null) MDC.remove(key); else MDC.put(key, value); });
        }
    }

    // OAuth HTTP/parser exception messages may embed URLs, response bodies and credentials.
    // Preserve the complete cause/suppressed topology and stack frames, but never those messages.
    static Throwable safeOAuthThrowable(Throwable failure) {
        return copy(failure, new IdentityHashMap<>());
    }

    private static Throwable copy(Throwable failure, IdentityHashMap<Throwable, Throwable> seen) {
        if (failure == null) return null;
        Throwable existing = seen.get(failure);
        if (existing != null) return existing;
        String message = failure.getMessage();
        boolean stableProviderDiagnostic = failure instanceof org.keycloak.broker.provider.IdentityBrokerException
                && java.util.Set.of("QQ did not return a valid openid", "QQ user information request was rejected",
                        "QQ login failed").contains(message == null ? "" : message);
        Throwable safe = stableProviderDiagnostic ? new org.keycloak.broker.provider.IdentityBrokerException(message)
                : new OAuthBoundaryThrowable(failure.getClass().getName());
        safe.setStackTrace(failure.getStackTrace());
        seen.put(failure, safe);
        Throwable cause = copy(failure.getCause(), seen);
        if (cause != null && cause != safe) safe.initCause(cause);
        for (Throwable suppressed : failure.getSuppressed()) {
            Throwable redacted = copy(suppressed, seen);
            if (redacted != safe) safe.addSuppressed(redacted);
        }
        return safe;
    }

    private static final class OAuthBoundaryThrowable extends Throwable {
        private final String originalType;

        private OAuthBoundaryThrowable(String originalType) {
            super(originalType + " [OAuth message redacted]");
            this.originalType = originalType;
        }

        @Override
        public String toString() { return originalType + ": " + getMessage(); }
    }
}
