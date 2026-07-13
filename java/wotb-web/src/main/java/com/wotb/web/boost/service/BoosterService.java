package com.wotb.web.boost.service;

import com.wotb.web.admin.service.KeycloakAdminUserService;
import com.wotb.web.boost.dto.BoosterDto;
import com.wotb.web.boost.entity.BoosterApplication;
import com.wotb.web.boost.entity.BoosterProfile;
import com.wotb.web.boost.enums.BoosterLevel;
import com.wotb.web.boost.enums.BoosterStatus;
import com.wotb.web.boost.enums.ContactType;
import com.wotb.web.boost.repository.BoosterApplicationRepository;
import com.wotb.web.boost.repository.BoosterProfileRepository;
import com.wotb.web.boost.repository.BoostRequestAssignmentRepository;
import com.wotb.web.user.service.UserProfileService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.util.StringUtils;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

/** 打手档案、关联依赖检查与 Keycloak booster role 的统一编排服务。 */
@Service
public class BoosterService {

    private static final Logger log = LoggerFactory.getLogger(BoosterService.class);
    private static final String BOOSTER_ROLE = "booster";

    private final BoosterProfileRepository boosterRepository;
    private final BoosterMapper mapper;
    private final UserProfileService userProfileService;
    private final KeycloakAdminUserService keycloakAdminUserService;
    private final BoostRequestAssignmentRepository assignmentRepository;
    private final BoosterApplicationRepository applicationRepository;

    public BoosterService(final BoosterProfileRepository boosterRepository,
                          final BoosterMapper mapper,
                          final UserProfileService userProfileService,
                          final KeycloakAdminUserService keycloakAdminUserService,
                          final BoostRequestAssignmentRepository assignmentRepository,
                          final BoosterApplicationRepository applicationRepository) {
        this.boosterRepository = boosterRepository;
        this.mapper = mapper;
        this.userProfileService = userProfileService;
        this.keycloakAdminUserService = keycloakAdminUserService;
        this.assignmentRepository = assignmentRepository;
        this.applicationRepository = applicationRepository;
    }

