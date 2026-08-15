# pdf-extractor-dsh-plugin

DeepSeek Harness 原生 Cordis 插件：让 AI Agent 在对话中直接处理 PDF——**提取 / 拆分 / 合并 / 旋转**，100% 纯本地执行，文件不上传。

## 安装（一行，无需 DSH 源码仓库）

```bash
dsh plugin --profile web add pdf-extractor-dsh-plugin
```

安装后正常启动 DSH（`pnpm dsh web`），自动注册 4 个工具：

| 工具 | 功能 |
|---|---|
| `extract_pages` | 从 PDF 提取指定页面为新文件（支持 `"2-5"` / `"1,3,8-10"` / `"*"`） |
| `split_pdf` | 每页拆分为独立 PDF，打包 ZIP |
| `merge_pdfs` | 按序合并多个 PDF |
| `rotate_pages` | 旋转指定页面 90°/180°/270° |

## 卸载

```bash
dsh plugin --profile web remove pdf-extractor-dsh-plugin
```

## 说明

- 所有处理在本地完成，全程无网络请求。
- 加密 PDF：本插件基于 pdf-lib，**不支持密码解密**（返回 `EncryptedPDFError`），请先解密后再处理。
- 本仓库提供三条接入路径（Skill / MCP Server / 本 Cordis 插件），完整文档见 GitHub：

👉 **https://github.com/AATINF/pdf-extractor-dsh-plugin**

MIT License © 2026 AATINF
