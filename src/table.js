// Стол мастера: состояние игры, действия с проверкой прав и то, что видит каждый игрок.
// Без DOM и сети — работает и в браузере (window.RPG_TABLE), и в Node (тесты).
(function (root) {
  'use strict';

  const clone = (x) => JSON.parse(JSON.stringify(x));
  const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const str = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);

  // ---------- Кубики ----------
  const dice = {
    /** «2к6+3», «1d20 преим», «1к8 + 1к6 + 2». Возвращает null, если запись непонятна. */
    parse(input) {
      let s = String(input || '').toLowerCase().replace(/к/g, 'd').trim();
      let mode = 'normal';
      if (/(преим|adv)/.test(s)) mode = 'adv';
      if (/(помех|dis)/.test(s)) mode = mode === 'adv' ? null : 'dis';
      if (mode === null) return null;
      s = s.replace(/(преимущество|преим\.?|advantage|adv|помеха|помехой|помех\.?|disadvantage|dis)/g, '').replace(/\s+/g, '');
      if (!s || !/^[+-]?[0-9d+-]+$/.test(s) || /[+-]$/.test(s) || /[+-]{2}/.test(s)) return null;
      const terms = [];
      let mod = 0;
      const re = /([+-]?)([^+-]+)/g;
      let m;
      while ((m = re.exec(s))) {
        const sign = m[1] === '-' ? -1 : 1;
        const t = m[2];
        const d = t.match(/^(\d*)d(\d+)$/);
        if (d) {
          const count = d[1] === '' ? 1 : Number(d[1]);
          const sides = Number(d[2]);
          if (count < 1 || count > 100 || sides < 2 || sides > 1000) return null;
          terms.push({ count, sides, sign });
        } else if (/^\d+$/.test(t)) {
          mod += sign * Number(t);
        } else return null;
      }
      if (!terms.length) return null;
      if (mode !== 'normal' && !(terms.length === 1 && terms[0].count === 1 && terms[0].sides === 20)) return null;
      return { terms, mod, mode };
    },
    /** Бросок. rng(sides) → 1..sides; по умолчанию случайный. */
    roll(expr, rng) {
      const p = dice.parse(expr);
      if (!p) return null;
      const r = rng || ((sides) => 1 + Math.floor(Math.random() * sides));
      const parts = p.terms.map((t) => {
        if (p.mode !== 'normal') {
          const a = r(20), b = r(20);
          return { count: 1, sides: 20, sign: t.sign, rolls: [a, b], kept: [p.mode === 'adv' ? Math.max(a, b) : Math.min(a, b)] };
        }
        const rolls = Array.from({ length: t.count }, () => r(t.sides));
        return { count: t.count, sides: t.sides, sign: t.sign, rolls, kept: rolls.slice() };
      });
      const total = parts.reduce((s, x) => s + x.sign * x.kept.reduce((a, b) => a + b, 0), 0) + p.mod;
      let crit = null;
      if (parts.length === 1 && parts[0].sides === 20 && parts[0].kept.length === 1) {
        if (parts[0].kept[0] === 20) crit = 'hit';
        if (parts[0].kept[0] === 1) crit = 'miss';
      }
      const shown = parts.map((x) => (x.sign < 0 ? '−' : '') + '[' + x.rolls.join(', ') + ']').join(' + ');
      const text = shown + (p.mod ? (p.mod > 0 ? ' + ' : ' − ') + Math.abs(p.mod) : '') + ' = ' + total;
      return { expr: str(expr, 60), total, parts, mod: p.mod, mode: p.mode, crit, text };
    },
  };

  // ---------- Сетка ----------
  const grid = {
    cellOf(x, y, g) {
      const size = num(g && g.size, 50) || 50;
      return { c: Math.floor((x - num(g && g.offsetX)) / size), r: Math.floor((y - num(g && g.offsetY)) / size) };
    },
    snap(x, y, g) {
      const size = num(g && g.size, 50) || 50;
      const c = grid.cellOf(x, y, g);
      return { x: c.c * size + size / 2 + num(g && g.offsetX), y: c.r * size + size / 2 + num(g && g.offsetY) };
    },
    /** D&D 5e: каждая клетка — 5 футов, диагональ тоже считается за одну клетку. */
    distanceFeet(a, b) {
      return Math.max(Math.abs(a.c - b.c), Math.abs(a.r - b.r)) * 5;
    },
  };

  // ---------- Туман войны ----------
  const fog = {
    isRevealed(scene, cell) {
      return !!scene && scene.fog.revealed.includes(cell.c + ',' + cell.r);
    },
    cells(rect) {
      const out = [];
      const c0 = Math.min(rect.c0, rect.c1), c1 = Math.max(rect.c0, rect.c1);
      const r0 = Math.min(rect.r0, rect.r1), r1 = Math.max(rect.r0, rect.r1);
      if ((c1 - c0 + 1) * (r1 - r0 + 1) > 40000) return out;
      for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) out.push(c + ',' + r);
      return out;
    },
  };

  const health = (hp, hpMax) => {
    if (hp == null || !hpMax) return 'цел';
    if (hp <= 0) return 'без сознания';
    const k = hp / hpMax;
    if (k >= 1) return 'цел';
    if (k <= 0.25) return 'при смерти';
    return 'ранен';
  };

  // ---------- Состояние ----------
  const newState = (system) => ({
    v: 1, system: system || 'dnd5e', seq: 0, scenes: [], activeSceneId: null,
    combat: { active: false, round: 0, turn: 0, moved: false, order: [] },
    chat: [], journal: [], players: {},
  });
  const nextId = (s, p) => p + (++s.seq);
  const activeScene = (s) => (s && s.scenes.find((x) => x.id === s.activeSceneId)) || null;
  const findToken = (s, id) => {
    for (const sc of s.scenes) {
      const t = sc.tokens.find((x) => x.id === id);
      if (t) return { scene: sc, token: t };
    }
    return null;
  };
  const isGM = (a) => a && a.role === 'gm';
  const ownsToken = (a, t) => a && a.role === 'player' && t && t.owner === a.id;
  const nameOf = (s, a) => (isGM(a) ? 'Мастер' : ((s.players[a.id] && s.players[a.id].name) || 'Игрок'));
  const COLORS = ['#C0392B', '#2E86C1', '#28B463', '#B7950B', '#8E44AD', '#CA6F1E', '#17A589', '#7F8C8D'];

  const combat = {
    current(s) { return s.combat.active ? s.combat.order[s.combat.turn] || null : null; },
    sort(s) {
      const cur = combat.current(s);
      s.combat.order.sort((a, b) => b.init - a.init);
      if (s.combat.moved && cur) {
        const i = s.combat.order.findIndex((o) => o.tokenId === cur.tokenId);
        s.combat.turn = i >= 0 ? i : 0;
      } else s.combat.turn = 0;
    },
  };

  const TOKEN_KEYS = ['name', 'kind', 'owner', 'size', 'color', 'hp', 'hpMax', 'ac', 'hidden', 'img', 'note'];
  function cleanToken(t, s, scene) {
    const out = {};
    for (const k of TOKEN_KEYS) if (k in t) out[k] = t[k];
    if ('name' in out) out.name = str(out.name, 60) || 'Фишка';
    if ('kind' in out) out.kind = out.kind === 'pc' ? 'pc' : 'npc';
    if ('size' in out) out.size = clampN(num(out.size, 1), 0.5, 4);
    for (const k of ['hp', 'hpMax', 'ac']) if (k in out) out[k] = out[k] === '' || out[k] == null ? null : Math.round(num(out[k]));
    if ('hidden' in out) out.hidden = !!out.hidden;
    return out;
  }

  const ACTIONS = {
    'scene.add'(s, a, act) {
      if (!isGM(act)) return 'Только мастер создаёт сцены';
      const sc = a.scene || {};
      const scene = {
        id: nextId(s, 'sc'), name: str(sc.name, 60) || 'Сцена', w: clampN(num(sc.w, 1500), 200, 10000), h: clampN(num(sc.h, 1000), 200, 10000),
        image: sc.image || null,
        grid: Object.assign({ size: 50, offsetX: 0, offsetY: 0, show: true }, sc.grid || {}),
        fog: { enabled: false, revealed: [] }, tokens: [],
      };
      s.scenes.push(scene);
      if (!s.activeSceneId) s.activeSceneId = scene.id;
      return null;
    },
    'scene.update'(s, a, act) {
      if (!isGM(act)) return 'Только мастер меняет сцены';
      const sc = s.scenes.find((x) => x.id === a.sceneId);
      if (!sc) return 'Сцена не найдена';
      const p = a.patch || {};
      if ('name' in p) sc.name = str(p.name, 60) || sc.name;
      if ('w' in p) sc.w = clampN(num(p.w, sc.w), 200, 10000);
      if ('h' in p) sc.h = clampN(num(p.h, sc.h), 200, 10000);
      if ('image' in p) sc.image = p.image || null;
      if (p.grid) {
        Object.assign(sc.grid, p.grid);
        sc.grid.size = clampN(num(sc.grid.size, 50), 10, 400);
      }
      return null;
    },
    'scene.activate'(s, a, act) {
      if (!isGM(act)) return 'Только мастер переключает сцены';
      if (!s.scenes.some((x) => x.id === a.sceneId)) return 'Сцена не найдена';
      s.activeSceneId = a.sceneId;
      return null;
    },
    'scene.remove'(s, a, act) {
      if (!isGM(act)) return 'Только мастер удаляет сцены';
      const i = s.scenes.findIndex((x) => x.id === a.sceneId);
      if (i < 0) return 'Сцена не найдена';
      const ids = new Set(s.scenes[i].tokens.map((t) => t.id));
      s.scenes.splice(i, 1);
      s.combat.order = s.combat.order.filter((o) => !ids.has(o.tokenId));
      if (s.activeSceneId === a.sceneId) s.activeSceneId = s.scenes[0] ? s.scenes[0].id : null;
      return null;
    },
    'token.add'(s, a, act) {
      if (!isGM(act)) return 'Только мастер добавляет фишки';
      const sc = a.sceneId ? s.scenes.find((x) => x.id === a.sceneId) : activeScene(s);
      if (!sc) return 'Сначала создайте сцену';
      const t = Object.assign({ name: 'Фишка', kind: 'npc', owner: null, size: 1, hp: null, hpMax: null, ac: null, hidden: false, img: null, note: '' },
        cleanToken(a.token || {}, s, sc));
      t.id = nextId(s, 't');
      if (!t.color) t.color = COLORS[(s.seq) % COLORS.length];
      const p = grid.snap(clampN(num(a.token && a.token.x, sc.grid.size / 2), 0, sc.w - 1), clampN(num(a.token && a.token.y, sc.grid.size / 2), 0, sc.h - 1), sc.grid);
      t.x = p.x; t.y = p.y;
      sc.tokens.push(t);
      return null;
    },
    'token.move'(s, a, act) {
      const f = findToken(s, a.tokenId);
      if (!f) return 'Фишка не найдена';
      if (!isGM(act) && !ownsToken(act, f.token)) return 'Можно двигать только свою фишку';
      const x = num(a.x, NaN), y = num(a.y, NaN);
      if (!(x >= 0 && y >= 0 && x < f.scene.w && y < f.scene.h)) return 'За краем карты';
      const p = grid.snap(x, y, f.scene.grid);
      f.token.x = p.x; f.token.y = p.y;
      return null;
    },
    'token.update'(s, a, act) {
      const f = findToken(s, a.tokenId);
      if (!f) return 'Фишка не найдена';
      if (!isGM(act)) return 'Только мастер меняет фишки';
      Object.assign(f.token, cleanToken(a.patch || {}, s, f.scene));
      return null;
    },
    'token.remove'(s, a, act) {
      if (!isGM(act)) return 'Только мастер удаляет фишки';
      const f = findToken(s, a.tokenId);
      if (!f) return 'Фишка не найдена';
      f.scene.tokens = f.scene.tokens.filter((t) => t.id !== a.tokenId);
      const cur = combat.current(s);
      s.combat.order = s.combat.order.filter((o) => o.tokenId !== a.tokenId);
      if (cur && cur.tokenId === a.tokenId) s.combat.turn = Math.min(s.combat.turn, Math.max(0, s.combat.order.length - 1));
      else combat.sort(s);
      return null;
    },
    'fog.set'(s, a, act) {
      if (!isGM(act)) return 'Только мастер управляет туманом';
      const sc = a.sceneId ? s.scenes.find((x) => x.id === a.sceneId) : activeScene(s);
      if (!sc) return 'Сцена не найдена';
      sc.fog.enabled = !!a.enabled;
      return null;
    },
    'fog.reveal'(s, a, act) { return fogEdit(s, a, act, true); },
    'fog.hide'(s, a, act) { return fogEdit(s, a, act, false); },
    'combat.start'(s, a, act) {
      if (!isGM(act)) return 'Только мастер начинает бой';
      s.combat = { active: true, round: 1, turn: 0, moved: false, order: [] };
      return null;
    },
    'combat.add'(s, a, act) {
      if (!s.combat.active) return 'Бой не начат';
      const f = findToken(s, a.tokenId);
      if (!f) return 'Фишка не найдена';
      if (!isGM(act) && !ownsToken(act, f.token)) return 'Можно бросать инициативу только за своего героя';
      const init = num(a.init, NaN);
      if (!Number.isFinite(init)) return 'Нужно число инициативы';
      const ex = s.combat.order.find((o) => o.tokenId === a.tokenId);
      if (ex) ex.init = init; else s.combat.order.push({ tokenId: a.tokenId, init });
      combat.sort(s);
      return null;
    },
    'combat.setInit'(s, a, act) {
      if (!isGM(act)) return 'Только мастер меняет инициативу';
      const ex = s.combat.order.find((o) => o.tokenId === a.tokenId);
      if (!ex) return 'Нет в бою';
      ex.init = num(a.init, ex.init);
      combat.sort(s);
      return null;
    },
    'combat.remove'(s, a, act) {
      if (!isGM(act)) return 'Только мастер убирает из боя';
      s.combat.order = s.combat.order.filter((o) => o.tokenId !== a.tokenId);
      if (s.combat.turn >= s.combat.order.length) s.combat.turn = 0;
      return null;
    },
    'combat.next'(s, a, act) {
      if (!s.combat.active || !s.combat.order.length) return 'Бой не начат';
      const cur = combat.current(s);
      const f = cur && findToken(s, cur.tokenId);
      if (!isGM(act) && !(f && ownsToken(act, f.token))) return 'Сейчас не ваш ход';
      s.combat.moved = true;
      s.combat.turn++;
      if (s.combat.turn >= s.combat.order.length) { s.combat.turn = 0; s.combat.round++; }
      return null;
    },
    'combat.prev'(s, a, act) {
      if (!isGM(act)) return 'Только мастер возвращает ход';
      if (!s.combat.active || !s.combat.order.length) return 'Бой не начат';
      s.combat.moved = true;
      s.combat.turn--;
      if (s.combat.turn < 0) {
        if (s.combat.round <= 1) { s.combat.turn = 0; return null; }
        s.combat.turn = s.combat.order.length - 1; s.combat.round--;
      }
      return null;
    },
    'combat.end'(s, a, act) {
      if (!isGM(act)) return 'Только мастер заканчивает бой';
      s.combat = { active: false, round: 0, turn: 0, moved: false, order: [] };
      return null;
    },
    'chat.say'(s, a, act) {
      const text = String(a.text || '').trim().slice(0, 1000);
      if (!text) return 'Пустое сообщение';
      pushChat(s, { from: nameOf(s, act), fromId: act.id, gm: isGM(act), text, gmOnly: !!a.gmOnly });
      return null;
    },
    'chat.roll'(s, a, act) {
      const roll = dice.roll(a.expr, typeof a.rng === 'function' ? a.rng : null);
      if (!roll) return 'Не понял запись броска. Пример: 1к20+5, 2к6, 1к20 преим';
      pushChat(s, { from: nameOf(s, act), fromId: act.id, gm: isGM(act), roll, label: str(a.label, 80), gmOnly: !!a.gmOnly });
      return null;
    },
    'journal.add'(s, a, act) {
      if (!isGM(act)) return 'Только мастер ведёт журнал';
      const e = a.entry || {};
      s.journal.push({ id: nextId(s, 'j'), title: str(e.title, 120) || 'Без названия', text: String(e.text || '').slice(0, 20000), shared: !!e.shared });
      return null;
    },
    'journal.update'(s, a, act) {
      if (!isGM(act)) return 'Только мастер ведёт журнал';
      const e = s.journal.find((x) => x.id === a.entryId);
      if (!e) return 'Запись не найдена';
      const p = a.patch || {};
      if ('title' in p) e.title = str(p.title, 120) || e.title;
      if ('text' in p) e.text = String(p.text || '').slice(0, 20000);
      if ('shared' in p) e.shared = !!p.shared;
      return null;
    },
    'journal.remove'(s, a, act) {
      if (!isGM(act)) return 'Только мастер ведёт журнал';
      s.journal = s.journal.filter((x) => x.id !== a.entryId);
      return null;
    },
    'player.join'(s, a, act) {
      if (!act || act.role !== 'player') return 'Только для игроков';
      const name = str(a.name, 40);
      if (!name) return 'Нужно имя';
      s.players[act.id] = Object.assign(s.players[act.id] || {}, { name });
      return null;
    },
    'player.sheet'(s, a, act) {
      if (!act || act.role !== 'player' || !s.players[act.id]) return 'Сначала присоединитесь к столу';
      const sh = a.sheet || {};
      const out = {};
      for (const k of ['name', 'cls', 'race', 'level', 'hp', 'hpMax', 'ac', 'init', 'speed', 'passive', 'system']) if (k in sh) out[k] = typeof sh[k] === 'number' ? sh[k] : str(sh[k], 60);
      s.players[act.id].sheet = out;
      return null;
    },
  };

  function fogEdit(s, a, act, reveal) {
    if (!isGM(act)) return 'Только мастер управляет туманом';
    const sc = a.sceneId ? s.scenes.find((x) => x.id === a.sceneId) : activeScene(s);
    if (!sc) return 'Сцена не найдена';
    const r = a.rect || {};
    const cells = fog.cells({ c0: num(r.c0), r0: num(r.r0), c1: num(r.c1), r1: num(r.r1) });
    const set = new Set(sc.fog.revealed);
    for (const c of cells) { if (reveal) set.add(c); else set.delete(c); }
    sc.fog.revealed = Array.from(set);
    return null;
  }
  function pushChat(s, msg) {
    msg.id = nextId(s, 'm');
    msg.ts = Date.now();
    s.chat.push(msg);
    if (s.chat.length > 200) s.chat.splice(0, s.chat.length - 200);
  }

  /** Применяет действие от имени actor. Не меняет исходное состояние. */
  function apply(state, action, actor) {
    const fn = action && ACTIONS[action.type];
    if (!fn) return { ok: false, error: 'Неизвестное действие', state };
    const rng = action.rng;
    const s = clone(state);
    const a = Object.assign({}, action, { rng });
    const err = fn(s, a, actor || {});
    return err ? { ok: false, error: err, state } : { ok: true, state: s };
  }

  /** Что видит участник: мастер — всё, игрок — только активную сцену без скрытого. */
  function viewFor(state, actor) {
    if (isGM(actor)) return clone(state);
    const s = clone(state);
    const sc = activeScene(s);
    s.scenes = sc ? [sc] : [];
    const visible = new Set();
    if (sc) {
      sc.tokens = sc.tokens.filter((t) => {
        if (t.hidden) return false;
        if (t.kind === 'pc') return true;
        if (sc.fog.enabled && !fog.isRevealed(sc, grid.cellOf(t.x, t.y, sc.grid))) return false;
        return true;
      }).map((t) => {
        if (t.kind === 'pc') return t;
        const h = health(t.hp, t.hpMax);
        const out = Object.assign({}, t, { health: h });
        delete out.hp; delete out.hpMax; delete out.ac; delete out.note;
        return out;
      });
      sc.tokens.forEach((t) => visible.add(t.id));
    }
    const cur = combat.current(state);
    s.combat.order = s.combat.order.filter((o) => visible.has(o.tokenId));
    s.combat.turn = cur ? Math.max(0, s.combat.order.findIndex((o) => o.tokenId === cur.tokenId)) : 0;
    s.combat.hiddenTurn = !!(cur && !visible.has(cur.tokenId));
    s.chat = s.chat.filter((m) => !m.gmOnly || m.fromId === actor.id);
    s.journal = s.journal.filter((j) => j.shared);
    const players = {};
    for (const [id, p] of Object.entries(s.players)) {
      players[id] = { name: p.name };
      if (id === actor.id && p.sheet) players[id].sheet = p.sheet;
    }
    s.players = players;
    return s;
  }

  function exportCampaign(state, assets) {
    return JSON.stringify({ app: 'rpg-table', version: 1, savedAt: new Date().toISOString(), state, assets: assets || {} });
  }
  function importCampaign(text) {
    let o;
    try { o = JSON.parse(text); } catch (e) { return { ok: false, error: 'Файл не похож на JSON' }; }
    if (!o || o.app !== 'rpg-table' || !o.state || !Array.isArray(o.state.scenes)) return { ok: false, error: 'Это не файл кампании' };
    const base = newState(o.state.system);
    const state = Object.assign(base, o.state, { combat: Object.assign(base.combat, o.state.combat || {}) });
    return { ok: true, state, assets: o.assets || {} };
  }

  const API = { dice, grid, fog, combat, health, newState, apply, viewFor, activeScene, findToken, exportCampaign, importCampaign };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.RPG_TABLE = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
