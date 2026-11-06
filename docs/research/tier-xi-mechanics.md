# XI 机制展示字段核对

## 来源与边界

源客户端为 `11.4.0.130_7400742 11.22_supertest_tier11_5 WOTB_Win7`，
公开包为 `https://cdn.static.wotb.app/win7/WotBlitz_11.4.0.130_t11p2.zip`。
仅以 HTTP Range 提取 `app/wotblitz.exe`，静态读取 PE32 x86 指令，没有运行游戏可执行文件。
解压后文件大小为 75,305,984 字节，SHA-256 为
`eeff84123d6084c72a582ef770a92d87ec208146ecaecf48d5289c26e15fcc3e`。
下列地址均为该文件、ImageBase `0x400000` 下的 VA；不适用于任意其他客户端版本。

XML 原值及车辆绑定保存在
`frontend/src/replay-local/compute/__fixtures__/upgrades/mechanics.json`，其中记录源 XML 的哈希。
可用 PE 解析器将 `VA - ImageBase` 转为文件偏移，再用 x86 反汇编器复核下列区间。
这里核对的是客户端配置解析与升级应用的数据流，不能据此宣称已经验证服务器战斗行为。

## Hacker：命中触发条件

- 字符串 `SAS_ALLOW_ACTIVATE_ON_HIT` 位于 `0x380691c`；
  `0x428100–0x42810f` 将它注册到标识 `0x47c97ac`。
- XML 参数名 `activateWithoutDamage` 位于 `0x3802850`。
  `0x7c53bb–0x7c5409` 比较参数名；匹配分支在 `0x7c540e` 解析布尔值，
  `0x7c5416` 取得机制对象，`0x7c5419` 执行 `mov byte ptr [ecx + 0x10], al`。
- 升级函数 `0x1abce90` 在 `0x1abcf93` 查询标识 `0x47c97ac`，
  布尔分支在 `0x1abcfb2` 读取 `[esi + 0x10]`，调用 `0x1822c00`，
  并在 `0x1abcfc4` 写回同一布尔字段。

参数解析与对应升级作用于同一机制字段 `+0x10`，因此展示映射为
`provisions / steadyAimSystem / activateWithoutDamage`。
同版原值是 `false`，节点 23 为布尔 `true`；节点 22/24 不改该字段。
语言表 `Strings/en.yaml` 的 `tank_descr_param_steadyAimSystem_activateWithoutDamage`
把 `false` 标为 `On damage`、`true` 标为 `On hit`；含义是自己的射击造成伤害或命中，
不是自身受击。展示分别使用「造成伤害」「命中」。

## BZ-79：加热时长

- 字符串 `RECHARGEABLE_NITRO_HEATING_DURATION` 位于 `0x3806b28`；
  `0x4280c0–0x4280cf` 将它注册到标识 `0x47c97c0`。
- XML 参数名 `duration` 位于 `0x3802670`。
  Nitro 参数解析分支 `0x7c48d1–0x7c4923` 比较该名字，`0x7c492c` 解析浮点值，
  `0x7c493f` 执行 `movss dword ptr [eax + 0x14], xmm0`。
- 升级函数 `0x1abcb70` 在 `0x1abcb7a` 查询标识 `0x47c97c0`；
  相加分支从 `0x1abcbb1` 读取 `[esi + 0x14]`，调用 `0x1816330`，
  `0x1abcbc9` 用 `fstp dword ptr [esi + 0x14]` 写回。
  相邻的 `coolingDuration` 解析写入 `+0x18`，不能混作加热时长。

两条路径均作用于 `+0x14`，因此展示映射为
`consumables / rechargeableNitro / duration`。同版原值为 8，节点 22 的
`MODIFIER_ADD` 值为 5，结果为 13 秒。语言表中的
`tank_descr_param_rechargeableNitro_duration` 明确指热量从 0% 到 100% 所需时间。

## 消费约束

前端只在车辆 `vehicleAbilities` 显式绑定该机制，且对应物品目录版本等于车辆版本时计算前后值。
初始态保持基础值；切到其他互斥选项后取消该项加成；缺绑定、跨版或缺参数时保持未知值。
这些字段不写入车辆静态属性，相关单测同时比较切换机制前后的静态投影保持不变。
