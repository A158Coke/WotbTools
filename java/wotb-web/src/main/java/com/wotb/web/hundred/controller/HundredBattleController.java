package com.wotb.web.hundred.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.hundred.dto.HundredCreateResult;
import com.wotb.web.hundred.dto.HundredLeaderboardPageDto;
import com.wotb.web.hundred.dto.HundredSubmissionSummaryDto;
import com.wotb.web.hundred.dto.HundredWargamingSubmissionRequest;
import com.wotb.web.hundred.dto.HundredWargamingSubmissionResult;
import com.wotb.web.hundred.service.HundredBattleSubmissionService;
import com.wotb.web.hundred.service.HundredWargamingSubmissionService;
import com.wotb.web.util.JwtUtil;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

/**
 * 名人堂「百场」REST API（只做 HTTP 映射，业务在 {@link HundredBattleSubmissionService}
 * 与 {@link HundredWargamingSubmissionService}）。
 * 公开排行榜 GET /api/hof/hundred（匿名）；提交/取消 POST /api/hof/hundred/submissions（登录）。
 */
@RestController
@RequestMapping(ApiPaths.HOF_HUNDRED)
@CrossOrigin(origins = "*")
public class HundredBattleController {

    private final HundredBattleSubmissionService service;
    private final HundredWargamingSubmissionService wargamingService;

    public HundredBattleController(final HundredBattleSubmissionService service,
                                   final HundredWargamingSubmissionService wargamingService) {
        this.service = service;
        this.wargamingService = wargamingService;
    }

    /**
     * 公开排行榜：三个筛选条件按交集处理。全部为空时返回全站 CURRENT Top 10；
     * 仅传 nation / vehicleType 时返回分类交集 Top 10；传 vehicleId 时返回该车独立分页排行，
     * 若同时传入的分类与该车不匹配则返回空榜。rank 始终基于同一筛选上下文计算。
     */
    @GetMapping
    public HundredLeaderboardPageDto leaderboard(
            @RequestParam(name = "vehicleId", required = false) final Long vehicleId,
            @RequestParam(name = "nation", required = false) final String nation,
            @RequestParam(name = "vehicleType", required = false) final String vehicleType,
            @RequestParam(name = "page", defaultValue = "1") final int page,
            @RequestParam(name = "size", defaultValue = "50") final int size) {
        return service.leaderboard(vehicleId, nation, vehicleType, page, size);
    }

    /**
     * 创建百场 submission（需登录且 Profile 已配置 gameId/nickname）。
     * 表单字段：vehicleId / averageDamage / battleCount / screenshot（base64 data URL）/ replays（正好 5 个 .wotbreplay）。
     */
    @PostMapping("/submissions")
    public HundredCreateResult create(
            @RequestParam(name = "vehicleId") final long vehicleId,
            @RequestParam(name = "averageDamage") final int averageDamage,
            @RequestParam(name = "battleCount") final int battleCount,
            @RequestParam(name = "screenshot") final String screenshot,
            @RequestParam(name = "replays") final List<MultipartFile> replays) {
        return service.createSubmission(JwtUtil.requireUserId(),
                vehicleId, averageDamage, battleCount, screenshot, replays);
    }

    /** WG 官方统计自动认证：JSON 中不接受账号、区服、截图或 replay。 */
    @PostMapping("/submissions/wargaming")
    public HundredWargamingSubmissionResult createWargaming(
            @RequestBody final HundredWargamingSubmissionRequest request) {
        return wargamingService.create(JwtUtil.requireUserId(), request);
    }

    /** 用户取消自己的 PENDING submission。 */
    @PostMapping("/submissions/{id}/cancel")
    public HundredSubmissionSummaryDto cancel(@PathVariable final long id) {
        return service.cancelSubmission(JwtUtil.requireUserId(), id);
    }
}
