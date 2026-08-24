package com.wotb.web.replay.service;

import com.wotb.core.export.ExcelExporter;
import com.wotb.core.league.LeagueRatingMode;
import com.wotb.core.league.LeagueRatingResult;
import com.wotb.core.league.LeagueReplays;
import com.wotb.core.model.Battle;
import com.wotb.core.model.Source;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.processing.ReplayProcessingOptions;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.stats.PerformanceMetricsCalculator;
import com.wotb.core.stats.PotentialDamage;
import com.wotb.web.replay.dto.ColumnDef;
import com.wotb.web.replay.dto.ExportResult;
import com.wotb.web.replay.dto.PreviewResponse;
import com.wotb.web.replay.mapper.Mapper;
import com.wotb.web.replay.metrics.ReplayUsageMetrics;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
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

    public static final int MAX_REPLAY_FILES = 100;
    static final long MAX_REPLAY_FILE_BYTES = 20L * 1024 * 1024;
    static final long MAX_REPLAY_REQUEST_BYTES = 200L * 1024 * 1024;

    private static final String XLSX_MIME =
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    private static final String ZIP_MIME = "application/zip";

    private final Tankopedia tankopedia = Tankopedia.load();
    private final ReplayCapacityLimiter capacityLimiter;
    private final DefaultReplayProcessingFacade processingFacade;
    private final ReplayUsageMetrics usageMetrics;

    @Autowired
    public ReplayService(final ReplayCapacityLimiter capacityLimiter,
                         final DefaultReplayProcessingFacade processingFacade,
                         @Autowired(required = false) final ReplayUsageMetrics usageMetrics) {
        this.capacityLimiter = capacityLimiter;
        this.processingFacade = processingFacade;
        this.usageMetrics = usageMetrics;
    }

    /** 执行并统计回放解析使用指标（成功与异常都记录；无 ReplayUsageMetrics 时原样执行）。 */
    private <T> T timed(final String operation, final int fileCount, final ThrowingSupplier<T> body) throws Exception {
        if (usageMetrics == null) {
            return body.get();
        }
        return usageMetrics.timed(operation, fileCount, body::get);
    }

    @FunctionalInterface
    private interface ThrowingSupplier<T> {
        T get() throws Exception;
    }

    /** 列定义 (前端构建表头/列选择/排序)。 */
    public Map<String, List<ColumnDef>> columns() {
        return Map.of(
                "player", Mapper.playerColumns(),
                "aggregate", Mapper.aggregateColumns());
    }

    /** 已加载车辆数 (健康检查用)。 */
    public int tankCount() {
        return tankopedia.size();
    }

    /** 解析(并去重), 返回预览: 每场玩家数据 + 跨场汇总 + 去重/失败信息。 */
    public PreviewResponse preview(final MultipartFile[] files) throws Exception {
        return timed(ReplayUsageMetrics.OP_PREVIEW, files.length, () -> capacityLimiter.execute(() -> previewWithinPermit(files)));
    }

    private PreviewResponse previewWithinPermit(final MultipartFile[] files) throws Exception {
        // 统一完整处理链：parse + reconstruction + ObservedMaxHp + DeathTimeReconciler
        // （同一请求生命周期内每个 replay 只解析一次，战斗表现复用同一 authoritative facts）；
        // DTO 构建与 Replay Processing Job result 共享 Mapper.toPreviewResponse。
        // League Rating 模式：训练赛/联赛回放经 LeagueReplays 完成模式判定/去重冲突/7v7 校验/评分。
        final LeagueReplays.LeagueCollectResult c = LeagueReplays.collect(
                toSources(files), this::processFull, null, null);
        // 混合批次不再整体拒绝（plan §21）：League Rating 不聚合混合批次，battles 仍按
        // 普通回放语义成功返回，leagueUnavailableCode 提示 League Analysis unavailable。
        final String leagueUnavailableCode = c.mode() == LeagueRatingMode.MIXED_UNSUPPORTED
                ? "MIXED_LEAGUE_AND_STANDARD_REPLAYS" : null;
        // facts 层 enrich 一次（Mapper.toPreviewResponse 只读消费共享 Battle）；
        // League 模式不调用 PerformanceMetricsCalculator（旧 contribution/kast/impact 完全移除）。
        PotentialDamage.apply(c.battles(), tankopedia);
        if (c.mode() == LeagueRatingMode.LEAGUE_RATING) {
            return Mapper.toPreviewResponse(c.battles(), c.battleSourceNames(),
                    c.duplicates(), c.failures(), tankopedia, c.leagueBatch());
        }
        for (final Battle battle : c.battles()) {
            PerformanceMetricsCalculator.populateBattle(battle);
        }
        return Mapper.toPreviewResponse(c.battles(), c.battleSourceNames(), c.duplicates(), c.failures(),
                tankopedia, null, leagueUnavailableCode);
    }

    /** 逐文件模式预扫描：[0]=存在 league（2/4）、[1]=存在普通模式（解析失败不参与）。 */
    private static boolean[] peekModes(final List<Source> sources) {
        boolean anyLeague = false;
        boolean anyStandard = false;
        for (final Source s : sources) {
            final Integer abt;
            try {
                abt = com.wotb.core.parse.ReplayParser.peekArenaBonusType(s.bytes());
            } catch (final Exception e) {
                continue;
            }
            if (LeagueRatingMode.isLeague(abt)) {
                anyLeague = true;
            } else if (abt != null) {
                anyStandard = true;
            }
        }
        return new boolean[]{anyLeague, anyStandard};
    }

    /** 完整处理回填已证明的进场满血；重建不可用时仍返回结算战绩并使用车辆库兜底。 */
    private Battle processFull(final Source source) {
        final ReplayProcessingResult result = processingFacade.process(source, ReplayProcessingOptions.full());
        if (result.battle() != null) {
            return result.battle();
        }
        final String message = result.error() != null && StringUtils.hasText(result.error().message())
                ? result.error().message() : "REPLAY_PROCESSING_FAILED";
        throw new IllegalArgumentException(message);
    }


    /**
     * 导出 xlsx/zip: 单场 -> 单场工作簿; 多场 -> 去重后的汇总工作簿; mode=each -> 每场一个 xlsx 打包 zip。
     * 无可导出内容时返回 null (由调用方转 400)。League 模式与 preview 共用同一模式判定与评分 core。
     */
    public ExportResult export(final MultipartFile[] files, final String mode) throws Exception {
        return timed(ReplayUsageMetrics.OP_EXPORT, files.length, () -> capacityLimiter.execute(() -> exportWithinPermit(files, mode)));
    }

    private ExportResult exportWithinPermit(final MultipartFile[] files, final String mode) throws Exception {
        if ("each".equalsIgnoreCase(mode)) {
            return exportEach(files);
        }
        // 与 preview 完全同一条 authoritative full processing 链（reconstruction + ObservedMaxHp + DeathTimeReconciler），
        // 保证 Excel 与网页的 Contribution/KAST/Impact 使用同一 Battle facts；同一份 replay 只 full process 一次。
        final LeagueReplays.LeagueCollectResult c = LeagueReplays.collect(
                toSources(files), this::processFull, null, null);
        // 混合批次按普通回放语义导出（plan §21/§13：standard export 不依赖 League eligibility）
        if (c.battles().isEmpty()) {
            return null;
        }
        PotentialDamage.apply(c.battles(), tankopedia);   // 与 preview 相同的事实层 enrich
        if (c.mode() == LeagueRatingMode.LEAGUE_RATING) {
            final ByteArrayOutputStream out = new ByteArrayOutputStream();
            final String filename;
            if (c.battles().size() == 1) {
                // identity 绑定：单场 Rating 按 arenaId 查找（plan §9）；未通过校验的
                // 单场 league 回放仍导出基础数据（普通单场工作簿，无 Rating 列），不崩溃不错位
                final LeagueRatingResult single = c.leagueBatch().resultFor(c.battles().getFirst().arenaId);
                if (single != null) {
                    ExcelExporter.writeSingleLeague(c.battles().getFirst(), single, tankopedia, out);
                } else {
                    ExcelExporter.writeSingle(c.battles().getFirst(), tankopedia, out);
                }
                filename = stripExt(c.battleSourceNames().getFirst()) + ".xlsx";
            } else {
                ExcelExporter.writeAggregateLeague(c.battles(), c.battleSourceNames(),
                        c.duplicates(), c.leagueBatch(), tankopedia, out);
                filename = "联赛汇总.xlsx";
            }
            return new ExportResult(filename, XLSX_MIME, out.toByteArray());
        }
        for (final Battle battle : c.battles()) {
            PerformanceMetricsCalculator.populateBattle(battle);   // 单场指标进 Excel 列
        }
        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        final String filename;
        if (c.battles().size() == 1) {
            ExcelExporter.writeSingle(c.battles().getFirst(), tankopedia, out);
            filename = stripExt(c.battleSourceNames().getFirst()) + ".xlsx";
        } else {
            ExcelExporter.writeAggregate(c.battles(), c.battleSourceNames(), c.duplicates(), tankopedia, out);
            filename = "联赛汇总.xlsx";
        }
        return new ExportResult(filename, XLSX_MIME, out.toByteArray());
    }

    private ExportResult exportEach(final MultipartFile[] files) throws Exception {
        final List<Source> sources = toSources(files);
        // 模式预扫描（只读 meta.json#arenaBonusType，不 processFull）：仅当整批都是
        // league（训练赛/联赛）时走 League Rating 导出；混合批次按普通回放逐场导出
        // （plan §21：混合批次 League Analysis unavailable，standard export 不受影响）。
        final boolean[] leagueFlags = peekModes(sources);
        final boolean allLeague = leagueFlags[0] && !leagueFlags[1];
        final ByteArrayOutputStream zipBytes = new ByteArrayOutputStream();
        int exported = 0;
        final Set<String> usedNames = new HashSet<>();
        try (ZipOutputStream zip = new ZipOutputStream(zipBytes, StandardCharsets.UTF_8)) {
            if (allLeague) {
                // League：与 preview 同一 collect（去重冲突/7v7 校验/评分）；
                // 只导出通过校验并完成评分的场次，冲突/不合格场次按失败策略跳过。
                final LeagueReplays.LeagueCollectResult c = LeagueReplays.collect(
                        sources, this::processFull, null, null);
                for (int i = 0; i < c.battles().size(); i++) {
                    // identity 绑定（plan §9）；只导出通过校验并完成评分的场次，
                    // 冲突/不合格场次按失败策略跳过（与既有注释语义一致，之前因 bug 隐式生效）
                    final LeagueRatingResult result = c.leagueBatch().resultFor(c.battles().get(i).arenaId);
                    if (result == null) {
                        continue;
                    }
                    final ByteArrayOutputStream xlsx = new ByteArrayOutputStream();
                    ExcelExporter.writeSingleLeague(c.battles().get(i), result, tankopedia, xlsx);
                    final ZipEntry entry = new ZipEntry(uniqueName(
                            stripExt(c.battleSourceNames().get(i)) + ".xlsx", usedNames));
                    zip.putNextEntry(entry);
                    zip.write(xlsx.toByteArray());
                    zip.closeEntry();
                    exported++;
                }
            } else {
                for (final Source source : sources) {
                    try {
                        // 与 preview 同一条 authoritative full processing 链（每份 replay 只 full process 一次）
                        final Battle battle = processFull(source);
                        PotentialDamage.apply(List.of(battle), tankopedia);   // 与 preview 相同的事实层 enrich
                        PerformanceMetricsCalculator.populateBattle(battle);   // 单场指标进 Excel 列
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
