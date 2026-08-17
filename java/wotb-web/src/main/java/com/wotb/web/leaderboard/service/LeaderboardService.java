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

/**
 * 排行榜业务。MVP 只记录录像者本人单场成绩，不存全场 14 人。
 * 原始 .wotbreplay 由 {@link com.wotb.web.leaderboard.storage.LeaderboardReplayStorage}
 * 内容寻址存储，本类只保存 replay metadata（hash/文件名/大小/上传者）。
 */
@Service
public class LeaderboardService {

    private static final int MAX_LIMIT = 200;
    private static final int DEFAULT_LIMIT = 50;
    private static final int BATTLE_TYPE = 1;

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
     * 录像者单场成绩入库状态机（含 replay metadata）：
     * 新建 → SAVED；已存在且 replay_hash NULL → ATTACHED（补写）；
     * 已存在且同 hash → IDEMPOTENT；已存在且异 hash → SKIPPED_HASH_CONFLICT（绝不覆盖）。
     */
    public RecordOutcome recordRecorder(final Battle battle, final Tankopedia tankopedia,
                                        final ReplayFileMeta meta) {
        if (battle == null || battle.arenaId == null) return RecordOutcome.SKIPPED_UNKNOWN_RECORDER;
        if (battle.arenaBonusType == null || battle.arenaBonusType != BATTLE_TYPE) {
            return RecordOutcome.SKIPPED_NON_RANDOM;
        }
        final PlayerResult recorder = battle.recorderResult();
        if (recorder == null) return RecordOutcome.SKIPPED_UNKNOWN_RECORDER;

        final var existing = repository.findByArenaIdAndAccountId(battle.arenaId, recorder.accountId);
        if (existing.isPresent()) {
            final LeaderboardRecord r = existing.get();
            if (r.getReplayHash() == null) {
                applyReplayMeta(r, meta);
                repository.save(r);
                return RecordOutcome.ATTACHED;
            }
            if (meta != null && meta.sha256().equals(r.getReplayHash())) {
                return RecordOutcome.IDEMPOTENT;
            }
            return RecordOutcome.SKIPPED_HASH_CONFLICT;
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
            repository.save(record);
            return RecordOutcome.SAVED;
        } catch (final DataIntegrityViolationException ignored) {
            // 并发插入竞态：另一请求已建同 (arena_id, account_id) 记录，视为幂等。
            return RecordOutcome.IDEMPOTENT;
        }
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