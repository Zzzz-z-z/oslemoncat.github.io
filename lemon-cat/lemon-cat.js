/* Lemon Cat · standalone web pet · no dependencies */
(() => {
  'use strict';
  const script = document.currentScript;
  const base = new URL('.', script?.src || document.baseURI).href;
  if (window.LemonCat) return;
  const poses = { idle: [0, 0], happy: [1, 0], curious: [2, 0], feed: [0, 1], sleep: [1, 1], play: [2, 1] };
  const words = {
    idle: '喵～今天也要开心！', happy: '呼噜呼噜，好喜欢你呀！',
    curious: '带我去哪里玩呀？', feed: '一颗柠檬，一整天的好心情！',
    sleep: '陪你安静一会儿… zzz', play: '伸个懒腰，再继续加油！'
  };
  const styles = `
    :host{all:initial;position:fixed;display:block;width:var(--lc-size,180px);height:var(--lc-size,180px);z-index:2147483000;pointer-events:none;color:#284735;font:14px/1.5 system-ui,-apple-system,"Microsoft YaHei",sans-serif;color-scheme:light}
    *,*::before,*::after{box-sizing:border-box}button{font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
    button:focus-visible{outline:3px solid #729251;outline-offset:3px}[hidden]{display:none!important}
    .pet{width:100%;height:100%;border:0;padding:0;background:none;pointer-events:auto;touch-action:none;cursor:grab;position:relative}
    .pet:active{cursor:grabbing}.motion{width:100%;height:100%;position:relative;transform-origin:50% 90%;animation:breathe 3.8s ease-in-out infinite}.sprite{position:absolute;inset:0;width:100%;height:100%;background-size:300% 200%;background-repeat:no-repeat;transform-origin:50% 90%;animation:none;will-change:transform,opacity;filter:drop-shadow(0 5px 3px #74682b14)}
    :host([data-state=happy]) .sprite{animation:happy 1.2s ease-in-out 2}
    :host([data-state=feed]) .sprite{animation:nibble 2.4s ease-in-out infinite}
    :host([data-state=sleep]) .sprite{animation:sleep 5.6s ease-in-out infinite}
    :host([data-state=curious]) .sprite{animation:curious 3s ease-in-out infinite}
    .sprite.ghost{animation:none!important;pointer-events:none}
    :host([data-state=play]) .sprite{animation:stretch 2.6s ease-in-out 1}
    :host([data-dragging]) .sprite{animation:none;transform:rotate(-5deg)}
    :host([data-paused]) .sprite,:host([data-paused]) .motion{animation-play-state:paused}
    .more,.launcher{position:absolute;bottom:0;right:0;border:1px solid #dce4cc;background:#fffffff2;pointer-events:auto;box-shadow:0 3px 14px #29463212;display:grid;place-items:center}
    .more{width:30px;height:30px;border-radius:50%;font-size:19px;line-height:1}.launcher{width:48px;height:48px;border-radius:50%;font-size:24px}
    .bubble{position:absolute;bottom:calc(100% + 8px);left:var(--lc-bubble-left,0px);width:max-content;max-width:var(--lc-bubble-width,224px);padding:10px 14px;background:#fff;border:1px solid #ecebd8;border-radius:18px;box-shadow:0 4px 14px #625d1110;pointer-events:none;animation:appear .2s ease-out;overflow-wrap:anywhere}
    .panel{position:absolute;left:var(--lc-panel-left,0px);top:var(--lc-panel-top,-140px);width:var(--lc-panel-width,220px);padding:8px;border-radius:16px;background:#fffef9;border:1px solid #e3e7d7;box-shadow:0 8px 28px #203a2220;pointer-events:auto;display:grid;grid-template-columns:1fr 1fr;gap:6px}
    .panel button{border:0;border-radius:10px;background:#f0f4e9;padding:8px 4px;white-space:nowrap;min-height:36px;font-size:13px}.panel button:hover{background:#e5edda}.panel .hide{grid-column:1/-1;background:transparent;color:#68755e}
    .error{background:#fffef9;border:1px solid #dce4cc;padding:10px;border-radius:12px;pointer-events:auto;font-size:12px}
    .spark{position:absolute;left:46%;top:22%;color:#d6aa35;font-size:24px;pointer-events:none;animation:spark .9s ease-out forwards}
    @keyframes breathe{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-1.6px) scale(1.008)}}
    @keyframes happy{0%,100%{transform:translateY(0) rotate(0)}16%{transform:translateY(1px) scaleY(.988)}38%{transform:translateY(-5px) rotate(-1.8deg)}58%{transform:translateY(-3px) rotate(1.5deg)}78%{transform:translateY(.8px) scaleY(.994)}}
    @keyframes stretch{0%,100%{transform:scale(1) rotate(0)}16%{transform:scale(.992,1.009) rotate(-.7deg)}38%,56%{transform:scale(1.028,.984) rotate(1.2deg)}76%{transform:scale(1.011,.994) rotate(.4deg)}90%{transform:scale(.998,1.002)}}
    @keyframes curious{0%,100%{transform:rotate(0)}30%{transform:rotate(-1.2deg)}65%{transform:rotate(.8deg)}}
    @keyframes nibble{0%,100%{transform:translateY(0) rotate(0)}25%{transform:translateY(-1px) rotate(-.7deg)}48%{transform:translateY(.6px) rotate(.5deg)}72%{transform:translateY(-.5px)}}
    @keyframes sleep{0%,100%{transform:scale(1)}50%{transform:scale(1.009,1.014)}}@keyframes appear{from{opacity:0;transform:translateY(5px)}}@keyframes spark{to{transform:translateY(-48px) rotate(15deg);opacity:0}}
    @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
  `;
  class LemonCatPet extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this.options = { size: 180, right: 24, bottom: 24, auto: true, persist: true, messages: false, storageKey: 'lemon-cat:v1', sprite: base + 'assets/lemon-cat-sprites.png' };
      this.state = 'idle'; this._timers = new Set();
      this.ready = new Promise(resolve => { this._readyResolve = resolve; });
    }
    connectedCallback() {
      if (this._connected) return;
      this._connected = true;
      this._abort = new AbortController();
      const signal = this._abort.signal;
      this.shadowRoot.innerHTML = `<style>${styles}</style><div class="bubble" role="status" aria-live="polite" hidden></div><button class="pet" aria-label="摸摸柠檬猫，按住可拖动"><div class="motion"><div class="sprite"></div><div class="sprite ghost" aria-hidden="true" hidden></div></div></button><button class="more" aria-label="打开柠檬猫菜单" aria-expanded="false">···</button><div class="panel" role="group" aria-label="柠檬猫互动" hidden><button data-action="happy">♡ 摸摸头</button><button data-action="feed">🍋 喂柠檬</button><button data-action="play">↗ 伸懒腰</button><button data-action="sleep">☾ 打个盹</button><button class="hide" data-action="hide">收起来</button></div><button class="launcher" aria-label="唤醒柠檬猫" hidden>🐾</button><div class="error" hidden>柠檬猫图片加载失败，请检查素材路径。</div>`;
      const query = s => this.shadowRoot.querySelector(s);
      this._pet = query('.pet'); this._sprite = query('.sprite'); this._ghost = query('.ghost'); this._bubble = query('.bubble');
      this._panel = query('.panel'); this._more = query('.more'); this._launcher = query('.launcher');
      this._sprite.style.backgroundImage = this._ghost.style.backgroundImage = `url(${JSON.stringify(this.options.sprite)})`;
      this._renderedState = null;
      this._reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
      this._reducedMotion.addEventListener('change', () => { if (this._reducedMotion.matches) this._finishPoseTransition(); }, { signal });
      this.style.position = this.options.container ? 'absolute' : 'fixed';
      this.style.zIndex = String(this.options.zIndex || 2147483000);
      this.setSize(this.options.size, false);
      this.resetPosition(false);
      this._restore();
      this._renderPose();
      this._pet.addEventListener('pointerdown', e => this._pointerDown(e), { signal });
      this._pet.addEventListener('pointermove', e => this._pointerMove(e), { signal });
      this._pet.addEventListener('pointerup', e => this._pointerUp(e), { signal });
      this._pet.addEventListener('pointercancel', () => this._endDrag(), { signal });
      this._pet.addEventListener('click', e => { if (e.detail === 0) this.act('happy'); }, { signal });
      this._more.addEventListener('click', () => this._togglePanel(), { signal });
      this._launcher.addEventListener('click', () => this.show(), { signal });
      this._panel.addEventListener('click', e => {
        const action = e.target.closest('[data-action]')?.dataset.action;
        if (!action) return;
        this._togglePanel(false);
        action === 'hide' ? this.hide() : this.act(action);
      }, { signal });
      document.addEventListener('pointerdown', e => { if (!e.composedPath().includes(this)) this._togglePanel(false); }, { signal });
      this.addEventListener('keydown', e => {
        if (e.key === 'Escape') { this._togglePanel(false); this._more.focus(); }
        const step = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[e.key];
        if (step && e.composedPath()[0] === this._pet) { e.preventDefault(); this._place(this.x + step[0], this.y + step[1]); this._save(); this._emit('move'); }
      }, { signal });
      window.addEventListener('resize', () => this._resize(), { signal });
      document.addEventListener('visibilitychange', () => {
        this.toggleAttribute('data-paused', document.hidden);
        for (const animation of this._poseAnimations || []) document.hidden ? animation.pause() : animation.play();
        this._scheduleIdle();
      }, { signal });
      if (this.options.container) { this._observer = new ResizeObserver(() => this._resize()); this._observer.observe(this.options.container); }
      const img = new Image();
      img.onload = () => { if (!this._connected) return; this._readyResolve(this); this._emit('ready'); this.say(words.idle); };
      img.onerror = () => { if (!this._connected) return; query('.error').hidden = false; this._readyResolve(this); this._emit('error'); };
      img.src = this.options.sprite;
      this._scheduleIdle();
    }
    disconnectedCallback() {
      this._connected = false; this._abort?.abort(); this._observer?.disconnect(); this._finishPoseTransition();
      for (const timer of this._timers) clearTimeout(timer);
      this._timers.clear();
    }
    _later(fn, delay) { const timer = setTimeout(() => { this._timers.delete(timer); fn(); }, delay); this._timers.add(timer); return timer; }
    _cancel(timer) { clearTimeout(timer); this._timers.delete(timer); }
    _bounds() { return this.options.container ? { width: this.options.container.clientWidth, height: this.options.container.clientHeight } : { width: window.innerWidth, height: window.innerHeight }; }
    _place(x, y) {
      const { width, height } = this._bounds();
      this.x = Math.max(0, Math.min(x, width - this.size)); this.y = Math.max(0, Math.min(y, height - this.size));
      this.style.left = this.x + 'px'; this.style.top = this.y + 'px';
      const bubbleWidth = Math.min(224, width - 16);
      const panelWidth = Math.min(220, width - 16);
      const offset = w => Math.max(8 - this.x, Math.min(0, width - 8 - this.x - w));
      this.style.setProperty('--lc-bubble-left', offset(bubbleWidth) + 'px');
      this.style.setProperty('--lc-bubble-width', bubbleWidth + 'px');
      this.style.setProperty('--lc-panel-left', offset(panelWidth) + 'px');
      this.style.setProperty('--lc-panel-width', panelWidth + 'px');
      this.style.setProperty('--lc-panel-top', (this.y >= 148 ? -140 : Math.min(this.size + 8, height - this.y - 140)) + 'px');
      this._bubble && (this._bubble.hidden = this._bubble.hidden || this.y < 64);
    }
    _resize() { const bounds = this._bounds(); if (bounds.width < 48 || bounds.height < 48) return; this.setSize(this.options.size, false); this._place(this.x, this.y); }
    setSize(value, save = true) {
      this.options.size = Math.min(320, Math.max(96, Number(value) || 180));
      const bounds = this._bounds();
      this.size = Math.max(48, Math.min(this.options.size, bounds.width - 16, bounds.height - 16));
      this.style.setProperty('--lc-size', this.size + 'px');
      if (Number.isFinite(this.x)) this._place(this.x, this.y);
      if (save) this._save();
      return this;
    }
    resetPosition(save = true) { const b = this._bounds(); this._place(b.width - this.size - this.options.right, b.height - this.size - this.options.bottom); if (save) this._save(); return this; }
    _pointerDown(e) {
      if (e.button !== 0 || this._drag) return;
      this._cancel(this._stateTimer); this._cancel(this._idleTimer); this._togglePanel(false);
      this._drag = { id: e.pointerId, startX: e.clientX, startY: e.clientY, x: this.x, y: this.y, moved: false };
      this._pet.setPointerCapture(e.pointerId);
    }
    _pointerMove(e) {
      if (!this._drag || e.pointerId !== this._drag.id) return;
      const dx = e.clientX - this._drag.startX, dy = e.clientY - this._drag.startY;
      if (Math.hypot(dx, dy) > 5 && !this._drag.moved) { this._drag.moved = true; this.setAttribute('data-dragging', ''); this.state = 'curious'; this._renderPose(); this._bubble.hidden = true; }
      if (this._drag.moved) this._place(this._drag.x + dx, this._drag.y + dy);
    }
    _pointerUp(e) {
      if (!this._drag || e.pointerId !== this._drag.id) return;
      const moved = this._drag.moved; this._endDrag(!moved);
      if (moved) { this._save(); this.act('curious'); this._emit('move'); } else this.act('happy');
    }
    _endDrag(resetPose = true) {
      if (this._drag && this._pet.hasPointerCapture(this._drag.id)) this._pet.releasePointerCapture(this._drag.id);
      this._drag = null; this.removeAttribute('data-dragging'); this._scheduleIdle();
      if (resetPose && this.state === 'curious') { this.state = 'idle'; this._renderPose(); }
    }
    _finishPoseTransition() {
      this._poseToken = (this._poseToken || 0) + 1;
      for (const animation of this._poseAnimations || []) animation.cancel();
      this._poseAnimations = [];
      if (this._ghost) this._ghost.hidden = true;
      if (this._sprite) this._sprite.style.opacity = '1';
    }
    _renderPose() {
      const previous = this._renderedState;
      const previousPosition = this._sprite.style.backgroundPosition;
      const previousTransform = getComputedStyle(this._sprite).transform;
      this._finishPoseTransition();
      const [x, y] = poses[this.state] || poses.idle;
      this._sprite.style.backgroundPosition = `${x * 50}% ${y * 100}%`;
      this.setAttribute('data-state', this.state);
      this._renderedState = this.state;
      if (previous === this.state) {
        for (const animation of this._sprite.getAnimations()) if ('animationName' in animation) animation.currentTime = 0;
        return;
      }
      if (!previous || this._reducedMotion.matches || document.hidden || this._hidden) return;
      this._ghost.style.backgroundPosition = previousPosition;
      this._ghost.style.transform = previousTransform;
      this._ghost.hidden = false;
      const timing = { duration: this.state === 'sleep' || this.state === 'play' ? 420 : 280, easing: 'cubic-bezier(.22,.61,.36,1)', fill: 'forwards' };
      const token = this._poseToken;
      this._poseAnimations = [this._sprite.animate([{ opacity: 0 }, { opacity: 1 }], timing), this._ghost.animate([{ opacity: 1 }, { opacity: 0 }], timing)];
      Promise.all(this._poseAnimations.map(animation => animation.finished)).then(() => { if (this._poseToken === token) this._finishPoseTransition(); }).catch(() => {});
    }
    act(state) {
      if (!poses[state]) return this;
      if (this._hidden) this.show();
      this._cancel(this._stateTimer); this._togglePanel(false); this.state = state; this._renderPose(); this.say(words[state]); this._emit('state');
      if (state === 'happy' || state === 'feed') { const spark = document.createElement('span'); spark.className = 'spark'; spark.textContent = state === 'feed' ? '✦' : '♡'; this.shadowRoot.append(spark); this._later(() => spark.remove(), 1000); }
      if (state !== 'sleep' && state !== 'idle') this._stateTimer = this._later(() => { this.state = 'idle'; this._renderPose(); this._emit('state'); }, state === 'feed' ? 4500 : 3000);
      this._scheduleIdle(); return this;
    }
    say(text, duration = 4200) { this._cancel(this._bubbleTimer); if (!this.options.messages) { this._bubble.hidden = true; this._bubble.textContent = ''; return this; } this._bubble.textContent = String(text); this._bubble.hidden = this.y < 64 || this._hidden; this._bubbleTimer = this._later(() => { this._bubble.hidden = true; }, duration); return this; }
    _togglePanel(force) { if (!this._panel) return; const open = force ?? this._panel.hidden; this._panel.hidden = !open; this._more.setAttribute('aria-expanded', String(open)); if (open) { this._bubble.hidden = true; this._place(this.x, this.y); } }
    _scheduleIdle() {
      this._cancel(this._idleTimer);
      if (!this.options.auto || this._hidden || document.hidden || this._drag || this.state === 'sleep') return;
      this._idleTimer = this._later(() => this.act(Math.random() > .45 ? 'play' : 'curious'), 26000 + Math.random() * 18000);
    }
    setAuto(value) { this.options.auto = Boolean(value); this._scheduleIdle(); return this; }
    hide() { this._finishPoseTransition(); this._hidden = true; this._pet.hidden = this._more.hidden = this._bubble.hidden = true; this._launcher.hidden = false; this._togglePanel(false); this._cancel(this._stateTimer); this._scheduleIdle(); this._save(); this._emit('hide'); return this; }
    show() { this._hidden = false; this._pet.hidden = this._more.hidden = false; this._launcher.hidden = true; this.state = 'idle'; this._renderPose(); this.say('回来啦！继续陪你。'); this._scheduleIdle(); this._save(); this._emit('show'); return this; }
    destroy() { this.remove(); }
    _emit(type) { this.dispatchEvent(new CustomEvent('lemoncat:' + type, { detail: { state: this.state, x: this.x, y: this.y, size: this.size }, bubbles: true, composed: true })); }
    _save() { if (!this.options.persist || !this._connected) return; try { localStorage.setItem(this.options.storageKey, JSON.stringify({ x: this.x, y: this.y, size: this.options.size, hidden: !!this._hidden })); } catch {} }
    _restore() {
      if (!this.options.persist) return;
      try { const saved = JSON.parse(localStorage.getItem(this.options.storageKey)); if (!saved) return; if (Number.isFinite(saved.size)) this.setSize(saved.size, false); if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) this._place(saved.x, saved.y); if (saved.hidden) this.hide(); } catch {}
    }
  }
  customElements.define('lemon-cat-pet', LemonCatPet);
  window.LemonCat = {
    version: '1.1.2',
    mount(options = {}) {
      const pet = document.createElement('lemon-cat-pet');
      const container = typeof options.container === 'string' ? document.querySelector(options.container) : options.container;
      if (options.container && !container) throw new Error('LemonCat: container was not found');
      pet.options = { ...pet.options, ...options, container };
      if (container && getComputedStyle(container).position === 'static') container.style.position = 'relative';
      (container || document.body).append(pet); return pet;
    }
  };
  if (script?.dataset.auto !== 'false') {
    const start = () => { window.LemonCat.instance = window.LemonCat.mount({ size: Number(script?.dataset.size) || 180, auto: script?.dataset.motion !== 'false', sprite: script?.dataset.sprite || base + 'assets/lemon-cat-sprites.png' }); };
    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start, { once: true }) : start();
  }
})();
