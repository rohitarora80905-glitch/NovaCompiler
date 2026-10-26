/* ==========================================================================
   Nova Studio - the glass-box compiler in a browser.

   Everything on screen is drawn from one JSON document returned by
   POST /api/compile (see nova/report_json.py).  No frameworks, no build step,
   no network access beyond the local server: the same rules as the compiler.
   ========================================================================== */
(() => {
  'use strict';

  // ------------------------------------------------------------ utilities
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
  const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : esc(n));
  const pct = (a, b) => (a ? Math.round((100 * (a - b)) / a) : 0);
  const plural = (n, w) => `${fmt(n)} ${w}${n === 1 ? '' : 's'}`;

  const store = {
    get(k, d) {
      try { const v = localStorage.getItem('nova.' + k); return v === null ? d : JSON.parse(v); }
      catch (e) { return d; }
    },
    set(k, v) { try { localStorage.setItem('nova.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };

  const ICON = {
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    cross: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    warn: '<svg viewBox="0 0 24 24"><path d="M12 8v5M12 16.5v.5"/></svg>',
    dash: '<svg viewBox="0 0 24 24"><path d="M7 12h10"/></svg>',
    play: '<path d="M7 4.5v15l12.5-7.5z"/>',
    spin: '<path d="M12 3a9 9 0 1 0 9 9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  };

  const KEYWORDS = new Set(['let', 'if', 'then', 'else', 'end', 'while', 'do', 'case', 'of', 'when',
    'otherwise', 'func', 'return', 'print', 'and', 'or', 'not', 'true', 'false']);

  // ---------------------------------------------------------------- state
  const state = {
    examples: [],
    example: null,          // file name of the example the buffer came from
    baseline: '',           // its source, to know whether the buffer is dirty
    fileName: 'untitled.nova',
    data: null,
    grammar: null,
    attacks: null,
    health: null,
    tab: 'overview',
    fn: null,
    cfgMode: 'after',
    live: store.get('live', true),
    optimise: store.get('optimise', true),
    seq: 0,
    ctrl: null,
    filters: {},
    folds: {},
    caretLine: 1,
  };

  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'lexical', label: 'Lexical', num: '1' },
    { id: 'syntax', label: 'Syntax', num: '2' },
    { id: 'semantic', label: 'Semantics', num: '3' },
    { id: 'ir', label: 'Three-address', num: '4', perFn: true },
    { id: 'optimiser', label: 'Optimiser', num: '5', perFn: true },
    { id: 'dataflow', label: 'Data flow', num: '5b', perFn: true },
    { id: 'codegen', label: 'Code gen', num: '6', perFn: true },
    { id: 'ssa', label: 'SSA & parallel', num: '7', perFn: true },
    { id: 'verify', label: 'Bytecode & verifier', num: '8' },
    { id: 'run', label: 'Execution', num: '9' },
    { id: 'security', label: 'Security lab' },
    { id: 'metrics', label: 'Metrics' },
  ];

  const SHARED = '5-7. Optimise, data flow, code generation';
  const STAGES = [
    { tab: 'lexical', name: 'Lexer', timing: '1. Lexical analysis' },
    { tab: 'syntax', name: 'Parser', timing: '2. Syntax analysis' },
    { tab: 'semantic', name: 'Semantics', timing: '3. Semantic analysis' },
    { tab: 'ir', name: 'TAC', timing: '4. Intermediate code' },
    { tab: 'optimiser', name: 'Optimiser', timing: SHARED },
    { tab: 'codegen', name: 'Codegen', timing: SHARED, shared: true },
    { tab: 'ssa', name: 'SSA', timing: SHARED, shared: true },
    { tab: 'verify', name: 'Verifier', timing: '8. Bytecode verification' },
    { tab: 'run', name: 'Execute', timing: 'Execution' },
  ];

  // ------------------------------------------------------------- elements
  const ta = $('#source');
  const hl = $('#highlight');
  const gutter = $('#gutter');
  const decor = $('#decor');
  const view = $('#view');

  // ===================================================================
  //  Syntax highlighting
  // ===================================================================
  const NOVA_RE = /(#[^\n]*)|("[^"\n]*"?)|(\b\d+\b)|([A-Za-z_]\w*)|(==|!=|<=|>=|[=<>+\-*/%])|([(),;:])/g;

  function highlightNova(src) {
    let out = '';
    let last = 0;
    let prev = '';
    let m;
    NOVA_RE.lastIndex = 0;
    while ((m = NOVA_RE.exec(src))) {
      out += esc(src.slice(last, m.index));
      const t = m[0];
      let cls = '';
      if (m[1]) cls = 't-c';
      else if (m[2]) cls = 't-s';
      else if (m[3]) cls = 't-n';
      else if (m[4]) {
        if (KEYWORDS.has(t)) cls = t === 'true' || t === 'false' ? 't-b' : 't-k';
        else if (prev === 'func' || src[NOVA_RE.lastIndex] === '(') cls = 't-f';
        prev = t;
      } else if (m[5]) cls = 't-o';
      else if (m[6]) cls = 't-p';
      if (!m[4]) prev = '';
      out += cls ? `<span class="${cls}">${esc(t)}</span>` : esc(t);
      last = NOVA_RE.lastIndex;
    }
    return out + esc(src.slice(last)) + '\n';
  }

  // TAC, target code, bytecode, LLVM IR, SSA - one forgiving highlighter.
  const IR_RE = /(;[^\n]*)|("[^"\n]*")|(\b[BL]\d+\b)|(%[\w.]+|@[\w.]+)|(\bR\d+\b|\bfp\b)|(\bt\d+\b|\b\w+_\d+\b)|(\b[A-Z][A-Z_0-9]{1,}\b)|(\b(?:goto|if|ifFalse|return|print|param|call|phi|define|declare|ret|br|alloca|store|load|icmp|label|add|sub|mul|sdiv|srem|i32|i1|i8|void|nsw|private|constant|global|entry)\b)|(#?-?\b\d+\b)/g;

  function highlightIR(line) {
    let out = '';
    let last = 0;
    let m;
    IR_RE.lastIndex = 0;
    while ((m = IR_RE.exec(line))) {
      out += esc(line.slice(last, m.index));
      const cls = m[1] ? 't-c' : m[2] ? 't-s' : m[3] ? 't-l' : m[4] ? 't-r' : m[5] ? 't-r'
        : m[6] ? 't-t' : m[7] ? 't-op' : m[8] ? 't-k' : 't-n';
      out += `<span class="${cls}">${esc(m[0])}</span>`;
      last = IR_RE.lastIndex;
    }
    return out + esc(line.slice(last));
  }

  // ===================================================================
  //  Components
  // ===================================================================
  let uid = 0;
  const TBL = new Map();
  const COPY = new Map();

  function markText(raw, f) {
    const s = String(raw == null ? '' : raw);
    if (!f) return esc(s);
    const low = s.toLowerCase();
    let out = '';
    let i = 0;
    let j;
    while ((j = low.indexOf(f, i)) !== -1) {
      out += esc(s.slice(i, j)) + '<mark>' + esc(s.slice(j, j + f.length)) + '</mark>';
      i = j + f.length;
    }
    return out + esc(s.slice(i));
  }

  /** A filterable table.  cols: [{t, cls, fmt(value,row)}]; data: {rows,total} or array. */
  function table(key, cols, data, opts = {}) {
    const id = 'tb' + (++uid);
    const rows = Array.isArray(data) ? data : (data && data.rows) || [];
    const total = Array.isArray(data) ? data.length : (data && data.total) || 0;
    const t = { key, cols, rows, total, limit: opts.limit || 150, filter: state.filters[key] || '' };
    TBL.set(id, t);
    if (!rows.length) {
      return `<div class="tbl-wrap"><div class="empty">${esc(opts.empty || 'Nothing to show for this program.')}</div></div>`;
    }
    const search = opts.search !== false && rows.length > 6;
    const tools = search || opts.title
      ? `<div class="tbl-tools">
           ${opts.title ? `<b style="font-size:13px">${esc(opts.title)}</b>` : ''}
           ${search ? `<label class="search">${ICON.search}<input data-tbl="${id}" data-key="${esc(key)}" placeholder="Filter ${esc(opts.noun || 'rows')}…" value="${esc(t.filter)}"></label>` : ''}
           <span class="count" data-count="${id}"></span>
         </div>`
      : '';
    return `<div class="tbl-wrap" data-tid="${id}">${tools}
      <div class="tbl-scroll" style="${opts.height ? `max-height:${opts.height}px` : ''}"><table>
        <thead><tr>${cols.map((c) => `<th>${esc(c.t)}</th>`).join('')}</tr></thead>
        <tbody data-body="${id}">${tableBody(id)}</tbody>
      </table></div>
      <div class="tbl-more" data-morebox="${id}" hidden><button class="btn small ghost" data-more="${id}">Show more</button></div>
    </div>`;
  }

  function tableMatches(t) {
    const f = t.filter.trim().toLowerCase();
    return f ? t.rows.filter((r) => r.some((c) => String(c).toLowerCase().includes(f))) : t.rows;
  }

  function tableBody(id) {
    const t = TBL.get(id);
    const f = t.filter.trim().toLowerCase();
    const shown = tableMatches(t).slice(0, t.limit);
    if (!shown.length) return `<tr><td colspan="${t.cols.length}" class="dim">No rows match “${esc(t.filter)}”.</td></tr>`;
    return shown.map((r) => '<tr>' + t.cols.map((c, i) => {
      const v = r[i];
      const html = c.fmt ? c.fmt(v, r) : markText(v, f);
      const tip = c.cls && c.cls.includes('clip') ? ` title="${esc(v)}"` : '';
      return `<td class="${c.cls || ''}"${tip}>${html}</td>`;
    }).join('') + '</tr>').join('');
  }

  function tableChrome(id) {
    const t = TBL.get(id);
    const m = tableMatches(t).length;
    const c = $(`[data-count="${id}"]`);
    if (c) {
      let s = t.filter ? `${fmt(m)} of ${fmt(t.rows.length)}` : `${fmt(t.rows.length)} rows`;
      if (t.total > t.rows.length) s += ` · first ${fmt(t.rows.length)} of ${fmt(t.total)}`;
      c.textContent = s;
    }
    const box = $(`[data-morebox="${id}"]`);
    if (box) box.hidden = m <= t.limit;
  }

  function code(title, lines, opts = {}) {
    const id = 'cp' + (++uid);
    const arr = Array.isArray(lines) ? lines : String(lines || '').split('\n');
    COPY.set(id, arr.join('\n'));
    const body = arr.length && arr.join('').trim()
      ? arr.map((l) => `<span class="row">${opts.lang === 'nova' ? highlightNova(l).slice(0, -1) : opts.lang === 'text' ? esc(l) : highlightIR(l)}</span>`).join('')
      : '<span class="row t-c">(empty)</span>';
    return `<div class="code ${opts.plain ? 'plain' : ''}">
      <div class="code-head"><span class="t">${esc(title)}</span><button class="copy-btn" data-copy="${id}">Copy</button></div>
      <pre style="${opts.height ? `max-height:${opts.height}px` : ''}">${body}</pre></div>`;
  }

  function fold(key, title, body, aside = '', open = false) {
    const isOpen = key in state.folds ? state.folds[key] : open;
    return `<details class="fold" data-fold="${esc(key)}" ${isOpen ? 'open' : ''}>
      <summary>${esc(title)}${aside ? `<span class="aside">${esc(aside)}</span>` : ''}</summary>
      <div class="fold-body">${body}</div></details>`;
  }

  const sec = (title, aside = '') => `<div class="sec"><h3>${esc(title)}</h3>${aside ? `<span class="aside">${esc(aside)}</span>` : ''}</div>`;

  function head(eyebrow, title, lede, right = '') {
    return `<div class="v-head"><div><div class="eyebrow">${esc(eyebrow)}</div><h2 class="v-title">${esc(title)}</h2>
      ${lede ? `<p class="lede">${lede}</p>` : ''}</div>${right}</div>`;
  }

  function kpi(label, value, foot = '', cls = '') {
    return `<div class="card kpi ${cls}"><div class="lbl">${esc(label)}</div><div class="val">${value}</div>${foot ? `<div class="foot">${foot}</div>` : ''}</div>`;
  }

  function bars(items, unit = '') {
    const max = Math.max(1e-9, ...items.map((i) => i.value));
    return `<div class="bars">${items.map((i, k) => `
      <div class="bar-row"><span class="bl" title="${esc(i.label)}">${esc(i.label)}</span>
        <div class="bar-track"><div class="bar-fill ${i.dim ? 'dim' : ''}" style="width:${Math.max(1.5, (100 * i.value) / max).toFixed(1)}%;animation-delay:${k * 40}ms"></div></div>
        <span class="bv">${esc(i.text != null ? i.text : fmt(i.value) + unit)}</span></div>`).join('')}</div>`;
  }

  const badge = (text, cls = '') => `<span class="badge ${cls}">${esc(text)}</span>`;

  // ===================================================================
  //  CFG as SVG
  // ===================================================================
  function cfgSvg(cfg) {
    const blocks = cfg.blocks || [];
    const n = blocks.length;
    if (!n) return '<div class="empty">No basic blocks.</div>';
    const level = new Array(n).fill(-1);
    level[cfg.entry] = 0;
    const q = [cfg.entry];
    while (q.length) {
      const b = q.shift();
      for (const s of blocks[b].succs) if (s < n && level[s] < 0) { level[s] = level[b] + 1; q.push(s); }
    }
    const maxL = Math.max(0, ...level);
    for (let i = 0; i < n; i++) if (level[i] < 0) level[i] = maxL + 1;

    const CW = 7.15, LH = 16, HEAD = 28, PAD = 12, HGAP = 34, VGAP = 54, SIDE = 70, MAXC = 46;
    const backSet = new Set((cfg.back_edges || []).map(([a, b]) => a + '>' + b));
    const loopHeads = new Set((cfg.back_edges || []).map(([, h]) => h));
    const dims = blocks.map((b) => {
      const lines = b.lines.length ? b.lines : ['(empty)'];
      const w = Math.min(MAXC, Math.max(14, ...lines.map((l) => l.length))) * CW + PAD * 2;
      return { w: Math.max(150, w), h: HEAD + LH * lines.length + 10, lines };
    });
    const rows = {};
    blocks.forEach((b, i) => { (rows[level[i]] = rows[level[i]] || []).push(i); });
    const levels = Object.keys(rows).map(Number).sort((a, b) => a - b);
    const rowW = levels.map((l) => rows[l].reduce((s, i) => s + dims[i].w, 0) + HGAP * (rows[l].length - 1));
    const W = Math.max(...rowW) + 40 + SIDE;
    const pos = [];
    let y = 22;
    levels.forEach((l, k) => {
      let x = 20 + (Math.max(...rowW) - rowW[k]) / 2;
      const h = Math.max(...rows[l].map((i) => dims[i].h));
      rows[l].forEach((i) => { pos[i] = { x, y }; x += dims[i].w + HGAP; });
      y += h + VGAP;
    });
    const H = y - VGAP + 26;

    const edges = [];
    blocks.forEach((b, i) => b.succs.forEach((s) => {
      if (s >= n) return;
      const a = pos[i], c = pos[s], da = dims[i], dc = dims[s];
      const back = backSet.has(i + '>' + s) || level[s] <= level[i];
      if (back) {
        const x1 = a.x + da.w, y1 = a.y + da.h / 2, x2 = c.x + dc.w, y2 = c.y + 16;
        const bulge = Math.max(x1, x2) + 46;
        edges.push(`<path d="M${x1} ${y1} C${bulge} ${y1}, ${bulge} ${y2}, ${x2 + 7} ${y2}" class="e back" marker-end="url(#ah-o)"/>`);
      } else {
        const x1 = a.x + da.w / 2, y1 = a.y + da.h, x2 = c.x + dc.w / 2, y2 = c.y - 3;
        const my = (y1 + y2) / 2;
        edges.push(`<path d="M${x1} ${y1} C${x1} ${my}, ${x2} ${my}, ${x2} ${y2}" class="e" marker-end="url(#ah)"/>`);
      }
    }));

    const kw = /\b(if|goto|return|print|param|call|ifFalse)\b/g;
    const nodes = blocks.map((b, i) => {
      const { x, y: yy } = pos[i];
      const d = dims[i];
      const entry = i === cfg.entry;
      const tags = [entry ? 'entry' : '', loopHeads.has(i) ? 'loop header' : '', !b.succs.length ? 'exit' : ''].filter(Boolean);
      const lines = d.lines.map((l, k) => {
        const t = l.length > MAXC ? l.slice(0, MAXC - 1) + '…' : l;
        const body = esc(t).replace(kw, '<tspan class="kw">$1</tspan>');
        return `<text x="${x + PAD}" y="${yy + HEAD + 12 + k * LH}" class="ln">${body}</text>`;
      }).join('');
      return `<g class="blk${entry ? ' entry' : ''}${loopHeads.has(i) ? ' head' : ''}">
        <rect x="${x}" y="${yy}" width="${d.w}" height="${d.h}" rx="10" class="box"/>
        <path d="M${x} ${yy + 10} a10 10 0 0 1 10 -10 h${d.w - 20} a10 10 0 0 1 10 10 v${HEAD - 12} h${-d.w} z" class="cap"/>
        <text x="${x + PAD}" y="${yy + 18}" class="bid">B${b.id}</text>
        <text x="${x + d.w - PAD}" y="${yy + 18}" class="tag" text-anchor="end">${esc(tags.join(' · '))}</text>
        ${lines}</g>`;
    }).join('');

    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Control-flow graph">
      <defs>
        <marker id="ah" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L8,4.5 L0,9 z" fill="#5a5a66"/></marker>
        <marker id="ah-o" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L8,4.5 L0,9 z" fill="#ff7a1a"/></marker>
        <linearGradient id="cap-g" x1="0" x2="1"><stop offset="0" stop-color="#ff7a1a" stop-opacity=".26"/><stop offset="1" stop-color="#ff7a1a" stop-opacity=".04"/></linearGradient>
      </defs>
      ${edges.join('')}${nodes}</svg>`;
  }

  // ===================================================================
  //  Views
  // ===================================================================
  const PASS_SHORT = [[/local value numbering/i, 'LVN / DAG'], [/constant prop/i, 'Const prop'], [/copy prop/i, 'Copy prop'],
    [/loop-invariant/i, 'LICM'], [/strength/i, 'Strength'], [/dead-code/i, 'DCE'], [/unreachable/i, 'Unreachable'], [/jump/i, 'Jumps']];

  function passLabel(name) {
    const hit = PASS_SHORT.find(([re]) => re.test(name));
    const base = hit ? hit[1] : name;
    return /\(2nd|second/i.test(name) ? base + ' ²' : base;
  }

  const fnData = () => {
    const d = state.data;
    if (!d || !d.functions.length) return null;
    return d.functions.find((f) => f.name === state.fn) || d.functions[0];
  };

  function needsCompiled(title) {
    const d = state.data;
    const errs = d ? d.summary.errors : 0;
    return `<div class="card" style="text-align:center;padding:42px 20px">
      <div class="eyebrow">${esc(title)}</div>
      <h3 style="margin:6px 0 8px;font-size:18px">Nothing to show yet</h3>
      <p class="note" style="margin:0 auto 16px">This phase runs only after the front end accepts the program.
      ${errs ? `It currently has <b style="color:var(--bad)">${plural(errs, 'error')}</b>.` : ''}</p>
      ${errs ? '<button class="btn small" data-dock-open="problems">Show problems</button>' : ''}</div>`;
  }

  const VIEWS = {
    overview() {
      const d = state.data;
      const s = d.summary;
      const run = d.run;
      const ok = d.ok && d.verify_ok && run && !run.error;
      const stopped = !d.ok;
      const title = stopped ? `${plural(s.errors, 'error')} stopped compilation`
        : !d.verify_ok ? 'The verifier rejected the bytecode'
          : run && run.error ? 'Compiled and verified - stopped at run time'
            : 'Compiled, verified and executed';
      const steps = stopped
        ? `The front end reported problems in <b>${[...new Set(d.diagnostics.filter((e) => e.severity === 'error').map((e) => e.phase))].join(', ') || 'the source'}</b>. Every phase recovered and kept going, so you see all of them at once.`
        : `<b>${fmt(s.tokens)}</b> tokens → <b>${fmt(s.ir_before)}</b> IR → <b>${fmt(s.ir_after)}</b> optimised → <b>${fmt(d.bytecode ? d.bytecode.opt_total : 0)}</b> bytecode · ${esc(d.elapsed_ms)} ms`;
      const outLines = run ? (run.output.length ? run.output : ['(no output)']) : d.diagnostics.slice(0, 6).map((e) => `${e.phase} ${e.line ? e.line + ':' + e.col : ''}  ${e.message}`);
      const badges = [
        d.verifier.length ? badge(d.verify_ok ? 'Verifier passed' : 'Verifier rejected', d.verify_ok ? 'ok' : 'bad') : '',
        run ? badge(run.agree ? 'All 3 back-ends agree' : 'Back-ends disagree', run.agree ? 'ok' : 'bad') : '',
        badge(d.optimise ? 'Optimiser on' : 'Optimiser off', d.optimise ? 'hot' : ''),
        s.warnings ? badge(plural(s.warnings, 'warning'), 'warn') : '',
      ].join(' ');

      let h = `<div class="hero ${ok || (!stopped && d.verify_ok) ? '' : 'bad'}">
        <div class="hero-row"><div class="hero-status"><div class="hero-icon">${ok ? ICON.check : stopped || !d.verify_ok ? ICON.cross : ICON.warn}</div>
          <div><h2>${esc(title)}</h2><div class="steps">${steps}</div></div></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">${badges}</div></div>
        <div class="hero-out">${outLines.map((l) => `<div class="out-line ${run ? '' : 'err'}"><span class="pfx">›</span><span>${esc(l)}</span></div>`).join('')}
          ${run && run.error ? `<div class="out-line err"><span class="pfx">!</span><span>${esc(run.error)}</span></div>` : ''}</div></div>`;

      const lx = d.lexical ? d.lexical.stats : null;
      const bc = d.bytecode;
      h += '<div class="grid kpis">';
      h += kpi('Tokens', fmt(s.tokens), lx ? `${lx.dfa_states_after_min} DFA states · ${lx.token_patterns} patterns` : '');
      h += kpi('Symbols', fmt(s.symbols), `${plural(s.functions, 'function')} compiled`);
      h += kpi('IR instructions', s.ir_before ? `${fmt(s.ir_before)}<span class="arrow">→</span>${fmt(s.ir_after)}` : '—',
        s.ir_before ? `<span style="color:var(--orange-2)">${pct(s.ir_before, s.ir_after)}% smaller</span> after ${d.optimise ? '8 passes' : 'no passes'}` : 'not generated');
      h += kpi('Bytecode', bc ? `${fmt(bc.raw_total)}<span class="arrow">→</span>${fmt(bc.opt_total)}` : '—', bc ? `${pct(bc.raw_total, bc.opt_total)}% fewer instructions` : '');
      if (run) {
        const raw = run.raw ? run.raw.steps : 0;
        h += kpi('VM steps', fmt(run.steps), raw ? `vs ${fmt(raw)} unoptimised · ${pct(raw, run.steps)}% fewer` : '');
        h += kpi('Call depth', fmt(run.max_frames), `operand stack peaked at ${run.max_stack}`);
      }
      h += kpi('Verifier', d.verifier.length ? (d.verify_ok ? 'PASS' : 'FAIL') : '—',
        d.verifier.length ? `${d.verifier.reduce((a, v) => a + v.checks.length, 0)} properties proved` : 'not reached',
        d.verifier.length ? (d.verify_ok ? 'ok' : 'bad') : '');
      h += kpi('Loops · φ', `${fmt(s.loops)}<small>${s.loops === 1 ? 'loop' : 'loops'}</small> ${fmt(s.phis)}<small>φ</small>`, `${plural(s.blocks, 'basic block')} · ${plural(s.spills, 'spill')}`);
      h += '</div>';

      h += '<div class="grid two" style="margin-top:4px">';
      const tm = d.timings.map((t) => ({ label: t.phase.replace(/^[\d-]+\.\s*/, ''), value: t.ms, text: t.ms < 1 ? t.ms.toFixed(2) + ' ms' : t.ms.toFixed(1) + ' ms' }));
      h += `<div class="card"><div class="card-title"><h4>Time per phase</h4><span class="sub">${esc(d.elapsed_ms)} ms end to end</span></div>${tm.length ? bars(tm) : '<div class="empty">No timings.</div>'}</div>`;
      if (run) {
        const rows = [
          ['Stack VM · optimised', run.output.join(' | ') || '(none)', run.steps, run.error ? 'stopped' : 'ok'],
          ['Stack VM · unoptimised', run.raw ? run.raw.output.join(' | ') || '(none)' : '-', run.raw ? run.raw.steps : '-', run.raw && run.raw.error ? 'stopped' : 'ok'],
          ['Register machine', run.reg ? run.reg.output.join(' | ') || '(none)' : '-', run.reg ? run.reg.steps : '-', run.reg && run.reg.error ? 'stopped' : 'ok'],
        ];
        h += `<div class="card"><div class="card-title"><h4>Three independent back-ends</h4>${badge(run.agree ? 'identical output' : 'outputs differ', run.agree ? 'ok' : 'bad')}</div>
          <p class="note" style="margin:0 0 12px">The same program runs on unoptimised bytecode, optimised bytecode, and the separately generated register code. Any optimisation that changed the meaning would show up here.</p>
          ${table('ov-backends', [{ t: 'Back-end', cls: 'nowrap' }, { t: 'Output', cls: 'mono clip' }, { t: 'Steps', cls: 'num' }, { t: '', cls: 'nowrap', fmt: (v) => `<span class="${v === 'ok' ? 'pass' : 'fail'}">${v === 'ok' ? '✓' : '■'} ${esc(v)}</span>` }], rows, { search: false })}</div>`;
      } else {
        h += `<div class="card"><div class="card-title"><h4>Diagnostics</h4>${badge(plural(d.diagnostics.length, 'issue'), 'bad')}</div>
          ${table('ov-diags', [{ t: 'Phase', fmt: (v) => `<span class="tag">${esc(v)}</span>` }, { t: 'Where', cls: 'mono dim' }, { t: 'Message' }],
          d.diagnostics.map((e) => [e.phase, e.line ? `${e.line}:${e.col}` : '-', e.message]), { search: false })}</div>`;
      }
      h += '</div>';
      return h;
    },

    lexical() {
      const d = state.data;
      const lx = d.lexical;
      if (!lx) return needsCompiled('Module 1');
      const st = lx.stats;
      const g = state.grammar;
      let h = head('Module 1 · Lexical analysis', 'Regular expressions → one minimised DFA',
        'Each token is an extended regular expression. They are combined into one syntax tree, <code class="inline">followpos</code> is computed on it - the <b>direct method</b>, no NFA - and the DFA is minimised. Python’s <code class="inline">re</code> is never imported.');
      h += `<div class="card"><div class="flowline">
        <span class="s"><b>${st.token_patterns}</b> patterns</span><span class="arr">→</span>
        <span class="s"><b>${st.positions}</b> positions</span><span class="arr">→</span>
        <span class="s"><b>${st.dfa_states_before_min}</b> DFA states</span><span class="arr">→</span>
        <span class="s"><b>${st.dfa_states_after_min}</b> after minimisation</span><span class="arr">·</span>
        <span class="s"><b>${st.symbol_classes}</b> symbol classes</span></div></div>`;
      const toks = lx.tokens.rows;
      h += sec('Token stream', `${fmt(lx.tokens.total)} tokens`);
      h += `<div class="card"><div class="tokstream">${toks.slice(0, 700).map((t) => {
        const ty = t[0];
        const kw = KEYWORDS.has(String(t[1]));
        const cls = kw ? 'kw' : ty === 'NUMBER' ? 'num' : ty === 'STRING' ? 'str' : ty === 'IDENT' ? '' : 'op';
        return `<span class="tok ${cls}" title="${esc(ty)} at ${t[2]}:${t[3]}">${esc(t[1])}${kw ? '' : `<i>${esc(ty)}</i>`}</span>`;
      }).join('')}${toks.length > 700 ? `<span class="tok op">+${fmt(toks.length - 700)} more</span>` : ''}</div></div>`;
      h += sec('Tokens');
      h += table('lex-tokens', [
        { t: 'Token', fmt: (v, r) => `<span class="tag ${KEYWORDS.has(String(r[1])) ? 'kw' : ''}">${esc(v)}</span>` },
        { t: 'Lexeme', cls: 'mono' }, { t: 'Line', cls: 'num' }, { t: 'Col', cls: 'num' }, { t: 'Attribute', cls: 'dim' }], lx.tokens, { noun: 'tokens' });
      if (g) h += fold('lex-specs', 'Token specifications', table('lex-specs-t', [{ t: '#', cls: 'num' }, { t: 'Token', cls: 'mono' }, { t: 'Regular expression', cls: 'mono' }], g.token_specs, { noun: 'patterns' }), `${g.token_specs.total} patterns`);
      h += fold('lex-followpos', 'followpos table (the direct method)',
        '<p class="note">followpos(i) is the set of positions that may come straight after position i. DFA states are sets of positions, and this table generates them.</p>' +
        table('lex-fp', [{ t: 'Position', cls: 'num' }, { t: 'Symbol', cls: 'mono' }, { t: 'followpos', cls: 'mono' }], lx.followpos, { noun: 'positions' }), `${lx.followpos.total} positions`);
      h += fold('lex-dfa', 'The minimised DFA', table('lex-dfa-t', [{ t: 'State', cls: 'mono' }, { t: 'Accepts', fmt: (v) => v ? `<span class="tag kw">${esc(v)}</span>` : '<span class="dim">-</span>' }, { t: 'Transitions', cls: 'mono dim' }], lx.dfa, { noun: 'states' }), `${lx.dfa.total} states`);
      return h;
    },

    syntax() {
      const d = state.data;
      const sx = d.syntax;
      const g = state.grammar;
      let h = head('Module 2 · Syntax analysis', 'One grammar, four parsers',
        'A hand-written recursive-descent parser builds the AST; SLR, CLR and LALR table-driven parsers independently re-parse the same tokens. If they disagreed, one of them would be wrong.',
        badge(sx.lr_ok ? 'LALR accepted' : 'LALR rejected', sx.lr_ok ? 'ok' : 'bad'));
      if (sx.tables.length) {
        const maxS = Math.max(...sx.tables.map((t) => t.states));
        h += `<div class="grid three">${sx.tables.map((t) => `<div class="card kpi ${t.kind === 'LALR' ? '' : ''}">
          <div class="lbl">${esc(t.kind)} ${t.kind === 'LALR' ? '<span class="badge hot plain" style="margin-left:6px;font-size:10px">used</span>' : ''}</div>
          <div class="val">${fmt(t.states)}<small>states</small></div>
          <div class="bar-track" style="margin:10px 0 8px"><div class="bar-fill ${t.kind === 'LALR' ? '' : 'dim'}" style="width:${(100 * t.states / maxS).toFixed(1)}%"></div></div>
          <div class="foot">${fmt(t.entries)} entries · <span style="color:${t.conflicts ? 'var(--bad)' : 'var(--ok)'}">${t.conflicts} conflicts</span></div></div>`).join('')}</div>
          <p class="note">LALR has SLR’s state count with CLR’s power - which is why every real parser generator emits LALR. Measured here, not asserted.</p>`;
      }
      h += sec('Bottom-up parse of this program', `${fmt(sx.lr_trace.total)} steps`);
      if (!sx.lr_ok) h += `<div class="notice bad"><span class="grow"><b>Rejected:</b> ${esc(sx.lr_msg)}</span></div>`;
      h += table('syn-lr', [{ t: 'Step', cls: 'num' }, { t: 'State stack', cls: 'mono dim clip' }, { t: 'Symbols', cls: 'mono clip' }, { t: 'Input', cls: 'mono dim clip' },
        { t: 'Action', fmt: (v) => { const s = String(v); const c = s.startsWith('shift') ? 'kw' : ''; return `<span class="tag ${c}">${esc(s)}</span>`; } }], sx.lr_trace, { noun: 'steps', limit: 120 });
      if (sx.rd_trace.rows.length) h += fold('syn-rd', 'Top-down derivation (recursive descent)', code('recursive descent', sx.rd_trace.rows, { lang: 'text', plain: true }), `${fmt(sx.rd_trace.total)} calls`);
      if (g) {
        h += sec('The grammar', `${g.productions} productions · ${g.terminals} terminals · ${g.nonterminals} non-terminals`);
        h += fold('syn-grammar', 'Productions', code('nova grammar', g.text, { lang: 'text' }), '', false);
        h += fold('syn-ff', 'FIRST and FOLLOW sets', table('syn-ff-t', [{ t: 'Non-terminal', cls: 'mono' }, { t: 'FIRST', cls: 'mono' }, { t: 'FOLLOW', cls: 'mono' }], g.first_follow, { noun: 'non-terminals' }));
        h += fold('syn-ll1', 'Why the grammar is not LL(1)',
          `<p class="note">The LL(1) table has <b style="color:var(--orange-2)">${g.ll1_conflicts.total}</b> multiply-defined entries, because the grammar is left-recursive for natural left-associative precedence. After left-recursion elimination <b>${g.ll1_conflicts_after}</b> remain.</p>` +
          code('LL(1) conflicts', g.ll1_conflicts.rows, { lang: 'text', plain: true, height: 260 }) +
          code('left-recursion elimination', g.left_recursion_log, { lang: 'text', plain: true, height: 300 }), `${g.ll1_conflicts.total} conflicts`);
        h += fold('syn-amb', 'A grammar that does conflict',
          '<p class="note">Written ambiguously, with no precedence, the expression grammar produces genuine shift/reduce conflicts:</p>' +
          code('ambiguous grammar', g.ambiguous.text, { lang: 'text' }) +
          table('syn-amb-t', [{ t: 'State', cls: 'num' }, { t: 'Lookahead', cls: 'mono' }, { t: 'Kind', fmt: (v) => `<span class="tag kw">${esc(v)}</span>` }, { t: 'Explanation' }], g.ambiguous.conflicts, { search: false }),
          `${g.ambiguous.conflicts.total} conflicts`);
      }
      return h;
    },

    semantic() {
      const d = state.data;
      const sm = d.semantic;
      if (!sm) return needsCompiled('Module 3');
      let h = head('Module 3 · Semantic analysis', 'Scopes, types and an L-attributed SDD',
        '<b>Inherited</b> attributes flow down (scope, depth, expected type); <b>synthesised</b> attributes flow up (the type of each expression). No attribute needs a sibling to its right, so one left-to-right pass suffices.');
      h += sec('Symbol table', `${sm.symbols.total} entries`);
      h += table('sem-sym', [{ t: 'Name', cls: 'mono' }, { t: 'Kind', fmt: (v) => `<span class="tag ${v === 'func' ? 'kw' : ''}">${esc(v)}</span>` }, { t: 'Type', cls: 'mono' },
        { t: 'Scope', cls: 'mono dim' }, { t: 'Depth', cls: 'num' }, { t: 'Slot', cls: 'num' }, { t: 'Line', cls: 'num' },
        { t: 'Used', fmt: (v) => v === 'yes' ? '<span class="pass">yes</span>' : `<span class="fail">${esc(v)}</span>` }], sm.symbols, { noun: 'symbols' });
      h += sec('Attribute flow, construct by construct', `${sm.sdd.total} events`);
      h += table('sem-sdd', [{ t: 'Production / construct', cls: 'mono' }, { t: 'Inherited ↓', cls: 'dim' }, { t: 'Synthesised ↑', cls: 'mono' }], sm.sdd, { noun: 'events' });
      h += sec('Annotated syntax tree', 'the type after each colon is the synthesised attribute');
      h += code('ast', sm.ast, { lang: 'ir', height: 620 });
      return h;
    },

    ir() {
      const f = fnData();
      if (!f) return needsCompiled('Module 4');
      const d = state.data;
      let h = head('Module 4 · Intermediate code', `${f.name}(${f.params.join(', ')})`,
        'Three-address code: at most one operator per instruction. Booleans compile to jumping code, so <code class="inline">a and b</code> never evaluates <code class="inline">b</code> when <code class="inline">a</code> is false. Unknown jump targets are left blank and <b>backpatched</b>.',
        badge(plural(f.ir.length, 'instruction'), 'hot'));
      h += code(`three-address code · ${f.name}`, f.ir, { height: 640 });
      if (d.backpatch.length) h += fold('ir-bp', 'Every backpatch this compilation performed', code('backpatching', d.backpatch, { plain: true }), `${d.backpatch.length} operations`);
      return h;
    },

    optimiser() {
      const f = fnData();
      if (!f) return needsCompiled('Module 5');
      const d = state.data;
      let h = head('Module 5 · Optimisation', `${f.name}: ${f.n_before} → ${f.n_after} instructions`,
        'The code is cut into basic blocks and joined into a flow graph. Every pass transforms that graph and reports what it removed.',
        `<div style="display:flex;gap:8px">${badge(`${pct(f.n_before, f.n_after)}% smaller`, 'hot')}</div>`);
      if (!d.optimise) {
        h += '<div class="notice"><span class="grow">The optimiser is <b>switched off</b>, so the graph below is exactly what the code generator received.</span><button class="btn small" data-action="optimise-on">Turn it on</button></div>';
      }
      if (f.passes.length) {
        const max = Math.max(f.n_before, ...f.passes.map((p) => Math.max(p.before, p.after)), 1);
        const PLOT = 120;
        h += `<div class="card"><div class="card-title"><h4>Instruction count, pass by pass</h4><span class="sub">orange = the pass changed the code · hatched = removed</span></div>
          <div class="wf">${[{ name: 'Input', before: f.n_before, after: f.n_before, removed: 0 }, ...f.passes].map((p, k) => {
            const cut = p.removed > 0 ? Math.round((PLOT * p.removed) / max) : 0;
            return `<div class="wf-col" title="${esc(p.name)}: ${p.before} → ${p.after}${p.removed < 0 ? ` (adds ${-p.removed})` : ''}">
              <span class="wf-n">${p.after}</span>
              <div class="wf-plot" style="height:${PLOT}px">
                ${cut ? `<div class="wf-cut" style="height:${cut}px"></div>` : ''}
                <div class="wf-bar ${p.removed ? '' : 'same'}" style="height:${Math.max(2, Math.round((PLOT * p.after) / max))}px;animation-delay:${k * 25}ms"></div></div>
              <span class="wf-l">${esc(passLabel(p.name))}</span></div>`;
          }).join('')}</div></div>`;
        h += table('opt-passes-' + f.name, [{ t: 'Pass', cls: '' }, { t: 'Before', cls: 'num' }, { t: 'After', cls: 'num' },
          { t: 'Change', fmt: (v) => +v > 0 ? `<span style="color:var(--orange-2);font-family:var(--mono)">−${esc(v)}</span>` : +v < 0 ? `<span style="color:var(--warn);font-family:var(--mono)">+${esc(-v)}</span>` : '<span class="dim">0</span>' }, { t: 'What it did', cls: 'dim' }],
          f.passes.map((p) => [p.name, p.before, p.after, p.removed, p.detail]), { search: false });
      }
      const g = state.cfgMode === 'before' ? f.cfg_before : f.cfg_after;
      h += `<div class="sec"><h3>Control-flow graph</h3><span class="aside">${g.blocks.length} blocks · ${g.instructions} instructions · dashed orange = back edge</span></div>
        <div style="margin:-2px 0 10px"><div class="seg"><button data-cfg="before" class="${state.cfgMode === 'before' ? 'on' : ''}">Before</button><button data-cfg="after" class="${state.cfgMode === 'after' ? 'on' : ''}">After</button></div></div>
        <div class="cfg-box">${cfgSvg(g)}</div>`;
      if (f.dag.length) {
        h += sec('DAG of each basic block', 'two instructions on one node are the same computation');
        h += code('dag / value numbering', f.dag.flatMap((b) => [`B${b.block}:`, ...b.nodes.map((n) => '   ' + n)]), { plain: true });
      }
      if (f.opt_notes.length) h += fold('opt-notes-' + f.name, 'Optimiser notes', code('notes', f.opt_notes, { lang: 'text', plain: true }), `${f.opt_notes.length}`);
      return h;
    },

    dataflow() {
      const f = fnData();
      if (!f) return needsCompiled('Module 5');
      let h = head('Module 5 · Data-flow analysis', `Four analyses over ${f.name}`,
        'Each analysis starts from an initial guess and applies its transfer function round after round until nothing changes - the fixed point. The rounds below are the real ones.');
      for (const a of f.dataflow) {
        h += `<div class="card"><div class="card-title"><h4>${esc(a.name)}</h4><div style="display:flex;gap:6px;flex-wrap:wrap">
          ${badge(a.direction, 'plain')} ${badge('meet ' + a.meet, 'plain')} ${badge(`fixed point in ${plural(a.rounds, 'round')}`, 'hot')}</div></div>
          ${table(`df-${f.name}-${a.name}`, [{ t: 'Block', cls: 'mono' }, { t: 'IN', cls: 'mono' }, { t: 'OUT', cls: 'mono' }], a.table, { search: false, height: 340 })}
          ${a.convergence.rows.length && a.rounds > 1 ? fold(`dfc-${f.name}-${a.name}`, 'Convergence, round by round',
          table(`dfc-t-${f.name}-${a.name}`, [{ t: 'Round', cls: 'mono dim' }, { t: 'Block', cls: 'mono' }, { t: 'IN', cls: 'mono' }, { t: 'OUT', cls: 'mono' }], a.convergence, { search: false, height: 340 })) : ''}</div>`;
      }
      return h;
    },

    codegen() {
      const f = fnData();
      if (!f) return needsCompiled('Module 6');
      let h = head('Module 6 · Code generation', `${f.name}: ${f.target.length} target instructions`,
        'Registers are scarce, so the generator computes <b>next-use</b> information and, when every register is full, spills the value needed furthest in the future - Belady’s rule applied to registers.',
        `<div style="display:flex;gap:8px">${badge(plural(f.spills, 'spill'), f.spills ? 'warn' : 'ok')}${badge('4 registers', 'plain')}</div>`);
      h += '<div class="grid two">';
      h += `<div class="card"><div class="card-title"><h4>Activation record</h4><span class="sub">what a call pushes on the run-time stack</span></div>
        <div class="frame-stack">${f.frame.rows.map((r) => `<div class="slot ${+r[0] < 0 ? 'sys' : ''}"><span class="off">${esc(r[0])}</span><span>${esc(r[1])}</span><span class="kind">${esc(r[2])}</span></div>`).join('')}</div></div>`;
      h += `<div>${code('target code · register machine', f.target, { height: 470 })}</div>`;
      h += '</div>';
      h += sec('Next-use information', `${f.nextuse.total} instructions`);
      h += table('cg-nu-' + f.name, [{ t: 'At', cls: 'mono' }, { t: 'Instruction', cls: 'mono' }, { t: 'Next use of each name', cls: 'mono dim' }, { t: 'Live after', cls: 'mono' }], f.nextuse, { noun: 'instructions' });
      h += sec('Register allocation decisions', 'register and address descriptors after each step');
      h += table('cg-dec-' + f.name, [{ t: 'At', cls: 'mono' }, { t: 'Decision', cls: 'mono' }, { t: 'Register descriptor', cls: 'mono dim' }, { t: 'Address descriptor', cls: 'mono dim' }], f.decisions, { noun: 'decisions' });
      return h;
    },

    ssa() {
      const f = fnData();
      if (!f) return needsCompiled('Module 7');
      const d = state.data;
      let h = head('Module 7 · SSA & parallelism', `${f.name} in static single assignment form`,
        'Every name is written exactly once. Where control flow merges, a φ-function picks the version that arrived; φ-functions go on the <b>dominance frontier</b> of each definition.',
        badge(plural(f.phis, 'φ-function'), 'hot'));
      h += '<div class="grid two">';
      h += `<div>${table('ssa-dom-' + f.name, [{ t: 'Block', cls: 'mono' }, { t: 'Immediate dominator', cls: 'mono' }, { t: 'Dominance frontier', cls: 'mono' }], f.dominators, { search: false, height: 420, title: 'Dominators' })}</div>`;
      h += `<div>${code('ssa form', f.ssa.join('\n').split('\n'), { height: 420 })}</div>`;
      h += '</div>';
      if (f.ssa_notes.length) h += `<p class="note">${f.ssa_notes.map(esc).join('<br>')}</p>`;
      h += sec('Loop dependence analysis', 'can the iterations run at the same time?');
      if (!f.loops.length) h += '<div class="card empty">This function has no loops.</div>';
      for (const l of f.loops) {
        const cls = l.verdict.startsWith('SEQ') ? 'bad' : l.verdict.includes('REDUCTION') ? 'warn' : 'ok';
        h += `<div class="card loop-card"><div class="card-title"><h4>Loop headed by B${l.header}</h4>${badge(l.verdict, cls)}</div>
          <p class="note" style="margin:0">${esc(l.reason)}</p>
          <dl class="kv"><dt>Blocks</dt><dd>${esc(l.blocks.map((b) => 'B' + b).join(', '))}</dd>
            <dt>Induction variables</dt><dd>${esc(l.induction.join(', ') || '-')}</dd>
            <dt>Carried dependences</dt><dd>${esc(l.carried.join(', ') || 'none')}</dd>
            <dt>Reductions</dt><dd>${esc(l.reductions.join(', ') || '-')}</dd>
            ${l.privatisable.length ? `<dt>Privatisable</dt><dd>${esc(l.privatisable.join(', '))}</dd>` : ''}</dl>
          ${l.suggestions.length ? `<ul class="sugg">${l.suggestions.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}</div>`;
      }
      h += sec('LLVM IR back-end', 'whole program · plain text, no LLVM installation needed');
      h += fold('ssa-llvm', 'Textual LLVM IR', code('llvm ir', d.llvm, { height: 600 }), `${d.llvm.split('\n').length} lines`);
      return h;
    },

    verify() {
      const d = state.data;
      if (!d.verifier.length) return needsCompiled('Module 8');
      const bc = d.bytecode;
      let h = head('Module 8 · Bytecode & verification', d.verify_ok ? 'Proved safe before it ran' : 'Rejected before it could run',
        'The compiler does not trust its own output. The verifier walks the bytecode with <b>types instead of values</b> and proves each property - the argument the JVM verifier, WebAssembly validation and eBPF make about untrusted code.',
        badge(d.verify_ok ? 'Verified' : 'Rejected', d.verify_ok ? 'ok' : 'bad'));
      h += '<div class="grid two">';
      for (const r of d.verifier) {
        h += `<div class="card"><div class="card-title"><h4><code class="inline">${esc(r.function)}</code></h4>
          <div style="display:flex;gap:6px">${badge('max stack ' + r.max_stack, 'plain')}${badge(r.ok ? 'VERIFIED' : 'REJECTED', r.ok ? 'ok' : 'bad')}</div></div>
          <div class="checks">${r.checks.map((c) => `<div class="check ${c[1] === 'PASS' ? '' : 'fail'}"><span class="ci">${c[1] === 'PASS' ? ICON.check : ICON.cross}</span>
            <span class="cp">${esc(String(c[0]).replace(/^\d+\.\s*/, ''))}</span><span class="cd">${esc(c[2])}</span></div>`).join('')}</div>
          ${r.errors.length ? code('verifier errors', r.errors, { lang: 'text', plain: true }) : ''}</div>`;
      }
      h += '</div>';
      if (bc) {
        h += sec('The bytecode', `${fmt(bc.raw_total)} → ${fmt(bc.opt_total)} instructions`);
        h += code('stack bytecode', bc.listing, { height: 620 });
        if (bc.peephole.length) h += fold('bc-peep', 'Peephole optimisations on the final bytecode', code('peephole', bc.peephole, { lang: 'text', plain: true }), `${bc.peephole.length}`);
      }
      return h;
    },

    run() {
      const d = state.data;
      const r = d.run;
      if (!r) return needsCompiled('Execution');
      const budget = /instruction budget/.test(r.error || '');
      let h = head('Execution · sandboxed VM', r.error ? 'Stopped by the sandbox' : 'Program output',
        'Verified bytecode runs on a stack machine with real activation records and hard limits on instructions, call depth and stack depth - so a runaway program is reported, not left hanging.');
      if (budget && d.max_steps < 1e6) {
        h += `<div class="notice"><span class="grow">Live preview gives each run a <b>${fmt(d.max_steps)}</b>-instruction budget. Press <b>Run</b> for the full 2,000,000.</span><button class="btn small primary" data-action="run">Run with full budget</button></div>`;
      }
      h += `<div class="card"><div class="card-title"><h4>Output</h4>${badge(r.agree ? 'register machine agrees' : 'register machine differs', r.agree ? 'ok' : 'bad')}</div>
        <div class="hero-out" style="margin:0;max-height:260px">${(r.output.length ? r.output : ['(no output)']).map((l) => `<div class="out-line"><span class="pfx">›</span><span>${esc(l)}</span></div>`).join('')}
        ${r.error ? `<div class="out-line err"><span class="pfx">!</span><span>${esc(r.error)}</span></div>` : ''}</div></div>`;
      h += '<div class="grid kpis">';
      h += kpi('Instructions executed', fmt(r.steps), r.raw ? `${fmt(r.raw.steps)} without the optimiser` : '');
      h += kpi('Register machine', r.reg ? fmt(r.reg.steps) : '—', 'steps on the Module 6 target');
      h += kpi('Deepest call stack', fmt(r.max_frames), 'activation records at once');
      h += kpi('Deepest operand stack', fmt(r.max_stack), 'values on one frame');
      h += '</div>';
      if (r.frames.length) {
        const frames = r.frames.slice().reverse().map((s) => {
          const m = /^(\S+)\s+pc=(-?\d+)\s+link->(-?\d+)\s+ret->(-?\d+)\s+\[(.*)\]$/.exec(s.trim());
          return m ? `<div class="ar-frame"><span class="fname">${esc(m[1])}</span> <span class="fmeta">pc=${m[2]} · control link → ${m[3]} · return → ${m[4]}</span><div class="fvars">${esc(m[5] || '—')}</div></div>`
            : `<div class="ar-frame">${esc(s)}</div>`;
        }).join('');
        h += sec('Activation-record stack at its deepest', 'top of the stack first');
        h += `<div class="frame-stack" style="margin-bottom:14px">${frames}</div>`;
      }
      h += sec('Execution trace', `first ${fmt(r.trace.total)} steps`);
      h += table('run-trace', [{ t: 'Step', cls: 'num' }, { t: 'Function', cls: 'mono' }, { t: 'pc', cls: 'num' }, { t: 'Instruction', fmt: (v) => `<span class="mono">${highlightIR(String(v))}</span>` },
        { t: 'Operand stack', cls: 'mono dim' }, { t: 'Depth', cls: 'num' }], r.trace, { noun: 'steps', limit: 120 });
      return h;
    },

    security() {
      let h = head('Module 8 · Security lab', 'Hostile bytecode vs. the verifier',
        'A verifier nobody ever defeats is indistinguishable from one that does nothing. These programs are written by hand to be malicious - the kind of thing an attacker hands a VM directly.');
      const a = state.attacks;
      if (!a) {
        loadAttacks();
        return h + '<div class="card"><div class="skeleton"></div><div class="skeleton" style="width:70%"></div><div class="skeleton" style="width:85%"></div></div>';
      }
      const blocked = a.filter((x) => x.blocked).length;
      const stat = a.filter((x) => x.stopped_by === 'static verifier').length;
      h += '<div class="grid kpis">';
      h += kpi('Attacks blocked', `${blocked}<small>of ${a.length}</small>`, '', blocked === a.length ? 'ok' : 'bad');
      h += kpi('Stopped statically', fmt(stat), 'rejected before running');
      h += kpi('Stopped at run time', fmt(a.length - stat - (a.length - blocked)), 'type-safe but hostile');
      h += '</div>';
      a.forEach((x, i) => {
        const by = x.stopped_by;
        h += `<div class="card attack"><div class="num">${String(i + 1).padStart(2, '0')}</div><div>
          <div class="card-title" style="margin-bottom:6px"><h4>${esc(x.attack)}</h4>${badge(x.blocked ? 'Blocked by ' + by : 'Got through', x.blocked ? (by === 'static verifier' ? 'ok' : 'hot') : 'bad')}</div>
          <p>${esc(x.why)}</p><pre>${esc(String(x.detail).replace(/\n\s+/g, '\n'))}</pre></div></div>`;
      });
      return h;
    },

    metrics() {
      const d = state.data;
      let h = head('Measurements', 'Numbers, not claims', 'Everything below was produced by this compilation.');
      h += table('metrics', [{ t: 'Module', fmt: (v) => `<span class="tag kw">${esc(v)}</span>` }, { t: 'Measurement' }, { t: 'Value', cls: 'mono', fmt: (v) => `<span style="color:var(--orange-3)">${esc(v)}</span>` }], d.metrics, { noun: 'measurements', limit: 400 });
      h += sec('Phase timings');
      h += table('timings', [{ t: 'Phase' }, { t: 'Milliseconds', cls: 'num' }], d.timings.map((t) => [t.phase, t.ms.toFixed(3)]), { search: false });
      return h;
    },
  };

  // ===================================================================
  //  Rendering
  // ===================================================================
  function stageStatus(d, s) {
    const err = (ph) => d.diagnostics.some((e) => e.phase === ph && e.severity === 'error');
    const warn = (ph) => d.diagnostics.some((e) => e.phase === ph && e.severity === 'warning');
    switch (s.tab) {
      case 'lexical': return err('Lexical') ? 'fail' : 'done';
      case 'syntax': return err('Syntax') || !d.syntax.lr_ok ? 'fail' : 'done';
      case 'semantic': return !d.semantic ? 'skip' : err('Semantic') ? 'fail' : warn('Semantic') ? 'warn' : 'done';
      case 'optimiser': return !d.functions.length || !d.optimise ? 'skip' : 'done';
      case 'ir': case 'codegen': case 'ssa': return d.functions.length ? 'done' : 'skip';
      case 'verify': return !d.verifier.length ? 'skip' : d.verify_ok ? 'done' : 'fail';
      case 'run': return !d.run ? 'skip' : d.run.error ? 'fail' : 'done';
      default: return 'skip';
    }
  }

  function renderRail() {
    const d = state.data;
    const timing = {};
    if (d) d.timings.forEach((t) => { timing[t.phase] = t.ms; });
    $('#rail').innerHTML = STAGES.map((s, i) => {
      const st = d ? stageStatus(d, s) : 'skip';
      const ms = timing[s.timing];
      let label = '—';
      if (d && s.tab === 'optimiser' && !d.optimise) label = 'switched off';
      else if (s.shared && ms != null) label = 'timed with 5';
      else if (ms != null) label = (ms < 1 ? ms.toFixed(2) : ms.toFixed(1)) + ' ms';
      const icon = st === 'done' ? ICON.check : st === 'fail' ? ICON.cross : st === 'warn' ? ICON.warn : String(i + 1);
      return `<button class="stage ${st} ${state.tab === s.tab ? 'on' : ''}" data-tab="${s.tab}" title="${esc(s.timing)}">
        <span class="node">${icon}</span><span class="meta"><span class="name">${esc(s.name)}</span><span class="ms">${esc(label)}</span></span></button>`;
    }).join('');
  }

  function tabFlag(d, id) {
    if (!d) return '';
    const m = { lexical: 'Lexical', syntax: 'Syntax', semantic: 'Semantic' }[id];
    if (m) {
      if (d.diagnostics.some((e) => e.phase === m && e.severity === 'error')) return '<span class="tdot"></span>';
      if (d.diagnostics.some((e) => e.phase === m)) return '<span class="tdot warn"></span>';
    }
    if (id === 'verify' && d.verifier.length && !d.verify_ok) return '<span class="tdot"></span>';
    if (id === 'run' && d.run && d.run.error) return '<span class="tdot warn"></span>';
    return '';
  }

  function renderTabs() {
    $('#tabs').innerHTML = TABS.map((t) => `<button class="tab ${state.tab === t.id ? 'on' : ''}" role="tab" aria-selected="${state.tab === t.id}" data-tab="${t.id}">
      ${t.num ? `<span class="num">${t.num}</span>` : ''}${esc(t.label)}${tabFlag(state.data, t.id)}</button>`).join('');
    // keep the active tab in view by scrolling the strip only - scrollIntoView
    // would also scroll the page when the panes are stacked on a phone
    const bar = $('#tabs');
    const on = $('#tabs .tab.on');
    if (on) {
      const l = on.offsetLeft;
      const r = l + on.offsetWidth;
      if (l < bar.scrollLeft) bar.scrollLeft = l - 12;
      else if (r > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = r - bar.clientWidth + 12;
    }
  }

  function renderFnBar() {
    const t = TABS.find((x) => x.id === state.tab);
    const d = state.data;
    const bar = $('#fn-bar');
    if (!t || !t.perFn || !d || !d.functions.length) { bar.hidden = true; return; }
    if (!d.functions.some((f) => f.name === state.fn)) {
      state.fn = (d.functions.find((f) => f.name === 'main') || d.functions[0]).name;
    }
    bar.hidden = false;
    bar.innerHTML = '<span class="lbl">Function</span>' + d.functions.map((f) =>
      `<button class="chip ${f.name === state.fn ? 'on' : ''}" data-fn="${esc(f.name)}">${esc(f.name)}(${esc(f.params.join(', '))})</button>`).join('');
  }

  function renderView(animate) {
    const d = state.data;
    TBL.clear();
    COPY.clear();
    const active = document.activeElement;
    const focusKey = active && active.dataset ? active.dataset.key : null;
    const top = view.scrollTop;
    view.style.scrollBehavior = 'auto';
    if (!d) {
      view.innerHTML = '<div class="card"><div class="skeleton"></div><div class="skeleton" style="width:60%"></div><div class="skeleton" style="width:80%"></div></div>';
      return;
    }
    let html;
    try { html = VIEWS[state.tab](); }
    catch (e) { console.error(e); html = `<div class="notice bad">Could not draw this view: ${esc(e.message)}</div>`; }
    view.innerHTML = html;
    if (!animate) $$('#view > *').forEach((el) => { el.style.animation = 'none'; });
    TBL.forEach((_, id) => tableChrome(id));
    view.scrollTop = animate ? 0 : top;
    view.style.scrollBehavior = '';
    if (focusKey) {
      const el = $(`[data-key="${CSS.escape(focusKey)}"]`, view);
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    }
  }

  function renderDock() {
    const d = state.data;
    const out = $('#dock-output');
    const probs = $('#dock-problems');
    const cnt = $('#problem-count');
    if (!d) { out.innerHTML = '<div class="out-empty">Compiling…</div>'; return; }
    const errs = d.summary.errors;
    const warns = d.summary.warnings;
    cnt.textContent = errs + warns;
    cnt.className = 'count' + (errs ? ' bad' : warns ? ' warn' : '');
    const r = d.run;
    let h = '';
    if (r) {
      h += (r.output.length ? r.output : []).map((l) => `<div class="out-line"><span class="pfx">›</span><span>${esc(l)}</span></div>`).join('');
      if (!r.output.length && !r.error) h += '<div class="out-line muted"><span class="pfx">›</span><span>(the program printed nothing)</span></div>';
      if (r.error) h += `<div class="out-line err"><span class="pfx">!</span><span>${esc(r.error)}</span></div>`;
      h += `<div class="out-badges">${badge(`${fmt(r.steps)} VM steps`, 'plain')}${badge(r.agree ? '3 back-ends agree' : 'back-ends differ', r.agree ? 'ok' : 'bad')}${badge(d.verify_ok ? 'verified' : 'unverified', d.verify_ok ? 'ok' : 'bad')}</div>`;
    } else {
      h = `<div class="out-line err"><span class="pfx">!</span><span>Compilation stopped with ${plural(errs, 'error')} - nothing was run.</span></div>
        <div class="out-badges"><button class="btn small" data-dock-open="problems">Show problems</button></div>`;
    }
    out.innerHTML = h;
    probs.innerHTML = d.diagnostics.length ? d.diagnostics.map((e) => `
      <div class="problem ${e.severity}" data-line="${e.line}" data-col="${e.col}">
        <span class="sev"></span><span class="ph">${esc(e.phase)}</span><span class="where">${e.line ? `${e.line}:${e.col}` : '—'}</span>
        <div><div class="msg">${esc(e.message)}</div>${e.hint ? `<div class="hint">hint: ${esc(e.hint)}</div>` : ''}</div></div>`).join('')
      : '<div class="out-empty">No problems. Every phase is happy with this program.</div>';
    $('#dock-meta').textContent = `${d.elapsed_ms} ms · ${d.max_steps >= 1e6 ? 'full' : 'live'} budget`;
  }

  function renderStatus() {
    const d = state.data;
    $('#sb-time').textContent = d ? `compiled in ${d.elapsed_ms} ms` : '';
    $('#sb-budget').textContent = d ? `budget ${fmt(d.max_steps)} steps` : '';
  }

  function renderAll(animate) {
    renderRail();
    renderTabs();
    renderFnBar();
    renderView(animate);
    renderDock();
    renderStatus();
    paintEditor();
  }

  // ===================================================================
  //  Editor
  // ===================================================================
  let lastLines = -1;
  let lastDiagKey = '';

  function diagLines() {
    const m = new Map();
    const d = state.data;
    if (!d) return m;
    for (const e of d.diagnostics) {
      if (!e.line) continue;
      if (e.severity === 'error' || !m.has(e.line)) m.set(e.line, e.severity === 'error' ? 'err' : 'wrn');
    }
    return m;
  }

  function paintEditor() {
    const src = ta.value;
    hl.innerHTML = highlightNova(src);
    const n = src.split('\n').length;
    const dl = diagLines();
    const key = n + '|' + state.caretLine + '|' + [...dl].join(',');
    if (key !== lastDiagKey || n !== lastLines) {
      let g = '';
      for (let i = 1; i <= n; i++) {
        const c = dl.get(i);
        g += `<div class="gl${c ? ' ' + c : ''}${i === state.caretLine ? ' cur' : ''}">${i}</div>`;
      }
      gutter.innerHTML = g + '<div style="height:60px"></div>';
      let dd = `<div class="ln-bg cur" style="top:${14 + (state.caretLine - 1) * 21}px"></div>`;
      dl.forEach((c, line) => { dd += `<div class="ln-bg ${c}" style="top:${14 + (line - 1) * 21}px"></div>`; });
      decor.innerHTML = dd;
      lastDiagKey = key;
      lastLines = n;
    }
    syncScroll();
  }

  function syncScroll() {
    const x = ta.scrollLeft;
    const y = ta.scrollTop;
    hl.style.transform = `translate(${-x}px, ${-y}px)`;
    decor.style.transform = `translateY(${-y}px)`;
    gutter.scrollTop = y;
  }

  function caret() {
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos);
    const line = before.split('\n').length;
    const col = pos - before.lastIndexOf('\n');
    $('#sb-cursor').textContent = `Ln ${line}, Col ${col}`;
    if (line !== state.caretLine) { state.caretLine = line; paintEditor(); }
  }

  function insertText(text) {
    ta.focus();
    // execCommand keeps the browser's undo stack; fall back where it is gone.
    if (!document.execCommand || !document.execCommand('insertText', false, text)) {
      ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
      ta.dispatchEvent(new Event('input'));
    }
  }

  function selectedLines() {
    const v = ta.value;
    const s = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    let e = v.indexOf('\n', ta.selectionEnd - (ta.selectionEnd > ta.selectionStart && v[ta.selectionEnd - 1] === '\n' ? 1 : 0));
    if (e === -1) e = v.length;
    return { s, e, text: v.slice(s, e) };
  }

  function replaceLines(fn) {
    const { s, e, text } = selectedLines();
    const out = text.split('\n').map(fn).join('\n');
    ta.setSelectionRange(s, e);
    insertText(out);
    ta.setSelectionRange(s, s + out.length);
  }

  function onKey(ev) {
    const mod = ev.ctrlKey || ev.metaKey;
    if (ev.key === 'Tab') {
      ev.preventDefault();
      if (ev.shiftKey) replaceLines((l) => l.replace(/^( {1,4}|\t)/, ''));
      else if (ta.selectionStart !== ta.selectionEnd && ta.value.slice(ta.selectionStart, ta.selectionEnd).includes('\n')) replaceLines((l) => '    ' + l);
      else insertText('    ');
    } else if (ev.key === 'Enter' && !mod && !ev.shiftKey && !ev.altKey) {
      ev.preventDefault();
      const v = ta.value;
      const ls = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
      const line = v.slice(ls, ta.selectionStart);
      let ind = (/^\s*/.exec(line) || [''])[0];
      if (/\b(then|do|of|else|otherwise)\s*$/.test(line) || /^\s*func\b/.test(line)) ind += '    ';
      insertText('\n' + ind);
    } else if (mod && ev.key === '/') {
      ev.preventDefault();
      const { text } = selectedLines();
      const all = text.split('\n').filter((l) => l.trim()).every((l) => /^\s*#/.test(l));
      replaceLines((l) => (all ? l.replace(/^(\s*)# ?/, '$1') : l.trim() ? l.replace(/^(\s*)/, '$1# ') : l));
    }
  }

  // ===================================================================
  //  Server calls
  // ===================================================================
  let liveTimer = 0;
  let busyTimer = 0;

  function setBusy(on) {
    const btn = $('#btn-run');
    const svg = btn.querySelector('svg');
    clearTimeout(busyTimer);
    if (on) {
      busyTimer = setTimeout(() => $('#rail').classList.add('busy'), 140);
      $('#led').className = 'led busy';
    } else {
      $('#rail').classList.remove('busy');       // the LED is left to setServer
      btn.classList.remove('busy');
      svg.innerHTML = ICON.play;
    }
  }

  function setServer(ok, text) {
    $('#led').className = 'led ' + (ok ? 'on' : 'off');
    $('#sb-server').textContent = text || (ok ? `Nova Studio ${state.health ? state.health.version : ''} · Python ${state.health ? state.health.python : ''}` : 'server unreachable - is python -m nova serve still running?');
  }

  async function api(path, body, signal) {
    const r = await fetch(path, body === undefined ? { signal } : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
    });
    const ct = r.headers.get('Content-Type') || '';
    const data = ct.includes('json') ? await r.json() : await r.blob();
    if (!r.ok) throw new Error((data && data.error) || `HTTP ${r.status}`);
    return data;
  }

  async function compile(mode = 'live', quiet = false) {
    clearTimeout(liveTimer);
    const seq = ++state.seq;
    if (state.ctrl) state.ctrl.abort();
    const ctrl = new AbortController();
    state.ctrl = ctrl;
    setBusy(true);
    if (mode === 'run') {
      const btn = $('#btn-run');
      btn.classList.add('busy');
      btn.querySelector('svg').innerHTML = ICON.spin;
    }
    try {
      const d = await api('/api/compile', { source: ta.value, optimise: state.optimise, mode, name: state.fileName }, ctrl.signal);
      if (seq !== state.seq) return;
      const first = !state.data;
      state.data = d;
      setServer(true);
      renderAll(first);
      if (mode === 'run' && !quiet) {
        const r = d.run;
        if (!d.ok) toast(`${plural(d.summary.errors, 'error')} - see Problems`, 'bad');
        else if (r && r.error) toast(r.error, 'bad');
        else if (r) toast(`Ran in ${fmt(r.steps)} steps · ${d.elapsed_ms} ms`, 'ok');
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
      setServer(false);
      toast('Could not compile: ' + e.message, 'bad');
    } finally {
      if (seq === state.seq) setBusy(false);
    }
  }

  function scheduleLive() {
    clearTimeout(liveTimer);
    if (state.live) liveTimer = setTimeout(() => compile('live'), 360);
  }

  async function loadAttacks() {
    if (state.attacksLoading) return;
    state.attacksLoading = true;
    try {
      state.attacks = await api('/api/attacks');
      if (state.tab === 'security') renderView(true);
    } catch (e) {
      toast('Could not load the security lab: ' + e.message, 'bad');
    } finally {
      state.attacksLoading = false;
    }
  }

  async function downloadReport() {
    const btn = $('#btn-report');
    btn.classList.add('busy');
    try {
      const blob = await api('/api/report', { source: ta.value, optimise: state.optimise, name: state.fileName });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = state.fileName.replace(/\.[^.]+$/, '') + '-report.html';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('Report downloaded', 'ok');
    } catch (e) {
      toast('Report failed: ' + e.message, 'bad');
    } finally {
      btn.classList.remove('busy');
    }
  }

  // ===================================================================
  //  Buffer management
  // ===================================================================
  function setDirty() {
    const dirty = ta.value !== state.baseline;
    $('#dirty-dot').className = 'dot' + (dirty ? '' : ' clean');
    $('#dirty-dot').title = dirty ? 'modified' : 'unchanged';
  }

  function loadSource(src, name, example) {
    ta.value = src;
    state.baseline = src;
    state.fileName = name;
    state.example = example || null;
    $('#file-name').textContent = name;
    ta.scrollTop = 0;
    ta.scrollLeft = 0;
    ta.setSelectionRange(0, 0);
    state.caretLine = 1;
    setDirty();
    paintEditor();
    caret();
    persist();
    compile('run', true);
  }

  function loadExample(file, ask = true) {
    const ex = state.examples.find((e) => e.file === file);
    if (!ex) return;
    if (ask && ta.value !== state.baseline && ta.value.trim() && !confirm('Replace your edits with this example?')) {
      $('#example').value = state.example || '';
      return;
    }
    $('#example').value = file;
    loadSource(ex.source, ex.file, ex.file);
    updateHash();
  }

  function persist() {
    store.set('buffer', { source: ta.value, name: state.fileName, example: state.example, baseline: state.baseline });
  }

  function openFile(file) {
    if (!file) return;
    if (file.size > 500 * 1024) { toast('That file is larger than 500 KB', 'bad'); return; }
    const r = new FileReader();
    r.onload = () => {
      $('#example').value = '';
      loadSource(String(r.result), file.name, null);
      toast(`Opened ${file.name}`, 'ok');
    };
    r.onerror = () => toast('Could not read that file', 'bad');
    r.readAsText(file);
  }

  // ===================================================================
  //  Navigation
  // ===================================================================
  function setTab(id, opts = {}) {
    if (!VIEWS[id]) return;
    const changed = id !== state.tab;
    state.tab = id;
    if (opts.fn) state.fn = opts.fn;
    renderRail();
    renderTabs();
    renderFnBar();
    renderView(changed || opts.animate);
    updateHash();
    store.set('tab', id);
  }

  function updateHash() {
    const p = new URLSearchParams();
    p.set('tab', state.tab);
    const t = TABS.find((x) => x.id === state.tab);
    if (t && t.perFn && state.fn) p.set('fn', state.fn);
    if (state.example) p.set('example', state.example);
    history.replaceState(null, '', '#' + p.toString());
  }

  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    return { tab: p.get('tab'), fn: p.get('fn'), example: p.get('example') };
  }

  function jumpToLine(line, col) {
    if (!line) return;
    const lines = ta.value.split('\n');
    let pos = 0;
    for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
    pos += Math.max(0, (col || 1) - 1);
    ta.focus();
    ta.setSelectionRange(pos, pos);
    ta.scrollTop = Math.max(0, (line - 6) * 21);
    caret();
    const band = document.createElement('div');
    band.className = 'ln-bg flash';
    band.style.top = `${14 + (line - 1) * 21}px`;
    decor.appendChild(band);
    setTimeout(() => band.remove(), 1300);
  }

  function showDock(which) {
    $$('.dock-tab').forEach((b) => b.classList.toggle('on', b.dataset.dock === which));
    $('#dock-output').hidden = which !== 'output';
    $('#dock-problems').hidden = which !== 'problems';
  }

  // ===================================================================
  //  Toasts
  // ===================================================================
  function toast(msg, kind = '', ms = 2800) {
    const box = $('#toasts');
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.innerHTML = `<span>${esc(msg)}</span>`;
    box.appendChild(t);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 260); }, ms);
  }

  // ===================================================================
  //  Resizing
  // ===================================================================
  function dragger(el, onMove, onEnd) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('drag');
      document.body.classList.add('resizing');
      const move = (ev) => onMove(ev);
      const up = () => {
        el.classList.remove('drag');
        document.body.classList.remove('resizing');
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        onEnd();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
  }

  function initResize() {
    const root = document.documentElement;
    const left = store.get('left', null);
    const dock = store.get('dock', null);
    if (left) root.style.setProperty('--left', left);
    if (dock) root.style.setProperty('--dock', dock);
    const ws = $('#workspace');
    dragger($('#vsplit'), (e) => {
      const r = ws.getBoundingClientRect();
      const p = Math.min(72, Math.max(24, ((e.clientX - r.left - 14) / (r.width - 28)) * 100));
      root.style.setProperty('--left', p.toFixed(2) + '%');
    }, () => store.set('left', root.style.getPropertyValue('--left')));
    const pane = $('#editor-pane');
    dragger($('#hsplit'), (e) => {
      const r = pane.getBoundingClientRect();
      const px = Math.min(r.height - 160, Math.max(70, r.bottom - e.clientY));
      root.style.setProperty('--dock', Math.round(px) + 'px');
    }, () => store.set('dock', root.style.getPropertyValue('--dock')));
  }

  // ===================================================================
  //  Wiring
  // ===================================================================
  function wire() {
    ta.addEventListener('input', () => { setDirty(); paintEditor(); caret(); persist(); scheduleLive(); });
    ta.addEventListener('scroll', syncScroll);
    ta.addEventListener('keydown', onKey);
    ta.addEventListener('click', caret);
    ta.addEventListener('keyup', caret);
    document.addEventListener('selectionchange', () => { if (document.activeElement === ta) caret(); });

    $('#example').addEventListener('change', (e) => { if (e.target.value) loadExample(e.target.value); });
    $('#btn-run').addEventListener('click', () => compile('run'));
    $('#btn-report').addEventListener('click', downloadReport);
    $('#btn-open').addEventListener('click', () => $('#file').click());
    $('#file').addEventListener('change', (e) => { openFile(e.target.files[0]); e.target.value = ''; });
    $('#btn-reset').addEventListener('click', () => {
      if (state.example) loadExample(state.example, true);
      else toast('This buffer did not come from an example', '');
    });
    $('#btn-copy-src').addEventListener('click', () => copyText(ta.value, 'Source copied'));

    const live = $('#live');
    const opt = $('#optimise');
    live.checked = state.live;
    opt.checked = state.optimise;
    live.addEventListener('change', () => { state.live = live.checked; store.set('live', state.live); if (state.live) compile('live'); toast(state.live ? 'Live compile on' : 'Live compile off - press Run', ''); });
    opt.addEventListener('change', () => { state.optimise = opt.checked; store.set('optimise', state.optimise); compile('run', true); });

    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab],[data-fn],[data-copy],[data-more],[data-cfg],[data-action],[data-dock],[data-dock-open],.problem');
      if (!t) return;
      if (t.dataset.tab) setTab(t.dataset.tab);
      else if (t.dataset.fn) { state.fn = t.dataset.fn; renderFnBar(); renderView(true); updateHash(); }
      else if (t.dataset.copy) copyText(COPY.get(t.dataset.copy) || '', 'Copied');
      else if (t.dataset.more) {
        const tb = TBL.get(t.dataset.more);
        if (tb) { tb.limit += 300; $(`[data-body="${t.dataset.more}"]`).innerHTML = tableBody(t.dataset.more); tableChrome(t.dataset.more); }
      } else if (t.dataset.cfg) { state.cfgMode = t.dataset.cfg; renderView(false); }
      else if (t.dataset.action === 'run') compile('run');
      else if (t.dataset.action === 'optimise-on') { opt.checked = true; opt.dispatchEvent(new Event('change')); }
      else if (t.dataset.dock) showDock(t.dataset.dock);
      else if (t.dataset.dockOpen) showDock(t.dataset.dockOpen);
      else if (t.classList.contains('problem')) jumpToLine(+t.dataset.line, +t.dataset.col);
    });

    view.addEventListener('input', (e) => {
      const id = e.target.dataset.tbl;
      if (!id) return;
      const t = TBL.get(id);
      t.filter = e.target.value;
      t.limit = 150;
      state.filters[t.key] = t.filter;
      $(`[data-body="${id}"]`).innerHTML = tableBody(id);
      tableChrome(id);
    });
    view.addEventListener('toggle', (e) => {
      const k = e.target.dataset && e.target.dataset.fold;
      if (k) state.folds[k] = e.target.open;
    }, true);

    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'Enter') { e.preventDefault(); compile('run'); }
      else if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); downloadReport(); }
      else if (mod && (e.key === 'o' || e.key === 'O')) { e.preventDefault(); $('#file').click(); }
      else if (e.altKey && /^[1-9]$/.test(e.key)) {
        const t = TABS.find((x) => x.num === e.key);
        if (t) { e.preventDefault(); setTab(t.id); }
      } else if (e.key === 'Escape') $('#keys-modal').hidden = true;
    });

    // deep links pasted into an open tab (our own updates use replaceState)
    window.addEventListener('hashchange', () => {
      const h = readHash();
      if (h.example && h.example !== state.example) loadExample(h.example, true);
      if (h.fn) state.fn = h.fn;
      if (h.tab && VIEWS[h.tab]) setTab(h.tab, { animate: true });
    });

    $('#btn-keys').addEventListener('click', () => { $('#keys-modal').hidden = false; $('#keys-close').focus(); });
    $('#keys-close').addEventListener('click', () => { $('#keys-modal').hidden = true; });
    $('#keys-modal').addEventListener('click', (e) => { if (e.target.id === 'keys-modal') e.target.hidden = true; });

    const ed = $('#editor');
    ['dragenter', 'dragover'].forEach((n) => ed.addEventListener(n, (e) => { e.preventDefault(); ed.classList.add('dragging'); }));
    ['dragleave', 'drop'].forEach((n) => ed.addEventListener(n, (e) => { e.preventDefault(); ed.classList.remove('dragging'); }));
    ed.addEventListener('drop', (e) => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) openFile(f); });
  }

  function copyText(text, msg) {
    const done = () => toast(msg, 'ok', 1600);
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => toast('Copy failed', 'bad'));
    else {
      const t = document.createElement('textarea');
      t.value = text;
      document.body.appendChild(t);
      t.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed', 'bad'); }
      t.remove();
    }
  }

  // ===================================================================
  //  Boot
  // ===================================================================
  async function boot() {
    wire();
    initResize();
    const h = readHash();
    if (h.tab && VIEWS[h.tab]) state.tab = h.tab;
    else state.tab = store.get('tab', 'overview');
    if (!VIEWS[state.tab]) state.tab = 'overview';
    if (h.fn) state.fn = h.fn;
    renderRail();
    renderTabs();
    renderView(true);

    try {
      const [health, examples] = await Promise.all([api('/api/health'), api('/api/examples')]);
      state.health = health;
      state.examples = examples;
      setServer(true);
    } catch (e) {
      setServer(false);
      view.innerHTML = `<div class="notice bad"><span class="grow">Cannot reach the Nova server: ${esc(e.message)}. Start it with <code class="inline">python -m nova serve</code>.</span></div>`;
      return;
    }
    api('/api/grammar').then((g) => { state.grammar = g; if (['syntax', 'lexical'].includes(state.tab)) renderView(false); })
      .catch(() => {});

    const sel = $('#example');
    sel.innerHTML = '<option value="">Custom program</option>' + state.examples.map((e) =>
      `<option value="${esc(e.file)}" title="${esc(e.summary)}">${esc(e.file.slice(0, 2))} · ${esc(e.title)}</option>`).join('');

    const saved = store.get('buffer', null);
    if (h.example && state.examples.some((e) => e.file === h.example)) {
      loadExample(h.example, false);
    } else if (saved && typeof saved.source === 'string' && saved.source.trim()) {
      ta.value = saved.source;
      state.baseline = typeof saved.baseline === 'string' ? saved.baseline : saved.source;
      state.fileName = saved.name || 'untitled.nova';
      state.example = saved.example || null;
      sel.value = state.example || '';
      $('#file-name').textContent = state.fileName;
      setDirty();
      paintEditor();
      compile('run', true);
    } else {
      loadExample('02_fibonacci.nova', false);
    }
    updateHash();
  }

  boot();
})();
