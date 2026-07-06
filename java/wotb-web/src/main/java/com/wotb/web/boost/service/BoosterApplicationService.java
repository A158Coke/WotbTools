package com.wotb.web.boost.service;

import com.wotb.web.admin.service.KeycloakAdminUserService;
import com.wotb.web.boost.dto.BoosterApplicationDto;
import com.wotb.web.boost.dto.BoosterDto;
import com.wotb.web.boost.dto.CreateBoosterApplicationResponse;
import com.wotb.web.boost.entity.BoosterApplication;
import com.wotb.web.boost.enums.BoosterApplicationStatus;
import com.wotb.web.boost.enums.BoosterAvailabilityTier;
import com.wotb.web.boost.enums.BoosterLevel;
import com.wotb.web.boost.enums.BoosterStatus;
import com.wotb.web.boost.enums.ContactType;
import com.wotb.web.boost.repository.BoosterApplicationRepository;
import com.wotb.web.user.dto.UserProfileDto;
import com.wotb.web.user.enums.UserNotificationType;
import com.wotb.web.user.service.UserNotificationService;
import com.wotb.web.user.service.UserProfileService;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;

@Service
public class BoosterApplicationService {

    private static final String BOOSTER_ROLE = "booster";
    private static final int MAX_IMAGE_CHARS = 5_500_000;
    private static final Collection<String> OPEN_STATUSES = List.of(
            BoosterApplicationStatus.NEW.name(),
            BoosterApplicationStatus.REVIEWING.name()
    );

    private final BoosterApplicationRepository repository;
    private final BoosterApplicationMapper mapper;
    private final UserProfileService userProfileService;
    private final BoosterService boosterService;
    private final KeycloakAdminUserService keycloakAdminUserService;
    private final UserNotificationService notificationService;

    public BoosterApplicationService(final BoosterApplicationRepository repository,
                                     final BoosterApplicationMapper mapper,
                                     final UserProfileService userProfileService,
                                     final BoosterService boosterService,
                                     final KeycloakAdminUserService keycloakAdminUserService,
                                     final UserNotificationService notificationService) {
        this.repository = repository;
        this.mapper = mapper;
        this.userProfileService = userProfileService;
        this.boosterService = boosterService;
        this.keycloakAdminUserService = keycloakAdminUserService;
        this.notificationService = notificationService;
    }

