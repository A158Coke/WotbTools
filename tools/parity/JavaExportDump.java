import com.wotb.core.export.ExcelExporter;
import com.wotb.core.model.Battle;
import com.wotb.core.parse.Replays;
import com.wotb.core.rating.LeagueRatingResult;
import com.wotb.core.ref.Tankopedia;
import com.wotb.web.replay.job.ProcessedDataset;
import com.wotb.web.replay.job.ReplayBatchFinalizer;
import org.apache.poi.ss.usermodel.BorderStyle;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.FillPatternType;
import org.apache.poi.ss.usermodel.HorizontalAlignment;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.util.CellRangeAddress;
import org.apache.poi.xssf.usermodel.XSSFCellStyle;
import org.apache.poi.xssf.usermodel.XSSFColor;
import org.apache.poi.xssf.usermodel.XSSFFont;
import org.apache.poi.xssf.usermodel.XSSFSheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.openxmlformats.schemas.spreadsheetml.x2006.main.CTCol;
import org.openxmlformats.schemas.spreadsheetml.x2006.main.CTCols;
import org.openxmlformats.schemas.spreadsheetml.x2006.main.CTPane;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * 迁移期一次性对比工具（Java 侧「标准答案」）：对 golden 批次跑服务端同一条导出链路
 * （{@code ReplayBatchFinalizer.finalizeBatch} → {@code ReplayExportJobService}
 * processAggregateFromResult / processEachFromResult 所调用的 {@link ExcelExporter}），
 * 把产出的 xlsx 重新用 POI 读回并归一化成 JSON（单元格值 + 列宽 + 冻结 + 筛选 + 合并 + 样式事实），
 * 供客户端 exceljs 移植逐格对齐（frontend/src/replay-local/export/export.golden.test.ts）。
 *
 * <p>输入与 compute golden 相同：Battle 取自 java-battles.json（不重新解析回放），
 * 保证两侧输入逐字段一致。时区固定：用 {@code -Duser.timezone=Asia/Shanghai} 运行。</p>
 *
 * <pre>
 * java -Duser.timezone=Asia/Shanghai -cp "&lt;coordinator classpath&gt;" tools/parity/JavaExportDump.java \
 *   &lt;golden&gt;/batches.json &lt;golden&gt;/java-battles.json &lt;golden&gt;/java-export.json
 * </pre>
 */
public class JavaExportDump {

