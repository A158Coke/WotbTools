package com.wotb.web.mark3.service;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.TankInfo;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.ref.VehicleCodes;
import com.wotb.web.mark3.dto.Mark3AdminDetailDto;
import com.wotb.web.mark3.dto.Mark3AdminPageDto;
import com.wotb.web.mark3.dto.Mark3CreateResult;
import com.wotb.web.mark3.dto.Mark3LeaderboardPageDto;
import com.wotb.web.mark3.dto.Mark3SubmissionSummaryDto;
import com.wotb.web.mark3.dto.Mark3UserStatusDto;
import com.wotb.web.mark3.entity.Mark3Submission;
import com.wotb.web.mark3.enums.Mark3Status;
import com.wotb.web.mark3.repository.Mark3SubmissionRepository;
import com.wotb.web.replay.ReplayUploadValidator;
import com.wotb.web.replay.service.ReplayCapacityLimiter;
import com.wotb.web.replayfile.ReplayFileNames;
import com.wotb.web.replayfile.ReplayHashLock;
import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.user.service.UserProfileService;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 名人堂「三环」人工审核业务。无 Wargaming API 自动认证路径；所有成绩均为创建时冻结的人工申报。
 *
 * <p>不变量：同 user + vehicle 最多一条 active PENDING/CURRENT；CURRENT 是最终三环记录，
 * 不能被后续申请替代。REJECTED / CANCELLED / DELETED 是终态，允许再次提交。</p>
 */
@Service
public class Mark3SubmissionService {

    private static final int MAX_IMAGE_BYTES = 4 * 1024 * 1024;
    // A FileReader data URL adds a short media-type prefix to base64's 4/3 expansion.
    private static final int MAX_IMAGE_DATA_URL_CHARS = ((MAX_IMAGE_BYTES + 2) / 3) * 4 + 64;
    private static final int DEFAULT_PAGE_SIZE = 50;
    private static final int MAX_PAGE_SIZE = 100;
    private static final int TOP_LEADERBOARD_SIZE = 10;
    private static final int REPLAY_COUNT = 5;
    private static final int MAX_REASON_TEXT_CHARS = 500;
    private static final Set<String> REJECT_CATEGORIES = Set.of(
            "SCREENSHOT_MISMATCH", "SCREENSHOT_UNREADABLE", "INSUFFICIENT_PROOF", "SUSPECTED_FRAUD", "OTHER");
    private static final Set<String> DELETE_CATEGORIES = Set.of(
            "CHEATING_FORGERY", "WRONG_REVIEW", "PLAYER_IDENTITY_ISSUE", "DATA_ERROR", "ADMIN_CORRECTION", "OTHER");

    private final Mark3SubmissionRepository repository;
    private final Mark3Mapper mapper;
    private final UserProfileService userProfileService;
    private final ReplayCapacityLimiter capacityLimiter;
    private final Mark3ReplayEvidenceService evidenceService;
    private final ReplayHashLock replayHashLock;
    private final TransactionTemplate transactionTemplate;
    private final Tankopedia tankopedia = Tankopedia.load();

    public Mark3SubmissionService(
            final Mark3SubmissionRepository repository,
            final Mark3Mapper mapper,
            final UserProfileService userProfileService,
            final ReplayCapacityLimiter capacityLimiter,
            final Mark3ReplayEvidenceService evidenceService,
            final ReplayHashLock replayHashLock,
            final PlatformTransactionManager transactionManager) {
        this.repository = repository;
        this.mapper = mapper;
        this.userProfileService = userProfileService;
        this.capacityLimiter = capacityLimiter;
        this.evidenceService = evidenceService;
        this.replayHashLock = replayHashLock;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
    }

