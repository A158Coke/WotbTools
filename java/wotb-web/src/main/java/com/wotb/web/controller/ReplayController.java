package com.wotb.web.controller;

import com.wotb.web.dto.ExportResult;
import com.wotb.web.dto.PreviewResponse;
import com.wotb.web.service.DesktopLifecycle;
import com.wotb.web.service.ReplayService;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * 回放处理 REST API (无状态, 仅做 HTTP 映射; 业务在 service 层)。
 * 跨域开放。
 */
@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class ReplayController {

    private final ReplayService service;
    private final DesktopLifecycle lifecycle;

    public ReplayController(final ReplayService service, final DesktopLifecycle lifecycle) {
        this.service = service;
        this.lifecycle = lifecycle;
    }

    /** 列定义 (前端构建表头/列选择/排序)。 */
    @GetMapping("/columns")
    public Object columns() {
        return service.columns();
    }

    /** 健康检查。 */
    @GetMapping("/health")
    public Object health() {
        return java.util.Map.of(
                "status", "ok",
                "tanks", service.tankCount(),
                "desktop", lifecycle.isDesktop());
    }

    /** 解析(并去重), 返回预览 JSON: 每场玩家数据 + 跨场汇总 + 去重/失败信息。 */
    @PostMapping(value = "/preview", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public PreviewResponse preview(@RequestParam("files") final MultipartFile[] files) throws Exception {
        return service.preview(files);
    }

    /** 导出 xlsx: 单场 -> 单场工作簿; 多场 -> 去重后的汇总; mode=each -> 逐场 zip。 */
    @PostMapping(value = "/export", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<Resource> export(@RequestParam("files") final MultipartFile[] files,
                                           @RequestParam(value = "mode", defaultValue = "aggregate") final String mode)
            throws Exception {
        final ExportResult result = service.export(files, mode);
        if (result == null) {
            return ResponseEntity.badRequest().build();
        }
        final boolean zip = result.contentType().contains("zip");
        final String asciiFallback = zip ? "each-export.zip" : "export.xlsx";
        final String encoded = URLEncoder.encode(result.filename(), StandardCharsets.UTF_8).replace("+", "%20");
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"" + asciiFallback + "\"; filename*=UTF-8''" + encoded)
                .contentType(MediaType.parseMediaType(result.contentType()))
                .body(new ByteArrayResource(result.data()));
    }

    @PostMapping("/shutdown")
    public Object shutdown() {
        if (!lifecycle.isDesktop()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Shutdown is only available in desktop mode");
        }
        lifecycle.requestShutdown();
        return java.util.Map.of("status", "closing");
    }
}