    @Transactional
    public CreateBoosterApplicationResponse create(final String keycloakUserId,
                                                   final Long requestWotbAccountId,
                                                   final String requestWotbNickname,
                                                   final String requestWotbServer,
                                                   final String overallStatsImage,
                                                   final String vehicleStatsImage,
                                                   final String requestedLevel,
                                                   final String qq,
                                                   final String wechat,
                                                   final String availabilityTier,
                                                   final String dailyTimeWindow,
                                                   final String selfAssessment) {
        final UserProfileDto profile = userProfileService.findByKeycloakUserId(keycloakUserId)
                .orElseThrow(() -> new IllegalArgumentException("PROFILE_NOT_FOUND"));
        if (boosterService.findByKeycloakUserId(keycloakUserId).isPresent()) {
            throw new IllegalArgumentException("ALREADY_BOOSTER");
        }
        if (repository.existsByKeycloakUserIdAndStatusIn(keycloakUserId, OPEN_STATUSES)) {
            throw new IllegalArgumentException("BOOSTER_APPLICATION_ALREADY_OPEN");
        }

        final Long effectiveAccountId = profile.wotbAccountId() != null
                ? profile.wotbAccountId()
                : requestWotbAccountId;
        final String effectiveNickname = StringUtils.hasText(profile.wotbNickname())
                ? profile.wotbNickname()
                : trimRequired(requestWotbNickname, "WOTB_NICKNAME_REQUIRED");
        final String effectiveServer = StringUtils.hasText(profile.wotbServer())
                ? profile.wotbServer()
                : defaultServer(requestWotbServer);

        validateAccount(effectiveAccountId);
        validateServer(effectiveServer);
        validateImage(overallStatsImage, "OVERALL_STATS_IMAGE_REQUIRED");
        validateImage(vehicleStatsImage, "VEHICLE_STATS_IMAGE_REQUIRED");
        BoosterLevel.from(trimRequired(requestedLevel, "BOOSTER_LEVEL_REQUIRED"));
        BoosterAvailabilityTier.from(trimRequired(availabilityTier, "AVAILABILITY_TIER_REQUIRED"));
        final String effectiveQq = trimRequired(qq, "QQ_REQUIRED");
        final String effectiveTimeWindow = trimRequired(dailyTimeWindow, "DAILY_TIME_WINDOW_REQUIRED");

        final BoosterApplication application = new BoosterApplication();
        application.setKeycloakUserId(keycloakUserId);
        application.setUserProfileId(profile.id());
        application.setWotbAccountId(effectiveAccountId);
        application.setWotbNickname(effectiveNickname);
        application.setWotbServer(effectiveServer.toUpperCase());
        application.setOverallStatsImage(overallStatsImage.trim());
        application.setVehicleStatsImage(vehicleStatsImage.trim());
        application.setRequestedLevel(requestedLevel.trim().toUpperCase());
        application.setQq(limit(effectiveQq, 64, "QQ_TOO_LONG"));
        application.setWechat(limit(trimOrNull(wechat), 64, "WECHAT_TOO_LONG"));
        application.setAvailabilityTier(availabilityTier.trim().toUpperCase());
        application.setDailyTimeWindow(limit(effectiveTimeWindow, 255, "DAILY_TIME_WINDOW_TOO_LONG"));
        application.setSelfAssessment(limit(trimOrNull(selfAssessment), 2000, "SELF_ASSESSMENT_TOO_LONG"));
        application.setStatus(BoosterApplicationStatus.NEW.name());

        try {
            repository.saveAndFlush(application);
        } catch (final DataIntegrityViolationException e) {
            throw new IllegalArgumentException("BOOSTER_APPLICATION_ALREADY_OPEN");
        }

        return new CreateBoosterApplicationResponse(
                application.getId(),
                application.getStatus(),
                "BOOSTER_APPLICATION_SUBMITTED",
                application.getCreatedAt()
        );
    }

    @Transactional(readOnly = true)
    public List<BoosterApplicationDto> listMine(final String keycloakUserId) {
        return repository.findByKeycloakUserIdOrderByCreatedAtDesc(keycloakUserId)
                .stream()
                .map(mapper::toDto)
                .toList();
    }

    @Transactional(readOnly = true)
    public Page<BoosterApplicationDto> list(final String status, final Pageable pageable) {
        final Page<BoosterApplication> page;
        if (StringUtils.hasText(status)) {
            final String upper = BoosterApplicationStatus.from(status).name();
            page = repository.findByStatusOrderByCreatedAtDesc(upper, pageable);
        } else {
            page = repository.findAllByOrderByCreatedAtDesc(pageable);
        }
        return page.map(mapper::toDto);
    }

    @Transactional(readOnly = true)
    public BoosterApplicationDto get(final Long id) {
        return mapper.toDto(getById(id));
    }

    @Transactional
    public BoosterApplicationDto markReviewing(final Long id,
                                               final String adminUserId,
                                               final String adminNote) {
        final BoosterApplication application = getById(id);
        ensureOpen(application);
        application.setStatus(BoosterApplicationStatus.REVIEWING.name());
        application.setAdminNote(trimOrNull(adminNote));
        application.setReviewedBy(adminUserId);
        application.setReviewedAt(OffsetDateTime.now());
        application.setUpdatedAt(OffsetDateTime.now());
        notifyApplication(application, UserNotificationType.BOOSTER_APPLICATION_REJECTED);
        return mapper.toDto(application);
    }

    @Transactional
    public BoosterApplicationDto reject(final Long id,
                                        final String adminUserId,
                                        final String adminNote) {
        final BoosterApplication application = getById(id);
        ensureOpen(application);
        application.setStatus(BoosterApplicationStatus.REJECTED.name());
        application.setAdminNote(trimOrNull(adminNote));
        application.setReviewedBy(adminUserId);
        application.setReviewedAt(OffsetDateTime.now());
        application.setUpdatedAt(OffsetDateTime.now());
        return mapper.toDto(application);
    }

