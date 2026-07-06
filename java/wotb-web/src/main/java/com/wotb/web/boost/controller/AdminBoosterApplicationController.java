package com.wotb.web.boost.controller;

import com.wotb.web.boost.dto.BoosterApplicationDto;
import com.wotb.web.boost.dto.ReviewBoosterApplicationRequest;
import com.wotb.web.boost.service.BoosterApplicationService;
import com.wotb.web.util.JwtUtil;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/admin/boost/booster-applications")
public class AdminBoosterApplicationController {

    private final BoosterApplicationService service;

    public AdminBoosterApplicationController(final BoosterApplicationService service) {
        this.service = service;
    }

    @GetMapping
    public Page<BoosterApplicationDto> list(
            @RequestParam(name = "status", required = false) final String status,
            @RequestParam(name = "page", defaultValue = "0") final int page,
            @RequestParam(name = "size", defaultValue = "20") final int size) {
        try {
            return service.list(status, PageRequest.of(page, size));
        } catch (final IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        }
    }

    @GetMapping("/{id}")
    public BoosterApplicationDto get(@PathVariable final Long id) {
        try {
            return service.get(id);
        } catch (final IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, e.getMessage());
        }
    }

    @PatchMapping("/{id}/reviewing")
    public BoosterApplicationDto markReviewing(@PathVariable final Long id,
                                               @RequestBody(required = false) final ReviewBoosterApplicationRequest body) {
        try {
            return service.markReviewing(id, JwtUtil.requireUserId(), adminNote(body));
        } catch (final IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        }
    }

    @PatchMapping("/{id}/approve")
    public BoosterApplicationDto approve(@PathVariable final Long id,
                                         @RequestBody(required = false) final ReviewBoosterApplicationRequest body) {
        try {
            return service.approve(id, JwtUtil.requireUserId(), adminNote(body));
        } catch (final IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        }
    }

    @PatchMapping("/{id}/reject")
    public BoosterApplicationDto reject(@PathVariable final Long id,
                                        @RequestBody(required = false) final ReviewBoosterApplicationRequest body) {
        try {
            return service.reject(id, JwtUtil.requireUserId(), adminNote(body));
        } catch (final IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        }
    }

    private static String adminNote(final ReviewBoosterApplicationRequest body) {
        return body == null ? null : body.adminNote();
    }
}
