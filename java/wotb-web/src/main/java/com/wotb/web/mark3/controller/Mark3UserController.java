package com.wotb.web.mark3.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.mark3.dto.Mark3UserStatusDto;
import com.wotb.web.mark3.service.Mark3SubmissionService;
import com.wotb.web.util.JwtUtil;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 当前用户的三环申请状态（/api/users/mark3/**，安全边界由 SecurityConfig USERS_PATTERN 覆盖）。 */
@RestController
@RequestMapping(ApiPaths.USERS_MARK3)
@CrossOrigin(origins = "*")
public class Mark3UserController {

    private final Mark3SubmissionService service;

    public Mark3UserController(final Mark3SubmissionService service) {
        this.service = service;
    }

    @GetMapping("/status")
    public Mark3UserStatusDto status() {
        return service.userStatus(JwtUtil.requireUserId());
    }
}
