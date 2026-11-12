// Teste de fumaça com Playwright (sem o executor @playwright/test, que trava no Windows).
// Uso: node tests/smoke.mjs            (Chromium do Playwright)
//      PW_CHANNEL=msedge node tests/smoke.mjs   (Edge/Chrome já instalado)
// Sobe um servidor em :8081, abre a página, espera o modelo, tira screenshots desktop (1280x800)
// e celular (390x844), percorre trajeto/entrar e simula uma rodada do desafio.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const PORT = 8081, BASE = `http://localhost:${PORT}/`, SHOTS = 'tests/screenshots';
fs.mkdirSync(SHOTS, { recursive: true });
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ['tools/serve.mjs', 'site', String(PORT)], { stdio: 'ignore' });
await sleep(700);

const LAYER = {
  atrio_direito: 'paredes', atrio_esquerdo: 'paredes', ventriculos: 'paredes',
  cav_atrio_dir: 'cavidades', cav_vent_dir: 'cavidades', cav_atrio_esq: 'cavidades', cav_vent_esq: 'cavidades',
};

async function boot(page, errors) {
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.addInitScript(() => { if (window.speechSynthesis) window.speechSynthesis.speak = () => {}; });
  await page.goto(BASE);
  await page.waitForFunction(() => window.__app && window.__app.S.ready, null, { timeout: 90_000 });
  await page.click('#btnStart');
  await sleep(600);
}

async function screenPos(page, id) {
  return page.evaluate((id) => {
    const sc = document.querySelector('a-scene'), m = __app.S.meshes[id];
    const c = __app.S.centers[id].clone();
    m.localToWorld(c); c.project(sc.camera);
    const r = sc.canvas.getBoundingClientRect();
    return { x: r.left + ((c.x + 1) / 2) * r.width, y: r.top + ((1 - c.y) / 2) * r.height };
  }, id);
}
const mode = (page) => page.evaluate(() => __app.S.mode);

