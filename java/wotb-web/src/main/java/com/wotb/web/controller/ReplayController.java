package com.wotb.web.controller;

import com.wotb.web.dto.ExportResult;
import com.wotb.web.dto.PreviewResponse;
import com.wotb.web.dto.RatingResponse;
import com.wotb.web.service.ReplayService;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/** 回放处理 REST API。 */
@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class ReplayController {

    private final ReplayService service;

    public ReplayController(final ReplayService service) {
        this.service = service;
    }

    @GetMapping("/columns")
    public Object columns() {
        return service.columns();
    }

    @GetMapping("/rating")
    public Object rating() {
        return service.ratingConfig();
    }

    @PostMapping(value = "/rating", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public RatingResponse ratingLeaderboard(@RequestParam(name = "files") final MultipartFile[] files)
            throws Exception {
        return service.ratingLeaderboard(files);
    }

    @GetMapping("/health")
    public Object health() {
        return Map.of(
                "status", "ok",
                "tanks", service.tankCount()
        );
    }

    @PostMapping(value = "/preview", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public PreviewResponse preview(@RequestParam(name = "files") final MultipartFile[] files) throws Exception {
        return service.preview(files);
    }

    @PostMapping(value = "/export", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<Resource> export(@RequestParam(name = "files") final MultipartFile[] files,
                                           @RequestParam(name = "mode", defaultValue = "aggregate") final String mode)
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
}
