package com.wotb.web.hundred.service;

import com.wotb.web.hof.dto.ReplayDownload;
import com.wotb.web.hof.service.HallOfFameService;
import com.wotb.web.hof.service.ReplayHashLock;
import com.wotb.web.hof.storage.HallOfFameReplayStorage;
import com.wotb.web.hundred.dto.HundredReplayEvidenceDto;
import com.wotb.web.hundred.entity.HundredBattleReplayEvidence;
import com.wotb.web.hundred.repository.HundredBattleReplayEvidenceRepository;
import com.wotb.web.hundred.repository.HundredBattleSubmissionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * 名人堂「百场」回放审核证据编排：原始 {@code .wotbreplay} 的内容寻址持久化、生命周期清理与 admin 访问。
 *
 * <p>物理文件复用 {@link HallOfFameReplayStorage}（{wotb.hof.replay-dir}/{sha256}.wotbreplay，
 * 内容寻址幂等、原子发布、磁盘 reserve、路径防穿越）；本服务只维护 {@code hundred_battle_replay_evidence}
 * 元数据行与文件清理编排。与 HoF 单场回放共享存储目录，因此物理文件删除必须<b>跨表引用计数</b>：
 * hall_of_fame_record 与 hundred_battle_replay_evidence 均无引用时才删，保持
 * 「DB 引用 H ⇒ 物理 H 存在」不变量。</p>
 *
 * <p>生命周期：创建时 {@link #storeAll} 落盘 → 单事务 {@link #attach} 写 5 行；
 * 终态（APPROVE/REJECT/CANCEL）由 {@link #discardForSubmission} 同事务删行并在 commit 后
 * best-effort 清理物理文件（失败仅 WARN，orphan 保留，与 HoF admin delete 同语义）。</p>
 */
@Service
public class HundredReplayEvidenceService {

    private static final Logger log = LoggerFactory.getLogger(HundredReplayEvidenceService.class);

    private final HallOfFameReplayStorage storage;
    private final HundredBattleReplayEvidenceRepository repository;
    private final HundredBattleSubmissionRepository submissionRepository;
    private final HundredBattleMapper mapper;
    private final HallOfFameService hallOfFameService;
    private final ReplayHashLock replayHashLock;

    public HundredReplayEvidenceService(final HallOfFameReplayStorage storage,
                                        final HundredBattleReplayEvidenceRepository repository,
                                        final HundredBattleSubmissionRepository submissionRepository,
                                        final HundredBattleMapper mapper,
                                        final HallOfFameService hallOfFameService,
                                        final ReplayHashLock replayHashLock) {
        this.storage = storage;
        this.repository = repository;
        this.submissionRepository = submissionRepository;
        this.mapper = mapper;
        this.hallOfFameService = hallOfFameService;
        this.replayHashLock = replayHashLock;
    }

    /** 待持久化的单个回放（createSubmission 解析阶段收集；bytes 为原始回放字节，内容寻址原样落盘）。 */
    public record PendingReplay(int slot, String originalFilename, String sha256, long fileSize,
                                String arenaId, byte[] data) {
    }

    /**
     * 落盘一批回放（内容寻址幂等：同 hash 已存在直接复用）。任一文件存储失败 →
     * best-effort 清理已存文件（引用计数保护，含 HoF 共享引用）+ 抛出
     * {@code HallOfFameStorageException}（全局 handler 映射 REPLAY_STORAGE_FULL / REPLAY_STORAGE_ERROR）。
     * 调用方必须保证：DB 尚未写入任何引用（失败清理不会误删他人文件）。
     * <b>锁契约</b>：生产路径由 {@code HundredBattleSubmissionService.createSubmission} 的外层
     * {@code runWithLocksResult} 持有全部 hash 锁；失败清理复用该外层锁（不嵌套取锁，防 self-deadlock）。
     */
    public void storeAll(final List<PendingReplay> replays) {
        final List<String> stored = new ArrayList<>();
        try {
            for (final PendingReplay r : replays) {
                storage.store(r.data(), r.sha256());
                stored.add(r.sha256());
            }
        } catch (final RuntimeException e) {
            cleanupFilesUnlocked(stored);
            throw e;
        }
    }

    /**
     * 单事务内插入 5 行 evidence（与 submission 创建同事务，原子；partial insert 不可能存在）。
     */
    @Transactional
    public void attach(final long submissionId, final List<PendingReplay> replays) {
        for (final PendingReplay r : replays) {
            final HundredBattleReplayEvidence row = new HundredBattleReplayEvidence();
            row.setSubmissionId(submissionId);
            row.setSlot(r.slot());
            row.setOriginalFilename(r.originalFilename());
            row.setSha256(r.sha256());
            row.setFileSize(r.fileSize());
            row.setArenaId(r.arenaId());
            repository.save(row);
        }
        repository.flush();
    }

    /**
     * 终态迁移（APPROVE/REJECT/CANCEL）同事务调用：删除该 submission 全部 evidence 行，
     * 并在事务 commit 后 best-effort 清理物理文件（跨表引用计数，失败仅 WARN 保留 orphan；
     * 文件删除失败<b>不</b>回滚已完成的业务状态迁移）。
     * {@code @Transactional}：被 approve/reject/cancel 的事务内调用时加入其事务（删除随业务
     * 状态原子回滚）；独立调用（如集成测试）时自建事务，派生 delete 不抛 TransactionRequiredException。
     */
    @Transactional
    public void discardForSubmission(final long submissionId) {
        final List<String> hashes = repository.findBySubmissionId(submissionId).stream()
                .map(HundredBattleReplayEvidence::getSha256)
                .distinct()
                .toList();
        if (hashes.isEmpty()) {
            return;
        }
        repository.deleteBySubmissionId(submissionId);
        scheduleAfterCommit(() -> cleanupFilesLocked(hashes));
    }

    /**
     * 创建失败路径（文件已落盘但 DB 事务失败/回滚后）：best-effort 清理已存文件。
     * <b>必须在外层 advisory lock 内调用</b>（{@code createSubmission} 的 runWithLocksResult 临界区内、
     * DB rollback 完成后）——引用计数保护 + 不嵌套取锁。
     */
    public void cleanupStoredFiles(final List<String> sha256s) {
        cleanupFilesUnlocked(sha256s);
    }

    /** 管理后台 evidence 列表（admin-only；旧 PENDING 无 evidence → 空列表，不 500）。 */
    @Transactional(readOnly = true)
    public List<HundredReplayEvidenceDto> adminListEvidence(final long submissionId) {
        requireSubmission(submissionId);
        return repository.findBySubmissionIdOrderBySlotAsc(submissionId).stream()
                .map(mapper::toReplayEvidenceDto)
                .toList();
    }

    /**
     * 管理后台下载单个回放（admin-only）：replayId 必须属于 submissionId（ownership 校验）；
     * 无 hash / 物理文件缺失 → 明确 404。返回原始字节（内容寻址 = 用户原样字节）+
     * 服务端清洗后的原始文件名（仅进 Content-Disposition，绝不参与路径）。
     */
    @Transactional(readOnly = true)
    public ReplayDownload downloadEvidence(final long submissionId, final long replayId) {
        requireSubmission(submissionId);
        final HundredBattleReplayEvidence row = repository.findBySubmissionIdAndId(submissionId, replayId)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "HUNDRED_REPLAY_EVIDENCE_NOT_FOUND"));
        final Path file = storage.load(row.getSha256())
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "HUNDRED_REPLAY_FILE_NOT_FOUND"));
        try {
            return new ReplayDownload(Files.readAllBytes(file), row.getOriginalFilename());
        } catch (final IOException e) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "HUNDRED_REPLAY_FILE_NOT_FOUND");
        }
    }

    // ── 辅助 ──────────────────────────────────────────────────────────────

    private void requireSubmission(final long submissionId) {
        if (!submissionRepository.existsById(submissionId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "HUNDRED_SUBMISSION_NOT_FOUND");
        }
    }

    /**
     * 跨域引用计数（HoF admin delete 复用）：hall_of_fame_record + 本表均引用数之和。
     * 所有删除共享 replay storage 物理文件的路径都必须以此 TOTAL REFERENCES 为准——
     * 只有总和为 0 才允许 storage.delete(hash)，保证「DB 引用 H ⇒ 物理 H 存在」双向一致。
     */
    public long countReferences(final String sha256) {
        return repository.countBySha256(sha256) + hallOfFameService.countReplayHashReferences(sha256);
    }

    /**
     * 每个 hash 在 {@link ReplayHashLock}（PostgreSQL advisory lock）内清理。
     * 用于终态（APPROVE/REJECT/CANCEL）commit 后路径——此时无外层锁，必须逐 hash 取锁，
     * 与 HoF 上传/删除串行化，防止「检查后、删除前」并发引用该文件破坏不变量。
     */
    private void cleanupFilesLocked(final List<String> sha256s) {
        for (final String hash : sha256s) {
            replayHashLock.runWithLock(hash, () -> cleanupSingle(hash));
        }
    }

    /**
     * 不取锁的清理（调用方必须已持有对应 hash 的 advisory lock）。
     * 用于 createSubmission 失败路径——其整个 store + DB 事务都在外层
     * {@code runWithLocksResult(hashes)} 内，外层锁已覆盖本表与 HoF 的并发删除/引用。
     * 嵌套再取同 hash 锁会在另一连接上 self-deadlock（session 级锁不可跨连接重入）。
     */
    private void cleanupFilesUnlocked(final List<String> sha256s) {
        for (final String hash : sha256s) {
            cleanupSingle(hash);
        }
    }

    private void cleanupSingle(final String hash) {
        if (repository.countBySha256(hash) > 0) {
            return;
        }
        if (hallOfFameService.countReplayHashReferences(hash) > 0) {
            return;
        }
        try {
            storage.delete(hash);
            log.info("hundred evidence: replay file {} removed (no remaining reference)", hash);
        } catch (final RuntimeException e) {
            // DB 状态已提交；物理清理失败仅 WARN，orphan 保留供未来维护。
            log.warn("hundred evidence: replay file {} cleanup failed, orphan retained: {}",
                    hash, e.getMessage());
        }
    }

    /** 事务 commit 后执行（终态文件清理）；无活动事务时立即执行（防御，如单元测试）。 */
    private static void scheduleAfterCommit(final Runnable action) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    action.run();
                }
            });
        } else {
            action.run();
        }
    }
}
