// Подсказки за столом мастера и игрока: всплывающие окна «как в играх», чек-лист «С чего начать», хранение настроек.
(function (root) {
  'use strict';

  // События, на которые появляются подсказки.
  const TRIGGERS = ['open', 'tab:scenes', 'tab:tokens', 'tab:combat', 'tab:journal', 'tab:players', 'tab:hero',
    'tool:reveal', 'tool:hide', 'tool:measure', 'select:token', 'focus:dice', 'combat:start', 'player:first', 'turn:mine',
    'tool:move', 'card:show', 'fog:vision', 'combat:effects'];

  // text: строка или { dnd, gurps, munchkin } — dnd подходит обеим редакциям D&D.
  const TIPS = [
    // ---------- Мастер ----------
    { id: 'gm-open', role: 'gm', on: 'open', target: '#roomCode', title: 'Это ваш стол',
      text: 'Назовите игрокам этот код: они нажмут «Игрок → Подключиться к столу мастера». На этом экране — вкладки подготовки (сцены, фишки, бой), карта, кубики и чат.' },
    { id: 'gm-system', role: 'gm', on: 'open', target: '#tableSystem', title: 'Во что играем',
      text: {
        dnd: 'Выбрана D&D 5e. От системы зависят поля фишек (хиты, КД), кубики (к20 с преимуществом) и линейка (5 футов за клетку). Сменить можно в любой момент.',
        gurps: 'Выбран GURPS. Фишки получают ЕЖ, СП, Уклонение и Движение, кубики — проверку 3к6 под навык, линейка меряет в ярдах. Сменить можно в любой момент.',
        munchkin: 'Выбран Манчкин. У фишек — уровень и бонус, кубик — к6, линейка считает клетки. Сменить систему можно в любой момент.' } },
    { id: 'gm-checklist', role: 'gm', on: 'open', target: '#checklistBtn', title: 'С чего начать',
      text: 'Здесь 7 шагов подготовки к игре. Галочки ставятся сами, а нажатие на шаг открывает нужную вкладку.' },
    { id: 'gm-scenes', role: 'gm', on: 'tab:scenes', target: '[data-tab="scenes"]', title: 'Сцены',
      text: 'Сцена — это одна карта: таверна, лес, подземелье. Дайте имя, загрузите картинку карты и нажмите «Добавить». Игроки видят только активную сцену.' },
    { id: 'gm-tokens', role: 'gm', on: 'tab:tokens', target: '[data-tab="tokens"]', title: 'Фишки',
      text: {
        dnd: 'Фишка — герой или монстр на карте. Укажите имя, тип, хиты и КД. Хиты и КД монстров игроки не видят — только «цел / ранен / при смерти».',
        gurps: 'Фишка — герой или противник. Укажите ЕЖ, СП (сопротивление повреждениям), Уклонение и Движение. Цифры противников игроки не видят — только их состояние.',
        munchkin: 'Фишка — манчкин или монстр. Уровень монстра видят все, а его бонус знаете только вы.' } },
    { id: 'gm-combat', role: 'gm', on: 'tab:combat', target: '[data-tab="combat"]', title: 'Бой',
      text: {
        dnd: 'Начните бой и добавьте участников — инициатива бросится сама (к20). «Следующий ход» передаёт ход; у игрока на его ходу подсвечивается фишка.',
        gurps: 'Начните бой и добавьте участников. Порядок — по Базовой скорости (у фишки берётся Движение, поправьте вручную). «Следующий ход» передаёт ход.',
        munchkin: 'Начните бой и добавьте участников — очерёдность бросится к6. «Следующий ход» передаёт ход.' } },
    { id: 'gm-journal', role: 'gm', on: 'tab:journal', target: '[data-tab="journal"]', title: 'Журнал',
      text: 'Заметки по сюжету, NPC и находкам. Отметьте «показать игрокам» — и запись появится у них, остальное видите только вы.' },
    { id: 'gm-give-hero', role: 'gm', on: 'tab:players', target: '[data-tab="players"]', title: 'Как отдать героя игроку',
      text: 'Выберите фишку героя на карте, во вкладке «Фишки» в поле «Управляет» укажите игрока. После этого он двигает её сам и видит свою карточку героя.' },
    { id: 'gm-players', role: 'gm', on: 'tab:players', target: '[data-tab="players"]', title: 'Игроки',
      text: 'Здесь видно, кто подключился и какие листы героев прислал. Чтобы игрок двигал свою фишку, выберите его в поле «Управляет» у фишки.' },
    { id: 'gm-reveal', role: 'gm', on: 'tool:reveal', target: '[data-tool="reveal"]', title: 'Туман: открыть',
      text: 'Сначала включите туман во вкладке «Сцены». Затем выделите прямоугольник на карте — эта часть откроется игрокам.' },
    { id: 'gm-hide', role: 'gm', on: 'tool:hide', target: '[data-tool="hide"]', title: 'Туман: скрыть',
      text: 'Выделите область, и она снова скроется туманом. Монстры в тумане игрокам не видны.' },
    { id: 'gm-measure', role: 'gm', on: 'tool:measure', target: '[data-tool="measure"]', title: 'Линейка',
      text: {
        dnd: 'Потяните по карте — покажет расстояние в футах (5 футов за клетку, диагональ как одна клетка).',
        gurps: 'Потяните по карте — покажет расстояние в ярдах (1 ярд за клетку).',
        munchkin: 'Потяните по карте — покажет, сколько клеток между точками.' } },
    { id: 'gm-token-sel', role: 'gm', on: 'select:token', target: '#tokEditOwner', title: 'Выбранная фишка',
      text: 'Здесь меняются её параметры. «Управляет» — какой игрок может её двигать. «Скрыта от игроков» — засада. «В бой» — добавить в порядок ходов.' },
    { id: 'gm-dice', role: 'gm', on: 'focus:dice', target: '#diceExpr', title: 'Кубики',
      text: {
        dnd: 'Пишите бросок как 1к20+5 или 2к6. Режим «с преимуществом» или «с помехой» работает для к20. Галочка «скрытно» — бросок увидите только вы.',
        gurps: 'Для проверки впишите навык в поле «навык» и бросьте 3к6: успех, если выпало не больше навыка. Урон — как 2к6+1. «Скрытно» — бросок видите только вы.',
        munchkin: 'Кнопка к6 — обычный бросок кубика (смывка, проклятия). Можно вписать 2к6. «Скрытно» — бросок видите только вы.' } },
    { id: 'gm-combat-next', role: 'gm', on: 'combat:start', target: '#combatNext', title: 'Бой начался',
      text: 'Добавьте участников: по одному кнопкой «В бой» у фишки или «Добавить всех на сцене». Порядок правится числами; «Следующий ход» и «Назад» двигают ход.' },
    { id: 'gm-player-first', role: 'gm', on: 'player:first', target: '[data-tab="players"]', title: 'Подключился игрок',
      text: 'Первый игрок за столом! Дайте ему фишку: выберите её и укажите игрока в поле «Управляет». Его лист героя появится во вкладке «Игроки».' },

    { id: 'gm-vision', role: 'gm', on: 'fog:vision', target: '#fogMode', title: 'Туман по обзору',
      text: {
        dnd: 'Туман рассеивается вокруг героев на радиус обзора (в футах). Где герои уже были — полупрозрачно, монстров там не видно. Своё зрение фишки (тёмное зрение 60) — в её характеристиках.',
        gurps: 'Туман рассеивается вокруг героев на радиус обзора (в ярдах). Где герои уже были — полупрозрачно, противников там не видно. Свой радиус — в характеристиках фишки.',
        munchkin: 'Туман рассеивается вокруг манчкинов на радиус в клетках. Где уже были — полупрозрачно, монстров там не видно.' } },
    { id: 'gm-effects', role: 'gm', on: 'combat:effects', target: '#combatList', title: 'Эффекты в бою',
      text: 'У каждого участника — полоска хитов и эффекты. Выберите эффект из списка или впишите свой, укажите раунды (пусто — без срока) и нажмите «+». Срок уменьшается каждый раунд, ✕ снимает эффект.' },

    // ---------- Игрок ----------
    { id: 'pl-open', role: 'player', on: 'open', target: '#tableSystemName', title: 'Вы за столом',
      text: 'Карту, туман и монстров ведёт мастер. Свою фишку (её даст мастер) двигайте мышью или пальцем. Справа — кубики и чат со всеми.' },
    { id: 'pl-combat', role: 'player', on: 'tab:combat', target: '[data-tab="combat"]', title: 'Бой',
      text: {
        dnd: 'Здесь порядок ходов. Впишите бонус инициативы и бросьте к20. В свой ход двигайте фишку и нажмите «Завершить ход».',
        gurps: 'Здесь порядок ходов. Впишите свою Базовую скорость — по ней ходят в GURPS. В свой ход нажмите «Завершить ход», когда закончите.',
        munchkin: 'Здесь очерёдность. Бросьте к6 с бонусом. В свой ход нажмите «Завершить ход», когда закончите.' } },
    { id: 'pl-journal', role: 'player', on: 'tab:journal', target: '[data-tab="journal"]', title: 'Журнал',
      text: 'Сюда мастер выкладывает открытые записи: письма, карты, имена NPC. Обновляется само.' },
    { id: 'pl-hero', role: 'player', on: 'tab:hero', target: '[data-tab="hero"]', title: 'Мой герой',
      text: 'Выберите своего персонажа и отправьте лист мастеру — он увидит хиты, защиту и уровень. Подходят только персонажи той же НРИ, что у стола.' },
    { id: 'pl-measure', role: 'player', on: 'tool:measure', target: '[data-tool="measure"]', title: 'Линейка',
      text: {
        dnd: 'Потяните по карте — увидите расстояние в футах (5 футов за клетку). Удобно, чтобы понять, хватит ли скорости.',
        gurps: 'Потяните по карте — увидите расстояние в ярдах (1 ярд за клетку), сравните с Движением.',
        munchkin: 'Потяните по карте — увидите, сколько клеток до цели.' } },
    { id: 'pl-dice', role: 'player', on: 'focus:dice', target: '#diceExpr', title: 'Кубики',
      text: {
        dnd: 'Пишите бросок как 1к20+5. Для к20 есть «с преимуществом» и «с помехой». Галочка «только мастеру» скроет бросок от остальных.',
        gurps: 'Проверка: впишите навык в поле «навык» и бросьте 3к6 — успех, если выпало не больше навыка. Урон пишите как 2к6+1.',
        munchkin: 'Кнопка к6 — бросок для смывки и проклятий. Можно вписать 2к6. «Только мастеру» скроет бросок от остальных.' } },
    { id: 'pl-move', role: 'player', on: 'tool:move', target: '[data-tool="move"]', title: 'Двигать',
      text: 'В этом режиме перетаскивайте свою фишку (она с подсветкой). Чужие фишки двигать нельзя, а по пустому месту карта сдвигается целиком.' },
    { id: 'pl-card', role: 'player', on: 'card:show', target: '#heroCard', title: 'Ваша карточка героя',
      text: {
        dnd: 'Тут главное о герое: хиты, КД, скорость и эффекты. Хиты меняйте сами — впишите число. В свой ход здесь появится «Завершить ход».',
        gurps: 'Тут главное о герое: ЕЖ (хиты), Уклонение, Движение и эффекты. ЕЖ меняйте сами. В свой ход здесь появится «Завершить ход».',
        munchkin: 'Тут ваш уровень, сила в бою и эффекты. Уровень и бонус меняйте сами. В свой ход здесь появится «Завершить ход».' } },
    { id: 'pl-turn', role: 'player', on: 'turn:mine', target: '[data-tab="combat"]', title: 'Ваш ход!',
      text: 'Сейчас ходите вы: двигайте фишку, бросайте кубики, затем нажмите «Завершить ход» во вкладке «Бой».' },
  ];

  const family = (sys) => (/^dnd/.test(sys || '') ? 'dnd' : sys === 'gurps' || sys === 'munchkin' ? sys : 'dnd');
  /** Текст подсказки под НРИ стола. */
  function textFor(tip, sys) {
    if (!tip) return '';
    if (typeof tip.text === 'string') return tip.text;
    return tip.text[sys] || tip.text[family(sys)] || tip.text.dnd || '';
  }

  const DEFAULTS = () => ({ enabled: true, seen: [] });
  const clean = (p) => ({ enabled: !(p && p.enabled === false), seen: Array.isArray(p && p.seen) ? p.seen.filter((x) => typeof x === 'string').slice(0, 200) : [] });

  /** Следующая подсказка для события: своей роли, ещё не виденная. Пропускает id из skip. */
  function next(trigger, ctx, skip) {
    const p = ctx && ctx.prefs ? clean(ctx.prefs) : DEFAULTS();
    if (!p.enabled) return null;
    const role = ctx && ctx.role === 'player' ? 'player' : 'gm';
    const no = new Set(p.seen.concat(skip || []));
    return TIPS.find((t) => t.on === trigger && t.role === role && !no.has(t.id) && (!t.sys || t.sys.includes(ctx.sys))) || null;
  }
  const markSeen = (p, id) => { const c = clean(p); if (!c.seen.includes(id)) c.seen.push(id); return c; };
  const reset = () => DEFAULTS();

  // ---------- Чек-лист мастера ----------
  const STEPS = [
    ['scene', 'Создать сцену', 'scenes', (s) => s.scenes.length > 0],
    ['map', 'Загрузить карту', 'scenes', (s) => s.scenes.some((x) => x.image)],
    ['tokens', 'Добавить фишки', 'tokens', (s) => s.scenes.some((x) => x.tokens.length > 0)],
    ['fog', 'Открыть часть карты в тумане', 'scenes', (s) => s.scenes.some((x) => x.fog && x.fog.revealed.length > 0)],
    ['players', 'Позвать игроков (код стола)', 'players', (s) => Object.keys(s.players || {}).length > 0],
    ['owner', 'Отдать фишку игроку', 'tokens', (s) => s.scenes.some((x) => x.tokens.some((t) => t.owner))],
    ['combat', 'Начать бой', 'combat', (s) => !!(s.combat && s.combat.active)],
  ];
  function checklist(state) {
    const s = state || { scenes: [], players: {} };
    return STEPS.map(([id, title, tab, done]) => ({ id, title, tab, done: !!done(s) }));
  }
  const progress = (state) => checklist(state).filter((x) => x.done).length + '/' + STEPS.length;

  // ---------- Хранение ----------
  const KEY = 'rpg-table.tips';
  /** Настройки подсказок в localStorage; если он недоступен — в памяти. */
  function store(ls) {
    let mem = null;
    return {
      load() {
        try {
          if (ls) { const raw = ls.getItem(KEY); if (raw != null) return clean(JSON.parse(raw)); }
        } catch (e) { /* битые данные или нет доступа */ }
        return mem ? clean(mem) : DEFAULTS();
      },
      save(p) {
        mem = clean(p);
        try { if (ls) ls.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* остаётся в памяти */ }
      },
    };
  }

  const API = { TIPS, TRIGGERS, textFor, next, markSeen, reset, checklist, progress, store, KEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.RPG_TIPS = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
