package com.wotb.web.hundred.service;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.TankInfo;
import com.wotb.core.ref.Tankopedia;
import com.wotb.web.hundred.dto.HundredCreateResult;
import com.wotb.web.hundred.dto.HundredLeaderboardPageDto;
import com.wotb.web.hundred.dto.HundredSubmissionSummaryDto;
import com.wotb.web.hundred.dto.HundredUserStatusDto;
import com.wotb.web.hundred.dto.BulkDeleteItemResult;
import com.wotb.web.hundred.dto.BulkDeleteResultDto;
import com.wotb.web.hundred.entity.HundredBattleSubmission;
import com.wotb.web.hundred.enums.HundredBattleStatus;
import com.wotb.web.hundred.repository.HundredBattleSubmissionRepository;
import com.wotb.web.replay.service.ReplayCapacityLimiter;
import com.wotb.web.replayfile.ReplayUploadValidator;
import com.wotb.web.replayfile.ClientReplayFacts;
import com.wotb.web.replayfile.ReplayFileNames;
import com.wotb.web.replayfile.ReplayHashLock;
import com.wotb.web.user.api.UserProfiles;
import com.wotb.web.user.api.UserProfileSnapshot;
import com.wotb.web.user.api.WotbAccountIdentity;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

@Service
public class HundredBattleSubmissionService {

    private static final int MAX_IMAGE_CHARS = 5_500_000;
    private static final int REPLAY_COUNT = 5;
    private static final int MIN_APPROVED_BATTLE_COUNT = 100;

    static final Set<String> REJECT_CATEGORIES = Set.of(
            "SCREENSHOT_MISMATCH", "SCREENSHOT_UNREADABLE", "INSUFFICIENT_PROOF", "SUSPECTED_FRAUD", "OTHER");
    static final Set<String> DELETE_CATEGORIES = Set.of(
            "CHEATING_FORGERY", "WRONG_REVIEW", "PLAYER_IDENTITY_ISSUE", "DATA_ERROR", "ADMIN_CORRECTION", "OTHER");

    private final HundredBattleSubmissionRepository repository;
    private final HundredBattleMapper mapper;
    private final UserProfiles userProfileService;
    private final HundredReplayEvidenceService evidenceService;
    private final ReplayCapacityLimiter capacityLimiter;
    private final ReplayHashLock replayHashLock;
    private final TransactionTemplate transactionTemplate;
    private final Tankopedia tankopedia = Tankopedia.load();

    public HundredBattleSubmissionService(
            final HundredBattleSubmissionRepository repository,
            final HundredBattleMapper mapper,
            final UserProfiles userProfileService,
            final HundredReplayEvidenceService evidenceService,
            final ReplayCapacityLimiter capacityLimiter,
            final ReplayHashLock replayHashLock,
            final PlatformTransactionManager transactionManager) {
        this.repository = repository;
        this.mapper = mapper;
        this.userProfileService = userProfileService;
        this.evidenceService = evidenceService;
        this.capacityLimiter = capacityLimiter;
        this.replayHashLock = replayHashLock;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
    }


