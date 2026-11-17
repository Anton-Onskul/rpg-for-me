// Интерфейс стола: экран мастера (как в Foundry VTT) и экран игрока, подключённого к мастеру.
// Логика и права — в table.js, связь — в net.js; здесь только отрисовка и обработка действий.
(function (root) {
  'use strict';
  const T = root.RPG_TABLE;
  const N = root.RPG_NET;
  const H = root.RPG_TIPS;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PEER_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
  const PEER_PREFIX = 'rpg-for-me-';
  const LS = 'rpg-table.';

  const ls = {
    get(k) { try { return localStorage.getItem(LS + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(LS + k, v); } catch (e) { /* хранилище недоступно */ } },
  };
  function myKey() {
    let k = ls.get('key');
    if (!k) { k = 'p' + Math.random().toString(36).slice(2, 12); ls.set('key', k); }
    return k;
  }

  // ---------- Подсказки «как в играх» ----------
  /** Всплывающая карточка со стрелкой к элементу. Не затемняет экран и не закрывает центр карты. */
  function createTips(el, role, getSys) {
    let storage = null;
    try { storage = window.localStorage; } catch (e) { /* недоступно */ }
    const st = H.store(storage);
    let prefs = st.load();
    let cur = null;
    const recent = [];
    const box = document.createElement('div');
    box.className = 'tip'; box.hidden = true;
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-live', 'polite');
    el.appendChild(box);
    const shown = (n) => !!n && n.getClientRects().length > 0 && !n.closest('[hidden]');
    function pick(trigger) {
      const skip = [];
      for (let i = 0; i < 50; i++) {
        const t = H.next(trigger, { role, sys: getSys(), prefs }, skip);
        if (!t) return null;
        if (shown($(t.target, el))) return t;
        skip.push(t.id); // элемента сейчас нет — подождём
      }
      return null;
    }
    function show(tip) {
      cur = tip;
      box.dataset.tip = tip.id;
      box.innerHTML = `<div class="tip-arrow"></div><div class="tip-title">💡 ${esc(tip.title)}</div><div class="tip-text">${esc(H.textFor(tip, getSys()))}</div>
        <div class="tip-btns"><button class="tb pri" data-tip-ok>Понятно</button><button class="tb" data-tip-off>Выключить подсказки</button></div>`;
      box.hidden = false;
      place();
    }
    function mark(n) { $$('.tip-target', el).forEach((x) => { if (x !== n) x.classList.remove('tip-target'); }); if (n) n.classList.add('tip-target'); }
    function hide() { cur = null; box.hidden = true; mark(null); }
    function fire(trigger) {
      const i = recent.indexOf(trigger); if (i >= 0) recent.splice(i, 1);
      recent.push(trigger);
      const t = pick(trigger);
      if (t && (!cur || cur.id !== t.id)) {
        if (cur) { prefs = H.markSeen(prefs, cur.id); st.save(prefs); } // её уже видели, на экран пришла новая
        show(t);
      }
    }
    function ok() {
      if (!cur) return;
      prefs = H.markSeen(prefs, cur.id); st.save(prefs); hide();
      for (let i = recent.length - 1; i >= 0; i--) { const t = pick(recent[i]); if (t) { show(t); return; } }
    }
    function syncToggle() {
      const b = $('#tipsToggle', el);
      if (b) { b.setAttribute('aria-pressed', String(prefs.enabled)); b.textContent = '💡 Подсказки'; b.title = prefs.enabled ? 'Подсказки включены — нажмите, чтобы выключить' : 'Подсказки выключены — нажмите, чтобы включить'; }
    }
    function setEnabled(on) { prefs.enabled = on; st.save(prefs); if (!on) hide(); syncToggle(); }
    function place() {
      if (!cur) return;
      const n = $(cur.target, el);
      if (!shown(n)) { hide(); return; }
      mark(n);
      const arrow = $('.tip-arrow', box);
      if (window.innerWidth < 700) { box.classList.add('dock'); box.style.left = box.style.top = ''; return; }
      box.classList.remove('dock');
      const r = n.getBoundingClientRect(), W = window.innerWidth, Hh = window.innerHeight, g = 12;
      const bw = box.offsetWidth, bh = box.offsetHeight;
      const clampX = (x) => Math.max(8, Math.min(W - bw - 8, x));
      const clampY = (y) => Math.max(8, Math.min(Hh - bh - 8, y));
      const vp = $('#mapVp', el);
      const m = vp ? vp.getBoundingClientRect() : null;
      const cx = m ? m.left + m.width / 2 : -1, cy = m ? m.top + m.height / 2 : -1;
      const cands = [
        { x: clampX(r.left + r.width / 2 - bw / 2), y: r.bottom + g, side: 'top' },
        { x: clampX(r.left + r.width / 2 - bw / 2), y: r.top - g - bh, side: 'bottom' },
        { x: r.right + g, y: clampY(r.top + r.height / 2 - bh / 2), side: 'left' },
        { x: r.left - g - bw, y: clampY(r.top + r.height / 2 - bh / 2), side: 'right' },
      ];
      const fits = (c) => c.x >= 0 && c.y >= 0 && c.x + bw <= W && c.y + bh <= Hh;
      const free = (c) => !(cx >= c.x && cx <= c.x + bw && cy >= c.y && cy <= c.y + bh);
      // не закрываем кнопки, которыми пользуются постоянно
      const busy = $$('.token, .map-tools button, .tabs2 button, .tools-r > *, .tbl-top select, #diceExpr, #diceRoll, .ck-panel:not([hidden])', el)
        .filter((x) => x !== n && !n.contains(x)).map((x) => x.getBoundingClientRect());
      const overlap = (c) => busy.reduce((sum, q) => sum + Math.max(0, Math.min(c.x + bw, q.right) - Math.max(c.x, q.left)) * Math.max(0, Math.min(c.y + bh, q.bottom) - Math.max(c.y, q.top)), 0);
      // запасные места — углы карты под панелью инструментов (цель тогда подсвечивается)
      if (m) {
        const mt = $('.map-tools', el); const top = (mt ? mt.getBoundingClientRect().bottom : m.top) + 8;
        cands.push({ x: m.left + 8, y: top, side: 'none' }, { x: m.right - bw - 8, y: top, side: 'none' },
          { x: m.left + 8, y: m.bottom - bh - 8, side: 'none' }, { x: m.right - bw - 8, y: m.bottom - bh - 8, side: 'none' });
      }
      const dist = (k) => Math.hypot(k.x + bw / 2 - (r.left + r.width / 2), k.y + bh / 2 - (r.top + r.height / 2));
      const ok = cands.filter((k) => fits(k) && free(k)).map((k) => ({ k, o: overlap(k), d: dist(k) })).sort((a, b) => (a.o - b.o) || (a.d - b.d));
      const c = (ok[0] && ok[0].k) || cands.find(fits) || { x: clampX(8), y: clampY(Hh - bh - 8), side: 'none' };
      box.style.left = Math.round(c.x) + 'px'; box.style.top = Math.round(c.y) + 'px';
      arrow.className = 'tip-arrow ' + c.side;
      if (c.side === 'top' || c.side === 'bottom') { arrow.style.left = Math.max(12, Math.min(bw - 24, r.left + r.width / 2 - c.x - 6)) + 'px'; arrow.style.top = ''; }
      else { arrow.style.top = Math.max(12, Math.min(bh - 24, r.top + r.height / 2 - c.y - 6)) + 'px'; arrow.style.left = ''; }
    }
    box.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target.closest('[data-tip-ok]')) ok();
      else if (e.target.closest('[data-tip-off]')) setEnabled(false);
    });
    const onResize = () => place();
    window.addEventListener('resize', onResize);
    syncToggle();
    return {
      fire, place, hide, syncToggle,
      toggle() { setEnabled(!prefs.enabled); },
      reset() { prefs = H.reset(); st.save(prefs); syncToggle(); },
      once(id) { if (prefs.seen.includes(id)) return false; prefs = H.markSeen(prefs, id); st.save(prefs); return true; },
      destroy() { window.removeEventListener('resize', onResize); box.remove(); },
    };
  }

  // ---------- Хранилище кампании мастера (IndexedDB, только это устройство) ----------
  function kv(mode, fn) {
    return new Promise((res, rej) => {
      try {
        const r = indexedDB.open('rpg-table', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onerror = () => rej(r.error);
        r.onsuccess = () => {
          const tx = r.result.transaction('kv', mode);
          const q = fn(tx.objectStore('kv'));
          tx.oncomplete = () => res(q && q.result);
          tx.onerror = () => rej(tx.error);
        };
      } catch (e) { rej(e); }
    });
  }

  // ---------- Интернет (PeerJS) ----------
  function loadPeer() {
    if (root.Peer) return Promise.resolve(root.Peer);
    if (root.claude) return Promise.reject(new Error('inside-claude'));
    if (typeof RTCPeerConnection === 'undefined') return Promise.reject(new Error('no-webrtc'));
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = PEER_URL;
      s.onload = () => (root.Peer ? res(root.Peer) : rej(new Error('no-peer')));
      s.onerror = () => rej(new Error('load-failed'));
      document.head.appendChild(s);
      setTimeout(() => rej(new Error('timeout')), 10000);
    });
  }

  // ---------- Картинки: уменьшаем перед отправкой игрокам ----------
  function readImage(file, maxSide, type) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onerror = () => rej(new Error('Не удалось прочитать файл'));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => rej(new Error('Это не картинка'));
        img.onload = () => {
          const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
          const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
          if (k === 1 && file.size < 1.5e6) { res({ data: fr.result, w, h }); return; }
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          res({ data: cv.toDataURL(type || 'image/jpeg', 0.85), w, h });
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  // ======================================================================
  // Общий стол: разметка, карта, панели. ctx = { gm, me, act, assets(), players() }
  // ======================================================================
  function createBoard(el, ctx) {
    const gm = ctx.gm;
    const TABS = gm
      ? [['scenes', 'Сцены'], ['tokens', 'Фишки'], ['combat', 'Бой'], ['journal', 'Журнал'], ['players', 'Игроки']]
      : [['combat', 'Бой'], ['journal', 'Журнал'], ['hero', 'Мой герой']];
    let tab = gm ? 'scenes' : 'combat';
    let view = null;
    let sel = null;          // выбранная фишка
    let tool = 'move';
    let cam = { x: 0, y: 0, z: 1, sceneId: null };
    let msgTimer = null;

    el.innerHTML = `<div class="tbl" id="tbl">
      <div class="tbl-top">
        ${gm ? `<div class="room">Код стола: <b id="roomCode" class="code">——</b> <span class="net" id="netState"></span></div>
          <label class="sys">НРИ <select id="tableSystem" aria-label="Во что играем">${Object.entries(T.SYSTEMS).map(([id, x]) => `<option value="${id}">${esc(x.name)}</option>`).join('')}</select></label>
          <div class="tools-r"><button class="tb" id="checklistBtn" aria-expanded="false" aria-controls="checklistPanel">С чего начать · 0/7</button><button class="tb" id="tipsToggle" aria-pressed="true">💡 Подсказки</button><button class="tb" id="campSave">Сохранить в файл</button><label class="tb" for="campLoad">Загрузить</label><input type="file" id="campLoad" accept=".json,application/json" class="sr"></div>`
        : `<div class="room">Стол мастера · <b id="tableSystemName"></b> <span class="net" id="netState"></span></div><div class="tools-r"><button class="tb" id="tipsToggle" aria-pressed="true">💡 Подсказки</button><button class="tb" id="leave">Выйти</button></div>`}
      </div>
      <section class="tbl-map">
        <div class="map-tools" role="toolbar" aria-label="Инструменты карты">
          <button class="tl" data-tool="move" aria-pressed="true" title="Двигать фишки и карту">✥ Двигать</button>
          ${gm ? '<button class="tl" data-tool="reveal" title="Открыть область тумана">☀ Открыть</button><button class="tl" data-tool="hide" title="Скрыть область туманом">☁ Скрыть</button>' : ''}
          <button class="tl" data-tool="measure" title="Линейка, футы">📏 Линейка</button>
          <span class="sp"></span>
          <button class="tl" id="zoomOut" aria-label="Отдалить">−</button><button class="tl" id="zoomFit" title="Вся карта">⤢</button><button class="tl" id="zoomIn" aria-label="Приблизить">+</button>
        </div>
        <div class="map-vp" id="mapVp"><div class="map-empty" id="mapEmpty"></div>
          <div class="map-world" id="mapWorld">
            <div class="map-bg" id="mapBg"></div>
            <svg class="map-grid" id="mapGrid"></svg>
            <canvas class="map-fog" id="mapFog"></canvas>
            <div class="map-tokens" id="mapTokens"></div>
            <svg class="map-over" id="mapOver"></svg>
          </div>
        </div>
        <div class="map-hint" id="mapHint"></div>
        ${gm ? '<div class="ck-panel" id="checklistPanel" hidden></div>' : ''}
      </section>
      <aside class="tbl-side">
        <div class="tabs2" role="tablist">${TABS.map(([k, n]) => `<button role="tab" data-tab="${k}" aria-selected="${k === tab}">${n}</button>`).join('')}</div>
        ${TABS.map(([k]) => `<div class="pane" data-pane="${k}" ${k === tab ? '' : 'hidden'}></div>`).join('')}
      </aside>
      <aside class="tbl-chat">
        <h3>Кубики и чат</h3>
        <div class="dice">
          <div class="quick" id="diceQuick"></div>
          <div class="row"><label class="sr" for="diceExpr">Бросок</label><input id="diceExpr" autocomplete="off">
            <button class="tb pri" id="diceRoll">Бросить</button></div>
          <div class="row small"><span id="diceOpts"></span>
            <label><input type="checkbox" id="diceSecret"> ${gm ? 'скрытно' : 'только мастеру'}</label></div>
          <div class="err" id="diceMsg" aria-live="polite"></div>
        </div>
        <div class="chat-log" id="chatLog" aria-live="polite"></div>
        <div class="row"><label class="sr" for="chatText">Сообщение</label><input id="chatText" placeholder="Сообщение…" autocomplete="off"><button class="tb" id="chatSend">→</button></div>
      </aside>
    </div>`;

    const vp = $('#mapVp', el), world = $('#mapWorld', el);
    const sysId = () => T.systemOf(view);
    const sys = () => T.SYSTEMS[sysId()];
    let shownSys = null;
    /** Кубики, подсказки и название НРИ — перерисовываются, когда мастер меняет систему. */
    function drawSystem() {
      const id = sysId(), x = T.SYSTEMS[id];
      if (shownSys === id) return;
      shownSys = id;
      $('#diceQuick', el).innerHTML = x.dice.quick.map((d) => `<button class="tb" data-die="${d}">к${d}</button>`).join('')
        + (x.dice.skill ? '<button class="tb" data-die3="1">3к6</button>' : '');
      $('#diceExpr', el).placeholder = x.dice.placeholder;
      $('#diceOpts', el).innerHTML = x.dice.advantage
        ? '<label><select id="diceMode" aria-label="Режим броска"><option value="">обычный</option><option value=" преим">с преимуществом</option><option value=" помеха">с помехой</option></select></label>'
        : x.dice.skill ? '<label>навык <input id="diceSkill" type="number" min="-10" max="40" style="width:4.2em" aria-label="Значение навыка для проверки 3к6"></label>' : '';
      const nm = $('#tableSystemName', el); if (nm) nm.textContent = x.name;
      const sel = $('#tableSystem', el); if (sel) sel.value = id;
      $$('[data-tool="measure"]', el).forEach((b) => { b.title = 'Линейка, ' + (x.cell.unit === 'фт' ? 'футы' : x.cell.unit === 'ярд' ? 'ярды' : 'клетки'); });
    }
    const scene = () => (view ? T.activeScene(view) : null);
    const cellPx = () => (scene() ? scene().grid.size : 50);
    const flash = (id, text) => { const n = $('#' + id, el); if (!n) return; n.textContent = text; clearTimeout(msgTimer); msgTimer = setTimeout(() => { n.textContent = ''; }, 4000); };
    const hint = (t) => { $('#mapHint', el).textContent = t || ''; };
    const act = (a, errId) => {
      const r = ctx.act(a);
      if (r && r.ok === false) flash(errId || 'diceMsg', r.error);
      return r;
    };

    // ---------- Камера ----------
    function applyCam() { world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`; }
    function fit() {
      const sc = scene(); if (!sc) return;
      const r = vp.getBoundingClientRect();
      const z = Math.min(r.width / sc.w, r.height / sc.h, 2) || 1;
      cam = { x: (r.width - sc.w * z) / 2, y: (r.height - sc.h * z) / 2, z, sceneId: sc.id };
      applyCam();
    }
    function zoomAt(f, cx, cy) {
      const r = vp.getBoundingClientRect();
      const px = cx == null ? r.width / 2 : cx - r.left, py = cy == null ? r.height / 2 : cy - r.top;
      const nz = Math.min(4, Math.max(0.15, cam.z * f));
      cam.x = px - (px - cam.x) * (nz / cam.z);
      cam.y = py - (py - cam.y) * (nz / cam.z);
      cam.z = nz;
      applyCam();
    }
    const toWorld = (cx, cy) => { const r = vp.getBoundingClientRect(); return { x: (cx - r.left - cam.x) / cam.z, y: (cy - r.top - cam.y) / cam.z }; };

    // ---------- Отрисовка карты ----------
    function canMove(t) { return gm || (t.owner && t.owner === ctx.me()); }
    function drawMap() {
      const sc = scene();
      $('#mapEmpty', el).textContent = sc ? '' : (gm ? 'Создайте сцену во вкладке «Сцены»: загрузите картинку карты.' : 'Мастер ещё не открыл сцену.');
      world.hidden = !sc;
      if (!sc) return;
      if (cam.sceneId !== sc.id) { world.style.width = sc.w + 'px'; world.style.height = sc.h + 'px'; requestAnimationFrame(fit); cam.sceneId = sc.id; }
      world.style.width = sc.w + 'px'; world.style.height = sc.h + 'px';
      const bg = $('#mapBg', el);
      const img = sc.image && ctx.assets()[sc.image];
      bg.className = 'map-bg' + (img ? '' : ' blank');
      bg.style.backgroundImage = img ? `url("${img}")` : '';
      const g = sc.grid, svg = $('#mapGrid', el);
      svg.setAttribute('width', sc.w); svg.setAttribute('height', sc.h);
      svg.innerHTML = g.show === false ? '' : `<defs><pattern id="gp" width="${g.size}" height="${g.size}" patternUnits="userSpaceOnUse" x="${g.offsetX || 0}" y="${g.offsetY || 0}">
        <path d="M ${g.size} 0 L 0 0 0 ${g.size}" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="1"/></pattern></defs><rect width="100%" height="100%" fill="url(#gp)"/>`;
      drawFog();
      const cur = T.combat.current(view);
      $('#mapTokens', el).innerHTML = sc.tokens.map((t) => {
        const px = (t.size || 1) * g.size;
        const timg = t.img && ctx.assets()[t.img];
        const showHp = t.hp != null && t.hpMax;
        const pct = showHp ? Math.max(0, Math.min(100, Math.round((t.hp / t.hpMax) * 100))) : 0;
        return `<div class="token ${t.kind}${canMove(t) ? ' mine' : ''}${sel === t.id ? ' sel' : ''}${t.hidden ? ' ghost' : ''}${cur && cur.tokenId === t.id ? ' turn' : ''}"
          data-id="${esc(t.id)}" data-name="${esc(t.name)}" data-x="${t.x}" data-y="${t.y}" title="${esc(t.name)}${t.health ? ' — ' + esc(t.health) : ''}"
          style="left:${t.x - px / 2}px;top:${t.y - px / 2}px;width:${px}px;height:${px}px;--c:${esc(t.color || '#888')};${timg ? `background-image:url('${timg}')` : ''}">
          ${timg ? '' : `<span class="ini">${esc((t.name || '?').slice(0, 2))}</span>`}
          <span class="lbl">${esc(t.name)}</span>
          ${showHp ? `<span class="hpbar"><i style="width:${pct}%"></i></span>` : (t.health && t.health !== 'цел' ? `<span class="hst">${esc(t.health)}</span>` : '')}
        </div>`;
      }).join('');
      applyCam();
    }
    function drawFog() {
      const sc = scene(); const cv = $('#mapFog', el);
      if (!sc) return;
      cv.width = sc.w; cv.height = sc.h;
      const c2 = cv.getContext('2d');
      c2.clearRect(0, 0, sc.w, sc.h);
      if (!sc.fog.enabled) return;
      c2.fillStyle = gm ? 'rgba(10,12,20,.55)' : '#0a0c14';
      c2.fillRect(0, 0, sc.w, sc.h);
      const g = sc.grid;
      for (const k of sc.fog.revealed) {
        const [c, r] = k.split(',').map(Number);
        c2.clearRect(c * g.size + (g.offsetX || 0), r * g.size + (g.offsetY || 0), g.size, g.size);
      }
    }

    // ---------- Мышь и палец на карте ----------
    let drag = null;
    vp.addEventListener('pointerdown', (e) => {
      if (!scene() || e.button > 0) return;
      const tEl = e.target.closest('.token');
      const p = toWorld(e.clientX, e.clientY);
      vp.setPointerCapture(e.pointerId);
      if (tool === 'move' && tEl) {
        const t = scene().tokens.find((x) => x.id === tEl.dataset.id);
        drag = { kind: canMove(t) ? 'token' : 'select', el: tEl, id: tEl.dataset.id, sx: e.clientX, sy: e.clientY, ox: t.x, oy: t.y, moved: false };
      } else if (tool === 'move') {
        drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y };
      } else {
        drag = { kind: tool, start: p, end: p };
      }
      e.preventDefault();
    });
    vp.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (drag.kind === 'pan') { cam.x = drag.cx + e.clientX - drag.sx; cam.y = drag.cy + e.clientY - drag.sy; applyCam(); return; }
      if (drag.kind === 'token') {
        const dx = (e.clientX - drag.sx) / cam.z, dy = (e.clientY - drag.sy) / cam.z;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        const px = parseFloat(drag.el.style.width);
        drag.el.style.left = (drag.ox + dx - px / 2) + 'px';
        drag.el.style.top = (drag.oy + dy - px / 2) + 'px';
        const a = T.grid.cellOf(drag.ox, drag.oy, scene().grid), b = T.grid.cellOf(drag.ox + dx, drag.oy + dy, scene().grid);
        hint(T.grid.distance(a, b, sysId()).text);
        return;
      }
      if (drag.kind === 'select') return;
      drag.end = toWorld(e.clientX, e.clientY);
      drawOverlay();
    });
    const endDrag = (e) => {
      if (!drag) return;
      const d = drag; drag = null;
      hint('');
      const sc = scene();
      if (d.kind === 'token') {
        if (d.moved) {
          const px = parseFloat(d.el.style.width);
          act({ type: 'token.move', tokenId: d.id, x: parseFloat(d.el.style.left) + px / 2, y: parseFloat(d.el.style.top) + px / 2 });
          drawMap();
        } else selectToken(d.id);
      } else if (d.kind === 'select') {
        selectToken(d.id);
      } else if ((d.kind === 'reveal' || d.kind === 'hide') && sc) {
        const a = T.grid.cellOf(d.start.x, d.start.y, sc.grid), b = T.grid.cellOf(d.end.x, d.end.y, sc.grid);
        act({ type: d.kind === 'reveal' ? 'fog.reveal' : 'fog.hide', rect: { c0: a.c, r0: a.r, c1: b.c, r1: b.r } });
        $('#mapOver', el).innerHTML = '';
      } else if (d.kind === 'measure') {
        setTimeout(() => { if (!drag) $('#mapOver', el).innerHTML = ''; }, 1500);
      }
    };
    vp.addEventListener('pointerup', endDrag);
    vp.addEventListener('pointercancel', endDrag);
    vp.addEventListener('wheel', (e) => { if (!scene()) return; e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); }, { passive: false });
    function drawOverlay() {
      const sc = scene(); const d = drag; const svg = $('#mapOver', el);
      svg.setAttribute('width', sc.w); svg.setAttribute('height', sc.h);
      if (!d) { svg.innerHTML = ''; return; }
      const g = sc.grid;
      if (d.kind === 'measure') {
        const a = T.grid.cellOf(d.start.x, d.start.y, g), b = T.grid.cellOf(d.end.x, d.end.y, g);
        const dist = T.grid.distance(a, b, sysId());
        const cells = T.grid.distance(a, b, 'munchkin').n;
        svg.innerHTML = `<line x1="${d.start.x}" y1="${d.start.y}" x2="${d.end.x}" y2="${d.end.y}" class="ruler"/>
          <text x="${d.end.x + 8}" y="${d.end.y - 8}" class="ruler-t">${esc(dist.text)}${dist.unit === 'кл.' ? '' : ` (${cells} кл.)`}</text>`;
        hint(dist.text);
      } else {
        const a = T.grid.cellOf(d.start.x, d.start.y, g), b = T.grid.cellOf(d.end.x, d.end.y, g);
        const x = Math.min(a.c, b.c) * g.size + (g.offsetX || 0), y = Math.min(a.r, b.r) * g.size + (g.offsetY || 0);
        const w = (Math.abs(a.c - b.c) + 1) * g.size, h = (Math.abs(a.r - b.r) + 1) * g.size;
        svg.innerHTML = `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="${d.kind === 'reveal' ? 'fog-on' : 'fog-off'}"/>`;
      }
    }

    // ---------- Панели ----------
    el.addEventListener('click', (e) => {
      const tb = e.target.closest('[data-tab]');
      if (tb) { goTab(tb.dataset.tab); return; }
      if (e.target.closest('#tipsToggle')) { tips.toggle(); return; }
      if (e.target.closest('#checklistBtn')) { toggleChecklist(); return; }
      if (e.target.closest('#tipsReset')) { tips.reset(); toggleChecklist(false); return; }
      if (e.target.closest('#checklistClose')) { toggleChecklist(false); return; }
      const ck = e.target.closest('.ck-item');
      if (ck) { goTab(ck.dataset.goto); return; }
      const tl = e.target.closest('[data-tool]');
      if (tl) { tool = tl.dataset.tool; $$('[data-tool]', el).forEach((b) => b.setAttribute('aria-pressed', String(b === tl))); hint({ move: '', reveal: 'Выделите область — она откроется игрокам', hide: 'Выделите область — она скроется туманом', measure: 'Потяните, чтобы измерить расстояние' }[tool]); if (tool !== 'move') tips.fire('tool:' + tool); return; }
      if (e.target.closest('#zoomIn')) return zoomAt(1.25);
      if (e.target.closest('#zoomOut')) return zoomAt(0.8);
      if (e.target.closest('#zoomFit')) return fit();
      const die = e.target.closest('[data-die]');
      if (die) { $('#diceExpr', el).value = '1к' + die.dataset.die; roll(); return; }
      if (e.target.closest('[data-die3]')) { $('#diceExpr', el).value = '3к6'; roll(); return; }
      if (e.target.closest('#diceRoll')) return roll();
      if (e.target.closest('#chatSend')) return say();
      if (ctx.onClick) ctx.onClick(e, api);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (e.target.id === 'diceExpr' || e.target.id === 'diceSkill') { e.preventDefault(); roll(); }
      if (e.target.id === 'chatText') { e.preventDefault(); say(); }
    });
    el.addEventListener('change', (e) => { if (ctx.onChange) ctx.onChange(e, api); });
    function roll() {
      const expr = $('#diceExpr', el).value.trim();
      const skillEl = $('#diceSkill', el);
      const secret = $('#diceSecret', el).checked;
      if (skillEl && skillEl.value !== '' && (!expr || /^3[кkdд]6$/i.test(expr))) {
        act({ type: 'chat.roll', expr: '3к6', skill: Number(skillEl.value), gmOnly: secret }); return;
      }
      if (!expr) { flash('diceMsg', 'Впишите бросок, например ' + sys().dice.placeholder.split(',')[0]); return; }
      const mode = $('#diceMode', el);
      const full = expr + ((mode && mode.value) || '');
      if (!T.dice.parse(full)) { flash('diceMsg', 'Не понял запись броска. Пример: ' + sys().dice.placeholder); return; }
      act({ type: 'chat.roll', expr: full, gmOnly: secret });
    }
    function say() {
      const inp = $('#chatText', el);
      if (!inp.value.trim()) return;
      act({ type: 'chat.say', text: inp.value });
      inp.value = '';
    }
    function drawChat() {
      const log = $('#chatLog', el);
      const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
      log.innerHTML = view.chat.slice(-120).map((m) => {
        const who = `<b class="${m.gm ? 'gm' : ''}">${esc(m.from)}</b>${m.gmOnly ? ' <span class="tag">скрыто</span>' : ''}`;
        if (m.check) {
          const c = m.check;
          const verdict = c.crit === 'success' ? 'критический успех' : c.crit === 'fail' ? 'критический провал' : c.success ? 'успех' : 'провал';
          return `<div class="msg roll${c.crit === 'success' ? ' hit' : c.crit === 'fail' ? ' miss' : ''}">${who} проверяет ${m.label ? esc(m.label) + ', ' : ''}<span class="ex">навык ${c.skill}</span>
            <div class="res"><span class="tot">${c.total}</span> <span class="det">[${c.rolls.join(', ')}]</span> <span class="tag">${verdict}${c.crit ? '' : `, запас ${c.margin >= 0 ? c.margin : '−' + Math.abs(c.margin)}`}</span></div></div>`;
        }
        if (m.roll) {
          return `<div class="msg roll${m.roll.crit ? ' ' + m.roll.crit : ''}">${who} бросает <span class="ex">${esc(m.roll.expr)}</span>
            <div class="res"><span class="tot">${m.roll.total}</span> <span class="det">${esc(m.roll.text)}</span>${m.roll.crit === 'hit' ? ' <span class="tag">крит!</span>' : m.roll.crit === 'miss' ? ' <span class="tag">провал</span>' : ''}</div></div>`;
        }
        return `<div class="msg">${who}: ${esc(m.text)}</div>`;
      }).join('') || '<p class="muted">Здесь появятся броски и сообщения.</p>';
      if (atBottom) log.scrollTop = log.scrollHeight;
    }
    function selectToken(id) {
      sel = id;
      if (gm) { tab = 'tokens'; $$('[data-tab]', el).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab))); $$('[data-pane]', el).forEach((p) => { p.hidden = p.dataset.pane !== tab; }); }
      drawMap(); renderPanes();
      if (gm && id) tips.fire('select:token');
    }
    function goTab(k) {
      if (!k || !$(`[data-tab="${k}"]`, el)) return;
      tab = k;
      $$('[data-tab]', el).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
      $$('[data-pane]', el).forEach((p) => { p.hidden = p.dataset.pane !== tab; });
      renderPanes();
      tips.fire('tab:' + tab);
    }
    function toggleChecklist(force) {
      const p = $('#checklistPanel', el), b = $('#checklistBtn', el);
      if (!p) return;
      const open = force === undefined ? p.hidden : force;
      p.hidden = !open; b.setAttribute('aria-expanded', String(open));
    }
    function drawChecklist(v) {
      const b = $('#checklistBtn', el), p = $('#checklistPanel', el);
      if (!b || !p) return;
      const list = H.checklist(v);
      const done = list.filter((x) => x.done).length;
      b.textContent = 'С чего начать · ' + done + '/' + list.length + (done === list.length ? ' ✓' : '');
      p.innerHTML = `<div class="ck-head">С чего начать</div>${list.map((x, i) => `<button class="ck-item${x.done ? ' done' : ''}" data-step="${x.id}" data-goto="${x.tab}"><span class="ck-box" aria-hidden="true">${x.done ? '✓' : i + 1}</span>${esc(x.title)}<span class="sr">${x.done ? ' — готово' : ''}</span></button>`).join('')}
        <div class="ck-foot"><button class="tb" id="tipsReset">Показать подсказки заново</button><button class="tb" id="checklistClose">Свернуть</button></div>`;
    }
    const tips = createTips(el, gm ? 'gm' : 'player', () => T.systemOf(view));
    let opened = false, prevCombat = null, prevPlayers = null, prevMyTurn = null;
    el.addEventListener('focusin', (e) => { if (e.target.id === 'diceExpr') tips.fire('focus:dice'); });
    /** События для подсказок: начало боя, первый игрок, ход игрока. */
    function watch(v) {
      const active = !!(v.combat && v.combat.active);
      const players = Object.keys(v.players || {}).length;
      const cur = T.combat.current(v);
      const sc = T.activeScene(v);
      const tk = cur && sc ? sc.tokens.find((t) => t.id === cur.tokenId) : null;
      const myTurn = !gm && !!(tk && tk.owner === ctx.me());
      if (prevCombat === false && active && gm) setTimeout(() => tips.fire('combat:start'), 50);
      if (prevPlayers === 0 && players > 0 && gm) tips.fire('player:first');
      if (prevMyTurn === false && myTurn) tips.fire('turn:mine');
      prevCombat = active; prevPlayers = players; prevMyTurn = myTurn;
      if (!opened) {
        opened = true;
        if (gm && window.innerWidth >= 700 && tips.once('checklist-shown')) toggleChecklist(true); // на телефоне не закрываем карту — туда укажет подсказка
        setTimeout(() => tips.fire('open'), 300);
      }
    }
    function renderPanes() {
      if (!view) return;
      const pane = $(`[data-pane="${tab}"]`, el);
      // все панели держим в DOM — так их можно найти и на узком экране
      $$('[data-pane]', el).forEach((p) => {
        const k = p.dataset.pane;
        const f = document.activeElement;
        if (f && p.contains(f) && /^(INPUT|TEXTAREA|SELECT)$/.test(f.tagName) && f.type !== 'checkbox' && f.type !== 'file') return; // не мешаем вводу
        p.innerHTML = ctx.pane(k, view, api);
      });
      return pane;
    }
    const api = {
      el, flash, act, fit, sysId, sys,
      get view() { return view; }, get sel() { return sel; }, set sel(v) { sel = v; },
      scene, cellPx, selectToken,
      update(v) {
        view = v;
        drawSystem();
        if (sel && !(scene() && scene().tokens.some((t) => t.id === sel))) sel = null;
        drawMap(); drawChat(); renderPanes();
        drawChecklist(v); watch(v); tips.place();
      },
      destroyTips() { tips.destroy(); },
      setNet(text, ok) { const n = $('#netState', el); if (n) { n.textContent = text; n.className = 'net ' + (ok ? 'ok' : 'off'); } },
    };
    $$('[data-tool]', el).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
    return api;
  }

  // ---------- Общие части панелей ----------
  /** Инициатива по правилам НРИ: D&D — к20 + бонус, GURPS — Базовая скорость, Манчкин — к6 + бонус. */
  function initFor(sysId, bonus) {
    const x = T.SYSTEMS[sysId];
    if (!x.init.roll) return { total: Number(bonus) || 0, text: String(Number(bonus) || 0) };
    const r = T.dice.roll(x.init.roll + (Number(bonus) ? (bonus > 0 ? '+' : '') + Number(bonus) : ''));
    return { total: r.total, text: r.text };
  }
  function combatPane(v, gm, me) {
    const sc = T.activeScene(v);
    const cur = T.combat.current(v);
    const byId = {};
    (sc ? sc.tokens : []).forEach((t) => { byId[t.id] = t; });
    if (!v.combat.active) {
      return `<p class="muted">Бой не идёт.</p>${gm ? '<button class="tb pri" id="combatStart">Начать бой</button>' : ''}<div id="combatList"></div><div id="combatRound"></div>`;
    }
    const mine = (sc ? sc.tokens : []).filter((t) => t.owner === me);
    const myTurn = cur && byId[cur.tokenId] && byId[cur.tokenId].owner === me;
    return `<div class="cb-head"><b id="combatRound">Раунд ${v.combat.round}</b>${v.combat.hiddenTurn ? ' <span class="muted">· ходит кто-то невидимый</span>' : ''}</div>
      <div id="combatList">${v.combat.order.map((o, i) => {
        const t = byId[o.tokenId] || { name: '?' };
        return `<div class="cb${!v.combat.hiddenTurn && i === v.combat.turn ? ' now' : ''}" data-cb="${esc(o.tokenId)}">
          <span class="dot" style="background:${esc(t.color || '#888')}"></span><span class="nm">${esc(t.name)}</span>
          ${t.hp != null && t.hpMax ? `<span class="hp">${t.hp}/${t.hpMax}</span>` : (t.health ? `<span class="hp">${esc(t.health)}</span>` : '')}
          ${gm ? `<input class="ini" type="number" value="${o.init}" data-init="${esc(o.tokenId)}" aria-label="Инициатива ${esc(t.name)}"><button class="x" data-cbremove="${esc(o.tokenId)}" aria-label="Убрать из боя">✕</button>` : `<span class="ini-v">${o.init}</span>`}
        </div>`;
      }).join('') || '<p class="muted">В бою пока никого.</p>'}</div>
      <div class="tools">
        ${gm ? '<button class="tb" id="combatPrev">← Назад</button><button class="tb pri" id="combatNext">Следующий ход →</button><button class="tb" id="combatAddAll">Добавить всех на сцене</button><button class="tb" id="combatEnd">Закончить бой</button>'
          : `${myTurn ? '<button class="tb pri" id="combatNext">Завершить ход</button>' : ''}`}
      </div>
      ${!gm && mine.length ? (() => { const x = T.SYSTEMS[T.systemOf(v)]; return `<div class="row"><label for="myInitMod">${esc(x.init.label)}${x.init.roll ? ' (' + x.init.roll + ' + он)' : ''}</label><input id="myInitMod" type="number" step="${x.init.roll ? 1 : 0.25}" value="${x.init.roll ? 0 : 5}" style="width:4.5em"><button class="tb" id="myInitRoll">${x.init.roll ? 'Бросить' : 'Заявить'} за ${esc(mine[0].name)}</button></div>`; })() : ''}`;
  }
  const cap = (k) => k.charAt(0).toUpperCase() + k.slice(1);
  /** Сводка листа игрока под его НРИ. */
  function sheetKv(sh) {
    const kv = (label, value) => (value == null || value === '' ? '' : `<span>${label} <b>${esc(value)}</b></span>`);
    if (sh.tsys === 'munchkin') return kv('Уровень', sh.level) + kv('Сила в бою', sh.power);
    if (sh.tsys === 'gurps') return kv('Очки', sh.points) + (sh.hp != null ? kv('ЕЖ', sh.hp + '/' + sh.hpMax) : '') + kv('Уклонение', sh.dodge) + kv('Движение', sh.speed) + kv('Баз. скорость', sh.init);
    return (sh.hp != null ? kv('Хиты', sh.hp + '/' + sh.hpMax) : '') + kv('КД', sh.ac) + kv('Пасс. внимат.', sh.passive) + kv('Скорость', sh.speed);
  }
  function journalPane(v, gm) {
    if (!gm) {
      return v.journal.length ? v.journal.map((j) => `<article class="jr"><h4>${esc(j.title)}</h4><div class="jt">${esc(j.text)}</div></article>`).join('')
        : '<p class="muted">Мастер пока ничего не показал.</p>';
    }
    return `<div class="form"><label for="jTitle">Заголовок</label><input id="jTitle"><label for="jText">Текст</label><textarea id="jText" rows="3"></textarea>
        <label class="chk"><input type="checkbox" id="jShared"> Показать игрокам</label><button class="tb pri" id="jAdd">Добавить запись</button></div>
      ${v.journal.map((j) => `<article class="jr" data-jid="${esc(j.id)}"><input class="jt-title" value="${esc(j.title)}" data-jtitle="${esc(j.id)}" aria-label="Заголовок">
        <textarea rows="3" data-jtext="${esc(j.id)}" aria-label="Текст">${esc(j.text)}</textarea>
        <div class="tools"><label class="chk"><input type="checkbox" data-jshare="${esc(j.id)}" ${j.shared ? 'checked' : ''}> видно игрокам</label><button class="tb" data-jdel="${esc(j.id)}">Удалить</button></div></article>`).join('')}`;
  }

  // ======================================================================
  // Мастер
  // ======================================================================
  function mountGM(el, opts) {
    let host = null;
    let code = null;
    let saveTimer = null;
    let destroyed = false;
    const multi = N.multiTransport([]);
    const assetsOf = () => (host ? host.assets : {});

    const board = createBoard(el, {
      gm: true,
      me: () => 'gm',
      act: (a) => host.act(a),
      assets: assetsOf,
      pane: (k, v, b) => gmPane(k, v, b),
      onClick: (e, b) => gmClick(e, b),
      onChange: (e, b) => gmChange(e, b),
    });

    const write = () => { saveTimer = null; return kv('readwrite', (st) => st.put({ state: host.state, assets: host.assets, code }, 'campaign')).catch(() => board.flash('netState', 'Не удалось сохранить на устройстве — выгрузите файл')); };
    let lastWrite = 0;
    /** Первое изменение после паузы пишется сразу, частые (перетаскивание) — пачкой через 400 мс. */
    function save() {
      clearTimeout(saveTimer);
      if (Date.now() - lastWrite > 1000) { lastWrite = Date.now(); write(); return; }
      saveTimer = setTimeout(() => { lastWrite = Date.now(); write(); }, 400);
    }
    // уходя со страницы — сохранить сразу, не дожидаясь паузы
    const flush = () => { if (saveTimer && host) { clearTimeout(saveTimer); write(); } };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    function start(saved) {
      code = (saved && saved.code) || N.roomCode();
      const st = (saved && saved.state) || T.newState();
      st.system = T.systemOf(st);
      host = N.createHost(multi, st);
      if (saved && saved.assets) host.assets = saved.assets;
      host.onChange = () => { board.update(host.state); save(); };
      $('#roomCode', el).textContent = code;
      multi.add(N.channelTransport(code, 'gm'));
      board.setNet('· подключение…', false);
      loadPeer().then((Peer) => N.peerTransport(Peer, PEER_PREFIX + code)).then((t) => {
        if (destroyed) { t.close(); return; }
        multi.add(t);
        board.setNet('· игроки могут подключаться по интернету', true);
      }).catch((err) => {
        board.setNet(err && err.message === 'inside-claude'
          ? '· по интернету — только в версии сайта; здесь можно открыть стол игрока в соседней вкладке'
          : '· интернет-подключение недоступно, работает только на этом устройстве', false);
      });
      board.update(host.state);
    }
    kv('readonly', (st) => st.get('campaign')).then((s) => start(s)).catch(() => start(null));

    // ---------- Панели мастера ----------
    function gmPane(k, v) {
      const sc = T.activeScene(v);
      if (k === 'scenes') {
        return `<div id="sceneList" class="list">${v.scenes.map((s) => `<div class="li${s.id === v.activeSceneId ? ' on' : ''}">
            <span class="nm">${esc(s.name)}</span>${s.id === v.activeSceneId ? '<span class="tag">у игроков</span>' : `<button class="tb" data-activate="${esc(s.id)}">Показать игрокам</button>`}
            <button class="x" data-sdel="${esc(s.id)}" aria-label="Удалить сцену ${esc(s.name)}">✕</button></div>`).join('') || '<p class="muted">Сцен пока нет.</p>'}</div>
          <div class="form"><h4>Новая сцена</h4>
            <label for="sceneName">Название</label><input id="sceneName" placeholder="Например, Таверна">
            <label for="sceneImage">Картинка карты (по желанию)</label><input type="file" id="sceneImage" accept="image/*">
            <label for="sceneGridNew">Размер клетки, px</label><input id="sceneGridNew" type="number" value="50" min="10" max="400">
            <button class="tb pri" id="sceneAdd">Создать сцену</button><div class="err" id="sceneMsg"></div></div>
          ${sc ? `<div class="form"><h4>Текущая: ${esc(sc.name)}</h4>
            <label for="sceneGrid">Размер клетки, px</label><input id="sceneGrid" type="number" value="${sc.grid.size}" min="10" max="400">
            <label class="chk"><input type="checkbox" id="gridShow" ${sc.grid.show !== false ? 'checked' : ''}> Показывать сетку</label>
            <label class="chk"><input type="checkbox" id="fogEnabled" ${sc.fog.enabled ? 'checked' : ''}> Туман войны</label>
            ${sc.fog.enabled ? '<div class="tools"><button class="tb" id="fogAll">Открыть всё</button><button class="tb" id="fogNone">Скрыть всё</button></div><p class="muted">Инструменты «Открыть» и «Скрыть» над картой — выделяйте области.</p>' : ''}
          </div>` : ''}`;
      }
      if (k === 'tokens') {
        const t = sc && board.sel ? sc.tokens.find((x) => x.id === board.sel) : null;
        const fields = T.SYSTEMS[T.systemOf(v)].fields;
        const players = Object.entries(v.players);
        return `${t ? `<div class="form" id="tokEdit"><h4>Фишка: ${esc(t.name)}</h4>
            <label for="tokEditName">Имя</label><input id="tokEditName" value="${esc(t.name)}">
            <label for="tokEditKind">Тип</label><select id="tokEditKind"><option value="npc" ${t.kind === 'npc' ? 'selected' : ''}>Мастерский (монстр, NPC)</option><option value="pc" ${t.kind === 'pc' ? 'selected' : ''}>Герой игрока</option></select>
            <label for="tokEditOwner">Управляет</label><select id="tokEditOwner"><option value="">никто (только мастер)</option>${players.map(([id, p]) => `<option value="${esc(id)}" ${t.owner === id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
            <div class="two">${fields.map((f) => `<div><label for="tokEdit${cap(f.key)}">${esc(f.label)}</label><input id="tokEdit${cap(f.key)}" data-field="${f.key}" type="number" value="${t[f.key] ?? ''}"></div>`).join('')}</div>
            <div class="two"><div><label for="tokEditSize">Размер, клеток</label><input id="tokEditSize" type="number" step="0.5" min="0.5" max="4" value="${t.size || 1}"></div><div><label for="tokEditColor">Цвет</label><input id="tokEditColor" type="color" value="${esc(t.color || '#888888')}"></div></div>
            <label class="chk"><input type="checkbox" id="tokEditHidden" ${t.hidden ? 'checked' : ''}> Скрыта от игроков</label>
            <div class="tools"><button class="tb" id="tokToCombat">В бой</button><button class="tb" id="tokDel">Удалить</button><button class="tb" id="tokUnsel">Готово</button></div></div>` : ''}
          <div class="form"><h4>Новая фишка</h4>${sc ? `
            <label for="tokName">Имя</label><input id="tokName" placeholder="Гоблин">
            <label for="tokKind">Тип</label><select id="tokKind"><option value="npc">Мастерский (монстр, NPC)</option><option value="pc">Герой игрока</option></select>
            <div class="two">${fields.filter((f) => f.key !== 'hpMax').map((f) => `<div><label for="tok${cap(f.key)}">${esc(f.label)}</label><input id="tok${cap(f.key)}" data-newfield="${f.key}" type="number"></div>`).join('')}</div>
            <label for="tokImage">Картинка (по желанию)</label><input type="file" id="tokImage" accept="image/*">
            <button class="tb pri" id="tokAdd">Добавить на карту</button><div class="err" id="tokMsg"></div>` : '<p class="muted">Сначала создайте сцену.</p>'}</div>
          <div class="list">${sc ? sc.tokens.map((x) => `<div class="li"><span class="dot" style="background:${esc(x.color)}"></span><button class="lnk" data-pick="${esc(x.id)}">${esc(x.name)}</button>${x.hidden ? ' <span class="tag">скрыта</span>' : ''}${T.SYSTEMS[T.systemOf(v)].hp && x.hp != null ? ` <span class="muted">${x.hp}/${x.hpMax ?? '?'}</span>` : ''}${T.systemOf(v) === 'munchkin' && x.level != null ? ` <span class="muted">ур. ${x.level}</span>` : ''}</div>`).join('') : ''}</div>`;
      }
      if (k === 'combat') return combatPane(v, true, 'gm');
      if (k === 'journal') return journalPane(v, true);
      if (k === 'players') {
        const ps = Object.entries(v.players);
        const online = new Set(Object.values(host ? host.peers : {}).map((p) => p.actor));
        return `<div id="playerList" class="list">${ps.map(([id, p]) => `<div class="pl"><b>${esc(p.name)}</b> <span class="tag ${online.has(id) ? 'on' : ''}">${online.has(id) ? 'в игре' : 'не в сети'}</span>
            ${p.sheet ? `<div class="sheet">${esc(p.sheet.name || '')}${p.sheet.race ? ' · ' + esc(p.sheet.race) : ''}${p.sheet.cls ? ' · ' + esc(p.sheet.cls) : ''}${p.sheet.level && p.sheet.tsys !== 'munchkin' && p.sheet.tsys !== 'gurps' ? ' · ' + esc(p.sheet.level) + ' ур.' : ''}
              <div class="kv">${sheetKv(p.sheet)}</div></div>` : '<div class="muted">лист не прислан</div>'}
          </div>`).join('') || '<p class="muted">Пока никто не подключился.</p>'}</div>
          <div class="form"><h4>Как подключиться</h4><p class="muted">Игрок открывает приложение → «Игрок» → «Подключиться к столу мастера» и вводит код <b>${esc(code || '')}</b>.</p></div>`;
      }
      return '';
    }

    function firstFreeCell(sc) {
      const g = sc.grid; const used = new Set(sc.tokens.map((t) => T.grid.cellOf(t.x, t.y, g)).map((c) => c.c + ',' + c.r));
      const cols = Math.max(1, Math.floor(sc.w / g.size)), rows = Math.max(1, Math.floor(sc.h / g.size));
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (!used.has(c + ',' + r)) return { x: c * g.size + g.size / 2, y: r * g.size + g.size / 2 };
      return { x: g.size / 2, y: g.size / 2 };
    }

    async function gmClick(e, b) {
      const v = host.state, sc = T.activeScene(v);
      const q = (s) => e.target.closest(s);
      const val = (id) => { const n = $('#' + id, el); return n ? n.value : ''; };
      if (q('#sceneAdd')) {
        const f = $('#sceneImage', el).files[0];
        let image = null, w = 1500, h = 1000;
        try {
          if (f) {
            const img = await readImage(f, 2560);
            image = 'img' + Date.now().toString(36);
            host.setAsset(image, img.data); w = img.w; h = img.h;
          }
        } catch (err) { b.flash('sceneMsg', err.message); return; }
        const r = host.act({ type: 'scene.add', scene: { name: val('sceneName') || 'Сцена', image, w, h, grid: { size: Number(val('sceneGridNew')) || 50 } } });
        if (r.ok && v.scenes.length) host.act({ type: 'scene.activate', sceneId: r.state.scenes[r.state.scenes.length - 1].id });
        return;
      }
      const actv = q('[data-activate]'); if (actv) { host.act({ type: 'scene.activate', sceneId: actv.dataset.activate }); return; }
      const sdel = q('[data-sdel]');
      if (sdel) {
        if (sdel.dataset.confirm !== '1') { sdel.dataset.confirm = '1'; sdel.textContent = 'Удалить?'; return; }
        host.act({ type: 'scene.remove', sceneId: sdel.dataset.sdel }); return;
      }
      if (q('#fogAll') && sc) { host.act({ type: 'fog.reveal', rect: { c0: 0, r0: 0, c1: Math.ceil(sc.w / sc.grid.size), r1: Math.ceil(sc.h / sc.grid.size) } }); return; }
      if (q('#fogNone') && sc) { host.act({ type: 'fog.hide', rect: { c0: -1, r0: -1, c1: Math.ceil(sc.w / sc.grid.size) + 1, r1: Math.ceil(sc.h / sc.grid.size) + 1 } }); return; }
      if (q('#tokAdd') && sc) {
        const name = val('tokName').trim();
        if (!name) { b.flash('tokMsg', 'Впишите имя фишки'); return; }
        let img = null;
        const f = $('#tokImage', el) && $('#tokImage', el).files[0];
        if (f) { try { const r = await readImage(f, 256, 'image/png'); img = 'tok' + Date.now().toString(36); host.setAsset(img, r.data); } catch (err) { b.flash('tokMsg', err.message); return; } }
        const pos = firstFreeCell(sc);
        const token = { name, kind: val('tokKind'), x: pos.x, y: pos.y, img };
        $$('[data-newfield]', el).forEach((n) => { if (n.value !== '') token[n.dataset.newfield] = Number(n.value); });
        if (token.hp != null) token.hpMax = token.hp;
        host.act({ type: 'token.add', token });
        return;
      }
      const pick = q('[data-pick]'); if (pick) { b.selectToken(pick.dataset.pick); return; }
      if (q('#tokUnsel')) { b.sel = null; b.update(host.state); return; }
      if (q('#tokDel') && b.sel) {
        const btn = q('#tokDel');
        if (btn.dataset.confirm !== '1') { btn.dataset.confirm = '1'; btn.textContent = 'Удалить?'; return; }
        host.act({ type: 'token.remove', tokenId: b.sel }); b.sel = null; b.update(host.state); return;
      }
      if (q('#tokToCombat') && b.sel) {
        if (!v.combat.active) host.act({ type: 'combat.start' });
        const tk = sc && sc.tokens.find((x) => x.id === b.sel);
        host.act({ type: 'combat.add', tokenId: b.sel, init: initFor(T.systemOf(v), T.systemOf(v) === 'gurps' ? (tk && tk.move) : 0).total });
        return;
      }
      if (q('#combatStart')) { host.act({ type: 'combat.start' }); return; }
      if (q('#combatEnd')) { host.act({ type: 'combat.end' }); return; }
      if (q('#combatNext')) { host.act({ type: 'combat.next' }); return; }
      if (q('#combatPrev')) { host.act({ type: 'combat.prev' }); return; }
      if (q('#combatAddAll') && sc) {
        for (const t of sc.tokens) if (!host.state.combat.order.some((o) => o.tokenId === t.id)) host.act({ type: 'combat.add', tokenId: t.id, init: initFor(T.systemOf(v), T.systemOf(v) === 'gurps' ? t.move : 0).total });
        return;
      }
      const cbr = q('[data-cbremove]'); if (cbr) { host.act({ type: 'combat.remove', tokenId: cbr.dataset.cbremove }); return; }
      if (q('#jAdd')) {
        const title = val('jTitle').trim();
        if (!title && !val('jText').trim()) return;
        host.act({ type: 'journal.add', entry: { title, text: val('jText'), shared: $('#jShared', el).checked } }); return;
      }
      const jd = q('[data-jdel]'); if (jd) { host.act({ type: 'journal.remove', entryId: jd.dataset.jdel }); return; }
      if (q('#campSave')) {
        const text = T.exportCampaign(host.state, host.assets);
        const name = `campaign-${new Date().toISOString().slice(0, 10)}.json`;
        if (opts.download) opts.download(name, text); return;
      }
    }
    async function gmChange(e, b) {
      const t = e.target;
      const v = host.state, sc = T.activeScene(v);
      if (t.id === 'tableSystem') { host.act({ type: 'system.set', system: t.value }); return; }
      const tokPatch = { tokEditName: 'name', tokEditKind: 'kind', tokEditOwner: 'owner', tokEditSize: 'size', tokEditColor: 'color' };
      if (t.dataset.field && b.sel) { host.act({ type: 'token.update', tokenId: b.sel, patch: { [t.dataset.field]: t.value } }); return; }
      if (tokPatch[t.id] && b.sel) {
        let value = t.value;
        if (t.id === 'tokEditOwner' && !value) value = null;
        if (t.id === 'tokEditOwner' && value) host.act({ type: 'token.update', tokenId: b.sel, patch: { kind: 'pc' } });
        host.act({ type: 'token.update', tokenId: b.sel, patch: { [tokPatch[t.id]]: value } }); return;
      }
      if (t.id === 'tokEditHidden' && b.sel) { host.act({ type: 'token.update', tokenId: b.sel, patch: { hidden: t.checked } }); return; }
      if (t.id === 'fogEnabled') { host.act({ type: 'fog.set', enabled: t.checked }); return; }
      if (t.id === 'sceneGrid' && sc) { host.act({ type: 'scene.update', sceneId: sc.id, patch: { grid: { size: Number(t.value) } } }); return; }
      if (t.id === 'gridShow' && sc) { host.act({ type: 'scene.update', sceneId: sc.id, patch: { grid: { show: t.checked } } }); return; }
      if (t.dataset.init) { host.act({ type: 'combat.setInit', tokenId: t.dataset.init, init: Number(t.value) }); return; }
      if (t.dataset.jtitle) { host.act({ type: 'journal.update', entryId: t.dataset.jtitle, patch: { title: t.value } }); return; }
      if (t.dataset.jtext) { host.act({ type: 'journal.update', entryId: t.dataset.jtext, patch: { text: t.value } }); return; }
      if (t.dataset.jshare) { host.act({ type: 'journal.update', entryId: t.dataset.jshare, patch: { shared: t.checked } }); return; }
      if (t.id === 'campLoad' && t.files[0]) {
        const r = T.importCampaign(await t.files[0].text());
        if (!r.ok) { board.setNet('· ' + r.error, false); return; }
        host.replace(r.state, r.assets);
        board.setNet('· кампания загружена', true);
      }
    }
    return { destroy() { destroyed = true; flush(); window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', flush); board.destroyTips(); if (host) host.close(); else multi.close(); } };
  }

  // ======================================================================
  // Игрок
  // ======================================================================
  function connectPlayer(code, name, onStatus) {
    const key = myKey();
    const room = N.normalizeCode(code);
    return new Promise((resolve, reject) => {
      let done = false;
      // 1) тот же браузер (соседняя вкладка мастера)
      const local = N.createClient(N.channelTransport(room, 'c-' + key + '-' + Math.random().toString(36).slice(2, 6)), 'gm', { name, key });
      local.onChange = () => { if (!done) { done = true; resolve(local); } };
      local.onError = (e) => { if (!done) { done = true; local.close(); reject(new Error(e)); } };
      setTimeout(() => {
        if (done) return;
        local.close();
        onStatus('Ищу мастера в интернете…');
        // 2) интернет
        loadPeer().then((Peer) => N.peerTransport(Peer, PEER_PREFIX + 'p-' + key + '-' + Math.random().toString(36).slice(2, 6), PEER_PREFIX + room))
          .then((t) => {
            const c = N.createClient(t, PEER_PREFIX + room, { name, key });
            c.onChange = () => { if (!done) { done = true; resolve(c); } };
            c.onError = (e) => { if (!done) { done = true; t.close(); reject(new Error(e)); } };
            setTimeout(() => { if (!done) { done = true; t.close(); reject(new Error('Мастер не найден. Проверьте код и что у мастера открыт стол.')); } }, 12000);
          })
          .catch((err) => {
            if (done) return;
            done = true;
            reject(new Error(err && err.message === 'inside-claude'
              ? 'Мастер не найден на этом устройстве. По интернету подключение работает в версии приложения на сайте.'
              : 'Мастер не найден. Проверьте код и подключение к интернету.'));
          });
      }, 1500);
    });
  }

  function mountPlayer(el, client, opts) {
    const board = createBoard(el, {
      gm: false,
      me: () => client.you,
      act: (a) => { client.act(a); return { ok: true }; },
      assets: () => client.assets,
      pane: (k, v) => playerPane(k, v),
      onClick: (e, b) => playerClick(e, b),
    });
    board.setNet('· на связи', true);
    client.onChange = (v) => board.update(v);
    client.onError = (err) => {
      if (/потеряна/.test(err)) board.setNet('· связь потеряна — переподключитесь', false);
      else board.flash('diceMsg', err);
    };
    if (client.view) board.update(client.view);

    function playerPane(k, v) {
      if (k === 'combat') return combatPane(v, false, client.you);
      if (k === 'journal') return journalPane(v, false);
      if (k === 'hero') {
        const all = (opts.getCharacters && opts.getCharacters()) || [];
        const chars = all.filter((c) => c.tsys === T.systemOf(v));
        const sysName = T.SYSTEMS[T.systemOf(v)].name;
        const sent = v.players[client.you] && v.players[client.you].sheet;
        return `<div class="form"><h4>Мой персонаж для мастера</h4>
          ${chars.length ? `<label for="heroPick">Персонаж</label><select id="heroPick">${chars.map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('')}</select>
            <button class="tb pri" id="sheetSend">Показать мастеру</button>` : `<p class="muted">На этом устройстве нет персонажей для ${esc(sysName)}. Создайте лист в разделе «Игрок».</p>`}
          ${sent ? `<p class="muted">Мастер видит: ${esc(sent.name)}${sent.cls ? ', ' + esc(sent.cls) : ''}.</p><div class="kv">${sheetKv(sent)}</div>` : ''}</div>`;
      }
      return '';
    }
    function playerClick(e, b) {
      const q = (s) => e.target.closest(s);
      if (q('#combatNext')) { client.act({ type: 'combat.next' }); return; }
      if (q('#myInitRoll')) {
        const sc = b.scene(); const mine = sc ? sc.tokens.filter((t) => t.owner === client.you) : [];
        if (!mine.length) return;
        const r = initFor(T.systemOf(b.view), Number($('#myInitMod', el).value) || 0);
        client.act({ type: 'combat.add', tokenId: mine[0].id, init: r.total });
        client.act({ type: 'chat.say', text: `Инициатива ${mine[0].name}: ${r.text}` });
        return;
      }
      if (q('#sheetSend')) {
        const id = $('#heroPick', el).value;
        const sh = opts.sheetSummary && opts.sheetSummary(id);
        if (sh) client.act({ type: 'player.sheet', sheet: sh });
        return;
      }
      if (q('#leave')) { client.close(); if (opts.onLeave) opts.onLeave(); }
    }
    return { destroy() { board.destroyTips(); client.close(); } };
  }

  root.RPG_TABLE_UI = { mountGM, mountPlayer, connectPlayer, myKey, ls };
})(typeof globalThis !== 'undefined' ? globalThis : this);
