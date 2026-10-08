/* 首页：概览 + 知识模块 + 最近更新。 */
import { el } from '../assets/js/util.js';
import { loadSite, loadModules, loadArticles, decorateModules } from '../assets/js/content.js';
import { sectionHead, moduleCard, articleList, notice } from '../assets/js/layout.js';

export async function renderHome(container) {
  const [site, modules, articles] = await Promise.all([loadSite(), loadModules(), loadArticles()]);
  const decorated = decorateModules(modules, articles);
  const recent = articles.slice(0, 8);
  const total = articles.length;

  container.innerHTML = '';

  /* hero */
  const hero = el('section', { class: 'hero' }, [
    el('div', { class: 'wrap' }, [
      el('p', { class: 'hero__eyebrow', text: `${total} 篇文章 · ${modules.length} 个知识模块` }),
      el('h1', { class: 'hero__title', text: site.title }),
      el('p', { class: 'hero__lead', text: site.description }),
      el('div', { class: 'hero__actions' }, [
        el('a', { class: 'btn btn--primary', href: '#/modules' }, ['浏览知识模块']),
        el('a', { class: 'btn btn--ghost', href: '#/articles' }, ['全部文章']),
      ]),
    ]),
  ]);
  container.appendChild(hero);

  const wrap = el('div', { class: 'wrap' });

  if (!articles.length) {
    wrap.appendChild(notice(
      '还没有文章。在 <code>content/articles/</code> 下新增 <code>&lt;slug&gt;.md</code> 与 '
      + '<code>&lt;slug&gt;.json</code>，再把 slug 加进 <code>content/articles.json</code>，'
      + '刷新后即可在首页看到。详细步骤见 <a href="#/about">关于</a>。',
    ));
  }

  /* 知识模块 */
  if (decorated.length) {
    wrap.appendChild(el('section', { class: 'section' }, [
      sectionHead('知识模块', { note: `${decorated.length} 个`, more: { href: '#/modules', label: '查看全部 →' } }),
      el('div', { class: 'grid' }, decorated.slice(0, 6).map(moduleCard)),
    ]));
  }

  /* 最近更新 */
  if (recent.length) {
    wrap.appendChild(el('section', { class: 'section' }, [
      sectionHead('最近更新', { more: { href: '#/articles', label: '全部文章 →' } }),
      articleList(recent),
    ]));
  }

  container.appendChild(wrap);
}
