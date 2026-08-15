# PDF 页面提取器 Skill（DeepSeek Harness）

让 AI Agent 在对话中直接处理 PDF 文件：提取指定页面、拆分、合并、旋转。所有操作纯本地执行，文件不上传。

## 能力概述

本 Skill 为 Agent 提供 4 个 PDF 处理工具：

| 工具 | 功能 | 典型指令 |
|---|---|---|
| `extract_pages` | 从 PDF 提取指定页面为新文件 | "提取 report.pdf 第 3-5 页" |
| `split_pdf` | 将 PDF 拆分为单页 ZIP 包 | "把合同拆成每页一个文件" |
| `merge_pdfs` | 将多个 PDF 按序合并为一个 | "合并 invoice1.pdf 和 invoice2.pdf" |
| `rotate_pages` | 将指定页面旋转 90°/180°/270° | "把第 2 页转正" |

## 使用前提

1. 用户本地有 Python 3.11+ 环境
2. 已安装依赖：`pip install pypdf`
3. 待处理的 PDF 文件在当前工作区（或提供绝对路径）

## 调用方式

当用户提出 PDF 处理需求时，按以下步骤执行：

### Step 1：识别意图
- 提取 → `extract_pages`
- 拆分 → `split_pdf`
- 合并 → `merge_pdfs`
- 旋转 → `rotate_pages`

### Step 2：确认参数
- **input_path**：源 PDF 路径（必填）
- **pages**：目标页码（提取/旋转时必填），支持格式：
  - 单页：`"5"`
  - 范围：`"3-7"`
  - 组合：`"1,3,5-8,10"`
  - 全部：`"*"` 或 `"all"`
- **output_path**：输出路径（可选，默认自动生成）
- **degrees**：旋转角度（仅 rotate，默认 90）

### Step 3：调用脚本
```bash
python pdf_tool.py <command> --input <path> [options]
```

### Step 4：返回结果
告知用户输出文件位置和大小。如果输入文件有密码保护，提示用户需要先提供密码。

## 示例对话

**用户**："帮我把这个报告的第 2、4、6-9 页提取出来"
**Agent 思路**：
1. 确认 input_path = 报告.pdf
2. pages = "2,4,6-9"
3. 调用 `python pdf_tool.py extract --input 报告.pdf --pages "2,4,6-9"`
4. 返回："已提取 6 页 → 报告_第2,4,6-9页.pdf（1.2 MB）"

**用户**："把这些扫描件合并成一个"
**Agent 思路**：
1. 识别当前目录下所有 PDF 文件
2. 按文件名排序确定合并顺序
3. 调用 `python pdf_tool.py merge --inputs file1.pdf file2.pdf file3.pdf`
4. 返回："已合并 3 个文件 → merged_output.pdf"

## 注意事项

- 加密 PDF 需要用户提供密码，通过 `--password` 参数传入
- 大文件（>100MB）处理时间较长，应提前告知用户
- 输出文件默认保存在源文件同目录，避免路径冲突
- 如果 pdf-lib 不可用，回退到 pypdf；两者都不可用时提示安装

## 错误处理

| 错误 | 原因 | 处理 |
|---|---|---|
| `FileNotFoundError` | 输入文件不存在 | 请用户确认路径 |
| `PasswordRequiredError` | PDF 加密 | 询问用户密码 |
| `PageOutOfRangeError` | 页码超出范围 | 列出有效页数范围 |
| `DependencyMissingError` | 缺少 Python 库 | 引导用户 `pip install` |
