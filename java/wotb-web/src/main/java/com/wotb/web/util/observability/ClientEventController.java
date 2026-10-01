package com.wotb.web.util.observability;

import com.wotb.web.util.apierror.ApiErrorFactory;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;

@RestController
public class ClientEventController {
    private final ClientEventService service;
    private final ApiErrorFactory errors;

    public ClientEventController(final ClientEventService service, final ApiErrorFactory errors) {
        this.service = service;
        this.errors = errors;
    }

    @PostMapping(value = "/api/observability/client-events", consumes = "application/json")
    public ResponseEntity<?> report(final HttpServletRequest request) throws IOException {
        final HttpStatus status = service.accept(request);
        if (status == HttpStatus.NO_CONTENT) return ResponseEntity.noContent().build();
        final String code = switch (status) {
            case CONTENT_TOO_LARGE -> "UPLOAD_TOO_LARGE";
            case TOO_MANY_REQUESTS -> "RATE_LIMITED";
            default -> "INVALID_REQUEST";
        };
        return ResponseEntity.status(status).body(errors.create(code, status, request));
    }
}
