# 🔌 PDF Extractor DSH Plugin

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![DSH Plugin](https://img.shields.io/badge/DeepSeek%20Harness-Plugin-blue)](https://github.com/deepseek-ai/deepseek-harness)
[![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-green)](https://github.com/topics/dsh-plugin)

> 将 [PDF 页面提取器](https://github.com/AATINF/pdf-page-extractor) 的核心能力接入 **DeepSeek Harness (DSH)**，让 AI Agent 在对话中直接处理 PDF 文件——提取、拆分、合并、旋转，全部纯本地执行。

## 三条实现路径

本仓库提供 **3 种集成方式**，从轻量到深度递进：

| 路径 | 方式 | 复杂度 | 适用场景 |
|---|---|---|---|
| **[A. DSH Skill](path-a-skill/)** | SKILL.md + Python 包装脚本 | ⭐ 最低 | 快速验证，DSH 会话中直接调用 |
| **[B. MCP Server](path-b-mcp-server/)** | Node.js MCP Server（标准协议） | ⭐⭐ 中等 | 通用 MCP 客户端均可对接 |
| **[C. Cordis Tool Plugin](path-c-cordis-plugin/)** | 原生 TypeScript DSH 插件 | ⭐⭐⭐ 最高 | 深度集成，享受 DSH 审批门/沙箱/日志回放 |

---

## Path A：DSH Skill（推荐入门）

最轻量的方式。在 DSH 会话中加载 Skill 后，Agent 即可调用 PDF 工具。

```bash
# 在 DSH 会话中加载
/load-skill path-a-skill/SKILL.md

# 然后 Agent 就能理解并调用：
# "帮我把 report.pdf 的第 3-5 页提取出来"
# "把这个合同拆成单页"
# "合并 invoice1.pdf 和 invoice2.pdf"
```

**核心文件**：
- [`SKILL.md`](path-a-skill/SKILL.md) — 模型可读的能力描述与使用指南
- [`pdf_tool.py`](path-a-skill/pdf_tool.py) — Python 封装脚本（调用 pdf-page-extractor 核心逻辑）

**依赖**：Python 3.11+、pdf-lib、JSZip（或直接用子进程调浏览器）

---

## Path B：MCP Server

标准 MCP 协议实现，任何支持 MCP 的客户端（DSH / Claude / Cursor 等）均可连接。

```bash
cd path-b-mcp-server
npm install
node src/index.js        # 启动 MCP Server（stdio 模式）
# 或
node src/index.js --sse  # 启动 SSE 模式（远程连接）
```

**暴露的工具**：

| 工具名 | 功能 | 参数 |
|---|---|---|
| `extract_pages` | 从 PDF 提取指定页面 | `input_path`, `pages`, `output_path` |
| `split_pdf` | 拆分为单页 ZIP | `input_path`, `output_dir` |
| `merge_pdfs` | 合并多个 PDF | `input_paths`, `output_path` |
| `rotate_page` | 旋转指定页面 | `input_path`, `pages`, `degrees`, `output_path` |

---

## Path C：Cordis Tool Plugin（原生 DSH 插件）

用 TypeScript 编写的原生 DSH 插件，注册为一等工具，完整接入 DSH 基础设施。

```bash
# 开发模式测试
cd deepseek-harness  # DSH 源码仓库
pnpm dsh web --patch ../pdf-extractor-dsh-plugin/path-c-cordis-plugin/cordis.yml

# 或安装到已有 DSH 实例
dsh plugin --profile web add link:/absolute/path/to/path-c-cordis-plugin
```

**插件特性**：
- 通过 `ctx.tools.register(defineTool(...))` 注册 4 个工具
- 享受 DSH 的审批门（approval gate）、沙箱隔离、日志回放
- 卸载时自动回滚，无残留状态
- 支持 HMR 热更新（开发时改代码即生效）

---

## 与原项目的关系

```
pdf-page-extractor          pdf-extractor-dsh-plugin
┌─────────────────┐         ┌──────────────────────────┐
│  浏览器端 UI     │ ────→   │  A. Skill (模型指令)      │
│  (HTML/JS)       │         │  B. MCP Server (协议层)   │
│                  │         │  C. Cordis Plugin (原生)   │
│  核心:           │         │                          │
│  - PDF.js 解析   │ ←复刻── │  核心:                    │
│  - pdf-lib 操作   │   逻辑   │  - pdf-lib (Node.js版)    │
│  - JSZip 打包     │         │  - pdf-parse (解析)       │
└─────────────────┘         └──────────────────────────┘
     离线浏览器工具               Agent 运行时插件
```

Path B/C 的服务端实现**不依赖浏览器**，用 Node.js 原生库（`pdf-lib` + `pdf-parse`）复刻了原项目的核心逻辑，可在无头环境中运行。

---

## 快速开始（最小体验）

### 前提
- Node.js ≥ 22 或 Python ≥ 3.11
- 已安装 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（仅 Path C 必需）

### 30 秒体验 Path A
```bash
# 1. 下载原项目单文件版
curl -L -o extractor.html https://github.com/AATINF/pdf-page-extractor/releases/latest/download/pdf-page-extractor.html

# 2. 把本仓库的 SKILL.md 放入 DSH 工作区
cp path-a-skill/SKILL.md ~/.dsh/workspace/

# 3. 在 DSH 会话中加载并使用
# /load-skill SKILL.md
# "提取 extractor.html 的第 1,3,5 页"
```

---

## License

MIT © 2026 AATINF

[原项目（PDF 页面提取器）](https://github.com/AATINF/pdf-page-extractor) 同样采用 MIT 许可。