    /**
     * 创建人工三环申请。Tier X、账户/车辆/arenaId、5 回放、1–2 张截图以及三个申报指标
     * 均在任何文件/数据库持久化前验证；任一失败不创建 PENDING。
     */
    public Mark3CreateResult createSubmission(
            final String userId,
            final long vehicleId,
            final int claimedBattleCount,
            final int claimedAverageDamage,
            final BigDecimal claimedWinRate,
            final List<String> proofScreenshots,
            final List<MultipartFile> replays) {
        final UserProfile profile = userProfileService.findEntityByKeycloakUserId(userId)
                .orElseThrow(() -> new IllegalArgumentException("PROFILE_NOT_FOUND"));
        final Long gameId = profile.getWotbAccountId();
        if (gameId == null || gameId <= 0) {
            throw new IllegalArgumentException("MARK3_PROFILE_GAME_ID_REQUIRED");
        }
        if (!StringUtils.hasText(profile.getWotbNickname())) {
            throw new IllegalArgumentException("MARK3_PROFILE_NICKNAME_REQUIRED");
        }
        requireClaimedValues(claimedBattleCount, claimedAverageDamage, claimedWinRate);
        final BigDecimal normalizedWinRate = normalizeWinRate(claimedWinRate, "MARK3_INVALID_WIN_RATE");
        final TankInfo vehicle = requireTierTenVehicle(vehicleId);
        final List<String> normalizedScreenshots = validateProofScreenshots(proofScreenshots);
        if (replays == null || replays.size() != REPLAY_COUNT) {
            throw new IllegalArgumentException("MARK3_REPLAY_COUNT");
        }
        requireNoActiveSubmission(userId, vehicleId);

        try {
            return capacityLimiter.execute(() -> createSubmissionWithinReplayCapacity(
                    userId, vehicleId, gameId, vehicle.name(), profile.getWotbNickname().trim(),
                    claimedBattleCount, claimedAverageDamage, normalizedWinRate,
                    normalizedScreenshots, replays));
        } catch (final RuntimeException e) {
            throw e;
        } catch (final Exception e) {
            throw new IllegalStateException(e);
        }
    }

    /**
     * 全局 replay 容量许可覆盖完整的重型生命周期：校验、读入五个 byte[]、解析、hash 锁、落盘和事务。
     * 进入许可后再次检查 active 状态，避免其他请求刚创建 PENDING 时仍重复解析整组证据。
     */
    private Mark3CreateResult createSubmissionWithinReplayCapacity(
            final String userId,
            final long vehicleId,
            final long gameId,
            final String vehicleName,
            final String nickname,
            final int claimedBattleCount,
            final int claimedAverageDamage,
            final BigDecimal claimedWinRate,
            final List<String> normalizedScreenshots,
            final List<MultipartFile> replays) {
        requireNoActiveSubmission(userId, vehicleId);
        ReplayUploadValidator.validate(replays.toArray(new MultipartFile[0]));

        final Set<String> arenaIds = new HashSet<>();
        final List<Mark3ReplayEvidenceService.PendingReplay> pendingReplays = new ArrayList<>();
        int slot = 0;
        for (final MultipartFile file : replays) {
            slot++;
            final byte[] bytes = readBytes(file);
            final Battle battle = parse(bytes);
            if (!StringUtils.hasText(battle.arenaId)) {
                throw new IllegalArgumentException("INVALID_REPLAY_FILE");
            }
            final PlayerResult player = findPlayerByAccountId(battle, gameId);
            if (player == null) {
                throw new IllegalArgumentException("MARK3_REPLAY_GAME_ID_MISMATCH");
            }
            if (player.tankId != vehicleId) {
                throw new IllegalArgumentException("MARK3_REPLAY_VEHICLE_MISMATCH");
            }
            if (!arenaIds.add(battle.arenaId)) {
                throw new IllegalArgumentException("MARK3_REPLAY_DUPLICATE_BATTLE");
            }
            pendingReplays.add(new Mark3ReplayEvidenceService.PendingReplay(
                    slot, ReplayFileNames.originalName(file), sha256(bytes), bytes.length,
                    battle.arenaId, bytes));
        }
        if (arenaIds.size() != REPLAY_COUNT) {
            throw new IllegalArgumentException("MARK3_REPLAY_DUPLICATE_BATTLE");
        }

        final List<String> hashes = pendingReplays.stream()
                .map(Mark3ReplayEvidenceService.PendingReplay::sha256)
                .distinct()
                .sorted()
                .toList();
        return replayHashLock.runWithLocksResult(hashes, () -> createLocked(
                userId, vehicleId, gameId, vehicleName, nickname,
                claimedBattleCount, claimedAverageDamage, claimedWinRate,
                normalizedScreenshots, pendingReplays, hashes));
    }

