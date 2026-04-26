#!/usr/bin/env python3
"""从论文 PDF 中智能提取图表（矢量图 + 嵌入式位图）。

Part of paper-lens v1.0.0
https://github.com/anthropics/paper-lens

用法:
    python3 extract_figures.py <pdf_path> <output_dir> [--dpi 200]

依赖:
    pip install pymupdf
"""

try:
    import fitz
except ImportError:
    print("错误：需要安装 PyMuPDF。请运行：pip install pymupdf", file=__import__('sys').stderr)
    __import__('sys').exit(1)

import json
import os
import sys
import argparse


def merge_rects(rects, gap=15):
    """合并重叠或相邻的矩形（gap 为允许的最大间距，单位 pt）。"""
    if not rects:
        return []
    merged = [fitz.Rect(r) for r in rects]
    changed = True
    while changed:
        changed = False
        new_merged = []
        used = [False] * len(merged)
        for i in range(len(merged)):
            if used[i]:
                continue
            current = fitz.Rect(merged[i])
            expanded = current + (-gap, -gap, gap, gap)
            for j in range(i + 1, len(merged)):
                if used[j]:
                    continue
                if expanded.intersects(merged[j]):
                    current = current | merged[j]
                    expanded = current + (-gap, -gap, gap, gap)
                    used[j] = True
                    changed = True
            new_merged.append(current)
            used[i] = True
        merged = new_merged
    return merged


def find_caption_figures(page, page_num):
    """通过搜索 'Figure N:' caption 文本定位图表区域。

    返回 [(caption_text, caption_rect, figure_number), ...]
    """
    import re
    captions = []
    for pattern in ["Figure %d:", "Fig. %d:", "Table %d:"]:
        for n in range(1, 30):
            query = pattern % n
            hits = page.search_for(query)
            if hits:
                captions.append((query, hits[0], n))
    return captions


def extract_vector_figures(doc, output_dir, dpi=200, min_size=100, padding=30):
    """使用 cluster_drawings() 提取矢量图形（架构图、流程图等）。

    策略：
    1. cluster_drawings() 检测矢量路径簇 → 合并相邻簇 → 加 padding 渲染
    2. 对比 caption 位置：如果检测到的矢量簇宽度不足页面 60%，但同页有
       Figure/Table caption，尝试用全页宽重新裁切（处理跨栏大图）

    返回 (figures_list, covered_xrefs)，covered_xrefs 是被矢量图区域覆盖的嵌入图片 xref 集合。
    """
    figures = []
    covered_xrefs = set()  # 记录被矢量图区域覆盖的嵌入图片 xref，用于去重
    page_width_threshold = 0.6  # 如果图宽 < 页宽的 60%，可能是跨栏图被截了

    for page_num in range(len(doc)):
        page = doc[page_num]
        try:
            rects = page.cluster_drawings(x_tolerance=3, y_tolerance=3)
            big_rects = [r for r in rects if r.width >= min_size and r.height >= min_size]
            merged = merge_rects(big_rects, gap=20)

            # 检测该页的 caption 位置
            captions = find_caption_figures(page, page_num)
            page_w = page.rect.width

            # 尝试将嵌入图片的位置也纳入合并
            img_rects = []
            img_xref_map = {}  # rect → xref 映射，用于追踪哪些嵌入图片被矢量图覆盖
            for img in page.get_images(full=True):
                for r in page.get_image_rects(img[0]):
                    if r.width >= 20 and r.height >= 20:
                        img_rects.append(r)
                        img_xref_map[id(r)] = img[0]

            for idx, rect in enumerate(merged):
                # 合并附近的嵌入图片位置
                nearby_img_rects = [r for r in img_rects
                                    if abs(r.y0 - rect.y0) < rect.height * 1.2
                                    and r.x0 < rect.x1 + 50]
                combined = [rect] + nearby_img_rects
                if len(combined) > 1:
                    union = fitz.Rect(combined[0])
                    for r in combined[1:]:
                        union = union | r
                    rect = union
                    # 记录被矢量图覆盖的嵌入图片 xref
                    for r in nearby_img_rects:
                        xref = img_xref_map.get(id(r))
                        if xref is not None:
                            covered_xrefs.add(xref)

                # 如果图很窄但页上有 caption，可能是跨栏图被截了
                if rect.width < page_w * page_width_threshold and captions:
                    # 找最近的 caption
                    for cap_text, cap_rect, cap_num in captions:
                        if abs(cap_rect.y0 - rect.y1) < 80:
                            # caption 在图下方不远处，扩展到全页宽
                            margin_x = min(rect.x0, 54)
                            rect = fitz.Rect(
                                margin_x,
                                rect.y0,
                                page_w - margin_x,
                                cap_rect.y1
                            )
                            break

                rect = (rect + (-padding, -padding, padding, padding)) & page.rect
                zoom = dpi / 72
                pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=rect)
                filename = f"p{page_num+1}_vec{idx+1}.png"
                path = os.path.join(output_dir, filename)
                pix.save(path)
                figures.append({
                    "page": page_num + 1, "file": filename, "type": "vector",
                    "width": round(rect.width), "height": round(rect.height),
                    "pixel_w": pix.width, "pixel_h": pix.height
                })
        except Exception as e:
            print(f"  [警告] 第 {page_num+1} 页矢量图提取失败: {e}", file=sys.stderr)
            continue
    return figures, covered_xrefs


