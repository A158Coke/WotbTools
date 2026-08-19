package com.wotb.web.hof.service;

import com.wotb.web.hof.dto.HofAdminAuditPageDto;
import com.wotb.web.hof.dto.HofAdminPageDto;
import com.wotb.web.hof.entity.HallOfFameAdminLog;
import com.wotb.web.hof.entity.HallOfFameRecord;
import com.wotb.web.hof.repository.HallOfFameAdminLogRepository;
import com.wotb.web.hof.repository.HallOfFameRecordRepository;
import com.wotb.web.hof.storage.HallOfFameReplayStorage;
import com.wotb.web.hundred.service.HundredReplayEvidenceService;
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

/**
 * 名人堂管理后台（HoF-admin / wotbtools-admin）。
 * 仅治理：查看/搜索/筛选/下载/hard delete/审计。禁止人工修改 replay-derived authoritative facts。
 * delete 语义：audit + record delete 单事务；commit 后最后引用清理物理文件（best-effort，失败仅 WARN）。
 */
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
    private final HundredReplayEvidenceService hundredEvidenceService;
    private final TransactionTemplate transactionTemplate;

    public HallOfFameAdminService(final HallOfFameRecordRepository repository,
                                  final HallOfFameRecordMapper recordMapper,
                                  final HallOfFameAdminLogRepository auditRepository,
                                  final HallOfFameAdminAuditMapper auditMapper,
                                  final HallOfFameReplayStorage storage,
                                  final ReplayHashLock replayHashLock,
                                  final HundredReplayEvidenceService hundredEvidenceService,
                                  final PlatformTransactionManager transactionManager) {
        this.repository = repository;
        this.recordMapper = recordMapper;
        this.auditRepository = auditRepository;
        this.auditMapper = auditMapper;
        this.storage = storage;
        this.replayHashLock = replayHashLock;
        this.hundredEvidenceService = hundredEvidenceService;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
    }

    /**
     * 管理列表：nickname / accountId / arenaId / uploadedBy / battleType / tankId / replayAvailable 组合搜索。
     */
    public HofAdminPageDto search(final String nickname, final Long accountId, final String arenaId,
                                  final String uploadedBy, final String battleType, final Long tankId,
                                  final Boolean replayAvailable, final String sort,
                                  final int page, final int size) {
        final Pageable pageable = PageRequest.of(page - 1, clamp(size), sortOf(sort));
        // 昵称模糊匹配：服务端预计算小写 pattern（含 %），避免 JPQL lower(concat(...)) 的 PG 类型推断问题
        final String nicknamePattern = StringUtils.hasText(nickname)
                ? "%" + nickname.trim().toLowerCase() + "%" : null;
        final Page<HallOfFameRecord> records = repository.adminSearch(
                nicknamePattern, accountId, normalize(arenaId), normalize(uploadedBy),
                normalizeBattleType(battleType), tankId, replayAvailable, pageable);
        return recordMapper.toAdminPageDto(records, page, size);
    }

    /**
     * 操作审计（只读，第一版 DELETE_ENTRY）。
     */
    public HofAdminAuditPageDto audit(final int page, final int size) {
        final Pageable pageable = PageRequest.of(page - 1, clamp(size),
                Sort.by(Sort.Direction.DESC, "createdAt", "id"));
        final Page<HallOfFameAdminLog> logs = auditRepository.findAll(pageable);
        return new HofAdminAuditPageDto(
                logs.getContent().stream().map(auditMapper::toDto).toList(),
                page, size, logs.getTotalElements(), logs.getTotalPages());
    }

    /**
     * Hard delete（真实删除，无 tombstone / blocklist）。
     * <pre>
     * BEGIN
     *   lock / validate target record
     *   create audit snapshot (DELETE_ENTRY)
     *   delete hall_of_fame_record
     * COMMIT
     * </pre>
     * audit 失败 → 记录不删除；记录删除失败 → 不留下假 DELETE audit。
     * commit 后：replay_hash 非空且无其他引用 → 删除 {sha256}.wotbreplay；
     * 清理失败 → 仅 WARN（orphan 保留，不制造 DB 脏状态，不回滚已 commit 的删除）。
     * 同一 hash 删除/上传并发由 {@link ReplayHashLock} 串行化，保证
     * 「DB 引用 H ⇒ 物理 H 文件存在」不变量。
     */
    public void deleteEntry(final long id) {
        final String adminSub = JwtUtil.requireUserId();
        final String adminUsername = JwtUtil.currentUsername();
        // 预读 hash 用于 advisory lock key（权威读取/删除在事务内）。
        final String hash = repository.findById(id)
                .map(HallOfFameRecord::getReplayHash).orElse(null);
        if (hash == null) {
            // 记录不存在（→404）或该记录无 replay 文件：无需锁与文件清理。
            deleteInTransaction(id, adminSub, adminUsername);
            return;
        }
        replayHashLock.runWithLock(hash, () -> {
            final DeletedEntry deleted = deleteInTransaction(id, adminSub, adminUsername);
            cleanupReplayFile(deleted);
        });
    }

    /**
     * 单事务（TransactionTemplate，避免 @Transactional 自调用被代理绕过）：
     * BEGIN → validate record → audit snapshot(DELETE_ENTRY) → delete record → flush → COMMIT。
     * audit 失败 → 记录不删除；record 删除失败 → 不留下假 DELETE audit（同事务回滚）。
     */
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

    /**
     * commit 后文件清理：<b>跨域引用计数</b>（hall_of_fame_record + hundred_battle_replay_evidence
     * 均无引用）才删除物理文件。TOTAL REFERENCES 由 {@code HundredReplayEvidenceService.countReferences}
     * 统一提供（一次且仅一次 = HoF refs + Hundred refs）——防止重复计算 HoF refs，也防止删除
     * 最后一个 HoF record 后误删仍被 Hundred evidence 引用的文件（Hundred admin download 404）。
     * 失败仅 WARN，orphan 保留。
     */
    private void cleanupReplayFile(final DeletedEntry deleted) {
        if (deleted.replayHash() == null) {
            return;
        }
        final long refs = hundredEvidenceService.countReferences(deleted.replayHash());
        if (refs > 0) {
            log.info("HoF admin delete: replay {} still referenced by {} total reference(s), file retained",
                    deleted.replayHash(), refs);
            return;
        }
        try {
            storage.delete(deleted.replayHash());
            log.info("HoF admin delete: replay file {} removed (last reference)", deleted.replayHash());
        } catch (final RuntimeException e) {
            // DB delete 已 commit 且 authoritative；物理清理失败仅 WARN，orphan 保留。
            log.warn("HoF admin delete: replay file {} cleanup failed, orphan retained: {}",
                    deleted.replayHash(), e.getMessage());
        }
    }

    /**
     * 删除记录快照：audit 使用 + commit 后文件清理使用（原记录已删除）。
     */
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