    public HundredCreateResult createSubmission(final String userId,
                                                final long vehicleId,
                                                final int claimedAverageDamage,
                                                final int claimedBattleCount,
                                                final String proofScreenshot,
                                                final List<MultipartFile> replays,
                                                final List<String> replayFacts) {
        final UserProfileSnapshot profile = findProfileForSubmission(userId);
        final Long gameId = profile.wotbAccountId();
        if (gameId == null || gameId <= 0) {
            throw new IllegalArgumentException("HUNDRED_PROFILE_GAME_ID_REQUIRED");
        }
        if (!StringUtils.hasText(profile.wotbNickname())) {
            throw new IllegalArgumentException("HUNDRED_PROFILE_NICKNAME_REQUIRED");
        }
        final String wotbServer = profile.wotbServer();
        if (claimedAverageDamage <= 0 || claimedBattleCount <= 0) {
            throw new IllegalArgumentException("HUNDRED_INVALID_CLAIM");
        }

        final TankInfo vehicle = requireTierTenVehicle(vehicleId);
        validateScreenshot(proofScreenshot);
        if (replays == null || replays.size() != REPLAY_COUNT) {
            throw new IllegalArgumentException("HUNDRED_REPLAY_COUNT");
        }
        ReplayUploadValidator.validate(replays.toArray(new MultipartFile[0]));
        final List<Battle> battles = ClientReplayFacts.readAll(replayFacts, replays.size());

        requireNoPending(wotbServer, gameId, vehicleId);

        try {
            return capacityLimiter.execute(() -> createSubmissionWithinReplayCapacity(
                    vehicleId, gameId, wotbServer, claimedAverageDamage, claimedBattleCount,
                    proofScreenshot, vehicle.name(), profile.wotbNickname().trim(), replays, battles));
        } catch (final RuntimeException e) {
            throw e;
        } catch (final Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private HundredCreateResult createSubmissionWithinReplayCapacity(
            final long vehicleId,
            final long gameId,
            final String wotbServer,
            final int claimedAverageDamage,
            final int claimedBattleCount,
            final String proofScreenshot,
            final String vehicleName,
            final String nickname,
            final List<MultipartFile> replays,
            final List<Battle> battles) {
        requireNoPending(wotbServer, gameId, vehicleId);

        final Set<String> arenaIds = new HashSet<>();
        final List<HundredReplayEvidenceService.PendingReplay> pendingReplays = new ArrayList<>();
        int slot = 0;
        for (final MultipartFile file : replays) {
            slot++;
            final byte[] bytes = readBytes(file);
            final Battle battle = battles.get(slot - 1);
            if (!StringUtils.hasText(battle.arenaId)) {
                throw new IllegalArgumentException("INVALID_REPLAY_FILE");
            }
            final PlayerResult player = findPlayerByAccountId(battle, gameId);
            if (player == null) {
                throw new IllegalArgumentException("HUNDRED_REPLAY_GAME_ID_MISMATCH");
            }
            if (player.tankId != vehicleId) {
                throw new IllegalArgumentException("HUNDRED_REPLAY_VEHICLE_MISMATCH");
            }
            if (!arenaIds.add(battle.arenaId)) {
                throw new IllegalArgumentException("HUNDRED_REPLAY_DUPLICATE_BATTLE");
            }
            pendingReplays.add(new HundredReplayEvidenceService.PendingReplay(
                    slot, ReplayFileNames.originalName(file), sha256(bytes), bytes.length,
                    battle.arenaId, bytes));
        }
        if (arenaIds.size() != REPLAY_COUNT) {
            throw new IllegalArgumentException("HUNDRED_REPLAY_DUPLICATE_BATTLE");
        }

        final HundredBattleSubmission current = repository
                .findByWotbServerAndWotbAccountIdAndVehicleIdAndStatus(wotbServer, gameId, vehicleId, "CURRENT")
                .orElse(null);
        if (current != null && current.getApprovedAverageDamage() != null
                && claimedAverageDamage <= current.getApprovedAverageDamage()) {
            throw new IllegalStateException("HUNDRED_NOT_HIGHER");
        }

        final List<String> hashes = pendingReplays.stream()
                .map(HundredReplayEvidenceService.PendingReplay::sha256)
                .distinct()
                .sorted()
                .toList();
        return replayHashLock.runWithLocksResult(hashes, () -> createLocked(
                vehicleId, gameId, wotbServer, claimedAverageDamage, claimedBattleCount,
                proofScreenshot, vehicleName, nickname, pendingReplays, hashes));
    }

    private UserProfileSnapshot findProfileForSubmission(final String userId) {
        final UserProfileSnapshot existing = userProfileService.findSnapshotByKeycloakUserId(userId).orElse(null);
        if (existing != null) {
            return existing;
        }
        if (!userProfileService.hasTrustedWargamingIdentity()) {
            throw new IllegalArgumentException("PROFILE_NOT_FOUND");
        }
        userProfileService.synchronizeFromLogin(userId);
        return userProfileService.findSnapshotByKeycloakUserId(userId)
                .orElseThrow(() -> new IllegalArgumentException("PROFILE_NOT_FOUND"));
    }

    private HundredCreateResult createLocked(final long vehicleId,
                                             final long gameId,
                                             final String wotbServer,
                                             final int claimedAverageDamage,
                                             final int claimedBattleCount,
                                             final String proofScreenshot,
                                             final String vehicleName,
                                             final String nickname,
                                             final List<HundredReplayEvidenceService.PendingReplay> pendingReplays,
                                             final List<String> hashes) {
        evidenceService.storeAll(pendingReplays);

        final Long submissionId;
        try {
            submissionId = transactionTemplate.execute(status -> {
                final HundredBattleSubmission submission = new HundredBattleSubmission();
                submission.setVehicleId(vehicleId);
                submission.setVehicleName(vehicleName);
                submission.setWotbServer(wotbServer);
                submission.setWotbAccountId(gameId);
                submission.setNicknameSnapshot(nickname);
                submission.setClaimedAverageDamage(claimedAverageDamage);
                submission.setClaimedBattleCount(claimedBattleCount);
                submission.setStatus(HundredBattleStatus.PENDING.name());
                submission.setProofScreenshot(proofScreenshot.trim());
                repository.saveAndFlush(submission);
                evidenceService.attach(submission.getId(), pendingReplays);
                return submission.getId();
            });
        } catch (final DataIntegrityViolationException e) {
            evidenceService.cleanupStoredFiles(hashes);
            throw new IllegalStateException("HUNDRED_PENDING_EXISTS");
        } catch (final RuntimeException e) {
            evidenceService.cleanupStoredFiles(hashes);
            throw e;
        }
        return new HundredCreateResult(submissionId, HundredBattleStatus.PENDING.name());
    }

    @Transactional
    public HundredSubmissionSummaryDto cancelSubmission(final String userId, final long submissionId) {
        final HundredBattleSubmission submission = repository.findByIdForUpdate(submissionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "HUNDRED_SUBMISSION_NOT_FOUND"));
        final WotbAccountIdentity owner = userProfileService.currentWotbIdentity(userId).orElse(null);
        if (!owns(owner, submission)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "HUNDRED_FORBIDDEN");
        }
        requirePending(submission);
        submission.setStatus(HundredBattleStatus.CANCELLED.name());
        submission.setCancelledAt(OffsetDateTime.now());
        submission.setProofScreenshot(null);
        final HundredSubmissionSummaryDto result = mapper.toSummary(repository.save(submission));
        evidenceService.discardForSubmission(submission.getId());
        return result;
    }


