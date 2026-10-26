// report/tools/capture.mjs - regenerate every Nova Studio screenshot in the report.
//
//   1. python -m nova serve --no-browser            (Nova Studio on :8765)
//   2. chrome --headless=new --remote-debugging-port=9333 --hide-scrollbars
//   3. node report/tools/capture.mjs                 (writes report/figures/*.png)
//
// Each figure is cropped to the part of the UI it illustrates and rendered at
// 2x device pixels so it stays sharp when the PDF is zoomed.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const OUT = join(ROOT, 'report', 'figures');
const BASE = 'http://127.0.0.1:8765/';
const DPR = 2;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description);
  if (m.method === 'Page.javascriptDialogOpening') {           // a confirm() would stall every call
    errors.push('dialog: ' + m.params.message);
    ws.send(JSON.stringify({ id: ++seq, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
  }
});
const send = (method, params = {}) => new Promise((r, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`DevTools call timed out: ${method} ${JSON.stringify(params).slice(0, 120)}`)); }, 30000);
  pending.set(id, (m) => { clearTimeout(timer); r(m); });
  ws.send(JSON.stringify({ id, method, params }));
});
const js = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(`${expr.slice(0, 80)}: ${JSON.stringify(r.result.exceptionDetails.exception?.description)}`);
  return r.result?.result?.value;
};
const until = async (expr, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await js(expr)) return; await sleep(80); }
  throw new Error('timeout: ' + expr);
};

await send('Runtime.enable');
await send('Page.enable');

async function viewport(width, height, mobile = false) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: DPR, mobile });
}

const STILL = `document.head.insertAdjacentHTML('beforeend',
  '<style id="capture">*,*::before,*::after{animation:none!important;transition:none!important}' +
  '.toasts{display:none!important} .view,html{scroll-behavior:auto!important} .cfg-box,.graph-box,.tbl-scroll,.code pre,.lr-items,.vm-code{max-height:none!important}</style>')`;

async function studio(hash, { width = 1600, height = 1000, left = null, mobile = false } = {}) {
  await viewport(width, height, mobile);
  await js('try { localStorage.clear() } catch (e) {}').catch(() => {});
  await send('Page.navigate', { url: `${BASE}?shot=${Date.now()}#${hash}` });
  await sleep(250);
  await until(`!!document.querySelector('#led.on') && !!document.querySelector('#view .v-head, #view .hero')`);
  await until(`!!document.querySelector('#lr-card, #view') && (window.__g = true)`);
  await js(STILL);
  if (left) await js(`document.documentElement.style.setProperty('--left', '${left}%')`);
  await sleep(250);
}

// wait until the grammar (LALR automaton) has arrived and re-render the view
async function withGrammar() {
  await until(`!!document.querySelector('#lr-card .lr-items, #view .sc-node') || !document.querySelector('#lr-card .skeleton')`, 20000);
  await sleep(150);
}

const CLIP = `window.__clip = (els, pad) => {
  els = els.filter(Boolean);
  if (!els.length) throw new Error('nothing to clip');
  const r0 = els[0].getBoundingClientRect();
  if (r0.top < 0 || r0.top > innerHeight - 120) els[0].scrollIntoView({ block: 'start', behavior: 'instant' });
  const rs = els.map((e) => e.getBoundingClientRect());
  const x = Math.max(0, Math.min(...rs.map((r) => r.left)) - pad);
  const y = Math.max(0, Math.min(...rs.map((r) => r.top)) - pad);
  const r = Math.min(innerWidth, Math.max(...rs.map((r) => r.right)) + pad);
  const b = Math.min(innerHeight, Math.max(...rs.map((r) => r.bottom)) + pad);
  if (r - x < 8 || b - y < 8) throw new Error('clip is empty: ' + JSON.stringify({ x, y, r, b }));
  return { x, y, width: r - x, height: b - y };
}`;

async function shot(name, elementsExpr = null, pad = 12) {
  await sleep(300);
  let clip;
  if (elementsExpr) {
    await js(CLIP);
    clip = await js(`__clip(${elementsExpr}, ${pad})`);
    clip.scale = 1;
  }
  const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}), captureBeyondViewport: false });
  writeFileSync(join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
  const size = clip ? `${Math.round(clip.width * DPR)}x${Math.round(clip.height * DPR)}` : 'full viewport';
  console.log(`${name}.png  ${size}`);
}