    private static final ObjectMapper OM = JsonMapper.builder()
            .configure(tools.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
            .build();
    private static final Tankopedia TP = Tankopedia.load();

    /** 规范化后的工作簿（JSON 串）→ id，去重相同工作簿。 */
    private static final Map<String, String> WB_IDS = new LinkedHashMap<>();
    private static final Map<String, Object> WORKBOOKS = new LinkedHashMap<>();
    private static final List<String> STYLES = new ArrayList<>();

    @FunctionalInterface
    interface Writer {
        void write(OutputStream out) throws Exception;
    }

    public static void main(final String[] args) throws Exception {
        final Map<String, List<String>> spec = OM.readValue(Path.of(args[0]).toFile(),
                new tools.jackson.core.type.TypeReference<Map<String, List<String>>>() { });
        final JsonNode battles = OM.readTree(Path.of(args[1]).toFile());
        final Map<String, Object> batches = new LinkedHashMap<>();
        for (final Map.Entry<String, List<String>> e : spec.entrySet()) {
            batches.put(e.getKey(), runBatch(e.getValue(), battles, null));
            if (e.getKey().startsWith("league:")) {
                // 战队名称覆盖变体：单场 {arenaId}:1 + 批次 teamKey（取第一个战队汇总）
                final ProcessedDataset ds = finalize(e.getValue(), battles);
                final Map<String, Object> battleNames = new LinkedHashMap<>();
                battleNames.put(ds.battles().getFirst().arenaId + ":1", "自定义单场队");
                final Map<String, Object> summaryNames = new LinkedHashMap<>();
                summaryNames.put(ds.league().teamSummaries().getFirst().teamKey(), "自定义汇总队");
                final Map<String, Object> teamNames = new LinkedHashMap<>();
                teamNames.put("battle", battleNames);
                teamNames.put("summary", summaryNames);
                final Map<String, Object> variant = runBatch(e.getValue(), battles, teamNames);
                variant.put("teamNames", teamNames);
                batches.put(e.getKey() + "#teamNames", variant);
            }
        }
        final Map<String, Object> out = new LinkedHashMap<>();
        out.put("timeZone", java.util.TimeZone.getDefault().getID());
        out.put("styles", STYLES);
        out.put("workbooks", WORKBOOKS);
        out.put("batches", batches);
        OM.writeValue(Path.of(args[2]).toFile(), out);
        System.out.println("java export: " + batches.size() + " batches, " + WORKBOOKS.size()
                + " distinct workbooks, " + STYLES.size() + " styles -> " + args[2]);
    }

    private static String fileName(final String path) {
        return path.substring(path.lastIndexOf('/') + 1);
    }

    private static ProcessedDataset finalize(final List<String> paths, final JsonNode battles) throws Exception {
        final List<Replays.ParsedEntry> entries = new ArrayList<>();
        for (int i = 0; i < paths.size(); i++) {
            final String name = fileName(paths.get(i));
            final JsonNode node = battles.get(name);
            if (node.has("error")) {
                final String msg = node.get("error").asString()
                        .replaceFirst("^[\\w$.]+(?:Exception|Error|Throwable): ", "");
                entries.add(new Replays.ParsedEntry(i, name, null, msg));
            } else {
                entries.add(new Replays.ParsedEntry(i, name, OM.treeToValue(node, Battle.class), null));
            }
        }
        return ReplayBatchFinalizer.finalizeBatch(entries, null, null);
    }

    private static Map<String, Object> runBatch(final List<String> paths, final JsonNode battles,
                                                final Map<String, Object> teamNames) throws Exception {
        final Map<String, Object> res = new LinkedHashMap<>();
        @SuppressWarnings("unchecked")
        final Map<String, String> battleNames = teamNames == null ? Map.of()
                : (Map<String, String>) (Map<?, ?>) teamNames.get("battle");
        @SuppressWarnings("unchecked")
        final Map<String, String> summaryNames = teamNames == null ? Map.of()
                : (Map<String, String>) (Map<?, ?>) teamNames.get("summary");

        // ---- mode=aggregate（ReplayExportJobService.processAggregateFromResult）----
        {
            final ProcessedDataset ds = finalize(paths, battles);
            final List<Battle> bs = ds.battles();
            final String filename = bs.size() == 1
                    ? stripExt(ds.battleSourceNames().getFirst()) + ".xlsx"
                    : (ds.isLeague() ? "联赛汇总.xlsx" : "回放汇总.xlsx");
            final Writer w;
            if (ds.isLeague()) {
                if (bs.size() == 1) {
                    final LeagueRatingResult single = ds.league().resultFor(bs.getFirst().arenaId);
                    w = single != null
                            ? out -> ExcelExporter.writeSingleLeague(bs.getFirst(), single, TP, battleNames, out)
                            : out -> ExcelExporter.writeSingle(bs.getFirst(), TP, out);
                } else {
                    w = out -> ExcelExporter.writeAggregateLeague(bs, ds.battleSourceNames(), ds.duplicates(),
                            ds.league(), TP, battleNames, summaryNames, out);
                }
            } else if (bs.size() == 1) {
                w = out -> ExcelExporter.writeSingle(bs.getFirst(), TP, out);
            } else {
                w = out -> ExcelExporter.writeAggregate(bs, ds.battleSourceNames(), ds.duplicates(), TP, out);
            }
            final Map<String, Object> agg = new LinkedHashMap<>();
            agg.put("filename", filename);
            agg.put("workbook", workbookId(w));
            res.put("aggregate", agg);
        }

        // ---- mode=each（ReplayExportJobService.processEachFromResult）----
        {
            final ProcessedDataset ds = finalize(paths, battles);
            final Set<String> used = new HashSet<>();
            final List<Object> entries = new ArrayList<>();
            for (int i = 0; i < ds.battles().size(); i++) {
                final Battle b = ds.battles().get(i);
                final LeagueRatingResult lr = ds.isLeague() ? ds.league().resultFor(b.arenaId) : null;
                final String name = uniqueName(stripExt(ds.battleSourceNames().get(i)) + ".xlsx", used);
                final Writer w = lr != null
                        ? out -> ExcelExporter.writeSingleLeague(b, lr, TP, battleNames, out)
                        : out -> ExcelExporter.writeSingle(b, TP, out);
                final Map<String, Object> entry = new LinkedHashMap<>();
                entry.put("name", name);
                entry.put("workbook", workbookId(w));
                entries.add(entry);
            }
            final Map<String, Object> each = new LinkedHashMap<>();
            each.put("filename", "逐场导出.zip");
            each.put("entries", entries);
            res.put("each", each);
        }
        return res;
    }

    private static String stripExt(final String name) {
        final int dot = name.lastIndexOf('.');
        return dot > 0 ? name.substring(0, dot) : name;
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

    // ---------------- 归一化（规则与 frontend/src/replay-local/export/normalize.ts 一致）----------------

    private static String workbookId(final Writer w) throws Exception {
        final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        w.write(bytes);
        final Object wb;
        try (XSSFWorkbook book = new XSSFWorkbook(new ByteArrayInputStream(bytes.toByteArray()))) {
            wb = normalize(book);
        }
        final String key = OM.writeValueAsString(wb);
        return WB_IDS.computeIfAbsent(key, k -> {
            final String id = "wb" + WORKBOOKS.size();
            WORKBOOKS.put(id, wb);
            return id;
        });
    }

    private static Object normalize(final XSSFWorkbook book) {
        final Map<String, Object> wb = new LinkedHashMap<>();
        wb.put("activeTab", book.getActiveSheetIndex());
        final List<Object> sheets = new ArrayList<>();
        for (int s = 0; s < book.getNumberOfSheets(); s++) {
            sheets.add(sheet(book.getSheetAt(s)));
        }
        wb.put("sheets", sheets);
        return wb;
    }

    private static Object sheet(final XSSFSheet ws) {
        final Map<String, Object> out = new LinkedHashMap<>();
        out.put("name", ws.getSheetName());
        final Map<String, Object> cols = new TreeMap<>((a, b) -> Integer.compare(Integer.parseInt(a), Integer.parseInt(b)));
        for (final CTCols cs : ws.getCTWorksheet().getColsArray()) {
            for (final CTCol c : cs.getColArray()) {
                if (!c.isSetWidth()) {
                    continue;
                }
                for (long i = c.getMin(); i <= c.getMax(); i++) {
                    cols.put(String.valueOf(i - 1), c.getWidth());
                }
            }
        }
        out.put("cols", cols);
        List<Integer> freeze = null;
        if (ws.getCTWorksheet().isSetSheetViews() && ws.getCTWorksheet().getSheetViews().sizeOfSheetViewArray() > 0) {
            final CTPane pane = ws.getCTWorksheet().getSheetViews().getSheetViewArray(0).getPane();
            if (pane != null && "frozen".equals(String.valueOf(pane.getState()))) {
                freeze = List.of((int) pane.getXSplit(), (int) pane.getYSplit());
            }
        }
        out.put("freeze", freeze);
        out.put("autoFilter", ws.getCTWorksheet().isSetAutoFilter() ? ws.getCTWorksheet().getAutoFilter().getRef() : null);
        final List<String> merges = new ArrayList<>();
        for (final CellRangeAddress r : ws.getMergedRegions()) {
            merges.add(r.formatAsString());
        }
        out.put("merges", merges);
        final List<Object> rows = new ArrayList<>();
        for (int r = 0; r <= ws.getLastRowNum(); r++) {
            final Row row = ws.getRow(r);
            if (row == null || row.getLastCellNum() < 0) {
                rows.add(null);
                continue;
            }
            final List<Object> cells = new ArrayList<>();
            for (int c = 0; c < row.getLastCellNum(); c++) {
                final Cell cell = row.getCell(c);
                cells.add(cell == null ? null : List.of(value(cell), styleIndex((XSSFCellStyle) cell.getCellStyle())));
            }
            rows.add(cells);
        }
        while (!rows.isEmpty() && rows.getLast() == null) {
            rows.removeLast();
        }
        out.put("rows", rows);
        return out;
    }

    private static Object value(final Cell cell) {
        return switch (cell.getCellType()) {
            case NUMERIC -> cell.getNumericCellValue();
            case STRING -> cell.getStringCellValue();
            case BOOLEAN -> cell.getBooleanCellValue();
            case FORMULA -> Map.of("f", cell.getCellFormula());
            default -> Map.of("blank", true);
        };
    }

    private static int styleIndex(final XSSFCellStyle st) {
        final StringBuilder sb = new StringBuilder();
        final XSSFFont f = st.getFont();
        sb.append("b=").append(f.getBold() ? 1 : 0);
        sb.append(";sz=").append(f.getFontHeightInPoints());
        sb.append(";fc=").append(color(f.getXSSFColor()));
        sb.append(";fill=");
        if (st.getFillPattern() == FillPatternType.SOLID_FOREGROUND) {
            sb.append("solid:").append(color(st.getFillForegroundXSSFColor()));
        } else if (st.getFillPattern() == FillPatternType.NO_FILL) {
            sb.append("none");
        } else {
            sb.append(st.getFillPattern().name());
        }
        final HorizontalAlignment h = st.getAlignment();
        sb.append(";h=").append(h == HorizontalAlignment.GENERAL ? "" : h.name().toLowerCase());
        sb.append(";bd=").append(border(st.getBorderTop())).append(',').append(border(st.getBorderBottom()))
                .append(',').append(border(st.getBorderLeft())).append(',').append(border(st.getBorderRight()));
        sb.append(";fmt=").append(st.getDataFormatString());
        final String key = sb.toString();
        int idx = STYLES.indexOf(key);
        if (idx < 0) {
            STYLES.add(key);
            idx = STYLES.size() - 1;
        }
        return idx;
    }

    private static String border(final BorderStyle b) {
        return b == BorderStyle.NONE ? "" : b.name().toLowerCase();
    }

    /** 颜色：indexed → idx:n；rgb → 6 位大写 hex（去 alpha）；theme/auto/无 → 空。 */
    private static String color(final XSSFColor c) {
        if (c == null) {
            return "";
        }
        if (c.isIndexed() && c.getCTColor().isSetIndexed()) {
            // POI 默认字体（font 0）带 indexed=8（BLACK），exceljs 默认字体为 theme=1（同为黑色文本）：
            // 视觉等价，归一化为「未显式设色」
            return c.getIndexed() == 8 ? "" : "idx:" + c.getIndexed();
        }
        if (c.getCTColor().isSetRgb()) {
            final String hex = c.getARGBHex();
            return hex == null ? "" : hex.substring(hex.length() - 6).toUpperCase();
        }
        return "";
    }
}
