package com.wotb.web.hundred.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.hundred.dto.HundredUserStatusDto;
import com.wotb.web.hundred.service.HundredBattleSubmissionService;
import com.wotb.web.util.JwtUtil;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(ApiPaths.USERS_HUNDRED)
public class HundredUserController {

    private final HundredBattleSubmissionService service;

    public HundredUserController(final HundredBattleSubmissionService service) {
        this.service = service;
    }

    @GetMapping("/status")
    public HundredUserStatusDto status() {
        return service.userStatus(JwtUtil.requireUserId());
    }
}
