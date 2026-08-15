# 🔌 PDF Extractor DSH Plugin

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![DSH Plugin](https://img.shields.io/badge/DeepSeek%20Harness-Plugin-blue)](https://github.com/deepseek-ai/deepseek-harness)
[![npm version](https://img.shields.io/npm/v/pdf-extractor-dsh-plugin)](https://www.npmjs.com/package/pdf-extractor-dsh-plugin)
[![npm downloads](https://img.shields.io/npm/dm/pdf-extractor-dsh-plugin)](https://www.npmjs.com/package/pdf-extractor-dsh-plugin)
[![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-green)](https://github.com/topics/dsh-plugin)
[![Verified](https://img.shields.io/badge/Verified-DSH%20v0.1.0--rc.5%20%2F%20Windows-brightgreen)](https://github.com/AATINF/pdf-extractor-dsh-plugin)

> 将 [PDF 页面提取器](https://github.com/AATINF/pdf-page-extractor) 的核心能力接入 **DeepSeek Harness (DSH)**，让 AI Agent 在对话中直接处理 PDF 文件——提取、拆分、合并、旋转，全部**纯本地执行，文件不上传**。

**实测信息**：已在 **DSH v0.1.0-rc.5 + Windows** 上完成验证，四种 agent 模式（标准 / 极简 / PTC / 创造）中的前三种均确认插件工具对 Agent 可见且可被真实调用。

---

## 三条实现路径（从轻量到深度）

| 路径 | 方式 | 复杂度 | 适用场景 |
|---|---|---|---|
| **[A. DSH Skill](path-a-skill/)** | SKILL.md + Python CLI | ⭐ 最低 | 快速体验，DSH 会话中直接调用 |
| **[B. MCP Server](path-b-mcp-server/)** | Node.js MCP Server（标准协议） | ⭐⭐ 中等 | 任何 MCP 客户端（DSH / Claude / Cursor…）均可对接 |
| **[C. Cordis Tool Plugin](path-c-cordis-plugin/)** | 原生 TypeScript DSH 插件 | ⭐⭐⭐ 最高 | 深度集成，享受审批门 / 沙箱 / 日志回放 |

三条路径都提供相同的 **4 个工具**：`extract_pages` / `split_pdf` / `merge_pdfs` / `rotate_pages`。

---

## 工具速查（三条路径通用）

页码规格语法：`"5"`（单页）｜`"3-7"`（范围）｜`"1,3,5-8,10"`（组合）｜`"*"` 或 `"all"`（全部）

| 工具 | 功能 | 关键参数 |
|---|---|---|
| `extract_pages` | 提取指定页面为新 PDF | `input_path`、`pages`、`output_path?`、`password?`(仅 A) |
| `split_pdf` | 每页拆分为独立 PDF，打包 ZIP | `input_path`、`output_dir?`、`password?`(仅 A) |
| `merge_pdfs` | 按序合并多个 PDF | `input_paths[]`、`output_path?` |
| `rotate_pages` | 旋转指定页面 90°/180°/270° | `input_path`、`pages`、`degrees?`、`output_path?`、`password?`(仅 A) |

> **加密 PDF 支持差异**：`password` 参数**仅 Path A 可用**（pypdf 原生支持密码解密）。Path B/C 基于 pdf-lib，**不支持密码解密**——遇到加密 PDF 会返回 `EncryptedPDFError` 并提示先解密（或改用 Path A）。
>
> **默认输出位置**：未指定 `output_path` 时，输出文件默认保存到**源文件同目录**（merge 为第一个输入文件同目录）。

---

## 一分钟开始

```bash
# Path A（最快）：Python 一行提取
pip install pypdf
python path-a-skill/pdf_tool.py extract --input your.pdf --pages "1-3"

# Path B：MCP Server（任意 MCP 客户端可接）
cd path-b-mcp-server && npm install && node src/index.js

# Path C：DSH 原生插件（一行 npm 安装，无需 DSH 源码）
dsh plugin --profile web add pdf-extractor-dsh-plugin
#   然后正常启动 DSH（pnpm dsh web），4 个工具自动注册，开箱即用
```

> 想快速体验完整功能？准备一个 PDF，按上面任一命令运行即可。三条路径提供相同的 4 个工具。

---

## Path A：DSH Skill（推荐入门）

最轻量的方式，只需 Python 环境。DSH 会话中加载 Skill 后，Agent 即可按指令调用 PDF 工具。

### 前置条件
- Python 3.11+
- `pip install pypdf`

### 使用步骤

```bash
# 1.（一次性）安装依赖
pip install pypdf

# 2. 把 SKILL.md 和 pdf_tool.py 一起复制到 DSH 工作区的同一目录
#    （Agent 会在该目录执行 `python pdf_tool.py`，两个文件必须同目录）
cp path-a-skill/SKILL.md path-a-skill/pdf_tool.py <你的 DSH 工作区>/
```

3. 在 DSH 会话中加载并直接对话：

```
/load-skill <你的 DSH 工作区>/SKILL.md
"帮我把 report.pdf 的第 3-5 页提取出来"
"把这个合同拆成每页一个文件"
```

Agent 会调用同目录的 `pdf_tool.py`：

```bash
python pdf_tool.py extract --input report.pdf --pages "3-5"
python pdf_tool.py split   --input contract.pdf --output-dir ./output
python pdf_tool.py merge   --inputs a.pdf b.pdf c.pdf --output merged.pdf
python pdf_tool.py rotate  --input scan.pdf --pages "2,4" --degrees 90
```

> 提示：`input` / `output` 建议使用**绝对路径**，避免 Agent 在不同工作目录下找不到文件。

### 核心文件
- `path-a-skill/SKILL.md` — 模型可读的能力描述与使用指南
- `path-a-skill/pdf_tool.py` — Python CLI（pypdf 实现），输出结构化 JSON 便于 Agent 解析

---

## Path B：MCP Server

标准 MCP 协议实现，任何支持 MCP 的客户端均可连接。DSH 通过内置的 MCP 客户端桥接插件（`@deepseek-ai/dsh-mcp-client`）接入。

### 使用步骤

```bash
cd path-b-mcp-server
npm install
node src/index.js        # 启动 MCP Server（stdio 模式，DSH 标准连接方式）
```

### 在 DSH 中接入（cordis.yml 配置）

DSH 的 MCP 接入不是可视化配置，而是在启动配置里声明 MCP server 插件实例。在 DSH 源码仓库的启动 patch（或 profile 的 `cordis.patch.yml`）中加入：

```yaml
- id: mcp-pdf
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: pdf
    transport: stdio
    command: node
    args: ['<本仓库绝对路径>/path-b-mcp-server/src/index.js']
    cwd: '<本仓库绝对路径>/path-b-mcp-server'
```

然后用该配置启动 `pnpm dsh web --patch <该配置 yml>`。连接后，Agent 会看到 **`mcp__pdf__extract_pages` / `mcp__pdf__split_pdf` / `mcp__pdf__merge_pdfs` / `mcp__pdf__rotate_pages`** 四个工具。

> **重要**：所有文件路径必须使用**绝对路径**（`input_path` / `output_path` 等），MCP server 的工作目录与你的对话目录不同，相对路径会报文件不存在。

> 说明：本实现提供 stdio 传输（本地进程间通信，也是 DSH 的标准 MCP 接入方式）。
> 其他 MCP 客户端（Claude / Cursor 等）也可直接连接本 server。

### 暴露的工具

| 工具名 | 功能 | 参数 |
|---|---|---|
| `extract_pages` | 从 PDF 提取指定页面 | `input_path`, `pages`, `output_path?` |
| `split_pdf` | 拆分为单页 ZIP | `input_path`, `output_dir?` |
| `merge_pdfs` | 合并多个 PDF | `input_paths[]`, `output_path?` |
| `rotate_pages` | 旋转指定页面 | `input_path`, `pages`, `degrees?`, `output_path?` |

---

## Path C：Cordis Tool Plugin（原生 DSH 插件）

用 TypeScript 编写的原生 DSH 插件，注册为一等工具，完整接入 DSH 的审批门、沙箱隔离与日志回放。**已发布到 npm，一行安装即用。**

### 方法一：npm 安装（⭐ 推荐，最简，无需 DSH 源码仓库）

```bash
dsh plugin --profile web add pdf-extractor-dsh-plugin
```

安装后正常启动 DSH（`pnpm dsh web`），4 个工具自动注册。**无需修改任何配置**——包内 bundle 已内置（`dsh.bundle` → `cordis.npm.yml`，entry 用包名解析）。卸载：`dsh plugin --profile web remove pdf-extractor-dsh-plugin`。

> 需要 DSH 支持 `dsh plugin` 命令（DSH 源码部署或已安装 DSH CLI）。

### 方法二：patch 挂载（开发/自用，需 DSH 源码仓库）

```bash
# 1.（一次性）把插件放入 DSH 源码仓库内，并安装其依赖
cd <deepseek-harness 源码根目录>
cp -r <本仓库>/path-c-cordis-plugin ./scratch-plugin-pdf
cd scratch-plugin-pdf && npm install          # 安装 pdf-lib / jszip
cd ..

# 2. 修改 ./scratch-plugin-pdf/cordis.yml 中插件 name 的路径为你的本机绝对路径
#    （必须是 file:// 形式；已实测确认相对路径不可用，见下方注意事项）

# 3. 启动
pnpm dsh web --patch ./scratch-plugin-pdf/cordis.yml
```

### 方法三：link 安装到已有实例（已实测）

```bash
dsh plugin --profile web add link:<本仓库绝对路径>/path-c-cordis-plugin
```

> 实测说明：`link:` 安装本身可用（pnpm 层面安装成功），且插件包的 `dsh.bundle` 声明需为对象格式（`"dsh": {"bundle": {"patch": "./cordis.yml"}}`）才能被 DSH 识别为 profile 层。安装后仍需按方法二修改 `cordis.yml` 的 `name` 为 file:// 绝对路径（link 与 patch 的路径解析基准都是 profile 目录，相对路径不可用）。未改动 name 前插件不会被加载。

### 挂载注意事项（实测验证，务必遵守）

- `cordis.yml` 的插件 `name` **必须使用 `file:///` 形式的绝对路径**——相对路径会被解析到 profile 目录（`Cannot find module`），Windows 裸路径 `E:/...` 会被 ESM loader 当作 scheme（`ERR_UNSUPPORTED_ESM_URL_SCHEME`）。请按你的本机部署路径修改。
- `output.schema` 为 object 时**必须显式声明 `additionalProperties: true|false`**（DSH 运行时强制，否则报 `UNSUPPORTED_SCHEMA`）。
- `execute` 必须返回与 `output.schema` 匹配的**对象**（返回 `JSON.stringify()` 字符串会被判为非法值）。
- 插件依赖 DSH monorepo 内部包，**建议放在 DSH 源码仓库内**（如 `scratch-plugin/`）再挂载；第三方依赖（`pdf-lib`、`jszip`）在插件目录独立安装。
- 开发期支持代码热重载；**新增插件行**后若未生效，重启会话即可（HMR 对新增行不保证热加载）。

### 插件特性
- 通过 `ctx.tools.register(defineTool(...))` 注册 4 个工具
- 享受 DSH 的审批门（approval gate）、沙箱隔离、日志回放
- 卸载时自动回滚，无残留状态
- 适配 DSH 全部 agent 模式：标准 / 极简（minimal）/ PTC（code）下工具均对 Agent 可见

---

## 快速开始（30 秒最小体验，Path A）

```bash
# 1. 准备一个测试 PDF（任选其一，均已验证可用）
curl -L -o sample.pdf "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
# 备选：https://raw.githubusercontent.com/mozilla/pdf.js/master/web/compressed.tracemonkey-pldi-09.pdf（14 页）
# 或直接使用你自己的任意 PDF

# 2. 安装依赖并直接调用
pip install pypdf
python path-a-skill/pdf_tool.py extract --input sample.pdf --pages "1"

# 3. 输出：sample_第1页.pdf（同目录）
```

---

## 常见问题（FAQ）

| 问题 | 解答 |
|---|---|
| 提示 `Cannot find module '@deepseek-ai/cordis'` | Path C 插件必须放在 DSH 源码仓库内（能解析到 monorepo 内部包）再挂载 |
| 报 `ERR_UNSUPPORTED_ESM_URL_SCHEME` | cordis.yml 的 name 用了 `E:/...` 裸路径，改为 `file:///E:/...` |
| 报 `Cannot find module '...\profiles\web\src\pdf-tool.ts'` | cordis.yml 的 name 用了相对路径（DSH 相对路径解析到 profile 目录），必须改为 file:// 绝对路径 |
| link 安装成功但工具没出现 | ① 插件包 package.json 需含 `"dsh": {"bundle": {"patch": "./cordis.yml"}}`；② cordis.yml 的 name 需为 file:// 绝对路径（未改则插件不加载） |
| 如何让 DSH 接入 Path B（MCP） | 在启动配置里声明 `@deepseek-ai/dsh-mcp-client` 插件实例（见 Path B 章节的 cordis.yml 示例），工具名带 `mcp__pdf__` 前缀 |
| 报 `UNSUPPORTED_SCHEMA` | `output.schema` 的 object 类型缺少 `additionalProperties: true/false` |
| 文件加密打不开 | Path A：用 `--password` 参数传入密码（pypdf 支持）；Path B/C：pdf-lib 不支持密码解密，返回 `EncryptedPDFError`，请先解密或用 Path A |
| 页码超出范围 | 工具返回 `PageOutOfRangeError` 并给出有效范围 `1-N` |
| 能不能处理超大文件？ | 纯本地处理，内存占用与页数成正比；超大文件（>100MB）建议拆分处理 |

## 隐私说明

所有处理均在本地完成，**PDF 文件不会上传到任何服务器**。Path A 使用本地 Python 库 pypdf；Path B/C 使用本地 Node.js 库 pdf-lib / jszip，全程无网络请求。

---

## 为什么它特别轻量？

**核心代码只有约 370 行 TypeScript（Path C）/ 290 行 Python（Path A），依赖 1-2 个库，零浏览器、零服务端、零数据库组件。**

| 维度 | 本插件 | 原项目（浏览器单文件） | 通用 PDF CLI（qpdf 等） | 在线 PDF 服务 |
|---|---|---|---|---|
| 安装体积 | A: 1 脚本 + pypdf（~1.5MB）；B/C: 2-4 个 npm 包 | 单 HTML（数 MB） | 二进制 ~10MB+ | 无需安装 |
| 依赖数量 | A: 1 个；B: 4 个；C: 2 个 | 内置（体积大） | 0（但功能单薄） | 0 |
| 是否需要浏览器/服务 | **否**（纯命令行/进程内） | 是（浏览器） | 否 | 是（远程服务） |
| 文件是否离开本机 | **从不** | 从不 | 从不 | **上传到第三方** |
| 内存占用 | 极低（按页流式处理） | 浏览器进程（高） | 中 | 取决于服务端 |
| Agent 集成 | **原生一等公民**（DSH 工具 / MCP 协议） | 无（需人工操作） | 需自行封装为工具 | 需 API Key + 网络 |
| 启动速度 | 即时（进程内/tsx 加载） | 打开浏览器数秒 | 即时 | 网络往返 |

**适合谁**：需要让 AI Agent 在对话里直接、私密、零成本处理 PDF 的开发者——不想要重型依赖、不想上传文件、不想起服务。

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
│  - pdf-lib 操作   │   逻辑   │  - pdf-lib (Node.js 版)   │
│  - JSZip 打包     │         │  - pypdf (Python 版)      │
└─────────────────┘         └──────────────────────────┘
     离线浏览器工具               Agent 运行时插件
```

Path A/B/C 的服务端实现**不依赖浏览器**，用本地库（pypdf / pdf-lib + jszip）复刻了原项目的核心逻辑，可在无头环境中运行。

---

## Roadmap

- [x] Path A：DSH Skill（Python CLI）
- [x] Path B：MCP Server（stdio）
- [x] Path C：Cordis Tool Plugin（原生，已实测）
- [x] **发布 npm 包**：`pdf-extractor-dsh-plugin@1.1.1` 已发布到 npm —— `dsh plugin --profile web add pdf-extractor-dsh-plugin` 一行安装，开箱即用（已实测）

## License

MIT © 2026 AATINF

[原项目（PDF 页面提取器）](https://github.com/AATINF/pdf-page-extractor) 同样采用 MIT 许可。
