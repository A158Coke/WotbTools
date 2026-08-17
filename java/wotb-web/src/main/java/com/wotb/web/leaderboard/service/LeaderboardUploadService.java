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
            final String hash = sha256(bytes);
            storage.store(bytes, hash);
            final ReplayFileMeta meta = new ReplayFileMeta(hash, originalName(file), bytes.length, uploadedBy);
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

    /** 解析失败 → 稳定 400 INVALID_REPLAY_FILE（区别于 storage 的 5xx）。 */
    private static Battle parse(final byte[] bytes) {
        try {
            return ReplayParser.parse(bytes);
        } catch (final Exception e) {
            throw new IllegalArgumentException("INVALID_REPLAY_FILE");
        }
    }

    /** 原始文件名仅用于 Content-Disposition：取 basename 并限长，绝不参与文件路径。 */
    private static String originalName(final MultipartFile file) {
        final String name = file.getOriginalFilename();
        if (name == null || name.isBlank()) {
            return "";
        }
        final String base = name.contains("/") || name.contains("\\")
                ? name.substring(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1)
                : name;
        return StringUtils.hasText(base) && base.length() <= MAX_ORIGINAL_NAME ? base : base.substring(0, MAX_ORIGINAL_NAME);
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