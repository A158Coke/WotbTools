package com.wotb.web.hof.service;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.TankInfo;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.ref.VehicleCodes;
import com.wotb.web.hof.dto.HallOfFamePageDto;
import com.wotb.web.hof.dto.HallOfFameRecordDto;
import com.wotb.web.hof.dto.HofVehicleOptionDto;
import com.wotb.web.hof.dto.ReplayFileMeta;
import com.wotb.web.hof.entity.HallOfFameRecord;
import com.wotb.web.hof.policy.HallOfFameBattleType;
import com.wotb.web.hof.policy.HallOfFameBattleTypePolicy;
import com.wotb.web.hof.repository.HallOfFameRecordRepository;
import com.wotb.web.hof.repository.HofVehicleProjection;
import com.wotb.web.replayfile.HallOfFameReplayStorage;
import com.wotb.web.replayfile.HofReplayReferenceCounter;
import com.wotb.web.replayfile.ReplayDownload;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * 名人堂业务。MVP 只记录录像者本人单场成绩，不存全场 14 人。
 * 原始 .wotbreplay 由 {@link HallOfFameReplayStorage} 内容寻址存储，本类只保存 replay metadata。
 * 成绩所有权 = 回放录像者（recorder），uploadedBy 仅表示谁上传了回放。
 */
@Service
public class HallOfFameService implements HofReplayReferenceCounter {

    private static final int MAX_LIMIT = 200;
    private static final int DEFAULT_LIMIT = 50;

    private final HallOfFameRecordRepository repository;
    private final HallOfFameRecordMapper mapper;
    private final HallOfFameReplayStorage storage;
    private final Tankopedia tankopedia = Tankopedia.load();

    public HallOfFameService(final HallOfFameRecordRepository repository,
                             final HallOfFameRecordMapper mapper,
                             final HallOfFameReplayStorage storage) {
        this.repository = repository;
        this.mapper = mapper;
        this.storage = storage;
    }

