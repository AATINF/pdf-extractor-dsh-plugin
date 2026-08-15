/**
 * PDF Extractor — DeepSeek Harness 原生 Cordis 插件
 *
 * 将 pdf-page-extractor 的核心能力注册为 DSH 一等工具。
 * Agent 可在对话中直接调用 extract_pages / split_pdf / merge_pdfs / rotate_pages。
 *
 * 架构特点：
 * - 通过 ctx.tools.register(defineTool(...)) 注册工具
 * - 享受 DSH 审批门（approval gate）、沙箱隔离、日志回放
 * - 卸载时自动回滚，无残留状态
 *
 * 挂载方式：
 *   pnpm dsh web --patch <harness-root>/pdf-extractor-plugin/cordis.yml
 *
 * 或安装到已有 DSH 实例：
 *   dsh plugin --profile web add link:<harness-root>/pdf-extractor-plugin
 */

import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { PDFDocument, degrees } from "pdf-lib";
import fs from "fs/promises";
import path from "path";

export const name = "pdf-extractor-tool";
export const inject = ["tools"];

/** 解析页码规格: "1,3,5-8" → [0, 2, 4, 5, 6, 7] (0-based) */
function parsePages(spec: string, total: number): number[] {
  const s = spec.trim().toLowerCase();
  if (s === "*" || s === "all") return Array.from({ length: total }, (_, i) => i);

  const result: number[] = [];
  for (const part of s.split(",")) {
    const p = part.trim();
    if (p.includes("-")) {
      const [a, b] = p.split("-").map(Number);
      const start = Math.max(1, a);
      const end = Math.min(total, b);
      for (let i = start; i <= end; i++) result.push(i - 1);
    } else {
      const n = Number(p);
      if (n >= 1 && n <= total) result.push(n - 1);
    }
  }
  return [...new Set(result)].sort((a, b) => a - b);
}

/** 生成默认输出路径 */
function defaultOutput(inputPath: string, suffix: string): string {
  const dir = path.dirname(inputPath);
  const stem = path.basename(inputPath, path.extname(inputPath));
  return path.join(dir, `${stem}${suffix}`);
}

