#!/usr/bin/env python3
"""Markdown + 图片 → PDF 转换器（paper-lens 专用）。

用法:
    python3 md_to_pdf.py <markdown_path> [-o output.pdf] [--style academic|clean|compact] [--open]

依赖:
    pip install pymupdf markdown pygments
    可选: pip install matplotlib (支持 LaTeX 公式渲染为图片)
"""

import argparse
import base64
import io
import os
import re
import sys

import fitz  # PyMuPDF
import markdown
from markdown.extensions.codehilite import CodeHiliteExtension
from markdown.extensions.tables import TableExtension
from markdown.extensions.fenced_code import FencedCodeExtension
from markdown.extensions.toc import TocExtension


# ---------------------------------------------------------------------------
# LaTeX 公式渲染（可选，需要 matplotlib）
# ---------------------------------------------------------------------------

_HAS_MATPLOTLIB = False
try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    _HAS_MATPLOTLIB = True
except ImportError:
    print("提示：未安装 matplotlib，LaTeX 公式将以文本形式显示。安装命令：pip install matplotlib", file=sys.stderr)


def render_latex_to_base64(latex_str, fontsize=13, dpi=180, display=False):
    """用 matplotlib 将 LaTeX 字符串渲染为 PNG base64。

    先用估算尺寸渲染一次，再用 get_tightbbox() 获取实际尺寸重新裁剪，
    避免公式周围出现大面积留白。
    """
    if not _HAS_MATPLOTLIB:
        return None
    try:
        # 第一轮：用宽裕的画布渲染，获取实际 bbox
        init_w = min(max(len(latex_str) * 0.15, 2.0), 8.0)
        init_h = 1.5 if display else 0.8
        actual_fontsize = fontsize if display else fontsize - 2
        fig, ax = plt.subplots(figsize=(init_w, init_h))
        text_obj = ax.text(
            0.5, 0.5, f"${latex_str}$",
            fontsize=actual_fontsize,
            ha="center", va="center",
            transform=ax.transAxes,
        )
        ax.axis("off")

        # 获取渲染器以计算实际文本边界
        renderer = fig.canvas.get_renderer()
        bbox = text_obj.get_window_extent(renderer)
        # 转换为英寸并加少量 padding
        bbox_inches = bbox.transformed(fig.dpi_scale_trans.inverted())
        pad = 0.08
        fit_w = max(bbox_inches.width + pad * 2, 0.5)
        fit_h = max(bbox_inches.height + pad * 2, 0.3)
        plt.close(fig)

        # 第二轮：用精确尺寸重新渲染
        fig, ax = plt.subplots(figsize=(fit_w, fit_h))
        ax.text(
            0.5, 0.5, f"${latex_str}$",
            fontsize=actual_fontsize,
            ha="center", va="center",
            transform=ax.transAxes,
        )
        ax.axis("off")
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=dpi, bbox_inches="tight",
                    transparent=True, pad_inches=0.05)
        plt.close(fig)
        buf.seek(0)
        return base64.b64encode(buf.read()).decode()
    except Exception:
        return None


def preprocess_latex(md_text):
    """将 $$...$$ 和 $...$ 中的 LaTeX 渲染为内嵌 base64 图片。

    如果 matplotlib 不可用，保留原始 LaTeX 文本（用等宽字体显示）。
    """
    # 1. 块级公式 $$...$$
    def replace_display(m):
        latex = m.group(1).strip()
        b64 = render_latex_to_base64(latex, fontsize=14, display=True)
        if b64:
            return f'\n<div style="text-align:center;margin:8px 0;"><img src="data:image/png;base64,{b64}" style="max-width:90%;"></div>\n'
        return f'\n<div style="text-align:center;margin:12px 0;padding:10px 16px;background:#f7f9fc;font-family:monospace;font-size:10pt;color:#2d5986;">{_escape_html(latex)}</div>\n'

    md_text = re.sub(r"\$\$(.+?)\$\$", replace_display, md_text, flags=re.DOTALL)

    # 2. 行内公式 $...$（排除 $` 和已处理的 $$）
    def replace_inline(m):
        latex = m.group(1).strip()
        if not latex:
            return m.group(0)
        b64 = render_latex_to_base64(latex, fontsize=12, display=False)
        if b64:
            return f'<img src="data:image/png;base64,{b64}" style="vertical-align:middle;height:1.2em;">'
        return f'<code style="font-size:9pt;color:#2d5986;background:#eef2f7;padding:1px 4px;">{_escape_html(latex)}</code>'

    md_text = re.sub(r"(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)", replace_inline, md_text)

    return md_text


