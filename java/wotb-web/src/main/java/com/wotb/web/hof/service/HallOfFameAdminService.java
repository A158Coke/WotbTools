package com.wotb.web.hof.service;

import com.wotb.web.hof.dto.BulkDeleteItemResult;
import com.wotb.web.hof.dto.BulkDeleteResultDto;
import com.wotb.web.hof.dto.HofAdminAuditPageDto;
import com.wotb.web.hof.dto.HofAdminPageDto;
import com.wotb.web.hof.entity.HallOfFameAdminLog;
import com.wotb.web.hof.entity.HallOfFameRecord;
import com.wotb.web.hof.repository.HallOfFameAdminLogRepository;
import com.wotb.web.hof.repository.HallOfFameRecordRepository;
import com.wotb.web.replayfile.HallOfFameReplayStorage;
import com.wotb.web.replayfile.HundredReplayReferenceCounter;
import com.wotb.web.replayfile.ReplayHashLock;
import com.wotb.web.util.JwtUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.List;

@Service
public class HallOfFameAdminService {

    private static final Logger log = LoggerFactory.getLogger(HallOfFameAdminService.class);
    private static final int MAX_LIMIT = 100;
    private static final int DEFAULT_LIMIT = 50;

    private final HallOfFameRecordRepository repository;
    private final HallOfFameRecordMapper recordMapper;
    private final HallOfFameAdminLogRepository auditRepository;
    private final HallOfFameAdminAuditMapper auditMapper;
    private final HallOfFameReplayStorage storage;
    private final ReplayHashLock replayHashLock;
    private final HallOfFameService hallOfFameService;
    private final HundredReplayReferenceCounter hundredReplayReferenceCounter;
    private final TransactionTemplate transactionTemplate;

    public HallOfFameAdminService(final HallOfFameRecordRepository repository,
                                  final HallOfFameRecordMapper recordMapper,
                                  final HallOfFameAdminLogRepository auditRepository,
                                  final HallOfFameAdminAuditMapper auditMapper,
                                  final HallOfFameReplayStorage storage,
                                  final ReplayHashLock replayHashLock,
                                  final HallOfFameService hallOfFameService,
                                  final HundredReplayReferenceCounter hundredReplayReferenceCounter,
                                  final PlatformTransactionManager transactionManager) {
        this.repository = repository;
        this.recordMapper = recordMapper;
        this.auditRepository = auditRepository;
        this.auditMapper = auditMapper;
        this.storage = storage;
        this.replayHashLock = replayHashLock;
        this.hallOfFameService = hallOfFameService;
        this.hundredReplayReferenceCounter = hundredReplayReferenceCounter;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
    }

    public HofAdminPageDto search(final String nickname, final Long accountId,
                                  final String uploadedBy, final String battleType, final Long tankId,
                                  final Boolean replayAvailable, final String sort,
                                  final int page, final int size) {
        return search(nickname, accountId, uploadedBy, battleType, tankId,
                null, null, null, replayAvailable, sort, page, size);
    }

    public HofAdminPageDto search(final String nickname,
                                  final Long accountId,
                                  final String uploadedBy,
                                  final String battleType,
                                  final Long tankId,
                                  final String nation,
                                  final String vehicleType,
                                  final Integer tier,
                                  final Boolean replayAvailable,
                                  final String sort,
                                  final int page,
                                  final int size) {
        final Pageable pageable = PageRequest.of(page - 1, clamp(size), sortOf(sort));
        final String nicknamePattern = StringUtils.hasText(nickname)
                ? "%" + nickname.trim().toLowerCase() + "%" : null;
        final Page<HallOfFameRecord> records;
        if (StringUtils.hasText(nation) || StringUtils.hasText(vehicleType) || tier != null) {
            final List<Long> vehicleIds = hallOfFameService.matchingVehicleIds(nation, vehicleType, tier);
            records = vehicleIds.isEmpty()
                    ? Page.empty(pageable)
                    : repository.adminSearchByVehicleIds(
                            nicknamePattern, accountId, normalize(uploadedBy), normalizeBattleType(battleType),
                            tankId, vehicleIds, replayAvailable, pageable);
        } else {
            records = repository.adminSearch(
                    nicknamePattern, accountId, normalize(uploadedBy),
                    normalizeBattleType(battleType), tankId, replayAvailable, pageable);
        }
        return recordMapper.toAdminPageDto(records, page, size);
    }

    public HofAdminAuditPageDto audit(final int page, final int size) {
        final Pageable pageable = PageRequest.of(page - 1, clamp(size),
                Sort.by(Sort.Direction.DESC, "createdAt", "id"));
        final Page<HallOfFameAdminLog> logs = auditRepository.findAll(pageable);
        return new HofAdminAuditPageDto(
                logs.getContent().stream().map(auditMapper::toDto).toList(),
                page, size, logs.getTotalElements(), logs.getTotalPages());
    }

