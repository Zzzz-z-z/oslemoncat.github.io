/* 主题：明/暗切换，记忆到 localStorage。
   首屏由 index.html 里的内联脚本提前设置 data-theme，避免闪白。
   函数接受注入的 win/doc，便于脚本化测试。 */
const KEY = 'osc-theme';

const ICONS = {
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"></path></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M3 12h18M3 18h18"></path></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"></path></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"></path><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"></path></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"></path><path d="M5 10v10h14V10"></path></svg>',
  layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5z"></path><path d="m2 17 10 5 10-5"></path><path d="m2 12 10 5 10-5"></path></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6M16 13H8M16 17H8"></path></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>',
};

export function icon(name) {
  return ICONS[name] || '';
}

function store(win) {
  try {
    return win.localStorage || null;
  } catch {
    return null; // 隐私模式下访问 localStorage 会抛异常
  }
}

export function currentTheme(win = window) {
  const saved = store(win);
  const stored = saved ? saved.getItem(KEY) : null;
  if (stored === 'light' || stored === 'dark') return stored;
  const media = typeof win.matchMedia === 'function' ? win.matchMedia('(prefers-color-scheme: dark)') : null;
  return media && media.matches ? 'dark' : 'light';
}

export function applyTheme(theme, win = window, doc = win.document) {
  doc.documentElement.setAttribute('data-theme', theme);
  const saved = store(win);
  if (saved) saved.setItem(KEY, theme);
}

export function initTheme(toggleButton, options = {}) {
  const win = options.win || window;
  const doc = options.doc || win.document || document;

  applyTheme(currentTheme(win), win, doc);
  if (!toggleButton) return;

  const sync = () => {
    const dark = doc.documentElement.getAttribute('data-theme') === 'dark';
    toggleButton.innerHTML = dark ? ICONS.sun : ICONS.moon;
    toggleButton.setAttribute('aria-label', dark ? '切换到亮色主题' : '切换到暗色主题');
    toggleButton.setAttribute('title', dark ? '亮色主题' : '暗色主题');
  };

  sync();
  toggleButton.addEventListener('click', () => {
    const next = doc.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next, win, doc);
    sync();
  });
}
