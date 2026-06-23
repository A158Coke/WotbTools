package com.wotb.web;

import com.wotb.core.*;
import com.wotb.core.model.Battle;
import com.wotb.core.model.Collected;
import com.wotb.core.model.Source;
import com.wotb.web.dto.AggRow;
import com.wotb.web.dto.BattleDto;
import com.wotb.web.dto.PreviewResponse;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.Resource;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayOutputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * 回放处理 REST API (无状态)。
 * 跨域开放
 */
@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class ReplayController {

    private final Tankopedia tankopedia = Tankopedia.load();
    private final ConfigurableApplicationContext context;
    private final Environment env;

    public ReplayController(ConfigurableApplicationContext context, Environment env) {
        this.context = context;
        this.env = env;
    }

    /** 列定义 (前端构建表头/列选择/排序)。 */
    @GetMapping("/columns")
    public Object columns() {
        return java.util.Map.of(
                "player", Mapper.playerColumns(),
                "aggregate", Mapper.aggregateColumns());
    }

    /** 健康检查。 */
    @GetMapping("/health")
    public Object health() {
        return java.util.Map.of(
                "status", "ok",
                "tanks", tankopedia.size(),
                "desktop", env.getProperty("app.desktop", Boolean.class, false));
    }

    /** 解析(并去重), 返回预览 JSON: 每场玩家数据 + 跨场汇总 + 去重/失败信息。 */
    @PostMapping(value = "/preview", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public PreviewResponse preview(@RequestParam("files") MultipartFile[] files) throws Exception {
        Collected c = Replays.collect(toSources(files), null);
        Rating.compute(c.battles, tankopedia);   // 基准=本次上传集合

        List<BattleDto> battles = new ArrayList<>();
        for (int i = 0; i < c.battles.size(); i++) {
            battles.add(Mapper.toBattle(c.battles.get(i), c.battleSourceNames.get(i), tankopedia));
        }
        List<AggRow> aggregate = c.battles.size() > 1
                ? Mapper.toAggregate(Aggregator.aggregate(c.battles, tankopedia))
                : List.of();

        return new PreviewResponse(battles, aggregate, c.duplicates, c.failures,
                Mapper.playerColumns(), Mapper.aggregateColumns());
    }

    /** 导出 xlsx: 单场 -> 单场工作簿; 多场 -> 去重后的汇总工作簿。 */
    @PostMapping(value = "/export", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<Resource> export(@RequestParam("files") MultipartFile[] files,
                                           @RequestParam(value = "mode", defaultValue = "aggregate") String mode) throws Exception {
        if ("each".equalsIgnoreCase(mode)) {
            return exportEach(files);
        }

        Collected c = Replays.collect(toSources(files), null);
        if (c.battles.isEmpty()) {
            return ResponseEntity.badRequest().build();
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        String filename;
        if (c.battles.size() == 1) {
            ExcelExporter.writeSingle(c.battles.getFirst(), tankopedia, out);
            String base = stripExt(c.battleSourceNames.getFirst());
            filename = base + ".xlsx";
        } else {
            ExcelExporter.writeAggregate(c.battles, c.battleSourceNames, c.duplicates, tankopedia, out);
            filename = "联赛汇总.xlsx";
        }
        ByteArrayResource body = new ByteArrayResource(out.toByteArray());
        String encoded = URLEncoder.encode(filename, StandardCharsets.UTF_8).replace("+", "%20");
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"export.xlsx\"; filename*=UTF-8''" + encoded)
                .contentType(MediaType.parseMediaType(
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
                .body(body);
    }

    @PostMapping("/shutdown")
    public Object shutdown() {
        if (!env.getProperty("app.desktop", Boolean.class, false)) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.FORBIDDEN, "Shutdown is only available in desktop mode");
        }
        new Thread(() -> {
            try {
                Thread.sleep(300);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
            int code = SpringApplicationExit.exit(context);
            System.exit(code);
        }, "desktop-shutdown").start();
        return java.util.Map.of("status", "closing");
    }

    private ResponseEntity<Resource> exportEach(MultipartFile[] files) throws Exception {
        List<Source> sources = toSources(files);
        ByteArrayOutputStream zipBytes = new ByteArrayOutputStream();
        int exported = 0;
        Set<String> usedNames = new HashSet<>();
        try (ZipOutputStream zip = new ZipOutputStream(zipBytes, StandardCharsets.UTF_8)) {
            for (Source source : sources) {
                try {
                    Battle battle = ReplayParser.parse(source.bytes());
                    ByteArrayOutputStream xlsx = new ByteArrayOutputStream();
                    ExcelExporter.writeSingle(battle, tankopedia, xlsx);
                    ZipEntry entry = new ZipEntry(uniqueName(stripExt(source.name()) + ".xlsx", usedNames));
                    zip.putNextEntry(entry);
                    zip.write(xlsx.toByteArray());
                    zip.closeEntry();
                    exported++;
                } catch (Exception ignored) {
                    // Preview reports failures in detail; each-export skips invalid inputs like the Python batch mode.
                }
            }
        }
        if (exported == 0) {
            return ResponseEntity.badRequest().build();
        }
        ByteArrayResource body = new ByteArrayResource(zipBytes.toByteArray());
        String filename = "逐场导出.zip";
        String encoded = URLEncoder.encode(filename, StandardCharsets.UTF_8).replace("+", "%20");
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"each-export.zip\"; filename*=UTF-8''" + encoded)
                .contentType(MediaType.parseMediaType("application/zip"))
                .body(body);
    }

    private static String uniqueName(String preferred, Set<String> usedNames) {
        String safe = preferred.replace('\\', '_').replace('/', '_');
        if (usedNames.add(safe)) {
            return safe;
        }
        int dot = safe.lastIndexOf('.');
        String base = dot > 0 ? safe.substring(0, dot) : safe;
        String ext = dot > 0 ? safe.substring(dot) : "";
        for (int i = 2; ; i++) {
            String candidate = base + "-" + i + ext;
            if (usedNames.add(candidate)) {
                return candidate;
            }
        }
    }

    private static List<Source> toSources(MultipartFile[] files) throws Exception {
        List<Source> sources = new ArrayList<>();
        for (MultipartFile f : files) {
            String name = f.getOriginalFilename();
            sources.add(new Source(name == null ? "replay.wotbreplay" : name, f.getBytes()));
        }
        return sources;
    }

    private static String stripExt(String name) {
        int dot = name.lastIndexOf('.');
        return dot > 0 ? name.substring(0, dot) : name;
    }

    private static final class SpringApplicationExit {
        static int exit(ConfigurableApplicationContext context) {
            return org.springframework.boot.SpringApplication.exit(context, () -> 0);
        }
    }
}
