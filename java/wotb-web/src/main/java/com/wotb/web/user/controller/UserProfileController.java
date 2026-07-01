package com.wotb.web.user.controller;

import com.wotb.web.leaderboard.dto.LeaderboardRecordDto;
import com.wotb.web.leaderboard.service.LeaderboardService;
import com.wotb.web.user.dto.UpdateWotbAccountRequest;
import com.wotb.web.user.dto.UserProfileDto;
import com.wotb.web.user.service.UserProfileService;
import com.wotb.web.util.JwtUtil;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/users")
@CrossOrigin(origins = "*")
public class UserProfileController {

    private final UserProfileService service;
    private final LeaderboardService leaderboardService;

    public UserProfileController(final UserProfileService service,
                                  final LeaderboardService leaderboardService) {
        this.service = service;
        this.leaderboardService = leaderboardService;
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

    @DeleteMapping("/wotb-account")
    public UserProfileDto deleteWotbAccount() {
        return service.deleteWotbAccount(JwtUtil.requireUserId());
    }

    /** 当前用户的排行榜战绩。 */
    @GetMapping("/profile/records")
    public List<LeaderboardRecordDto> myRecords() {
        final var profileOpt = service.findByKeycloakUserId(JwtUtil.requireUserId());
        if (profileOpt.isEmpty() || profileOpt.get().wotbAccountId() == null) {
            return List.of();
        }
        return leaderboardService.recordsByAccountId(profileOpt.get().wotbAccountId(), 50);
    }
}
