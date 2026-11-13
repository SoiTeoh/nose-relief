# 根治鼻炎通气大师（Nose Relief）— 项目状态

## 1. 项目定位

Idea Lab v2 — Project 05：基于 **Vite + TypeScript (strict) + Matter.js + 原生 HTML5 Canvas 2D + Web Audio API** 的搞笑解压物理小游戏（纯娱乐表达，无任何医疗功效宣称）。

## 2. 当前开发阶段

- **MVP 核心开发、v2 物理与蓄力修正及自动化验收已完成**（并已连接远程仓库 `https://github.com/SoiTeoh/nose-relief.git` 推送 `main` 分支封存）。

## 3. 已实现功能

- `src/config/tuning.ts`：集中管理 `390×640` 逻辑视口、`1000/60 ms` 固定步长、鼻腔左右通道几何尺寸、4 种堵塞物物理参数与分值、蓄力猛擤黄金区间（`0.55s~1.0s`）/过载（`1.5s`）、双孔贯通（`>=85%` / `3.5s`）与窒息（`<18%` / `4.5s`）阈值。
- `src/game/rules.ts`：纯 TypeScript 规则引擎（`computeAirflowPct`、`evaluateBlowStrength`、`stepReliefMatch`、`recordIrritantCleared`、`pickIrritantKindForWave`、`buildDiagnosisSummary`）。
- `src/game/world.ts`：Matter.js 刚体管道世界（`enableSleeping: false` 防卡死睡着、鼻中隔与鼻孔缩口静态墙体、指划搅动、洗鼻水枪降摩冲刷、薄荷爆弹碎冰、黄金猛擤与花粉催生）。
- `src/game/audio.ts`：零依赖 Web Audio API 合成音效（指划粘稠音、洗鼻呲水、薄荷和弦、蓄力猛擤与耳鸣、喷出波普声、双孔贯通风铃）。
- `src/render/painter.ts`：巨型拟人鼻子剖面、动态表情眼睛眉毛、流动空气丝线、4 种带小表情堵塞物、底部 3 按钮与肺活量蓄力条、今日鼻炎诊疗单及 `?debug=1` 叠层。
- `src/main.ts`：DPR 自适应、鼻腔内指划与底部 3 按钮多指隔离、键盘 `1 / 2 / Space / R`、`localStorage` 最高分记录。

## 4. 最新自动化验证结果

- `npm.cmd --prefix D:\Codex\idea-lab\nose-relief run typecheck`：通过（0 错误）。
- `npm.cmd --prefix D:\Codex\idea-lab\nose-relief test`：1 个测试文件、18 项 Vitest 单元测试全部通过（`tests/rules.test.ts`）。
- `npm.cmd --prefix D:\Codex\idea-lab\nose-relief run build`：通过（`dist/assets/index-*.js` `115.01 kB` / gzip `36.86 kB`）。
- Playwright Chromium 三视口端到端验证（`360×640`、`390×844` 含 `?debug=1`、`1280×800`）：
  - 均满足 `fitsViewport: true`、`overflow: false`。
  - 模拟点击开局、鼻腔内划动、蓄力猛擤、点击洗鼻水枪与薄荷爆弹全程 0 控制台报错、0 页面异常、0 外部网络请求。

## 5. 待真人试玩验证项

- 鼻腔内手指划动搓松猫毛团的力度反馈与「蓄力猛擤」黄金区节奏手感。
- 中后期波次花粉/冰块生成频率与双孔贯通触发难度平衡。

## 6. 实机试玩评价与后续评估

- **实机试玩评价**：v2 瓶颈防自通与蓄力提示已生效（贯通降至 1 次），但核心玩法偏向静态容器清球，张力弱于前 4 个原型，留待后续评估是否推翻重做为其他机制。