    @Transactional(readOnly = true)
    public HundredUserStatusDto userStatus(final String userId) {
        final WotbAccountIdentity owner = userProfileService.currentWotbIdentity(userId).orElse(null);
        if (owner == null) {
            return new HundredUserStatusDto(List.of(), List.of(), List.of());
        }
        return new HundredUserStatusDto(
                toSummaries(owner, "CURRENT"),
                toSummaries(owner, "PENDING"),
                repository.findByWotbServerAndWotbAccountIdAndStatusInOrderBySubmittedAtDesc(
                                owner.server(), owner.accountId(), List.of("REJECTED"))
                        .stream().limit(10).map(mapper::toSummary).toList());
    }

    private List<HundredSubmissionSummaryDto> toSummaries(final WotbAccountIdentity owner, final String status) {
        return repository.findByWotbServerAndWotbAccountIdAndStatusInOrderBySubmittedAtDesc(
                        owner.server(), owner.accountId(), List.of(status))
                .stream().map(mapper::toSummary).toList();
    }


    private static boolean owns(final WotbAccountIdentity owner, final HundredBattleSubmission submission) {
        return owner != null
                && owner.accountId() == submission.getWotbAccountId()
                && owner.server().equals(submission.getWotbServer());
    }

    static void requirePending(final HundredBattleSubmission submission) {
        if (!"PENDING".equals(submission.getStatus())) {
            throw new IllegalStateException("HUNDRED_SUBMISSION_NOT_PENDING");
        }
    }

    private TankInfo requireTierTenVehicle(final long vehicleId) {
        final TankInfo vehicle = tankopedia.info(vehicleId);
        if (!isTierTen(vehicle)) {
            throw new IllegalArgumentException("HUNDRED_NON_TIER_X");
        }
        return vehicle;
    }

    private void requireNoPending(final String wotbServer, final long wotbAccountId, final long vehicleId) {
        if (repository.existsByWotbServerAndWotbAccountIdAndVehicleIdAndStatus(
                wotbServer, wotbAccountId, vehicleId, "PENDING")) {
            throw new IllegalStateException("HUNDRED_PENDING_EXISTS");
        }
    }

    static void requireApprovedValues(final int approvedAverageDamage, final int approvedBattleCount) {
        if (approvedAverageDamage <= 0 || approvedBattleCount <= 0) {
            throw new IllegalArgumentException("HUNDRED_INVALID_APPROVED");
        }
        if (approvedBattleCount < MIN_APPROVED_BATTLE_COUNT) {
            throw new IllegalArgumentException("HUNDRED_APPROVED_BATTLE_COUNT_TOO_LOW");
        }
    }

    private static void validateScreenshot(final String image) {
        if (!StringUtils.hasText(image)) {
            throw new IllegalArgumentException("PROOF_SCREENSHOT_REQUIRED");
        }
        final String value = image.trim();
        if (!value.startsWith("data:image/")) {
            throw new IllegalArgumentException("INVALID_IMAGE_DATA");
        }
        if (value.length() > MAX_IMAGE_CHARS) {
            throw new IllegalArgumentException("IMAGE_TOO_LARGE");
        }
    }

    static String requireCategory(final String value, final String errorCode, final Set<String> categories) {
        if (!StringUtils.hasText(value)) {
            throw new IllegalArgumentException(errorCode);
        }
        final String normalized = value.trim().toUpperCase();
        if (!categories.contains(normalized)) {
            throw new IllegalArgumentException(errorCode);
        }
        return normalized;
    }

    private static boolean isTierTen(final TankInfo vehicle) {
        return vehicle.tier() instanceof final Number tier && tier.intValue() == 10;
    }

    private static byte[] readBytes(final MultipartFile file) {
        try {
            return file.getBytes();
        } catch (final IOException e) {
            throw new IllegalArgumentException("INVALID_REPLAY_FILE");
        }
    }

    private static String sha256(final byte[] data) {
        try {
            final MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest(data));
        } catch (final NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private static PlayerResult findPlayerByAccountId(final Battle battle, final long gameId) {
        if (battle.players == null) {
            return null;
        }
        return battle.players.stream()
                .filter(p -> p.accountId == gameId)
                .findFirst()
                .orElse(null);
    }

}
