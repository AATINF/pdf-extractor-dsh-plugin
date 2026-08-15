#!/usr/bin/env python3
"""
PDF 页面提取器 — DSH Skill 命令行工具
复刻 pdf-page-extractor 核心逻辑，供 DeepSeek Harness Agent 调用。

用法:
    python pdf_tool.py extract  --input <file> --pages <spec> [--output <file>] [--password <pw>]
    python pdf_tool.py split   --input <file> [--output-dir <dir>]  [--password <pw>]
    python pdf_tool.py merge   --inputs <file1> <file2> ... [--output <file>]
    python pdf_tool.py rotate  --input <file> --pages <spec> --degrees <90|180|270> [--output <file>] [--password <pw>]

依赖: pip install pypdf (PDF操作核心)
"""

import argparse
import io
import json
import os
import sys
import zipfile
from pathlib import Path

# 优先 pypdf，回退 PyPDF2（两者 API 兼容）
try:
    from pypdf import PdfReader, PdfWriter
    PDF_LIB = "pypdf"
except ImportError:
    try:
        from PyPDF2 import PdfReader, PdfWriter
        PDF_LIB = "PyPDF2"
    except ImportError:
        PdfReader = None
        PdfWriter = None
        PDF_LIB = None


def check_deps():
    """检查依赖是否可用。"""
    return PDF_LIB is not None, PDF_LIB


def parse_pages(spec: str, total_pages: int) -> list[int]:
    """
    解析页码规格为有序列表。
    支持格式: "5", "3-7", "1,3,5-8,10", "*", "all"
    非法 token（非数字、越界）会被安全忽略。
    """
    spec = spec.strip().lower()
    if spec in ("*", "all"):
        return list(range(1, total_pages + 1))

    result = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            if "-" in part:
                start, end = part.split("-", 1)
                start, end = int(start), int(end)
                if start < 1:
                    start = 1
                if end > total_pages:
                    end = total_pages
                result.extend(range(start, end + 1))
            else:
                result.append(int(part))
        except ValueError:
            # 非数字 token（如 "1,a"）安全忽略，不中断
            continue

    # 去重、排序、范围校验
    result = sorted(set(p for p in result if 1 <= p <= total_pages))
    return result


def cmd_extract(args):
    """提取指定页面为新 PDF。"""
    reader = PdfReader(args.input, password=args.password or None)
    total = len(reader.pages)
    pages = parse_pages(args.pages, total)

    writer = PdfWriter()
    for p in pages:
        writer.add_page(reader.pages[p - 1])

    output = args.output or _default_output(args.input, f"_第{args.pages}页.pdf")
    with open(output, "wb") as f:
        writer.write(f)

    size_kb = os.path.getsize(output) / 1024
    print(json_output(
        success=True,
        action="extract",
        input_file=args.input,
        pages=pages,
        output_file=output,
        size_kb=round(size_kb, 1),
        message=f"已提取 {len(pages)} 页 → {output} ({round(size_kb, 1)} KB)"
    ))


def cmd_split(args):
    """拆分 PDF 为单页 ZIP。"""
    reader = PdfReader(args.input, password=args.password or None)
    total = len(reader.pages)
    out_dir = Path(args.output_dir or ".")
    out_dir.mkdir(parents=True, exist_ok=True)

    zip_path = out_dir / f"{Path(args.input).stem}_split.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for i in range(total):
            writer = PdfWriter()
            writer.add_page(reader.pages[i])
            buf = io.BytesIO()
            writer.write(buf)
            name = f"{Path(args.input).stem}_p{i+1}.pdf"
            zf.writestr(name, buf.getvalue())

    size_kb = os.path.getsize(zip_path) / 1024
    print(json_output(
        success=True,
        action="split",
        input_file=args.input,
        total_pages=total,
        output_file=str(zip_path),
        size_kb=round(size_kb, 1),
        message=f"已拆分为 {total} 个单页 → {zip_path} ({round(size_kb, 1)} KB)"
    ))


def cmd_merge(args):
    """合并多个 PDF 为一个。"""
    writer = PdfWriter()
    total_pages = 0

    for inp in args.inputs:
        reader = PdfReader(inp)
        total_pages += len(reader.pages)
        for page in reader.pages:
            writer.add_page(page)

    # 默认输出到第一个输入文件同目录（与 extract/split/rotate 行为一致）
    output = args.output or _default_output(args.inputs[0], "_merged.pdf")
    with open(output, "wb") as f:
        writer.write(f)

    size_kb = os.path.getsize(output) / 1024
    print(json_output(
        success=True,
        action="merge",
        input_files=args.inputs,
        total_pages=total_pages,
        output_file=output,
        size_kb=round(size_kb, 1),
        message=f"已合并 {len(args.inputs)} 个文件（{total_pages} 页）→ {output} ({round(size_kb, 1)} KB)"
    ))


