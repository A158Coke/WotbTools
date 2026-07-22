package com.wotb.core.processing;

import com.wotb.core.model.Battle;
import com.wotb.core.model.Source;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.ReplayReconstructionService;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 默认回放处理门面 —— 将现有战绩解析与完整重建整合为统一结果。
 * <p>
 * 职责：
 * <ul>
 *   <li>逐文件处理，错误隔离</li>
 *   <li>保留上传顺序</li>
 *   <li>根据 options 控制是否执行重建</li>
 *   <li>计算 ReplayIdentity 用于去重</li>
 *   <li>解析 ReplayAnalysisMode</li>
 *   <li>生成 ReplayBatchProcessingResult</li>
 * </ul>
 * </p>
 */
public class DefaultReplayProcessingFacade implements ReplayProcessingService {

    private final ReplayReconstructionService reconstructionService;

    public DefaultReplayProcessingFacade() {
        this(new ReplayReconstructionService());
    }

    public DefaultReplayProcessingFacade(ReplayReconstructionService reconstructionService) {
        this.reconstructionService = reconstructionService;
    }

    @Override
    public ReplayProcessingResult process(Source input, ReplayProcessingOptions options) {
        return processSingle(input, options);
    }

    @Override
    public ReplayBatchProcessingResult processBatch(List<Source> inputs, ReplayProcessingOptions options) {
        final List<ReplayProcessingResult> results = new ArrayList<>();
        final Set<String> seenContentHashes = new LinkedHashSet<>();
        final List<String> duplicateNames = new ArrayList<>();

        for (final Source input : inputs) {
            try {
                // 1. 计算内容 hash 用于去重
                final String contentHash = sha256(input.bytes());

                // 2. 检查是否重复
                if (seenContentHashes.contains(contentHash)) {
                    duplicateNames.add(input.name());
                    results.add(new ReplayProcessingResult(
                            input.name(),
                            ReplayProcessingStatus.FAILED,
                            new ReplayIdentity(contentHash, null, null, null, null, null),
                            null, null, null,
                            ReplayProcessingError.of("DUPLICATE_FILE",
                                    "Duplicate file: " + input.name())));
                    continue;
                }
                seenContentHashes.add(contentHash);

                // 3. 处理文件
                final ReplayProcessingResult result = processSingle(input, options);
                results.add(result);

            } catch (Exception e) {
                results.add(failedResult(input.name(), e));
            }
        }

        // 统计
        int success = 0, partial = 0, failed = 0;
        for (final ReplayProcessingResult r : results) {
            switch (r.status()) {
                case SUCCESS -> success++;
                case PARTIAL_SUCCESS -> partial++;
                case FAILED -> failed++;
            }
        }
        final int analyzable = success + partial;
        final ReplayAnalysisMode mode = ReplayAnalysisMode.resolve(analyzable);
        final ReplayBatchSummary summary = new ReplayBatchSummary(
                inputs.size(), success, partial, failed,
                duplicateNames.size(), duplicateNames);

        return new ReplayBatchProcessingResult(
                mode, inputs.size(), success, partial, failed,
                List.copyOf(results), summary);
    }

    /**
     * 处理单个文件。
     */
    private ReplayProcessingResult processSingle(Source input, ReplayProcessingOptions options) {
        final String contentHash = sha256(input.bytes());
        final byte[] data = input.bytes();

        // 1. 战绩解析
        Battle battle = null;
        boolean summaryOk = false;
        if (options.parseSummary()) {
            try {
                battle = ReplayParser.parse(data);
                summaryOk = true;
            } catch (Exception e) {
                // 战绩解析失败是致命错误，直接返回 FAILED
                return new ReplayProcessingResult(
                        input.name(), ReplayProcessingStatus.FAILED,
                        new ReplayIdentity(contentHash, null, null, null, null, null),
                        null, null,
                        ReplayProcessingDiagnostics.summaryOnly(false),
                        ReplayProcessingError.of("SUMMARY_PARSE_FAILED", e.getMessage()));
            }
        }

        // 2. 完整重建
        ReplayReconstruction reconstruction = null;
        boolean streamOk = false;
        boolean reconOk = false;
        if (options.reconstructTimeline()) {
            try {
                reconstruction = reconstructionService.reconstruct(data);
                streamOk = true;
                reconOk = true;
            } catch (IllegalArgumentException e) {
                // 时长超限等 — PARTIAL_SUCCESS
                streamOk = false;
                reconOk = false;
            } catch (Exception e) {
                streamOk = false;
                reconOk = false;
            }
        }

        // 3. 构建 identity
        final ReplayIdentity identity = buildIdentity(contentHash, battle);

        // 4. 确定状态
        final boolean hasReconstruction = options.reconstructTimeline();
        final ReplayProcessingStatus status;
        final ReplayProcessingDiagnostics diagnostics;

        if (!hasReconstruction) {
            // 只需战绩
            status = summaryOk ? ReplayProcessingStatus.SUCCESS : ReplayProcessingStatus.FAILED;
            diagnostics = ReplayProcessingDiagnostics.summaryOnly(summaryOk);
        } else if (summaryOk && reconOk) {
            status = ReplayProcessingStatus.SUCCESS;
            diagnostics = new ReplayProcessingDiagnostics(true, true, true,
                    reconstruction != null ? reconstruction.diagnostics() : null);
        } else if (summaryOk && !reconOk) {
            // 战绩 OK 但重建不完整 → PARTIAL_SUCCESS
            status = ReplayProcessingStatus.PARTIAL_SUCCESS;
            diagnostics = new ReplayProcessingDiagnostics(true, streamOk, reconOk,
                    reconstruction != null ? reconstruction.diagnostics() : null);
        } else {
            status = ReplayProcessingStatus.FAILED;
            diagnostics = ReplayProcessingDiagnostics.empty();
        }

        return new ReplayProcessingResult(
                input.name(), status, identity,
                battle, reconstruction, diagnostics, null);
    }

    private ReplayProcessingResult failedResult(String fileName, Exception e) {
        return new ReplayProcessingResult(
                fileName, ReplayProcessingStatus.FAILED,
                null, null, null, null,
                ReplayProcessingError.of(e));
    }

    private static ReplayIdentity buildIdentity(String contentHash, Battle battle) {
        if (battle == null) {
            return new ReplayIdentity(contentHash, null, null, null, null, null);
        }
        return new ReplayIdentity(
                contentHash,
                battle.arenaId,
                battle.clientVersion,
                battle.mapName,
                null, // recorder accountId not available from Battle currently
                battle.startTime != null ? Instant.ofEpochSecond(battle.startTime) : null
        );
    }

    private static String sha256(byte[] data) {
        try {
            final MessageDigest md = MessageDigest.getInstance("SHA-256");
            final byte[] hash = md.digest(data);
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 not available", e);
        }
    }
}
