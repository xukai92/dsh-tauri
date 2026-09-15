# Agent Note: 受信远程设置使用宿主持久化

Status: implemented

[English](2026-09-15-trusted-remote-settings.md) | 中文

## 问题

connection 服务器接受来自已声明受信 authority 的设置与凭证 RPC，但只要 `connection.isLoopback` 为 false，浏览器设置层就会选择进程内存模式。因此，受信远程浏览器会完全跳过 `settings.describe`：Models 无法加载提供方目录、偏好设置失效，并且欢迎声明的确认状态会在刷新后消失，尽管宿主会接受所需的全部设置操作。

## 决策

生产环境中的 `SettingsDescribeMirror` 与 `SettingsScopeController` 实例始终使用宿主持久化。网络授权只归 connection 服务器的受信 authority 策略所有；浏览器不会把自身 URL 解读为授权决定，从而重复该策略。显式内存模式仍可供隔离消费方与测试使用，但生产组合绝不会依据 `isLoopback` 选择它。

原生 `settings.openDocument` 操作仍仅限 loopback。允许受信 authority 访问设置文档的脱敏值与变更 API，并不允许其控制宿主桌面。

## 曾考虑的替代方案

**让非 loopback 设置继续使用内存。** 否决，因为这与服务器授权相矛盾，并使受信远程使用无法配置模型或保留偏好设置。

**先尝试宿主，拒绝后静默回退到内存。** 否决，因为两个持久化位置会让临时传输或授权失败看起来像一次成功但不持久的写入。被拒绝的 authority 必须保持明确的拒绝状态。

**让设置 RPC 恢复为仅限 loopback。** 否决，因为全接口部署明确把其已声明的网络 authority 作为会话执行、设置与凭证的授权边界。

## 后果

受信远程浏览器与 loopback 浏览器读写同一份设置文档。远程浏览器 e2e 会关闭欢迎声明、刷新以证明确认状态已持久化，并通过真实提供方目录联结打开 Models。connection 测试继续证明未声明的 authority 会收到 403，且 `settings.openDocument` 仍仅限 loopback。