    @Transactional(readOnly = true)
    public BoosterProfile getById(final Long id) {
        return boosterRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("BOOSTER_NOT_FOUND"));
    }

    @Transactional
    public BoosterProfile getByIdForUpdate(final Long id) {
        return boosterRepository.findByIdForUpdate(id)
                .orElseThrow(() -> new IllegalArgumentException("BOOSTER_NOT_FOUND"));
    }

    @Transactional
    public BoosterDto create(final String nickname, final String level,
                             final String keycloakUserId,
                             final Boolean available, final String status,
                             final String contactType, final String contactValue,
                             final String specialties, final String description) {
        final String effectiveNickname = trimRequired(nickname, "BOOSTER_NICKNAME_REQUIRED");
        final String effectiveLevel = BoosterLevel.from(
                trimRequired(level, "BOOSTER_LEVEL_REQUIRED")
        ).name();
        final String effectiveKeycloakUserId = trimOrNull(keycloakUserId);
        final String effectiveStatus = StringUtils.hasText(status)
                ? BoosterStatus.from(status.trim()).name()
                : BoosterStatus.ACTIVE.name();
        final String effectiveContactType = StringUtils.hasText(contactType)
                ? ContactType.from(contactType.trim()).name()
                : null;
        validateUserBinding(effectiveKeycloakUserId, null);

        final BoosterProfile booster = new BoosterProfile();
        booster.setNickname(effectiveNickname);
        booster.setLevel(effectiveLevel);
        booster.setKeycloakUserId(effectiveKeycloakUserId);
        booster.setAvailable(available != null ? available : true);
        booster.setStatus(effectiveStatus);
        booster.setContactType(effectiveContactType);
        booster.setContactValue(trimOrNull(contactValue));
        booster.setSpecialties(trimOrNull(specialties));
        booster.setDescription(trimOrNull(description));

        final BoosterProfile persisted;
        try {
            persisted = boosterRepository.saveAndFlush(booster);
        } catch (final DataIntegrityViolationException e) {
            throw new IllegalArgumentException("ALREADY_BOOSTER", e);
        }

        final RollbackCompensation compensation = addRoleIfMissing(effectiveKeycloakUserId);
        try {
            return mapper.toDto(persisted);
        } catch (final RuntimeException e) {
            compensation.afterFailure(e);
            throw e;
        }
    }

    @Transactional
    public BoosterDto update(final Long id, final String nickname, final String level,
                             final String keycloakUserId,
                             final Boolean available, final String status,
                             final String contactType, final String contactValue,
                             final String specialties, final String description) {
        final BoosterProfile booster = getById(id);
        final String oldKeycloakUserId = trimOrNull(booster.getKeycloakUserId());
        // PATCH 以 null 表示“未提供”；可空字符串字段使用空白值显式清空。
        final String newKeycloakUserId = keycloakUserId != null
                ? trimOrNull(keycloakUserId)
                : oldKeycloakUserId;
        final boolean bindingChanged = !Objects.equals(oldKeycloakUserId, newKeycloakUserId);

        if (bindingChanged) {
            validateUserBinding(newKeycloakUserId, id);
        }
        final String updatedNickname = nickname != null
                ? trimRequired(nickname, "BOOSTER_NICKNAME_REQUIRED")
                : booster.getNickname();
        final String updatedLevel = level != null
                ? BoosterLevel.from(trimRequired(level, "BOOSTER_LEVEL_REQUIRED")).name()
                : booster.getLevel();
        final Boolean updatedAvailability = available != null ? available : booster.getAvailable();
        final String updatedStatus = status != null
                ? BoosterStatus.from(trimRequired(status, "BOOSTER_STATUS_REQUIRED")).name()
                : booster.getStatus();
        final String updatedContactType = contactType != null
                ? (StringUtils.hasText(contactType) ? ContactType.from(contactType.trim()).name() : null)
                : booster.getContactType();
        final String updatedContactValue = contactValue != null
                ? trimOrNull(contactValue)
                : booster.getContactValue();
        final String updatedSpecialties = specialties != null
                ? trimOrNull(specialties)
                : booster.getSpecialties();
        final String updatedDescription = description != null
                ? trimOrNull(description)
                : booster.getDescription();

        final List<RollbackCompensation> compensations = new ArrayList<>();
        try {
            booster.setNickname(updatedNickname);
            booster.setLevel(updatedLevel);
            booster.setKeycloakUserId(newKeycloakUserId);
            booster.setAvailable(updatedAvailability);
            booster.setStatus(updatedStatus);
            booster.setContactType(updatedContactType);
            booster.setContactValue(updatedContactValue);
            booster.setSpecialties(updatedSpecialties);
            booster.setDescription(updatedDescription);
            booster.setUpdatedAt(OffsetDateTime.now());
            final BoosterProfile persisted = boosterRepository.saveAndFlush(booster);
            if (bindingChanged) {
                compensations.add(addRoleIfMissing(newKeycloakUserId));
                compensations.add(removeRoleIfPresent(oldKeycloakUserId));
            }
            return mapper.toDto(persisted);
        } catch (final DataIntegrityViolationException e) {
            compensations.reversed().forEach(compensation -> compensation.afterFailure(e));
            throw new IllegalArgumentException("ALREADY_BOOSTER", e);
        } catch (final RuntimeException e) {
            compensations.reversed().forEach(compensation -> compensation.afterFailure(e));
            throw e;
        }
    }

    @Transactional
    public BoosterDto setAvailability(final Long id, final Boolean available) {
        if (available == null) {
            throw new IllegalArgumentException("BOOSTER_AVAILABILITY_REQUIRED");
        }
        final BoosterProfile booster = getById(id);
        booster.setAvailable(available);
        booster.setUpdatedAt(OffsetDateTime.now());
        return mapper.toDto(boosterRepository.saveAndFlush(booster));
    }

    @Transactional
    public void deleteById(final Long id) {
        final BoosterProfile booster = getById(id);
        if (assignmentRepository.existsByBoosterId(id)) {
            throw new IllegalStateException("BOOSTER_HAS_DEPENDENCIES");
        }

        // 解除关联的申请记录引用，避免外键约束阻塞删除
        // 申请状态保持 APPROVED 不变，不影响二次申请
        final List<BoosterApplication> linkedApps = applicationRepository.findByApprovedBoosterId(id);
        for (final BoosterApplication app : linkedApps) {
            app.setApprovedBoosterId(null);
            app.setUpdatedAt(OffsetDateTime.now());
            applicationRepository.save(app);
        }
        applicationRepository.flush();

        try {
            boosterRepository.delete(booster);
            boosterRepository.flush();
        } catch (final DataIntegrityViolationException e) {
            throw new IllegalStateException("BOOSTER_HAS_DEPENDENCIES", e);
        }
        removeRoleIfPresent(booster.getKeycloakUserId());
    }

    @Transactional(readOnly = true)
    public BoosterDto getDto(final Long id) {
        return mapper.toDto(getById(id));
    }

    @Transactional(readOnly = true)
    public Optional<BoosterDto> findByKeycloakUserId(final String keycloakUserId) {
        if (!StringUtils.hasText(keycloakUserId)) {
            return Optional.empty();
        }
        return boosterRepository.findByKeycloakUserId(keycloakUserId.trim()).map(mapper::toDto);
    }

    @Transactional(readOnly = true)
    public Page<BoosterDto> list(final String status, final Boolean available, final Pageable pageable) {
        final Page<BoosterProfile> page;
        if (StringUtils.hasText(status) && available != null) {
            page = boosterRepository.findByStatusAndAvailable(
                    BoosterStatus.from(status.trim()).name(), available, pageable
            );
        } else if (StringUtils.hasText(status)) {
            page = boosterRepository.findByStatus(BoosterStatus.from(status.trim()).name(), pageable);
        } else if (available != null) {
            page = boosterRepository.findByAvailable(available, pageable);
        } else {
            page = boosterRepository.findAll(pageable);
        }
        return page.map(mapper::toDto);
    }

    private void validateUserBinding(final String keycloakUserId, final Long currentBoosterId) {
        if (!StringUtils.hasText(keycloakUserId)) {
            return;
        }
        if (userProfileService.findByKeycloakUserId(keycloakUserId).isEmpty()) {
            throw new IllegalArgumentException("USER_PROFILE_NOT_FOUND");
        }
        boosterRepository.findByKeycloakUserId(keycloakUserId)
                .filter(existing -> !Objects.equals(existing.getId(), currentBoosterId))
                .ifPresent(existing -> {
                    throw new IllegalArgumentException("ALREADY_BOOSTER");
                });
    }

    private RollbackCompensation addRoleIfMissing(final String keycloakUserId) {
        if (!StringUtils.hasText(keycloakUserId)
                || keycloakAdminUserService.hasRealmRole(keycloakUserId, BOOSTER_ROLE)) {
            return RollbackCompensation.none();
        }
        keycloakAdminUserService.addRealmRole(keycloakUserId, BOOSTER_ROLE);
        return registerRollback(() -> keycloakAdminUserService.removeRealmRole(keycloakUserId, BOOSTER_ROLE));
    }

    private RollbackCompensation removeRoleIfPresent(final String keycloakUserId) {
        if (!StringUtils.hasText(keycloakUserId)) {
            return RollbackCompensation.none();
        }
        try {
            if (!keycloakAdminUserService.hasRealmRole(keycloakUserId, BOOSTER_ROLE)) {
                return RollbackCompensation.none();
            }
        } catch (final IllegalArgumentException e) {
            if ("KEYCLOAK_USER_NOT_FOUND".equals(e.getMessage())) {
                return RollbackCompensation.none();
            }
            throw e;
        }
        keycloakAdminUserService.removeRealmRole(keycloakUserId, BOOSTER_ROLE);
        return registerRollback(() -> keycloakAdminUserService.addRealmRole(keycloakUserId, BOOSTER_ROLE));
    }

    private RollbackCompensation registerRollback(final Runnable action) {
        final boolean deferred = TransactionSynchronizationManager.isSynchronizationActive();
        if (deferred) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCompletion(final int status) {
                    if (status == TransactionSynchronization.STATUS_ROLLED_BACK) {
                        runCompensation(action, null);
                    }
                }
            });
        }
        return new RollbackCompensation(deferred, action);
    }

    private static void runCompensation(final Runnable action, final RuntimeException original) {
        try {
            action.run();
        } catch (final RuntimeException compensationFailure) {
            if (original != null) {
                original.addSuppressed(compensationFailure);
            } else {
                log.error("Keycloak role compensation failed", compensationFailure);
            }
        }
    }

    private static String trimRequired(final String value, final String errorCode) {
        if (!StringUtils.hasText(value)) {
            throw new IllegalArgumentException(errorCode);
        }
        return value.trim();
    }

    private static String trimOrNull(final String value) {
        return StringUtils.hasText(value) ? value.trim() : null;
    }

    private record RollbackCompensation(boolean deferred, Runnable action) {

        private static RollbackCompensation none() {
            return new RollbackCompensation(true, () -> { });
        }

        private void afterFailure(final RuntimeException original) {
            if (!deferred) {
                runCompensation(action, original);
            }
        }
    }
}