def extract_embedded_images(doc, output_dir, min_size=100, skip_xrefs=None):
    """提取 PDF 中嵌入的位图（实验结果截图、照片等）。

    Args:
        skip_xrefs: 已被矢量图区域覆盖的嵌入图片 xref 集合，跳过这些以避免重复。
    """
    images = []
    seen_xrefs = set(skip_xrefs) if skip_xrefs else set()
    for page_num in range(len(doc)):
        page = doc[page_num]
        for img_idx, img in enumerate(page.get_images(full=True)):
            xref = img[0]
            if xref in seen_xrefs:
                continue
            seen_xrefs.add(xref)
            base = doc.extract_image(xref)
            if base["width"] > min_size and base["height"] > min_size:
                filename = f"p{page_num+1}_img{img_idx+1}.{base['ext']}"
                path = os.path.join(output_dir, filename)
                with open(path, "wb") as f:
                    f.write(base["image"])
                images.append({
                    "page": page_num + 1, "file": filename, "type": "embedded",
                    "width": base["width"], "height": base["height"]
                })
    return images


def main():
    parser = argparse.ArgumentParser(description="从论文 PDF 中提取图表")
    parser.add_argument("pdf_path", help="PDF 文件路径")
    parser.add_argument("output_dir", help="图片输出目录")
    parser.add_argument("--dpi", type=int, default=200, help="输出分辨率（默认 200）")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    doc = fitz.open(args.pdf_path)

    print(f"论文共 {len(doc)} 页，开始提取图表...")

    vectors, covered_xrefs = extract_vector_figures(doc, args.output_dir, dpi=args.dpi)
    print(f"  矢量图：{len(vectors)} 张")
    if covered_xrefs:
        print(f"  跨类型去重：跳过 {len(covered_xrefs)} 个已被矢量图覆盖的嵌入图片")

    embedded = extract_embedded_images(doc, args.output_dir, skip_xrefs=covered_xrefs)
    print(f"  嵌入式位图：{len(embedded)} 张")

    doc.close()

    all_figures = vectors + embedded
    total = len(all_figures)
    print(f"提取完成：共 {total} 张图表，保存到 {args.output_dir}")

    # 输出清单文件，方便后续图表映射
    manifest_path = os.path.join(args.output_dir, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(all_figures, f, indent=2, ensure_ascii=False)
    print(f"清单文件：{manifest_path}")

    if total > 0:
        print("\n图表列表：")
        for fig in all_figures:
            size_info = f"{fig['width']}x{fig['height']}"
            if 'pixel_w' in fig:
                size_info = f"{fig['pixel_w']}x{fig['pixel_h']}px"
            print(f"  第{fig['page']}页 [{fig['type']}] {fig['file']} ({size_info})")


if __name__ == "__main__":
    main()
