package com.wotb.core.replay.processing;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.Source;
import com.wotb.core.parse.ParsedReplay;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.evidence.ObservedMaxHp;
import com.wotb.core.replay.reconstruction.BattleParticipant;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.ReplayReconstructionContext;
import com.wotb.core.replay.reconstruction.ReplayReconstructionService;
import com.wotb.core.util.PlayerResultFormat;
import org.springframework.util.StringUtils;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;

/**
 * 默认回放处理门面 —— 将现有战绩解析与完整重建整合为统一结果。
 * <p>
 * 职责：
 * <ul>
 *   <li>逐文件处理，错误隔离</li>
 *   <li>保留上传顺序</li>
 *   <li>根据 options 控制是否执行重建</li>
 *   <li>计算 ReplayIdentity 用于去重</li>
 * </ul>
 * </p>
 */
public class DefaultReplayProcessingFacade {

    private final ReplayReconstructionService reconstructionService;

    public DefaultReplayProcessingFacade() {
        this(new ReplayReconstructionService());
    }

    public DefaultReplayProcessingFacade(final ReplayReconstructionService reconstructionService) {
        this.reconstructionService = reconstructionService;
    }

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

    /**
     * 处理单个文件。
     */
    private ReplayProcessingResult processSingle(final Source input, final ReplayProcessingOptions options) {
        final String contentHash = sha256(input.bytes());
        final byte[] data = input.bytes();

        // PR162/P0-2: 归档解压 + settlement + header 版本只解析一次，供战绩解析与重建共享。
        final ParsedReplay parsed;
        try {
            parsed = ParsedReplay.read(data);
        } catch (Exception e) {
            return new ReplayProcessingResult(
                    input.name(), ReplayProcessingStatus.FAILED,
                    new ReplayIdentity(contentHash, null, null, null, null, null),
                    null, null,
                    ReplayProcessingDiagnostics.summaryOnly(false),
                    ReplayProcessingCapabilities.NONE,
                    ReplayProcessingError.of("ARCHIVE_PARSE_FAILED", e.getMessage()),
                    null);
        }

        // 1. 战绩解析
        Battle battle = null;
        boolean summaryOk = false;
        if (options.parseSummary()) {
            try {
                battle = ReplayParser.parse(parsed);
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
        boolean recorderParticipantResolved = false;
        boolean recorderEntityMapped = false;
        ReplayProcessingError reconstructionError = null;
        if (options.reconstructTimeline()) {
            try {
                final ReplayReconstructionContext ctx = buildContext(battle);
                reconstruction = reconstructionService.reconstruct(parsed, ctx);
                streamOk = true;
                reconOk = true;
                recorderParticipantResolved = isRecorderParticipantResolved(reconstruction);
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

        final boolean recorderResultAvailable = battle != null && battle.recorderResult() != null;
        final TeamPerspectiveResolution teamResolution =
                TeamPerspectiveResolver.resolve(battle, reconstruction);
        final boolean perspectiveTeamResolved = teamResolution.resolved();
        final TeamEntityMapping teamEntityMapping = TeamEntityMapper.resolve(battle, reconstruction);
        // 回放实测血量（含装备/物资加成）回填到 players.observedMaxHp，供 AI 事实与地图鸟瞰使用
        ObservedMaxHp.populate(battle,
                reconstruction != null ? reconstruction.events() : null, teamEntityMapping);
        // 死亡时刻校准（§B1/B2）：结算缺失死亡时刻（deathTimeMillis==0）且非存活时，
        // 用重建事件流的权威 HP 死亡证据（EXACT alive=false）填补 survivalTimeSec；
        // 无证据 → UNKNOWN=0。legacy 启发式（damage-threshold 等）已不再是死亡 authority。
        // 身份复用上面 TeamEntityMapper.resolve 产出的权威 mapping（冲突/低置信实体证据被拒绝）。
        DeathTimeReconciler.reconcile(battle,
                reconstruction != null ? reconstruction.events() : null,
                reconstruction != null ? reconstruction.battleStartRawClockSec() : null,
                teamEntityMapping);
        final boolean playerFeaturePossible = reconOk && recorderEntityMapped;
        final boolean teamFeaturePossible = reconOk
                && perspectiveTeamResolved
                && teamEntityMapping.mappedMembers(teamResolution.perspectiveTeam()) > 0;
        final ReplayProcessingCapabilities capabilities = new ReplayProcessingCapabilities(
                summaryOk, recorderResultAvailable, reconOk,
                recorderParticipantResolved, recorderEntityMapped,
                perspectiveTeamResolved, playerFeaturePossible, teamFeaturePossible);

        return new ReplayProcessingResult(
                input.name(), status, identity,
                battle, reconstruction, diagnostics,
                capabilities, null, reconstructionError);
    }

    /** 文件级基础验证：扩展名 + 非空 + 大小限制。 */
    private static ReplayFileValidationResult validateFile(final Source input) {
        final List<ReplayValidationError> errors = new ArrayList<>();
        final String name = input.name();
        if (!StringUtils.hasText(name)) {
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

    /** 重建 participants 中是否存在标记为录像者的 participant。 */
    private static boolean isRecorderParticipantResolved(final ReplayReconstruction reconstruction) {
        return reconstruction != null
                && reconstruction.participants().stream()
                        .anyMatch(BattleParticipant::recorder);
    }

    /** 基于 ParticipantMappingEvent 判断录像者 entity ID 是否已映射。 */
    private static boolean isRecorderEntityMapped(final ReplayReconstruction reconstruction) {
        if (reconstruction == null) return false;
        final var recorderAccounts = reconstruction.participants().stream()
                .filter(BattleParticipant::recorder)
                .map(BattleParticipant::accountId)
                .collect(java.util.stream.Collectors.toSet());
        if (recorderAccounts.isEmpty()) return false;
        return reconstruction.events().stream()
                .filter(ParticipantMappingEvent.class::isInstance)
                .map(ParticipantMappingEvent.class::cast)
                .anyMatch(e -> recorderAccounts.contains(e.accountId()) && e.entityId() > 0);
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
