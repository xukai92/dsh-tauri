# Agent Note：让下游 CI 使用公共托管 runner

Status: implemented

[English](2026-09-16-downstream-hosted-ci.md) | 中文

## 问题

上游工作流会选择组织专用 runner 标签、持久化自托管机器、Blacksmith 容量和真实 API 凭据。公共下游仓库并不拥有这些资源，但替换整套工作流会丢失有用的验证，也会增加后续集成上游变更的难度。

## 决策

Runner 与环境准备表达式使用 `github.repository_owner` 划分 fork 行为。`deepseek-ai` 仓库保留自定义、自托管和 Blacksmith 路径；其他 owner 始终使用标准公共 GitHub 托管标签，即使复制的仓库变量仍指向上游故障切换模式。缓存恢复、Playwright 安装、临时路径和 worker 预算跟随实际选择的 runner，而不是仅跟随变量。下游 Linux 与 Windows job 使用适合标准托管机器的有界并发。

有用的合并后 Python runtime、Wine、sandbox 和原生附加组件检查同时接受 `main` 与 `master`。自托管备用演练和硬件对比矩阵只在上游运行，因为标准托管 lane 已覆盖其软件行为，却无法复现其基础设施测量结果。

可复用 Python runtime 构建器始终运行 installed-wheel 无密钥检查。其真实 API 预检与 smoke 需要显式 `real_api` 输入；上游自动调用方会选择该输入，而下游调用方保持无密钥，除非维护者在手动运行时选择它。选择真实模式但未提供密钥会使预检失败。专用真实 API E2E 工作流采用相同策略：上游可信事件自动运行，下游仅接受显式手动运行。

标准托管 coverage lane 会为重子进程和持久化 fixture 提供 test、polling 与 hook 预算；这些 fixture 不会用更短的局部 deadline 覆盖 lane 预算。功能性进程检查可以使用平台特定的启动上限，而性能限制仍归专用 benchmark lane 所有。需要纯后台后续 turn 的 snapshot fixture 只会在父 agent 出现权威的 `agent/status: idle` 转换后释放子级模型工作。

## 备选方案

**删除仅上游使用的 lane。** Owner 条件可保留上游拓扑并减少反复出现的合并冲突，同时防止下游 job 请求不可用的 runner。

**把基础设施 benchmark 映射到标准 runner。** 这些 job 测量具名硬件层级或持久化 runner 行为。在无关的托管容量上运行会产生误导性的对比，并重复必需验证。

**让缺少密钥时跳过真实 API 测试。** 被选择的真实测试必须在凭据缺失时失败；无密钥检查仍是下游默认依据。

## 后果

- 下游拉取请求与合并后验证无需组织 runner 标签即可启动，复制的故障切换变量也不会改变其环境准备路径。
- 标准托管机器使用更少的 coverage 分区、worker 数与 snapshot 并发，因此完整矩阵会比上游高容量 lane 花费更多墙钟时间。
- 针对托管 runner 的时序调整会保留行为断言；失败仍然可观察，而不会变成重试或跳过检查。
- 下游不会自动运行真实 provider 检查；维护者必须在配置密钥后手动触发。
- [CI 故障切换运行手册](2026-07-26-ci-failover-runbook.zh.md)、[串行跨平台参考](2026-07-21-serial-cross-platform-ci-reference.zh.md)、[Blacksmith 故障切换记录](2026-09-09-blacksmith-failover-leg.zh.md)和[真实 API E2E 记录](../testing/2026-06-19-real-api-e2e-ci.zh.md)仍是上游运行的权威说明。
