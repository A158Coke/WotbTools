package com.wotb.web.hundred.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.hundred.dto.HundredAdminDetailDto;
import com.wotb.web.hundred.dto.HundredAdminPageDto;
import com.wotb.web.hundred.dto.HundredApproveRequest;
import com.wotb.web.hundred.dto.HundredDeleteRequest;
import com.wotb.web.hundred.dto.HundredRejectRequest;
import com.wotb.web.hundred.dto.HundredSubmissionSummaryDto;
import com.wotb.web.hundred.service.HundredBattleSubmissionService;
import com.wotb.web.util.JwtUtil;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 名人堂「百场」管理后台 REST API（/api/admin/hof/hundred/**，需 HoF-admin 或 wotbtools-admin；
 * security boundary 在 SecurityConfig，覆盖于 HOF_ADMIN_PATTERN）。
 */
@RestController
@RequestMapping(ApiPaths.HOF_HUNDRED_ADMIN)
@CrossOrigin(origins = "*")
public class HundredBattleAdminController {

    private final HundredBattleSubmissionService service;

    public HundredBattleAdminController(final HundredBattleSubmissionService service) {
        this.service = service;
    }

    /** 审核列表：status 过滤（PENDING / CURRENT / ...，缺省全部），submitted_at 倒序。 */
    @GetMapping("/submissions")
    public HundredAdminPageDto list(
            @RequestParam(name = "status", required = false) final String status,
            @RequestParam(name = "page", defaultValue = "1") final int page,
            @RequestParam(name = "size", defaultValue = "50") final int size) {
        return service.adminList(status, page, size);
    }

    /** 审核详情：一屏数据（proofScreenshot 仅 PENDING 返回）。 */
    @GetMapping("/submissions/{id}")
    public HundredAdminDetailDto detail(@PathVariable final long id) {
        return service.adminDetail(id);
    }

    /** APPROVE：事务内重新读取 CURRENT 并比较 approvedAverageDamage；旧 CURRENT → SUPERSEDED。 */
    @PostMapping("/submissions/{id}/approve")
    public HundredSubmissionSummaryDto approve(@PathVariable final long id,
                                               @RequestBody final HundredApproveRequest body) {
        return service.approve(JwtUtil.requireUserId(), id,
                body.approvedAverageDamage(), body.approvedBattleCount());
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
