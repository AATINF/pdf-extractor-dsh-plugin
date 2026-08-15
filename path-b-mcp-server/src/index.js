/**
 * PDF Extractor MCP Server
 *
 * 标准 MCP (Model Context Protocol) Server 实现。
 * 暴露 4 个工具：extract_pages / split_pdf / merge_pdfs / rotate_pages
 * 供 DeepSeek Harness 或任何 MCP Client 调用。
 *
 * 运行方式:
 *   node src/index.js          # stdio 模式（默认，DSH 直连）
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { PDFDocument, degrees as pdfDegrees } from "pdf-lib";

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

// ─── Tool 1: 提取指定页面 ──────────────────────────────────

server.tool(
  "extract_pages",
  "从 PDF 文件提取指定页面，保存为新 PDF。支持页码范围和组合选择。",
  {
    input_path: z.string().describe("输入 PDF 文件的绝对路径"),
    pages: z.string().describe('页码规格，如 "2-5", "1,3,8-10", "*" 表示全部'),
    output_path: z.string().optional().describe("输出文件路径（可选，默认自动生成）"),
  },
  async ({ input_path, pages, output_path }) => {
    try {
      const data = await fs.promises.readFile(input_path);
      let srcDoc;
      try {
        srcDoc = await PDFDocument.load(data);
      } catch (e) {
        if (e.message?.toLowerCase().includes("encrypt")) {
          return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "EncryptedPDFError", message: "该 PDF 已加密。Path B 基于 pdf-lib，不支持密码解密，请先解密后再处理（Path A 基于 pypdf，支持 --password 参数）。" }) }] };
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
  },
  async ({ input_path, output_dir }) => {
    try {
      // 动态 import JSZip（ESM）
      const { default: JSZip } = await import("jszip");
      const data = await fs.promises.readFile(input_path);
      let srcDoc;
      try {
        srcDoc = await PDFDocument.load(data);
      } catch (e) {
        if (e.message?.toLowerCase().includes("encrypt")) {
          return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "EncryptedPDFError", message: "该 PDF 已加密。Path B 不支持密码解密，请先解密或用 Path A（pypdf，支持 --password）处理。" }) }] };
        }
        throw e;
      }
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
      await fs.promises.mkdir(outDir, { recursive: true });
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

      // 默认输出到第一个输入文件同目录（与 extract/split/rotate 行为一致）
      const outPath = output_path || defaultOutput(input_paths[0], "_merged.pdf");
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
  },
  async ({ input_path, pages, degrees = 90, output_path }) => {
    try {
      if (![90, 180, 270].includes(degrees)) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "InvalidDegreesError", message: `degrees 必须是 90/180/270，收到 ${degrees}` }) }] };
      }
      const data = await fs.promises.readFile(input_path);
      let srcDoc;
      try {
        srcDoc = await PDFDocument.load(data);
      } catch (e) {
        if (e.message?.toLowerCase().includes("encrypt")) {
          return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "EncryptedPDFError", message: "该 PDF 已加密。Path B 不支持密码解密，请先解密或用 Path A（pypdf，支持 --password）处理。" }) }] };
        }
        throw e;
      }
      const totalPages = srcDoc.getPageCount();
      const pageIndices = parsePages(pages, totalPages);

      for (const idx of pageIndices) {
        const page = srcDoc.getPage(idx);
        page.setRotation(pdfDegrees(degrees));
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

// ─── 启动服务器（stdio 模式，DSH 标准连接方式）─────────────

const transport = new StdioServerTransport();
await server.connect(transport);
