package com.wotbtools.keycloak.juheqq;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * JVM-local, single-use ticket store used only to bridge the Android QQ return from Chrome back
 * into the original WotBTools WebView. The ticket is opaque to Android; state/code never leave the
 * Keycloak process through the native intent.
 *
 * <p>Production currently runs one Keycloak instance. If Keycloak becomes horizontally scaled,
 * replace this store with a shared atomic store while preserving the same issue/consume contract.</p>
 */
final class AuthReturnTicketStore {

    static final int MAX_TICKETS = 2048;
    private static final int TOKEN_BYTES = 32;

    private final Duration ttl;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();
    private final Map<String, Ticket> tickets = new ConcurrentHashMap<>();

    AuthReturnTicketStore(final Duration ttl, final Clock clock) {
        if (ttl == null || ttl.isZero() || ttl.isNegative()) {
            throw new IllegalArgumentException("ttl must be positive");
        }
        this.ttl = ttl;
        this.clock = clock;
    }

    synchronized String issue(final String state, final String type, final String code) {
        cleanupExpired();
        if (tickets.size() >= MAX_TICKETS) {
            return null;
        }

        final Instant expiresAt = clock.instant().plus(ttl);
        for (int attempt = 0; attempt < 4; attempt++) {
            final byte[] bytes = new byte[TOKEN_BYTES];
            random.nextBytes(bytes);
            final String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
            if (tickets.putIfAbsent(token, new Ticket(state, type, code, expiresAt)) == null) {
                return token;
            }
        }
        return null;
    }

    Ticket consume(final String token) {
        if (token == null || token.isBlank()) {
            return null;
        }
        final Ticket ticket = tickets.remove(token);
        if (ticket == null || !ticket.expiresAt().isAfter(clock.instant())) {
            return null;
        }
        return ticket;
    }

    private void cleanupExpired() {
        final Instant now = clock.instant();
        tickets.entrySet().removeIf(entry -> !entry.getValue().expiresAt().isAfter(now));
    }

    record Ticket(String state, String type, String code, Instant expiresAt) {
    }
}
