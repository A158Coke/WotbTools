package com.wotb.web.controller;

import com.wotb.web.dto.LeaderboardRecordDto;
import com.wotb.web.service.LeaderboardService;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

/**
 * 排行榜 REST API (仅 postgres profile; 只做 HTTP 映射, 业务在 LeaderboardService)。
 */
@RestController
@RequestMapping("/api/leaderboard")
@CrossOrigin(origins = "*")
@Profile("postgres")
public class LeaderboardController {

    private final LeaderboardService service;

    public LeaderboardController(final LeaderboardService service) {
        this.service = service;
    }

    /** 全局伤害榜。 */
    @GetMapping("/top-damage")
    public List<LeaderboardRecordDto> topDamage(
            @RequestParam(name = "limit", defaultValue = "50") final int limit) {
        return service.topDamage(limit);
    }

    /** 指定车辆的伤害榜。 */
    @GetMapping("/tanks/{tankId}/top-damage")
    public List<LeaderboardRecordDto> topDamageByTank(
            @PathVariable("tankId") final long tankId,
            @RequestParam(name = "limit", defaultValue = "50") final int limit) {
        return service.topDamageByTank(tankId, limit);
    }

    /** 单条记录; 不存在返回 404。 */
    @GetMapping("/records/{id}")
    public LeaderboardRecordDto record(@PathVariable("id") final long id) {
        return service.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "记录不存在: " + id));
    }
}
