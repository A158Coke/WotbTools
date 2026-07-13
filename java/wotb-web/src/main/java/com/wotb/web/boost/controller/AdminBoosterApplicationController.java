package com.wotb.web.boost.controller;

import com.wotb.web.boost.dto.BoosterApplicationDto;
import com.wotb.web.boost.dto.ReviewBoosterApplicationRequest;
import com.wotb.web.boost.service.BoosterApplicationService;
import com.wotb.web.util.JwtUtil;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

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
        return service.list(status, PageRequest.of(page, size));
    }

    @GetMapping("/{id}")
    public BoosterApplicationDto get(@PathVariable final Long id) {
        return service.get(id);
    }

    @PatchMapping("/{id}/reviewing")
    public BoosterApplicationDto markReviewing(@PathVariable final Long id,
                                               @RequestBody(required = false) final ReviewBoosterApplicationRequest body) {
        return service.markReviewing(id, JwtUtil.requireUserId(), adminNote(body));
    }

    @PatchMapping("/{id}/approve")
    public BoosterApplicationDto approve(@PathVariable final Long id,
                                         @RequestBody(required = false) final ReviewBoosterApplicationRequest body) {
        return service.approve(id, JwtUtil.requireUserId(), adminNote(body));
    }

    @PatchMapping("/{id}/reject")
    public BoosterApplicationDto reject(@PathVariable final Long id,
                                        @RequestBody(required = false) final ReviewBoosterApplicationRequest body) {
        return service.reject(id, JwtUtil.requireUserId(), adminNote(body));
    }

    private static String adminNote(final ReviewBoosterApplicationRequest body) {
        return body == null ? null : body.adminNote();
    }
}