const q = (s) => `document.querySelector(${JSON.stringify(s)})`;
const qa = (s, i) => `document.querySelectorAll(${JSON.stringify(s)})[${i}]`;
const NARROW = { width: 1600, height: 2600, left: 55 };
const MID = { width: 1600, height: 2600, left: 38 };
const WIDE = { width: 1800, height: 2600, left: 22 };
const scrollTo = async (sel) => { await js(`${q(sel)}.scrollIntoView({ block: 'start', behavior: 'instant' })`); await sleep(120); };

// ---------------------------------------------------------------- full UI
await studio('tab=overview&example=02_fibonacci.nova');
await shot('studio-overview');

await studio('tab=overview&example=08_broken.nova');
await js(`${q('[data-dock="problems"]')}.click()`);
await shot('studio-diagnostics');

await studio('tab=overview&example=10_strings.nova');
await shot('overview-strings', `[${q('#view .hero')}]`);

await studio('tab=overview&example=05_optimiser.nova');
await js(`${q('#optimise')}.click()`);
await until(`document.querySelector('.hero') && /Optimiser off/.test(document.querySelector('.hero').innerText)`);
await js(STILL);
await shot('overview-optimiser-off', `[${q('#view .hero')}, ${qa('#view .kpi', 3)}]`);

await studio('tab=syllabus&example=02_fibonacci.nova', { width: 1600, height: 1000, left: 30 });
await shot('syllabus');

await studio('tab=overview&example=02_fibonacci.nova');
await js(`${q('#btn-keys')}.click()`);
await sleep(150);
await shot('keys-modal', `[${q('#keys-modal .modal-card')}]`, 28);

await studio('tab=overview&example=02_fibonacci.nova', { width: 390, height: 844, mobile: true });
await shot('mobile-overview');
await studio('tab=run&example=02_fibonacci.nova', { width: 390, height: 844, mobile: true });
await scrollTo('#vm-stepper');
await shot('mobile-stepper');

// ------------------------------------------------------------ module 1
await studio('tab=lexical&example=02_fibonacci.nova', NARROW);
await withGrammar();
await shot('view-lexical', `[${q('#view .v-head')}, ${qa('#view > .card', 1)}]`);
await shot('scanner-trace', `[${qa('#view > .card', 2)}]`);
await js(`${qa('[data-scan]', 31)}.click()`);   // 'total': five transitions through the identifier state
await sleep(200);
await shot('scanner-trace-ident', `[${qa('#view > .card', 2)}]`);
await js(`${q('[data-fold="lex-dfa"] summary')}.click()`);
await sleep(200);
await shot('dfa-table', `[${q('[data-fold="lex-dfa"] summary')}, ${q('[data-fold="lex-dfa"] tbody tr:nth-child(16)')}]`);

// ------------------------------------------------------------ module 2
await studio('tab=syntax&example=02_fibonacci.nova', NARROW);
await withGrammar();
await shot('view-syntax', `[${q('#view .v-head')}, ${q('#view .grid.three')}, ${q('#view .grid.three + p.note')}]`);
await js(`document.querySelector('[data-player="lr"] .player-range').value = 31; document.querySelector('[data-player="lr"] .player-range').dispatchEvent(new Event('input', {bubbles:true}))`);
await sleep(250);
await shot('parse-player', `[${q('#lr-player')}]`);
await js(`${q('#lr-state-input')}.value = 2; ${q('#lr-state-input')}.dispatchEvent(new Event('input', {bubbles:true}))`);
await sleep(250);
await shot('lr-automaton', `[${q('#lr-card')}]`);
await js(`${q('[data-fold="syn-table"] summary')}.click()`);
await sleep(250);
await shot('lr-table', `[${q('#lr-table')}]`);
await js(`${q('[data-fold="syn-amb"] summary')}.click()`);
await sleep(200);
await shot('ambiguous-grammar', `[${q('[data-fold="syn-amb"]')}]`);
await js(`${q('[data-fold="syn-ll1"] summary')}.click()`);
await sleep(200);
await shot('ll1-conflicts', `[${q('[data-fold="syn-ll1"]')}]`);

