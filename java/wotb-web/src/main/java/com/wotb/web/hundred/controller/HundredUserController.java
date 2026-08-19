package com.wotb.web.hundred.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.hundred.dto.HundredUserStatusDto;
import com.wotb.web.hundred.service.HundredBattleSubmissionService;
import com.wotb.web.util.JwtUtil;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 个人中心百场状态（/api/users/hundred/**，需登录）。 */
@RestController
@RequestMapping(ApiPaths.USERS_HUNDRED)
@CrossOrigin(origins = "*")
public class HundredUserController {

    private final HundredBattleSubmissionService service;

    public HundredUserController(final HundredBattleSubmissionService service) {
        this.service = service;
    }

    /** 当前用户百场状态：CURRENT 纪录 + PENDING 申请 + 最近拒绝反馈。 */
    @GetMapping("/status")
    public HundredUserStatusDto status() {
        return service.userStatus(JwtUtil.requireUserId());
    }
}
