package com.wotb.web.observability.controller;

import com.wotb.core.ref.Tankopedia;
import com.wotb.web.config.ApiPaths;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.List;

@RestController
public class BackendHealthController {

    @GetMapping(ApiPaths.HEALTH)
    public Object health() {
        return Map.of(
                "status", "ok",
                "tanks", Tankopedia.load().size(),
                "capabilities", List.of("recommendations-v1", "broadcast-season-contents-v1")
        );
    }
}