export function apply(ctx: Context) {
  // ─── Tool 1: 提取指定页面 ──────────────────────────────
  ctx.tools.register(
    defineTool({
      name: "extract_pages",
      description:
        "从 PDF 文件提取指定页面并保存为新 PDF。支持页码范围和组合选择，如 '2-5'、'1,3,8-10'。文件处理完全在本地完成。",
      parameters: {
        input_path: {
          type: "string",
          required: true,
          description: "输入 PDF 文件的绝对路径",
        },
        pages: {
          type: "string",
          required: true,
          description: "页码规格，如 '2-5', '1,3,8-10', '*' 表示全部",
        },
        output_path: {
          type: "string",
          description: "输出文件路径（可选，默认自动生成）",
        },
        password: {
          type: "string",
          description: "PDF 密码（如加密）",
        },
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render: (_args, value) => [
          {
            type: "text",
            text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
          },
        ],
      },
      async execute(args, exec) {
        try {
          const data = await fs.readFile(args.input_path, { signal: exec.signal });
          let srcDoc: PDFDocument;
          try {
            srcDoc = await PDFDocument.load(data, {
              password: args.password || undefined,
            });
          } catch (e: any) {
            if (e.message?.includes("password")) {
              return {
                success: false,
                error: "PasswordRequiredError",
                message: "该 PDF 已加密，请提供 password 参数",
              };
            }
            throw e;
          }

          const total = srcDoc.getPageCount();
          const indices = parsePages(args.pages, total);

          if (indices.length === 0) {
            return {
              success: false,
              error: "PageOutOfRangeError",
              message: `页码 "${args.pages}" 超出范围（共 ${total} 页）`,
              valid_range: `1-${total}`,
            };
          }

          const newDoc = await PDFDocument.create();
          const copied = await newDoc.copyPages(srcDoc, indices);
          for (const page of copied) newDoc.addPage(page);

          const outPath =
            args.output_path ||
            defaultOutput(args.input_path, `_第${args.pages}页.pdf`);
          const bytes = await newDoc.save();
          await fs.writeFile(outPath, bytes, { signal: exec.signal });

          return {
            success: true,
            action: "extract",
            input_file: args.input_path,
            pages_selected: indices.map((i) => i + 1),
            page_count: indices.length,
            output_file: outPath,
            size_kb: Math.round((bytes.length / 1024) * 10) / 10,
            message: `已提取 ${indices.length} 页 → ${outPath}`,
          };
        } catch (err: any) {
          return {
            success: false,
            error: err.name || "Error",
            message: err.message,
          };
        }
      },
    })
  );

  // ─── Tool 2: 拆分为单页 ZIP ─────────────────────────────
  ctx.tools.register(
    defineTool({
      name: "split_pdf",
      description:
        "将 PDF 每页拆分为独立 PDF 文件，打包为一个 ZIP。适用于需要逐页分发或单独处理的场景。",
      parameters: {
        input_path: {
          type: "string",
          required: true,
          description: "输入 PDF 文件路径",
        },
        output_dir: {
          type: "string",
          description: "输出目录（可选，默认源文件同目录）",
        },
        password: {
          type: "string",
          description: "PDF 密码",
        },
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render: (_args, value) => [
          { type: "text", text: JSON.stringify(value, null, 2) },
        ],
      },
      async execute(args, exec) {
        try {
          const JSZip = (await import("jszip")).default;
          const data = await fs.readFile(args.input_path, { signal: exec.signal });
          const srcDoc = await PDFDocument.load(data, {
            password: args.password || undefined,
          });
          const total = srcDoc.getPageCount();
          const stem = path.basename(
            args.input_path,
            path.extname(args.input_path)
          );
          const outDir = args.output_dir || path.dirname(args.input_path);

          const zip = new JSZip();
          for (let i = 0; i < total; i++) {
            const doc = await PDFDocument.create();
            const [page] = await doc.copyPages(srcDoc, [i]);
            doc.addPage(page);
            zip.file(`${stem}_p${i + 1}.pdf`, await doc.save());
          }

          const buf = await zip.generateAsync({ type: "nodebuffer" });
          const zipPath = path.join(outDir, `${stem}_split.zip`);
          await fs.writeFile(zipPath, buf, { signal: exec.signal });

          return {
            success: true,
            action: "split",
            input_file: args.input_path,
            total_pages: total,
            output_file: zipPath,
            size_kb: Math.round((buf.length / 1024) * 10) / 10,
            message: `已拆分 ${total} 页 → ${zipPath}`,
          };
        } catch (err: any) {
          return {
            success: false,
            error: err.name || "Error",
            message: err.message,
          };
        }
      },
    })
  );

  // ─── Tool 3: 合并多个 PDF ───────────────────────────────
  ctx.tools.register(
    defineTool({
      name: "merge_pdfs",
      description:
        "将多个 PDF 文件按顺序合并为一个。适用于合并扫描件、报告章节等场景。",
      parameters: {
        input_paths: {
          type: "array",
          required: true,
          description: "输入 PDF 文件路径列表（按合并顺序）",
          items: { type: "string" },
        },
        output_path: {
          type: "string",
          description: "输出路径（可选，默认 merged_output.pdf）",
        },
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render: (_args, value) => [
          { type: "text", text: JSON.stringify(value, null, 2) },
        ],
      },
      async execute(args, exec) {
        try {
          const merged = await PDFDocument.create();
          let total = 0;

          for (const fp of args.input_paths as string[]) {
            const data = await fs.readFile(fp, { signal: exec.signal });
            const doc = await PDFDocument.load(data);
            const count = doc.getPageCount();
            const pages = await merged.copyPages(
              doc,
              Array.from({ length: count }, (_, i) => i)
            );
            for (const p of pages) merged.addPage(p);
            total += count;
          }

          const outPath = args.output_path || "merged_output.pdf";
          const bytes = await merged.save();
          await fs.writeFile(outPath, bytes, { signal: exec.signal });

          return {
            success: true,
            action: "merge",
            input_files: args.input_paths,
            file_count: (args.input_paths as string[]).length,
            total_pages: total,
            output_file: outPath,
            size_kb: Math.round((bytes.length / 1024) * 10) / 10,
            message: `已合并 ${(args.input_paths as string[]).length} 个文件（${total} 页）→ ${outPath}`,
          };
        } catch (err: any) {
          return {
            success: false,
            error: err.name || "Error",
            message: err.message,
          };
        }
      },
    })
  );

  // ─── Tool 4: 旋转指定页面 ───────────────────────────────
  ctx.tools.register(
    defineTool({
      name: "rotate_pages",
      description:
        "将 PDF 中指定的页面旋转 90°、180° 或 270°。用于纠正扫描方向错误的页面。",
      parameters: {
        input_path: {
          type: "string",
          required: true,
          description: "输入 PDF 文件路径",
        },
        pages: {
          type: "string",
          required: true,
          description: '要旋转的页码，如 "2,4" 或 "1-3"',
        },
        degrees: {
          type: "number",
          description: "旋转角度：90 | 180 | 270（默认 90）",
        },
        output_path: {
          type: "string",
          description: "输出路径（可选）",
        },
        password: {
          type: "string",
          description: "PDF 密码",
        },
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render: (_args, value) => [
          { type: "text", text: JSON.stringify(value, null, 2) },
        ],
      },
      async execute(args, exec) {
        try {
          const deg = args.degrees || 90;
          const data = await fs.readFile(args.input_path, { signal: exec.signal });
          const srcDoc = await PDFDocument.load(data, {
            password: args.password || undefined,
          });
          const total = srcDoc.getPageCount();
          const indices = parsePages(args.pages, total);

          for (const idx of indices) {
            srcDoc.getPage(idx).setRotation(degrees(deg));
          }

          const outPath =
            args.output_path ||
            defaultOutput(args.input_path, `_旋转${deg}度.pdf`);
          const bytes = await srcDoc.save();
          await fs.writeFile(outPath, bytes, { signal: exec.signal });

          return {
            success: true,
            action: "rotate",
            input_file: args.input_path,
            pages_rotated: indices.map((i) => i + 1),
            degrees: deg,
            output_file: outPath,
            size_kb: Math.round((bytes.length / 1024) * 10) / 10,
            message: `已旋转 ${indices.length} 页（${deg}°）→ ${outPath}`,
          };
        } catch (err: any) {
          return {
            success: false,
            error: err.name || "Error",
            message: err.message,
          };
        }
      },
    })
  );

  console.log(
    "[pdf-extractor-tool] loaded; tools: extract_pages, split_pdf, merge_pdfs, rotate_pages"
  );
}