    /** 锁内：先将五个原始回放写入独立 mark3 命名空间，再单事务写 submission 与五行 evidence。 */
    private Mark3CreateResult createLocked(
            final String userId,
            final long vehicleId,
            final long gameId,
            final String vehicleName,
            final String nickname,
            final int claimedBattleCount,
            final int claimedAverageDamage,
            final BigDecimal claimedWinRate,
            final List<String> screenshots,
            final List<Mark3ReplayEvidenceService.PendingReplay> pendingReplays,
            final List<String> hashes) {
        evidenceService.storeAll(pendingReplays);
        final Long submissionId;
        try {
            submissionId = transactionTemplate.execute(status -> {
                final Mark3Submission submission = new Mark3Submission();
                submission.setUserKeycloakId(userId);
                submission.setVehicleId(vehicleId);
                submission.setVehicleName(vehicleName);
                submission.setGameAccountIdSnapshot(gameId);
                submission.setNicknameSnapshot(nickname);
                submission.setClaimedBattleCount(claimedBattleCount);
                submission.setClaimedAverageDamage(claimedAverageDamage);
                submission.setClaimedWinRate(claimedWinRate);
                submission.setProofScreenshotFirst(screenshots.getFirst());
                submission.setProofScreenshotSecond(screenshots.size() == 2 ? screenshots.get(1) : null);
                submission.setStatus(Mark3Status.PENDING.name());
                repository.saveAndFlush(submission);
                evidenceService.attach(submission.getId(), pendingReplays);
                return submission.getId();
            });
        } catch (final DataIntegrityViolationException e) {
            // active partial unique index covers PENDING/CURRENT races after cheap preflight.
            evidenceService.cleanupStoredFiles(hashes);
            throw new IllegalStateException("MARK3_ACTIVE_EXISTS");
        } catch (final RuntimeException e) {
            evidenceService.cleanupStoredFiles(hashes);
            throw e;
        }
        return new Mark3CreateResult(submissionId, Mark3Status.PENDING.name());
    }

