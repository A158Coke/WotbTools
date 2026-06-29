package com.wotb.web.boost.controller;

import com.wotb.web.boost.dto.BoostOptionsDto;
import com.wotb.web.boost.service.BoostOptionsService;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 公开选项接口 — 无需登录。 */
@RestController
@RequestMapping("/api/boost")
@CrossOrigin(origins = "*")
public class BoostOptionsController {

    private final BoostOptionsService service;

    public BoostOptionsController(final BoostOptionsService service) {
        this.service = service;
    }

    @GetMapping("/options")
    public BoostOptionsDto options() {
        return service.options();
    }
}
