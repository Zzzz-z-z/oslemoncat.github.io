#!/usr/bin/env python3
"""把 LaTeX 讲义批量导入成站点文章（启发式转换，产出需人工校对）。

用法示例：
    python scripts/import_tex.py "D:/notes/数学分析知识点总结.tex" ^
        --slug apostol-full ^
        --title "数学分析知识点总结（Apostol 体系）" ^
        --module math-analysis ^
        --tags 数学分析 讲义

脚本做四件事：
  1. 去掉导言区与常见排版命令，把 \\section 系列映射成 Markdown 标题；
  2. 把 theorem/example/solution 等环境映射成 ::: 提示块；
  3. 把 equation/align 等数学环境保留为 $$...$$，交给网页端的 KaTeX 渲染；
  4. 写出 content/articles/<slug>.md + <slug>.json，并登记到
     content/generated/articles-index.json（站点加载时优先使用该索引）。

注意：输出一定需要人工校对，尤其是表格、图片、自定义宏和 \\ref 交叉引用。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
ARTICLES_DIR = REPO_ROOT / "content" / "articles"
GENERATED_DIR = REPO_ROOT / "content" / "generated"
INDEX_PATH = GENERATED_DIR / "articles-index.json"

# LaTeX 环境 -> 站点容器类型
ENV_TO_CONTAINER = {
    "theorem": "theorem",
    "lemma": "theorem",
    "corollary": "theorem",
    "proposition": "theorem",
    "definition": "definition",
    "example": "example",
    "solution": "solution",
    "proof": "proof",
    "remark": "note",
    "note": "note",
}

# 数学环境 -> 块级公式
MATH_ENVS = ("equation", "equation*", "align", "align*", "gather", "gather*",
             "multline", "multline*", "displaymath", "eqnarray", "eqnarray*")

# 直接丢弃的命令（排版类，没有语义）
DROP_COMMANDS = (
    "documentclass", "usepackage", "setlength", "linespread", "pagestyle",
    "raggedbottom", "allowdisplaybreaks", "newcounter", "renewcommand",
    "newcommand", "newenvironment", "geometry", "vspace", "vspace*", "hspace",
    "hspace*", "noindent", "centering", "clearpage", "newpage", "tableofcontents",
    "thispagestyle", "begin", "end", "label", "index", "protect",
)

LABEL_NAMES = {
    "theorem": "定理", "lemma": "引理", "corollary": "推论",
    "proposition": "命题", "definition": "定义", "example": "例题",
    "solution": "解答", "proof": "证明", "remark": "注",
}


def strip_preamble(text: str) -> str:
    """去掉导言区，只保留 \\begin{document} 之后的内容。"""
    match = re.search(r"\\begin\{document\}", text)
    if match:
        text = text[match.end():]
    text = re.sub(r"\\end\{document\}.*$", "", text, flags=re.S)
    return text


def strip_title_page(text: str) -> str:
    return re.sub(r"\\begin\{titlepage\}.*?\\end\{titlepage\}", "", text, flags=re.S)


def convert_headings(text: str) -> str:
    mapping = [
        (r"\\part\*?\{", "# "),
        (r"\\chapter\*?\{", "# "),
        (r"\\section\*?\{", "## "),
        (r"\\subsection\*?\{", "### "),
        (r"\\subsubsection\*?\{", "#### "),
    ]
    for pattern, replacement in mapping:
        text = re.sub(pattern, replacement, text)
    return text


def convert_containers(text: str) -> str:
    """\\begin{theorem}[标题] ... \\end{theorem} -> ::: theorem 标题 ... :::"""
    for env, container in ENV_TO_CONTAINER.items():
        pattern = re.compile(
            r"\\begin\{" + re.escape(env) + r"\}(\[[^\]]*\])?(.*?)\\end\{" + re.escape(env) + r"\}",
            re.S,
        )

        def repl(match: re.Match, container: str = container, env: str = env) -> str:
            optional = (match.group(1) or "").strip("[] \t\n")
            body = match.group(2).strip("\n")
            label = optional or LABEL_NAMES.get(env, env)
            return f"\n::: {container} {label}\n{body}\n:::\n"

        text = pattern.sub(repl, text)
    return text


def convert_math(text: str) -> str:
    for env in MATH_ENVS:
        pattern = re.compile(
            r"\\begin\{" + re.escape(env) + r"\}(.*?)\\end\{" + re.escape(env) + r"\}",
            re.S,
        )
        text = pattern.sub(lambda m: f"\n$$\n{m.group(1).strip()}\n$$\n", text)
    # 行间公式 \[ ... \]
    text = re.sub(r"\\\[(.*?)\\\]", lambda m: f"\n$$\n{m.group(1).strip()}\n$$\n", text, flags=re.S)
    # 行内公式 \( ... \) -> $...$
    text = re.sub(r"\\\((.*?)\\\)", lambda m: f"${m.group(1).strip()}$", text, flags=re.S)
    return text


def convert_inline(text: str) -> str:
    replacements = [
        (r"\\textbf\{([^{}]*)\}", r"**\1**"),
        (r"\\bf\s+", "**"),
        (r"\\emph\{([^{}]*)\}", r"*\1*"),
        (r"\\textit\{([^{}]*)\}", r"*\1*"),
        (r"\\texttt\{([^{}]*)\}", r"`\1`"),
        (r"\\mathrm\{([^{}]*)\}", r"\1"),
        (r"\\quad", "  "),
        (r"\\qquad", "    "),
        (r"\\,", " "),
        (r"\\;", " "),
        (r"\\!", ""),
        (r"\\%", "%"),
        (r"\\&", "&"),
        (r"\\_", "_"),
        (r"\\#", "#"),
        (r"\\\$", "$"),
        (r"\\blacksquare", r"$\\blacksquare$"),
        (r"\\qed", r"$\\blacksquare$"),
        (r"\\hline", ""),
        (r"\\centering", ""),
        (r"\\par\b", "\n\n"),
        (r"\\item\b", "- "),
    ]
    for pattern, replacement in replacements:
        text = re.sub(pattern, replacement, text)

    # 丢排版命令，但保留它们的参数
    for command in DROP_COMMANDS:
        text = re.sub(r"\\" + re.escape(command) + r"\*?(\[[^\]]*\])?", "", text)

    # 去掉残留的 \ref / \cite / \footnote 标记
    text = re.sub(r"\\(ref|eqref|cite|footnote)\{[^{}]*\}", "", text)
    # \\ 换行 -> 真的换行
    text = re.sub(r"\\\\\s*", "\n", text)
    return text


def tidy(text: str) -> str:
    lines = [line.rstrip() for line in text.splitlines()]
    output: list[str] = []
    blank = 0
    for line in lines:
        if not line.strip():
            blank += 1
            if blank > 1:
                continue
        else:
            blank = 0
        output.append(line)
    return "\n".join(output).strip() + "\n"


def convert(source: str) -> str:
    text = strip_preamble(source)
    text = strip_title_page(text)
    text = convert_containers(text)
    text = convert_math(text)
    text = convert_headings(text)
    text = convert_inline(text)
    # 去掉空花括号与多余空格
    text = re.sub(r"\{\s*\}", "", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return tidy(text)


def register_slug(slug: str) -> list[str]:
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    slugs: list[str] = []
    if INDEX_PATH.exists():
        try:
            payload = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
            data = payload.get("articles") if isinstance(payload, dict) else payload
            if isinstance(data, list):
                slugs = [item for item in data if isinstance(item, str)]
        except json.JSONDecodeError:
            print(f"[warn] {INDEX_PATH} 不是合法 JSON，将重建。", file=sys.stderr)
            slugs = []
    if slug not in slugs:
        slugs.append(slug)
    INDEX_PATH.write_text(
        json.dumps({"articles": slugs}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return slugs


def main() -> int:
    parser = argparse.ArgumentParser(description="把 LaTeX 讲义转换成站点 Markdown 文章")
    parser.add_argument("tex", type=Path, help="源 .tex 文件路径")
    parser.add_argument("--slug", required=True, help="文章 slug，同时作为文件名")
    parser.add_argument("--title", required=True, help="文章标题")
    parser.add_argument("--module", default="misc", help="所属模块 slug，默认 misc")
    parser.add_argument("--summary", default="", help="摘要")
    parser.add_argument("--tags", nargs="*", default=[], help="标签，空格分隔")
    parser.add_argument("--date", default=date.today().isoformat(), help="发布日期 YYYY-MM-DD")
    parser.add_argument("--dry-run", action="store_true", help="只打印结果，不写文件")
    parser.add_argument("--force", action="store_true", help="覆盖已存在的文章")
    args = parser.parse_args()

    if not args.tex.exists():
        print(f"[error] 找不到文件：{args.tex}", file=sys.stderr)
        return 1

    source = args.tex.read_text(encoding="utf-8", errors="replace")
    markdown = convert(source)

    heading = f"# {args.title}\n\n"
    if not markdown.lstrip().startswith("#"):
        markdown = heading + markdown

    meta = {
        "title": args.title,
        "summary": args.summary or f"由 {args.tex.name} 转换整理。",
        "module": args.module,
        "date": args.date,
        "updated": args.date,
        "tags": args.tags,
        "order": 0,
        "draft": True,
    }

    if args.dry_run:
        print(markdown[:2000])
        print("\n... [dry-run] 未写入文件")
        return 0

    ARTICLES_DIR.mkdir(parents=True, exist_ok=True)
    md_path = ARTICLES_DIR / f"{args.slug}.md"
    json_path = ARTICLES_DIR / f"{args.slug}.json"

    if md_path.exists() and not args.force:
        print(f"[error] {md_path} 已存在，加 --force 覆盖。", file=sys.stderr)
        return 1

    md_path.write_text(markdown, encoding="utf-8")
    json_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    slugs = register_slug(args.slug)

    print(f"[ok] 正文 -> {md_path.relative_to(REPO_ROOT)}")
    print(f"[ok] 元数据 -> {json_path.relative_to(REPO_ROOT)}")
    print(f"[ok] 索引 -> {INDEX_PATH.relative_to(REPO_ROOT)}（共 {len(slugs)} 篇）")
    print("[next] 请人工校对正文，尤其是表格、图片与交叉引用；")
    print("       确认无误后把 meta 里的 draft 改为 false，并补上 summary 与 tags。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
