package com.wotb.web.hof.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.hof.dto.HallOfFamePageDto;
import com.wotb.web.hof.dto.HofVehicleOptionDto;
import com.wotb.web.hof.service.HallOfFameService;
import com.wotb.web.hof.service.HallOfFameUploadService;
import com.wotb.web.replayfile.ReplayDownload;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping(ApiPaths.HOF)
public class HallOfFameController {

    private final HallOfFameService service;
    private final HallOfFameUploadService uploadService;

    public HallOfFameController(
            final HallOfFameService service,
            final HallOfFameUploadService uploadService) {
        this.service = service;
        this.uploadService = uploadService;
    }

    @PostMapping("/upload")
    public Map<String, Object> upload(@RequestParam(name = "file") final MultipartFile file,
                                      @RequestParam(name = "facts") final String facts) throws Exception {
        return uploadService.upload(file, facts);
    }

    @GetMapping
    public HallOfFamePageDto list(
            @RequestParam(name = "battleType", required = false) final String battleType,
            @RequestParam(name = "tankId", required = false) final Long tankId,
            @RequestParam(name = "nation", required = false) final String nation,
            @RequestParam(name = "vehicleType", required = false) final String vehicleType,
            @RequestParam(name = "tier", required = false) final Integer tier,
            @RequestParam(name = "nickname", required = false) final String nickname,
            @RequestParam(name = "page", defaultValue = "1") final int page,
            @RequestParam(name = "size", defaultValue = "50") final int size) {
        return service.search(battleType, tankId, nation, vehicleType, tier, nickname, page, size);
    }

    @GetMapping("/vehicle-options")
    public List<HofVehicleOptionDto> vehicleOptions() {
        return service.vehicleOptions();
    }

    @GetMapping("/{id}/replay")
    public ResponseEntity<byte[]> downloadReplay(@PathVariable final long id) {
        final ReplayDownload download = service.downloadReplay(id);
        final String fileName = StringUtils.hasText(download.fileName())
                ? download.fileName() : "replay-" + id + ".wotbreplay";
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename(fileName, StandardCharsets.UTF_8).build().toString())
                .body(download.data());
    }
}
