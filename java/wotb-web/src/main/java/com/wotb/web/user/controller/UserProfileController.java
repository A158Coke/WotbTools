package com.wotb.web.user.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.user.dto.UpdateWotbAccountRequest;
import com.wotb.web.user.dto.UserProfileDto;
import com.wotb.web.user.dto.OnboardingReceiptDto;
import com.wotb.web.user.dto.SaveOnboardingReceiptRequest;
import com.wotb.web.user.dto.VerifyWotbAccountFromReplayRequest;
import com.wotb.web.user.service.UserProfileService;
import com.wotb.web.util.JwtUtil;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(ApiPaths.USERS)
public class UserProfileController {

    private final UserProfileService service;

    public UserProfileController(final UserProfileService service) {
        this.service = service;
    }

    @GetMapping("/profile")
    public UserProfileDto getProfile() {
        final String uid = JwtUtil.requireUserId();
        return service.findByKeycloakUserId(uid)
                .orElseThrow(() -> new IllegalArgumentException("PROFILE_NOT_FOUND"));
    }

    @PutMapping("/profile")
    public UserProfileDto ensureProfile() {
        return service.ensureCurrentProfile(JwtUtil.requireUserId(),
                JwtUtil.currentUsername(), JwtUtil.currentDisplayName());
    }

    @GetMapping("/onboarding")
    public OnboardingReceiptDto readOnboardingReceipt() {
        return service.readOnboardingReceipt(JwtUtil.requireUserId());
    }

    @PutMapping("/onboarding")
    public OnboardingReceiptDto saveOnboardingReceipt(@RequestBody final SaveOnboardingReceiptRequest body) {
        return service.saveOnboardingReceipt(JwtUtil.requireUserId(), body.coreEpoch(), body.disposition());
    }

    @PatchMapping("/wotb-account")
    public UserProfileDto updateWotbAccount(@RequestBody final UpdateWotbAccountRequest body) {
        return service.updateWotbAccount(JwtUtil.requireUserId(),
                body.wotbAccountId(), body.wotbNickname(), body.wotbServer());
    }

    @PutMapping("/wotb-account/from-login")
    public UserProfileDto syncFromLogin() {
        return service.syncFromLogin(JwtUtil.requireUserId());
    }

    @PostMapping("/wotb-account/verify-replay")
    public UserProfileDto verifyWotbAccountFromReplay(@RequestBody final VerifyWotbAccountFromReplayRequest body) {
        return service.verifyWotbAccountFromReplay(JwtUtil.requireUserId(), body.recorderAccountId());
    }

    @DeleteMapping("/wotb-account")
    public UserProfileDto deleteWotbAccount() {
        return service.deleteWotbAccount(JwtUtil.requireUserId());
    }

}
