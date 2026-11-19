// Защита от случайного выхода из-за стола: «Назад» и закрытие вкладки спрашивают подтверждение.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'dist', 'index.html'), 'utf8');
const HTML = '<!doctype html><html><head><meta charset="utf-8"></head><body>' + PAGE + '</body></html>';

let browser;
test.before(async () => { browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined }); });
test.after(async () => { await browser.close(); });

async function newPage() {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (r) => (r.request().url().startsWith('http://app.test') ? r.fulfill({ contentType: 'text/html', body: HTML }) : r.abort()));
  await page.goto('http://app.test/');
  return { page, context, errors };
}

test('«Назад» со стола мастера спрашивает; «Отмена» оставляет за столом, «ОК» выходит', async () => {
  const { page, context, errors } = await newPage();
  await page.click('[data-role="gm"]');
  await page.waitForSelector('#tbl');
  const dialogs = [];
  let answer = false;
  page.on('dialog', (d) => { dialogs.push(d.message()); if (answer) d.accept(); else d.dismiss(); });
  await page.goBack();
  await page.waitForTimeout(300);
  assert.equal(dialogs.length, 1);
  assert.match(dialogs[0], /Выйти из-за стола/);
  assert.equal(await page.locator('#tbl').count(), 1, 'стол на месте');
  assert.equal(await page.evaluate(() => location.hash), '#gm');
  answer = true;
  await page.goBack();
  await page.waitForTimeout(300);
  assert.equal(dialogs.length, 2);
  assert.equal(await page.locator('#tbl').count(), 0, 'вышли');
  assert.deepEqual(errors, []);
  await context.close();
});

test('закрытие вкладки за столом спрашивает подтверждение', async () => {
  const { page, context } = await newPage();
  await page.click('[data-role="gm"]');
  await page.waitForSelector('#tbl');
  await page.click('#tbl');
  const types = [];
  page.on('dialog', (d) => { types.push(d.type()); d.accept(); });
  await page.close({ runBeforeUnload: true });
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(types, ['beforeunload']);
  await context.close();
});

test('вне стола «Назад» работает без вопросов', async () => {
  const { page, context } = await newPage();
  await page.click('[data-role="player"]');
  await page.click('[data-act="join"]');
  await page.waitForSelector('#joinName');
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
  await page.goBack();
  await page.waitForTimeout(300);
  assert.deepEqual(dialogs, []);
  assert.equal(await page.locator('#joinName').count(), 0);
  await context.close();
});
