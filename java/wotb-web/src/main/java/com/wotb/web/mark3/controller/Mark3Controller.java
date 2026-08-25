package com.wotb.web.mark3.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.mark3.dto.Mark3CreateResult;
import com.wotb.web.mark3.dto.Mark3LeaderboardPageDto;
import com.wotb.web.mark3.dto.Mark3SubmissionSummaryDto;
import com.wotb.web.mark3.service.Mark3SubmissionService;
import com.wotb.web.util.JwtUtil;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.math.BigDecimal;
import java.util.List;

/** 三环公开排行榜（匿名）与人工申请/取消（需登录）HTTP 映射。 */
@RestController
@RequestMapping(ApiPaths.HOF_MARK3)
@CrossOrigin(origins = "*")
public class Mark3Controller {

    private final Mark3SubmissionService service;

    public Mark3Controller(final Mark3SubmissionService service) {
        this.service = service;
    }

    @GetMapping
    public Mark3LeaderboardPageDto leaderboard(
            @RequestParam(name = "vehicleId", required = false) final Long vehicleId,
            @RequestParam(name = "nation", required = false) final String nation,
            @RequestParam(name = "vehicleType", required = false) final String vehicleType,
            @RequestParam(name = "page", defaultValue = "1") final int page,
            @RequestParam(name = "size", defaultValue = "50") final int size) {
        return service.leaderboard(vehicleId, nation, vehicleType, page, size);
    }

    /**
     * 人工三环申请 multipart fields：vehicleId、battleCount、averageDamage、winRate、
     * proofScreenshots（1–2 个 base64 data:image 值）和 replays（恰好 5 个）。
     */
    @PostMapping("/submissions")
    public Mark3CreateResult create(
            @RequestParam(name = "vehicleId") final long vehicleId,
            @RequestParam(name = "battleCount") final int battleCount,
            @RequestParam(name = "averageDamage") final int averageDamage,
            @RequestParam(name = "winRate") final BigDecimal winRate,
            @RequestParam(name = "proofScreenshots") final List<String> proofScreenshots,
            @RequestParam(name = "replays") final List<MultipartFile> replays) {
        return service.createSubmission(
                JwtUtil.requireUserId(), vehicleId, battleCount, averageDamage, winRate, proofScreenshots, replays);
    }

    @PostMapping("/submissions/{id}/cancel")
    public Mark3SubmissionSummaryDto cancel(@PathVariable final long id) {
        return service.cancelSubmission(JwtUtil.requireUserId(), id);
    }
}