    public void deleteEntry(final long id) {
        deleteEntryInternal(id, JwtUtil.requireUserId(), JwtUtil.currentUsername());
    }

    /**
     * 批量 hard delete：逐条复用单条删除语义——每个目标一个独立事务，加锁与 commit 后文件清理
     * 与单条完全一致，允许 partial success（单条失败不回滚其他记录已完成的删除）。
     *
     * @param ids 已由请求 DTO 去重并校验过上限的目标 ID
     */
    public BulkDeleteResultDto bulkDelete(final List<Long> ids) {
        final String adminSub = JwtUtil.requireUserId();
        final String adminUsername = JwtUtil.currentUsername();
        final List<BulkDeleteItemResult> results = new ArrayList<>(ids.size());
        int deleted = 0;
        for (final long id : ids) {
            try {
                deleteEntryInternal(id, adminSub, adminUsername);
                results.add(new BulkDeleteItemResult(id, true, null));
                deleted++;
            } catch (final ResponseStatusException e) {
                results.add(new BulkDeleteItemResult(id, false, e.getReason()));
            }
        }
        return new BulkDeleteResultDto(ids.size(), deleted, ids.size() - deleted, results);
    }

    private void deleteEntryInternal(final long id, final String adminSub, final String adminUsername) {
        final String hash = repository.findById(id)
                .map(HallOfFameRecord::getReplayHash).orElse(null);
        if (hash == null) {
            deleteInTransaction(id, adminSub, adminUsername);
            return;
        }
        replayHashLock.runWithLock(hash, () -> {
            final DeletedEntry deleted = deleteInTransaction(id, adminSub, adminUsername);
            cleanupReplayFile(deleted);
        });
    }

    private DeletedEntry deleteInTransaction(final long id, final String adminSub,
                                             final String adminUsername) {
        return transactionTemplate.execute(status -> {
            final HallOfFameRecord record = repository.findById(id)
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "HOF_ENTRY_NOT_FOUND"));
            final DeletedEntry deleted = DeletedEntry.from(record);
            auditRepository.save(HallOfFameAdminLog.deleteEntry(record, adminSub, adminUsername));
            repository.delete(record);
            repository.flush();
            return deleted;
        });
    }

    private void cleanupReplayFile(final DeletedEntry deleted) {
        if (deleted.replayHash() == null) {
            return;
        }
        final long refs = repository.countByReplayHash(deleted.replayHash())
                + hundredReplayReferenceCounter.countHundredReferences(deleted.replayHash());
        if (refs > 0) {
            log.info("HoF admin delete: replay {} still referenced by {} total reference(s), file retained",
                    deleted.replayHash(), refs);
            return;
        }
        try {
            storage.delete(deleted.replayHash());
            log.info("HoF admin delete: replay file {} removed (last reference)", deleted.replayHash());
        } catch (final RuntimeException e) {
            log.warn("HoF admin delete: replay file {} cleanup failed, orphan retained: {}",
                    deleted.replayHash(), e.getMessage());
        }
    }

    record DeletedEntry(long id, String arenaId, long accountId, String nickname, long tankId,
                        String tankName, String battleType, int arenaBonusType, int damageDealt,
                        String replayHash) {
        static DeletedEntry from(final HallOfFameRecord r) {
            return new DeletedEntry(r.getId(), r.getArenaId(), r.getAccountId(), r.getNickname(),
                    r.getTankId(), r.getTankName(), r.getBattleType(), r.getArenaBonusType(),
                    r.getDamageDealt(), r.getReplayHash());
        }
    }

    private static Sort sortOf(final String sort) {
        if (!StringUtils.hasText(sort)) {
            return Sort.by(Sort.Direction.DESC, "damageDealt", "id");
        }
        return switch (sort.trim().toLowerCase()) {
            case "battle_time" -> Sort.by(Sort.Direction.DESC, "battleTime", "id");
            case "upload_time" -> Sort.by(Sort.Direction.DESC, "createdAt", "id");
            default -> Sort.by(Sort.Direction.DESC, "damageDealt", "id");
        };
    }

    private static String normalizeBattleType(final String battleType) {
        if (!StringUtils.hasText(battleType)) {
            return null;
        }
        final String upper = battleType.trim().toUpperCase();
        if (!"RANDOM".equals(upper) && !"RATING".equals(upper)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_BATTLE_TYPE_FILTER");
        }
        return upper;
    }

    private static String normalize(final String value) {
        return StringUtils.hasText(value) ? value.trim() : null;
    }

    private static int clamp(final int limit) {
        if (limit <= 0) return DEFAULT_LIMIT;
        return Math.min(limit, MAX_LIMIT);
    }
}
