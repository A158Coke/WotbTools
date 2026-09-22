package com.wotb.web.replay.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.replay.dto.PreviewResponse;
import com.wotb.web.replay.dto.ProcessingJobResponse;
import com.wotb.web.replay.job.ProcessedDataset;
import com.wotb.web.replay.job.ReplayProcessingJob;
import com.wotb.web.replay.job.ReplayProcessingJobService;
import com.wotb.web.user.service.UserProfileService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
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
 * Replay Processing Job REST API（需登录：wotbtools-user / wotbtools-admin）。
 *
 * <p>真实契约与 /api/preview、/api/export 无关：本 API 由 {@code SecurityConfig} 的
 * {@code REPLAY_PROCESSING_JOBS_PATTERN} 角色门保护，下列四条端点（POST 创建 / GET 状态 /
 * GET result / DELETE 取消）全部必须携带有效 Bearer token——匿名 → 401
 * AUTH_UNAUTHENTICATED，已登录但无 wotbtools-user / wotbtools-admin 角色 → 403 AUTH_FORBIDDEN。</p>
 *
 * <pre>
 * POST   /api/replay/processing-jobs            → 202 {jobId, status, total}（创建；HTTP request 不等待解析）
 * GET    /api/replay/processing-jobs/{jobId}    → 状态/真实进度（processed/total + valid/duplicates/failures）
 * DELETE /api/replay/processing-jobs/{jobId}    → 204（取消）
 * GET    /api/replay/processing-jobs/{jobId}/result → READY 后返回 Preview 数据（不再重新 process replay）
 * </pre>
 * 错误码：PROCESSING_QUEUE_FULL(503) / JOB_NOT_FOUND(404) / JOB_NOT_READY(409)，
 * job 内失败经 status.errorCode 返回（如 NO_VALID_REPLAYS）。
 *
 * <p><b>绑定账号回放验证（best-effort 旁路）</b>：{@code GET result} 在返回 Preview 前，用已认证
 * subject 与<b>同一份</b> READY dataset 做一次「canonical 录像者 accountId == 当前绑定账号」的验证；
 * 命中时把 profile 的 {@code wotbAccountVerifiedAt} 置为首次验证时间。验证失败/不适用不影响本响应。</p>
 *
 * <p><b>Idempotency</b>：创建端点接受可选 multipart 字段 {@code operationId}（Android external replay
 * 传入其 pending identity）。同一已认证 subject 用同一 {@code operationId} 重复提交返回同一个
 * {@code jobId}，用于覆盖「server 已接受但 Native ACK 前进程被杀 → 冷启动重新导入同一份 replay」的
 * exactly-once 语义。字段缺失时保持「每次提交都是新 job」的既有语义。</p>
 */
@RestController
@CrossOrigin(origins = "*")
public class ReplayProcessingJobController {

    private static final Logger LOGGER = LoggerFactory.getLogger(ReplayProcessingJobController.class);

    private final ReplayProcessingJobService service;
    private final UserProfileService userProfileService;

    public ReplayProcessingJobController(final ReplayProcessingJobService service,
                                         final UserProfileService userProfileService) {
        this.service = service;
        this.userProfileService = userProfileService;
    }

    @PostMapping(value = ApiPaths.REPLAY_PROCESSING_JOBS, consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<Map<String, Object>> create(
            @RequestParam("files") final MultipartFile[] files,
            @RequestParam(name = "prioritySourceIndex", required = false) final Integer prioritySourceIndex,
            @RequestParam(name = "operationId", required = false) final String operationId,
            @AuthenticationPrincipal final Jwt jwt) {
        final String jobId = service.createJob(files, prioritySourceIndex, subjectOf(jwt), operationId);
        final ReplayProcessingJob.Snapshot snap = service.status(jobId);
        return ResponseEntity.accepted().body(Map.of(
                "jobId", snap.jobId(),
                "status", snap.status().name(),
                "total", snap.total()));
    }

    /** JWT subject：idempotency identity 按 authenticated subject 分域（绝不跨用户复用）。 */
    private static String subjectOf(final Jwt jwt) {
        return jwt == null ? null : jwt.getSubject();
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
    public PreviewResponse result(@PathVariable(name = "jobId") final String jobId,
                                  @AuthenticationPrincipal final Jwt jwt) {
        // 唯一共享边界：解析成功后的正常回放用法（Data / AI Review / Playback / Reconstruction / Export
        // 的 dataset 引用）都经过这里，因此绑定账号的回放验证只在这里接线，不散落到各 replay 端点。
        // dataset 只读一次：验证与 Preview 投影消费同一份，不重复访问对象存储。
        final ProcessedDataset dataset = service.readyDataset(jobId);
        verifyBoundAccountFromReplay(jobId, jwt, dataset);
        return service.preview(dataset);
    }

    /**
     * 回放录制者验证（best-effort）：recorder accountId 与当前绑定账号数值相等时标记该账号已验证。
     *
     * <p>契约：验证是回放结果上的<b>旁路</b>副作用——任何失败（数据库不可用、profile 缺失、
     * 并发冲突）都只记录日志，绝不让回放结果本身失败或改变响应。</p>
     */
    private void verifyBoundAccountFromReplay(final String jobId, final Jwt jwt,
                                              final ProcessedDataset dataset) {
        try {
            userProfileService.verifyBoundAccountFromReplay(subjectOf(jwt), dataset.battles());
        } catch (final RuntimeException e) {
            LOGGER.warn("event=replay_account_verification_failed jobId={} error={}",
                    jobId, e.getMessage(), e);
        }
    }
}
