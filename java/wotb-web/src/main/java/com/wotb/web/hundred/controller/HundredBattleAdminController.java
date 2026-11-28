package com.wotb.web.hundred.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.hundred.dto.BulkDeleteModerationRequest;
import com.wotb.web.hundred.dto.BulkDeleteResultDto;
import com.wotb.web.hundred.dto.HundredAdminDetailDto;
import com.wotb.web.hundred.dto.HundredAdminPageDto;
import com.wotb.web.hundred.dto.HundredDeleteRequest;
import com.wotb.web.hundred.dto.HundredRejectRequest;
import com.wotb.web.hundred.dto.HundredReplayEvidenceDto;
import com.wotb.web.hundred.dto.HundredSubmissionSummaryDto;
import com.wotb.web.hundred.service.HundredAdminQueryService;
import com.wotb.web.hundred.service.HundredModerationService;
import com.wotb.web.hundred.service.HundredReplayEvidenceService;
import com.wotb.web.replayfile.ReplayDownload;
import com.wotb.web.util.JwtUtil;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.util.List;

@RestController
@RequestMapping(ApiPaths.HOF_HUNDRED_ADMIN)
public class HundredBattleAdminController {

    private final HundredModerationService moderationService;
    private final HundredAdminQueryService queryService;
    private final HundredReplayEvidenceService evidenceService;

    public HundredBattleAdminController(final HundredModerationService moderationService,
                                        final HundredAdminQueryService queryService,
                                        final HundredReplayEvidenceService evidenceService) {
        this.moderationService = moderationService;
        this.queryService = queryService;
        this.evidenceService = evidenceService;
    }

    @GetMapping("/submissions")
    public HundredAdminPageDto list(
            @RequestParam(name = "status", required = false) final String status,
            @RequestParam(name = "nation", required = false) final String nation,
            @RequestParam(name = "vehicleType", required = false) final String vehicleType,
            @RequestParam(name = "vehicleId", required = false) final Long vehicleId,
            @RequestParam(name = "page", defaultValue = "1") final int page,
            @RequestParam(name = "size", defaultValue = "50") final int size) {
        return queryService.adminList(status, nation, vehicleType, vehicleId, page, size);
    }

    @GetMapping("/submissions/{id}")
    public HundredAdminDetailDto detail(@PathVariable final long id) {
        return queryService.adminDetail(id);
    }

    @GetMapping("/submissions/{id}/replays")
    public List<HundredReplayEvidenceDto> replays(@PathVariable final long id) {
        return evidenceService.adminListEvidence(id);
    }

    @GetMapping("/submissions/{submissionId}/replays/{replayId}")
    public ResponseEntity<byte[]> downloadReplay(@PathVariable final long submissionId,
                                                 @PathVariable final long replayId) {
        final ReplayDownload download = evidenceService.downloadEvidence(submissionId, replayId);
        final String fileName = StringUtils.hasText(download.fileName())
                ? download.fileName() : "replay-" + replayId + ".wotbreplay";
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename(fileName, StandardCharsets.UTF_8).build().toString())
                .body(download.data());
    }

    @PostMapping("/submissions/{id}/approve")
    public HundredSubmissionSummaryDto approve(@PathVariable final long id) {
        return moderationService.approve(JwtUtil.requireUserId(), id);
    }

    @PostMapping("/submissions/{id}/reject")
    public HundredSubmissionSummaryDto reject(@PathVariable final long id,
                                              @RequestBody final HundredRejectRequest body) {
        return moderationService.reject(JwtUtil.requireUserId(), id,
                body.rejectReason(), body.rejectReasonText());
    }

    @PostMapping("/submissions/{id}/delete")
    public HundredSubmissionSummaryDto delete(@PathVariable final long id,
                                              @RequestBody final HundredDeleteRequest body) {
        return moderationService.deleteSubmission(JwtUtil.requireUserId(), JwtUtil.currentUsername(), id,
                body.deleteReason(), body.deleteReasonText());
    }

    @PostMapping("/submissions/bulk-delete")
    public BulkDeleteResultDto bulkDelete(@RequestBody final BulkDeleteModerationRequest body) {
        return moderationService.bulkDeleteSubmissions(JwtUtil.requireUserId(), JwtUtil.currentUsername(),
                body.normalizedIds(), body.reason(), body.reasonText());
    }
}
