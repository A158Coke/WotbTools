package com.wotb.core.processing;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.Source;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.util.PlayerResultFormat;
import com.wotb.core.replay.reconstruction.BattleParticipant;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.ReplayReconstructionContext;
import com.wotb.core.replay.reconstruction.ReplayReconstructionService;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
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

    public DefaultReplayProcessingFacade(final ReplayReconstructionService reconstructionService) {
        this.reconstructionService = reconstructionService;
    }

    @Override
    public ReplayProcessingResult process(final Source input, final ReplayProcessingOptions options) {
        final ReplayFileValidationResult validation = validateFile(input);
        if (!validation.valid()) {
            final String msg = validation.errors().isEmpty() ? "Validation failed"
                    : validation.errors().getFirst().code() + ": " + validation.errors().getFirst().message();
            return new ReplayProcessingResult(
                    input.name(), ReplayProcessingStatus.FAILED,
                    null, null, null, null,
                    ReplayProcessingCapabilities.NONE,
                    ReplayProcessingError.of("FILE_VALIDATION_FAILED", msg),
                    null);
        }
        return processSingle(input, options);
    }

    @Override
    public ReplayBatchProcessingResult processBatch(final List<Source> inputs, final ReplayProcessingOptions options) {
        final List<ReplayProcessingResult> results = new ArrayList<>();
        final Set<String> seenContentHashes = new HashSet<>();
        final List<String> duplicateNames = new ArrayList<>();

        for (final Source input : inputs) {
            try {
                // 0. 逐文件基础验证
                final ReplayFileValidationResult validation = validateFile(input);
                if (!validation.valid()) {
                    results.add(fileValidationFailed(input.name(), validation.errors()));
                    continue;
                }

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
                            ReplayProcessingCapabilities.NONE,
                            ReplayProcessingError.of("DUPLICATE_FILE",
                                    "Duplicate file: " + input.name()),
                            null));
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
        final ReplayBatchSummary summary = buildSummary(inputs.size(), results, duplicateNames);
        final ReplayAnalysisMode mode = resolveMode(results);

        return new ReplayBatchProcessingResult(
                mode, inputs.size(), summary.totalSuccessful(), summary.totalPartial(), summary.totalFailed(),
                List.copyOf(results), summary);
    }

    /**
     * 处理单个文件。
     */
    private ReplayProcessingResult processSingle(final Source input, final ReplayProcessingOptions options) {
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
                // 战绩解析失败是致命错误（无权威数据），直接返回 FAILED
                return new ReplayProcessingResult(
                        input.name(), ReplayProcessingStatus.FAILED,
                        new ReplayIdentity(contentHash, null, null, null, null, null),
                        null, null,
                        ReplayProcessingDiagnostics.summaryOnly(false),
                        ReplayProcessingCapabilities.NONE,
                        ReplayProcessingError.of("SUMMARY_PARSE_FAILED", e.getMessage()),
                        null);
            }
        }

        // 2. 完整重建（失败不吞：保留 reconstructionError，AI 仍可基于战绩分析）
        ReplayReconstruction reconstruction = null;
        boolean streamOk = false;
        boolean reconOk = false;
        boolean recorderEntityMapped = false;
        ReplayProcessingError reconstructionError = null;
        if (options.reconstructTimeline()) {
            try {
                final ReplayReconstructionContext ctx = buildContext(battle);
                reconstruction = reconstructionService.reconstruct(data, ctx);
                streamOk = true;
                reconOk = true;
                recorderEntityMapped = isRecorderEntityMapped(reconstruction);
            } catch (IllegalArgumentException e) {
                // 时长超限等
                reconstructionError = ReplayProcessingError.of(
                        "RECONSTRUCTION_LIMIT", e.getMessage());
            } catch (Exception e) {
                reconstructionError = ReplayProcessingError.of(
                        "RECONSTRUCTION_FAILED", e.getMessage());
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

        final boolean playerFs = reconOk && recorderEntityMapped;
        final boolean recorderResultAvailable = battle != null && battle.recorderResult() != null;
        // scope 默认 PLAYER_FOCUSED，后续由 BattleCategory 细化
        final ReplayAnalysisScope scope = ReplayAnalysisScope.PLAYER_FOCUSED;
        final boolean perspectiveTeamResolved = false; // TODO: 由 BattleCategory 驱动
        final boolean teamFs = false;
        final ReplayProcessingCapabilities capabilities = ReplayProcessingCapabilities.of(
                summaryOk, recorderResultAvailable, reconOk,
                recorderEntityMapped, perspectiveTeamResolved,
                playerFs, teamFs, scope);

        return new ReplayProcessingResult(
                input.name(), status, identity,
                battle, reconstruction, diagnostics,
                capabilities, null, reconstructionError);
    }

    /**
     * 由外部逐文件处理后汇总批量结果（用于流式处理减少内存峰值）。
     *
     * @param totalInputs 总文件数
     * @param results     已处理的逐文件结果列表
     */
    public ReplayBatchProcessingResult buildBatchResult(
            final int totalInputs, final List<ReplayProcessingResult> results) {
        final ReplayBatchSummary summary = buildSummary(totalInputs, results, List.of());
        final ReplayAnalysisMode mode = resolveMode(results);
        return new ReplayBatchProcessingResult(
                mode, totalInputs, summary.totalSuccessful(), summary.totalPartial(), summary.totalFailed(),
                List.copyOf(results), summary);
    }

    /**
     * 构建批量摘要统计。
     */
    private static ReplayBatchSummary buildSummary(
            final int totalInputs, final List<ReplayProcessingResult> results, final List<String> externalDupNames) {
        int success = 0, partial = 0, failed = 0;
        for (final ReplayProcessingResult r : results) {
            switch (r.status()) {
                case SUCCESS -> success++;
                case PARTIAL_SUCCESS -> partial++;
                case FAILED -> failed++;
            }
        }
        final List<String> dupNames = externalDupNames.isEmpty()
                ? results.stream()
                        .filter(r -> r.error() != null && "DUPLICATE_FILE".equals(r.error().code()))
                        .map(ReplayProcessingResult::fileName)
                        .toList()
                : externalDupNames;
        return new ReplayBatchSummary(
                totalInputs, success, partial, failed, dupNames.size(), dupNames);
    }

    /** 临时模式解析，后续由 BatchAnalyzer 接管。 */
    private static ReplayAnalysisMode resolveMode(final List<ReplayProcessingResult> results) {
        final long analyzable = results.stream()
                .filter(r -> r.capabilities() != null && r.capabilities().aiAnalyzable())
                .count();
        if (analyzable <= 0) return ReplayAnalysisMode.NONE;
        // 暂简化：返回默认单场模式
        return analyzable == 1 ? ReplayAnalysisMode.SINGLE_PLAYER_BATTLE : ReplayAnalysisMode.MULTI_PLAYER_BATTLE;
    }

    private static ReplayProcessingResult failedResult(final String fileName, final Exception e) {
        return new ReplayProcessingResult(
                fileName, ReplayProcessingStatus.FAILED,
                null, null, null, null,
                ReplayProcessingCapabilities.NONE,
                ReplayProcessingError.of(e),
                null);
    }

    /** 文件级基础验证：扩展名 + 非空 + 大小限制。 */
    private static ReplayFileValidationResult validateFile(final Source input) {
        final List<ReplayValidationError> errors = new ArrayList<>();
        final String name = input.name();
        if (name == null || name.isBlank()) {
            errors.add(ReplayValidationError.of(
                    "INVALID_FILE_NAME", "File name is empty"));
        } else if (!name.toLowerCase().endsWith(".wotbreplay")) {
            errors.add(ReplayValidationError.of(
                    "INVALID_FILE_EXTENSION",
                    "File must end with .wotbreplay: " + name));
        }
        final byte[] data = input.bytes();
        if (data == null || data.length == 0) {
            errors.add(ReplayValidationError.of(
                    "EMPTY_FILE", "File is empty: " + name));
        } else if (data.length > 20L * 1024 * 1024) {
            errors.add(ReplayValidationError.of(
                    "FILE_TOO_LARGE",
                    "File exceeds 20MB limit: " + name + " (" + data.length + " bytes)"));
        }
        if (errors.isEmpty()) return ReplayFileValidationResult.ok();
        return ReplayFileValidationResult.failed(errors);
    }

    private static ReplayProcessingResult fileValidationFailed(
            final String fileName, final List<ReplayValidationError> errors) {
        final String message = errors.isEmpty() ? "Validation failed"
                : errors.getFirst().code() + ": " + errors.getFirst().message();
        return new ReplayProcessingResult(
                fileName, ReplayProcessingStatus.FAILED,
                null, null, null, null,
                ReplayProcessingCapabilities.NONE,
                ReplayProcessingError.of("FILE_VALIDATION_FAILED", message),
                null);
    }

    private static ReplayReconstructionContext buildContext(final Battle battle) {
        if (battle == null || battle.players == null || battle.players.isEmpty()) {
            return ReplayReconstructionContext.empty();
        }
        final Map<Long, PlayerResult> byAccount = new HashMap<>();
        Long recorderAccountId = null;
        for (final PlayerResult pr : battle.players) {
            byAccount.put(pr.accountId, pr);
            if (battle.recorder != null && battle.recorder.equals(pr.nickname)) {
                recorderAccountId = pr.accountId;
            }
        }
        return new ReplayReconstructionContext(
                battle, byAccount, recorderAccountId, battle.recorder);
    }

    private static ReplayIdentity buildIdentity(final String contentHash, final Battle battle) {
        if (battle == null) {
            return new ReplayIdentity(contentHash, null, null, null, null, null);
        }
        return new ReplayIdentity(
                contentHash,
                battle.arenaId,
                battle.clientVersion,
                battle.mapName,
                PlayerResultFormat.recorderAccountId(battle),
                battle.startTime != null ? Instant.ofEpochSecond(battle.startTime) : null
        );
    }

    /** 基于重建 participants 判断录像者 entity 是否已映射。 */
    private static boolean isRecorderEntityMapped(final ReplayReconstruction reconstruction) {
        return reconstruction != null
                && reconstruction.participants().stream()
                        .anyMatch(BattleParticipant::recorder);
    }

    private static String sha256(final byte[] data) {
        try {
            final MessageDigest md = MessageDigest.getInstance("SHA-256");
            final byte[] hash = md.digest(data);
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 not available", e);
        }
    }
}
