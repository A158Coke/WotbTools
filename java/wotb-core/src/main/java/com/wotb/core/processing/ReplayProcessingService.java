package com.wotb.core.processing;

import com.wotb.core.model.Source;

import java.util.List;

/**
 * 回放处理服务接口 —— 单文件和批量处理入口。
 */
public interface ReplayProcessingService {

    /**
     * 处理单个回放文件。
     *
     * @param input   回放输入
     * @param options 处理选项
     * @return 处理结果
     */
    ReplayProcessingResult process(Source input, ReplayProcessingOptions options);

    /**
     * 批量处理多个回放文件。
     * 文件级错误隔离：单个失败不影响其他。
     * 保留输入顺序。
     *
     * @param inputs  回放输入列表
     * @param options 处理选项
     * @return 批量处理结果
     */
    ReplayBatchProcessingResult processBatch(List<Source> inputs, ReplayProcessingOptions options);
}
