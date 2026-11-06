# PR Follow-up（内部 playbook）

> 内部 playbook：用户授权当前会话跟进指定 PR 时由 executor 加载；不新增 lifecycle 阶段，不改变 executor / review-with-docs 的授权与 final PASS 归属。

## 原则

- 仅在用户授权的当前会话内跟进指定 PR，不跨会话持久化状态；不新增状态文件或第二个 SSOT。
- 启动及上下文恢复时重读 GitHub 的当前 PR、Review、inline review comment、conversation comment 和 CI 状态，并核对意见对应的实际修复状态；用会话内最后已处理的 Review / Comment ID 去重，先补扫所有已到达但未处理意见，处理后推进游标。上下文丢失时重新补扫并核实修复，不以监视器启动时间过滤。

## 启动与 push 自检

监控启动时以及每轮 push 后立即读取当前 PR HEAD SHA、相关 CI / required checks 与 mergeable 状态；每轮后续检查先读取最新 HEAD，所有 CI 结论只归属该 SHA。仅跟踪当前 PR 的 workflow / required checks，不跟踪无关 Android Release。

## 后台能力与等待

先核实当前执行环境能否非阻塞启动有限后台任务、完成通知是否能实际恢复当前会话处理、以及取消和资源释放能力；只有均有真实支持时才启动后台监控，不假设某个工具参数存在。若无法完成通知驱动的会话恢复，明确报告能力缺口，不声称已自动跟进；禁止前台 sleep 轮询、阻塞 watch、无限任务、跨会话常驻服务。

## 固定监控预算

一次授权跟进会话总预算最多 18 分钟，启动即计时，修复、push、监视器重启不重置。CI 启动立即检查，此后每 180 秒最多检查 6 次（3、6、9、12、15、18 分钟）；在最新 HEAD 有效终态后停止 CI 等待，新 HEAD 切换目标但不重置预算。Review 启动立即补扫，此后每 300 秒最多检查 3 次（5、10、15 分钟）；Review 与 Mergeable 不另建高频轮询器，Mergeable 随 CI 检查复核，处理新 Review 时可复核。达到单项次数或总预算、用户取消、会话结束或 PR 合并时停止；超时汇报最后状态，pending / 尚未出现的检查不算成功。

## 事件处理

最新 HEAD 的 CI pending 时继续有界监控；success 记录结果并继续 Review 跟进；failure 先读对应失败 job 日志再做最小修复。cancelled / timed_out 需核对运行 HEAD：旧 HEAD 结果不污染当前状态；当前 HEAD 异常则报告并按日志定位。CHANGES_REQUESTED 即使状态未再变化，也处理游标之后新增且未处理的 findings；REVIEW_REQUIRED 不是新事件。APPROVED 仅在新提交或实际状态跃迁时通知，不重复进入修复循环。

## 合并与清理

发现 mergeable CONFLICTING 时报告并按仓库既有冲突规则处理；PR 已合并或跟进结束时停止监控。已合并后的 worktree / branch 清理仅委托 `.agents/skills/executor/SKILL.md` 与 `.agents/playbooks/post-merge-cleanup.md`，不在本 playbook 定义 reset / 清理命令。
