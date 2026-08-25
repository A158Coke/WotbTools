package com.wotb.web.replay.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.replay.dto.PreviewResponse;
import com.wotb.web.replay.dto.ProcessingJobResponse;
import com.wotb.web.replay.job.ReplayProcessingJob;
import com.wotb.web.replay.job.ReplayProcessingJobService;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.Map;

/**
 * Replay Processing Job REST API（匿名公开，与 /api/preview 权限一致）。
 *
 * <pre>
 * POST   /api/replay/processing-jobs            → 202 {jobId, status, total}（创建；HTTP request 不等待解析）
 * GET    /api/replay/processing-jobs/{jobId}    → 状态/真实进度（processed/total + valid/duplicates/failures）
 * DELETE /api/replay/processing-jobs/{jobId}    → 204（取消）
 * GET    /api/replay/processing-jobs/{jobId}/result → READY 后返回 Preview 数据（不再重新 process replay）
 * </pre>
 * 错误码：PROCESSING_QUEUE_FULL(503) / JOB_NOT_FOUND(404) / JOB_NOT_READY(409)，
 * job 内失败经 status.errorCode 返回（如 NO_VALID_REPLAYS）。
 */
@RestController
@CrossOrigin(origins = "*")
public class ReplayProcessingJobController {

    private final ReplayProcessingJobService service;

    public ReplayProcessingJobController(final ReplayProcessingJobService service) {
        this.service = service;
    }

    @PostMapping(value = ApiPaths.REPLAY_PROCESSING_JOBS, consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<Map<String, Object>> create(
            @RequestParam("files") final MultipartFile[] files,
            @RequestParam(name = "prioritySourceIndex", required = false) final Integer prioritySourceIndex) {
        final String jobId = service.createJob(files, prioritySourceIndex);
        final ReplayProcessingJob.Snapshot snap = service.status(jobId);
        return ResponseEntity.accepted().body(Map.of(
                "jobId", snap.jobId(),
                "status", snap.status().name(),
                "total", snap.total()));
    }

    @GetMapping(ApiPaths.REPLAY_PROCESSING_JOB_STATUS)
    public ProcessingJobResponse status(@PathVariable(name = "jobId") final String jobId) {
        return ProcessingJobResponse.from(service.status(jobId));
    }

    @DeleteMapping(ApiPaths.REPLAY_PROCESSING_JOB_STATUS)
    public ResponseEntity<Void> cancel(@PathVariable(name = "jobId") final String jobId) {
        service.cancel(jobId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping(ApiPaths.REPLAY_PROCESSING_JOB_RESULT)
    public PreviewResponse result(@PathVariable(name = "jobId") final String jobId) {
        return service.result(jobId);
    }
}
