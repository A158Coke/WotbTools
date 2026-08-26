package com.wotb.web.replay.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.replay.dto.RatingV2Response;
import com.wotb.web.replay.service.RatingV2AdminService;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/** Hidden admin-only endpoint; SecurityConfig protects /api/admin/** with wotbtools-admin. */
@RestController
@CrossOrigin(origins = "*")
public class RatingV2AdminController {

    private final RatingV2AdminService service;

    public RatingV2AdminController(final RatingV2AdminService service) {
        this.service = service;
    }

    @PostMapping(ApiPaths.ADMIN_RATING_V2_PROCESSING_JOB)
    public RatingV2Response analyze(@PathVariable(name = "jobId") final String jobId) {
        return service.analyzeReadyJob(jobId);
    }
}
