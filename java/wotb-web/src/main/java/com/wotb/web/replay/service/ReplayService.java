package com.wotb.web.replay.service;

import com.wotb.core.export.ExcelExporter;
import com.wotb.core.model.Battle;
import com.wotb.core.model.Collected;
import com.wotb.core.model.Source;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.parse.Replays;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.stats.Aggregator;
import com.wotb.core.stats.PotentialDamage;
import com.wotb.core.stats.Rating;
import com.wotb.core.stats.RatingAnalyzer;
import com.wotb.core.stats.RatingConfig;
import com.wotb.web.replay.dto.AggRow;
import com.wotb.web.replay.dto.BattleDto;
import com.wotb.web.replay.dto.ColumnDef;
import com.wotb.web.replay.dto.ExportResult;
import com.wotb.web.replay.dto.PreviewResponse;
import com.wotb.web.replay.dto.RatingResponse;
import com.wotb.web.replay.mapper.Mapper;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/** 回放业务编排 (无状态, 与 HTTP 解耦): 解析去重、评分、映射、导出。 */
@Service
public class ReplayService {

    static final int MAX_REPLAY_FILES = 100;
    static final long MAX_REPLAY_FILE_BYTES = 20L * 1024 * 1024;
    static final long MAX_REPLAY_REQUEST_BYTES = 200L * 1024 * 1024;

    private static final String XLSX_MIME =
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    private static final String ZIP_MIME = "application/zip";

    private final Tankopedia tankopedia = Tankopedia.load();
    private final ReplayCapacityLimiter capacityLimiter;

    public ReplayService(final ReplayCapacityLimiter capacityLimiter) {
        this.capacityLimiter = capacityLimiter;
    }

    /** 列定义 (前端构建表头/列选择/排序)。 */
    public Map<String, List<ColumnDef>> columns() {
        return Map.of(
                "player", Mapper.playerColumns(),
                "aggregate", Mapper.aggregateColumns(),
                "rating", Mapper.ratingColumns());
    }

    /** 已加载车辆数 (健康检查用)。 */
    public int tankCount() {
        return tankopedia.size();
    }

    /** 当前评分参数 (供前端「评分规则」展示算法与真实权重)。 */
    public RatingConfig ratingConfig() {
        return Rating.config();
    }

    /** 解析(并去重), 返回预览: 每场玩家数据 + 跨场汇总 + 去重/失败信息。 */
    public PreviewResponse preview(final MultipartFile[] files) throws Exception {
        return capacityLimiter.execute(() -> previewWithinPermit(files));
    }

    private PreviewResponse previewWithinPermit(final MultipartFile[] files) throws Exception {
        final Collected c = Replays.collect(toSources(files), null);
        PotentialDamage.apply(c.battles, tankopedia);
        Rating.compute(c.battles, tankopedia);   // 基准=本次上传集合

        final List<BattleDto> battles = new ArrayList<>();
        for (int i = 0; i < c.battles.size(); i++) {
            battles.add(Mapper.toBattle(c.battles.get(i), c.battleSourceNames.get(i), tankopedia));
        }
        final List<AggRow> aggregate = c.battles.size() > 1
                ? Mapper.toAggregate(Aggregator.aggregate(c.battles, tankopedia))
                : List.of();

        return new PreviewResponse(battles, aggregate, c.duplicates, c.failures,
                Mapper.playerColumns(), Mapper.aggregateColumns());
    }

    /** 实时 rating: 只基于本次上传回放计算，不落库、不读取历史记录。 */
    public RatingResponse ratingLeaderboard(final MultipartFile[] files) throws Exception {
        return capacityLimiter.execute(() -> ratingWithinPermit(files));
    }

    private RatingResponse ratingWithinPermit(final MultipartFile[] files) throws Exception {
        final Collected c = Replays.collect(toSources(files), null);
        return new RatingResponse(Mapper.toRatings(RatingAnalyzer.compute(c.battles, tankopedia)),
                c.duplicates, c.failures, Mapper.ratingColumns());
    }

    /**
     * 导出 xlsx/zip: 单场 -> 单场工作簿; 多场 -> 去重后的汇总工作簿; mode=each -> 每场一个 xlsx 打包 zip。
     * 无可导出内容时返回 null (由调用方转 400)。
     */
    public ExportResult export(final MultipartFile[] files, final String mode) throws Exception {
        return capacityLimiter.execute(() -> exportWithinPermit(files, mode));
    }

