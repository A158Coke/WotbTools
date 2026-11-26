package com.wotb.web.user.service;

import com.wotb.web.user.api.UserProfiles;
import com.wotb.web.user.api.UserProfileSnapshot;
import com.wotb.web.user.api.WotbAccountIdentity;
import com.wotb.web.user.dto.UserProfileDto;
import com.wotb.web.user.dto.OnboardingReceiptDto;
import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.user.repository.UserProfileRepository;
import com.wotb.web.util.ConstraintViolations;
import com.wotb.web.util.JwtUtil;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;

@Service
public class UserProfileService implements UserProfiles {

    private static final Set<String> WG_REGIONS = Set.of("ASIA", "EU", "NA");

    private static final String UK_WOTB_ACCOUNT = "uk_user_profile_wotb_account";

    private final UserProfileRepository repository;
    private final UserProfileMapper mapper;

    public UserProfileService(final UserProfileRepository repository, final UserProfileMapper mapper) {
        this.repository = repository;
        this.mapper = mapper;
    }

    @Transactional(readOnly = true)
    public Optional<UserProfileDto> findByKeycloakUserId(final String keycloakUserId) {
        return repository.findByKeycloakUserId(keycloakUserId).map(mapper::toDto);
    }

    @Transactional(readOnly = true)
    public OnboardingReceiptDto readOnboardingReceipt(final String keycloakUserId) {
        return repository.findByKeycloakUserId(keycloakUserId)
                .map(mapper::toOnboardingReceipt)
                .orElseThrow(() -> new IllegalArgumentException("PROFILE_NOT_FOUND"));
    }

