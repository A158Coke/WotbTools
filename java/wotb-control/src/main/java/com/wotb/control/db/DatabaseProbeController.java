package com.wotb.control.db;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Protected operational probe for the future Control API boundary. */
@RestController
public class DatabaseProbeController {
    private final DatabaseProbeService probeService;

    public DatabaseProbeController(final DatabaseProbeService probeService) {
        this.probeService = probeService;
    }

    @GetMapping("/api/control/db")
    public ResponseEntity<DatabaseProbeResponse> probe() {
        if (probeService.isAvailable()) {
            return ResponseEntity.ok(new DatabaseProbeResponse("UP"));
        }
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(new DatabaseProbeResponse("DOWN"));
    }

    public record DatabaseProbeResponse(String status) {
    }
}
