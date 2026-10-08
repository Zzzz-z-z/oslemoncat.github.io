/* 目录高亮与页内锚点跳转。
   注意：本站用 hash 路由（#/article/xxx），所以页内锚点不能直接改 location.hash，
   否则会被路由当成一条新路由。这里统一改为手动滚动。 */
export function initAnchorScroll(root) {
  root.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;
    const target = link.getAttribute('href');
    if (target.length < 2 || target.startsWith('#/')) return;
    const id = decodeURIComponent(target.slice(1));
    const node = document.getElementById(id);
    if (!node) return;
    event.preventDefault();
    node.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const slug = (root.dataset && root.dataset.slug) || '';
    if (slug) {
      history.replaceState(null, '', `${location.pathname}${location.search}#/article/${slug}::${id}`);
    }
  }, true);
}

/** 目录高亮：用 IntersectionObserver 跟踪标题可见性。 */
export function initTocHighlight() {
  const toc = document.querySelector('.toc');
  if (!toc) return;
  const links = [...toc.querySelectorAll('a[href^="#"]')];
  if (links.length < 2) return;

  const map = new Map();
  links.forEach((link) => {
    const id = decodeURIComponent(link.getAttribute('href').slice(1));
    const heading = document.getElementById(id);
    if (heading) map.set(heading, link);
  });
  if (!map.size) return;

  const visible = new Set();
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) visible.add(entry.target);
      else visible.delete(entry.target);
    });
    if (!visible.size) return;
    const first = [...map.keys()].find((heading) => visible.has(heading));
    links.forEach((link) => link.classList.remove('is-active'));
    const active = map.get(first);
    if (active) active.classList.add('is-active');
  }, { rootMargin: '-72px 0px -70% 0px', threshold: 0 });

  map.forEach((link, heading) => observer.observe(heading));
}
