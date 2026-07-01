package com.wotb.web.service;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.Tankopedia;
import com.wotb.web.dto.LeaderboardPageDto;
import com.wotb.web.dto.LeaderboardRecordDto;
import com.wotb.web.entity.LeaderboardRecord;
import com.wotb.web.repository.LeaderboardRecordRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;

/**
 * 排行榜业务。MVP 只记录录像者本人单场成绩，不存全场 14 人，不存 replay 原文件。
 */
@Service
public class LeaderboardService {

    private static final int MAX_LIMIT = 200;
    private static final int DEFAULT_LIMIT = 50;
    private static final int BATTLE_TYPE = 1;

    private final LeaderboardRecordRepository repository;

    public LeaderboardService(final LeaderboardRecordRepository repository) {
        this.repository = repository;
    }

    public boolean recordRecorder(final Battle battle, final Tankopedia tankopedia) {
        if (battle == null || battle.arenaId == null) return false;
        if (battle.arenaBonusType == null || battle.arenaBonusType != BATTLE_TYPE) return false;
        final PlayerResult recorder = battle.recorderResult();
        if (recorder == null) return false;
        if (repository.findByArenaIdAndAccountId(battle.arenaId, recorder.accountId).isPresent()) return false;

        final LeaderboardRecord record = new LeaderboardRecord();
        record.setArenaId(battle.arenaId);
        record.setAccountId(recorder.accountId);
        record.setNickname(recorder.nickname);
        record.setTankId(recorder.tankId);
        record.setTankName(tankopedia.info(recorder.tankId).name());
        record.setDamageDealt(recorder.damageDealt);
        record.setMapName(battle.mapName);
        record.setVersion(battle.version != null && !battle.version.isEmpty() ? battle.version : null);
        if (battle.startTime != null) {
            final long epochSeconds = battle.startTime > 100_000_000_000L
                    ? battle.startTime / 1000L : battle.startTime;
            if (epochSeconds > 1_388_534_400L) {
                record.setBattleTime(OffsetDateTime.ofInstant(
                        Instant.ofEpochSecond(epochSeconds), ZoneOffset.UTC));
            }
        }
        try {
            repository.save(record);
            return true;
        } catch (final DataIntegrityViolationException ignored) {
            return false;
        }
    }

    /** 全局伤害榜（分页）。 */
    public LeaderboardPageDto topDamage(final int page, final int size) {
        final Pageable pageable = PageRequest.of(page - 1, clamp(size),
                Sort.by(Sort.Direction.DESC, "damageDealt", "id"));
        final Page<LeaderboardRecord> records = repository.findAllByOrderByDamageDealtDesc(pageable);
        return toPageDto(records, page, size);
    }

    /** 指定车辆的伤害榜（分页）。 */
    public LeaderboardPageDto topDamageByTank(final long tankId, final int page, final int size) {
        final Pageable pageable = PageRequest.of(page - 1, clamp(size),
                Sort.by(Sort.Direction.DESC, "damageDealt", "id"));
        final Page<LeaderboardRecord> records = repository.findByTankIdOrderByDamageDealtDesc(tankId, pageable);
        return toPageDto(records, page, size);
    }

    /** 指定玩家的伤害记录。保持 flat 返回供个人中心使用。 */
    public List<LeaderboardRecordDto> recordsByAccountId(final long accountId, final int limit) {
        return repository.findByAccountIdOrderByDamageDealtDesc(accountId, PageRequest.of(0, clamp(limit)))
                .stream().map(LeaderboardService::toDto).toList();
    }

    private static LeaderboardPageDto toPageDto(final Page<LeaderboardRecord> page, final int pageNo, final int pageSize) {
        return new LeaderboardPageDto(
                page.getContent().stream().map(LeaderboardService::toDto).toList(),
                pageNo, pageSize,
                page.getTotalElements(), page.getTotalPages());
    }

    private static int clamp(final int limit) {
        if (limit <= 0) return DEFAULT_LIMIT;
        return Math.min(limit, MAX_LIMIT);
    }

    static LeaderboardRecordDto toDto(final LeaderboardRecord r) {
        return new LeaderboardRecordDto(r.getId(), r.getArenaId(), r.getTankId(), r.getTankName(),
                r.getAccountId(), r.getNickname(), r.getDamageDealt(), r.getMapName(),
                r.getVersion(), r.getBattleTime(), r.getCreatedAt());
    }
}
