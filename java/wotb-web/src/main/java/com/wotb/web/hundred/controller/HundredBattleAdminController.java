package com.wotb.web.hundred.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.hof.dto.ReplayDownload;
import com.wotb.web.hundred.dto.HundredAdminDetailDto;
import com.wotb.web.hundred.dto.HundredAdminPageDto;
import com.wotb.web.hundred.dto.HundredDeleteRequest;
import com.wotb.web.hundred.dto.HundredRejectRequest;
import com.wotb.web.hundred.dto.HundredReplayEvidenceDto;
import com.wotb.web.hundred.dto.HundredSubmissionSummaryDto;
import com.wotb.web.hundred.service.HundredBattleSubmissionService;
import com.wotb.web.hundred.service.HundredReplayEvidenceService;
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

/**
 * 名人堂「百场」管理后台 REST API（/api/admin/hof/hundred/**，需 HoF-admin 或 wotbtools-admin；
 * security boundary 在 SecurityConfig，覆盖于 HOF_ADMIN_PATTERN）。
 */
@RestController
@RequestMapping(ApiPaths.HOF_HUNDRED_ADMIN)
@CrossOrigin(origins = "*")
public class HundredBattleAdminController {

    private final HundredBattleSubmissionService service;
    private final HundredReplayEvidenceService evidenceService;

    public HundredBattleAdminController(final HundredBattleSubmissionService service,
                                        final HundredReplayEvidenceService evidenceService) {
        this.service = service;
        this.evidenceService = evidenceService;
    }

    /** 审核列表：status、国家、车种、车辆均可独立使用并按交集处理。 */
    @GetMapping("/submissions")
    public HundredAdminPageDto list(
            @RequestParam(name = "status", required = false) final String status,
            @RequestParam(name = "nation", required = false) final String nation,
            @RequestParam(name = "vehicleType", required = false) final String vehicleType,
            @RequestParam(name = "vehicleId", required = false) final Long vehicleId,
            @RequestParam(name = "page", defaultValue = "1") final int page,
            @RequestParam(name = "size", defaultValue = "50") final int size) {
        return service.adminList(status, nation, vehicleType, vehicleId, page, size);
    }

    /** 审核详情：MANUAL PENDING 可返回截图；WG 来源返回官方快照；终态无文件证据。 */
    @GetMapping("/submissions/{id}")
    public HundredAdminDetailDto detail(@PathVariable final long id) {
        return service.adminDetail(id);
    }

    /**
     * 审核证据列表：该 submission 的 replay metadata（slot / originalFilename / size / arenaId / sha256）。
     * 终态或证据功能上线前的旧 PENDING → 空列表；不包含文件内容，下载走下方独立端点。
     */
    @GetMapping("/submissions/{id}/replays")
    public List<HundredReplayEvidenceDto> replays(@PathVariable final long id) {
        return evidenceService.adminListEvidence(id);
    }

    /**
     * 下载单个审核证据（原始 .wotbreplay 字节）：replayId 必须属于 submissionId（ownership 校验）；
     * Content-Type octet-stream，Content-Disposition attachment（UTF-8 安全编码原始文件名，绝不参与路径）。
     */
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

    /** APPROVE：只变更状态；排名值由冻结的 submission 数据决定，旧 CURRENT → SUPERSEDED。 */
    @PostMapping("/submissions/{id}/approve")
    public HundredSubmissionSummaryDto approve(@PathVariable final long id) {
        return service.approve(JwtUtil.requireUserId(), id);
    }

    /** REJECT：原因强制（OTHER 必须填文本）。 */
    @PostMapping("/submissions/{id}/reject")
    public HundredSubmissionSummaryDto reject(@PathVariable final long id,
                                              @RequestBody final HundredRejectRequest body) {
        return service.reject(JwtUtil.requireUserId(), id,
                body.rejectReason(), body.rejectReasonText());
    }

    /** 删除 CURRENT（管理员）：CURRENT → DELETED，不恢复 SUPERSEDED；原因强制。 */
    @PostMapping("/submissions/{id}/delete")
    public HundredSubmissionSummaryDto delete(@PathVariable final long id,
                                              @RequestBody final HundredDeleteRequest body) {
        return service.deleteCurrent(JwtUtil.requireUserId(), id,
                body.deleteReason(), body.deleteReasonText());
    }
}
