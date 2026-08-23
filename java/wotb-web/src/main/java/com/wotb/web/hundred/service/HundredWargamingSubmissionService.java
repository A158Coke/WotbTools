package com.wotb.web.hundred.service;

import com.wotb.web.hundred.dto.HundredWargamingSubmissionRequest;
import com.wotb.web.hundred.dto.HundredWargamingSubmissionResult;
import com.wotb.web.hundred.gateway.WargamingOfficialStats;
import com.wotb.web.hundred.gateway.WargamingServer;
import com.wotb.web.hundred.gateway.WargamingStatsHttpGateway;
import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.user.service.UserProfileService;
import com.wotb.web.util.JwtUtil;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.server.ResponseStatusException;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;

/** WG 官方统计链路：可信身份交叉校验 → 外部查询 → 零文件 submission 决策。 */
@Service
public class HundredWargamingSubmissionService {

    private static final long MIN_ACCOUNT_BATTLES = 5_000L;
    private static final long MIN_TANK_BATTLES = 100L;

    private final UserProfileService userProfileService;
    private final WargamingStatsHttpGateway statsGateway;
    private final HundredBattleSubmissionService submissionService;

    public HundredWargamingSubmissionService(final UserProfileService userProfileService,
                                             final WargamingStatsHttpGateway statsGateway,
                                             final HundredBattleSubmissionService submissionService) {
        this.userProfileService = userProfileService;
        this.statsGateway = statsGateway;
        this.submissionService = submissionService;
    }

    public HundredWargamingSubmissionResult create(final String userId,
                                                   final HundredWargamingSubmissionRequest request) {
        if (request == null || request.averageDamage() <= 0 || request.battleCount() <= 0) {
            throw new IllegalArgumentException("HUNDRED_INVALID_CLAIM");
        }
        final TrustedIdentity identity = requireTrustedIdentity(userId);
        // cheap preflight 在外部调用前完成；事务写入阶段仍会重检 PENDING/Tier X。
        submissionService.validateWargamingPreflight(userId, request.vehicleId());

        final WargamingOfficialStats stats = statsGateway.fetch(
                identity.server(), identity.accountId(), request.vehicleId());
        requireOfficialIdentity(identity, stats, request.vehicleId());
        if (stats.accountBattleCount() < MIN_ACCOUNT_BATTLES) {
            throw new IllegalArgumentException("HUNDRED_WARGAMING_ACCOUNT_BATTLES_TOO_LOW");
        }
        if (stats.tankBattleCount() < MIN_TANK_BATTLES) {
            throw new IllegalArgumentException("HUNDRED_WARGAMING_TANK_BATTLES_TOO_LOW");
        }
        if (stats.tankBattleCount() > stats.accountBattleCount()
                || stats.tankBattleCount() > Integer.MAX_VALUE
                || stats.tankDamageDealt() < 0) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_GATEWAY, "HUNDRED_WARGAMING_INVALID_RESPONSE");
        }

        return submissionService.createWargamingSubmission(
                userId, request.averageDamage(), request.battleCount(), stats,
                OffsetDateTime.now(ZoneOffset.UTC));
    }

    private TrustedIdentity requireTrustedIdentity(final String userId) {
        final WargamingServer server = WargamingServer.fromCode(JwtUtil.currentWotbRegion());
        final Long accountId = JwtUtil.currentWotbAccountId();
        final String nickname = normalized(JwtUtil.currentWotbNickname());
        if (!JwtUtil.currentWotbVerified() || server == null || accountId == null || nickname == null) {
            throw new IllegalArgumentException("HUNDRED_WARGAMING_IDENTITY_REQUIRED");
        }
        final UserProfile profile = userProfileService.findEntityByKeycloakUserId(userId)
                .orElseThrow(() -> new IllegalArgumentException("HUNDRED_WARGAMING_IDENTITY_REQUIRED"));
        if (!userId.equals(profile.getKeycloakUserId())
                || !"WARGAMING".equals(profile.getWotbAccountSource())
                || !server.name().equals(profile.getWotbServer())
                || !accountId.equals(profile.getWotbAccountId())
                || profile.getWotbAccountVerifiedAt() == null
                || !nickname.equals(normalized(profile.getWotbNickname()))) {
            throw new IllegalArgumentException("HUNDRED_WARGAMING_IDENTITY_MISMATCH");
        }
        return new TrustedIdentity(server, accountId, nickname);
    }

    private static void requireOfficialIdentity(final TrustedIdentity identity,
                                                final WargamingOfficialStats stats,
                                                final long vehicleId) {
        if (stats == null
                || !identity.server().name().equals(stats.server())
                || identity.accountId() != stats.accountId()
                || vehicleId != stats.vehicleId()
                || !identity.nickname().equals(normalized(stats.nickname()))) {
            throw new IllegalArgumentException("HUNDRED_WARGAMING_IDENTITY_MISMATCH");
        }
    }

    private static String normalized(final String value) {
        return StringUtils.hasText(value) ? value.trim() : null;
    }

    private record TrustedIdentity(WargamingServer server, long accountId, String nickname) {
    }
}