    @Transactional
    public BoosterApplicationDto approve(final Long id,
                                         final String adminUserId,
                                         final String adminNote) {
        final BoosterApplication application = getById(id);
        ensureOpen(application);
        if (boosterService.findByKeycloakUserId(application.getKeycloakUserId()).isPresent()) {
            throw new IllegalArgumentException("ALREADY_BOOSTER");
        }

        keycloakAdminUserService.addRealmRole(application.getKeycloakUserId(), BOOSTER_ROLE);
        final BoosterDto booster = boosterService.create(
                application.getWotbNickname(),
                application.getRequestedLevel(),
                application.getKeycloakUserId(),
                true,
                BoosterStatus.ACTIVE.name(),
                ContactType.QQ.name(),
                application.getQq(),
                application.getSelfAssessment(),
                composeBoosterDescription(application)
        );

        application.setStatus(BoosterApplicationStatus.APPROVED.name());
        application.setAdminNote(trimOrNull(adminNote));
        application.setApprovedBoosterId(booster.id());
        application.setReviewedBy(adminUserId);
        application.setReviewedAt(OffsetDateTime.now());
        application.setUpdatedAt(OffsetDateTime.now());
        notifyApplication(application, UserNotificationType.BOOSTER_APPLICATION_APPROVED);
        return mapper.toDto(application);
    }

    private void notifyApplication(final BoosterApplication application,
                                   final UserNotificationType type) {
        notificationService.create(
                application.getKeycloakUserId(),
                type,
                "booster_application",
                application.getId(),
                Map.of(
                        "applicationId", String.valueOf(application.getId()),
                        "status", application.getStatus()
                )
        );
    }

    private BoosterApplication getById(final Long id) {
        return repository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("BOOSTER_APPLICATION_NOT_FOUND"));
    }

    private static void ensureOpen(final BoosterApplication application) {
        final BoosterApplicationStatus status = BoosterApplicationStatus.from(application.getStatus());
        if (status != BoosterApplicationStatus.NEW && status != BoosterApplicationStatus.REVIEWING) {
            throw new IllegalArgumentException("BOOSTER_APPLICATION_NOT_OPEN");
        }
    }

    private static void validateAccount(final Long wotbAccountId) {
        if (wotbAccountId == null || wotbAccountId <= 0) {
            throw new IllegalArgumentException("WOTB_ACCOUNT_ID_REQUIRED");
        }
    }

    private static void validateServer(final String wotbServer) {
        if (!"CN".equalsIgnoreCase(wotbServer)) {
            throw new IllegalArgumentException("UNSUPPORTED_WOTB_SERVER");
        }
    }

    private static void validateImage(final String image, final String errorCode) {
        final String value = trimRequired(image, errorCode);
        if (!value.startsWith("data:image/")) {
            throw new IllegalArgumentException("INVALID_IMAGE_DATA");
        }
        if (value.length() > MAX_IMAGE_CHARS) {
            throw new IllegalArgumentException("IMAGE_TOO_LARGE");
        }
    }

    private static String defaultServer(final String server) {
        return StringUtils.hasText(server) ? server.trim() : "CN";
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

    private static String limit(final String value, final int maxLength, final String errorCode) {
        if (value != null && value.length() > maxLength) {
            throw new IllegalArgumentException(errorCode);
        }
        return value;
    }

    private static String composeBoosterDescription(final BoosterApplication application) {
        final List<String> lines = new ArrayList<>();
        lines.add("application_id=" + application.getId());
        lines.add("wotb_account_id=" + application.getWotbAccountId());
        lines.add("availability_tier=" + application.getAvailabilityTier());
        lines.add("daily_time_window=" + application.getDailyTimeWindow());
        if (StringUtils.hasText(application.getWechat())) {
            lines.add("wechat=" + application.getWechat());
        }
        if (StringUtils.hasText(application.getSelfAssessment())) {
            lines.add("self_assessment=" + application.getSelfAssessment());
        }
        return String.join("\n", lines);
    }
}
