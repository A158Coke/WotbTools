package com.wotb.web.boost.controller;

import com.wotb.web.boost.dto.BoosterDto;
import com.wotb.web.boost.dto.CreateBoosterRequest;
import com.wotb.web.boost.dto.UpdateBoosterAvailabilityRequest;
import com.wotb.web.boost.dto.UpdateBoosterRequest;
import com.wotb.web.boost.service.BoosterService;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

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
        return service.create(
                body.nickname(), body.level(), body.keycloakUserId(),
                body.available(), body.status(),
                body.contactType(), body.contactValue(),
                body.specialties(), body.description()
        );
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@PathVariable final Long id) {
        service.deleteById(id);
        return Map.of("id", id, "deleted", true);
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
        return service.getDto(id);
    }

    @PatchMapping("/{id}")
    public BoosterDto update(@PathVariable final Long id,
                             @RequestBody final UpdateBoosterRequest body) {
        return service.update(
                id, body.nickname(), body.level(), body.keycloakUserId(),
                body.available(), body.status(),
                body.contactType(), body.contactValue(),
                body.specialties(), body.description()
        );
    }

    @PatchMapping("/{id}/availability")
    public Map<String, Object> setAvailability(@PathVariable final Long id,
                                               @RequestBody final UpdateBoosterAvailabilityRequest body) {
        final BoosterDto dto = service.setAvailability(id, body.available());
        return Map.of("id", dto.id(), "available", dto.available(), "updatedAt", dto.updatedAt());
    }
}
