package com.wotb.web.leaderboard.controller;

import com.wotb.core.model.Battle;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.ref.Tankopedia;
import com.wotb.web.leaderboard.dto.LeaderboardPageDto;
import com.wotb.web.leaderboard.service.LeaderboardService;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.Map;

/**
 * 排行榜 REST API (只做 HTTP 映射, 业务在 LeaderboardService)。
 */
@RestController
@RequestMapping("/api/leaderboard")
@CrossOrigin(origins = "*")
public class LeaderboardController {

    private final LeaderboardService service;
    private final Tankopedia tankopedia = Tankopedia.load();

    public LeaderboardController(final LeaderboardService service) {
        this.service = service;
    }

    /** 上传单场回放，写入排行榜。 */
    @PostMapping("/upload")
    public Map<String, Object> upload(@RequestParam(name = "file") final MultipartFile file) throws Exception {
        final Battle battle = ReplayParser.parse(file.getBytes());
        final boolean saved = service.recordRecorder(battle, tankopedia);
        if (!saved) {
            return Map.of("status", "skipped",
                "arenaId", battle.arenaId,
                "reason", battle.arenaBonusType == null || battle.arenaBonusType != 1
                    ? "仅支持随机战斗" : "已存在或无法识别录像者");
        }
        return Map.of("status", "ok", "arenaId", battle.arenaId);
    }

    /** 全局伤害榜（分页）。 */
    @GetMapping("/top-damage")
    public LeaderboardPageDto topDamage(
            @RequestParam(name = "page", defaultValue = "1") final int page,
            @RequestParam(name = "size", defaultValue = "50") final int size) {
        return service.topDamage(page, size);
    }

    /** 指定车辆的伤害榜（分页）。 */
    @GetMapping("/tanks/{tankId}/top-damage")
    public LeaderboardPageDto topDamageByTank(
            @PathVariable final long tankId,
            @RequestParam(name = "page", defaultValue = "1") final int page,
            @RequestParam(name = "size", defaultValue = "50") final int size) {
        return service.topDamageByTank(tankId, page, size);
    }
}