    /** 下载回放：记录无 hash / 文件缺失（best-effort 语义）→ 404 REPLAY_FILE_NOT_FOUND。 */
    public ReplayDownload downloadReplay(final long id) {
        final HallOfFameRecord record = repository.findById(id)
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
     * 某回放 hash 在名人堂记录中的引用数（百场 evidence 物理文件清理时的跨域引用计数）。
     * 百场与名人堂共享同一内容寻址存储目录，删除文件前必须确认两个域都无引用。
     */
    @Override
    public long countHofReferences(final String sha256) {
        return repository.countByReplayHash(sha256);
    }

    /**
     * 纯内存 eligibility（写文件前的 preflight）：不支持战斗模式（含训练房/联赛/未知）/
     * 无录像者 → SKIPPED，其余返回 SAVED（仅表示 eligible，不代表入库结果）。
     */
    public RecordOutcome eligibility(final Battle battle) {
        if (battle == null || battle.arenaId == null) return RecordOutcome.SKIPPED_UNKNOWN_RECORDER;
        if (!HallOfFameBattleTypePolicy.isSupported(battle.arenaBonusType)) {
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
     * 录像者单场成绩入库状态机（含 replay metadata + battle_type/arena_bonus_type），DB 原子：
     * 新建 → SAVED（unique race 后 re-read winner 分类）；
     * 已存在且 replay_hash NULL → 原子 conditional UPDATE（唯一 winner）→ ATTACHED，败者 re-read 分类；
     * 已存在且同 hash → IDEMPOTENT；已存在且异 hash → SKIPPED_HASH_CONFLICT（绝不覆盖）。
     */
    public RecordOutcome recordRecorder(final Battle battle, final Tankopedia tankopedia,
                                        final ReplayFileMeta meta) {
        if (battle == null || battle.arenaId == null) return RecordOutcome.SKIPPED_UNKNOWN_RECORDER;
        final HallOfFameBattleType battleType =
                HallOfFameBattleTypePolicy.resolve(battle.arenaBonusType).orElse(null);
        if (battleType == null) {
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

        final HallOfFameRecord record = new HallOfFameRecord();
        record.setArenaId(battle.arenaId);
        record.setAccountId(recorder.accountId);
        record.setNickname(recorder.nickname);
        record.setTankId(recorder.tankId);
        record.setTankName(tankopedia.info(recorder.tankId).name());
        record.setBattleType(battleType.name());
        record.setArenaBonusType(battle.arenaBonusType);
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
        final HallOfFameRecord winner = repository
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

    private static void applyReplayMeta(final HallOfFameRecord record, final ReplayFileMeta meta) {
        if (meta == null) {
            return;
        }
        record.setReplayHash(meta.sha256());
        record.setReplayFileName(meta.originalName());
        record.setReplaySize(meta.size());
        record.setReplayUploadedBy(meta.uploadedBy());
    }

    /** 向后兼容的公开查询入口（无车辆分类条件）。 */
    public HallOfFamePageDto search(final String battleType, final Long tankId, final String nickname,
                                    final int page, final int size) {
        return search(battleType, tankId, null, null, null, nickname, page, size);
    }

    /**
     * 统一公开查询：battleType ×（nation ∩ vehicleType ∩ tier ∩ tankId）× nickname × 分页。
     * 国家/车种/等级均可独立生效；排序 deterministic，rank 基于完整交集上下文。
     */
    @Transactional(readOnly = true)
    public HallOfFamePageDto search(final String battleType,
                                    final Long tankId,
                                    final String nation,
                                    final String vehicleType,
                                    final Integer tier,
                                    final String nickname,
                                    final int page,
                                    final int size) {
        final String normalizedType = normalizeBattleTypeFilter(battleType);
        // 昵称模糊匹配：服务端预计算小写 pattern（含 %），避免 JPQL lower(concat(...)) 的 PG 类型推断问题
        final String nicknamePattern = StringUtils.hasText(nickname)
                ? "%" + nickname.trim().toLowerCase() + "%" : null;
        final Pageable pageable = PageRequest.of(page - 1, clamp(size));
        final Page<HallOfFameRecord> records;
        if (hasVehicleCategoryFilter(nation, vehicleType, tier)) {
            final List<Long> vehicleIds = matchingVehicleIds(nation, vehicleType, tier);
            records = vehicleIds.isEmpty()
                    ? Page.empty(pageable)
                    : repository.searchByVehicleIds(
                            normalizedType, tankId, vehicleIds, nicknamePattern, pageable);
        } else {
            records = repository.search(normalizedType, tankId, nicknamePattern, pageable);
        }
        return mapper.toPageDtoWithRank(records, page, size);
    }

    /** 当前名人堂实际存在的车辆选项，车辆属性统一为 API 稳定英文码。 */
    @Transactional(readOnly = true)
    public List<HofVehicleOptionDto> vehicleOptions() {
        return repository.findVehicleOptions().stream()
                .map(this::toVehicleOption)
                .toList();
    }

    /** 按任意非空国家/车种/等级条件取交集，只返回当前名人堂实际存在的车辆 ID。 */
    @Transactional(readOnly = true)
    public List<Long> matchingVehicleIds(final String nation,
                                         final String vehicleType,
                                         final Integer tier) {
        final String normalizedNation = normalizeVehicleCode(nation);
        final String normalizedType = normalizeVehicleCode(vehicleType);
        return vehicleOptions().stream()
                .filter(vehicle -> normalizedNation == null || normalizedNation.equals(vehicle.nation()))
                .filter(vehicle -> normalizedType == null || normalizedType.equals(vehicle.type()))
                .filter(vehicle -> tier == null || tier.equals(vehicle.tier()))
                .map(HofVehicleOptionDto::tankId)
                .toList();
    }

    private HofVehicleOptionDto toVehicleOption(final HofVehicleProjection row) {
        final TankInfo info = tankopedia.info(row.getTankId());
        final String name = info.name().startsWith("#") && StringUtils.hasText(row.getTankName())
                ? row.getTankName() : info.name();
        final Integer tier = info.tier() instanceof Number value ? value.intValue() : null;
        return new HofVehicleOptionDto(row.getTankId(), name,
                VehicleCodes.nationCode(info.nation()), VehicleCodes.classCode(info.type()), tier);
    }

    private static boolean hasVehicleCategoryFilter(final String nation,
                                                    final String vehicleType,
                                                    final Integer tier) {
        return StringUtils.hasText(nation) || StringUtils.hasText(vehicleType) || tier != null;
    }

    private static String normalizeVehicleCode(final String value) {
        return StringUtils.hasText(value) ? value.trim().toUpperCase(Locale.ROOT) : null;
    }

    /** 过滤参数只接受 RANDOM / RATING（缺省 All）；其余 → 400。 */
    private static String normalizeBattleTypeFilter(final String battleType) {
        if (!StringUtils.hasText(battleType)) {
            return null;
        }
        final String upper = battleType.trim().toUpperCase();
        if (!"RANDOM".equals(upper) && !"RATING".equals(upper)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_BATTLE_TYPE_FILTER");
        }
        return upper;
    }

    /** 指定玩家的伤害记录。保持 flat 返回供个人中心使用。 */
    public List<HallOfFameRecordDto> recordsByAccountId(final long accountId, final int limit) {
        return repository.findByAccountIdOrderByDamageDealtDesc(accountId, PageRequest.of(0, clamp(limit)))
                .stream().map(mapper::toDto).toList();
    }

    private static int clamp(final int limit) {
        if (limit <= 0) return DEFAULT_LIMIT;
        return Math.min(limit, MAX_LIMIT);
    }
}
