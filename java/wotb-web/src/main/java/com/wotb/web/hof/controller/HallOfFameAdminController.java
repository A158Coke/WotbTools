package com.wotb.web.hof.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.hof.dto.BulkDeleteRecordsRequest;
import com.wotb.web.hof.dto.BulkDeleteResultDto;
import com.wotb.web.hof.dto.HofAdminAuditPageDto;
import com.wotb.web.hof.dto.HofAdminPageDto;
import com.wotb.web.hof.dto.HofVehicleOptionDto;
import com.wotb.web.hof.service.HallOfFameAdminService;
import com.wotb.web.hof.service.HallOfFameService;
import com.wotb.web.replayfile.ReplayDownload;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping(ApiPaths.HOF_ADMIN)
public class HallOfFameAdminController {

    private final HallOfFameAdminService adminService;
    private final HallOfFameService hofService;

    public HallOfFameAdminController(final HallOfFameAdminService adminService,
                                     final HallOfFameService hofService) {
        this.adminService = adminService;
        this.hofService = hofService;
    }

    @GetMapping
    public HofAdminPageDto list(
            @RequestParam(name = "nickname", required = false) final String nickname,
            @RequestParam(name = "accountId", required = false) final Long accountId,
            @RequestParam(name = "uploadedBy", required = false) final String uploadedBy,
            @RequestParam(name = "battleType", required = false) final String battleType,
            @RequestParam(name = "tankId", required = false) final Long tankId,
            @RequestParam(name = "nation", required = false) final String nation,
            @RequestParam(name = "vehicleType", required = false) final String vehicleType,
            @RequestParam(name = "tier", required = false) final Integer tier,
            @RequestParam(name = "replayAvailable", required = false) final Boolean replayAvailable,
            @RequestParam(name = "sort", required = false) final String sort,
            @RequestParam(name = "page", defaultValue = "1") final int page,
            @RequestParam(name = "size", defaultValue = "50") final int size) {
        return adminService.search(nickname, accountId, uploadedBy, battleType,
                tankId, nation, vehicleType, tier, replayAvailable, sort, page, size);
    }

    @GetMapping("/vehicle-options")
    public List<HofVehicleOptionDto> vehicleOptions() {
        return hofService.vehicleOptions();
    }

    @GetMapping("/audit")
    public HofAdminAuditPageDto audit(
            @RequestParam(name = "page", defaultValue = "1") final int page,
            @RequestParam(name = "size", defaultValue = "50") final int size) {
        return adminService.audit(page, size);
    }

    @GetMapping("/{id}/replay")
    public ResponseEntity<byte[]> downloadReplay(@PathVariable final long id) {
        final ReplayDownload download = hofService.downloadReplay(id);
        final String fileName = StringUtils.hasText(download.fileName())
                ? download.fileName() : "replay-" + id + ".wotbreplay";
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename(fileName, StandardCharsets.UTF_8).build().toString())
                .body(download.data());
    }

    @PostMapping("/records/bulk-delete")
    public BulkDeleteResultDto bulkDelete(@RequestBody final BulkDeleteRecordsRequest body) {
        return adminService.bulkDelete(body.normalizedIds());
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@PathVariable final long id) {
        adminService.deleteEntry(id);
        return Map.of("deleted", true);
    }
}