    private ExportResult exportWithinPermit(final MultipartFile[] files, final String mode) throws Exception {
        if ("each".equalsIgnoreCase(mode)) {
            return exportEach(files);
        }
        final Collected c = Replays.collect(toSources(files), null);
        if (c.battles.isEmpty()) {
            return null;
        }
        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        final String filename;
        if (c.battles.size() == 1) {
            ExcelExporter.writeSingle(c.battles.getFirst(), tankopedia, out);
            filename = stripExt(c.battleSourceNames.getFirst()) + ".xlsx";
        } else {
            ExcelExporter.writeAggregate(c.battles, c.battleSourceNames, c.duplicates, tankopedia, out);
            filename = "联赛汇总.xlsx";
        }
        return new ExportResult(filename, XLSX_MIME, out.toByteArray());
    }

    private ExportResult exportEach(final MultipartFile[] files) throws Exception {
        final List<Source> sources = toSources(files);
        final ByteArrayOutputStream zipBytes = new ByteArrayOutputStream();
        int exported = 0;
        final Set<String> usedNames = new HashSet<>();
        try (ZipOutputStream zip = new ZipOutputStream(zipBytes, StandardCharsets.UTF_8)) {
            for (final Source source : sources) {
                try {
                    final Battle battle = ReplayParser.parse(source.bytes());
                    final ByteArrayOutputStream xlsx = new ByteArrayOutputStream();
                    ExcelExporter.writeSingle(battle, tankopedia, xlsx);
                    final ZipEntry entry = new ZipEntry(uniqueName(stripExt(source.name()) + ".xlsx", usedNames));
                    zip.putNextEntry(entry);
                    zip.write(xlsx.toByteArray());
                    zip.closeEntry();
                    exported++;
                } catch (final Exception ignored) {
                    // 预览已逐项报告失败; 逐场导出跳过无效输入。
                }
            }
        }
        if (exported == 0) {
            return null;
        }
        return new ExportResult("逐场导出.zip", ZIP_MIME, zipBytes.toByteArray());
    }

    private static String uniqueName(final String preferred, final Set<String> usedNames) {
        final String safe = preferred.replace('\\', '_').replace('/', '_');
        if (usedNames.add(safe)) {
            return safe;
        }
        final int dot = safe.lastIndexOf('.');
        final String base = dot > 0 ? safe.substring(0, dot) : safe;
        final String ext = dot > 0 ? safe.substring(dot) : "";
        for (int i = 2; ; i++) {
            final String candidate = base + "-" + i + ext;
            if (usedNames.add(candidate)) {
                return candidate;
            }
        }
    }

    private static List<Source> toSources(final MultipartFile[] files) throws Exception {
        validateUploads(files);
        final List<Source> sources = new ArrayList<>();
        for (final MultipartFile f : files) {
            final String name = f.getOriginalFilename();
            sources.add(new Source(name == null ? "replay.wotbreplay" : name, f.getBytes()));
        }
        return sources;
    }

    static void validateUploads(final MultipartFile[] files) {
        if (files == null || files.length == 0) {
            throw new IllegalArgumentException("NO_REPLAY_FILES");
        }
        if (files.length > MAX_REPLAY_FILES) {
            throw new IllegalArgumentException("TOO_MANY_REPLAY_FILES");
        }
        long totalBytes = 0;
        for (final MultipartFile file : files) {
            if (file == null) {
                throw new IllegalArgumentException("INVALID_REPLAY_FILE");
            }
            final long size = file.getSize();
            if (size < 0 || size > MAX_REPLAY_FILE_BYTES) {
                throw new IllegalArgumentException("FILE_TOO_LARGE");
            }
            if (totalBytes > MAX_REPLAY_REQUEST_BYTES - size) {
                throw new IllegalArgumentException("REQUEST_TOO_LARGE");
            }
            totalBytes += size;
        }
    }

    private static String stripExt(final String name) {
        final int dot = name.lastIndexOf('.');
        return dot > 0 ? name.substring(0, dot) : name;
    }
}
