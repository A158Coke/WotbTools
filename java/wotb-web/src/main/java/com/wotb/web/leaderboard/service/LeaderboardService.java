package com.wotb.web.leaderboard.service;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.Tankopedia;
import com.wotb.web.leaderboard.dto.LeaderboardPageDto;
import com.wotb.web.leaderboard.dto.LeaderboardRecordDto;
import com.wotb.web.leaderboard.dto.ReplayDownload;
import com.wotb.web.leaderboard.dto.ReplayFileMeta;
import com.wotb.web.leaderboard.storage.LeaderboardReplayStorage;
import com.wotb.web.leaderboard.entity.LeaderboardRecord;
import com.wotb.web.leaderboard.repository.LeaderboardRecordRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * 排行榜业务。MVP 只记录录像者本人单场成绩，不存全场 14 人。
 * 原始 .wotbreplay 由 {@link com.wotb.web.leaderboard.storage.LeaderboardReplayStorage}
 * 内容寻址存储，本类只保存 replay metadata（hash/文件名/大小/上传者）。
 */
@Service
public class LeaderboardService {

    private static final int MAX_LIMIT = 200;
    private static final int DEFAULT_LIMIT = 50;

    /**
     * 排行榜支持的战斗模式（meta.json#arenaBonusType）——eligibility 与 recordRecorder 的
     * 单一事实源，禁止两处各自判断再次漂移。
     * <p>证据矩阵（真实回放探针 + 提交夹具，见 docs/features/leaderboard.md）：</p>
     * <ul>
     *   <li>1 = RANDOM（random-battle-example 等，supremacyCfg="regular"）→ 支持</li>
     *   <li>2 = TRAINING（training-room-example，supremacyCfg="training"）→ 不支持</li>
     *   <li>4 = TOURNAMENT supremacy（20260725_1555 等，supremacyCfg="tournament"）→ 不支持</li>
     *   <li>RATING（评级战）：仓库内暂无真实 Rating 回放 / 权威 arenaBonusType 证据
     *       （RATING_ARENA_BONUS_TYPE_NOT_PROVEN）→ 暂不支持；拿到真实样本证明后加入本集合。</li>
     * </ul>
     */
    private static final Set<Integer> SUPPORTED_BATTLE_TYPES = Set.of(1);

    /** 排行榜是否接受该战斗模式：raw arenaBonusType → RANDOM 支持 / 其余不支持（含 unknown/null）。 */
    public static boolean isLeaderboardSupportedBattleType(final Integer arenaBonusType) {
        return arenaBonusType != null && SUPPORTED_BATTLE_TYPES.contains(arenaBonusType);
    }

    private final LeaderboardRecordRepository repository;
    private final LeaderboardRecordMapper mapper;
    private final LeaderboardReplayStorage storage;

    public LeaderboardService(final LeaderboardRecordRepository repository,
                              final LeaderboardRecordMapper mapper,
                              final LeaderboardReplayStorage storage) {
        this.repository = repository;
        this.mapper = mapper;
        this.storage = storage;
    }

