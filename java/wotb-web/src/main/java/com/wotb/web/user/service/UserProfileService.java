package com.wotb.web.user.service;

import com.wotb.web.user.dto.UserProfileDto;
import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.user.repository.UserProfileRepository;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;

/** 用户资料服务：lazy create + CRUD。 */
@Service
public class UserProfileService {

    private final UserProfileRepository repository;

    public UserProfileService(final UserProfileRepository repository) {
        this.repository = repository;
    }

    @Transactional
    public UserProfileDto getOrCreate(final String keycloakUserId, final String defaultDisplayName) {
        return toDto(findOrCreate(keycloakUserId, defaultDisplayName));
    }

    @Transactional
    public UserProfileDto updateDisplayName(final String keycloakUserId, final String displayName) {
        final UserProfile profile = findOrCreate(keycloakUserId, null);
        if (displayName == null || displayName.isBlank() || displayName.length() > 64) {
            throw new IllegalArgumentException("INVALID_DISPLAY_NAME");
        }
        profile.setDisplayName(displayName.trim());
        profile.setUpdatedAt(OffsetDateTime.now());
        repository.save(profile);
        return toDto(profile);
    }

    @Transactional
    public UserProfileDto updateWotbAccount(final String keycloakUserId,
                                            final Long wotbAccountId,
                                            final String wotbNickname,
                                            final String wotbServer) {
        final UserProfile profile = findOrCreate(keycloakUserId, null);

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
            repository.save(profile);
        } catch (final DataIntegrityViolationException e) {
            throw new IllegalArgumentException("WOTB_ACCOUNT_ALREADY_USED");
        }
        return toDto(profile);
    }

    @Transactional
    public UserProfileDto deleteWotbAccount(final String keycloakUserId) {
        final UserProfile profile = findOrCreate(keycloakUserId, null);
        profile.setWotbAccountId(null);
        profile.setWotbNickname(null);
        profile.setWotbServer("CN");
        profile.setUpdatedAt(OffsetDateTime.now());
        repository.save(profile);
        return toDto(profile);
    }

    private UserProfile findOrCreate(final String keycloakUserId, final String displayName) {
        return repository.findByKeycloakUserId(keycloakUserId)
                .orElseGet(() -> {
                    final UserProfile p = new UserProfile();
                    p.setKeycloakUserId(keycloakUserId);
                    p.setDisplayName(displayName);
                    p.setWotbServer("CN");
                    p.setUpdatedAt(OffsetDateTime.now());
                    return repository.save(p);
                });
    }

    private static UserProfileDto toDto(final UserProfile p) {
        return new UserProfileDto(
                p.getId(), p.getKeycloakUserId(), p.getDisplayName(),
                p.getWotbAccountId(), p.getWotbNickname(), p.getWotbServer()
        );
    }
}
