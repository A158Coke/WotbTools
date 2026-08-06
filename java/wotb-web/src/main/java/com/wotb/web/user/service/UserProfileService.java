package com.wotb.web.user.service;

import com.wotb.web.user.dto.UserProfileDto;
import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.user.repository.UserProfileRepository;
import com.wotb.web.util.JwtUtil;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/** 用户资料服务。创建/查询分离，username 和 displayName 来自 Keycloak 不可修改。 */
@Service
public class UserProfileService {

    /** WG Provider 支持的区服（与 Keycloak {@code WargamingRegion} 枚举一致）。 */
    private static final Set<String> WG_REGIONS = Set.of("ASIA", "EU", "NA");

    private final UserProfileRepository repository;
    private final UserProfileMapper mapper;

    public UserProfileService(final UserProfileRepository repository, final UserProfileMapper mapper) {
        this.repository = repository;
        this.mapper = mapper;
    }

    /** 查询用户资料，不存在则返回 empty。 */
    @Transactional(readOnly = true)
    public Optional<UserProfileDto> findByKeycloakUserId(final String keycloakUserId) {
        return repository.findByKeycloakUserId(keycloakUserId).map(mapper::toDto);
    }

    /** 供其他业务域编排使用的内部实体查询。 */
    @Transactional(readOnly = true)
    public Optional<UserProfile> findEntityByKeycloakUserId(final String keycloakUserId) {
        return repository.findByKeycloakUserId(keycloakUserId);
    }

    /** 供跨域写操作串行化用户删除、打手创建与换绑。 */
    @Transactional
    public Optional<UserProfile> findEntityByKeycloakUserIdForUpdate(final String keycloakUserId) {
        return repository.findByKeycloakUserIdForUpdate(keycloakUserId);
    }

    /** 管理端用户检索，Repository 保持封装在 user 域内。 */
    @Transactional(readOnly = true)
    public List<UserProfile> searchForAdministration(final String query, final int limit) {
        final int effectiveLimit = Math.clamp(limit, 1, 100);
        if (!StringUtils.hasText(query)) {
            return repository.findAll(
                    PageRequest.of(0, effectiveLimit, Sort.by(Sort.Direction.DESC, "createdAt")))
                    .getContent();
        }
        return repository.searchAdminUsers(query.trim(), PageRequest.of(0, effectiveLimit));
    }

    /** 管理端删除入口；flush 让约束异常在调用方补偿范围内暴露。 */
    @Transactional
    public void deleteForAdministration(final UserProfile profile) {
        repository.delete(profile);
        repository.flush();
    }

    /** 创建用户资料（首次登录时由前端 POST /profile 触发）。 */
    @Transactional
    public UserProfileDto create(final String keycloakUserId, final String username, final String displayName) {
        if (repository.findByKeycloakUserId(keycloakUserId).isPresent()) {
            throw new IllegalArgumentException("PROFILE_ALREADY_EXISTS");
        }

        final UserProfile profile = new UserProfile();
        profile.setKeycloakUserId(keycloakUserId);
        profile.setUsername(username);
        profile.setDisplayName(displayName);
        final String trustedRegion = trustedWgRegionOrNull();
        if (trustedRegion != null) {
            // WG 用户（ASIA/EU/NA）：首次创建即写入官方资料，来源 WARGAMING、验证时间=首次可信同步时间。
            profile.setWotbServer(trustedRegion);
            profile.setWotbAccountId(JwtUtil.currentWotbAccountId());
            profile.setWotbNickname(JwtUtil.currentWotbNickname());
            profile.setWotbAccountSource("WARGAMING");
            profile.setWotbAccountVerifiedAt(OffsetDateTime.now());
        } else {
            profile.setWotbServer("CN");
            profile.setWotbAccountSource("MANUAL");
        }
        profile.setUpdatedAt(OffsetDateTime.now());
        try {
            return mapper.toDto(repository.save(profile));
        } catch (final DataIntegrityViolationException e) {
            throw new IllegalArgumentException("WOTB_ACCOUNT_ALREADY_USED");
        }
    }

