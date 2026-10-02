package com.wotb.web.replay.controller;

import com.wotb.core.ref.Tankopedia;
import com.wotb.web.config.ApiPaths;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 健康检查（部署探针 deploy/tx/deploy.sh、runtime-check-lib.sh 依赖）。
 * 服务器没有 parser：回放解析 / 汇总 / 导出全部在客户端完成，这里不再有回放处理端点。
 */
@RestController
@CrossOrigin(origins = "*")
public class ReplayController {

    @GetMapping(ApiPaths.HEALTH)
    public Object health() {
        return Map.of(
                "status", "ok",
                "tanks", Tankopedia.load().size()
        );
    }
}
