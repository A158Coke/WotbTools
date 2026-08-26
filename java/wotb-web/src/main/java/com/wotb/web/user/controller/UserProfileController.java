package com.wotb.web.user.controller;

import com.wotb.web.user.dto.UpdateWotbAccountRequest;
import com.wotb.web.user.dto.UserProfileDto;
import com.wotb.web.user.service.UserProfileService;
import com.wotb.web.util.JwtUtil;
import com.wotb.web.config.ApiPaths;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(ApiPaths.USERS)
@CrossOrigin(origins = "*")
public class UserProfileController {

    private final UserProfileService service;

    public UserProfileController(final UserProfileService service) {
        this.service = service;
    }

    /** 查询当前用户资料。未创建 → 404。 */
    @GetMapping("/profile")
    public UserProfileDto getProfile() {
        final String uid = JwtUtil.requireUserId();
        return service.findByKeycloakUserId(uid)
                .orElseThrow(() -> new IllegalArgumentException("PROFILE_NOT_FOUND"));
    }

    /** 创建当前用户资料（首次进入时调用）。username 和 displayName 来自 JWT，不可修改。 */
    @PostMapping("/profile")
    public UserProfileDto createProfile() {
        return service.create(JwtUtil.requireUserId(),
                JwtUtil.currentUsername(), JwtUtil.currentDisplayName());
    }

    @PatchMapping("/wotb-account")
    public UserProfileDto updateWotbAccount(@RequestBody final UpdateWotbAccountRequest body) {
        return service.updateWotbAccount(JwtUtil.requireUserId(),
                body.wotbAccountId(), body.wotbNickname(), body.wotbServer());
    }

    /** WG 登录（ASIA/EU/NA）后的幂等同步（只读 JWT，不接受 body）。 */
    @PutMapping("/wotb-account/from-login")
    public UserProfileDto syncFromLogin() {
        return service.syncFromLogin(JwtUtil.requireUserId());
    }

    @DeleteMapping("/wotb-account")
    public UserProfileDto deleteWotbAccount() {
        return service.deleteWotbAccount(JwtUtil.requireUserId());
    }

}