def cmd_rotate(args):
    """旋转指定页面。"""
    reader = PdfReader(args.input, password=args.password or None)
    total = len(reader.pages)
    pages = parse_pages(args.pages, total)
    degrees = args.degrees or 90

    writer = PdfWriter()
    for i, page in enumerate(reader.pages):
        if (i + 1) in pages:
            # pypdf / PyPDF2 兼容：累加 rotation 属性（避免已弃用的 page.rotate）
            page.rotation = (page.rotation + degrees) % 360
        writer.add_page(page)

    output = args.output or _default_output(args.input, f"_旋转{degrees}度.pdf")
    with open(output, "wb") as f:
        writer.write(f)

    size_kb = os.path.getsize(output) / 1024
    print(json_output(
        success=True,
        action="rotate",
        input_file=args.input,
        pages=pages,
        degrees=degrees,
        output_file=output,
        size_kb=round(size_kb, 1),
        message=f"已旋转 {len(pages)} 页（{degrees}°）→ {output} ({round(size_kb, 1)} KB)"
    ))


def _default_output(input_path: str, suffix: str) -> str:
    """生成默认输出路径。"""
    stem = Path(input_path).stem
    return str(Path(input_path).parent / f"{stem}{suffix}")


def json_output(**kwargs) -> str:
    """返回结构化 JSON 结果（便于 Agent 解析）。"""
    return json.dumps(kwargs, ensure_ascii=False, indent=2)


def main():
    parser = argparse.ArgumentParser(
        description="PDF 页面提取器 — DSH Skill CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python pdf_tool.py extract --input report.pdf --pages "1,3,5-8"
  python pdf_tool.py split --input contract.pdf --output-dir ./output
  python pdf_tool.py merge --inputs a.pdf b.pdf c.pdf
  python pdf_tool.py rotate --input scan.pdf --pages "2,4" --degrees 90
        """,
    )
    sub = parser.add_subparsers(dest="command", help="命令")

    # extract
    p_ex = sub.add_parser("extract", help="提取指定页面")
    p_ex.add_argument("--input", required=True, help="输入 PDF 路径")
    p_ex.add_argument("--pages", required=True, help='页码规格: "1,3,5-8" 或 "*"')
    p_ex.add_argument("--output", default="", help="输出路径（可选）")
    p_ex.add_argument("--password", default="", help="PDF 密码（如加密）")

    # split
    p_sp = sub.add_parser("split", help="拆分为单页 ZIP")
    p_sp.add_argument("--input", required=True, help="输入 PDF 路径")
    p_sp.add_argument("--output-dir", default="", help="输出目录（可选）")
    p_sp.add_argument("--password", default="", help="PDF 密码")

    # merge
    p_me = sub.add_parser("merge", help="合并多个 PDF")
    p_me.add_argument("--inputs", nargs="+", required=True, help="输入 PDF 文件列表")
    p_me.add_argument("--output", default="", help="输出路径（可选）")

    # rotate
    p_ro = sub.add_parser("rotate", help="旋转指定页面")
    p_ro.add_argument("--input", required=True, help="输入 PDF 路径")
    p_ro.add_argument("--pages", required=True, help='页码规格: "2,4" 或 "1-3"')
    p_ro.add_argument("--degrees", type=int, default=90, choices=[90, 180, 270], help="旋转角度")
    p_ro.add_argument("--output", default="", help="输出路径（可选）")
    p_ro.add_argument("--password", default="", help="PDF 密码")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    # 检查依赖
    ok, lib = check_deps()
    if not ok:
        print(json_output(
            success=False,
            error="DependencyMissingError",
            message="需要安装 pypdf: pip install pypdf"
        ))
        sys.exit(1)

    # 检查输入文件存在
    if args.command != "merge":
        if not os.path.isfile(args.input):
            print(json_output(
                success=False,
                error="FileNotFoundError",
                message=f"文件不存在: {args.input}"
            ))
            sys.exit(1)
    else:
        for f in args.inputs:
            if not os.path.isfile(f):
                print(json_output(
                    success=False,
                    error="FileNotFoundError",
                    message=f"文件不存在: {f}"
                ))
                sys.exit(1)

    dispatch = {
        "extract": cmd_extract,
        "split": cmd_split,
        "merge": cmd_merge,
        "rotate": cmd_rotate,
    }
    dispatch[args.command](args)


if __name__ == "__main__":
    main()
