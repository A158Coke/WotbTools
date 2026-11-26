package com.wotb.web.hof.service;

import com.wotb.core.model.Battle;
import com.wotb.core.ref.Tankopedia;
import com.wotb.web.hof.dto.ReplayFileMeta;
import com.wotb.web.replayfile.ReplayUploadValidator;
import com.wotb.web.replay.service.ReplayCapacityLimiter;
import com.wotb.web.replayfile.ClientReplayFacts;
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

    /**
     * @param factsJson 客户端本地解析（上游 Rust Core）的结算事实（{@link ClientReplayFacts}）；
     *                  {@code file} 只作证据附件存档，服务器没有 parser。
     */
    public Map<String, Object> upload(final MultipartFile file, final String factsJson) throws Exception {
        final String uploadedBy = JwtUtil.requireUserId();
        return capacityLimiter.execute(() -> {
            ReplayUploadValidator.validate(new MultipartFile[]{file});
            final byte[] bytes = file.getBytes();
            final Battle battle = ClientReplayFacts.read(factsJson);

            final RecordOutcome eligibility = hallOfFameService.eligibility(battle);
            if (eligibility == RecordOutcome.SKIPPED_UNSUPPORTED_BATTLE_TYPE) {
                throw new IllegalArgumentException("UNSUPPORTED_BATTLE_TYPE");
            }
            if (eligibility.isSkipped()) {
                return skipped(eligibility, battle);
            }

            final String hash = sha256(bytes);
            final ReplayFileMeta meta = new ReplayFileMeta(hash, ReplayFileNames.originalName(file), bytes.length, uploadedBy);

            final Optional<RecordOutcome> preflight = hallOfFameService.preflightReplay(battle, meta);
            if (preflight.isPresent() && preflight.get() == RecordOutcome.SKIPPED_HASH_CONFLICT) {
                return skipped(preflight.get(), battle);
            }

            final RecordOutcome outcome = replayHashLock.runWithLockResult(hash, () -> {
                storage.store(bytes, hash);
                return hallOfFameService.recordRecorder(battle, tankopedia, meta);
            });
            final String arenaId = battle.arenaId == null ? "" : battle.arenaId;
            if (outcome == RecordOutcome.IDEMPOTENT) {
                return Map.of("status", "already_recorded", "arenaId", arenaId);
            }
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

    private static String sha256(final byte[] data) {
        try {
            final MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest(data));
        } catch (final NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
