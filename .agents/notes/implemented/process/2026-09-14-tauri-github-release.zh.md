# Agent Note: 从 dsh 发布 tag 发布 macOS 应用

Status: implemented

[English](2026-09-14-tauri-github-release.md) | 中文

## Problem

macOS 工作流只把 `.app` 和 DMG 保留为七天期的 GitHub Actions 产物。因此一次成功构建不会产生持久、带版本的下载，单独创建 GitHub Release 还可能附加来自其他构建或 commit 的字节。Tauri 配置也携带一个独立的字面量版本，因而其 bundle 元数据和文件名可能与 dsh 发布 tag 分歧。

## Decision

`.github/workflows/build-tauri-macos.yml` 以只读仓库权限构建普通分支、Pull Request 和手动运行。它也接受 `dsh-v*` tag 推送。tag 运行在安装依赖或构建前，校验 tag 等于 `dsh-v` 加上仓库根 `package.json` 的版本。

build 作业沿用 `dsh-tauri-macos-aarch64` 产物名上传 macOS bundle。依赖它的 release 作业只对 `refs/tags/dsh-v*` ref 运行，下载该精确产物，要求其中恰好有一个 DMG，并使用 `--verify-tag` 和生成的发布说明将其交给 `gh release create`。该作业不 checkout 源码树，因此它从 `github.repository` 设置 `GH_REPO`。只有该作业获得 `contents: write`；来自可变分支和 Pull Request 的构建保留 `contents: read`。

Bundle 配置显式向 Tauri 提供 `-` 签名身份。在没有 Apple Developer 凭据时，它会生成下载的 Apple Silicon 应用所需的 ad-hoc 签名。此无密钥构建会禁用 Tauri 的 hardened runtime，因为把它应用于嵌入的 Node 可执行文件会使 V8 无法保留其可执行代码范围。上传前，工作流会用打包的 libvips 目录启动已签名的 `dsh-web` sidecar，要求它输出回环就绪 URL，然后使用 `codesign --deep --strict` 验证完整应用 bundle。因此，结构上有效但会阻止应用启动的签名无法进入 release。

带预发布段的版本会创建 GitHub 预发布，且不会标为 latest。稳定版本保留 GitHub 通常的 latest release 选择方式。Tauri 通过配置支持的 package 路径读取仓库根 `package.json`，因此共享 dsh 版本升级也会提供 macOS bundle 版本。

工作流测试固定 tag 触发器、ref 条件、拆分的权限、tag 校验、DMG 选择、发布命令、预发布处理和 Tauri 版本真源。

## Alternatives considered

**在滚动 release 下发布每一次成功的 main 分支构建。** 这使最新构建容易下载，但会让可变 commit 共用一个稳定发布标识，无法生成持久的发布说明，并且与仓库基于 tag 的公开发布流程冲突。

**向 build 作业授予 `contents: write` 并在其中创建 release。** 这避免在作业之间传递 Actions 产物，但每一次分支和 Pull Request 构建都会获得可写 token，尽管只有 tag 可以发布。依赖作业把发布权限排除在验证运行之外，并证明上传的 release 产物就是保留的构建输出。

**创建一个重新构建应用的独立 release 工作流。** 这会隔离发布触发器，但 GitHub Release 不会消费成功构建的产物。调用或复制昂贵的 macOS 构建还会产生两份可能分歧的工作流定义。

**直接上传 `.app` 目录。** GitHub Release 产物是文件。DMG 是 Tauri 已产生的 macOS 发行文件，而 `.app` 保留在短期 Actions 产物内供构建检查。

## Consequences

推送或手动 dispatch 匹配的 `dsh-v*` tag 会生成持久的 GitHub Release，其 DMG 来自已完成的 macOS 构建。分支、Pull Request、不匹配的 tag 或手动分支 dispatch 都无法创建 release。对 release 已存在的 tag 重新运行会失败，而不是替换已发布产物。

发布的应用仍使用 ad-hoc 签名且未经公证。该签名可防止 macOS 将未签名的 Apple Silicon 下载报告为已损坏，但用户首次启动时仍可能需要在“隐私与安全性”中批准。无警告分发需要 Developer ID Application 证书和 Apple 公证凭据。
