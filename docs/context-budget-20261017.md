# 上下文预算与记忆推送周期调整

`patches/apply-context-budget.mjs` 的说明与取证记录。2026-10-17 依据 run `r-20261017-215950-eacf` 落地。

## 结论

部署 `deployments/mybot/config.json` 改了两处，都是 persona/world 自己声明的配置项，不动源码：

| 配置 | 原值（默认） | 现值 | 作用 |
|---|---|---|---|
| `context.maxTokens` | 64000 | 80000 | 上下文阶段预算。超过 `maxTokens × softRatio`（85%）先提示，下一批结束时仍超出即交接 |
| `worlds.memory.observeIntervalMs` | 30000 | 300000 | 记忆快照推给人格的周期 |

预期：交接周期从 4.3 分钟一次降到 7–8 分钟一次；每 30 秒一次的重复记忆快照消失。

## 依据（同一 run 实测）

- 96 分钟内 360 次模型请求，`promptTokens` p50 52,423 / p90 59,049 / max 85,703；单轮耗时 p50 6.3 s / p90 16.9 s；推理总时长占墙钟 59%。
- 上下文交接 23 次（平均 4.3 分钟一次）。交接后第一轮仍需 p50 46,056 token，即 64k 预算里 72% 是固定开销，只剩约 12k 干活空间。
- 本机估算与上游计数一致：36 次交接配对，`beforeTokens` 与实际 `promptTokens` 比值 p50 = 1.00。因此配置里的数字就是上游看到的数字。
- `memory.context` 96 分钟推送 195 次，正文只有 1 种（632 字）。它是 piggyback 事件，不唤醒回合，只占上下文。
- 固定前缀实测（仓库自带 `estimateTokens` 口径）：工具表 26,247 token / 103 个工具（minecraft 15 个 16,358；qqbot 25 个 2,828；humanlike 24 个 2,619；memory 25 个 2,099；persona 10 个 1,753；learn 4 个 590），常驻提示文本 2,695 token（minecraft/ENV_PROMPT.md 3,075 字 1,648 token，qq 扩展 ENV_PROMPT.md 1,409 字 648，ORIENTATION 526 字 158，CONSTITUTION 506 字 152，相机说明 158 字 89）。第 1 轮真实 `promptTokens` = 49,675。

## 为什么是 80000 而不是 96000

上游已接受过的最大 prompt 是 85,703（status 200），再高没有证据。80000 预算的软阈值是 68,000，交接落在约 71k，单轮溢出后仍在 85k 附近。

若日志出现「上游拒绝:输入超过模型上下文」，把预算降到 72000：

```
node patches/apply-context-budget.mjs --apply --max-tokens=72000
```

## 回滚

三种都可以，互不依赖：

1. `node patches/apply-context-budget.mjs --revert`（用部署目录里最新的 `config.json.bak-context-budget-*`）
2. 直接复制备份：`backups/qq-latency-bc-20261018-003053/config.json` → `runtimes/cortico-0.2.1/deployments/mybot/config.json`
3. WebUI 的 Persona 配置页把「上下文阶段预算」改回 64000、记忆推送周期改回 30000（两项都标了 `x-hot`）

## 生效与验证

配置在启动时读取，改完需要重启 bot。重启后：

```
node patches/apply-context-budget.mjs --check
```

输出 PASS 才算改动还在（运行中的进程退出时若重写 config.json，会把改动冲掉；`--check` 的 FAIL 就是这个信号，重新 `--apply` 即可）。

观察两项：`log.jsonl` 里「上下文交接完成」的间隔，以及 `usage.jsonl` 的 `promptTokens` 分布。

## 尚未实施：前缀瘦身

工具表占固定前缀的大头，其中 `mc_do` 的 `parameters` 单条 22,177 字 ≈ 8,000 token（47 个 step 字段的并集），是最大的单块。压缩它等于改模型看到的技能参数说明，会影响调用准确度，需要在游戏里验证，因此没有随本次一起改。