await studio('tab=syntax&example=02_fibonacci.nova', WIDE);
await shot('view-lrtrace', `[${qa('#view .sec', 2)}, ${q('#view .tbl-wrap:not(#lr-table) tbody tr:nth-child(10)')}]`);

// ------------------------------------------------------------ module 3
await studio('tab=semantic&example=07_types_and_scopes.nova', NARROW);
await shot('view-semantic', `[${q('#view .v-head')}, ${qa('#view .tbl-wrap', 0)}, ${qa('#view .tbl-wrap', 1)}.querySelector('tbody tr:nth-child(4)')]`);
await studio('tab=semantic&example=02_fibonacci.nova', MID);
await shot('ast-tree', `[${q('#view .graph-box svg')}]`, 0);
await js(`${qa('[data-ast]', 3)}.click()`);
await sleep(200);
await shot('ast-tree-while', `[${q('#view .graph-box svg')}]`, 0);

// ------------------------------------------------------------ module 4
await studio('tab=ir&fn=main&example=02_fibonacci.nova', NARROW);
await shot('view-tac', `[${q('#view .v-head')}, ${qa('#view .code', 0)}]`);
await js(`${q('[data-fold="ir-bp"] summary')}.click()`);
await sleep(200);
await shot('backpatch', `[${q('[data-fold="ir-bp"]')}]`);

// ------------------------------------------------------------ module 5
await studio('tab=optimiser&fn=main&example=05_optimiser.nova', NARROW);
await shot('view-optimiser', `[${q('#view .v-head')}, ${qa('#view .card', 0)}]`);
await shot('dag', `[${q('#view .graph-box svg')}]`, 0);
await studio('tab=optimiser&fn=main&example=05_optimiser.nova', WIDE);
await js(`${q('[data-cfg="before"]')}.click()`);
await sleep(200);
await shot('cfg-before', `[${q('#view .cfg-box svg')}]`, 0);
await js(`${q('[data-cfg="after"]')}.click()`);
await sleep(200);
await shot('cfg-after', `[${q('#view .cfg-box svg')}]`, 0);

await studio('tab=dataflow&fn=gcd&example=03_gcd.nova', MID);
await shot('df-overlay', `[${q('#view .cfg-box svg')}]`, 0);
await studio('tab=dataflow&fn=gcd&example=03_gcd.nova', NARROW);
await js(`${qa('#view > .card', 1)}.querySelector('details summary').click()`);
await sleep(200);
await shot('view-dataflow', `[${qa('#view > .card', 1)}]`);

// ------------------------------------------------------------ module 6
await studio('tab=codegen&fn=fib&example=02_fibonacci.nova', WIDE);
await shot('view-codegen', `[${q('#view .v-head')}, ${q('#view .grid.two')}]`);
await studio('tab=codegen&fn=main&example=05_optimiser.nova', WIDE);
await shot('reg-timeline', `[${q('#view table.tl')}.closest('.card')]`);
await scrollTo('#view .tbl-wrap:last-of-type');
await shot('reg-decisions', `[${q('#view .tbl-wrap:last-of-type')}]`);

// ------------------------------------------------------------ module 7
await studio('tab=ssa&fn=gcd&example=03_gcd.nova', MID);
await shot('view-ssa', `[${q('#view .v-head')}, ${q('#view .grid.two')}]`);
await studio('tab=ssa&fn=isprime&example=04_primes.nova', MID);
await shot('dom-tree', `[${q('#view .graph-box svg')}]`, 0);
await studio('tab=ssa&fn=main&example=06_parallel.nova', NARROW);
await scrollTo('#view .loop-card');
await shot('view-loops', `[...document.querySelectorAll('#view .loop-card')]`);
await studio('tab=ssa&fn=main&example=09_nested_loops.nova', NARROW);
await scrollTo('#view .loop-card');
await shot('nested-loops', `[...document.querySelectorAll('#view .loop-card')]`);
await js(`${q('[data-fold="ssa-llvm"] summary')}.click()`);
await sleep(200);
await scrollTo('[data-fold="ssa-llvm"]');
await shot('llvm-ir', `[${q('[data-fold="ssa-llvm"] summary')}, ${q('[data-fold="ssa-llvm"] pre .row:nth-of-type(34)')}]`);

