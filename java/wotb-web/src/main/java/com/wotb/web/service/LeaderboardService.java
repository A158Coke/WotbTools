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

import java.util.List;
import java.util.Optional;

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
    private static final int RANDOM_BATTLE_BONUS_TYPE = 1;

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
    public void recordRecorder(final Battle battle, final Tankopedia tankopedia) {
        if (battle == null || battle.arenaId == null) {
            return;
        }
        // 只收随机战斗; 模式未知 (null) 也拒绝, 避免污染排行榜。
        if (battle.arenaBonusType == null || battle.arenaBonusType != RANDOM_BATTLE_BONUS_TYPE) {
            return;
        }
        final PlayerResult recorder = battle.recorderResult();
        if (recorder == null) {
            return;
        }
        if (repository.findByArenaIdAndAccountId(battle.arenaId, recorder.accountId).isPresent()) {
            return;
        }
        final LeaderboardRecord record = new LeaderboardRecord();
        record.setArenaId(battle.arenaId);
        record.setAccountId(recorder.accountId);
        record.setNickname(recorder.nickname);
        record.setTankId(recorder.tankId);
        record.setTankName(tankopedia.info(recorder.tankId).name());
        record.setDamageDealt(recorder.damageDealt);
        record.setMapName(battle.mapName);
        try {
            repository.save(record);
        } catch (final DataIntegrityViolationException ignored) {
            // 并发下唯一约束冲突: 另一次上传已写入同 (arena_id, account_id), 视为去重成功。
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

    /** 单条记录。 */
    public Optional<LeaderboardRecordDto> findById(final long id) {
        return repository.findById(id).map(LeaderboardService::toDto);
    }

    private static int clamp(final int limit) {
        if (limit <= 0) {
            return DEFAULT_LIMIT;
        }
        return Math.min(limit, MAX_LIMIT);
    }

    private static LeaderboardRecordDto toDto(final LeaderboardRecord r) {
        return new LeaderboardRecordDto(r.getId(), r.getArenaId(), r.getTankId(), r.getTankName(),
                r.getAccountId(), r.getNickname(), r.getDamageDealt(), r.getMapName(), r.getCreatedAt());
    }
}
