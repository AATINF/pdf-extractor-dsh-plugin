/**
 * PDF Extractor MCP Server
 *
 * 标准 MCP (Model Context Protocol) Server 实现。
 * 暴露 4 个工具：extract_pages / split_pdf / merge_pdfs / rotate_pages
 * 供 DeepSeek Harness 或任何 MCP Client 调用。
 *
 * 运行方式:
 *   node src/index.js          # stdio 模式（默认，DSH 直连）
 *   node src/index.js --sse    # SSE 模式（远程连接）
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { PDFDocument, degrees } from "pdf-lib";
import pdfParse from "pdf-parse";

// ─── 工具定义 ─────────────────────────────────────────────

const server = new McpServer({
  name: "pdf-extractor",
  version: "1.0.0",
});

/**
 * 解析页码规格为有序数组
 * 支持: "5" | "3-7" | "1,3,5-8,10" | "*" | "all"
 */
function parsePages(spec, total) {
  spec = String(spec).trim().toLowerCase();
  if (spec === "*" || spec === "all") {
    return Array.from({ length: total }, (_, i) => i);
  }

  const result = [];
  for (const part of spec.split(",")) {
    const p = part.trim();
    if (p.includes("-")) {
      const [s, e] = p.split("-").map(Number);
      const start = Math.max(1, s);
      const end = Math.min(total, e);
      for (let i = start; i <= end; i++) result.push(i - 1); // 0-based
    } else {
      const n = Number(p);
      if (n >= 1 && n <= total) result.push(n - 1);
    }
  }
  return [...new Set(result)].sort((a, b) => a - b);
}

/** 读取 PDF 文件 */
async function readPdf(filePath) {
  const data = await fs.promises.readFile(filePath);
  return pdfParse(data);
}

// ─── Tool 1: 提取指定页面 ──────────────────────────────────

server.tool(
  "extract_pages",
  "从 PDF 文件提取指定页面，保存为新 PDF。支持页码范围和组合选择。",
  {
    input_path: z.string().describe("输入 PDF 文件的绝对路径"),
    pages: z.string().describe('页码规格，如 "2-5", "1,3,8-10", "*" 表示全部'),
    output_path: z.string().optional().describe("输出文件路径（可选，默认自动生成）"),
    password: z.string().optional().describe("PDF 密码（如加密）"),
  },
  async ({ input_path, pages, output_path, password }) => {
    try {
      const data = await fs.promises.readFile(input_path);
      let srcDoc;
      try {
        srcDoc = await PDFDocument.load(data, { password: password || undefined });
      } catch (e) {
        if (e.message?.includes("password")) {
          return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "PasswordRequiredError", message: "该 PDF 已加密，请提供 --password 参数" }) }] };
        }
        throw e;
      }

      const totalPages = srcDoc.getPageCount();
      const pageIndices = parsePages(pages, totalPages);

      if (pageIndices.length === 0) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "PageOutOfRangeError", message: `页码 "${pages}" 超出范围（共 ${totalPages} 页）`, valid_range: `1-${totalPages}` }) }] };
      }

      const newDoc = await PDFDocument.create();
      const copiedPages = await newDoc.copyPages(srcDoc, pageIndices);
      for (const page of copiedPages) {
        newDoc.addPage(page);
      }

      const outPath = output_path || defaultOutput(input_path, `_第${pages}页.pdf`);
      const pdfBytes = await newDoc.save();
      await fs.promises.writeFile(outPath, pdfBytes);

      const sizeKB = Math.round(pdfBytes.length / 1024 * 10) / 10;
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true, action: "extract",
            input_file: input_path,
            pages_selected: pageIndices.map(i => i + 1),
            page_count: pageIndices.length,
            output_file: outPath,
            size_kb: sizeKB,
            message: `已提取 ${pageIndices.length} 页 → ${outPath} (${sizeKB} KB)`,
          }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.name || "Error", message: err.message }) }] };
    }
  }
);

// ─── Tool 2: 拆分为单页 ZIP ────────────────────────────────

server.tool(
  "split_pdf",
  "将 PDF 每页拆分为独立文件，打包为一个 ZIP 下载。",
  {
    input_path: z.string().describe("输入 PDF 文件的绝对路径"),
    output_dir: z.string().optional().describe("输出目录（可选，默认当前目录）"),
    password: z.string().optional().describe("PDF 密码"),
  },
  async ({ input_path, output_dir, password }) => {
    try {
      // 动态 import JSZip（ESM）
      const { default: JSZip } = await import("jszip");
      const data = await fs.promises.readFile(input_path);
      const srcDoc = await PDFDocument.load(data, { password: password || undefined });
      const totalPages = srcDoc.getPageCount();
      const stem = path.basename(input_path, path.extname(input_path));
      const outDir = output_dir || path.dirname(input_path);

      const zip = new JSZip();
      for (let i = 0; i < totalPages; i++) {
        const newDoc = await PDFDocument.create();
        const [copied] = await newDoc.copyPages(srcDoc, [i]);
        newDoc.addPage(copied);
        const pdfBytes = await newDoc.save();
        zip.file(`${stem}_p${i + 1}.pdf`, pdfBytes);
      }

      const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
      const zipPath = path.join(outDir, `${stem}_split.zip`);
      await fs.promises.writeFile(zipPath, zipBuffer);

      const sizeKB = Math.round(zipBuffer.length / 1024 * 10) / 10;
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true, action: "split",
            input_file: input_path,
            total_pages: totalPages,
            output_file: zipPath,
            size_kb: sizeKB,
            message: `已拆分为 ${totalPages} 个单页 → ${zipPath} (${sizeKB} KB)`,
          }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.name || "Error", message: err.message }) }] };
    }
  }
);

