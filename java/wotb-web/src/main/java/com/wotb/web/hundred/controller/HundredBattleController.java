package com.wotb.web.hundred.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.hundred.dto.HundredCreateResult;
import com.wotb.web.hundred.dto.HundredLeaderboardPageDto;
import com.wotb.web.hundred.dto.HundredSubmissionSummaryDto;
import com.wotb.web.hundred.service.HundredBattleSubmissionService;
import com.wotb.web.util.JwtUtil;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

/**
 * 名人堂「百场」REST API（只做 HTTP 映射，业务在 {@link HundredBattleSubmissionService}）。
 * 公开排行榜 GET /api/hof/hundred（匿名）；提交/取消 POST /api/hof/hundred/submissions（登录）。
 */
@RestController
@RequestMapping(ApiPaths.HOF_HUNDRED)
@CrossOrigin(origins = "*")
public class HundredBattleController {

    private final HundredBattleSubmissionService service;

    public HundredBattleController(final HundredBattleSubmissionService service) {
        this.service = service;
    }

    /**
     * 公开排行榜：未传 vehicleId 时返回全站当前最高 10 条；传入时返回该 Tier X 车辆的独立排行。
     * 两种视图的 rank 都是 query-time 计算的 competition ranking。
     */
    @GetMapping
    public HundredLeaderboardPageDto leaderboard(
            @RequestParam(name = "vehicleId", required = false) final Long vehicleId,
            @RequestParam(name = "page", defaultValue = "1") final int page,
            @RequestParam(name = "size", defaultValue = "50") final int size) {
        return service.leaderboard(vehicleId, page, size);
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

    /** 用户取消自己的 PENDING submission。 */
    @PostMapping("/submissions/{id}/cancel")
    public HundredSubmissionSummaryDto cancel(@PathVariable final long id) {
        return service.cancelSubmission(JwtUtil.requireUserId(), id);
    }
}
