package com.wotb.web.user.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.user.dto.UpdateWotbAccountRequest;
import com.wotb.web.user.dto.UserProfileDto;
import com.wotb.web.user.service.UserProfileService;
import com.wotb.web.util.JwtUtil;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(ApiPaths.USERS)
@CrossOrigin(origins = "*")
public class UserProfileController {

    private final UserProfileService service;

    public UserProfileController(final UserProfileService service) {
        this.service = service;
    }

    /** 查询当前用户资料。未创建 → 404。（正常已认证用户经 ensure 后必然存在。） */
    @GetMapping("/profile")
    public UserProfileDto getProfile() {
        final String uid = JwtUtil.requireUserId();
        return service.findByKeycloakUserId(uid)
                .orElseThrow(() -> new IllegalArgumentException("PROFILE_NOT_FOUND"));
    }

    /**
     * 幂等 ensure 当前用户资料（全局 authenticated bootstrap 调用）。
     *
     * <p>PUT 是 ensure 语义而非 create：已存在 → 200 原样返回且不改任何绑定；不存在 → 按
     * canonical provisioning 创建。因此重复调用、并发调用、刷新后重试都安全。</p>
     *
     * <p>身份只取自当前 JWT（sub / username / displayName / 可信 claims），请求不接受任何
     * body 字段，调用方无法冒充他人。</p>
     */
    @PutMapping("/profile")
    public UserProfileDto ensureProfile() {
        return service.ensureCurrentProfile(JwtUtil.requireUserId(),
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