let browser, failed = false;
try {
  browser = await chromium.launch({
    channel: process.env.PW_CHANNEL || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });

  // ---------------------------------------------------------------- desktop
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    await boot(page, errors);
    assert.equal(await page.evaluate(() => Object.keys(__app.S.meshes).length), 25, '25 grupos no GLB');
    await page.screenshot({ path: `${SHOTS}/desktop-inicio.png` });
    log('desktop: modelo carregado, 25 grupos');

    const p = await screenPos(page, 'ventriculos');
    await page.mouse.click(p.x, p.y);
    assert.ok(await page.isVisible('#info'), 'clique abre o painel');
    log('desktop: clique seleciona ' + (await page.textContent('#infoTitle')));

    const allNames = await page.evaluate(() => window.CONTENT.GROUPS.every((g) => {
      __app.select(g.id, { speak: false });
      return document.querySelector('#infoTitle').textContent === g.nome;
    }));
    assert.ok(allNames, 'cada grupo mostra o nome correto');
    log('desktop: 25 nomes corretos');

    await page.evaluate(() => { __app.action('exit'); __app.action('walls'); });
    await sleep(300);
    const v = await screenPos(page, 'valva_aortica');
    await page.mouse.click(v.x, v.y);
    const hit = await page.evaluate(() => __app.S.selected);
    assert.ok(hit && !LAYER[hit], `com paredes transparentes o clique atravessa (pegou ${hit})`);
    await page.screenshot({ path: `${SHOTS}/desktop-paredes-transparentes.png` });
    log('desktop: paredes transparentes, clique atravessou até ' + hit);

    await page.evaluate(() => { __app.action('walls'); __app.action('exit'); __app.action('path'); });
    const colors = [];
    for (let i = 0; i < 13; i++) {
      colors.push(await page.evaluate(() => '#' + __app.Path.sphere.material.color.getHexString()));
      if (i === 6) { await sleep(1800); await page.screenshot({ path: `${SHOTS}/desktop-trajeto-passo7.png` }); }
      if (i < 12) await page.click('#pathNext');
    }
    await sleep(4500);
    await page.screenshot({ path: `${SHOTS}/desktop-trajeto-passo13.png` });
    assert.equal(new Set(colors.slice(0, 7)).size, 1);
    assert.equal(new Set(colors.slice(7)).size, 1);
    assert.notEqual(colors[6], colors[7], 'esfera muda de cor no passo 7→8');
    await page.click('#pathNext');
    assert.equal(await mode(page), 'explore');
    log(`desktop: trajeto 13 passos, esfera ${colors[0]} → ${colors[7]}`);

    await page.click('[data-action="enter-ad"]');
    await sleep(1000);
    assert.equal(await mode(page), 'enter');
    const desc = await page.textContent('#enterText');
    assert.match(desc, /valva tricúspide/);
    await page.screenshot({ path: `${SHOTS}/desktop-dentro-atrio-direito.png` });
    log('desktop: dentro do AD — ' + desc);
    await page.click('#enterExit'); await sleep(1000);
    await page.click('[data-action="enter-ve"]'); await sleep(1000);
    log('desktop: dentro do VE — ' + (await page.textContent('#enterText')));
    await page.screenshot({ path: `${SHOTS}/desktop-dentro-ventriculo-esquerdo.png` });
    await page.click('#enterExit'); await sleep(1000);
    assert.equal(await mode(page), 'explore');

    await page.click('[data-action="quiz"]');
    await page.fill('#pcode', 'p07');
    await page.click('#quizForm button[type=submit]');
    assert.ok(await page.isVisible('#quizBar'));
    await page.screenshot({ path: `${SHOTS}/desktop-desafio.png` });
    for (let i = 0; i < 6; i++) {
      const alvo = await page.evaluate(() => __app.Quiz.current().alvo);
      if (i === 0) await page.evaluate((a) => __app.select(a === 'arco_aorta' ? 'veia_cava_superior' : 'arco_aorta'), alvo);
      await page.evaluate((a) => __app.select(a), alvo);
      await sleep(1600);
    }
    assert.equal(await page.textContent('#modalTitle'), 'Desafio concluído');
    const exported = await page.inputValue('#exportTxt');
    const json = JSON.parse(exported.split('\n\n')[0]);
    assert.equal(json.participante, 'P07');
    assert.equal(json.itens.length, 6);
    assert.equal(json.itens[0].erros, 1);
    assert.equal(json.plataforma_inicio, 'desktop');
    assert.ok(exported.includes('participante,plataforma_inicio'));
    await page.screenshot({ path: `${SHOTS}/desktop-resultado-desafio.png` });
    log(`desktop: desafio exportado (${json.acertos}/${json.total}, ${json.tempo_total_s}s)`);

    assert.deepEqual(errors, [], 'sem erros no console');
    await page.close();
  }

  // ---------------------------------------------------------------- celular
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errors = [];
    await boot(page, errors);
    await page.screenshot({ path: `${SHOTS}/celular-inicio.png` });
    const p = await screenPos(page, 'ventriculos');
    await page.touchscreen.tap(p.x, p.y);
    await sleep(300);
    assert.ok(await page.isVisible('#info'), 'toque seleciona');
    await page.screenshot({ path: `${SHOTS}/celular-selecao.png` });
    await page.click('#btnMenu'); await sleep(400);
    await page.screenshot({ path: `${SHOTS}/celular-menu.png` });
    await page.click('#btnMenuClose'); await sleep(300);
    assert.ok(!(await page.evaluate(() => document.querySelector('#sidebar').classList.contains('open'))), 'menu fecha');
    await page.evaluate(() => __app.action('path')); await sleep(1500);
    await page.screenshot({ path: `${SHOTS}/celular-trajeto.png` });
    assert.deepEqual(errors, [], 'sem erros no console (celular)');
    log('celular: ok');
    await ctx.close();
  }
  log('TODOS OS TESTES PASSARAM');
} catch (e) {
  failed = true;
  console.error('FALHOU:', e.message);
} finally {
  if (browser) await browser.close();
  server.kill();
  process.exit(failed ? 1 : 0);
}
