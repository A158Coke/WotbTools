package com.wotb.web.hundred.service;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.TankInfo;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.ref.Tankopedia;
import com.wotb.web.hof.service.HallOfFameUploadService;
import com.wotb.web.hof.service.ReplayHashLock;
import com.wotb.web.hundred.dto.HundredAdminDetailDto;
import com.wotb.web.hundred.dto.HundredAdminPageDto;
import com.wotb.web.hundred.dto.HundredCreateResult;
import com.wotb.web.hundred.dto.HundredLeaderboardPageDto;
import com.wotb.web.hundred.dto.HundredSubmissionSummaryDto;
import com.wotb.web.hundred.dto.HundredUserStatusDto;
import com.wotb.web.hundred.entity.HundredBattleSubmission;
import com.wotb.web.hundred.enums.HundredBattleStatus;
import com.wotb.web.hundred.repository.HundredBattleSubmissionRepository;
import com.wotb.web.replay.ReplayUploadValidator;
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
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 名人堂「百场」业务（docs/current-plan.md 百场需求）。
 *
 * <p>核心不变量（全部由 DB + 行锁保证，非前端保证）：</p>
 * <ul>
 *   <li>user + vehicle 最多一个 active PENDING / CURRENT（V18 partial unique index）</li>
 *   <li>APPROVE/REJECT/CANCEL 只能从 PENDING 成功一次（{@link #findByIdForUpdate} 行锁 + 状态复核）</li>
 *   <li>APPROVE 事务内重新读取 CURRENT 并按 approvedAverageDamage 严格比较</li>
 *   <li>身份/成绩快照创建瞬间冻结；排行榜只读 approved*</li>
 * </ul>
 *
 * <p>proof 生命周期：截图以 base64 data URL 存 DB（同 Boost Apply 模式），审核终态事务内清空，
 * 与业务状态原子提交——不存在「文件删除失败回滚业务状态」问题；5 个原始 {@code .wotbreplay}
 * 由 {@link HundredReplayEvidenceService} 内容寻址持久化（{@code hundred_battle_replay_evidence} 元数据
 * + 物理文件，PENDING 全程可审核），审核终态（APPROVE/REJECT/CANCEL）同事务删元数据行并在
 * commit 后 best-effort 清理物理文件（跨表引用计数，失败仅 WARN 保留 orphan）。</p>
 */
@Service
public class HundredBattleSubmissionService {

    private static final int MAX_IMAGE_CHARS = 5_500_000;
    private static final int DEFAULT_PAGE_SIZE = 50;
    private static final int MAX_PAGE_SIZE = 100;
    private static final int REPLAY_COUNT = 5;

    /** 「百场」资格最低场次：管理员最终 approvedBattleCount 必须 ≥ 100（人工审核为最终资格判断）。 */
    private static final int MIN_APPROVED_BATTLE_COUNT = 100;

    /** 拒绝原因分类（docs/current-plan.md §32）。 */
    private static final Set<String> REJECT_CATEGORIES = Set.of(
            "SCREENSHOT_MISMATCH", "SCREENSHOT_UNREADABLE", "INSUFFICIENT_PROOF", "SUSPECTED_FRAUD", "OTHER");
    /** 删除原因分类（docs/current-plan.md §34）。 */
    private static final Set<String> DELETE_CATEGORIES = Set.of(
            "CHEATING_FORGERY", "WRONG_REVIEW", "PLAYER_IDENTITY_ISSUE", "DATA_ERROR", "ADMIN_CORRECTION", "OTHER");

    private final HundredBattleSubmissionRepository repository;
    private final HundredBattleMapper mapper;
    private final UserProfileService userProfileService;
    private final HundredReplayEvidenceService evidenceService;
    private final ReplayHashLock replayHashLock;
    private final TransactionTemplate transactionTemplate;
    private final Tankopedia tankopedia = Tankopedia.load();

    public HundredBattleSubmissionService(
            final HundredBattleSubmissionRepository repository,
            final HundredBattleMapper mapper,
            final UserProfileService userProfileService,
            final HundredReplayEvidenceService evidenceService,
            final ReplayHashLock replayHashLock,
            final PlatformTransactionManager transactionManager) {
        this.repository = repository;
        this.mapper = mapper;
        this.userProfileService = userProfileService;
        this.evidenceService = evidenceService;
        this.replayHashLock = replayHashLock;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
    }

    // ── Phase 3：Submission ──────────────────────────────────────────────

    /**
     * 创建百场 submission（需登录且 Profile 已配置 gameId/nickname）。
     * 硬门禁：Tier X authoritative 校验 + 固定 1 张截图 + 正好 5 个 replay 全部解析成功、
     * gameId/vehicleId 匹配、5 场不同 battle（size/type 复用 {@code ReplayUploadValidator} 全局 contract）；
     * 任意失败 → 整单失败，不进入 PENDING，零持久化残留。
     *
     * <p><b>锁与事务协议</b>（与 {@link ReplayHashLock} 全协议对齐，多实例安全）：</p>
     * <pre>
     * acquire sorted distinct hash advisory locks   （固定顺序防 deadlock）
     *   ├ storage.store × 5（幂等，内容寻址）
     *   ├ DB transaction（TransactionTemplate）：
     *   │    create submission → attach 5 evidence rows
     *   └ COMMIT  ← 必须发生在锁释放之前（DB 引用 H ⇒ 物理 H 存在）
     * release locks（反向）
     * </pre>
     * DB 事务失败（含 PENDING unique index 竞态）：rollback 完成后、仍在锁内进行
     * 引用计数保护的 best-effort 文件清理——绝不在 aborted transaction 内执行 DB 查询。
     * 5 个 hash 由 {@code ReplayHashLock.runWithLocksResult} 按字典序去重排序后统一加锁。
     */
    public HundredCreateResult createSubmission(final String userId,
                                                final long vehicleId,
                                                final int claimedAverageDamage,
                                                final int claimedBattleCount,
                                                final String proofScreenshot,
                                                final List<MultipartFile> replays) {
        final UserProfile profile = userProfileService.findEntityByKeycloakUserId(userId)
                .orElseThrow(() -> new IllegalArgumentException("PROFILE_NOT_FOUND"));
        final Long gameId = profile.getWotbAccountId();
        if (gameId == null || gameId <= 0) {
            throw new IllegalArgumentException("HUNDRED_PROFILE_GAME_ID_REQUIRED");
        }
        if (!StringUtils.hasText(profile.getWotbNickname())) {
            throw new IllegalArgumentException("HUNDRED_PROFILE_NICKNAME_REQUIRED");
        }
        if (claimedAverageDamage <= 0 || claimedBattleCount <= 0) {
            throw new IllegalArgumentException("HUNDRED_INVALID_CLAIM");
        }

        final TankInfo vehicle = tankopedia.info(vehicleId);
        if (!(vehicle.tier() instanceof final Integer tier) || tier != 10) {
            throw new IllegalArgumentException("HUNDRED_NON_TIER_X");
        }
        validateScreenshot(proofScreenshot);
        if (replays == null || replays.size() != REPLAY_COUNT) {
            throw new IllegalArgumentException("HUNDRED_REPLAY_COUNT");
        }
        ReplayUploadValidator.validate(replays.toArray(new MultipartFile[0]));

        // PENDING 唯一性 cheap check：明知已有同车 PENDING 时不再解析 5 个 replay；
        // 并发竞态仍由 DB partial unique index 兜底（见 createLocked 内 saveAndFlush 的 catch）。
        if (repository.existsByUserKeycloakIdAndVehicleIdAndStatus(userId, vehicleId, "PENDING")) {
            throw new IllegalStateException("HUNDRED_PENDING_EXISTS");
        }

        // 硬门禁：5 个 replay 全部解析成功 + gameId/vehicleId 匹配 + 5 场不同 battle。
        // 解析循环同时收集证据持久化所需数据（每文件只读一次字节；originalFilename 仅用于展示）。
        final Set<String> arenaIds = new HashSet<>();
        final List<HundredReplayEvidenceService.PendingReplay> pendingReplays = new ArrayList<>();
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
                throw new IllegalArgumentException("HUNDRED_REPLAY_GAME_ID_MISMATCH");
            }
            if (player.tankId != vehicleId) {
                throw new IllegalArgumentException("HUNDRED_REPLAY_VEHICLE_MISMATCH");
            }
            if (!arenaIds.add(battle.arenaId)) {
                throw new IllegalArgumentException("HUNDRED_REPLAY_DUPLICATE_BATTLE");
            }
            pendingReplays.add(new HundredReplayEvidenceService.PendingReplay(
                    slot, HallOfFameUploadService.originalName(file), sha256(bytes), bytes.length,
                    battle.arenaId, bytes));
        }
        if (arenaIds.size() != REPLAY_COUNT) {
            throw new IllegalArgumentException("HUNDRED_REPLAY_DUPLICATE_BATTLE");
        }

        // CURRENT 门槛：新成绩必须严格高于当前 CURRENT（无 CURRENT 时允许重新开始）。
        final HundredBattleSubmission current = repository
                .findByUserKeycloakIdAndVehicleIdAndStatus(userId, vehicleId, "CURRENT").orElse(null);
        if (current != null && current.getApprovedAverageDamage() != null
                && claimedAverageDamage <= current.getApprovedAverageDamage()) {
            throw new IllegalStateException("HUNDRED_NOT_HIGHER");
        }

        // 锁协议临界区：sorted distinct hash locks → store → DB tx(commit) → unlock。
        final List<String> hashes = pendingReplays.stream()
                .map(HundredReplayEvidenceService.PendingReplay::sha256)
                .distinct()
                .sorted()
                .toList();
        return replayHashLock.runWithLocksResult(hashes, () -> createLocked(
                userId, vehicleId, gameId, claimedAverageDamage, claimedBattleCount,
                proofScreenshot, vehicle.name(), profile.getWotbNickname().trim(), pendingReplays, hashes));
    }

    /**
     * 锁内临界区：落盘 5 文件 → 单事务写 submission + 恰好 5 行 evidence → COMMIT。
     * DB 失败（含 unique index 竞态）→ TransactionTemplate 已 rollback 完成 → 锁内
     * 引用计数保护清理已存文件 → 映射错误码。绝不产生「只保存 3/5 个 replay 的合法 PENDING」。
     */
    private HundredCreateResult createLocked(final String userId,
                                             final long vehicleId,
                                             final long gameId,
                                             final int claimedAverageDamage,
                                             final int claimedBattleCount,
                                             final String proofScreenshot,
                                             final String vehicleName,
                                             final String nickname,
                                             final List<HundredReplayEvidenceService.PendingReplay> pendingReplays,
                                             final List<String> hashes) {
        // 全部硬门禁通过后落盘 5 个原始回放（内容寻址幂等；失败时已存文件 best-effort 清理，
        // 复用当前外层锁——不嵌套取锁防 self-deadlock）。
        evidenceService.storeAll(pendingReplays);

        final Long submissionId;
        try {
            submissionId = transactionTemplate.execute(status -> {
                final HundredBattleSubmission submission = new HundredBattleSubmission();
                submission.setUserKeycloakId(userId);
                submission.setVehicleId(vehicleId);
                submission.setVehicleName(vehicleName);
                submission.setGameAccountIdSnapshot(gameId);
                submission.setNicknameSnapshot(nickname);
                submission.setClaimedAverageDamage(claimedAverageDamage);
                submission.setClaimedBattleCount(claimedBattleCount);
                submission.setStatus(HundredBattleStatus.PENDING.name());
                submission.setProofScreenshot(proofScreenshot.trim());
                repository.saveAndFlush(submission);
                // submission 与 5 行 evidence 同事务原子写入；attach 失败 → 事务回滚 submission。
                evidenceService.attach(submission.getId(), pendingReplays);
                return submission.getId();
            });
        } catch (final DataIntegrityViolationException e) {
            // 并发双提交竞态：partial unique index 只允许一条 PENDING。
            // 注意：TransactionTemplate 已先完成 rollback，aborted transaction 状态已清除，
            // 此处 DB 引用计数查询可安全执行（Blocker 3）。
            evidenceService.cleanupStoredFiles(hashes);
            throw new IllegalStateException("HUNDRED_PENDING_EXISTS");
        } catch (final RuntimeException e) {
            evidenceService.cleanupStoredFiles(hashes);
            throw e;
        }
        return new HundredCreateResult(submissionId, HundredBattleStatus.PENDING.name());
    }

    /** 用户取消自己的 PENDING（不影响 CURRENT；proof 截图同事务清空）。 */
    @Transactional
    public HundredSubmissionSummaryDto cancelSubmission(final String userId, final long submissionId) {
        final HundredBattleSubmission submission = repository.findByIdForUpdate(submissionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "HUNDRED_SUBMISSION_NOT_FOUND"));
        if (!submission.getUserKeycloakId().equals(userId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "HUNDRED_FORBIDDEN");
        }
        requirePending(submission);
        submission.setStatus(HundredBattleStatus.CANCELLED.name());
        submission.setCancelledAt(OffsetDateTime.now());
        submission.setProofScreenshot(null);
        final HundredSubmissionSummaryDto result = mapper.toSummary(repository.save(submission));
        // 终态：同事务删 evidence 行 + commit 后引用计数清理物理文件（失败仅 WARN，不回滚 CANCEL）。
        evidenceService.discardForSubmission(submission.getId());
        return result;
    }

    // ── Phase 5：Public leaderboard ───────────────────────────────────────

    /**
     * 公开排行榜：单车辆独立排行（vehicleId 必传），competition ranking（1,2,2,4），
     * rank query-time 派生不落库。排序 approvedAverageDamage DESC → approvedAt ASC → id ASC。
     */
    @Transactional(readOnly = true)
    public HundredLeaderboardPageDto leaderboard(final long vehicleId, final int page, final int size) {
        final TankInfo vehicle = tankopedia.info(vehicleId);
        if (!(vehicle.tier() instanceof final Integer tier) || tier != 10) {
            throw new IllegalArgumentException("HUNDRED_NON_TIER_X");
        }
        final int effectiveSize = clamp(size);
        final Page<HundredBattleSubmission> rows = repository
                .findByVehicleIdAndStatusOrderByApprovedAverageDamageDescApprovedAtAscIdAsc(
                        vehicleId, "CURRENT", PageRequest.of(Math.max(0, page - 1), effectiveSize));
        return mapper.toLeaderboardPage(rows, vehicleId, vehicle.name(), page, effectiveSize, rankMap(vehicleId));
    }

    /** 全部 CURRENT 按伤害分组计数 → 前缀和 → damage → rank（跨页并列也全局正确）。 */
    private Map<Integer, Integer> rankMap(final long vehicleId) {
        final List<Object[]> groups = repository.countCurrentGroupedByDamage(vehicleId);
        final List<int[]> sorted = groups.stream()
                .map(g -> new int[]{((Number) g[0]).intValue(), ((Number) g[1]).intValue()})
                .sorted(Comparator.comparingInt((int[] g) -> g[0]).reversed())
                .toList();
        final Map<Integer, Integer> rank = new HashMap<>();
        int higher = 0;
        for (final int[] g : sorted) {
            rank.put(g[0], higher + 1);
            higher += g[1];
        }
        return rank;
    }

    // ── Phase 6：Profile ──────────────────────────────────────────────────

    /** 个人中心百场状态：CURRENT 纪录 + PENDING 申请 + 最近拒绝反馈。 */
    @Transactional(readOnly = true)
    public HundredUserStatusDto userStatus(final String userId) {
        return new HundredUserStatusDto(
                toSummaries(userId, "CURRENT"),
                toSummaries(userId, "PENDING"),
                repository.findByUserKeycloakIdAndStatusInOrderBySubmittedAtDesc(userId, List.of("REJECTED"))
                        .stream().limit(10).map(mapper::toSummary).toList());
    }

    private List<HundredSubmissionSummaryDto> toSummaries(final String userId, final String status) {
        return repository.findByUserKeycloakIdAndStatusInOrderBySubmittedAtDesc(userId, List.of(status))
                .stream().map(mapper::toSummary).toList();
    }

    // ── Phase 4：Admin moderation ─────────────────────────────────────────

    /** 管理后台列表：status 过滤（null = 全部）。 */
    @Transactional(readOnly = true)
    public HundredAdminPageDto adminList(final String status, final int page, final int size) {
        final String normalized = StringUtils.hasText(status) ? HundredBattleStatus.from(status).name() : null;
        final int effectiveSize = clamp(size);
        final Page<HundredBattleSubmission> rows = repository.searchAdmin(
                normalized, PageRequest.of(Math.max(0, page - 1), effectiveSize));
        return new HundredAdminPageDto(
                rows.getContent().stream().map(mapper::toAdminListItem).toList(),
                page, effectiveSize, rows.getTotalElements(), rows.getTotalPages());
    }

    /** 管理后台详情（审核页一屏；proofScreenshot 仅 PENDING 返回）。 */
    @Transactional(readOnly = true)
    public HundredAdminDetailDto adminDetail(final long submissionId) {
        final HundredBattleSubmission submission = repository.findById(submissionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "HUNDRED_SUBMISSION_NOT_FOUND"));
        return mapper.toAdminDetail(submission);
    }

    /**
     * APPROVE：事务内行锁重新读取 CURRENT，按管理员最终 approvedAverageDamage 严格比较；
     * 旧 CURRENT → SUPERSEDED，新 submission → CURRENT。与并发 CANCEL/REJECT/APPROVE
     * 由 submission 行锁 + 状态复核串行化（仅一次 PENDING → terminal 成功）。
     */
    @Transactional
    public HundredSubmissionSummaryDto approve(final String adminUserId,
                                               final long submissionId,
                                               final int approvedAverageDamage,
                                               final int approvedBattleCount) {
        if (approvedAverageDamage <= 0 || approvedBattleCount <= 0) {
            throw new IllegalArgumentException("HUNDRED_INVALID_APPROVED");
        }
        // 「百场」资格：管理员最终 approvedBattleCount 必须 ≥ 100（backend authoritative；前端仅 UX）。
        if (approvedBattleCount < MIN_APPROVED_BATTLE_COUNT) {
            throw new IllegalArgumentException("HUNDRED_APPROVED_BATTLE_COUNT_TOO_LOW");
        }
        final HundredBattleSubmission submission = repository.findByIdForUpdate(submissionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "HUNDRED_SUBMISSION_NOT_FOUND"));
        requirePending(submission);

        // APPROVE 前置：完整审核证据校验（backend authoritative，非前端 UX）。
        // 必须在任何业务状态改变之前——旧 CURRENT → SUPERSEDED 之前；失败时 submission 保持
        // PENDING、CURRENT 不变、evidence 与 screenshot 不清理。legacy PENDING（0 evidence）必然被拒。
        evidenceService.requireCompleteEvidenceForApproval(submission.getId(), submission.getProofScreenshot());

        // 重新读取 CURRENT（行锁），最终判断：approvedAverageDamage > current.approvedAverageDamage。
        final HundredBattleSubmission current = repository.findCurrentForUpdate(
                submission.getUserKeycloakId(), submission.getVehicleId()).orElse(null);
        if (current != null && current.getApprovedAverageDamage() != null
                && approvedAverageDamage <= current.getApprovedAverageDamage()) {
            throw new IllegalStateException("HUNDRED_APPROVE_STALE");
        }
        if (current != null) {
            current.setStatus(HundredBattleStatus.SUPERSEDED.name());
            // 显式 flush：让旧行先退出 CURRENT partial unique index（不能依赖 Hibernate
            // flush 顺序等于调用顺序）；整个 approve 仍是一个 @Transactional，后半段失败
            // 时本 UPDATE 随事务一并 rollback。
            repository.saveAndFlush(current);
        }
        submission.setApprovedAverageDamage(approvedAverageDamage);
        submission.setApprovedBattleCount(approvedBattleCount);
        submission.setStatus(HundredBattleStatus.CURRENT.name());
        submission.setApprovedAt(OffsetDateTime.now());
        submission.setApprovedBy(adminUserId);
        submission.setProofScreenshot(null);
        final HundredSubmissionSummaryDto result = mapper.toSummary(repository.saveAndFlush(submission));
        // 终态：同事务删 evidence 行 + commit 后引用计数清理物理文件（失败仅 WARN，不回滚 APPROVE）。
        evidenceService.discardForSubmission(submission.getId());
        return result;
    }

    /** REJECT：原因强制（OTHER 必须填文本）；proof 截图同事务清空；CURRENT 不变。 */
    @Transactional
    public HundredSubmissionSummaryDto reject(final String adminUserId,
                                              final long submissionId,
                                              final String rejectReason,
                                              final String rejectReasonText) {
        final String reason = requireCategory(rejectReason, "HUNDRED_REJECT_REASON_REQUIRED", REJECT_CATEGORIES);
        if ("OTHER".equals(reason) && !StringUtils.hasText(rejectReasonText)) {
            throw new IllegalArgumentException("HUNDRED_REJECT_REASON_TEXT_REQUIRED");
        }
        final HundredBattleSubmission submission = repository.findByIdForUpdate(submissionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "HUNDRED_SUBMISSION_NOT_FOUND"));
        requirePending(submission);
        submission.setStatus(HundredBattleStatus.REJECTED.name());
        submission.setRejectedAt(OffsetDateTime.now());
        submission.setRejectedBy(adminUserId);
        submission.setRejectReason(reason);
        submission.setRejectReasonText(StringUtils.hasText(rejectReasonText) ? rejectReasonText.trim() : null);
        submission.setProofScreenshot(null);
        final HundredSubmissionSummaryDto result = mapper.toSummary(repository.save(submission));
        // 终态：同事务删 evidence 行 + commit 后引用计数清理物理文件（失败仅 WARN，不回滚 REJECT）。
        evidenceService.discardForSubmission(submission.getId());
        return result;
    }

    /** 删除 CURRENT（管理员）：CURRENT → DELETED，不恢复 SUPERSEDED；原因强制。 */
    @Transactional
    public HundredSubmissionSummaryDto deleteCurrent(final String adminUserId,
                                                     final long submissionId,
                                                     final String deleteReason,
                                                     final String deleteReasonText) {
        final String reason = requireCategory(deleteReason, "HUNDRED_DELETE_REASON_REQUIRED", DELETE_CATEGORIES);
        if ("OTHER".equals(reason) && !StringUtils.hasText(deleteReasonText)) {
            throw new IllegalArgumentException("HUNDRED_DELETE_REASON_TEXT_REQUIRED");
        }
        final HundredBattleSubmission submission = repository.findByIdForUpdate(submissionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "HUNDRED_SUBMISSION_NOT_FOUND"));
        if (!"CURRENT".equals(submission.getStatus())) {
            throw new IllegalStateException("HUNDRED_NOT_CURRENT");
        }
        submission.setStatus(HundredBattleStatus.DELETED.name());
        submission.setDeletedAt(OffsetDateTime.now());
        submission.setDeletedBy(adminUserId);
        submission.setDeleteReason(reason);
        submission.setDeleteReasonText(StringUtils.hasText(deleteReasonText) ? deleteReasonText.trim() : null);
        return mapper.toSummary(repository.save(submission));
    }

    // ── 辅助 ──────────────────────────────────────────────────────────────

    private static void requirePending(final HundredBattleSubmission submission) {
        if (!"PENDING".equals(submission.getStatus())) {
            throw new IllegalStateException("HUNDRED_SUBMISSION_NOT_PENDING");
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

    private static String requireCategory(final String value, final String errorCode, final Set<String> categories) {
        if (!StringUtils.hasText(value)) {
            throw new IllegalArgumentException(errorCode);
        }
        final String normalized = value.trim().toUpperCase();
        if (!categories.contains(normalized)) {
            throw new IllegalArgumentException(errorCode);
        }
        return normalized;
    }

    /** 读取 MultipartFile 原始字节（读取失败 → 稳定 400 INVALID_REPLAY_FILE，非 500）。 */
    private static byte[] readBytes(final MultipartFile file) {
        try {
            return file.getBytes();
        } catch (final IOException e) {
            throw new IllegalArgumentException("INVALID_REPLAY_FILE");
        }
    }

    /** 解析失败 → 稳定 400 INVALID_REPLAY_FILE。 */
    private static Battle parse(final byte[] bytes) {
        try {
            return ReplayParser.parse(bytes);
        } catch (final Exception e) {
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

    /** 在 battle 名册中按 accountId 找玩家（gameId 匹配证据）。 */
    private static PlayerResult findPlayerByAccountId(final Battle battle, final long gameId) {
        if (battle.players == null) {
            return null;
        }
        return battle.players.stream()
                .filter(p -> p.accountId == gameId)
                .findFirst()
                .orElse(null);
    }

    private static int clamp(final int size) {
        if (size <= 0) return DEFAULT_PAGE_SIZE;
        return Math.min(size, MAX_PAGE_SIZE);
    }
}