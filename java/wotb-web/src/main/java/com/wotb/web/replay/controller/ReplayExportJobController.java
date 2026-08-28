package com.wotb.web.replay.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.replay.dto.ExportJobResponse;
import com.wotb.web.replay.job.ExportJob;
import com.wotb.web.replay.job.ReplayExportJobService;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * Replay Export Job REST API（匿名公开，与既有 /api/export 权限一致）。
 *
 * <pre>
 * POST   /api/replay/export-jobs            → 202 {jobId, status, total}（创建）
 * GET    /api/replay/export-jobs/{jobId}    → 状态/进度
 * DELETE /api/replay/export-jobs/{jobId}    → 204（取消）
 * GET    /api/replay/export-jobs/{jobId}/download → streaming artifact
 * </pre>
 * 创建即持久化输入并返回 jobId；真实进度经 status 轮询；下载走 resource streaming
 * （不 readAllBytes / 大 byte[] 重新复制）。错误码：EXPORT_QUEUE_FULL(503) /
 * JOB_NOT_FOUND(404) / JOB_NOT_READY(409)，job 内失败经 status.errorCode 返回
 * （如 NO_VALID_REPLAYS）。
 */
@RestController
@CrossOrigin(origins = "*")
public class ReplayExportJobController {

    private final ReplayExportJobService service;

    public ReplayExportJobController(final ReplayExportJobService service) {
        this.service = service;
    }

    // HTTP contract（BLOCKER 2：Export 已收口为 Dataset-only——只消费已 READY 的
    // Processing Job result，无 multipart 首传路径）。processingJobId 语义必填：缺失/空 →
    // 410 REPLAY_LEGACY_DEPRECATED（service 统一裁决，保留 intentional 410 契约）；
    // mode 默认 aggregate；teamNames 可选（multipart form-field 传递，不拼 URL query）。
    // client contract == controller contract == service contract（无 files/multipart 死参数）。
    @PostMapping(value = ApiPaths.REPLAY_EXPORT_JOBS)
    public ResponseEntity<Map<String, Object>> create(
            @RequestParam(name = "mode", defaultValue = "aggregate") final String mode,
            @RequestParam(name = "processingJobId", required = false) final String processingJobId,
            @RequestParam(name = "teamNames", required = false) final String teamNames) {
        final String jobId = service.createJob(mode, processingJobId, teamNames);
        final ExportJob.Snapshot snap = service.status(jobId);
        return ResponseEntity.accepted().body(Map.of(
                "jobId", snap.jobId(),
                "status", snap.status().name(),
                "total", snap.total()));
    }

    @GetMapping(ApiPaths.REPLAY_EXPORT_JOB_STATUS)
    public ExportJobResponse status(@PathVariable(name = "jobId") final String jobId) {
        return ExportJobResponse.from(service.status(jobId));
    }

    @DeleteMapping(ApiPaths.REPLAY_EXPORT_JOB_STATUS)
    public ResponseEntity<Void> cancel(@PathVariable(name = "jobId") final String jobId) {
        service.cancel(jobId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping(ApiPaths.REPLAY_EXPORT_JOB_DOWNLOAD)
    public ResponseEntity<Resource> download(@PathVariable(name = "jobId") final String jobId) throws IOException {
        final ExportJob.Snapshot snap = service.status(jobId);
        final Resource resource = service.download(jobId);
        final boolean zip = snap.contentType() != null && snap.contentType().contains("zip");
        final String asciiFallback = zip ? "each-export.zip" : "export.xlsx";
        final String encoded = URLEncoder.encode(snap.filename(), StandardCharsets.UTF_8).replace("+", "%20");
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"" + asciiFallback + "\"; filename*=UTF-8''" + encoded)
                .contentType(MediaType.parseMediaType(snap.contentType()))
                .contentLength(resource.contentLength())
                .body(resource);
    }
}