def _escape_html(text):
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


# ---------------------------------------------------------------------------
# 图片路径处理
# ---------------------------------------------------------------------------

def resolve_image_paths(html, base_dir):
    """检查 HTML 中的图片路径，标记缺失图片。

    实际图片加载由 PyMuPDF Archive 处理（保留相对路径）。
    仅对不存在的图片生成警告占位。
    """
    def replace_src(m):
        prefix = m.group(1)
        src = m.group(2)
        if src.startswith(("http://", "https://", "data:")):
            return m.group(0)
        abs_path = os.path.abspath(os.path.join(base_dir, src))
        if os.path.isfile(abs_path):
            return m.group(0)  # 保留相对路径，由 Archive 加载
        return f'{prefix}data:," alt="[图片缺失: {src}]"'

    return re.sub(r'(src=")([^"]+)"', replace_src, html)


# ---------------------------------------------------------------------------
# Markdown → HTML
# ---------------------------------------------------------------------------

def markdown_to_html(md_text):
    """将 Markdown 文本转为 HTML（含表格、代码高亮等）。"""
    extensions = [
        TableExtension(),
        FencedCodeExtension(),
        CodeHiliteExtension(css_class="highlight", guess_lang=True, noclasses=True),
        TocExtension(permalink=False),
        "markdown.extensions.sane_lists",
    ]
    return markdown.markdown(md_text, extensions=extensions)


# ---------------------------------------------------------------------------
# CSS 样式
# ---------------------------------------------------------------------------

