package com.wotb.web.boost.controller;

import com.wotb.web.boost.dto.BoosterDto;
import com.wotb.web.boost.dto.CreateBoosterRequest;
import com.wotb.web.boost.dto.UpdateBoosterAvailabilityRequest;
import com.wotb.web.boost.dto.UpdateBoosterRequest;
import com.wotb.web.boost.service.BoosterService;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

/** 管理员侧打手管理接口。 */
@RestController
@RequestMapping("/api/admin/boost/boosters")
@CrossOrigin(origins = "*")
public class AdminBoosterController {

    private final BoosterService service;

    public AdminBoosterController(final BoosterService service) {
        this.service = service;
    }

    @PostMapping
    public BoosterDto create(@RequestBody final CreateBoosterRequest body) {
        try {
            return service.create(
                    body.nickname(), body.level(), body.available(), body.status(),
                    body.contactType(), body.contactValue(),
                    body.specialties(), body.description()
            );
        } catch (final IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        }
    }

    @GetMapping
    public Page<BoosterDto> list(
            @RequestParam(name = "status", required = false) final String status,
            @RequestParam(name = "available", required = false) final Boolean available,
            @RequestParam(name = "page", defaultValue = "0") final int page,
            @RequestParam(name = "size", defaultValue = "20") final int size) {
        return service.list(status, available, PageRequest.of(page, size));
    }

    @GetMapping("/{id}")
    public BoosterDto get(@PathVariable final Long id) {
        try {
            return service.getDto(id);
        } catch (final IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "打手不存在");
        }
    }

    @PatchMapping("/{id}")
    public BoosterDto update(@PathVariable final Long id,
                             @RequestBody final UpdateBoosterRequest body) {
        try {
            return service.update(
                    id, body.nickname(), body.level(), body.available(), body.status(),
                    body.contactType(), body.contactValue(),
                    body.specialties(), body.description()
            );
        } catch (final IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        }
    }

    @PatchMapping("/{id}/availability")
    public Map<String, Object> setAvailability(@PathVariable final Long id,
                                               @RequestBody final UpdateBoosterAvailabilityRequest body) {
        try {
            final BoosterDto dto = service.setAvailability(id, body.available());
            return Map.of("id", dto.id(), "available", dto.available(), "updatedAt", dto.updatedAt());
        } catch (final IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        }
    }
}
