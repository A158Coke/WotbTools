# Tier X Inventory（Tankopedia 权威，84 辆 → 81 baseModelKey）

> 由 `node frontend/scripts/blitzkit-references.mjs --emit-docs` 从
> `common/tankopedia-tier10.json` + `frontend/src/vehicle-models/mapping.js` 生成；
> 覆盖完整性由 CI（coverage.test.js）强制。

## kind 核验（2026-08-17，全 81 modelKey 逐组核验）

> 依据：官方 tankopedia 描述 / fandom wiki / 车辆实际俯视结构知识；
> 不采用 BlitzKit TURRET module 或 turretRotationSpeed 字段（casemate 也有 turret module 且转速非零，不可判）。
> 修正记录：minotauro → turreted（有炮塔 45° 限位）；foch-155 → turretless（fandom specs turret=no）；
> xm66f → turreted（官方：non-fully-rotating turret）。
> **confirmPending 已全部清零（2026-08-19）**：spht / ac-teichos / nc-70-blyskawica
> 均经 BlitzKit 真实模型数据确认 kind（GLB 节点结构 + models.pb turret yaw 限位），contract 冻结；
> 三车已生成正式资产，turretPivot 通过 yaw0/90 几何反推验证（err=0.0000m）。

## 按 baseModelKey 分组