    /**
     * 幂等同步接口：仅 WG 可信 claims（ASIA/EU/NA）可调用。
     * 允许刷新官方昵称；不刷新 verified_at；不允许 CN→WG 覆盖或切换 account_id。
     */
    @Transactional
    public UserProfileDto syncFromLogin(final String keycloakUserId) {
        final String trustedRegion = trustedWgRegionOrNull();
        if (trustedRegion == null) {
            throw new IllegalArgumentException("WOTB_CLAIMS_INVALID");
        }
        final Long accountId = JwtUtil.currentWotbAccountId();
        final String nickname = JwtUtil.currentWotbNickname();

        final UserProfile profile = repository.findByKeycloakUserId(keycloakUserId)
                .orElseThrow(() -> new IllegalArgumentException("PROFILE_NOT_FOUND"));

        if (!trustedRegion.equals(profile.getWotbServer())) {
            throw new IllegalArgumentException("PROFILE_REGION_MISMATCH");
        }
        if (!accountId.equals(profile.getWotbAccountId())) {
            throw new IllegalArgumentException("WOTB_ACCOUNT_MISMATCH");
        }
        final boolean duplicate = repository.existsByWotbServerAndWotbAccountIdAndKeycloakUserIdNot(
                trustedRegion, accountId, keycloakUserId);
        if (duplicate) {
            throw new IllegalArgumentException("WOTB_ACCOUNT_ALREADY_USED");
        }

        try {
            if (!nickname.equals(profile.getWotbNickname())) {
                profile.setWotbNickname(nickname);
                profile.setUpdatedAt(OffsetDateTime.now());
                // 决策 D8：昵称刷新不更新 verified_at。
            }
            return mapper.toDto(repository.save(profile));
        } catch (final DataIntegrityViolationException e) {
            // 并发窗口内 (region, account_id) 被其他用户占用：与手动绑定同一错误码。
            throw new IllegalArgumentException("WOTB_ACCOUNT_ALREADY_USED");
        }
    }

    /** 更新坦克世界账号绑定。 */
    @Transactional
    public UserProfileDto updateWotbAccount(final String keycloakUserId,
                                            final Long wotbAccountId,
                                            final String wotbNickname,
                                            final String wotbServer) {
        final UserProfile profile = repository.findByKeycloakUserId(keycloakUserId)
                .orElseThrow(() -> new IllegalArgumentException("PROFILE_NOT_FOUND"));

        if ("WARGAMING".equals(profile.getWotbAccountSource())) {
            throw new IllegalArgumentException(readOnlyErrorCode(profile.getWotbServer()));
        }
        if (wotbAccountId == null || wotbAccountId <= 0) {
            throw new IllegalArgumentException("INVALID_WOTB_ACCOUNT_ID");
        }
        final String server = wotbServer != null ? wotbServer.toUpperCase() : "CN";
        if (!"CN".equals(server)) {
            throw new IllegalArgumentException("UNSUPPORTED_WOTB_SERVER");
        }
        if (wotbNickname != null && wotbNickname.length() > 64) {
            throw new IllegalArgumentException("INVALID_WOTB_ACCOUNT_ID");
        }

        final boolean duplicate = repository.existsByWotbServerAndWotbAccountIdAndKeycloakUserIdNot(
                server, wotbAccountId, keycloakUserId);
        if (duplicate) {
            throw new IllegalArgumentException("WOTB_ACCOUNT_ALREADY_USED");
        }

        profile.setWotbAccountId(wotbAccountId);
        profile.setWotbNickname(wotbNickname);
        profile.setWotbServer(server);
        profile.setUpdatedAt(OffsetDateTime.now());

        try {
            return mapper.toDto(repository.save(profile));
        } catch (final DataIntegrityViolationException e) {
            throw new IllegalArgumentException("WOTB_ACCOUNT_ALREADY_USED");
        }
    }

    /** 清空坦克世界账号绑定。 */
    @Transactional
    public UserProfileDto deleteWotbAccount(final String keycloakUserId) {
        final UserProfile profile = repository.findByKeycloakUserId(keycloakUserId)
                .orElseThrow(() -> new IllegalArgumentException("PROFILE_NOT_FOUND"));

        if ("WARGAMING".equals(profile.getWotbAccountSource())) {
            throw new IllegalArgumentException(readOnlyErrorCode(profile.getWotbServer()));
        }
        profile.setWotbAccountId(null);
        profile.setWotbNickname(null);
        profile.setWotbServer("CN");
        profile.setUpdatedAt(OffsetDateTime.now());
        return mapper.toDto(repository.save(profile));
    }

    /** 可信 WG claims：verified == true && region ∈ {ASIA, EU, NA} && accountId 有效 && 昵称非空。 */
    private static String trustedWgRegionOrNull() {
        final String region = JwtUtil.currentWotbRegion();
        final Long accountId = JwtUtil.currentWotbAccountId();
        final String nickname = JwtUtil.currentWotbNickname();
        if (!JwtUtil.currentWotbVerified() || region == null || !WG_REGIONS.contains(region)) {
            return null;
        }
        return accountId != null && StringUtils.hasText(nickname) ? region : null;
    }

    /** ASIA 沿用既有错误码（前端已消费）；EU/NA 使用泛化错误码。 */
    private static String readOnlyErrorCode(final String server) {
        return "ASIA".equals(server) ? "ASIA_PROFILE_READONLY" : "WARGAMING_PROFILE_READONLY";
    }

}
