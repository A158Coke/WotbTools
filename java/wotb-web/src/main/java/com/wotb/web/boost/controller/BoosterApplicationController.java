package com.wotb.web.boost.controller;

import com.wotb.web.boost.dto.BoosterApplicationSummaryDto;
import com.wotb.web.boost.dto.CreateBoosterApplicationRequest;
import com.wotb.web.boost.dto.CreateBoosterApplicationResponse;
import com.wotb.web.boost.service.BoosterApplicationService;
import com.wotb.web.util.JwtUtil;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/boost/booster-applications")
@CrossOrigin(origins = "*")
public class BoosterApplicationController {

    private final BoosterApplicationService service;

    public BoosterApplicationController(final BoosterApplicationService service) {
        this.service = service;
    }

    @PostMapping
    public CreateBoosterApplicationResponse create(@RequestBody final CreateBoosterApplicationRequest body) {
        return service.create(
                JwtUtil.requireUserId(),
                body.wotbAccountId(),
                body.wotbNickname(),
                body.wotbServer(),
                body.overallStatsImage(),
                body.vehicleStatsImage(),
                body.requestedLevel(),
                body.qq(),
                body.wechat(),
                body.availabilityTier(),
                body.dailyTimeWindow(),
                body.selfAssessment()
        );
    }

    @GetMapping("/my")
    public List<BoosterApplicationSummaryDto> listMine() {
        return service.listMine(JwtUtil.requireUserId());
    }
}
