package com.wotb.web.battledata.controller;

import com.wotb.web.battledata.dto.BattleDataAdminDtos;
import com.wotb.web.battledata.service.BattleDataAdminService;
import com.wotb.web.config.ApiPaths;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Admin endpoints are protected by the existing /api/admin/** security matcher. */
@RestController
public class BattleDataAdminController {
    private final BattleDataAdminService service;
    public BattleDataAdminController(final BattleDataAdminService service) { this.service = service; }

    @GetMapping(ApiPaths.ADMIN_BATTLE_DATA + "/summary")
    public BattleDataAdminDtos.Summary summary(@RequestParam(name = "from", required = false) final String from,
            @RequestParam(name = "to", required = false) final String to) {
        return service.summary(from, to);
    }
    @GetMapping(ApiPaths.ADMIN_BATTLE_DATA + "/battles")
    public BattleDataAdminDtos.Page list(@RequestParam(name = "from", required = false) final String from,
            @RequestParam(name = "to", required = false) final String to,
            @RequestParam(name = "arenaId", required = false) final String arenaId,
            @RequestParam(name = "mapKey", required = false) final String mapKey,
            @RequestParam(name = "arenaBonusType", required = false) final Integer mode,
            @RequestParam(name = "clientVersion", required = false) final String version,
            @RequestParam(name = "winnerTeam", required = false) final Integer winner,
            @RequestParam(name = "cursor", required = false) final String cursor,
            @RequestParam(name = "size", defaultValue = "25") final int size) {
        return service.list(new BattleDataAdminDtos.Filter(BattleDataAdminService.parseTime(from),
                BattleDataAdminService.parseTime(to), arenaId, mapKey, mode, version, winner), cursor, size);
    }
    @GetMapping(ApiPaths.ADMIN_BATTLE_DATA + "/battles/{id}")
    public BattleDataAdminDtos.Detail detail(@PathVariable(name = "id") final String id) { return service.detail(id); }
}
