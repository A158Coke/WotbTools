package com.wotb.web.hof.service;

import com.wotb.core.model.Battle;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.ref.Tankopedia;
import com.wotb.web.hof.dto.ReplayFileMeta;
import com.wotb.web.replay.ReplayUploadValidator;
import com.wotb.web.replay.service.ReplayCapacityLimiter;
import com.wotb.web.replayfile.HallOfFameReplayStorage;
import com.wotb.web.replayfile.ReplayFileNames;
import com.wotb.web.replayfile.ReplayHashLock;
import com.wotb.web.util.JwtUtil;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Map;
import java.util.Optional;

/**
 * 名人堂上传编排（需登录）：校验 → 解析 → battle-type policy（不支持模式零持久化拒绝）→
 * SHA-256 内容寻址落盘 → 记录入库（含 metadata）。
 * 一致性（终审 P0）：DB 更新失败不删除已入存储的文件——保留为安全 orphan，
 * 同 hash 未来上传直接复用；孤儿清理由未来 maintenance job 处理。
 */
@Service
public class HallOfFameUploadService {

    private final HallOfFameService hallOfFameService;
    private final ReplayCapacityLimiter capacityLimiter;
    private final HallOfFameReplayStorage storage;
    private final ReplayHashLock replayHashLock;
    private final Tankopedia tankopedia = Tankopedia.load();

    public HallOfFameUploadService(
            final HallOfFameService hallOfFameService,
            final ReplayCapacityLimiter capacityLimiter,
            final HallOfFameReplayStorage storage,
            final ReplayHashLock replayHashLock) {
        this.hallOfFameService = hallOfFameService;
        this.capacityLimiter = capacityLimiter;
        this.storage = storage;
        this.replayHashLock = replayHashLock;
    }

    public Map<String, Object> upload(final MultipartFile file) throws Exception {
        final String uploadedBy = JwtUtil.requireUserId();
        return capacityLimiter.execute(() -> {
            ReplayUploadValidator.validate(new MultipartFile[]{file});
            final byte[] bytes = file.getBytes();
            final Battle battle = parse(bytes);

            // Blocker：不支持战斗模式（训练房/联赛/娱乐/未知等，见 HallOfFameBattleTypePolicy
            // 单一事实源）在 SHA-256、preflight、storage、DB 任何持久化之前直接拒绝
            // → 400 UNSUPPORTED_BATTLE_TYPE，零持久化（DB 写入=0、metadata 写入=0、文件写入=0）。
            final RecordOutcome eligibility = hallOfFameService.eligibility(battle);
            if (eligibility == RecordOutcome.SKIPPED_UNSUPPORTED_BATTLE_TYPE) {
                throw new IllegalArgumentException("UNSUPPORTED_BATTLE_TYPE");
            }
            if (eligibility.isSkipped()) {
                return skipped(eligibility, battle);
            }

            final String hash = sha256(bytes);
            final ReplayFileMeta meta = new ReplayFileMeta(hash, ReplayFileNames.originalName(file), bytes.length, uploadedBy);

            // P1 preflight：写文件前确定无需落盘的 SKIPPED，避免正常请求稳定制造 orphan。
            final Optional<RecordOutcome> preflight = hallOfFameService.preflightReplay(battle, meta);
            if (preflight.isPresent() && preflight.get() == RecordOutcome.SKIPPED_HASH_CONFLICT) {
                return skipped(preflight.get(), battle);
            }

            // 落盘 + 入库在 hash advisory lock 内（与 admin delete 的文件清理串行化，
            // 保证不变量：DB 引用 H ⇒ 物理 H.wotbreplay 存在）。
            final RecordOutcome outcome = replayHashLock.runWithLockResult(hash, () -> {
                storage.store(bytes, hash);
                return hallOfFameService.recordRecorder(battle, tankopedia, meta);
            });
            final String arenaId = battle.arenaId == null ? "" : battle.arenaId;
            if (outcome.isSkipped()) {
                return Map.of(
                        "status", "skipped",
                        "arenaId", arenaId,
                        "reasonCode", outcome.getReasonCode()
                );
            }
            return Map.of("status", "ok", "arenaId", arenaId);
        });
    }

    private static Map<String, Object> skipped(final RecordOutcome outcome, final Battle battle) {
        return Map.of(
                "status", "skipped",
                "arenaId", battle.arenaId == null ? "" : battle.arenaId,
                "reasonCode", outcome.getReasonCode()
        );
    }

    /** 解析失败 → 稳定 400 INVALID_REPLAY_FILE（区别于 storage 的 5xx）。 */
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
}
