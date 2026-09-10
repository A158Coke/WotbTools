package com.wotb.web.replay.service;

import com.wotb.core.ref.Tankopedia;
import com.wotb.web.replay.dto.ColumnDef;
import com.wotb.web.replay.mapper.Mapper;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

/**
 * 回放业务只读入口（V2 收口）：同步 full processing（preview/export）
 * 已随 Replay Processing V2 废弃（HTTP 层稳定 410 {@code REPLAY_LEGACY_DEPRECATED}）；
 * 本服务只保留列定义与健康检查元数据。解析/导出全走 Processing Job +
 * {@link com.wotb.web.replay.job.ReplayParseScheduler} 权威路径，不存在第二套
 * ReplayCapacityLimiter 并行处理同一产品域。
 */
@Service
public class ReplayService {

    /** Processing/Export Job 共用输入数量上限（V2 契约）。 */
    public static final int MAX_REPLAY_FILES = 100;

    private final Tankopedia tankopedia = Tankopedia.load();

    /** 列定义（前端构建表头/列选择/排序）。 */
    public Map<String, List<ColumnDef>> columns() {
        return Map.of(
                "player", Mapper.playerColumns(),
                "aggregate", Mapper.aggregateColumns());
    }

    /** 已加载车辆数（健康检查用）。 */
    public int tankCount() {
        return tankopedia.size();
    }
}
