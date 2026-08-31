package com.wotb.control.db;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class DatabaseProbeControllerTest {
    private final DatabaseProbeService probeService = mock(DatabaseProbeService.class);
    private final DatabaseProbeController controller = new DatabaseProbeController(probeService);

    @Test
    void healthyProbeReturnsUpWithoutPersistingAJob() {
        when(probeService.isAvailable()).thenReturn(true);

        final var response = controller.probe();

        assertEquals(200, response.getStatusCode().value());
        assertEquals("UP", response.getBody().status());
    }

    @Test
    void unavailableProbeReturnsSanitizedServiceUnavailableResponse() {
        when(probeService.isAvailable()).thenReturn(false);

        final var response = controller.probe();

        assertEquals(503, response.getStatusCode().value());
        assertEquals("DOWN", response.getBody().status());
    }
}
