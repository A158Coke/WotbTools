package com.wotb.web.battledata;

import com.wotb.web.util.admission.AnonymousAdmission;
import com.wotb.web.util.admission.TrustedClientSource;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import java.time.Clock;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class BattleDataAdmissionTest {
    @Test void sourceGlobalAndKeyBoundsRotateAndRejectedAttemptsDoNotConsumeCapacity() {
        final Clock clock = mock(Clock.class);
        when(clock.millis()).thenReturn(60_000L);
        final var source = new AnonymousAdmission(clock, 2, 3, 2);
        assertTrue(source.tryAcquire("a", 2));
        assertFalse(source.tryAcquire("a", 1));
        assertTrue(source.tryAcquire("b", 1));
        assertFalse(source.tryAcquire("c", 1));
        when(clock.millis()).thenReturn(120_000L);
        assertTrue(source.tryAcquire("c", 1));
        final var keys = new AnonymousAdmission(clock, 10, 5000, 4096);
        for (int i = 0; i < 4096; i++) { assertTrue(keys.tryAcquire("source" + i, 1)); }
        assertFalse(keys.tryAcquire("new-source", 1));
        assertTrue(keys.tryAcquire("source0", 1));
        when(clock.millis()).thenReturn(180_000L);
        assertTrue(keys.tryAcquire("new-source", 1));
    }

    @Test void trustsOnlySingleLiteralFromConfiguredProxy() {
        final var sources = new TrustedClientSource("172.29.0.0/16");
        final var request = new MockHttpServletRequest();
        request.setRemoteAddr("192.0.2.1");
        request.addHeader("X-Real-IP", "203.0.113.1");
        assertEquals("192.0.2.1", sources.resolve(request));
        request.setRemoteAddr("172.29.0.1");
        assertEquals("203.0.113.1", sources.resolve(request));
        request.addHeader("X-Real-IP", "203.0.113.2");
        assertEquals("172.29.0.1", sources.resolve(request));
        request.removeHeader("X-Real-IP");
        request.addHeader("X-Real-IP", "localhost");
        assertEquals("172.29.0.1", sources.resolve(request));
        request.removeHeader("X-Real-IP");
        request.addHeader("X-Real-IP", "2001:db8::1");
        assertEquals("2001:db8:0:0:0:0:0:1", sources.resolve(request));
    }
}
