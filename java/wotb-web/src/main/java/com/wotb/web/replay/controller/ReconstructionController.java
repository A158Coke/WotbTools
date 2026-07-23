package com.wotb.web.replay.controller;

import com.wotb.core.model.Battle;
import com.wotb.core.model.Source;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.processing.ReplayBatchProcessingResult;
import com.wotb.core.processing.ReplayProcessingOptions;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.ReplayReconstructionService;
import com.wotb.web.replay.ai.AiReplayAnalysisService;
import com.wotb.web.replay.ai.AiUpstreamException;
import com.wotb.web.replay.dto.AnalyzeResponse;
import com.wotb.web.replay.dto.ReconstructSummary;
import com.wotb.web.replay.dto.StateAtResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * 回放重建 REST API（开发和验证用）。
 * <p>
 * 需要 wotbtools-admin 角色。
 * </p>
 */
@RestController
@RequestMapping("/api/replay")
public class ReconstructionController {

    private final DefaultReplayProcessingFacade processingFacade;
    private final ReplayReconstructionService reconstructionService;
    private final AiReplayAnalysisService aiService;

    public ReconstructionController(AiReplayAnalysisService aiService) {
        this.reconstructionService = new ReplayReconstructionService();
        this.processingFacade = new DefaultReplayProcessingFacade(reconstructionService);
        this.aiService = aiService;
    }

    /**
     * 单文件完整重建并返回摘要。
     * POST /api/replay/reconstruct
     */
    @PostMapping(value = "/reconstruct", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ReconstructSummary reconstruct(
            @RequestParam("file") MultipartFile file) throws IOException {

        validateFile(file);

        final byte[] replayBytes = file.getBytes();
        final ReplayReconstruction result = reconstructionService.reconstruct(replayBytes);

        return new ReconstructSummary(
                result.replayDurationSec(),
                result.battleStartRawClockSec(),
                result.diagnostics().packetCount(),
                result.coverage().decodedPackets(),
                result.participants().size(),
                result.finalState().entityCount(),
                result.events().size(),
                result.checkpoints().size(),
                result.finalState(),
                result.coverage(),
                result.diagnostics()
        );
    }

    /**
     * 任意时间点状态查询。
     * POST /api/replay/state-at
     */
    @PostMapping(value = "/state-at", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public StateAtResponse stateAt(
            @RequestParam("file") MultipartFile file,
            @RequestParam("time") float timeSec) throws IOException {

        validateFile(file);

        final byte[] replayBytes = file.getBytes();
        final BattleStateSnapshot snapshot = reconstructionService.stateAt(replayBytes, timeSec);

        return StateAtResponse.from(snapshot);
    }

    /**
     * 单文件 AI 战术复盘。
     * <p>
     * 经统一处理门面 {@link DefaultReplayProcessingFacade} 解析：战绩(battle_results)为权威源，
     * 完整重建仅补充位置维度。战绩解析失败即无权威数据可分析（NO_BATTLE_DATA）；
     * 战绩成功但重建失败时仍可基于结算数据分析。
     * </p>
     * POST /api/replay/analyze
     */
    @PostMapping(value = "/analyze", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public AnalyzeResponse analyze(
            @RequestParam("file") MultipartFile file) throws IOException {

        validateFile(file);

        final String name = file.getOriginalFilename() != null
                ? file.getOriginalFilename() : "replay.wotbreplay";
        final ReplayProcessingResult processed = processingFacade.process(
                new Source(name, file.getBytes()), ReplayProcessingOptions.full());

        final Battle battle = processed.battle();
        if (battle == null) {
            // 战绩解析失败——没有可用于分析的权威数据
            throw new IllegalArgumentException("NO_BATTLE_DATA");
        }
        final ReplayReconstruction recon = processed.reconstruction();
        final AiReplayAnalysisService.AnalyzeResult result = aiService.analyze(battle, recon);

        return new AnalyzeResponse(
                result.analysis(),
                result.model(),
                recon != null ? recon.diagnostics().packetCount() : 0,
                battle.nPlayers(),
                recon != null ? recon.events().size() : 0,
                result.keyEvents());
    }

    /**
     * 批量重建（公开给 admin 使用的新 pipeline）。
     * POST /api/replay/reconstruct-batch
     */
    @PostMapping(value = "/reconstruct-batch", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ReplayBatchProcessingResult reconstructBatch(
            @RequestParam("files") MultipartFile[] files) throws IOException {

        validateBatch(files);

        final List<Source> sources = new ArrayList<>();
        for (final MultipartFile f : files) {
            sources.add(new Source(
                    f.getOriginalFilename() != null ? f.getOriginalFilename() : "replay.wotbreplay",
                    f.getBytes()));
        }

        return processingFacade.processBatch(sources, ReplayProcessingOptions.full());
    }

    @PostMapping(value = "/process", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ReplayBatchProcessingResult process(
            @RequestParam("files") MultipartFile[] files,
            @RequestParam(name = "reconstruct", defaultValue = "false") boolean doReconstruct) throws IOException {

        validateBatch(files);

        final ReplayProcessingOptions options = doReconstruct
                ? ReplayProcessingOptions.full()
                : ReplayProcessingOptions.summaryOnly();

        final List<Source> sources = new ArrayList<>();
        for (final MultipartFile f : files) {
            sources.add(new Source(
                    f.getOriginalFilename() != null ? f.getOriginalFilename() : "replay.wotbreplay",
                    f.getBytes()));
        }

        return processingFacade.processBatch(sources, options);
    }

    // ---- 异常映射（仅本控制器；返回稳定错误码文本，供前端本地化） ----

    /** 请求/数据错误（文件校验失败、NO_BATTLE_DATA 等）→ 400。 */
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<String> handleBadRequest(IllegalArgumentException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .contentType(MediaType.TEXT_PLAIN)
                .body(e.getMessage());
    }

    /** AI 未配置密钥 → 503 AI_NOT_CONFIGURED。 */
    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<String> handleNotConfigured(IllegalStateException e) {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .contentType(MediaType.TEXT_PLAIN)
                .body(e.getMessage());
    }

    /** 上游 AI 调用失败 → 502。 */
    @ExceptionHandler(AiUpstreamException.class)
    public ResponseEntity<String> handleUpstream(AiUpstreamException e) {
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .contentType(MediaType.TEXT_PLAIN)
                .body(e.getMessage());
    }

    // ---- 验证 ----

    private static void validateFile(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("NO_REPLAY_FILE");
        }
        final String name = file.getOriginalFilename();
        if (name != null && !name.toLowerCase().endsWith(".wotbreplay")) {
            throw new IllegalArgumentException("INVALID_REPLAY_FILE_TYPE");
        }
        if (file.getSize() > 20L * 1024 * 1024) {
            throw new IllegalArgumentException("FILE_TOO_LARGE");
        }
    }

    private static void validateBatch(MultipartFile[] files) {
        if (files == null || files.length == 0) {
            throw new IllegalArgumentException("NO_REPLAY_FILES");
        }
        if (files.length > 10) {
            throw new IllegalArgumentException("TOO_MANY_REPLAY_FILES");
        }
        long totalBytes = 0;
        for (final MultipartFile f : files) {
            if (f == null || f.isEmpty()) {
                throw new IllegalArgumentException("INVALID_REPLAY_FILE");
            }
            totalBytes += f.getSize();
        }
        if (totalBytes > 200L * 1024 * 1024) {
            throw new IllegalArgumentException("TOTAL_REQUEST_TOO_LARGE");
        }
    }
}