// ------------------------------------------------------------ module 8
await studio('tab=verify&example=03_gcd.nova', NARROW);
await shot('view-verifier', `[${q('#view .v-head')}, ${qa('#view .grid.two > .card', 0)}, ${qa('#view .grid.two > .card', 1)}]`);
await studio('tab=verify&example=02_fibonacci.nova', NARROW);
await js(`${q('[data-fold="bc-peep"] summary')}.click()`);
await sleep(150);
await scrollTo('#view .code');
await shot('bytecode', `[${q('#view .code .code-head')}, ${q('#view .code pre .row:nth-of-type(40)')}]`);
await scrollTo('[data-fold="bc-peep"]');
await shot('peephole', `[${q('[data-fold="bc-peep"]')}]`);

await studio('tab=security&example=02_fibonacci.nova', NARROW);
await until(`!!document.querySelector('#view .attack')`);
await js(STILL);
await shot('view-security', `[${q('#view .v-head')}, ${qa('#view .attack', 2)}]`);
await scrollTo(`#view .attack:nth-of-type(7)`);
await shot('security-sandbox', `[${qa('#view .attack', 5)}, ${qa('#view .attack', 7)}]`);

// ------------------------------------------------------------ execution
await studio('tab=run&example=02_fibonacci.nova', { width: 1600, height: 2600, left: 48 });
await shot('view-execution', `[${q('#view .v-head')}, ${q('#view .frame-stack .ar-frame:nth-child(3)')}]`);
await js(`(() => { const r = document.querySelector('[data-player="vm"] .player-range'); r.value = 141; r.dispatchEvent(new Event('input', {bubbles:true})); })()`);
await sleep(250);
await shot('vm-stepper', `[${q('#vm-stepper')}]`);
await scrollTo('#view .tbl-wrap');
await shot('vm-trace', `[${q('#view .tbl-wrap .tbl-tools')}, ${q('#view .tbl-wrap tbody tr:nth-child(14)')}]`);

await studio('tab=run&example=11_deep_recursion.nova', NARROW);
await shot('deep-recursion', `[${q('#view .v-head')}, ${q('#view .frame-stack .ar-frame:nth-child(4)')}]`);

await studio('tab=run&example=01_hello.nova', NARROW);
await js(`(() => { const t = document.querySelector('#source'); t.focus(); t.select();
  document.execCommand('insertText', false, 'let i = 0;\\nwhile true do\\n    i = i + 1;\\nend\\nprint i;'); })()`);
await until(`/instruction budget/.test(document.querySelector('#dock-output').innerText)`);
await sleep(300);
await shot('view-budget', `[${q('#view .notice')}, ${qa('#view > .card', 0)}]`);

await studio('tab=metrics&example=02_fibonacci.nova', NARROW);
await shot('view-metrics', `[${q('#view .v-head')}, ${q('#view .tbl-wrap tbody tr:nth-child(14)')}]`);

// ----------------------------------------------------- the HTML report
await viewport(1400, 900);
const report = pathToFileURL(join(ROOT, 'docs', 'Nova-GlassBox-Report-optimiser.html')).href;
await send('Page.navigate', { url: report });
await until(`document.readyState === 'complete' && typeof show === 'function'`);
await js('show(5)');
await js(`(() => {
  const h = [...document.querySelectorAll('section.on h3')].find((e) =>
    /main/.test(e.textContent) && /before optimisation/.test(e.textContent));
  window.scrollTo(0, h.getBoundingClientRect().top + scrollY - 70);
})()`);
await shot('report-html');
await js('show(8); window.scrollTo(0, 0)');
await shot('report-html-verifier');
await js('show(0); window.scrollTo(0, 0)');
await shot('report-html-overview');

console.log(errors.length ? 'page errors:\n  ' + errors.join('\n  ') : 'no page errors');
ws.close();
process.exit(0);
