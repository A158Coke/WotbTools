package com.wotb.web.boost.controller;

import com.wotb.web.boost.dto.AdminBoostRequestDto;
import com.wotb.web.boost.service.AdminBoostRequestService;
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

import java.util.Map;

/** 管理员侧需求审核 + 分配操作。只需要 boost-manager role。 */
@RestController
@RequestMapping("/api/admin/boost/requests")
public class AdminBoostRequestController {

    private final AdminBoostRequestService service;

    public AdminBoostRequestController(final AdminBoostRequestService service) {
        this.service = service;
    }

    @GetMapping
    public Page<AdminBoostRequestDto> list(
            @RequestParam(name = "status", required = false) final String status,
            @RequestParam(name = "page", defaultValue = "0") final int page,
            @RequestParam(name = "size", defaultValue = "20") final int size) {
        return service.list(status, PageRequest.of(page, size));
    }

    @GetMapping("/{id}")
    public AdminBoostRequestDto get(@PathVariable final Long id) {
        return service.get(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "需求不存在"));
    }

    @PatchMapping("/{id}/status")
    public AdminBoostRequestDto updateStatus(
            @PathVariable final Long id,
            @RequestBody final Map<String, String> body) {
        try {
            return service.updateStatus(id, body.get("status"), body.get("adminNote"));
        } catch (final IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        }
    }
}