    @Transactional
    public OnboardingReceiptDto saveOnboardingReceipt(final String keycloakUserId,
                                                       final int coreEpoch, final String disposition) {
        if (coreEpoch < 1 || !("COMPLETED".equals(disposition) || "SKIPPED".equals(disposition))) {
            throw new IllegalArgumentException("INVALID_REQUEST");
        }
        final UserProfile profile = repository.findByKeycloakUserIdForUpdate(keycloakUserId)
                .orElseThrow(() -> new IllegalArgumentException("PROFILE_NOT_FOUND"));
        if (coreEpoch > profile.getOnboardingCoreEpoch()
                || (coreEpoch == profile.getOnboardingCoreEpoch()
                && "COMPLETED".equals(disposition)
                && !"COMPLETED".equals(profile.getOnboardingDisposition()))) {
            profile.setOnboardingCoreEpoch(coreEpoch);
            profile.setOnboardingDisposition(disposition);
            repository.save(profile);
        }
        return mapper.toOnboardingReceipt(profile);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<WotbAccountIdentity> currentWotbIdentity(final String keycloakUserId) {
        return repository.findByKeycloakUserId(keycloakUserId)
                .map(profile -> profile.getWotbAccountId() == null || profile.getWotbAccountId() <= 0
                        ? null
                        : new WotbAccountIdentity(profile.getWotbServer(), profile.getWotbAccountId()));
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<UserProfileSnapshot> findSnapshotByKeycloakUserId(final String keycloakUserId) {
        return repository.findByKeycloakUserId(keycloakUserId).map(mapper::toSnapshot);
    }

    @Override
    public boolean hasTrustedWargamingIdentity() {
        return trustedWgRegionOrNull() != null;
    }

    @Override
    @Transactional
    public Optional<UserProfileSnapshot> findSnapshotByKeycloakUserIdForUpdate(final String keycloakUserId) {
        return repository.findByKeycloakUserIdForUpdate(keycloakUserId).map(mapper::toSnapshot);
    }

    @Override
    @Transactional(readOnly = true)
    public Page<UserProfileSnapshot> searchForAdministration(final String query, final int page, final int size) {
        final PageRequest pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"));
        return StringUtils.hasText(query)
                ? repository.searchAdminUsers(query.trim(), pageable).map(mapper::toSnapshot)
                : repository.findAll(pageable).map(mapper::toSnapshot);
    }

    @Override
    @Transactional(readOnly = true)
    public List<UserProfileSnapshot> findByKeycloakUserIdIn(final Collection<String> keycloakUserIds) {
        if (keycloakUserIds == null || keycloakUserIds.isEmpty()) {
            return List.of();
        }
        return repository.findByKeycloakUserIdIn(keycloakUserIds).stream().map(mapper::toSnapshot).toList();
    }

    @Override
    @Transactional
    public void deleteForAdministration(final String keycloakUserId) {
        final UserProfile profile = repository.findByKeycloakUserId(keycloakUserId)
                .orElseThrow(() -> new IllegalArgumentException("PROFILE_NOT_FOUND"));
        repository.delete(profile);
        repository.flush();
    }

    public UserProfileDto ensureCurrentProfile(final String keycloakUserId,
                                               final String username,
                                               final String displayName) {
        final Optional<UserProfile> existing = repository.findByKeycloakUserId(keycloakUserId);
        return existing.isPresent()
                ? mapper.toDto(existing.get())
                : provision(keycloakUserId, username, displayName);
    }

    private static UserProfile newProfile(final String keycloakUserId,
                                          final String username,
                                          final String displayName) {
        final UserProfile profile = new UserProfile();
        profile.setKeycloakUserId(keycloakUserId);
        profile.setUsername(username);
        profile.setDisplayName(displayName);
        final String trustedRegion = trustedWgRegionOrNull();
        if (trustedRegion != null) {
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
        return profile;
    }

    private UserProfileDto provision(final String keycloakUserId,
                                     final String username,
                                     final String displayName) {
        final UserProfile profile = newProfile(keycloakUserId, username, displayName);
        try {
            return mapper.toDto(repository.saveAndFlush(profile));
        } catch (final DataIntegrityViolationException e) {
            final Optional<UserProfile> concurrent = repository.findByKeycloakUserId(keycloakUserId);
            if (concurrent.isPresent()) {
                return mapper.toDto(concurrent.get());
            }
            if (ConstraintViolations.causedByConstraint(e, UK_WOTB_ACCOUNT)) {
                throw new IllegalArgumentException("WOTB_ACCOUNT_ALREADY_USED", e);
            }
            throw new IllegalStateException("PROFILE_BOOTSTRAP_FAILED", e);
        }
    }

    @Override
    @Transactional
    public void synchronizeFromLogin(final String keycloakUserId) {
        syncFromLogin(keycloakUserId);
    }

    @Transactional
    public UserProfileDto syncFromLogin(final String keycloakUserId) {
        final String trustedRegion = trustedWgRegionOrNull();
        if (trustedRegion == null) {
            throw new IllegalArgumentException("WOTB_CLAIMS_INVALID");
        }
        final Long accountId = JwtUtil.currentWotbAccountId();
        final String nickname = JwtUtil.currentWotbNickname();

        final boolean duplicate = repository.existsByWotbServerAndWotbAccountIdAndKeycloakUserIdNot(
                trustedRegion, accountId, keycloakUserId);
        if (duplicate) {
            throw new IllegalArgumentException("WOTB_ACCOUNT_ALREADY_USED");
        }

        try {
            final UserProfile profile = repository.findByKeycloakUserId(keycloakUserId)
                    .orElse(null);
            if (profile == null) {
                final UserProfile created = newProfile(
                        keycloakUserId, JwtUtil.currentUsername(), JwtUtil.currentDisplayName());
                return mapper.toDto(repository.save(created));
            }
            if (profile.getWotbAccountId() == null) {
                profile.setWotbServer(trustedRegion);
                profile.setWotbAccountId(accountId);
                profile.setWotbNickname(nickname);
                profile.setWotbAccountSource("WARGAMING");
                profile.setWotbAccountVerifiedAt(OffsetDateTime.now());
            } else {
                if (!"WARGAMING".equals(profile.getWotbAccountSource())
                        || !trustedRegion.equals(profile.getWotbServer())) {
                    throw new IllegalArgumentException("PROFILE_REGION_MISMATCH");
                }
                if (!accountId.equals(profile.getWotbAccountId())) {
                    throw new IllegalArgumentException("WOTB_ACCOUNT_MISMATCH");
                }
                if (!nickname.equals(profile.getWotbNickname())) {
                    profile.setWotbNickname(nickname);
                }
            }
            profile.setUpdatedAt(OffsetDateTime.now());
            return mapper.toDto(repository.save(profile));
        } catch (final DataIntegrityViolationException e) {
            throw new IllegalArgumentException("WOTB_ACCOUNT_ALREADY_USED");
        }
    }

    @Transactional
    public UserProfileDto updateWotbAccount(final String keycloakUserId,
                                            final Long wotbAccountId,
                                            final String wotbNickname,
                                            final String wotbServer) {
        final UserProfile profile = repository.findByKeycloakUserId(keycloakUserId)
                .orElseThrow(() -> new IllegalArgumentException("PROFILE_NOT_FOUND"));

        if (trustedWgRegionOrNull() != null
                || "WARGAMING".equals(profile.getWotbAccountSource())) {
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

        final boolean identityChanged = !Objects.equals(profile.getWotbServer(), server)
                || !Objects.equals(profile.getWotbAccountId(), wotbAccountId);

        profile.setWotbAccountId(wotbAccountId);
        profile.setWotbNickname(wotbNickname);
        profile.setWotbServer(server);
        if (identityChanged) {
            profile.setWotbAccountVerifiedAt(null);
        }
        profile.setUpdatedAt(OffsetDateTime.now());

        try {
            return mapper.toDto(repository.save(profile));
        } catch (final DataIntegrityViolationException e) {
            throw new IllegalArgumentException("WOTB_ACCOUNT_ALREADY_USED");
        }
    }

    @Transactional
    public UserProfileDto deleteWotbAccount(final String keycloakUserId) {
        final UserProfile profile = repository.findByKeycloakUserId(keycloakUserId)
                .orElseThrow(() -> new IllegalArgumentException("PROFILE_NOT_FOUND"));

        if (trustedWgRegionOrNull() != null
                || "WARGAMING".equals(profile.getWotbAccountSource())) {
            throw new IllegalArgumentException(readOnlyErrorCode(profile.getWotbServer()));
        }
        profile.setWotbAccountId(null);
        profile.setWotbNickname(null);
        profile.setWotbServer("CN");
        profile.setWotbAccountVerifiedAt(null);
        profile.setUpdatedAt(OffsetDateTime.now());
        return mapper.toDto(repository.save(profile));
    }

    @Transactional
    public UserProfileDto verifyWotbAccountFromReplay(final String keycloakUserId, final Long recorderAccountId) {
        if (recorderAccountId == null || recorderAccountId <= 0) {
            throw new IllegalArgumentException("REPLAY_RECORDER_REQUIRED");
        }
        final UserProfile profile = repository.findByKeycloakUserId(keycloakUserId)
                .orElseThrow(() -> new IllegalArgumentException("PROFILE_NOT_FOUND"));
        if (profile.getWotbAccountId() == null) {
            throw new IllegalArgumentException("WOTB_ACCOUNT_NOT_BOUND");
        }
        if (!recorderAccountId.equals(profile.getWotbAccountId())) {
            throw new IllegalArgumentException("REPLAY_RECORDER_MISMATCH");
        }
        if (profile.getWotbAccountVerifiedAt() == null) {
            final OffsetDateTime now = OffsetDateTime.now();
            profile.setWotbAccountVerifiedAt(now);
            profile.setUpdatedAt(now);
            repository.save(profile);
        }
        return mapper.toDto(profile);
    }

    private static String trustedWgRegionOrNull() {
        final String region = JwtUtil.currentWotbRegion();
        final Long accountId = JwtUtil.currentWotbAccountId();
        final String nickname = JwtUtil.currentWotbNickname();
        if (!JwtUtil.currentWotbVerified() || region == null || !WG_REGIONS.contains(region)) {
            return null;
        }
        return accountId != null && StringUtils.hasText(nickname) ? region : null;
    }

    private static String readOnlyErrorCode(final String server) {
        return "ASIA".equals(server) ? "ASIA_PROFILE_READONLY" : "WARGAMING_PROFILE_READONLY";
    }

}
