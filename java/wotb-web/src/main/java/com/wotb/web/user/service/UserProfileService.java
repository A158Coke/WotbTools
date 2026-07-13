package com.wotb.web.user.service;

import com.wotb.web.user.dto.UserProfileDto;
import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.user.repository.UserProfileRepository;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;

/** 用户资料服务。创建/查询分离，username 和 displayName 来自 Keycloak 不可修改。 */
@Service
public class UserProfileService {

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
        profile.setWotbServer("CN");
        profile.setUpdatedAt(OffsetDateTime.now());
        return mapper.toDto(repository.save(profile));
    }

    /** 更新坦克世界账号绑定。 */
    @Transactional
    public UserProfileDto updateWotbAccount(final String keycloakUserId,
                                            final Long wotbAccountId,
                                            final String wotbNickname,
                                            final String wotbServer) {
        final UserProfile profile = repository.findByKeycloakUserId(keycloakUserId)
                .orElseThrow(() -> new IllegalArgumentException("PROFILE_NOT_FOUND"));

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

        profile.setWotbAccountId(null);
        profile.setWotbNickname(null);
        profile.setWotbServer("CN");
        profile.setUpdatedAt(OffsetDateTime.now());
        return mapper.toDto(repository.save(profile));
    }

}
