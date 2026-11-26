package com.wotb.web.mark3.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.mark3.dto.Mark3CreateResult;
import com.wotb.web.mark3.dto.Mark3LeaderboardPageDto;
import com.wotb.web.mark3.dto.Mark3SubmissionSummaryDto;
import com.wotb.web.mark3.service.Mark3SubmissionService;
import com.wotb.web.mark3.service.Mark3LeaderboardService;
import com.wotb.web.util.JwtUtil;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.math.BigDecimal;
import java.util.List;

@RestController
@RequestMapping(ApiPaths.HOF_MARK3)
public class Mark3Controller {

    private final Mark3SubmissionService service;
    private final Mark3LeaderboardService leaderboardService;

    public Mark3Controller(final Mark3SubmissionService service, final Mark3LeaderboardService leaderboardService) {
        this.service = service;
        this.leaderboardService = leaderboardService;
    }

    @GetMapping
    public Mark3LeaderboardPageDto leaderboard(
            @RequestParam(name = "vehicleId", required = false) final Long vehicleId,
            @RequestParam(name = "nation", required = false) final String nation,
            @RequestParam(name = "vehicleType", required = false) final String vehicleType,
            @RequestParam(name = "page", defaultValue = "1") final int page,
            @RequestParam(name = "size", defaultValue = "50") final int size) {
        return leaderboardService.leaderboard(vehicleId, nation, vehicleType, page, size);
    }

    @PostMapping("/submissions")
    public Mark3CreateResult create(
            @RequestParam(name = "vehicleId") final long vehicleId,
            @RequestParam(name = "battleCount") final int battleCount,
            @RequestParam(name = "averageDamage") final int averageDamage,
            @RequestParam(name = "winRate") final BigDecimal winRate,
            @RequestParam(name = "replays") final List<MultipartFile> replays,
            final HttpServletRequest request) {
        final String[] proofScreenshotValues = request.getParameterValues("proofScreenshots");
        final List<String> proofScreenshots = proofScreenshotValues == null
                ? List.of()
                : List.of(proofScreenshotValues);
        final String[] factValues = request.getParameterValues("facts");
        return service.createSubmission(
                JwtUtil.requireUserId(), vehicleId, battleCount, averageDamage, winRate, proofScreenshots, replays,
                factValues == null ? List.of() : List.of(factValues));
    }

    @PostMapping("/submissions/{id}/cancel")
    public Mark3SubmissionSummaryDto cancel(@PathVariable final long id) {
        return service.cancelSubmission(JwtUtil.requireUserId(), id);
    }
}