    /** 用户取消自己尚未审核的申请。 */
    @Transactional
    public Mark3SubmissionSummaryDto cancelSubmission(final String userId, final long submissionId) {
        final Mark3Submission submission = repository.findByIdForUpdate(submissionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "MARK3_SUBMISSION_NOT_FOUND"));
        if (!submission.getUserKeycloakId().equals(userId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "MARK3_FORBIDDEN");
        }
        requirePending(submission);
        submission.setStatus(Mark3Status.CANCELLED.name());
        submission.setCancelledAt(OffsetDateTime.now());
        clearProofScreenshots(submission);
        final Mark3SubmissionSummaryDto result = mapper.toSummary(repository.save(submission));
        evidenceService.discardForSubmission(submission.getId());
        return result;
    }

    /** 公开排行榜：具体车辆分页；未指定车辆时为全站或 nation/type 交集的固定 Top 10。 */
    @Transactional(readOnly = true)
    public Mark3LeaderboardPageDto leaderboard(
            final Long vehicleId,
            final String nation,
            final String vehicleType,
            final int page,
            final int size) {
        final String nationFilter = normalizeCategoryFilter(nation);
        final String typeFilter = normalizeCategoryFilter(vehicleType);
        if (vehicleId == null && nationFilter == null && typeFilter == null) {
            return defaultLeaderboard();
        }
        if (vehicleId == null) {
            return categoryLeaderboard(nationFilter, typeFilter);
        }
        final TankInfo vehicle = tankopedia.info(vehicleId);
        if (!isTierTen(vehicle)) {
            throw new IllegalArgumentException("MARK3_NON_TIER_X");
        }
        final int effectiveSize = clamp(size);
        if (!matchesCategory(vehicle, nationFilter, typeFilter)) {
            final Page<Mark3Submission> empty = Page.empty(PageRequest.of(Math.max(0, page - 1), effectiveSize));
            return mapper.toLeaderboardPage(empty, vehicleId, vehicle.name(), page, effectiveSize, Map.of());
        }
        final Page<Mark3Submission> rows = repository
                .findByVehicleIdAndStatusOrderByApprovedBattleCountAscApprovedAtAscIdAsc(
                        vehicleId, Mark3Status.CURRENT.name(),
                        PageRequest.of(Math.max(0, page - 1), effectiveSize));
        return mapper.toLeaderboardPage(rows, vehicleId, vehicle.name(), page, effectiveSize, rankMap(vehicleId));
    }

    private Mark3LeaderboardPageDto categoryLeaderboard(final String nation, final String vehicleType) {
        final List<Long> vehicleIds = repository.findDistinctCurrentVehicleIds().stream()
                .filter(id -> matchesCategory(tankopedia.info(id), nation, vehicleType))
                .toList();
        if (vehicleIds.isEmpty()) {
            return mapper.toTopLeaderboardPage(List.of(), TOP_LEADERBOARD_SIZE, Map.of());
        }
        final List<Mark3Submission> rows = repository.findTopCurrentByVehicleIds(
                vehicleIds, PageRequest.of(0, TOP_LEADERBOARD_SIZE));
        return mapper.toTopLeaderboardPage(rows, TOP_LEADERBOARD_SIZE,
                rankMap(repository.countCurrentGroupedByBattleCountForVehicles(vehicleIds)));
    }

    private Mark3LeaderboardPageDto defaultLeaderboard() {
        final List<Mark3Submission> rows = repository
                .findTop10ByStatusAndApprovedBattleCountIsNotNullOrderByApprovedBattleCountAscApprovedAtAscIdAsc(
                        Mark3Status.CURRENT.name());
        return mapper.toTopLeaderboardPage(rows, TOP_LEADERBOARD_SIZE,
                rankMap(repository.countAllCurrentGroupedByBattleCount()));
    }

    private Map<Integer, Integer> rankMap(final long vehicleId) {
        return rankMap(repository.countCurrentGroupedByBattleCount(vehicleId));
    }

    /** 三环场数升序的 competition rank：1, 2, 2, 4。 */
    private static Map<Integer, Integer> rankMap(final List<Object[]> groups) {
        final List<int[]> sorted = groups.stream()
                .map(group -> new int[]{((Number) group[0]).intValue(), ((Number) group[1]).intValue()})
                .sorted(Comparator.comparingInt(group -> group[0]))
                .toList();
        final Map<Integer, Integer> ranks = new HashMap<>();
        int fewer = 0;
        for (final int[] group : sorted) {
            ranks.put(group[0], fewer + 1);
            fewer += group[1];
        }
        return ranks;
    }

    /** 当前用户三环状态：CURRENT、PENDING 与最近十条 REJECTED。 */
    @Transactional(readOnly = true)
    public Mark3UserStatusDto userStatus(final String userId) {
        return new Mark3UserStatusDto(
                toSummaries(userId, Mark3Status.CURRENT.name()),
                toSummaries(userId, Mark3Status.PENDING.name()),
                repository.findByUserKeycloakIdAndStatusInOrderBySubmittedAtDesc(
                                userId, List.of(Mark3Status.REJECTED.name()))
                        .stream().limit(10).map(mapper::toSummary).toList());
    }

    private List<Mark3SubmissionSummaryDto> toSummaries(final String userId, final String status) {
        return repository.findByUserKeycloakIdAndStatusInOrderBySubmittedAtDesc(userId, List.of(status))
                .stream().map(mapper::toSummary).toList();
    }

    /** 管理列表：status 与 nation ∩ vehicleType ∩ vehicleId 按交集筛选。 */
    @Transactional(readOnly = true)
    public Mark3AdminPageDto adminList(
            final String status,
            final String nation,
            final String vehicleType,
            final Long vehicleId,
            final int page,
            final int size) {
        final String normalizedStatus = StringUtils.hasText(status) ? Mark3Status.from(status.trim().toUpperCase(Locale.ROOT)).name() : null;
        final int effectiveSize = clamp(size);
        final PageRequest pageable = PageRequest.of(Math.max(0, page - 1), effectiveSize);
        final String nationFilter = normalizeCategoryFilter(nation);
        final String typeFilter = normalizeCategoryFilter(vehicleType);
        final Page<Mark3Submission> rows;
        if (vehicleId == null && nationFilter == null && typeFilter == null) {
            rows = repository.searchAdmin(normalizedStatus, pageable);
        } else {
            final List<Long> vehicleIds = vehicleId == null
                    ? repository.findDistinctVehicleIds().stream()
                            .filter(id -> matchesCategory(tankopedia.info(id), nationFilter, typeFilter))
                            .toList()
                    : matchesCategory(tankopedia.info(vehicleId), nationFilter, typeFilter)
                            ? List.of(vehicleId) : List.of();
            rows = vehicleIds.isEmpty() ? Page.empty(pageable)
                    : repository.searchAdminByVehicleIds(normalizedStatus, vehicleIds, pageable);
        }
        return new Mark3AdminPageDto(
                rows.getContent().stream().map(mapper::toAdminListItem).toList(),
                page, effectiveSize, rows.getTotalElements(), rows.getTotalPages());
    }

    @Transactional(readOnly = true)
    public Mark3AdminDetailDto adminDetail(final long submissionId) {
        final Mark3Submission submission = repository.findById(submissionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "MARK3_SUBMISSION_NOT_FOUND"));
        return mapper.toAdminDetail(submission);
    }

    /**
     * 管理员 approve 没有 request body：只将创建时冻结的 claimed 值写入 approved。已存在 CURRENT
     * 时拒绝，绝不 SUPERSEDE / 替换该玩家同车三环记录。
     */
    @Transactional
    public Mark3SubmissionSummaryDto approve(final String adminUserId, final long submissionId) {
        final Mark3Submission submission = repository.findByIdForUpdate(submissionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "MARK3_SUBMISSION_NOT_FOUND"));
        requirePending(submission);
        evidenceService.requireCompleteEvidenceForApproval(submission.getId(), mapper.proofScreenshots(submission));
        if (repository.findCurrentForUpdate(submission.getUserKeycloakId(), submission.getVehicleId()).isPresent()) {
            throw new IllegalStateException("MARK3_CURRENT_EXISTS");
        }
        requireApprovedValues(
                submission.getClaimedBattleCount(), submission.getClaimedAverageDamage(), submission.getClaimedWinRate());
        submission.setApprovedBattleCount(submission.getClaimedBattleCount());
        submission.setApprovedAverageDamage(submission.getClaimedAverageDamage());
        submission.setApprovedWinRate(normalizeWinRate(submission.getClaimedWinRate(), "MARK3_INVALID_APPROVED"));
        submission.setStatus(Mark3Status.CURRENT.name());
        submission.setApprovedAt(OffsetDateTime.now());
        submission.setApprovedBy(adminUserId);
        clearProofScreenshots(submission);
        final Mark3SubmissionSummaryDto result = mapper.toSummary(repository.saveAndFlush(submission));
        evidenceService.discardForSubmission(submission.getId());
        return result;
    }

    /** 管理员拒绝 PENDING 申请；终态后允许该 user + vehicle 重试。 */
    @Transactional
    public Mark3SubmissionSummaryDto reject(
            final String adminUserId,
            final long submissionId,
            final String rejectReason,
            final String rejectReasonText) {
        final String reason = requireCategory(rejectReason, "MARK3_REJECT_REASON_REQUIRED", REJECT_CATEGORIES);
        if ("OTHER".equals(reason) && !StringUtils.hasText(rejectReasonText)) {
            throw new IllegalArgumentException("MARK3_REJECT_REASON_TEXT_REQUIRED");
        }
        final String normalizedReasonText = normalizeReasonText(
                rejectReasonText, "MARK3_REJECT_REASON_TEXT_TOO_LONG");
        final Mark3Submission submission = repository.findByIdForUpdate(submissionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "MARK3_SUBMISSION_NOT_FOUND"));
        requirePending(submission);
        submission.setStatus(Mark3Status.REJECTED.name());
        submission.setRejectedAt(OffsetDateTime.now());
        submission.setRejectedBy(adminUserId);
        submission.setRejectReason(reason);
        submission.setRejectReasonText(normalizedReasonText);
        clearProofScreenshots(submission);
        final Mark3SubmissionSummaryDto result = mapper.toSummary(repository.save(submission));
        evidenceService.discardForSubmission(submission.getId());
        return result;
    }

    /** 管理员删除 CURRENT；DELETED 后允许重新提交，但不恢复任何旧三环记录。 */
    @Transactional
    public Mark3SubmissionSummaryDto deleteCurrent(
            final String adminUserId,
            final long submissionId,
            final String deleteReason,
            final String deleteReasonText) {
        final String reason = requireCategory(deleteReason, "MARK3_DELETE_REASON_REQUIRED", DELETE_CATEGORIES);
        if ("OTHER".equals(reason) && !StringUtils.hasText(deleteReasonText)) {
            throw new IllegalArgumentException("MARK3_DELETE_REASON_TEXT_REQUIRED");
        }
        final String normalizedReasonText = normalizeReasonText(
                deleteReasonText, "MARK3_DELETE_REASON_TEXT_TOO_LONG");
        final Mark3Submission submission = repository.findByIdForUpdate(submissionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "MARK3_SUBMISSION_NOT_FOUND"));
        if (!Mark3Status.CURRENT.name().equals(submission.getStatus())) {
            throw new IllegalStateException("MARK3_NOT_CURRENT");
        }
        submission.setStatus(Mark3Status.DELETED.name());
        submission.setDeletedAt(OffsetDateTime.now());
        submission.setDeletedBy(adminUserId);
        submission.setDeleteReason(reason);
        submission.setDeleteReasonText(normalizedReasonText);
        clearProofScreenshots(submission);
        final Mark3SubmissionSummaryDto result = mapper.toSummary(repository.save(submission));
        evidenceService.discardForSubmission(submission.getId());
        return result;
    }

    private static void requirePending(final Mark3Submission submission) {
        if (!Mark3Status.PENDING.name().equals(submission.getStatus())) {
            throw new IllegalStateException("MARK3_SUBMISSION_NOT_PENDING");
        }
    }

    private TankInfo requireTierTenVehicle(final long vehicleId) {
        final TankInfo vehicle = tankopedia.info(vehicleId);
        if (!isTierTen(vehicle)) {
            throw new IllegalArgumentException("MARK3_NON_TIER_X");
        }
        return vehicle;
    }

    private void requireNoActiveSubmission(final String userId, final long vehicleId) {
        if (repository.existsByUserKeycloakIdAndVehicleIdAndStatus(userId, vehicleId, Mark3Status.CURRENT.name())) {
            throw new IllegalStateException("MARK3_CURRENT_EXISTS");
        }
        if (repository.existsByUserKeycloakIdAndVehicleIdAndStatus(userId, vehicleId, Mark3Status.PENDING.name())) {
            throw new IllegalStateException("MARK3_PENDING_EXISTS");
        }
    }

    private static void requireClaimedValues(
            final int battleCount,
            final int averageDamage,
            final BigDecimal winRate) {
        if (battleCount <= 0 || averageDamage <= 0) {
            throw new IllegalArgumentException("MARK3_INVALID_CLAIM");
        }
        normalizeWinRate(winRate, "MARK3_INVALID_WIN_RATE");
    }

    /** 审核时只接受冻结的 claimed 数据；脏历史数据不得静默变成 CURRENT。 */
    private static void requireApprovedValues(
            final int battleCount,
            final int averageDamage,
            final BigDecimal winRate) {
        if (battleCount <= 0 || averageDamage <= 0) {
            throw new IllegalArgumentException("MARK3_INVALID_APPROVED");
        }
        normalizeWinRate(winRate, "MARK3_INVALID_APPROVED");
    }

    private static BigDecimal normalizeWinRate(final BigDecimal value, final String errorCode) {
        if (value == null || value.compareTo(BigDecimal.ZERO) < 0 || value.compareTo(BigDecimal.valueOf(100)) > 0
                || value.stripTrailingZeros().scale() > 2) {
            throw new IllegalArgumentException(errorCode);
        }
        try {
            return value.setScale(2, RoundingMode.UNNECESSARY);
        } catch (final ArithmeticException e) {
            throw new IllegalArgumentException(errorCode);
        }
    }

    private static List<String> validateProofScreenshots(final List<String> proofScreenshots) {
        if (proofScreenshots == null || proofScreenshots.size() < 1 || proofScreenshots.size() > 2) {
            throw new IllegalArgumentException("MARK3_PROOF_SCREENSHOT_COUNT");
        }
        final List<String> normalized = new ArrayList<>();
        for (final String screenshot : proofScreenshots) {
            if (!StringUtils.hasText(screenshot) || !screenshot.trim().startsWith("data:image/")) {
                throw new IllegalArgumentException("MARK3_INVALID_IMAGE_DATA");
            }
            final String value = screenshot.trim();
            if (value.length() > MAX_IMAGE_DATA_URL_CHARS) {
                throw new IllegalArgumentException("MARK3_IMAGE_TOO_LARGE");
            }
            normalized.add(value);
        }
        return List.copyOf(normalized);
    }

    private static void clearProofScreenshots(final Mark3Submission submission) {
        submission.setProofScreenshotFirst(null);
        submission.setProofScreenshotSecond(null);
    }

    private static String requireCategory(final String value, final String errorCode, final Set<String> categories) {
        if (!StringUtils.hasText(value)) {
            throw new IllegalArgumentException(errorCode);
        }
        final String normalized = value.trim().toUpperCase(Locale.ROOT);
        if (!categories.contains(normalized)) {
            throw new IllegalArgumentException(errorCode);
        }
        return normalized;
    }

    private static String normalizeReasonText(final String value, final String tooLongErrorCode) {
        if (!StringUtils.hasText(value)) {
            return null;
        }
        final String normalized = value.trim();
        if (normalized.length() > MAX_REASON_TEXT_CHARS) {
            throw new IllegalArgumentException(tooLongErrorCode);
        }
        return normalized;
    }

    private static String normalizeCategoryFilter(final String value) {
        return StringUtils.hasText(value) ? value.trim().toUpperCase(Locale.ROOT) : null;
    }

    private static boolean isTierTen(final TankInfo vehicle) {
        return vehicle.tier() instanceof final Number tier && tier.intValue() == 10;
    }

    private static boolean matchesCategory(final TankInfo vehicle, final String nation, final String vehicleType) {
        return isTierTen(vehicle)
                && (nation == null || nation.equals(VehicleCodes.nationCode(vehicle.nation())))
                && (vehicleType == null || vehicleType.equals(VehicleCodes.classCode(vehicle.type())));
    }

    private static byte[] readBytes(final MultipartFile file) {
        try {
            return file.getBytes();
        } catch (final IOException e) {
            throw new IllegalArgumentException("INVALID_REPLAY_FILE");
        }
    }

    private static Battle parse(final byte[] bytes) {
        try {
            return ReplayParser.parse(bytes);
        } catch (final Exception e) {
            throw new IllegalArgumentException("INVALID_REPLAY_FILE");
        }
    }

    private static String sha256(final byte[] data) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
        } catch (final NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private static PlayerResult findPlayerByAccountId(final Battle battle, final long gameId) {
        if (battle.players == null) {
            return null;
        }
        return battle.players.stream()
                .filter(player -> player.accountId == gameId)
                .findFirst()
                .orElse(null);
    }

    private static int clamp(final int size) {
        if (size <= 0) {
            return DEFAULT_PAGE_SIZE;
        }
        return Math.min(size, MAX_PAGE_SIZE);
    }
}
