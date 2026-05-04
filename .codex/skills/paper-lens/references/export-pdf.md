# PDF 导出

## 触发场景

用户说"导出 PDF"、"生成 PDF"、"转 PDF"、"打印"、"导出"等与 PDF 导出相关的指令时执行。

## 执行流程

### Step 1: 确定导出文件

列出当前论文目录下可用的 md 文件，让用户选择：

```
paper-notes/<name>/
├── speed-read.md     # 速览笔记
├── deep-learn.md     # 学习笔记
└── slides-content.md # 展示内容
```

如果用户已明确指定文件，跳过选择。

### Step 2: 确认样式

用结构化提问 让用户选择排版样式：

- **学术风格（academic）** — 蓝色主题、斑马纹表格、论文信息卡片样式（推荐）
- **简洁风格（clean）** — 黑白灰、极简排版
- **紧凑风格（compact）** — 小字号、高密度、适合打印

如果用户已明确指定样式，跳过选择。

### Step 3: 定位脚本并执行

```bash
# 定位 md_to_pdf.py 脚本（兼容不同安装位置）
SCRIPT=$(find .codex/skills/paper-lens/scripts ~/.codex/skills/codex-primary-runtime/paper-lens/scripts ~/.codex/skills/paper-lens/scripts -name "md_to_pdf.py" 2>/dev/null | head -1)
if [ -z "$SCRIPT" ]; then
    echo "未找到 md_to_pdf.py，请确认 paper-lens skill 已安装。"
    exit 1
fi

# 执行转换
python3 "$SCRIPT" "<markdown_path>" --style <style>
```

### Step 4: 输出确认

转换完成后告知用户：
- PDF 文件路径
- 页数和文件大小

## 依赖

脚本自动使用已安装的库：
- **必需**：`pymupdf`（已有）、`markdown`、`pygments`（已有）
- **推荐**：`matplotlib`（LaTeX 公式渲染为数学符号）
- 首次使用如缺少依赖：`pip3 install markdown`

## 注意事项

- 图片路径会自动解析（`figures/` 和 `images/` 目录下的图片）
- LaTeX 公式（`$...$` 和 `$$...$$`）在有 matplotlib 时渲染为数学符号图片，否则以等宽文本显示
- 输出 PDF 默认与源 md 文件同目录同名（`.pdf` 后缀）
- 可用 `-o` 参数指定自定义输出路径
