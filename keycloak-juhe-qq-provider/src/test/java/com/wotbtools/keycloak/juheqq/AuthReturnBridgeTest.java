package com.wotbtools.keycloak.juheqq;

import org.junit.jupiter.api.Test;

import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AuthReturnBridgeTest {

    @Test
    void ticketIsOpaqueAndSingleUse() {
        final Clock clock = Clock.fixed(Instant.parse("2026-09-04T08:00:00Z"), ZoneOffset.UTC);
        final AuthReturnTicketStore store = new AuthReturnTicketStore(Duration.ofMinutes(2), clock);
        final String ticket = store.issue("secret-state", "qq", "secret-code");

        assertNotNull(ticket);
        assertFalse(ticket.contains("secret-state"));
        assertFalse(ticket.contains("secret-code"));
        final AuthReturnTicketStore.Ticket consumed = store.consume(ticket);
        assertNotNull(consumed);
        assertEquals("secret-state", consumed.state());
        assertEquals("qq", consumed.type());
        assertEquals("secret-code", consumed.code());
        assertNull(store.consume(ticket), "ticket must be single-use");
    }

    @Test
    void expiredTicketIsRejected() {
        final MutableClock clock = new MutableClock(Instant.parse("2026-09-04T08:00:00Z"));
        final AuthReturnTicketStore store = new AuthReturnTicketStore(Duration.ofSeconds(1), clock);
        final String ticket = store.issue("state", "qq", "code");

        assertNotNull(ticket);
        clock.advance(Duration.ofSeconds(2));
        assertNull(store.consume(ticket), "expired ticket must not restore auth payload");
    }

    @Test
    void androidReturnIntentTargetsOnlyWotbToolsAndHasNoBrowserFallback() {
        final URI endpoint = URI.create(
                "https://auth.wotbtools.com/realms/wotbtools/broker/juhe-qq/endpoint");
        final String intent = JuheQqEndpoint.buildAndroidReturnIntent(endpoint, "opaque-ticket-123");

        assertTrue(intent.startsWith(
                "intent://auth.wotbtools.com/realms/wotbtools/broker/juhe-qq/endpoint?"));
        assertTrue(intent.contains("type=qq&state=bridge&code=bridge&ticket=opaque-ticket-123"));
        assertTrue(intent.contains(";scheme=https;"));
        assertTrue(intent.contains(";package=com.wotbtools.app;"));
        assertFalse(intent.contains("browser_fallback_url"),
                "Chrome fallback must not consume the ticket in the wrong browser context");
        assertFalse(intent.contains("secret-state"));
        assertFalse(intent.contains("secret-code"));
    }

    @Test
    void bridgeOriginDetectionAcceptsAndroidWebViewButRejectsAndroidChrome() {
        assertTrue(JuheQqIdentityProvider.isAndroidWebViewUserAgent(
                "Mozilla/5.0 (Linux; Android 15; PHU110 Build/X; wv) AppleWebKit/537.36 "
                        + "Version/4.0 Chrome/152 Mobile Safari/537.36"));
        assertFalse(JuheQqIdentityProvider.isAndroidWebViewUserAgent(
                "Mozilla/5.0 (Linux; Android 15; PHU110) AppleWebKit/537.36 Chrome/152 Mobile Safari/537.36"));
        assertFalse(JuheQqIdentityProvider.isAndroidWebViewUserAgent(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/152"));
        assertFalse(JuheQqIdentityProvider.isAndroidWebViewUserAgent(null));
    }

    private static final class MutableClock extends Clock {
        private Instant now;

        private MutableClock(final Instant initial) {
            this.now = initial;
        }

        void advance(final Duration duration) {
            now = now.plus(duration);
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(final ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }
}
