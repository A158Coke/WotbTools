package com.wotb.core.model;

import java.util.ArrayList;
import java.util.List;

/** 多回放按 arenaUniqueId 去重后的结果。 */
public final class Collected {
    public final List<Battle> battles = new ArrayList<>();
    public final List<String> battleSourceNames = new ArrayList<>();  // 与 battles 对应的文件名
    public final List<String[]> duplicates = new ArrayList<>();       // [文件名, arenaId]
    public final List<String[]> failures = new ArrayList<>();         // [文件名, 错误]
}
