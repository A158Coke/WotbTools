package com.wotb.web.boost.controller;

import com.wotb.web.boost.dto.BoosterDto;
import com.wotb.web.boost.dto.UpdateBoosterAvailabilityRequest;
import com.wotb.web.boost.service.BoosterService;
import com.wotb.web.util.JwtUtil;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** 玩家侧打手查询 — 需登录，返回当前用户的打手信息。 */
@RestController
@RequestMapping("/api/boost/boosters")
@CrossOrigin(origins = "*")
public class MyBoosterController {

    private final BoosterService service;

    public MyBoosterController(final BoosterService service) {
        this.service = service;
    }

    @GetMapping("/my")
    public BoosterDto myBooster() {
        return currentBooster();
    }

    @PatchMapping("/my/availability")
    public BoosterDto setMyAvailability(@RequestBody final UpdateBoosterAvailabilityRequest body) {
        return service.setAvailability(currentBooster().id(), body.available());
    }

    private BoosterDto currentBooster() {
        final String uid = JwtUtil.requireUserId();
        return service.findByKeycloakUserId(uid)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "BOOSTER_NOT_FOUND"));
    }
}
