// Сквозные тесты диагностики связи: кнопка «Проверить связь», журнал ошибок, понятные сообщения при входе.
// В тестах интернет закрыт: PeerJS с CDN не загружается — это и проверяем.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'dist', 'index.html'), 'utf8');
const HTML = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + PAGE + '</body></html>';

let browser;
test.before(async () => { browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined }); });
test.after(async () => { await browser.close(); });

async function newPage(context) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (r) => (r.request().url().startsWith('http://app.test') ? r.fulfill({ contentType: 'text/html', body: HTML }) : r.abort()));
  await page.goto('http://app.test/');
  return { page, errors };
}
async function openJoin(page) {
  await page.click('[data-role="player"]');
  await page.click('[data-act="join"]');
  await page.waitForSelector('#joinName');
}
async function runCheck(page) {
  await page.click('#netCheckOpen');
  await page.waitForSelector('#netDlg[open]');
  await page.waitForFunction(() => { const v = document.querySelector('#netVerdict'); return v && v.textContent.trim().length > 0; }, null, { timeout: 20000 });
}
const stepOk = (page, id) => page.getAttribute(`#netCheckList [data-step="${id}"]`, 'data-ok');

test('игрок: «Проверить связь» на экране входа показывает шаги, итог и отчёт', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const { page, errors } = await newPage(context);
  await openJoin(page);
  await runCheck(page);
  assert.equal(await page.locator('#netCheckList [data-step]').count(), 5);
  assert.equal(await stepOk(page, 'webrtc'), 'true', 'WebRTC в Chromium есть');
  assert.equal(await stepOk(page, 'peerLib'), 'false', 'PeerJS не загрузился — интернет закрыт');
  assert.match(await page.textContent('#netVerdict'), /сервер подключений/);
  const report = await page.inputValue('#netReport');
  assert.match(report, /WebRTC/);
  assert.match(report, /load-failed/);
  assert.match(report, /Chrome/, 'в отчёте браузер');
  assert.ok(await page.locator('#netLogList .lg').count() >= 1, 'журнал показывает записи');
  assert.deepEqual(errors, []);
  await context.close();
});

test('игрок: при неудачном входе понятная причина, ошибка видна в журнале', async () => {
  const context = await browser.newContext();
  const { page, errors } = await newPage(context);
  await openJoin(page);
  await page.fill('#joinName', 'Аня');
  await page.fill('#joinCode', 'ZZZZ22');
  await page.click('#joinGo');
  await page.waitForFunction(() => /Не удалось связаться с сервером подключений/.test(document.querySelector('#joinMsg').textContent), null, { timeout: 20000 });
  await page.click('#netCheckOpen');
  await page.waitForSelector('#netDlg[open]');
  const logText = await page.textContent('#netLogList');
  assert.match(logText, /ZZZZ22/, 'попытка входа записана');
  assert.match(logText, /load-failed/, 'причина записана');
  assert.equal(await page.locator('#netLogList .lg.error').count() >= 1, true, 'ошибки выделены');
  // журнал можно очистить
  await page.click('#netLogClear');
  assert.equal(await page.locator('#netLogList .lg').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('журнал переживает перезагрузку страницы', async () => {
  const context = await browser.newContext();
  const { page } = await newPage(context);
  await openJoin(page);
  await page.fill('#joinName', 'Аня');
  await page.fill('#joinCode', 'QQQQ33');
  await page.click('#joinGo');
  await page.waitForFunction(() => /сервером подключений/.test(document.querySelector('#joinMsg').textContent), null, { timeout: 20000 });
  await page.goto('http://app.test/'); // новая загрузка страницы, хранилище то же
  await openJoin(page);
  await page.click('#netCheckOpen');
  await page.waitForSelector('#netDlg[open]');
  assert.match(await page.textContent('#netLogList'), /QQQQ33/);
  await context.close();
});

test('мастер: кнопка «Проверить связь» на столе, ошибка запуска в журнале', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const { page, errors } = await newPage(context);
  await page.click('[data-role="gm"]');
  await page.waitForSelector('#tbl');
  await page.waitForFunction(() => /недоступно/.test(document.querySelector('#netState').textContent), null, { timeout: 15000 });
  await runCheck(page);
  assert.match(await page.textContent('#netLogList'), /load-failed/);
  // повторный запуск не идёт параллельно: пока проверка идёт, кнопка выключена
  await page.click('#netCheckRun');
  assert.equal(await page.isDisabled('#netCheckRun'), true);
  await page.waitForFunction(() => !document.querySelector('#netCheckRun').disabled, null, { timeout: 20000 });
  await page.click('#netDlgClose');
  assert.equal(await page.locator('#netDlg[open]').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});
