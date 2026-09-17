# Agent Note: OpenCode 逐对话会话头部

Status: implemented

[English](2026-09-17-opencode-session-header.md) | 中文

## 问题

缺少稳定逐对话 `x-opencode-session` 头部的推理请求会被 OpenCode Go 与 Zen 网关以 HTTP 400 `MissingSessionID` 拒绝。harness 经 `dsh-llm-pi-ai` 访问这两个网关；该适配器把 `GenerateOptions.sessionId` 传给 pi-ai，但不为它发送任何提供方头部：pi-ai 0.85.1 未把该选项映射到该头部。`dsh-llm-deepseek` 已为 DeepSeek 提供方发送会话头部，OpenCode 路由没有对应实现。网关用该 id 做后端路由与提示词缓存亲和，因此所有对话共用一个固定头部无法替代。

## 决策

`dsh-llm-pi-ai` 在路由属于 OpenCode 网关（`opencode` 或 `opencode-go`）且请求带有 `GenerateOptions.sessionId` 时，为每个请求写入 `x-opencode-session`。取值即 harness 会话 id：每个对话唯一，并跨轮次、恢复、压缩、重试与辅助调用保持稳定，因为 agent loop、会话标题与压缩路径都传入同一个持久化 `Session.id`。该头部是模型不可见的传输元数据——不进入 JSON 请求体、提示词、token 计量、KV cache 身份或会话日志。同名的 profile `headers` 条目会被覆盖，因为固定取值会把所有对话放进同一个路由与缓存桶。OpenCode 家族之外的路由不受影响，请求不含会话 id 时不发送该头部。

pi-ai 在上游负责该映射（[earendil-works/pi#9326](https://github.com/earendil-works/pi/issues/9326)）；升级后的 pi-ai 自行发送该头部时，适配器内的注入即删除。

## 验证

- `packages/llm/llm-pi-ai/tests/adapter.spec.ts` 断言 `opencode-go` 与 `opencode` 路由上的头部取值、会话 id 覆盖同名静态 profile 头部、无会话 id 的请求不发送该头部，以及非 OpenCode 路由不收到该头部。
- 无 keyless 快照变更：该头部对模型不可见，绝不进入会话记录内容。

## 考虑过的替代方案

**静态 `headers` 条目。** 配置可把 `x-opencode-session` 设为固定字符串，但所有对话共用一个取值会削弱网关的路由与提示词缓存亲和；上游讨论量化了这项代价。

**按路由选择加入的 `sessionHeader` 字段。** 逐路由指定头部名可推广到任意网关，但对一个封闭且目录已知的提供方家族，它需要每个部署显式选择加入，并通过通用配置暴露提供方细节。在 OpenCode 路由上自动注入无需配置即覆盖目录路由。

**为每个出站请求写入该头部。** 向无关提供方发送该头部会把对话标识泄漏给没有路由需求的接收方。

## 后果

- OpenCode Go 与 Zen 路由无需逐路由配置即可服务，并保留逐对话的路由与提示词缓存亲和。
- 设置静态 `x-opencode-session` 头部的 profile 在真实请求中会失去它；运行时取值胜出是有意为之。
- 适配器带有一处提供方特例，其归属将转回上游 pi-ai，因此 pi-ai 发版后删除它是一处小而独立的改动。
