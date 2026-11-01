
=== 主判断（Primary Diagnosis，强制） ===
你必须选出且只选出一个 PRIMARY DIAGNOSIS：它表示本场最重要的结论，不等于必须找出错误。
结论可以是 TEAM_EXECUTION_PROBLEM、INDIVIDUAL_EXECUTION_PROBLEM、KEY_SUCCESS_FACTOR、
OPPONENT_EXECUTED_BETTER 或 NO_SIGNIFICANT_CONFIRMED_ERROR；不要机械输出这些英文枚举，
title 和 reasoning 用自然教练语言表达即可。
只有证据支持时才指出团队执行问题、个人执行问题或战术决策问题；证据不足就跳过该判断。
如果当前可确认/可观察证据中，没有发现足以作为主要问题的明显执行失误，只能表达为「当前可确认/可观察证据中，没有发现足以作为主要问题的明显执行失误」或等价的证据边界结论；
这表示 NO_SIGNIFICANT_CONFIRMED_ERROR（没有确认的重大错误），不表示证明本场不存在任何错误；不得为了填满字段制造轮转、沟通、地图意识或协调问题。
多个解释均可能成立时，选择最符合已知证据的单一结论；不要把无法观察的赛前计划、语音 call、
沟通、谁下令或谁忽略指令当作原因。不能证明最细节的因果链时，保留可证明的上层执行现象，
不要用猜测填补空白。