// ─── Tool 3: 合并多个 PDF ──────────────────────────────────

server.tool(
  "merge_pdfs",
  "将多个 PDF 文件按顺序合并为一个 PDF。",
  {
    input_paths: z.array(z.string()).describe("输入 PDF 文件路径列表（按合并顺序）"),
    output_path: z.string().optional().describe("输出路径（可选，默认 merged_output.pdf）"),
  },
  async ({ input_paths, output_path }) => {
    try {
      const merged = await PDFDocument.create();
      let total = 0;

      for (const filePath of input_paths) {
        const data = await fs.promises.readFile(filePath);
        const doc = await PDFDocument.load(data);
        const indices = Array.from({ length: doc.getPageCount() }, (_, i) => i);
        const pages = await merged.copyPages(doc, indices);
        for (const p of pages) merged.addPage(p);
        total += doc.getPageCount();
      }

      const outPath = output_path || "merged_output.pdf";
      const pdfBytes = await merged.save();
      await fs.promises.writeFile(outPath, pdfBytes);

      const sizeKB = Math.round(pdfBytes.length / 1024 * 10) / 10;
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true, action: "merge",
            input_files: input_paths,
            file_count: input_paths.length,
            total_pages: total,
            output_file: outPath,
            size_kb: sizeKB,
            message: `已合并 ${input_paths.length} 个文件（${total} 页）→ ${outPath} (${sizeKB} KB)`,
          }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.name || "Error", message: err.message }) }] };
    }
  }
);

// ─── Tool 4: 旋转指定页面 ──────────────────────────────────

server.tool(
  "rotate_pages",
  "将 PDF 中指定的页面旋转 90°、180° 或 270°。",
  {
    input_path: z.string().describe("输入 PDF 文件路径"),
    pages: z.string().describe('要旋转的页码规格，如 "2,4" 或 "1-3"'),
    degrees: z.number().int().default(90).describe("旋转角度：90 | 180 | 270"),
    output_path: z.string().optional().describe("输出路径（可选）"),
    password: z.string().optional().describe("PDF 密码"),
  },
  async ({ input_path, pages, degrees = 90, output_path, password }) => {
    try {
      const data = await fs.promises.readFile(input_path);
      const srcDoc = await PDFDocument.load(data, { password: password || undefined });
      const totalPages = srcDoc.getPageCount();
      const pageIndices = parsePages(pages, totalPages);

      for (const idx of pageIndices) {
        const page = srcDoc.getPage(idx);
        page.setRotation(degrees(degrees));
      }

      const outPath = output_path || defaultOutput(input_path, `_旋转${degrees}度.pdf`);
      const pdfBytes = await srcDoc.save();
      await fs.promises.writeFile(outPath, pdfBytes);

      const sizeKB = Math.round(pdfBytes.length / 1024 * 10) / 10;
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true, action: "rotate",
            input_file: input_path,
            pages_rotated: pageIndices.map(i => i + 1),
            degrees,
            output_file: outPath,
            size_kb: sizeKB,
            message: `已旋转 ${pageIndices.length} 页（${degrees}°）→ ${outPath} (${sizeKB} KB)`,
          }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.name || "Error", message: err.message }) }] };
    }
  }
);

// ─── 辅助函数 ───────────────────────────────────────────────

function defaultOutput(inputPath, suffix) {
  const dir = path.dirname(inputPath);
  const stem = path.basename(inputPath, path.extname(inputPath));
  return path.join(dir, `${stem}${suffix}`);
}

// ─── 启动服务器 ────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes("--sse")) {
  // SSE 模式（用于远程连接）
  const port = parseInt(process.env.MCP_PORT || "3000", 10);
  const transport = new SSEServerTransport("/message");
  
  // 需要用 http server 包装，这里简化为提示
  console.error(`[pdf-extractor-mcp] SSE mode requires HTTP server wrapper.`);
  console.error(`For DSH integration, use stdio mode instead.`);
  process.exit(1);
} else {
  // stdio 模式（DSH 默认连接方式）
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
