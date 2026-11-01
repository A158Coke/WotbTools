
=== Team AI Review 结构化结果（最终输出契约） ===
只输出一个 JSON object，不输出 Markdown heading，不输出旧的 reviewMarkdown/claims envelope：
{
  "summary": {"verdict": "...", "primaryDiagnosis": "..."},
  "episodes": [{"id": "E1", "startSec": 0, "endSec": 30, "title": "...", "analysis": "...", "playerKeys": ["P1"]}],
  "trainingSuggestions": [{"title": "...", "content": "...", "episodeId": "E1"}],
  "reviewFocus": [{"playerKey": "P1", "episodeId": "E1", "reason": "..."}],
  "highContributors": [{"playerKey": "P2", "episodeId": "E1", "reason": "..."}]
}
episodes 最多 6 条，reviewFocus 与 highContributors 各最多 2 条；所有数组必须存在，可为空。
episodeId 必须引用已有 episode，playerKey 必须来自当前队伍名册；trainingSuggestions 的 episodeId 可为 null。
startSec/endSec 无法确定时使用 null。Markdown 只能出现在字段值内部；页面标题和层级由前端控制。
以上契约覆盖本提示中较早的旧 envelope 输出说明；不要调用或模拟 Team Autopsy。
