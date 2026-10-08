/* 文章详情页：正文渲染、数学公式、目录、上下篇。 */
import { el, resolveUrl, formatDate, latestDate, detectBase } from '../assets/js/util.js';
import { loadSite, loadArticles, loadArticleBody, findArticle } from '../assets/js/content.js';
import { renderMarkdown, typesetMath, buildToc } from '../assets/js/markdown.js';
import { breadcrumbs, tagList, pager, emptyState } from '../assets/js/layout.js';
import { initAnchorScroll, initTocHighlight } from '../assets/js/toc.js';

const KATEX_CSS = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css';
const KATEX_JS = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js';

let katexPromise = null;

/** 动态加载 KaTeX（带超时）。失败时公式降级为源码显示，不影响正文。
 *  options.doc 可注入（测试用），options.enabled=false 时直接跳过加载。 */
function ensureKatex(options = {}) {
  const doc = options.doc || document;
  if (options.enabled === false) return Promise.resolve(window.katex || null);
  if (window.katex) return Promise.resolve(window.katex);
  if (katexPromise) return katexPromise;

  katexPromise = new Promise((resolve) => {
    const finish = () => resolve(window.katex || null);
    if (!doc.querySelector(`link[href="${KATEX_CSS}"]`)) {
      doc.head.appendChild(el('link', { rel: 'stylesheet', href: KATEX_CSS }));
    }
    const script = el('script', { src: KATEX_JS, defer: true, onload: finish, onerror: finish });
    setTimeout(finish, 6000);
    doc.head.appendChild(script);
    script.addEventListener('load', finish);
    script.addEventListener('error', finish);
  });
  return katexPromise;
}

function relativeTime(dateString) {
  if (!dateString) return '';
  const then = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(then.getTime())) return '';
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days < 0) return '';
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  if (days < 365) return `${Math.floor(days / 30)} 个月前`;
  return `${Math.floor(days / 365)} 年前`;
}

export async function renderArticle(container, slug, options = {}) {
  const [site, articles] = await Promise.all([loadSite(), loadArticles()]);
  const article = findArticle(articles, slug);
  const doc = options.doc || document;
  const base = detectBase();

  container.innerHTML = '';

  if (!article) {
    const wrap = el('div', { class: 'wrap' });
    wrap.appendChild(breadcrumbs([{ label: '首页', href: '#/' }, { label: '文章不存在' }]));
    wrap.appendChild(emptyState(
      `没有找到文章 ${slug}`,
      '可能是链接过期，或该文章尚未登记进 <code>content/articles.json</code>。'
        + ' <a href="#/articles">返回全部文章</a>',
    ));
    container.appendChild(wrap);
    return;
  }

  let markdown = '';
  try {
    markdown = await loadArticleBody(article.slug);
  } catch (error) {
    console.warn('[article] 正文加载失败：', error);
  }

  const rendered = markdown
    ? renderMarkdown(markdown)
    : { html: '<p>（这篇还没有正文内容）</p>', headings: [] };

  /* 上下篇：同一模块内，按时间排序 */
  const siblings = articles.filter((item) => item.module === article.module);
  const position = siblings.findIndex((item) => item.slug === article.slug);
  const prev = position > 0 ? siblings[position - 1] : null;
  const next = position >= 0 && position < siblings.length - 1 ? siblings[position + 1] : null;

  const wrap = el('div', { class: 'wrap' });
  wrap.appendChild(breadcrumbs([
    { label: '首页', href: '#/' },
    { label: '知识模块', href: '#/modules' },
    { label: article.moduleTitle, href: `#/module/${article.module}` },
    { label: article.title },
  ]));

  /* 正文头 */
  const header = el('header', { class: 'article__header' }, [
    el('a', { class: 'article__module', href: `#/module/${article.module}`, text: article.moduleTitle }),
    el('h1', { class: 'article__title', text: article.title }),
    article.summary ? el('p', { class: 'article__summary', text: article.summary }) : null,
    el('div', { class: 'article__meta' }, [
      article.date ? el('span', { text: `发布于 ${formatDate(article.date)}` }) : null,
      article.updated ? el('span', { text: `更新于 ${formatDate(article.updated)}（${relativeTime(article.updated)}）` }) : null,
      el('span', { text: `${Math.max(1, Math.round(markdown.length / 400))} 分钟阅读` }),
    ]),
    tagList(article.tags),
    article.cover
      ? el('figure', { class: 'article__cover' }, [
        el('img', { src: resolveUrl(article.cover, base), alt: article.title, loading: 'lazy', decoding: 'async' }),
      ])
      : null,
  ]);

  const prose = el('div', { class: 'prose', html: rendered.html });

  const footer = el('footer', { class: 'article__footer' }, [
    el('span', { text: '本文为学习笔记整理，欢迎交流指正。' }),
    el('button', {
      class: 'filter-chip',
      type: 'button',
      text: '复制链接',
      onclick: async (event) => {
        const button = event.currentTarget;
        try {
          await navigator.clipboard.writeText(location.href);
          button.textContent = '已复制 ✓';
        } catch {
          button.textContent = '复制失败，请手动复制地址栏';
        }
        setTimeout(() => { button.textContent = '复制链接'; }, 2200);
      },
    }),
  ]);

  const articleEl = el('article', { class: 'article' }, [header, prose, footer]);
  const toc = buildToc(rendered.headings);
  const layout = el('div', { class: 'article-layout' }, [articleEl, toc]);
  wrap.appendChild(layout);

  const pagerNode = pager(prev, next);
  if (pagerNode) articleEl.appendChild(pagerNode);

  container.appendChild(wrap);
  container.dataset.slug = article.slug;
  doc.title = `${article.title} · ${site.title}`;

  initAnchorScroll(container);

  // 数学渲染后再做目录高亮，避免布局抖动导致误判
  await ensureKatex(options);
  typesetMath(prose);
  initTocHighlight();
}
