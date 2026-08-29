package com.wotb.web.mark3.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.mark3.dto.Mark3AdminDetailDto;
import com.wotb.web.mark3.dto.Mark3AdminPageDto;
import com.wotb.web.mark3.dto.Mark3DeleteRequest;
import com.wotb.web.mark3.dto.Mark3RejectRequest;
import com.wotb.web.mark3.dto.Mark3ReplayEvidenceDto;
import com.wotb.web.mark3.dto.Mark3SubmissionSummaryDto;
import com.wotb.web.mark3.service.Mark3ReplayEvidenceService;
import com.wotb.web.mark3.service.Mark3SubmissionService;
import com.wotb.web.replayfile.ReplayDownload;
import com.wotb.web.util.JwtUtil;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.util.List;

/** 三环管理审核 API；SecurityConfig 的 HOF_ADMIN_PATTERN 要求 HoF-admin 或 wotbtools-admin。 */
@RestController
@RequestMapping(ApiPaths.HOF_MARK3_ADMIN)
@CrossOrigin(origins = "*")
public class Mark3AdminController {

    private final Mark3SubmissionService service;
    private final Mark3ReplayEvidenceService evidenceService;

    public Mark3AdminController(
            final Mark3SubmissionService service,
            final Mark3ReplayEvidenceService evidenceService) {
        this.service = service;
        this.evidenceService = evidenceService;
    }

    @GetMapping("/submissions")
    public Mark3AdminPageDto list(
            @RequestParam(name = "status", required = false) final String status,
            @RequestParam(name = "nation", required = false) final String nation,
            @RequestParam(name = "vehicleType", required = false) final String vehicleType,
            @RequestParam(name = "vehicleId", required = false) final Long vehicleId,
            @RequestParam(name = "page", defaultValue = "1") final int page,
            @RequestParam(name = "size", defaultValue = "50") final int size) {
        return service.adminList(status, nation, vehicleType, vehicleId, page, size);
    }

    @GetMapping("/submissions/{id}")
    public Mark3AdminDetailDto detail(@PathVariable final long id) {
        return service.adminDetail(id);
    }

    @GetMapping("/submissions/{id}/replays")
    public List<Mark3ReplayEvidenceDto> replays(@PathVariable final long id) {
        return evidenceService.adminListEvidence(id);
    }

    @GetMapping("/submissions/{submissionId}/replays/{replayId}")
    public ResponseEntity<byte[]> downloadReplay(
            @PathVariable final long submissionId,
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

    /** 通过不接收请求体，管理员不能修改 battleCount/averageDamage/winRate。 */
    @PostMapping("/submissions/{id}/approve")
    public Mark3SubmissionSummaryDto approve(@PathVariable final long id) {
        return service.approve(JwtUtil.requireUserId(), id);
    }

    @PostMapping("/submissions/{id}/reject")
    public Mark3SubmissionSummaryDto reject(
            @PathVariable final long id,
            @RequestBody final Mark3RejectRequest body) {
        return service.reject(JwtUtil.requireUserId(), id, body.rejectReason(), body.rejectReasonText());
    }

    @PostMapping("/submissions/{id}/delete")
    public Mark3SubmissionSummaryDto delete(
            @PathVariable final long id,
            @RequestBody final Mark3DeleteRequest body) {
        return service.deleteCurrent(JwtUtil.requireUserId(), id, body.deleteReason(), body.deleteReasonText());
    }
}
