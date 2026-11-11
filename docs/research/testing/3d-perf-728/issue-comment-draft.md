# Issue #728 评论草稿（交用户发布，未发布）

Workstream B（地形 LOD 重建长帧）：

- 根因（GeckoView 模拟器已测，真机未验证）：相机随车移动时 `maybeRebuildTerrainLod` 在渲染帧里同步重建整张地形网格（约 15 万顶点），模拟器上单次 240–570 ms，>100 ms 帧 100% 落在重建帧。桌面 Chrome 在资产加载正常后同样复现（此前桌面「未复现」的结论因采集 URL 带空 `assets=` 作废）。
- 修复（草稿 PR）：重建移到 Worker，细分判据与阈值一个数都没改，几何与同步路径逐字节相等（自动化测试），网格晚约 0.07–0.14 s（桌面实测）换上；Worker 不可用时回退同步。`?perf` 的 `terrain-build` 事件新增 `mode` / `reason` / `queueMs` / `swapMs`。
- 桌面 After（1×）：>100 ms 帧 84–99 → 1（采集边界假象），>200 ms 帧窗口内为 0；6× 节流下重建造成的长帧消失，但 `render` 波动使 >100/>200 ms 帧数未全部达到预设阈值，详见研究报告。
- 未验证：GeckoView 模拟器 After（本机无法构建 APK）、真机（OnePlus Ace Pro）、换装延迟期间贴地薄构件的视觉。Issue 保持打开。
