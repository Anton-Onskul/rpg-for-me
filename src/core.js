// Логика листов персонажей (без DOM). Работает и в Node (тесты), и в браузере (window.RPG).
(function (root) {
  'use strict';

  const num = (v, def = 0) => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : def;
  };
  const int = (v, def = 0) => Math.trunc(num(v, def));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // ---------- D&D 5e ----------
  const D5 = (typeof module !== 'undefined' && module.exports) ? require('./dnd5e-data.js') : root.DND5E_DATA;
  const AVG = { 6: 4, 8: 5, 10: 6, 12: 7 };
  const findClass = (edition, id) => D5.classes.find((c) => c.edition === String(edition) && c.id === id) || null;
  // Класс можно передать id ('fighter') или объектом от resolveClass (в том числе своим классом).
  const asClass = (edition, cls) => (cls && typeof cls === 'object' ? cls : findClass(edition, cls));
  const HIT_DICE = [6, 8, 10, 12];
  const allowed = (bookIds, books) => bookIds.some((b) => books.includes(b));

  const dnd = {
    findClass,
    /** Класс персонажа: стандартный из списка или свой (cls === 'custom'). */
    resolveClass(d) {
      if (!d || !d.cls) return null;
      if (d.cls === 'custom') {
        const hd = int(d.customHitDie, 8);
        return { id: 'custom', custom: true, name: String(d.customCls || '').trim() || 'Свой класс',
          hitDie: HIT_DICE.includes(hd) ? hd : 8, order: null, books: [], subclasses: [] };
      }
      return findClass(d.edition || '2014', d.cls);
    },
    hitDie(edition, classId) {
      const c = asClass(edition, classId);
      return c ? c.hitDie : null;
    },
    hitDiceText(edition, classId, level) {
      if (classId && typeof classId === 'object') return `${clamp(int(level, 1), 1, 20)}к${classId.hitDie}`;
      const die = dnd.hitDie(edition, classId);
      return die ? `${clamp(int(level, 1), 1, 20)}к${die}` : '';
    },
    /** Максимум хитов: 1 уровень — максимум кости + мод. Тел; дальше среднее + мод. Тел (не меньше 1). */
    hpFormula(edition, classId, level, conScore) {
      const c = asClass(edition, classId);
      if (!c) return null;
      const lvl = clamp(int(level, 1), 1, 20);
      const con = dnd.mod(conScore);
      const first = Math.max(1, c.hitDie + con);
      const perLevel = Math.max(1, AVG[c.hitDie] + con);
      const total = first + (lvl - 1) * perLevel;
      const cs = con >= 0 ? `+ ${con}` : `− ${Math.abs(con)}`;
      const text = `${c.name}: кость хитов к${c.hitDie}.\n`
        + `• 1 уровень: ${c.hitDie} (максимум кости) ${cs} (мод. Тел) = ${first}.\n`
        + `• Каждый следующий уровень: бросок к${c.hitDie} ${cs} или среднее ${AVG[c.hitDie]} ${cs} = ${perLevel}.\n`
        + (lvl > 1 ? `• Для ${lvl} уровня по среднему: ${first} + ${lvl - 1} × ${perLevel} = ${total}.` : `• Сейчас максимум хитов: ${total}.`);
      return { die: c.hitDie, first, perLevel, total, text };
    },
    availableClasses(edition, books) {
      return D5.classes.filter((c) => c.edition === String(edition) && allowed(c.books, books || []));
    },
    availableSubclasses(edition, classId, books) {
      const c = findClass(edition, classId);
      return c ? c.subclasses.filter((s) => allowed(s.books, books || [])) : [];
    },
    /** Книги, которые учитываются: в стандартном режиме — только Книга игрока редакции. */
    effectiveBooks(d) {
      const ed = String((d && d.edition) || '2014');
      const core = Object.keys(D5.books).filter((b) => D5.books[b].core && D5.books[b].edition === ed);
      if (!d || !d.extended) return core;
      return Array.from(new Set(core.concat((d.books || []).filter((b) => D5.books[b] && D5.books[b].edition === ed))));
    },
    /** Происхождения из отмеченных книг; у каждого только разрешённые разновидности. */
    availableRaces(edition, books) {
      const bs = books || [];
      return D5.races.filter((r) => r.edition === String(edition)).map((r) => {
        const subs = r.subs.filter((x) => allowed(x.books, bs));
        return (allowed(r.books, bs) || subs.length) ? Object.assign({}, r, { subs }) : null;
      }).filter(Boolean);
    },
    findRace(edition, name) {
      return D5.races.find((r) => r.edition === String(edition) && r.name === name) || null;
    },
    availableBackgrounds(edition, books) {
      return D5.backgrounds.filter((b) => b.edition === String(edition) && allowed(b.books, books || []));
    },
    findBackground(edition, name) {
      return D5.backgrounds.find((b) => b.edition === String(edition) && b.name === name) || null;
    },
    /** Страница PDF Книги игрока 2014 (русский перевод) по номеру страницы книги. */
    pdfPage(bookPage) {
      return int(bookPage) + D5.phb14.pdfOffset;
    },
    sourceLabel(bookIds) {
      return (bookIds || []).map((b) => (D5.books[b] ? D5.books[b].name : b)).join(', ');
    },
    standardArray(edition, classId) {
      const c = asClass(edition, classId);
      if (!c || !c.order) return null;
      const vals = [15, 14, 13, 12, 10, 8];
      return Object.fromEntries(c.order.map((k, i) => [k, vals[i]]));
    },
    mod(score) {
      return Math.floor((int(score, 10) - 10) / 2);
    },
    profBonus(level) {
      const l = clamp(int(level, 1), 1, 20);
      return 2 + Math.floor((l - 1) / 4);
    },
    skillBonus(score, proficient, level, expertise = false) {
      const pb = proficient ? dnd.profBonus(level) * (expertise ? 2 : 1) : 0;
      return dnd.mod(score) + pb;
    },
    passive(score, proficient, level) {
      return 10 + dnd.skillBonus(score, proficient, level);
    },
  };

  // ---------- GURPS 4e ----------
  const gurps = {
    attrCost(a) {
      return (int(a.ST, 10) - 10) * 10 + (int(a.DX, 10) - 10) * 20
        + (int(a.IQ, 10) - 10) * 20 + (int(a.HT, 10) - 10) * 10;
    },
    derived(a) {
      const ST = int(a.ST, 10), DX = int(a.DX, 10), IQ = int(a.IQ, 10), HT = int(a.HT, 10);
      const BasicSpeed = (HT + DX) / 4 + num(a.speedMod, 0);
      const liftRaw = (ST * ST) / 5;
      const BasicLift = liftRaw >= 10 ? Math.round(liftRaw) : Math.round(liftRaw * 10) / 10;
      return {
        HP: ST + int(a.hpMod, 0),
        Will: IQ + int(a.willMod, 0),
        Per: IQ + int(a.perMod, 0),
        FP: HT + int(a.fpMod, 0),
        BasicSpeed,
        BasicMove: Math.floor(BasicSpeed) + int(a.moveMod, 0),
        Dodge: Math.floor(BasicSpeed) + 3,
        BasicLift,
      };
    },
    /** Страница PDF Basic Set по номеру страницы книги (обложка и титул идут первыми). */
    pdfPage(bookPage) {
      return int(bookPage) + 2;
    },
    /** Поиск по справочнику: все слова запроса должны встретиться в английском или русском названии. */
    /** Справочник для вкладки: свои записи персонажа сверху, затем записи из книги. */
    refList(ref, d, tab) {
      const own = (d && d.custom && d.custom[tab]) || [];
      return own.concat((ref && ref[tab]) || []);
    },
    addCustomRef(d, tab, item) {
      if (!['advantages', 'disadvantages', 'skills'].includes(tab)) return null;
      const ru = String((item && item.ru) || '').trim();
      if (!ru) return null;
      if (!d.custom) d.custom = { advantages: [], disadvantages: [], skills: [] };
      const rec = { id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), custom: true, en: '', ru,
        note: String(item.note || '').trim() };
      if (tab === 'skills') {
        rec.attr = ['IQ', 'DX', 'HT', 'ST', 'Will', 'Per'].includes(item.attr) ? item.attr : 'IQ';
        rec.diff = ['E', 'A', 'H', 'VH'].includes(item.diff) ? item.diff : 'A';
      } else {
        rec.cost = String(item.cost || '').trim() || '?';
      }
      d.custom[tab].unshift(rec);
      return rec;
    },
    removeCustomRef(d, tab, id) {
      const list = d && d.custom && d.custom[tab];
      if (!list) return false;
      const i = list.findIndex((t) => t.id === id);
      if (i < 0) return false;
      list.splice(i, 1);
      return true;
    },
    searchRefs(list, query) {
      const norm = (x) => String(x || '').toLowerCase().replace(/ё/g, 'е');
      const words = norm(query).split(/\s+/).filter(Boolean);
      if (!words.length) return list.slice();
      return list.filter((t) => {
        const hay = norm((t.en || '') + ' ' + t.ru + ' ' + (t.note || '') + ' ' + (t.sub || []).map((x) => x.ru).join(' '));
        return words.every((w) => hay.includes(w));
      });
    },
    /** Сколько очков потрачено и сколько осталось (GURPS 4e Basic Set). */
    summary(d) {
      const attributes = gurps.attrCost(d);
      const secondary = int(d.hpMod) * 2 + int(d.willMod) * 5 + int(d.perMod) * 5 + int(d.fpMod) * 3
        + Math.round(num(d.speedMod) / 0.25) * 5 + int(d.moveMod) * 5;
      const adv = int(d.advPoints);
      const disadv = -Math.abs(int(d.disadvPoints));
      const skills = int(d.skillPoints);
      const spent = attributes + secondary + adv + disadv + skills;
      return { attributes, secondary, adv, disadv, skills, spent, unspent: int(d.points, 0) - spent };
    },
  };

  // ---------- Манчкин ----------
  const munchkin = {
    combatStrength(level, gear, bonus = 0) {
      return int(level, 1) + int(gear, 0) + int(bonus, 0);
    },
    isWinner(level) {
      return int(level, 1) >= 10;
    },
    clampLevel(level) {
      return clamp(int(level, 1), 1, 10);
    },
  };

  // ---------- Хранилище ----------
  const SYSTEMS = ['dnd5e', 'gurps4e', 'munchkin'];
  const DND_SKILLS = ['acrobatics', 'animal', 'arcana', 'athletics', 'deception', 'history', 'insight',
    'intimidation', 'investigation', 'medicine', 'nature', 'perception', 'performance', 'persuasion',
    'religion', 'sleight', 'stealth', 'survival'];

  const newId = () => {
    const c = root && root.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  };

  const DEFAULTS = {
    dnd5e: () => ({
      name: '', player: '', edition: '2014', books: ['PHB14'], race: '', cls: '', subclass: '',
      customCls: '', customHitDie: 8, customSubclass: '', raceSub: '', customRace: '', customBackground: '', extended: false, background: '', alignment: '', level: 1, xp: 0,
      str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
      saves: { str: false, dex: false, con: false, int: false, wis: false, cha: false },
      skills: Object.fromEntries(DND_SKILLS.map((s) => [s, 0])), // 0 нет, 1 владение, 2 экспертиза
      ac: 10, speed: 30, hpMax: 10, hpCur: 10, hpTemp: 0, hitDice: '1d8', inspiration: false,
      deathOk: 0, deathFail: 0,
      attacks: '', equipment: '', features: '', proficiencies: '',
      traits: '', ideals: '', bonds: '', flaws: '', notes: '',
    }),
    gurps4e: () => ({
      name: '', player: '', points: 150, tl: 3, sm: 0,
      ST: 10, DX: 10, IQ: 10, HT: 10,
      hpMod: 0, willMod: 0, perMod: 0, fpMod: 0, speedMod: 0, moveMod: 0,
      hpCur: 10, fpCur: 10,
      custom: { advantages: [], disadvantages: [], skills: [] },
      advantages: '', disadvantages: '', skills: '', equipment: '', notes: '',
      advPoints: 0, disadvPoints: 0, skillPoints: 0,
    }),
    munchkin: () => ({
      name: '', level: 1, gear: 0, race: '', cls: '', sex: '', bonus: 0, notes: '',
    }),
  };

  const store = {
    SYSTEMS,
    DND_SKILLS,
    newCharacter(system) {
      if (!SYSTEMS.includes(system)) throw new Error('Неизвестная система: ' + system);
      return { id: newId(), system, created: Date.now(), data: DEFAULTS[system]() };
    },
    isValid(c) {
      return !!c && typeof c === 'object' && SYSTEMS.includes(c.system)
        && typeof c.id === 'string' && c.id.length > 0 && !!c.data && typeof c.data === 'object';
    },
    /** Заполняет отсутствующие поля значениями по умолчанию (старые сохранения, импорт). */
    normalize(c) {
      const base = DEFAULTS[c.system]();
      const data = Object.assign(base, c.data);
      if (c.system === 'dnd5e') {
        // Раньше класс вводился текстом — «Воин» превращаем в id из списка, неизвестное — в свой вариант.
        const raw = String(data.cls || '').trim().toLowerCase();
        if (raw) {
          const hit = D5.classes.find((k) => k.id === raw || k.name.toLowerCase() === raw);
          if (hit) data.cls = hit.id;
          else if (raw !== 'custom') { data.customCls = data.customCls || String(c.data.cls).trim(); data.cls = 'custom'; }
        }
        // Происхождение и предыстория раньше вводились текстом: узнаём их в списках, иначе — свой вариант.
        const ed = String(data.edition || '2014');
        const low = (x) => String(x || '').trim().toLowerCase();
        const rawRace = low(data.race);
        if (rawRace && data.race !== 'custom' && !D5.races.some((r) => r.edition === ed && r.name === data.race)) {
          const hitR = D5.races.find((r) => r.edition === ed && low(r.name) === rawRace);
          const hitS = !hitR && D5.races.find((r) => r.edition === ed && r.subs.some((x) => low(x.name) === rawRace));
          if (hitR) data.race = hitR.name;
          else if (hitS) { data.raceSub = hitS.subs.find((x) => low(x.name) === rawRace).name; data.race = hitS.name; }
          else { data.customRace = data.customRace || String(c.data.race).trim(); data.race = 'custom'; }
        }
        const rawBg = low(data.background);
        if (rawBg && data.background !== 'custom' && !D5.backgrounds.some((b) => b.edition === ed && b.name === data.background)) {
          const hitB = D5.backgrounds.find((b) => b.edition === ed && low(b.name) === rawBg);
          if (hitB) data.background = hitB.name;
          else { data.customBackground = data.customBackground || String(c.data.background).trim(); data.background = 'custom'; }
        }
        if (!('extended' in (c.data || {}))) data.extended = (data.books || []).some((b) => D5.books[b] && !D5.books[b].core);
        if (data.subclass === 'Домен знаний' && String(data.edition) === '2014') data.subclass = 'Домен знания'; // название как в Книге игрока
        data.saves = Object.assign(DEFAULTS.dnd5e().saves, c.data.saves);
        data.skills = Object.assign(DEFAULTS.dnd5e().skills, c.data.skills);
      }
      if (c.system === 'gurps4e') {
        const cu = (c.data && c.data.custom) || {};
        data.custom = { advantages: Array.isArray(cu.advantages) ? cu.advantages : [],
          disadvantages: Array.isArray(cu.disadvantages) ? cu.disadvantages : [], skills: Array.isArray(cu.skills) ? cu.skills : [] };
      }
      return { id: c.id, system: c.system, created: c.created || Date.now(), data };
    },
    exportJSON(characters) {
      return JSON.stringify({ app: 'rpg-sheets', version: 1, characters }, null, 2);
    },
    parseImport(text) {
      let obj;
      try { obj = JSON.parse(text); } catch (e) { return { ok: false, error: 'Файл не похож на JSON' }; }
      if (!obj || obj.app !== 'rpg-sheets' || !Array.isArray(obj.characters)) {
        return { ok: false, error: 'Это не файл персонажей этого приложения' };
      }
      const characters = obj.characters.filter(store.isValid).map(store.normalize);
      return { ok: true, characters, skipped: obj.characters.length - characters.length };
    },
  };

  const RPG = { dnd, gurps, munchkin, store, dnd5eData: D5, util: { num, int, clamp } };
  if (typeof module !== 'undefined' && module.exports) module.exports = RPG; else root.RPG = RPG;
})(typeof globalThis !== 'undefined' ? globalThis : this);
