# 批量下载模式

当用户粘贴多个 URL/arXiv ID、或从批量检索中选择论文时进入此模式。

## 流程

### Step 1: 提取论文标识

从用户输入中提取所有论文标识：

**正则匹配**（按优先级）：
1. arXiv PDF URL: `https?://arxiv\.org/pdf/(\d{4}\.\d{4,5})`
2. arXiv abs URL: `https?://arxiv\.org/abs/(\d{4}\.\d{4,5})`
3. 裸 arXiv ID: `\b(\d{4}\.\d{4,5})(v\d+)?\b`
4. 其他 PDF URL: `https?://\S+\.pdf`

**输入示例**（用户可能粘贴的各种格式）：
```
帮我下载这些论文：
https://arxiv.org/abs/2505.12345
https://arxiv.org/pdf/2506.07982
2504.11111
还有这个 https://example.com/paper.pdf
```

提取结果：`[2505.12345, 2506.07982, 2504.11111, https://example.com/paper.pdf]`

### Step 2: 去重检查

**三层去重**：

1. **输入去重**：相同 arXiv ID 只保留一个
2. **本地去重**：检查 `paper-notes/` 下所有子目录：
   - 用 `ls paper-notes/` 列出已有目录
   - 对每个目录检查是否有 `paper.pdf`
   - 用 `grep -r "<arXiv ID>" paper-notes/*/extracted-text.md` 或从目录名推断
3. **报告去重结果**：

```
📋 提取到 8 个论文链接
  - 去重后：6 篇（2 篇重复）
  - 已存在：2 篇（paper-notes/ 中已有）
  - 待下载：4 篇
```

如果所有论文都已存在，提示并结束。

### Step 3: 获取论文信息

对每篇待下载的论文：

- **arXiv 论文**：WebFetch 获取 `https://arxiv.org/abs/<id>`，提取标题和作者
- **其他 URL**：从 URL 推断名称

**生成目录名**：从标题生成简称（参照 SKILL.md 命名规则）

### Step 4: 批量下载

对每篇论文顺序执行：

```bash
# 创建目录
mkdir -p paper-notes/<name>/images

# 下载 PDF
curl -L -f -o "paper-notes/<name>/paper.pdf" "https://arxiv.org/pdf/<id>.pdf"
```

- 每篇下载后立即验证（检查文件大小 > 0 且以 `%PDF-` 开头）
- 下载失败的记录但不中断

**进度显示**：每下载完一篇，立即输出状态：
```
[1/4] ✅ swe-compass — SWE-Compass: Unified Evaluation... (2.3 MB)
[2/4] ✅ tau2-bench — τ²-Bench: A Multi-turn... (1.8 MB)
[3/4] ❌ xxx — 下载失败 (HTTP 404)
[4/4] ✅ yyy — ... (3.1 MB)
```

### Step 5: 生成汇总

保存汇总到 `paper-notes/batch-<YYYYMMDD>/download-summary.md`：

```markdown
# 批量下载汇总

> 下载时间：<日期> | 共 N 篇

| # | 论文标题 | 目录 | 状态 | arXiv ID | 大小 |
|---|---------|------|------|----------|------|
| 1 | <Title> | `paper-notes/xxx/` | ✅ 已下载 | 2506.xxxxx | 2.3 MB |
| 2 | <Title> | `paper-notes/yyy/` | ⏭ 已存在 | 2505.xxxxx | — |
| 3 | <Title> | — | ❌ 失败 | 2504.xxxxx | — |
```

同时在终端输出表格。

### Step 6: 建议下一步

```
下载完成！你可以：
- 对某篇论文说 `/paper-lens paper-notes/<name>/paper.pdf` 开始阅读
- 说「帮我速览所有新下载的论文」批量生成速览笔记
```

## 注意事项

- 下载间隔：每篇之间 `sleep 1` 避免被 arXiv 限流
- arXiv abs URL 统一转为 pdf URL：`/abs/` → `/pdf/`，末尾加 `.pdf`
- 非 arXiv URL 的论文目录名用 URL 推断（取最后一段路径去掉 .pdf）
- 如果用户从 batch-search 过来，arXiv ID 列表已经准备好，直接进入 Step 2
