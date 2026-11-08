package com.wotb.web.sitefeedback.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.sitefeedback.dto.SiteFeedbackCreated;
import com.wotb.web.sitefeedback.dto.SiteFeedbackPage;
import com.wotb.web.sitefeedback.dto.SiteFeedbackRecord;
import com.wotb.web.sitefeedback.service.SiteFeedbackService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import java.io.IOException;

@RestController
public class SiteFeedbackController {
    private final SiteFeedbackService service;
    public SiteFeedbackController(final SiteFeedbackService service) { this.service = service; }

    @PostMapping(value = ApiPaths.SITE_FEEDBACK, consumes = "application/json")
    public ResponseEntity<SiteFeedbackCreated> create(final HttpServletRequest request) throws IOException {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.createFromStream(request.getInputStream()));
    }

    @GetMapping(ApiPaths.ADMIN_SITE_FEEDBACK)
    public SiteFeedbackPage list(@RequestParam(name = "page", defaultValue = "0") final int page,
            @RequestParam(name = "size", defaultValue = "25") final int size,
            @RequestParam(name = "reason", required = false) final String reason) {
        return service.list(page, size, reason);
    }

    @GetMapping(ApiPaths.ADMIN_SITE_FEEDBACK + "/{id}")
    public SiteFeedbackRecord detail(@PathVariable(name = "id") final String id) { return service.get(id); }

    @PatchMapping(value = ApiPaths.ADMIN_SITE_FEEDBACK + "/{id}/status", consumes = "application/json")
    public ResponseEntity<Void> updateStatus(@PathVariable(name = "id") final String id,
            final HttpServletRequest request) throws IOException {
        service.updateStatus(id, request.getInputStream());
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping(ApiPaths.ADMIN_SITE_FEEDBACK + "/{id}")
    public ResponseEntity<Void> delete(@PathVariable(name = "id") final String id) {
        service.delete(id);
        return ResponseEntity.noContent().build();
    }
}
