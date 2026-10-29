package com.wotb.web.battledata.controller;

import com.wotb.web.battledata.service.BattleDataService;
import com.wotb.web.config.ApiPaths;
import com.wotb.web.util.admission.TrustedClientSource;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;

/** 匿名 HTTP 聚合边界；不读取认证上下文。 */
@RestController
public class BattleDataController {
    private final BattleDataService service;
    private final TrustedClientSource source;

    public BattleDataController(final BattleDataService service,
            @Value("${battle-data.trusted-proxies:}") final String proxies) {
        this.service = service;
        source = new TrustedClientSource(proxies);
    }

    @PostMapping(value = ApiPaths.BATTLE_DATA, consumes = "application/json")
    public ResponseEntity<Void> collect(final HttpServletRequest request) throws IOException {
        final boolean created = service.accept(request.getInputStream(), source.resolve(request));
        return ResponseEntity.status(created ? HttpStatus.CREATED : HttpStatus.NO_CONTENT).build();
    }
}
