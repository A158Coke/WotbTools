package com.wotb.web.leaderboard.service;

import com.wotb.core.model.Battle;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.ref.Tankopedia;
import com.wotb.web.leaderboard.dto.ReplayFileMeta;
import com.wotb.web.leaderboard.storage.LeaderboardReplayStorage;
import com.wotb.web.replay.ReplayUploadValidator;
import com.wotb.web.replay.service.ReplayCapacityLimiter;
import com.wotb.web.util.JwtUtil;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Map;
import java.util.Optional;

/**
 * 排行榜上传编排（需登录）：校验 → 解析 → SHA-256 内容寻址落盘 → 记录入库（含 metadata）。
 * 一致性（终审 P0）：DB 更新失败不删除已入存储的文件——保留为安全 orphan，
 * 同 hash 未来上传直接复用；孤儿清理由未来 maintenance job 处理。
 */
@Service
public class LeaderboardUploadService {

    private static final int MAX_ORIGINAL_NAME = 255;

    private final LeaderboardService leaderboardService;
    private final ReplayCapacityLimiter capacityLimiter;
    private final LeaderboardReplayStorage storage;
    private final Tankopedia tankopedia = Tankopedia.load();

    public LeaderboardUploadService(
            final LeaderboardService leaderboardService,
            final ReplayCapacityLimiter capacityLimiter,
            final LeaderboardReplayStorage storage) {
        this.leaderboardService = leaderboardService;
        this.capacityLimiter = capacityLimiter;
        this.storage = storage;
    }

    public Map<String, Object> upload(final MultipartFile file) throws Exception {
        final String uploadedBy = JwtUtil.requireUserId();
        return capacityLimiter.execute(() -> {
            ReplayUploadValidator.validate(new MultipartFile[]{file});
            final byte[] bytes = file.getBytes();
            final Battle battle = parse(bytes);

            // Blocker：非随机战（arenaBonusType != 1，含训练房/娱乐/联赛/未知）在 SHA-256、
            // preflight、storage、DB 任何持久化之前直接拒绝 → 400 NON_RANDOM_BATTLE，
            // 不产生 DB 行、不落盘、不制造 orphan 文件。其余 SKIPPED（无录像者等）保持 skipped 语义。
            final RecordOutcome eligibility = leaderboardService.eligibility(battle);
            if (eligibility == RecordOutcome.SKIPPED_NON_RANDOM) {
                throw new IllegalArgumentException("NON_RANDOM_BATTLE");
            }
            if (eligibility.isSkipped()) {
                return skipped(eligibility, battle);
            }

            final String hash = sha256(bytes);
            final ReplayFileMeta meta = new ReplayFileMeta(hash, originalName(file), bytes.length, uploadedBy);

            // P1 preflight：写文件前确定无需落盘的 SKIPPED，避免正常请求稳定制造 orphan。
            final Optional<RecordOutcome> preflight = leaderboardService.preflightReplay(battle, meta);
            if (preflight.isPresent() && preflight.get() == RecordOutcome.SKIPPED_HASH_CONFLICT) {
                return skipped(preflight.get(), battle);
            }

            // 其他路径（记录不存在 / hash NULL 待 attach / 同 hash 幂等）→ 落盘（幂等复用、重建丢失文件）
            storage.store(bytes, hash);
            final RecordOutcome outcome = leaderboardService.recordRecorder(battle, tankopedia, meta);
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

    /**
     * 原始文件名仅用于 Content-Disposition：取 basename 并限长（≤255），绝不参与文件路径。
     * 无有效 basename（如 "/"、""、纯分隔符、空白）→ 安全 fallback "replay.wotbreplay"。
     */
    static String originalName(final MultipartFile file) {
        final String name = file.getOriginalFilename();
        String base = "";
        if (name != null) {
            final int slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
            base = slash >= 0 ? name.substring(slash + 1) : name;
        }
        if (!StringUtils.hasText(base)) {
            return "replay.wotbreplay";
        }
        return base.length() <= MAX_ORIGINAL_NAME
                ? base : base.substring(0, MAX_ORIGINAL_NAME);
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
