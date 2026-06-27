package com.wotb.web.service;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.Tankopedia;
import com.wotb.web.dto.LeaderboardRecordDto;
import com.wotb.web.entity.LeaderboardRecord;
import com.wotb.web.repository.LeaderboardRecordRepository;
import org.springframework.context.annotation.Profile;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;

/**
 * 排行榜业务 (仅 postgres profile)。MVP 只记录录像者本人单场成绩, 不存全场 14 人,
 * 不存 replay 原文件。默认/离线 profile 无此 bean, 由 ReplayService 经 ObjectProvider 可选调用。
 */
@Service
@Profile("postgres")
public class LeaderboardService {

    private static final int MAX_LIMIT = 200;
    private static final int DEFAULT_LIMIT = 50;
    /**
     * 排行榜只收随机战斗 (meta.json#arenaBonusType==1); 训练房(==2)/娱乐/联赛等一律拒绝。
     * 取值经真实样本核实: 1=随机, 2=训练房 (docs/replay-data.md 旧表的 "2=随机" 系误标)。
     */
    private static final int BATTLE_TYPE = 1;

    private final LeaderboardRecordRepository repository;

    public LeaderboardService(final LeaderboardRecordRepository repository) {
        this.repository = repository;
    }

    /**
     * 记录某场战斗中录像者本人的成绩 (best-effort)。
     * 仅随机战斗 (arenaBonusType==1) 计入; 训练房(2)/娱乐/联赛等拒绝。
     * meta 无录像者 accountId, 故按昵称在 players 中匹配 battle.recorder; 匹配不到则跳过。
     * 已存在 (arena_id, account_id) 则不重复插入。
     */
    public boolean recordRecorder(final Battle battle, final Tankopedia tankopedia) {
        if (battle == null || battle.arenaId == null) {
            return false;
        }
        if (battle.arenaBonusType == null || battle.arenaBonusType != BATTLE_TYPE) {
            return false;
        }
        final PlayerResult recorder = battle.recorderResult();
        if (recorder == null) {
            return false;
        }
        if (repository.findByArenaIdAndAccountId(battle.arenaId, recorder.accountId).isPresent()) {
            return false;
        }
        final LeaderboardRecord record = new LeaderboardRecord();
        record.setArenaId(battle.arenaId);
        record.setAccountId(recorder.accountId);
        record.setNickname(recorder.nickname);
        record.setTankId(recorder.tankId);
        record.setTankName(tankopedia.info(recorder.tankId).name());
        record.setDamageDealt(recorder.damageDealt);
        record.setMapName(battle.mapName);
        record.setVersion(battle.version != null && !battle.version.isEmpty() ? battle.version : null);
        // 过滤无效时间戳: 0 或早于 WoT Blitz 发布 (2014); 兼容秒级/毫秒级 epoch。
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

    /** 全局伤害榜 (降序)。 */
    public List<LeaderboardRecordDto> topDamage(final int limit) {
        return repository.findAllByOrderByDamageDealtDesc(PageRequest.of(0, clamp(limit)))
                .stream().map(LeaderboardService::toDto).toList();
    }

    /** 指定车辆的伤害榜 (降序)。 */
    public List<LeaderboardRecordDto> topDamageByTank(final long tankId, final int limit) {
        return repository.findByTankIdOrderByDamageDealtDesc(tankId, PageRequest.of(0, clamp(limit)))
                .stream().map(LeaderboardService::toDto).toList();
    }

    private static int clamp(final int limit) {
        if (limit <= 0) {
            return DEFAULT_LIMIT;
        }
        return Math.min(limit, MAX_LIMIT);
    }

    private static LeaderboardRecordDto toDto(final LeaderboardRecord r) {
        return new LeaderboardRecordDto(r.getId(), r.getArenaId(), r.getTankId(), r.getTankName(),
                r.getAccountId(), r.getNickname(), r.getDamageDealt(), r.getMapName(),
                r.getVersion(), r.getBattleTime(), r.getCreatedAt());
    }
}