    /** 下载回放：记录无 hash / 文件缺失（best-effort 语义）→ 404 REPLAY_FILE_NOT_FOUND。 */
    public ReplayDownload downloadReplay(final long id) {
        final LeaderboardRecord record = repository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "REPLAY_FILE_NOT_FOUND"));
        final String hash = record.getReplayHash();
        if (!StringUtils.hasText(hash)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "REPLAY_FILE_NOT_FOUND");
        }
        final Path file = storage.load(hash)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "REPLAY_FILE_NOT_FOUND"));
        try {
            return new ReplayDownload(Files.readAllBytes(file), record.getReplayFileName());
        } catch (final IOException e) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "REPLAY_FILE_NOT_FOUND");
        }
    }

    /**
     * 纯内存 eligibility（写文件前的 preflight）：不支持战斗模式（含训练房/联赛/未知）/
     * 无录像者 → SKIPPED，其余返回 SAVED（仅表示 eligible，不代表入库结果）。
     */
    public RecordOutcome eligibility(final Battle battle) {
        if (battle == null || battle.arenaId == null) return RecordOutcome.SKIPPED_UNKNOWN_RECORDER;
        if (!isLeaderboardSupportedBattleType(battle.arenaBonusType)) {
            return RecordOutcome.SKIPPED_UNSUPPORTED_BATTLE_TYPE;
        }
        if (battle.recorderResult() == null) return RecordOutcome.SKIPPED_UNKNOWN_RECORDER;
        return RecordOutcome.SAVED;
    }

    /**
     * 写文件前的 hash 预判（避免无意义落盘）：已存在记录且 replay_hash 非 NULL 时
     * 返回确定的 IDEMPOTENT / SKIPPED_HASH_CONFLICT；hash NULL 或记录不存在返回 empty
     * （需要继续走完整原子状态机）。并发竞态下该预判可能过期，最终以
     * {@link #recordRecorder} 的 DB 原子结果为准。
     */
    public Optional<RecordOutcome> preflightReplay(final Battle battle, final ReplayFileMeta meta) {
        if (battle == null || battle.arenaId == null) return Optional.empty();
        final PlayerResult recorder = battle.recorderResult();
        if (recorder == null) return Optional.empty();
        final var existing = repository.findByArenaIdAndAccountId(battle.arenaId, recorder.accountId);
        if (existing.isEmpty()) return Optional.empty();
        final String currentHash = existing.get().getReplayHash();
        if (currentHash == null) return Optional.empty();
        return meta != null && meta.sha256().equals(currentHash)
                ? Optional.of(RecordOutcome.IDEMPOTENT)
                : Optional.of(RecordOutcome.SKIPPED_HASH_CONFLICT);
    }

    /**
     * 录像者单场成绩入库状态机（含 replay metadata），DB 原子：
     * 新建 → SAVED（unique race 后 re-read winner 分类）；
     * 已存在且 replay_hash NULL → 原子 conditional UPDATE（唯一 winner）→ ATTACHED，败者 re-read 分类；
     * 已存在且同 hash → IDEMPOTENT；已存在且异 hash → SKIPPED_HASH_CONFLICT（绝不覆盖）。
     */
    public RecordOutcome recordRecorder(final Battle battle, final Tankopedia tankopedia,
                                        final ReplayFileMeta meta) {
        if (battle == null || battle.arenaId == null) return RecordOutcome.SKIPPED_UNKNOWN_RECORDER;
        if (!isLeaderboardSupportedBattleType(battle.arenaBonusType)) {
            return RecordOutcome.SKIPPED_UNSUPPORTED_BATTLE_TYPE;
        }
        final PlayerResult recorder = battle.recorderResult();
        if (recorder == null) return RecordOutcome.SKIPPED_UNKNOWN_RECORDER;

        final var existing = repository.findByArenaIdAndAccountId(battle.arenaId, recorder.accountId);
        if (existing.isPresent()) {
            final String currentHash = existing.get().getReplayHash();
            if (currentHash == null) {
                // 原子 attach：conditional UPDATE ... WHERE replay_hash IS NULL → affected=1 即唯一 winner。
                final int updated = repository.attachReplayMetadata(
                        existing.get().getId(), meta.sha256(), meta.originalName(),
                        meta.size(), meta.uploadedBy());
                if (updated == 1) {
                    return RecordOutcome.ATTACHED;
                }
                // 并发竞态：另一个请求已先 attach → re-read winner 后重新分类，绝不覆盖。
                return classifyByCurrentHash(battle.arenaId, recorder.accountId, meta);
            }
            return meta != null && meta.sha256().equals(currentHash)
                    ? RecordOutcome.IDEMPOTENT
                    : RecordOutcome.SKIPPED_HASH_CONFLICT;
        }

        final LeaderboardRecord record = new LeaderboardRecord();
        record.setArenaId(battle.arenaId);
        record.setAccountId(recorder.accountId);
        record.setNickname(recorder.nickname);
        record.setTankId(recorder.tankId);
        record.setTankName(tankopedia.info(recorder.tankId).name());
        record.setDamageDealt(recorder.damageDealt);
        record.setMapName(battle.mapName);
        record.setVersion(StringUtils.hasText(battle.version) ? battle.version : null);
        if (battle.startTime != null) {
            final long epochSeconds = battle.startTime > 100_000_000_000L
                    ? battle.startTime / 1000L : battle.startTime;
            if (epochSeconds > 1_388_534_400L) {
                record.setBattleTime(OffsetDateTime.ofInstant(
                        Instant.ofEpochSecond(epochSeconds), ZoneOffset.UTC));
            }
        }
        applyReplayMeta(record, meta);
        try {
            repository.saveAndFlush(record);
            return RecordOutcome.SAVED;
        } catch (final DataIntegrityViolationException e) {
            // 并发首次 insert 竞态：unique 约束只允许一条 → re-read winner 后重新分类 hash，
            // 禁止无条件返回 IDEMPOTENT。
            return classifyByCurrentHash(battle.arenaId, recorder.accountId, meta);
        }
    }

    /** 竞态后按 winner 当前 hash 分类：同 hash → IDEMPOTENT；异 hash / 无 hash → SKIPPED_HASH_CONFLICT。 */
    private RecordOutcome classifyByCurrentHash(final String arenaId, final long accountId,
                                                final ReplayFileMeta meta) {
        final LeaderboardRecord winner = repository
                .findByArenaIdAndAccountId(arenaId, accountId).orElse(null);
        if (winner == null) {
            return RecordOutcome.SKIPPED_UNKNOWN_RECORDER;
        }
        final String winnerHash = winner.getReplayHash();
        if (winnerHash == null) {
            // 防御：winner 无 hash（理论不发生，insert 恒带 meta）——不覆盖。
            return RecordOutcome.SKIPPED_HASH_CONFLICT;
        }
        return meta != null && meta.sha256().equals(winnerHash)
                ? RecordOutcome.IDEMPOTENT
                : RecordOutcome.SKIPPED_HASH_CONFLICT;
    }

    private static void applyReplayMeta(final LeaderboardRecord record, final ReplayFileMeta meta) {
        if (meta == null) {
            return;
        }
        record.setReplayHash(meta.sha256());
        record.setReplayFileName(meta.originalName());
        record.setReplaySize(meta.size());
        record.setReplayUploadedBy(meta.uploadedBy());
    }

    /** 全局伤害榜（分页）。 */
    public LeaderboardPageDto topDamage(final int page, final int size) {
        final Pageable pageable = PageRequest.of(page - 1, clamp(size),
                Sort.by(Sort.Direction.DESC, "damageDealt", "id"));
        final Page<LeaderboardRecord> records = repository.findAllByOrderByDamageDealtDesc(pageable);
        return mapper.toPageDto(records, page, size);
    }

    /** 指定车辆的伤害榜（分页）。 */
    public LeaderboardPageDto topDamageByTank(final long tankId, final int page, final int size) {
        final Pageable pageable = PageRequest.of(page - 1, clamp(size),
                Sort.by(Sort.Direction.DESC, "damageDealt", "id"));
        final Page<LeaderboardRecord> records = repository.findByTankIdOrderByDamageDealtDesc(tankId, pageable);
        return mapper.toPageDto(records, page, size);
    }

    /** 指定玩家的伤害记录。保持 flat 返回供个人中心使用。 */
    public List<LeaderboardRecordDto> recordsByAccountId(final long accountId, final int limit) {
        return repository.findByAccountIdOrderByDamageDealtDesc(accountId, PageRequest.of(0, clamp(limit)))
                .stream().map(mapper::toDto).toList();
    }

    private static int clamp(final int limit) {
        if (limit <= 0) return DEFAULT_LIMIT;
        return Math.min(limit, MAX_LIMIT);
    }


}
