package com.wotb.web.hundred.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.hundred.dto.HundredCreateResult;
import com.wotb.web.hundred.dto.HundredLeaderboardPageDto;
import com.wotb.web.hundred.dto.HundredSubmissionSummaryDto;
import com.wotb.web.hundred.service.HundredBattleSubmissionService;
import com.wotb.web.hundred.service.HundredLeaderboardService;
import com.wotb.web.util.JwtUtil;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

@RestController
@RequestMapping(ApiPaths.HOF_HUNDRED)
public class HundredBattleController {

    private final HundredBattleSubmissionService service;
    private final HundredLeaderboardService leaderboardService;

    public HundredBattleController(final HundredBattleSubmissionService service,
                                   final HundredLeaderboardService leaderboardService) {
        this.service = service;
        this.leaderboardService = leaderboardService;
    }

    @GetMapping
    public HundredLeaderboardPageDto leaderboard(
            @RequestParam(name = "vehicleId", required = false) final Long vehicleId,
            @RequestParam(name = "nation", required = false) final String nation,
            @RequestParam(name = "vehicleType", required = false) final String vehicleType,
            @RequestParam(name = "page", defaultValue = "1") final int page,
            @RequestParam(name = "size", defaultValue = "50") final int size) {
        return leaderboardService.leaderboard(vehicleId, nation, vehicleType, page, size);
    }

    @PostMapping("/submissions")
    public HundredCreateResult create(
            @RequestParam(name = "vehicleId") final long vehicleId,
            @RequestParam(name = "averageDamage") final int averageDamage,
            @RequestParam(name = "battleCount") final int battleCount,
            @RequestParam(name = "screenshot") final String screenshot,
            @RequestParam(name = "replays") final List<MultipartFile> replays,
            final HttpServletRequest request) {
        final String[] facts = request.getParameterValues("facts");
        return service.createSubmission(JwtUtil.requireUserId(),
                vehicleId, averageDamage, battleCount, screenshot, replays,
                facts == null ? List.of() : List.of(facts));
    }

    @PostMapping("/submissions/{id}/cancel")
    public HundredSubmissionSummaryDto cancel(@PathVariable final long id) {
        return service.cancelSubmission(JwtUtil.requireUserId(), id);
    }
}
