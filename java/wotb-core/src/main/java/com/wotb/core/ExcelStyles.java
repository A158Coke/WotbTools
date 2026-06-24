package com.wotb.core;

import org.apache.poi.ss.usermodel.BorderStyle;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.FillPatternType;
import org.apache.poi.ss.usermodel.Font;
import org.apache.poi.ss.usermodel.HorizontalAlignment;
import org.apache.poi.ss.usermodel.IndexedColors;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFCellStyle;
import org.apache.poi.xssf.usermodel.XSSFColor;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

import java.io.IOException;
import java.io.OutputStream;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * xlsx 渲染底座 (POI): 持有 Workbook 与预建样式, 提供写表头/写单元格等底层写格方法,
 * 以及值格式化静态助手 (日期/时长/小数/十六进制)。不关心具体业务表结构。
 */
final class ExcelStyles {

    static final DateTimeFormatter DT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    static final DateTimeFormatter DT_MIN = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

    private final Workbook wb;
    private final CellStyle hdr;
    private final CellStyle team1;
    private final CellStyle team2;
    private final CellStyle plain;

    /** 按需组合 "填充 + 对齐" 的样式缓存。 */
    private final Map<String, CellStyle> styleCache = new HashMap<>();

    ExcelStyles() {
        wb = new XSSFWorkbook();
        final Font hf = wb.createFont();
        hf.setBold(true);
        hf.setColor(IndexedColors.WHITE.getIndex());
        hdr = base();
        hdr.setFont(hf);
        hdr.setFillForegroundColor(IndexedColors.DARK_BLUE.getIndex());
        hdr.setFillPattern(FillPatternType.SOLID_FOREGROUND);
        hdr.setAlignment(HorizontalAlignment.CENTER);
        final CellStyle center = base();
        center.setAlignment(HorizontalAlignment.CENTER);
        plain = base();
        team1 = base();
        tint(team1, (byte) 0xDD, (byte) 0xEB, (byte) 0xF7);
        team2 = base();
        tint(team2, (byte) 0xFC, (byte) 0xE4, (byte) 0xD6);
    }

    Workbook workbook() {
        return wb;
    }

    CellStyle hdr() {
        return hdr;
    }

    CellStyle team1() {
        return team1;
    }

    CellStyle team2() {
        return team2;
    }

    CellStyle plain() {
        return plain;
    }

    /** 写出并关闭工作簿。 */
    void writeTo(final OutputStream out) throws IOException {
        wb.write(out);
        wb.close();
    }

    private CellStyle base() {
        final CellStyle s = wb.createCellStyle();
        s.setBorderTop(BorderStyle.THIN);
        s.setBorderBottom(BorderStyle.THIN);
        s.setBorderLeft(BorderStyle.THIN);
        s.setBorderRight(BorderStyle.THIN);
        return s;
    }

    private void tint(final CellStyle s, final byte r, final byte g, final byte b) {
        ((XSSFCellStyle) s).setFillForegroundColor(new XSSFColor(new byte[]{r, g, b}, null));
        s.setFillPattern(FillPatternType.SOLID_FOREGROUND);
    }

    void writeHeader(final Sheet ws, final List<String[]> titleWidth) {
        final Row h = ws.createRow(0);
        for (int c = 0; c < titleWidth.size(); c++) {
            final String title = titleWidth.get(c)[0];
            int width = Integer.parseInt(titleWidth.get(c)[1]);
            width = Math.max(width, Columns.displayWidth(title) + 4); // 防止被自动筛选箭头截断
            cell(h, c, title, hdr);
            ws.setColumnWidth(c, width * 256);
        }
    }

    void setCell(final Cell cell, final Object val, final CellStyle fill, final String key) {
        if (val instanceof Number) {
            cell.setCellValue(((Number) val).doubleValue());
        } else {
            cell.setCellValue(val == null ? "" : val.toString());
        }
        // 复制填充样式 + 对齐 (POI 样式不可变, 这里用预建样式即可满足主要需求)
        cell.setCellStyle(Columns.LEFT_ALIGN.contains(key) ? leftWithFill(fill) : centerWithFill(fill));
    }

    void cell(final Row row, final int c, final String text, final CellStyle style) {
        final Cell cell = row.createCell(c);
        cell.setCellValue(text);
        cell.setCellStyle(style);
    }

    private CellStyle centerWithFill(final CellStyle fill) {
        return combo(fill, true);
    }

    private CellStyle leftWithFill(final CellStyle fill) {
        return combo(fill, false);
    }

    private CellStyle combo(final CellStyle fill, final boolean center) {
        final String key = System.identityHashCode(fill) + (center ? "C" : "L");
        return styleCache.computeIfAbsent(key, k -> {
            final CellStyle s = wb.createCellStyle();
            s.cloneStyleFrom(fill);
            s.setAlignment(center ? HorizontalAlignment.CENTER : HorizontalAlignment.LEFT);
            return s;
        });
    }

    // ---------------- 值格式化 ----------------
    static String fmt(final Long epochSec, final DateTimeFormatter f) {
        if (epochSec == null) {
            return "";
        }
        return Instant.ofEpochSecond(epochSec).atZone(ZoneId.systemDefault()).format(f);
    }

    static String duration(final Double s) {
        if (s == null) {
            return "";
        }
        final int t = (int) Math.floor(s);
        return (t / 60) + "分" + (t % 60) + "秒";
    }

    static double r1(final double v) {
        return Math.round(v * 10) / 10.0;
    }

    static double r2(final double v) {
        return Math.round(v * 100) / 100.0;
    }

    static String toHex(final byte[] b) {
        final StringBuilder sb = new StringBuilder();
        for (final byte x : b) {
            sb.append(String.format("%02x", x));
        }
        return sb.toString();
    }
}