STYLES = {
    "academic": {
        "name": "学术风格",
        "css": """
body {
    font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
    font-size: 10.5pt;
    color: #1a1a2e;
    line-height: 1.75;
}

/* 标题层级 */
h1 {
    font-size: 22pt;
    color: #1a3a5c;
    text-align: center;
    border-bottom: 3px solid #2d5986;
    padding-bottom: 8px;
    margin-bottom: 16px;
    margin-top: 24px;
}
h2 {
    font-size: 15pt;
    color: #1a3a5c;
    border-bottom: 2px solid #2d5986;
    padding-bottom: 5px;
    margin-top: 28px;
    margin-bottom: 10px;
}
h3 {
    font-size: 12.5pt;
    color: #2d5986;
    border-left: 3px solid #2d5986;
    padding-left: 8px;
    margin-top: 16px;
    margin-bottom: 6px;
}
h4 {
    font-size: 11pt;
    color: #4a5568;
    margin-top: 12px;
    margin-bottom: 4px;
}
p {
    margin: 4px 0 8px 0;
    text-align: justify;
}
strong { color: #1a1a2e; }
em { color: #4a5568; }
a { color: #2d5986; }

/* 引用块：渐变背景 + 圆角 */
blockquote {
    border-left: 3px solid #2d5986;
    background: linear-gradient(135deg, #f0f4f8 0%, #e8eef5 100%);
    padding: 10px 14px;
    margin: 10px 0;
    color: #2d3748;
    font-size: 9.5pt;
}
blockquote p { margin: 2px 0; }

/* 表格：现代无边框风格 */
table {
    border-collapse: collapse;
    width: 100%;
    margin: 10px 0;
    font-size: 9pt;
}
th {
    background: linear-gradient(135deg, #2d5986 0%, #3a6f9f 100%);
    color: white;
    border: none;
    padding: 7px 10px;
    text-align: left;
    font-weight: bold;
}
td {
    border: none;
    border-bottom: 1px solid #e2e8f0;
    padding: 6px 10px;
}
tr:nth-child(even) td {
    background: #f7f9fc;
}
tr:last-child td {
    border-bottom: 2px solid #2d5986;
}

/* 代码：深色主题 */
code {
    font-family: "SF Mono", "Menlo", "Consolas", monospace;
    font-size: 9pt;
    background: #eef2f7;
    padding: 1px 4px;
    color: #c7254e;
}
pre {
    background: #1e293b;
    padding: 12px 14px;
    margin: 8px 0;
    font-size: 8.5pt;
    line-height: 1.5;
}
pre code {
    background: none;
    padding: 0;
    color: #e2e8f0;
}

/* 列表：三角标记 */
ul {
    margin: 4px 0 8px 0;
    padding-left: 20px;
    list-style: none;
}
ul > li::before {
    content: "\\25b8 ";
    color: #2d5986;
    font-size: 8pt;
}
ol {
    margin: 4px 0 8px 0;
    padding-left: 20px;
}
li {
    margin: 2px 0;
    line-height: 1.6;
}

/* 分隔线：渐变线 */
hr {
    border: none;
    height: 1px;
    background: linear-gradient(to right, #2d5986, #d0d7de, transparent);
    margin: 20px 0;
}

/* 图片 */
img {
    max-width: 100%;
}
""",
    },
    "clean": {
        "name": "简洁风格",
        "css": """
body {
    font-family: "PingFang SC", "Helvetica Neue", sans-serif;
    font-size: 10.5pt;
    color: #333;
    line-height: 1.65;
}
h1 { font-size: 19pt; color: #111; margin-top: 18px; margin-bottom: 10px; }
h2 { font-size: 14pt; color: #333; margin-top: 16px; margin-bottom: 8px; border-bottom: 1px solid #eee; padding-bottom: 4px; }
h3 { font-size: 12pt; color: #444; margin-top: 12px; margin-bottom: 6px; }
h4 { font-size: 11pt; color: #555; margin-top: 10px; margin-bottom: 4px; }
p { margin: 4px 0 8px 0; }
blockquote { border-left: 3px solid #ddd; padding: 6px 12px; margin: 6px 0; color: #555; background: #fafafa; }
blockquote p { margin: 2px 0; }
table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 9.5pt; }
th { background: #f5f5f5; border: 1px solid #ddd; padding: 5px 8px; text-align: left; font-weight: bold; }
td { border: 1px solid #ddd; padding: 5px 8px; }
tr:nth-child(even) td { background: #fafafa; }
code { font-family: "Menlo", monospace; font-size: 9pt; background: #f5f5f5; padding: 1px 3px; }
pre { background: #f5f5f5; padding: 8px 10px; margin: 6px 0; font-size: 8.5pt; }
pre code { background: none; padding: 0; }
ul, ol { margin: 4px 0 8px 0; padding-left: 20px; }
li { margin: 2px 0; }
hr { border: none; border-top: 1px solid #eee; margin: 10px 0; }
img { max-width: 100%; }
""",
    },
    "compact": {
        "name": "紧凑风格",
        "css": """
body {
    font-family: "PingFang SC", sans-serif;
    font-size: 9.5pt;
    color: #333;
    line-height: 1.5;
}
h1 { font-size: 16pt; color: #222; margin-top: 12px; margin-bottom: 6px; border-bottom: 2px solid #333; }
h2 { font-size: 12.5pt; color: #333; margin-top: 10px; margin-bottom: 5px; }
h3 { font-size: 11pt; color: #444; margin-top: 8px; margin-bottom: 4px; }
h4 { font-size: 10pt; color: #555; margin-top: 6px; margin-bottom: 3px; }
p { margin: 2px 0 5px 0; }
blockquote { border-left: 2px solid #999; padding: 4px 8px; margin: 4px 0; color: #555; font-size: 9pt; }
blockquote p { margin: 1px 0; }
table { border-collapse: collapse; width: 100%; margin: 4px 0; font-size: 8.5pt; }
th { background: #eee; border: 1px solid #ccc; padding: 3px 6px; text-align: left; }
td { border: 1px solid #ccc; padding: 3px 6px; }
code { font-family: "Menlo", monospace; font-size: 8pt; background: #f0f0f0; padding: 1px 2px; }
pre { background: #f5f5f5; padding: 6px 8px; margin: 4px 0; font-size: 8pt; line-height: 1.4; }
pre code { background: none; padding: 0; }
ul, ol { margin: 2px 0 5px 0; padding-left: 16px; }
li { margin: 1px 0; }
hr { border: none; border-top: 1px solid #ddd; margin: 6px 0; }
img { max-width: 100%; }
""",
    },
}


def get_css(style_name):
    return STYLES.get(style_name, STYLES["academic"])["css"]


# ---------------------------------------------------------------------------
# HTML → PDF（PyMuPDF Story API）
# ---------------------------------------------------------------------------

