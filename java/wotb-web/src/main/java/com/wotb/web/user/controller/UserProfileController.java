package com.wotb.web.user.controller;

import com.wotb.web.dto.LeaderboardRecordDto;
import com.wotb.web.service.LeaderboardService;
import com.wotb.web.user.dto.UpdateProfileRequest;
import com.wotb.web.user.dto.UpdateWotbAccountRequest;
import com.wotb.web.user.dto.UserProfileDto;
import com.wotb.web.user.service.UserProfileService;
import com.wotb.web.util.JwtUtil;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

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

    @GetMapping("/profile")
    public UserProfileDto getProfile() {
        final String uid = JwtUtil.requireUserId();
        return service.getOrCreate(uid, JwtUtil.currentUsername());
    }

    @PatchMapping("/profile")
    public UserProfileDto updateProfile(@RequestBody final UpdateProfileRequest body) {
        try {
            return service.updateDisplayName(JwtUtil.requireUserId(), body.displayName());
        } catch (final IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        }
    }

    @PatchMapping("/wotb-account")
    public UserProfileDto updateWotbAccount(@RequestBody final UpdateWotbAccountRequest body) {
        try {
            return service.updateWotbAccount(JwtUtil.requireUserId(),
                    body.wotbAccountId(), body.wotbNickname(), body.wotbServer());
        } catch (final IllegalArgumentException e) {
            final String msg = e.getMessage();
            if ("WOTB_ACCOUNT_ALREADY_USED".equals(msg)) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, msg);
            }
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, msg);
        }
    }

    @DeleteMapping("/wotb-account")
    public UserProfileDto deleteWotbAccount() {
        return service.deleteWotbAccount(JwtUtil.requireUserId());
    }

    @GetMapping("/profile/records")
    public List<LeaderboardRecordDto> myRecords() {
        final UserProfileDto profile = service.getOrCreate(JwtUtil.requireUserId(), null);
        if (profile.wotbAccountId() == null) {
            return List.of();
        }
        return leaderboardService.recordsByAccountId(profile.wotbAccountId(), 50);
    }
}