| modelKey | kind | confirmPending | tankId | display name | class | nation | kind 核验依据 | BlitzKit 参考 |
|---|---|---|---|---|---|---|---|---|
| progetto-65 | turreted | — | 385 | Progetto 65 | Medium tank | European | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/385/icons/big.webp) · [page](https://blitzkit.app/tanks/progetto-65) |
| bc-25-t | turreted | — | 3649 | B-C 25 t | Light tank | France | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/3649/icons/big.webp) · [page](https://blitzkit.app/tanks/b-c-25-t) |
| stb-1 | turreted | — | 3681 | STB-1 | Medium tank | Japan | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/3681/icons/big.webp) · [page](https://blitzkit.app/tanks/stb-1) |
| ho-ri | turretless | — | 3937 | Ho-Ri | Tank destroyer | Japan | fandom：无炮塔，仅 14° 总射界（casemate） | [icon](https://api.blitzkit.app/tanks/3937/icons/big.webp) · [page](https://blitzkit.app/tanks/ho-ri) |
| wz-121 | turreted | — | 4145 | WZ-121 | Medium tank | China | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/4145/icons/big.webp) · [page](https://blitzkit.app/tanks/wz-121) |
| amx-m4-mle-54 | turreted | — | 4417 | AMX M4 mle. 54 | Heavy tank | France | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/4417/icons/big.webp) · [page](https://blitzkit.app/tanks/amx-m4-mle-54) |
| kranvagn | turreted | — | 4481 | Kranvagn | Heavy tank | European | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/4481/icons/big.webp) · [page](https://blitzkit.app/tanks/kranvagn) |
| wz-113 | turreted | — | 5425 | WZ-113 | Heavy tank | China | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/5425/icons/big.webp) · [page](https://blitzkit.app/tanks/wz-113) |
| tvp-t-50-51 | turreted | — | 5505 | TVP T 50/51 | Medium tank | European | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/5505/icons/big.webp) · [page](https://blitzkit.app/tanks/tvp-t-50-51) |
| 121b | turreted | — | 5681 | 121B | Medium tank | China | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/5681/icons/big.webp) · [page](https://blitzkit.app/tanks/121b) |
| is-4 | turreted | — | 6145 | IS-4 | Heavy tank | USSR | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/6145/icons/big.webp) · [page](https://blitzkit.app/tanks/is-4) |
| amx-50-b | turreted | — | 6209 | AMX 50 B | Heavy tank | France | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/6209/icons/big.webp) · [page](https://blitzkit.app/tanks/amx-50-b) |
| fv215b | turreted | — | 6225 | FV215b | Heavy tank | UK | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/6225/icons/big.webp) · [page](https://blitzkit.app/tanks/fv215b) |
| wz-113g-ft | turretless | — | 6449 | WZ-113G FT | Tank destroyer | China | casemate 固定战斗室 TD（结构知识） | [icon](https://api.blitzkit.app/tanks/6449/icons/big.webp) · [page](https://blitzkit.app/tanks/wz-113g-ft) |
| type-71 | turreted | — | 6753 | Type 71 | Heavy tank | Japan | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/6753/icons/big.webp) · [page](https://blitzkit.app/tanks/type-71) |
| maus | turreted | — | 6929 | Maus | Heavy tank | Germany | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/6929/icons/big.webp) · [page](https://blitzkit.app/tanks/maus) |
| is-7 | turreted | — | 7169 | IS-7 | Heavy tank | USSR | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/7169/icons/big.webp) · [page](https://blitzkit.app/tanks/is-7) |
| fv4202 | turreted | — | 7249 | FV4202 | Medium tank | UK | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/7249/icons/big.webp) · [page](https://blitzkit.app/tanks/fv4202) |
| 60tp-lewandowskiego | turreted | — | 7297 | 60TP Lewandowskiego | Heavy tank | European | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/7297/icons/big.webp) · [page](https://blitzkit.app/tanks/60tp-lewandowskiego) |
| type-5-heavy | turreted | — | 8033 | Type 5 Heavy | Heavy tank | Japan | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/8033/icons/big.webp) · [page](https://blitzkit.app/tanks/type-5-heavy) |
| type-5-heavy | turreted | — | 9057 | Type 5 H Zetsu | Heavy tank | Japan | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/9057/icons/big.webp) · [page](https://blitzkit.app/tanks/type-5-h-zetsu) |
| wz-111-5a | turreted | — | 8497 | WZ-111 5A | Heavy tank | China | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/8497/icons/big.webp) · [page](https://blitzkit.app/tanks/wz-111-5a) |
| amx-30-b | turreted | — | 8513 | AMX 30 B | Medium tank | France | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/8513/icons/big.webp) · [page](https://blitzkit.app/tanks/amx-30-b) |
| fv215b-183 | turreted | — | 9297 | FV215b 183 | Tank destroyer | UK | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/9297/icons/big.webp) · [page](https://blitzkit.app/tanks/fv215b-183) |
| e-100 | turreted | — | 9489 | E 100 | Heavy tank | Germany | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/9489/icons/big.webp) · [page](https://blitzkit.app/tanks/e-100) |
| carro-45t | turreted | — | 10113 | Carro 45t | Medium tank | European | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/10113/icons/big.webp) · [page](https://blitzkit.app/tanks/carro-45t) |
| wz-132-1 | turreted | — | 10289 | WZ-132-1 | Light tank | China | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/10289/icons/big.webp) · [page](https://blitzkit.app/tanks/wz-132-1) |
| minotauro | turreted | — | 10369 | Minotauro | Tank destroyer | European | fandom：有炮塔，约 45° 限位后置炮塔 | [icon](https://api.blitzkit.app/tanks/10369/icons/big.webp) · [page](https://blitzkit.app/tanks/minotauro) |
| t110e5 | turreted | — | 10785 | T110E5 | Heavy tank | USA | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/10785/icons/big.webp) · [page](https://blitzkit.app/tanks/t110e5) |
| 114-sp2 | turreted | — | 11057 | 114 SP2 | Heavy tank | China | 官方 tankopedia：360° 可旋转炮塔 | [icon](https://api.blitzkit.app/tanks/11057/icons/big.webp) · [page](https://blitzkit.app/tanks/114-sp2) |
| kpz-70 | turreted | — | 11281 | Kpz 70 | Heavy tank | Germany | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/11281/icons/big.webp) · [page](https://blitzkit.app/tanks/kpz-70) |
| kpz-70 | turreted | — | 30481 | Kpz 70 Missile | Heavy tank | Germany | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/30481/icons/big.webp) · [page](https://blitzkit.app/tanks/kpz-70-missile) |
| bz-75 | turreted | — | 11825 | BZ-75 | Heavy tank | China | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/11825/icons/big.webp) · [page](https://blitzkit.app/tanks/bz-75) |
| jgpz-e-100 | turretless | — | 12049 | Jg.Pz. E 100 | Tank destroyer | Germany | casemate 固定战斗室 TD（结构知识） | [icon](https://api.blitzkit.app/tanks/12049/icons/big.webp) · [page](https://blitzkit.app/tanks/jg-pz-e-100) |
| strv-k | turreted | — | 12161 | Strv K | Heavy tank | European | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/12161/icons/big.webp) · [page](https://blitzkit.app/tanks/strv-k) |
| e-50-m | turreted | — | 12305 | E 50 M | Medium tank | Germany | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/12305/icons/big.webp) · [page](https://blitzkit.app/tanks/e-50-m) |
| 116-f3 | turreted | — | 12849 | 116-F3 | Heavy tank | China | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/12849/icons/big.webp) · [page](https://blitzkit.app/tanks/116-f3) |
| t110e4 | turreted | — | 13089 | T110E4 | Tank destroyer | USA | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/13089/icons/big.webp) · [page](https://blitzkit.app/tanks/t110e4) |
| vz-55 | turreted | — | 13185 | Vz. 55 | Heavy tank | European | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/13185/icons/big.webp) · [page](https://blitzkit.app/tanks/vz-55) |
| obj-268 | turretless | — | 13569 | Obj. 268 | Tank destroyer | USSR | casemate 固定战斗室 TD（结构知识） | [icon](https://api.blitzkit.app/tanks/13569/icons/big.webp) · [page](https://blitzkit.app/tanks/obj-268) |
| t-62a | turreted | — | 13825 | T-62A | Medium tank | USSR | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/13825/icons/big.webp) · [page](https://blitzkit.app/tanks/t-62a) |
| t110e3 | turretless | — | 13857 | T110E3 | Tank destroyer | USA | casemate 固定战斗室 TD（结构知识） | [icon](https://api.blitzkit.app/tanks/13857/icons/big.webp) · [page](https://blitzkit.app/tanks/t110e3) |
| foch-155 | turretless | — | 13889 | Foch 155 | Tank destroyer | France | fandom specs turret=no（固定/微转前向炮塔） | [icon](https://api.blitzkit.app/tanks/13889/icons/big.webp) · [page](https://blitzkit.app/tanks/foch-155) |
| m48-patton | turreted | — | 14113 | M48 Patton | Medium tank | USA | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/14113/icons/big.webp) · [page](https://blitzkit.app/tanks/m48-patton) |
| bzt-70 | turreted | — | 14129 | BZT-70 | Heavy tank | China | 官方 news：turret 正面装甲描述（有炮塔） | [icon](https://api.blitzkit.app/tanks/14129/icons/big.webp) · [page](https://blitzkit.app/tanks/bzt-70) |
| obj-263 | turretless | — | 14337 | Obj. 263 | Tank destroyer | USSR | casemate 固定战斗室 TD（结构知识） | [icon](https://api.blitzkit.app/tanks/14337/icons/big.webp) · [page](https://blitzkit.app/tanks/obj-263) |
| leopard-1 | turreted | — | 14609 | Leopard 1 | Medium tank | Germany | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/14609/icons/big.webp) · [page](https://blitzkit.app/tanks/leopard-1) |
| t57-heavy | turreted | — | 14881 | T57 Heavy | Heavy tank | USA | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/14881/icons/big.webp) · [page](https://blitzkit.app/tanks/t57-heavy) |
| cs-63 | turreted | — | 14977 | CS-63 | Medium tank | European | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/14977/icons/big.webp) · [page](https://blitzkit.app/tanks/cs-63) |
| obj-907 | turreted | — | 15617 | Obj. 907 | Medium tank | USSR | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/15617/icons/big.webp) · [page](https://blitzkit.app/tanks/obj-907) |
| chieftain-mk-6 | turreted | — | 15697 | Chieftain Mk. 6 | Heavy tank | UK | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/15697/icons/big.webp) · [page](https://blitzkit.app/tanks/chieftain-mk-6) |
| m60 | turreted | — | 15905 | M60 | Medium tank | USA | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/15905/icons/big.webp) · [page](https://blitzkit.app/tanks/m60) |
| obj-140 | turreted | — | 16897 | Obj. 140 | Medium tank | USSR | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/16897/icons/big.webp) · [page](https://blitzkit.app/tanks/obj-140) |
| fv217-badger | turretless | — | 17745 | FV217 Badger | Tank destroyer | UK | casemate 固定战斗室 TD（结构知识） | [icon](https://api.blitzkit.app/tanks/17745/icons/big.webp) · [page](https://blitzkit.app/tanks/fv217-badger) |
| rinoceronte | turreted | — | 17793 | Rinoceronte | Heavy tank | European | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/17793/icons/big.webp) · [page](https://blitzkit.app/tanks/rinoceronte) |
| fv4005 | turreted | — | 18001 | FV4005 | Tank destroyer | UK | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/18001/icons/big.webp) · [page](https://blitzkit.app/tanks/fv4005) |
| lion | turreted | — | 18049 | Lion | Medium tank | European | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/18049/icons/big.webp) · [page](https://blitzkit.app/tanks/lion) |
| t95e6 | turreted | — | 18977 | T95E6 | Heavy tank | USA | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/18977/icons/big.webp) · [page](https://blitzkit.app/tanks/t95e6) |
| grille-15 | turreted | — | 19217 | Grille 15 | Tank destroyer | Germany | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/19217/icons/big.webp) · [page](https://blitzkit.app/tanks/grille-15) |
| super-conqueror | turreted | — | 19281 | Super Conqueror | Heavy tank | UK | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/19281/icons/big.webp) · [page](https://blitzkit.app/tanks/super-conqueror) |
| vickers-light | turreted | — | 19537 | Vickers Light | Light tank | UK | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/19537/icons/big.webp) · [page](https://blitzkit.app/tanks/vickers-light) |
| nc-70-blyskawica | turreted | — | 19585 | NC 70 Błyskawica | Tank destroyer | European | 2026-08-19 BlitzKit 数据确认：GLB turret_01 为 1-triangle stub（casemate 主体在 hull_nc_01，属 hull 层；旋转层实际 = gun_01 + gun_01_mask）、models.pb turret 模块 yaw ±10°（limited-traverse，同 grille-15）→ 确认 turreted | [icon](https://api.blitzkit.app/tanks/19585/icons/big.webp) · [page](https://blitzkit.app/tanks/nc-70-b-yskawica) |
| ac-atlas | turreted | — | 19825 | AC Atlas | Heavy tank | Other | fandom：炮塔正面坚不可摧 + Modules/Turret | [icon](https://api.blitzkit.app/tanks/19825/icons/big.webp) · [page](https://blitzkit.app/tanks/ac-atlas) |
| t-22-medium | turreted | — | 19969 | T-22 medium | Medium tank | USSR | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/19969/icons/big.webp) · [page](https://blitzkit.app/tanks/t-22-medium) |
| felice | turreted | — | 20097 | Felice | Heavy tank | European | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/20097/icons/big.webp) · [page](https://blitzkit.app/tanks/felice) |
| sheridan | turreted | — | 20257 | Sheridan | Light tank | USA | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/20257/icons/big.webp) · [page](https://blitzkit.app/tanks/sheridan) |
| sheridan | turreted | — | 21793 | Sheridan Missile | Light tank | USA | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/21793/icons/big.webp) · [page](https://blitzkit.app/tanks/sheridan-missile) |
| projet-murat | turreted | — | 21057 | Projet Murat | Medium tank | France | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/21057/icons/big.webp) · [page](https://blitzkit.app/tanks/projet-murat) |
| vk-90-01-p | turreted | — | 21777 | VK 90.01 (P) | Heavy tank | Germany | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/21777/icons/big.webp) · [page](https://blitzkit.app/tanks/vk-90-01-p) |
| ac-teichos | turreted | — | 22129 | AC Teichos | Medium tank | Other | 2026-08-19 BlitzKit 数据确认：GLB turret_01（631+1540 顶点）+ gun_01 + gun_01_mask、models.pb turret 模块无 yaw 限位 → 确认 turreted | [icon](https://api.blitzkit.app/tanks/22129/icons/big.webp) · [page](https://blitzkit.app/tanks/ac-teichos) |
| obj-260 | turreted | — | 22273 | Obj. 260 | Heavy tank | USSR | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/22273/icons/big.webp) · [page](https://blitzkit.app/tanks/obj-260) |
| m-vi-yoh | turreted | — | 22817 | M-VI-Yoh | Heavy tank | USA | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/22817/icons/big.webp) · [page](https://blitzkit.app/tanks/m-vi-yoh) |
| m47-chevalier | turreted | — | 23105 | M47 Chevalier | Medium tank | France | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/23105/icons/big.webp) · [page](https://blitzkit.app/tanks/m47-chevalier) |
| kpz-50-t | turreted | — | 23313 | Kpz 50 t | Medium tank | Germany | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/23313/icons/big.webp) · [page](https://blitzkit.app/tanks/kpz-50-t) |
| t-100-lt | turreted | — | 24321 | T-100 LT | Light tank | USSR | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/24321/icons/big.webp) · [page](https://blitzkit.app/tanks/t-100-lt) |
| object-268-4 | turretless | — | 24577 | Object 268/4 | Tank destroyer | USSR | casemate 固定战斗室 TD（结构知识） | [icon](https://api.blitzkit.app/tanks/24577/icons/big.webp) · [page](https://blitzkit.app/tanks/object-268-4) |
| concept-1b | turreted | — | 24609 | Concept 1B | Heavy tank | USA | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/24609/icons/big.webp) · [page](https://blitzkit.app/tanks/concept-1b) |
| gsor-the-tank | turreted | — | 25169 | GSOR the TANK | Heavy tank | UK | 官方 tankopedia：摇摆式炮塔 | [icon](https://api.blitzkit.app/tanks/25169/icons/big.webp) · [page](https://blitzkit.app/tanks/gsor-the-tank) |
| obj-777-ii | turreted | — | 25857 | Obj. 777 II | Heavy tank | USSR | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/25857/icons/big.webp) · [page](https://blitzkit.app/tanks/obj-777-ii) |
| rhm-pzw | turreted | — | 28689 | Rhm. Pzw. | Light tank | Germany | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/28689/icons/big.webp) · [page](https://blitzkit.app/tanks/rhm-pzw) |
| xm66f | turreted | — | 28705 | XM66F | Tank destroyer | USA | 官方 tankopedia：non-fully-rotating turret（前置炮塔） | [icon](https://api.blitzkit.app/tanks/28705/icons/big.webp) · [page](https://blitzkit.app/tanks/xm66f) |
| waffen-f1-0 | turreted | — | 28945 | Waffen F1.0 | Tank destroyer | Germany | fandom：huge turret + 极慢炮塔旋转 | [icon](https://api.blitzkit.app/tanks/28945/icons/big.webp) · [page](https://blitzkit.app/tanks/waffen-f1-0) |
| spht | turreted | — | 29985 | SPHT | Heavy tank | USA | 2026-08-19 BlitzKit 数据确认：GLB turret_01 + gun_01 + gun_01_mask、models.pb turret 模块无 yaw 限位 → 确认 turreted | [icon](https://api.blitzkit.app/tanks/29985/icons/big.webp) · [page](https://blitzkit.app/tanks/spht) |
| vk-72-01-k | turreted | — | 58641 | VK 72.01 K | Heavy tank | Germany | 标准可旋转炮塔（HT/MT/LT，结构知识核验） | [icon](https://api.blitzkit.app/tanks/58641/icons/big.webp) · [page](https://blitzkit.app/tanks/vk-72-01-k) |

## 统计

- Tankopedia Tier X 总数：84（meta.count=84，generated_at=2026-08-08T17:28:26.017337+00:00）
- baseModelKey 数：81
- turreted：72；turretless：9；confirmPending：0