def html_to_pdf(html, css, output_path, title="", margin=56, base_dir=None):
    """用 PyMuPDF Story API 将 HTML+CSS 渲染为 PDF。

    Args:
        html: 完整 HTML body 内容
        css: CSS 样式文本
        output_path: 输出 PDF 路径
        title: PDF 元数据标题
        margin: 页边距（pt, 默认 56pt ≈ 2cm）
        base_dir: 图片相对路径的基准目录
    """
    archive = fitz.Archive(base_dir) if base_dir else None
    story = fitz.Story(html, user_css=css, archive=archive)
    writer = fitz.DocumentWriter(output_path)
    mediabox = fitz.paper_rect("a4")  # A4: 595 x 842 pt
    content_rect = mediabox + (margin, margin, -margin, -margin)

    page_count = 0
    more = True
    while more:
        dev = writer.begin_page(mediabox)
        more, _ = story.place(content_rect)
        story.draw(dev)
        writer.end_page()
        page_count += 1

    writer.close()

    # 添加页码：需要先读入再写到新文件
    tmp_path = output_path + ".tmp"
    try:
        doc = fitz.open(output_path)
        doc.set_metadata({"title": title, "producer": "paper-lens md_to_pdf"})
        for i, page in enumerate(doc):
            footer_rect = fitz.Rect(
                margin, mediabox.height - margin + 10,
                mediabox.width - margin, mediabox.height - 15
            )
            page.insert_textbox(
                footer_rect,
                f"— {i + 1} / {page_count} —",
                fontsize=8,
                color=(0.5, 0.5, 0.5),
                align=fitz.TEXT_ALIGN_CENTER,
            )
        doc.save(tmp_path, deflate=True, garbage=4)
        doc.close()
        os.replace(tmp_path, output_path)
    except Exception:
        # 确保临时文件被清理
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise

    return page_count


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------

def convert(md_path, output_path=None, style="academic", open_after=False):
    """主转换函数。"""
    md_path = os.path.abspath(md_path)
    base_dir = os.path.dirname(md_path)

    if output_path is None:
        output_path = os.path.splitext(md_path)[0] + ".pdf"
    output_path = os.path.abspath(output_path)

    # 读取 Markdown
    with open(md_path, "r", encoding="utf-8") as f:
        md_text = f.read()

    # 从第一个 # 标题提取文档标题
    title_match = re.search(r"^#\s+(.+)$", md_text, re.MULTILINE)
    title = title_match.group(1).strip() if title_match else os.path.basename(md_path)

    print(f"输入：{md_path}")
    print(f"样式：{STYLES[style]['name']}")

    # Step 1: LaTeX 预处理
    if _HAS_MATPLOTLIB:
        print("公式渲染：matplotlib（LaTeX → PNG）")
        md_text = preprocess_latex(md_text)
    else:
        print("公式渲染：纯文本（安装 matplotlib 可渲染为数学符号）")
        # 简单处理：块级公式用 code block 展示
        md_text = re.sub(
            r"\$\$(.+?)\$\$",
            lambda m: f'\n```\n{m.group(1).strip()}\n```\n',
            md_text, flags=re.DOTALL
        )

    # Step 2: Markdown → HTML
    body_html = markdown_to_html(md_text)

    # Step 3: 解析图片路径
    body_html = resolve_image_paths(body_html, base_dir)

    # Step 4: 获取 CSS
    css = get_css(style)

    # Step 5: 渲染 PDF
    print(f"渲染中...")
    page_count = html_to_pdf(body_html, css, output_path, title=title, base_dir=base_dir)

    file_size = os.path.getsize(output_path)
    size_str = f"{file_size / 1024:.0f} KB" if file_size < 1024 * 1024 else f"{file_size / 1024 / 1024:.1f} MB"
    print(f"输出：{output_path}")
    print(f"页数：{page_count} 页 | 大小：{size_str}")

    if open_after:
        import platform
        import subprocess
        system = platform.system()
        if system == "Darwin":
            subprocess.Popen(["open", output_path])
        elif system == "Linux":
            subprocess.Popen(["xdg-open", output_path])
        elif system == "Windows":
            os.startfile(output_path)
        else:
            print(f"无法自动打开：不支持的平台 {system}，请手动打开 {output_path}", file=sys.stderr)
        print("已在默认应用中打开")

    return output_path, page_count


def main():
    parser = argparse.ArgumentParser(
        description="paper-lens Markdown → PDF 转换器",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="示例:\n"
               "  python3 md_to_pdf.py notes/deep-learn.md\n"
               "  python3 md_to_pdf.py notes/speed-read.md --style clean --open\n"
               "  python3 md_to_pdf.py notes/slides-content.md -o presentation.pdf\n",
    )
    parser.add_argument("markdown_path", help="Markdown 文件路径")
    parser.add_argument("-o", "--output", help="输出 PDF 路径（默认同名 .pdf）")
    parser.add_argument(
        "--style",
        choices=list(STYLES.keys()),
        default="academic",
        help="排版样式（默认 academic）",
    )
    parser.add_argument("--open", action="store_true", help="生成后自动打开")
    args = parser.parse_args()

    if not os.path.isfile(args.markdown_path):
        print(f"错误：文件不存在 — {args.markdown_path}", file=sys.stderr)
        sys.exit(1)

    convert(args.markdown_path, args.output, args.style, args.open)


if __name__ == "__main__":
    main()
