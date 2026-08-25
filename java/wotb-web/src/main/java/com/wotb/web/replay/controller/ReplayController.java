package com.wotb.web.replay.controller;

import com.wotb.web.replay.service.ReplayService;
import com.wotb.web.replay.ReplayLegacyEndpoints;
import com.wotb.web.config.ApiPaths;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.Map;

/** 回放处理 REST API。 */
@RestController
@CrossOrigin(origins = "*")
public class ReplayController {

    private final ReplayService service;

    public ReplayController(final ReplayService service) {
        this.service = service;
    }

    @GetMapping(ApiPaths.COLUMNS)
    public Object columns() {
        return service.columns();
    }

    @GetMapping(ApiPaths.HEALTH)
    public Object health() {
        return Map.of(
                "status", "ok",
                "tanks", service.tankCount()
        );
    }

    @PostMapping(value = ApiPaths.PREVIEW, consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Object preview(@RequestParam(name = "files") final MultipartFile[] files) {
        // V2：同步 multipart preview 已废弃（前端走 Processing Job + dataset result）。
        // 稳定 410，绝不在此创建 scheduler 之外的 full processing。
        throw ReplayLegacyEndpoints.gone();
    }

    @PostMapping(value = ApiPaths.EXPORT, consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Object export(@RequestParam(name = "files") final MultipartFile[] files,
                         @RequestParam(name = "mode", defaultValue = "aggregate") final String mode) {
        // V2：同步 multipart export 已废弃（前端走 Export Job + Processing dataset 引用）。
        // 稳定 410，绝不在此创建 scheduler 之外的 full processing。
        throw ReplayLegacyEndpoints.gone();
    }
}
