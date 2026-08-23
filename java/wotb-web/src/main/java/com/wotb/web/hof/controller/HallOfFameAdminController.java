package com.wotb.web.hof.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.hof.dto.HofAdminAuditPageDto;
import com.wotb.web.hof.dto.HofAdminPageDto;
import com.wotb.web.hof.dto.HofVehicleOptionDto;
import com.wotb.web.hof.dto.ReplayDownload;
import com.wotb.web.hof.service.HallOfFameAdminService;
import com.wotb.web.hof.service.HallOfFameService;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/**
 * 名人堂管理后台 REST API（/api/admin/hof/**，需 HoF-admin 或 wotbtools-admin）。
 * 只做 HTTP 映射；security boundary 在 SecurityConfig（独立 role-protected）。
 */
@RestController
@RequestMapping(ApiPaths.HOF_ADMIN)
@CrossOrigin(origins = "*")
public class HallOfFameAdminController {

    private final HallOfFameAdminService adminService;
    private final HallOfFameService hofService;

    public HallOfFameAdminController(final HallOfFameAdminService adminService,
                                     final HallOfFameService hofService) {
        this.adminService = adminService;
        this.hofService = hofService;
    }

    /** 管理列表：国家/车种/等级可独立使用，并与其他条件按交集搜索。 */
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

    /** 管理筛选车辆：返回当前名人堂已有车辆的业务可读属性。 */
    @GetMapping("/vehicle-options")
    public List<HofVehicleOptionDto> vehicleOptions() {
        return hofService.vehicleOptions();
    }

    /** 操作日志（只读）。 */
    @GetMapping("/audit")
    public HofAdminAuditPageDto audit(
            @RequestParam(name = "page", defaultValue = "1") final int page,
            @RequestParam(name = "size", defaultValue = "50") final int size) {
        return adminService.audit(page, size);
    }

    /** 管理后台下载 replay：复用统一 authenticated 下载机制（同一文件读取逻辑，不建第二套）。 */
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

    /** Hard delete（二次确认在前端；audit + delete 单事务；最后引用清理物理文件；删除后可重新上传）。 */
    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@PathVariable final long id) {
        adminService.deleteEntry(id);
        return Map.of("deleted", true);
    }
}
