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
import com.wotb.web.user.service.UserProfileService;
import com.wotb.web.user.service.UserProfileSnapshot;
import com.wotb.web.user.service.WotbAccountIdentity;
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

/**
 * 名人堂「百场」业务（docs/features/hall-of-fame.md 百场需求）。
 *
 * <p>核心不变量（全部由 DB + 行锁保证，非前端保证）：</p>
 * <ul>
 *   <li>WotB 账号 + vehicle 最多一个 active PENDING / CURRENT（V18/V22 partial unique index）</li>
 *   <li>APPROVE/REJECT/CANCEL 只能从 PENDING 成功一次（{@link #findByIdForUpdate} 行锁 + 状态复核）</li>
 *   <li>APPROVE 只使用创建时冻结的 MANUAL 申报值，并按其场均严格比较</li>
 *   <li>身份/成绩快照创建瞬间冻结；排行榜只读 approved*</li>
 * </ul>
 *
 * <p>proof 生命周期：MANUAL 来源的截图与 5 个原始 {@code .wotbreplay} 只在 PENDING 保留，
 * 终态事务内清空并在 commit 后 best-effort 清理无引用物理文件。</p>
 */
@Service
public class HundredBattleSubmissionService {

    private static final int MAX_IMAGE_CHARS = 5_500_000;
    private static final int REPLAY_COUNT = 5;
    /** 「百场」资格最低场次：写入排行榜的冻结 battleCount 必须 ≥ 100。 */
    private static final int MIN_APPROVED_BATTLE_COUNT = 100;

    /** 拒绝原因分类。 */
    static final Set<String> REJECT_CATEGORIES = Set.of(
            "SCREENSHOT_MISMATCH", "SCREENSHOT_UNREADABLE", "INSUFFICIENT_PROOF", "SUSPECTED_FRAUD", "OTHER");
    /** 删除原因分类。 */
    static final Set<String> DELETE_CATEGORIES = Set.of(
            "CHEATING_FORGERY", "WRONG_REVIEW", "PLAYER_IDENTITY_ISSUE", "DATA_ERROR", "ADMIN_CORRECTION", "OTHER");

    private final HundredBattleSubmissionRepository repository;
    private final HundredBattleMapper mapper;
    private final UserProfileService userProfileService;
    private final HundredReplayEvidenceService evidenceService;
    private final ReplayCapacityLimiter capacityLimiter;
    private final ReplayHashLock replayHashLock;
    private final TransactionTemplate transactionTemplate;
    private final Tankopedia tankopedia = Tankopedia.load();

    public HundredBattleSubmissionService(
            final HundredBattleSubmissionRepository repository,
            final HundredBattleMapper mapper,
            final UserProfileService userProfileService,
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
        // canonical owner 含区服：(CN, 123456) 与 (EU, 123456) 是两个不同账号。
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
        // 服务器没有 parser：结算事实由客户端本地解析后与回放一一对应提交，回放只作证据存档
        final List<Battle> battles = ClientReplayFacts.readAll(replayFacts, replays.size());

        // PENDING 唯一性 cheap check：明知已有同车 PENDING 时不再解析 5 个 replay；
        // 并发竞态仍由 DB partial unique index 兜底（见 createLocked 内 saveAndFlush 的 catch）。
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

    /** 许可内执行 replay bytes 读取、校验、hash、落盘及事务提交的完整重型生命周期。 */
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
        // cheap preflight 后可能有并发请求已创建 PENDING；在读取五份 replay 前再次检查。
        requireNoPending(wotbServer, gameId, vehicleId);

        // 硬门禁：5 个 replay 全部匹配 gameId/vehicleId 且 arenaId 不重复。
        // 每个文件只读一次 bytes；文件名仅用于展示。
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

        // CURRENT 门槛：新成绩必须严格高于当前 CURRENT（无 CURRENT 时允许重新开始）。
        final HundredBattleSubmission current = repository
                .findByWotbServerAndWotbAccountIdAndVehicleIdAndStatus(wotbServer, gameId, vehicleId, "CURRENT")
                .orElse(null);
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
                vehicleId, gameId, wotbServer, claimedAverageDamage, claimedBattleCount,
                proofScreenshot, vehicleName, nickname, pendingReplays, hashes));
    }

    /** WG 用户首次提交可能尚未访问 ProfilePage，先按可信登录身份创建 Profile。 */
    private UserProfileSnapshot findProfileForSubmission(final String userId) {
        final UserProfileSnapshot existing = userProfileService.findSnapshotByKeycloakUserId(userId).orElse(null);
        if (existing != null) {
            return existing;
        }
        if (!userProfileService.hasTrustedWargamingIdentity()) {
            throw new IllegalArgumentException("PROFILE_NOT_FOUND");
        }
        userProfileService.syncFromLogin(userId);
        return userProfileService.findSnapshotByKeycloakUserId(userId)
                .orElseThrow(() -> new IllegalArgumentException("PROFILE_NOT_FOUND"));
    }

    /**
     * 锁内临界区：落盘 5 文件 → 单事务写 submission + 恰好 5 行 evidence → COMMIT。
     * DB 失败（含 unique index 竞态）→ TransactionTemplate 已 rollback 完成 → 锁内
     * 引用计数保护清理已存文件 → 映射错误码。绝不产生「只保存 3/5 个 replay 的合法 PENDING」。
     */
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
        // 全部硬门禁通过后落盘 5 个原始回放（内容寻址幂等；失败时已存文件 best-effort 清理，
        // 复用当前外层锁——不嵌套取锁防 self-deadlock）。
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

    /**
     * 用户取消自己的 PENDING（不影响 CURRENT；终态清理截图与回放证据）。
     * ownership 以当前绑定的 canonical 身份 {@code (区服, WotB 账号)} 判定：
     * 未绑定账号、或记录归属其他 (区服, 账号) → 403。
     * 记录创建后用户改绑到别的账号时，记录仍属于原 (区服, 账号)，因此不可再取消。
     */
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

    // ── Phase 6：Profile ──────────────────────────────────────────────────

    /**
     * 个人中心百场状态：CURRENT 纪录 + PENDING 申请 + 最近拒绝反馈。
     * 归属按当前绑定的 canonical 身份 {@code (区服, WotB 账号)} 查询；
     * 未绑定账号时没有任何属于该身份的记录，三个列表均为空。
     */
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

    // ── 辅助 ──────────────────────────────────────────────────────────────

    /**
     * 记录是否属于当前绑定身份。canonical owner 是 {@code (区服, WotB 账号)}，
     * 不是 Keycloak sub；只比账号 ID 会让跨服同号互相看见。
     */
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

    /** 审批成绩必须是提交时冻结的 MANUAL 申报值，并先经过截图与回放证据门禁。 */
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

    /** 读取 MultipartFile 原始字节（读取失败 → 稳定 400 INVALID_REPLAY_FILE，非 500）。 */
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

}
