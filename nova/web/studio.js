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
    scanIdx: -1,            // token selected in the scanner trace
    lrState: 0,             // LALR state shown in the automaton card
    lrFrom: 0,              // first state of the parse-table window
    player: { i: 0 },       // LR parse player position
    vm: { i: 0 },           // VM stepper position
    timers: {},             // running players
    astRoot: null,          // which subtree the AST drawing shows
    dagBlock: null,
    dfSel: 'Live variables',
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
    { id: 'syllabus', label: 'Syllabus map' },
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
  function cfgSvg(cfg, opts = {}) {
    const blocks = cfg.blocks || [];
    const n = blocks.length;
    const annot = opts.annot || {};
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
      const extra = annot[b.id] || [];
      const all = lines.concat(extra);
      const w = Math.min(MAXC, Math.max(14, ...all.map((l) => l.length))) * CW + PAD * 2;
      return { w: Math.max(150, w), h: HEAD + LH * lines.length + 10 + (extra.length ? LH * extra.length + 8 : 0), lines, extra };
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
      const ay = yy + HEAD + 12 + d.lines.length * LH;
      const extra = d.extra.length ? `<line x1="${x + 6}" y1="${ay - 9}" x2="${x + d.w - 6}" y2="${ay - 9}" class="sep"/>` +
        d.extra.map((l, k) => `<text x="${x + PAD}" y="${ay + 4 + k * LH}" class="an">${esc(l.length > MAXC ? l.slice(0, MAXC - 1) + '…' : l)}</text>`).join('') : '';
      return `<g class="blk${entry ? ' entry' : ''}${loopHeads.has(i) ? ' head' : ''}">
        <rect x="${x}" y="${yy}" width="${d.w}" height="${d.h}" rx="10" class="box"/>
        <path d="M${x} ${yy + 10} a10 10 0 0 1 10 -10 h${d.w - 20} a10 10 0 0 1 10 10 v${HEAD - 12} h${-d.w} z" class="cap"/>
        <text x="${x + PAD}" y="${yy + 18}" class="bid">B${b.id}</text>
        <text x="${x + d.w - PAD}" y="${yy + 18}" class="tag" text-anchor="end">${esc(tags.join(' · '))}</text>
        ${lines}${extra}</g>`;
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
  //  Trees and DAGs as SVG
  // ===================================================================
  const SVG_DEFS = `<defs>
    <marker id="ah" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L8,4.5 L0,9 z" fill="#5a5a66"/></marker>
    <marker id="ah-o" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L8,4.5 L0,9 z" fill="#ff7a1a"/></marker>
    <linearGradient id="cap-g" x1="0" x2="1"><stop offset="0" stop-color="#ff7a1a" stop-opacity=".26"/><stop offset="1" stop-color="#ff7a1a" stop-opacity=".04"/></linearGradient>
  </defs>`;

  const TREE_KW = new Set(['program', 'main', 'if', 'then', 'else', 'while', 'do', 'case', 'otherwise', 'print', 'return', 'block']);

  /** Layered tree layout: every parent is centred over the span of its children,
      and sibling subtrees never overlap (a simplified Reingold-Tilford). */
  function layoutTree(root, widthOf, { nodeH = 30, hgap = 14, vgap = 44 } = {}) {
    const nodes = [];
    const edges = [];
    const measure = (n) => {
      n._w = widthOf(n);
      const kids = n.kids || [];
      kids.forEach(measure);
      n._span = kids.length ? Math.max(n._w, kids.reduce((s, k) => s + k._span, 0) + hgap * (kids.length - 1)) : n._w;
    };
    const place = (n, x0, depth, parent) => {
      const kids = n.kids || [];
      const idx = nodes.length;
      nodes.push(null);
      if (!kids.length) {
        n._cx = x0 + n._span / 2;
      } else {
        let x = x0 + Math.max(0, (n._span - (kids.reduce((s, k) => s + k._span, 0) + hgap * (kids.length - 1))) / 2);
        kids.forEach((k) => { place(k, x, depth + 1, idx); x += k._span + hgap; });
        n._cx = (kids[0]._cx + kids[kids.length - 1]._cx) / 2;
      }
      nodes[idx] = { node: n, x: n._cx - n._w / 2, y: depth * (nodeH + vgap), w: n._w, h: nodeH, depth };
      if (parent != null) edges.push([parent, idx]);
    };
    measure(root);
    place(root, 0, 0, null);
    const W = root._span;
    const H = (Math.max(...nodes.map((p) => p.depth)) + 1) * (nodeH + vgap) - vgap;
    return { nodes, edges, W, H };
  }

  function treeSvg(root, opts = {}) {
    const CW = 7.2;
    const label = opts.label || ((n) => n.label);
    const sub = opts.sub || ((n) => n.type || '');
    const widthOf = (n) => Math.max(opts.minW || 40, (label(n).length + (sub(n) ? sub(n).length + 1.5 : 0)) * CW + 22);
    const L = layoutTree(root, widthOf, { nodeH: 30, hgap: opts.hgap || 14, vgap: opts.vgap || 40 });
    const PADX = 16, PADY = 14;
    const edges = L.edges.map(([p, c]) => {
      const a = L.nodes[p], b = L.nodes[c];
      const x1 = a.x + a.w / 2, y1 = a.y + a.h, x2 = b.x + b.w / 2, y2 = b.y;
      const my = (y1 + y2) / 2;
      return `<path d="M${x1 + PADX} ${y1 + PADY} C${x1 + PADX} ${my + PADY}, ${x2 + PADX} ${my + PADY}, ${x2 + PADX} ${y2 + PADY}" class="te"/>`;
    }).join('');
    const nodes = L.nodes.map((p) => {
      const n = p.node;
      const lb = label(n), sb = sub(n);
      const kind = opts.kind ? opts.kind(n) : (TREE_KW.has(lb.split(' ')[0]) ? 'kw' : /^(call|let|func)\b/.test(lb) ? 'fn' : /^[-+*/%<>=!]|^(and|or|not)$|=$/.test(lb) ? 'op' : /^(\d|")/.test(lb) ? 'lit' : 'id');
      const tx = p.x + PADX + 11, ty = p.y + PADY + 19;
      return `<g class="tn ${kind}"><rect x="${p.x + PADX}" y="${p.y + PADY}" width="${p.w}" height="${p.h}" rx="8" class="tb"/>
        <text x="${tx}" y="${ty}" class="tlb">${esc(lb)}${sb ? `<tspan class="ty"> : ${esc(sb)}</tspan>` : ''}</text></g>`;
    }).join('');
    const W = L.W + PADX * 2, H = L.H + PADY * 2;
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(opts.aria || 'tree')}">${edges}${nodes}</svg>`;
  }

  /** The DAG of a basic block: leaves at the bottom, operators above their
      operands, shared nodes (common subexpressions) marked. */
  function dagSvg(nodes) {
    if (!nodes || !nodes.length) return '<div class="empty">No computations in this block.</div>';
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const level = new Map();
    const lv = (n) => {
      if (level.has(n.id)) return level.get(n.id);
      const l = n.children.length ? 1 + Math.max(...n.children.map((c) => lv(byId.get(c)))) : 0;
      level.set(n.id, l);
      return l;
    };
    nodes.forEach(lv);
    const indeg = new Map();
    nodes.forEach((n) => n.children.forEach((c) => indeg.set(c, (indeg.get(c) || 0) + 1)));
    const maxL = Math.max(...level.values());
    const rows = [];
    for (let l = 0; l <= maxL; l++) rows.push(nodes.filter((n) => level.get(n.id) === l));
    const CW = 7.2, NH = 32, VG = 58, HG = 26, PAD = 18;
    const text = (n) => (n.op === 'leaf' ? n.value : n.op);
    const wOf = (n) => Math.max(44, text(n).length * CW + 24) + (n.labels.length ? n.labels.join(', ').length * 6.4 + 18 : 0);
    const pos = new Map();
    // leaves first, then each level ordered by the mean x of its children (fewer crossings)
    rows.forEach((row, l) => {
      if (l > 0) row.sort((a, b) => {
        const m = (n) => n.children.reduce((s, c) => s + pos.get(c).cx, 0) / n.children.length;
        return m(a) - m(b);
      });
      const total = row.reduce((s, n) => s + wOf(n), 0) + HG * (row.length - 1);
      let x = PAD;
      row.forEach((n) => { pos.set(n.id, { x, cx: x + Math.max(44, text(n).length * CW + 24) / 2, w: wOf(n), level: l, total }); x += wOf(n) + HG; });
    });
    const W = Math.max(...rows.map((r) => r.reduce((s, n) => s + wOf(n), 0) + HG * (r.length - 1))) + PAD * 2;
    rows.forEach((row) => {           // centre each row
      const total = row.reduce((s, n) => s + wOf(n), 0) + HG * (row.length - 1);
      const shift = (W - PAD * 2 - total) / 2;
      row.forEach((n) => { const p = pos.get(n.id); p.x += shift; p.cx += shift; });
    });
    const yOf = (l) => PAD + (maxL - l) * (NH + VG);
    const H = PAD * 2 + (maxL + 1) * NH + maxL * VG;
    const edges = [];
    nodes.forEach((n) => n.children.forEach((c, k) => {
      const a = pos.get(n.id), b = pos.get(c);
      const x1 = a.cx + (n.children.length > 1 ? (k ? 7 : -7) : 0), y1 = yOf(level.get(n.id)) + NH;
      const x2 = b.cx, y2 = yOf(level.get(c)) - 2;
      const my = (y1 + y2) / 2;
      edges.push(`<path d="M${x1} ${y1} C${x1} ${my}, ${x2} ${my}, ${x2} ${y2}" class="de${(indeg.get(c) || 0) > 1 ? ' shared' : ''}" marker-end="url(#${(indeg.get(c) || 0) > 1 ? 'ah-o' : 'ah'})"/>`);
    }));
    const boxes = nodes.map((n) => {
      const p = pos.get(n.id);
      const y = yOf(level.get(n.id));
      const bw = Math.max(44, text(n).length * CW + 24);
      const shared = (indeg.get(n.id) || 0) > 1;
      const labels = n.labels.length ? `<text x="${p.x + bw + 8}" y="${y + 20}" class="dl">← ${esc(n.labels.join(', '))}</text>` : '';
      return `<g class="dn ${n.op === 'leaf' ? 'leaf' : 'op'}${shared ? ' shared' : ''}">
        <rect x="${p.x}" y="${y}" width="${bw}" height="${NH}" rx="9" class="db"/>
        <text x="${p.x + bw / 2}" y="${y + 20}" text-anchor="middle" class="dt">${esc(text(n))}</text>
        <text x="${p.x + 4}" y="${y - 4}" class="did">n${n.id}${shared ? ' · shared' : ''}</text>${labels}</g>`;
    }).join('');
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="DAG of a basic block">${SVG_DEFS}${edges.join('')}${boxes}</svg>`;
  }

  // ===================================================================
  //  Interactive components (scanner trace, LR automaton, players)
  // ===================================================================
  function scannerTrace(lx) {
    const scan = lx.scan || [];
    if (!scan.length) return '';
    if (state.scanIdx < 0 || state.scanIdx >= scan.length) {
      const k = scan.findIndex((t) => KEYWORDS.has(t.lx));
      state.scanIdx = k >= 0 ? k : 0;
    }
    const t = scan[state.scanIdx];
    const accept = (state.grammar && state.grammar.dfa && state.grammar.dfa.accept) || {};
    const chars = (t.lx + (t.ahead || '')).split('');
    const parts = t.path.map((s, k) => {
      const acc = accept[String(s)];
      const over = k > t.lx.length;
      const last = k === t.lx.length;
      const node = `<span class="sc-node${acc ? ' acc' : ''}${over ? ' over' : ''}${last ? ' final' : ''}${k === 0 ? ' start' : ''}" title="DFA state ${s}${acc ? ', accepts ' + acc : ''}">S${s}${acc ? `<i>${esc(acc)}</i>` : ''}</span>`;
      const edge = k < chars.length ? `<span class="sc-edge${k >= t.lx.length ? ' over' : ''}"><b>${esc(chars[k] === ' ' ? '␠' : chars[k] === '\n' ? '\\n' : chars[k])}</b></span>` : '';
      return node + edge;
    }).join('');
    const explain = t.overrun
      ? `read ${plural(t.overrun, 'character')} past the end (${esc(JSON.stringify(t.ahead))}) looking for a longer match, found no accepting state, and gave ${t.overrun === 1 ? 'it' : 'them'} back`
      : 'stopped at the end of the input or on a character with no transition';
    const final = accept[String(t.path[t.lx.length])] || t.t;
    return `<div class="card"><div class="card-title"><h4>Scanner trace · <code class="inline">${esc(t.lx)}</code> → ${badge(t.t, 'hot')}</h4>
        <span class="sub">click any token above to trace it</span></div>
      <div class="sc-chain">${parts}</div>
      <p class="note" style="margin:10px 0 0">The scanner walked ${plural(t.path.length - 1, 'transition')} for this ${t.lx.length}-character token and ${explain}.
      The last accepting state on the path, S${t.path[t.lx.length]}, accepts <b>${esc(final)}</b>${t.t === 'IDENT' || KEYWORDS.has(t.lx) ? ' - a state that accepts both a keyword and an identifier takes the keyword, because the keyword pattern has the lower index' : ''}.</p></div>`;
  }

  function lrStateCard() {
    const g = state.grammar;
    if (!g || !g.lalr) return '<div class="card"><div class="skeleton"></div><div class="skeleton" style="width:60%"></div></div>';
    const L = g.lalr;
    const s = Math.max(0, Math.min(L.n_states - 1, state.lrState | 0));
    state.lrState = s;
    const items = L.states[s];
    const act = L.action[String(s)] || {};
    const gt = L.goto[String(s)] || {};
    const prodText = (pi) => { const p = L.productions[pi]; return `${p.lhs} → ${p.rhs}`; };
    const chips = Object.entries(act).map(([sym, a]) => {
      if (a === 'acc') return `<span class="lr-act acc"><b>${esc(sym)}</b> accept</span>`;
      if (a[0] === 's') return `<span class="lr-act sh"><b>${esc(sym)}</b> shift <span data-lrstate="${a.slice(1)}" class="lr-link">${a.slice(1)}</span></span>`;
      return `<span class="lr-act rd" title="${esc(prodText(+a.slice(1)))}"><b>${esc(sym)}</b> reduce ${a.slice(1)}</span>`;
    }).join('');
    const gchips = Object.entries(gt).map(([nt, j]) => `<span class="lr-act go"><b>${esc(nt)}</b> → <span data-lrstate="${j}" class="lr-link">${j}</span></span>`).join('');
    return `<div class="card" id="lr-card"><div class="card-title"><h4>LALR(1) automaton · state <span class="mono" style="color:var(--orange-2)">${s}</span> of ${L.n_states}</h4>
        <div class="lr-nav"><button class="btn small ghost" data-lrstep="-1" title="previous state">◀</button>
          <input type="number" min="0" max="${L.n_states - 1}" value="${s}" id="lr-state-input" aria-label="state number">
          <button class="btn small ghost" data-lrstep="1" title="next state">▶</button></div></div>
      <div class="grid two" style="gap:12px">
        <div><div class="lr-sub">Items <span class="dim">(kernel items in bold; look-aheads in braces)</span></div>
          <div class="lr-items">${items.map((it) => `<div class="lr-item${it.kernel ? ' kernel' : ''}"><span class="lhs">${esc(it.lhs)}</span> → <span class="rhs">${esc(it.rhs)}</span><span class="la">{${esc(it.la.join(' '))}}</span></div>`).join('')}</div></div>
        <div><div class="lr-sub">ACTION</div><div class="lr-acts">${chips || '<span class="dim">none</span>'}</div>
          <div class="lr-sub" style="margin-top:10px">GOTO</div><div class="lr-acts">${gchips || '<span class="dim">none</span>'}</div></div>
      </div></div>`;
  }

  function lrTable() {
    const g = state.grammar;
    if (!g || !g.lalr) return '';
    const L = g.lalr;
    const SPAN = 18;
    const from = Math.max(0, Math.min(L.n_states - SPAN, state.lrFrom | 0));
    state.lrFrom = from;
    const states = [];
    for (let s = from; s < Math.min(L.n_states, from + SPAN); s++) states.push(s);
    const used = (syms, get) => syms.filter((sym) => states.some((s) => get(s)[sym] != null));
    const terms = used(L.terminals, (s) => L.action[String(s)] || {});
    const nts = used(L.nonterminals, (s) => L.goto[String(s)] || {});
    const cell = (a) => a == null ? '<td class="lr-c e"></td>' : a === 'acc' ? '<td class="lr-c acc">acc</td>' : a[0] === 's' ? `<td class="lr-c sh">${esc(a)}</td>` : `<td class="lr-c rd">${esc(a)}</td>`;
    const body = states.map((s) => `<tr><th class="lr-s">${s}</th>${terms.map((t) => cell((L.action[String(s)] || {})[t])).join('')}${nts.map((n) => { const j = (L.goto[String(s)] || {})[n]; return j == null ? '<td class="lr-c e"></td>' : `<td class="lr-c go">${j}</td>`; }).join('')}</tr>`).join('');
    return `<div class="tbl-wrap" id="lr-table"><div class="tbl-tools">
        <span class="lr-nav"><button class="btn small ghost" data-lrpage="-1">◀</button><span class="mono" style="font-size:12px">states ${from}–${states[states.length - 1]}</span><button class="btn small ghost" data-lrpage="1">▶</button></span>
        <span class="count">${terms.length} terminal + ${nts.length} non-terminal columns in use · ${fmt(L.n_states)} states · s = shift, r = reduce, acc = accept</span></div>
      <div class="tbl-scroll" style="max-height:520px"><table class="lr-grid"><thead><tr><th class="lr-s">state</th>${terms.map((t) => `<th class="lr-h t">${esc(t)}</th>`).join('')}${nts.map((n) => `<th class="lr-h n">${esc(n)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div></div>`;
  }

  function stopTimers() {
    Object.values(state.timers).forEach((t) => clearInterval(t));
    state.timers = {};
  }

  function playerBar(id, i, n, label) {
    return `<div class="player-bar" data-player="${id}">
      <button class="icon-btn" data-pstep="first" title="first">⏮</button>
      <button class="icon-btn" data-pstep="-1" title="back">◀</button>
      <button class="icon-btn play" data-pstep="play" title="play / pause">${state.timers[id] ? '❚❚' : '▶'}</button>
      <button class="icon-btn" data-pstep="1" title="forward">▶|</button>
      <button class="icon-btn" data-pstep="last" title="last">⏭</button>
      <input type="range" min="0" max="${Math.max(0, n - 1)}" value="${i}" class="player-range" aria-label="position">
      <span class="player-pos mono">${esc(label)}</span></div>`;
  }

  function parsePlayer() {
    const d = state.data;
    const rows = d.syntax.lr_trace.rows;
    if (!rows.length) return '';
    const n = rows.length;
    const i = Math.max(0, Math.min(n - 1, state.player.i | 0));
    state.player.i = i;
    const row = rows[i];
    const stack = String(row[1]).split(' ').filter(Boolean);
    const syms = String(row[2]).split(' ').filter(Boolean);
    const action = String(row[4]);
    let ptr = 0;
    for (let k = 0; k < i; k++) if (String(rows[k][4]).startsWith('shift')) ptr++;
    const toks = (d.lexical && d.lexical.tokens.rows) || [];
    const tape = toks.slice(ptr, ptr + 9).map((t, k) => `<span class="tape-tok${k === 0 ? ' la' : ''}" title="${esc(t[0])}">${esc(t[1])}<i>${esc(t[0])}</i></span>`).join('') +
      (ptr >= toks.length ? '<span class="tape-tok la">$<i>end</i></span>' : (toks.length - ptr > 9 ? `<span class="tape-tok more">+${toks.length - ptr - 9}</span>` : '<span class="tape-tok">$<i>end</i></span>'));
    let handle = 0;
    const m = /^reduce (.+?) -> (.*)$/.exec(action);
    if (m) handle = m[2] === 'ε' || m[2] === '' ? 0 : m[2].split(' ').length;
    const top = +stack[stack.length - 1];
    const g = state.grammar;
    const kernel = g && g.lalr ? g.lalr.states[top].filter((it) => it.kernel) : [];
    const kind = action.startsWith('shift') ? 'sh' : action.startsWith('reduce') ? 'rd' : action === 'accept' ? 'acc' : 'err';
    return `<div class="card player" id="lr-player" tabindex="0">
      <div class="card-title"><h4>Parse player · step ${row[0]} of ${fmt(d.syntax.lr_trace.total)}</h4><span class="sub">the LALR(1) driver, one action at a time · Space plays, ← → step</span></div>
      ${playerBar('lr', i, n, `${i + 1} / ${n}`)}
      <div class="player-grid">
        <div><div class="lr-sub">State stack <span class="dim">(top on the right)</span></div>
          <div class="stack-row">${stack.map((s, k) => `<span class="st${k === stack.length - 1 ? ' top' : ''}">${esc(s)}</span>`).join('')}</div>
          <div class="lr-sub" style="margin-top:10px">Symbol stack</div>
          <div class="stack-row">${syms.length ? syms.map((s, k) => `<span class="sy${k >= syms.length - handle && handle ? ' handle' : ''}${/^[A-Z$]/.test(s) ? ' term' : ''}">${esc(s)}</span>`).join('') : '<span class="dim">empty</span>'}</div>
          <div class="lr-sub" style="margin-top:10px">Remaining input <span class="dim">(look-ahead first)</span></div>
          <div class="tape">${tape}</div></div>
        <div><div class="lr-sub">Action</div><div class="action-box ${kind}">${esc(action)}</div>
          ${handle ? `<p class="note" style="margin:6px 0 0">pops ${plural(handle, 'symbol')} and ${plural(handle, 'state')}, then GOTO on the left-hand side</p>` : kind === 'sh' ? '<p class="note" style="margin:6px 0 0">pushes the look-ahead and the new state</p>' : ''}
          <div class="lr-sub" style="margin-top:12px">Kernel items of state ${top} <span data-lrstate="${top}" class="lr-link">(open)</span></div>
          <div class="lr-items">${kernel.map((it) => `<div class="lr-item kernel"><span class="lhs">${esc(it.lhs)}</span> → <span class="rhs">${esc(it.rhs)}</span><span class="la">{${esc(it.la.slice(0, 6).join(' '))}${it.la.length > 6 ? ' …' : ''}}</span></div>`).join('') || '<span class="dim">load the grammar to see items</span>'}</div></div>
      </div></div>`;
  }

  function vmStepper() {
    const d = state.data;
    const r = d.run;
    const rows = r.trace.rows;
    if (!rows.length || !d.bytecode) return '';
    const n = rows.length;
    const i = Math.max(0, Math.min(n - 1, state.vm.i | 0));
    state.vm.i = i;
    const [step, func, pc, instr, stackS, depth, localsS] = rows[i];
    const fn = d.bytecode.functions.find((f) => f.name === func);
    const code = fn ? fn.code : [];
    const stack = String(stackS).replace(/^\[|\]$/g, '').split(', ').filter((s) => s !== '');
    const locals = String(localsS || '').split(', ').filter(Boolean).map((kv) => kv.split('='));
    let printed = 0;
    for (let k = 0; k < i; k++) if (String(rows[k][3]).startsWith('PRINT')) printed++;
    const out = r.output.slice(0, printed);
    const listing = code.map((c, k) => `<div class="vm-row${k === pc ? ' cur' : ''}"><span class="pc">${k}</span><span class="ins">${highlightIR(c)}</span></div>`).join('');
    return `<div class="card player" id="vm-stepper" tabindex="0">
      <div class="card-title"><h4>VM stepper · step ${step} of ${fmt(r.steps)}${r.trace.total < r.steps ? ` <span class="dim">(first ${fmt(r.trace.total)} traced)</span>` : ''}</h4>
        <span class="sub">frame <code class="inline">${esc(func)}</code> · depth ${depth} of ${r.max_frames} · Space plays, ← → step</span></div>
      ${playerBar('vm', i, n, `${i + 1} / ${n}`)}
      <div class="player-grid">
        <div class="vm-code" id="vm-code">${listing}</div>
        <div>
          <div class="lr-sub">Operand stack <span class="dim">(top first)</span></div>
          <div class="vm-stack">${stack.length ? stack.slice().reverse().map((v, k) => `<span class="st${k === 0 ? ' top' : ''}">${esc(v)}</span>`).join('') : '<span class="dim">empty</span>'}</div>
          <div class="lr-sub" style="margin-top:10px">Locals of this frame</div>
          <div class="vm-locals">${locals.map(([k, v]) => `<span class="loc"><b>${esc(k)}</b>${esc(v)}</span>`).join('') || '<span class="dim">none</span>'}</div>
          <div class="lr-sub" style="margin-top:10px">Call depth</div>
          <div class="bar-track" style="height:10px"><div class="bar-fill" style="width:${(100 * depth / Math.max(1, r.max_frames)).toFixed(1)}%"></div></div>
          <div class="dim" style="font-size:12px;margin-top:4px">${plural(depth, 'activation record')} on the stack · deepest ${r.max_frames}</div>
          <div class="lr-sub" style="margin-top:10px">Output so far</div>
          <div class="hero-out" style="margin:0;max-height:120px;padding:8px 10px">${out.length ? out.map((l) => `<div class="out-line"><span class="pfx">›</span><span>${esc(l)}</span></div>`).join('') : '<span class="dim">nothing printed yet</span>'}</div>
        </div></div></div>`;
  }

  function regTimeline(f) {
    const rows = f.decisions.rows;
    if (!rows.length) return '';
    const N = f.registers || 4;
    const MAXCOL = 48;
    const cols = rows.slice(0, MAXCOL);
    const colour = new Map();
    const hue = (v) => { if (!colour.has(v)) colour.set(v, colour.size % 10); return colour.get(v); };
    const grid = [];
    for (let r = 0; r < N; r++) grid.push([]);
    cols.forEach((row) => {
      const rd = String(row[2]);
      for (let r = 0; r < N; r++) {
        const m = new RegExp(`R${r}=([^,]+)`).exec(rd);
        const v = m ? m[1].trim() : '-';
        grid[r].push(v === '-' ? null : v);
      }
    });
    const head = cols.map((row) => `<th class="tl-h" title="${esc(row[1])}"><span>${esc(String(row[0]).replace(/^B/, ''))}</span></th>`).join('');
    const body = grid.map((cells, r) => `<tr><th class="tl-r">R${r}</th>${cells.map((v, k) => {
      const prev = k ? cells[k - 1] : null;
      const start = v && v !== prev;
      return v ? `<td class="tl-c v${hue(v)}${start ? ' start' : ''}">${start ? esc(v) : ''}</td>` : '<td class="tl-c e"></td>';
    }).join('')}</tr>`).join('');
    const vars = [...colour.keys()];
    return `<div class="card"><div class="card-title"><h4>Register occupancy, instruction by instruction</h4>
        <span class="sub">${cols.length < rows.length ? `first ${cols.length} of ${fmt(rows.length)} decisions · ` : ''}a run of colour is one value staying in a register</span></div>
      <div class="tbl-scroll"><table class="tl"><thead><tr><th class="tl-r"></th>${head}</tr></thead><tbody>${body}</tbody></table></div>
      <div class="tl-legend">${vars.map((v) => `<span class="tl-key v${hue(v)}">${esc(v)}</span>`).join('')}</div></div>`;
  }

  function domTree(f) {
    const cfg = f.cfg_after;
    const kids = {};
    Object.entries(f.idom || {}).forEach(([b, p]) => { (kids[p] = kids[p] || []).push(+b); });
    const dfOf = {};
    f.dominators.rows.forEach((r) => { dfOf[String(r[0]).slice(1)] = String(r[2]); });
    const build = (b) => ({ label: `B${b}`, type: dfOf[b] && dfOf[b] !== '{}' ? 'DF ' + dfOf[b] : '', kids: (kids[b] || []).sort((a, c) => a - c).map(build) });
    return treeSvg(build(cfg.entry), { minW: 54, hgap: 18, vgap: 34, kind: (n) => (n.label === `B${cfg.entry}` ? 'kw' : 'id'), aria: 'dominator tree' });
  }

  function astRoots(tree) {
    const roots = [];
    (tree.kids || []).forEach((k, i) => {
      if (k.label === 'main') k.kids.forEach((s, j) => roots.push({ key: `m${j}`, title: `main · ${s.label}${s.line ? ' (line ' + s.line + ')' : ''}`, node: s }));
      else roots.push({ key: `f${i}`, title: k.label, node: k });
    });
    return roots;
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
      if (state.scanIdx < 0 || state.scanIdx >= toks.length) {
        const k = toks.findIndex((t) => KEYWORDS.has(String(t[1])));
        state.scanIdx = k >= 0 ? k : 0;
      }
      h += `<div class="card"><div class="tokstream">${toks.slice(0, 700).map((t, i) => {
        const ty = t[0];
        const kw = KEYWORDS.has(String(t[1]));
        const cls = kw ? 'kw' : ty === 'NUMBER' ? 'num' : ty === 'STRING' ? 'str' : ty === 'IDENT' ? '' : 'op';
        return `<button class="tok ${cls}${i === state.scanIdx ? ' sel' : ''}" data-scan="${i}" title="${esc(ty)} at ${t[2]}:${t[3]} - click to trace">${esc(t[1])}${kw ? '' : `<i>${esc(ty)}</i>`}</button>`;
      }).join('')}${toks.length > 700 ? `<span class="tok op">+${fmt(toks.length - 700)} more</span>` : ''}</div></div>`;
      h += scannerTrace(lx);
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
      h += parsePlayer();
      h += sec('The LALR(1) automaton', 'the states the driver walks and the table it consults');
      h += lrStateCard();
      h += fold('syn-table', 'ACTION / GOTO table', lrTable(), g && g.lalr ? `${fmt(g.lalr.n_states)} states` : '');
      h += sec('Every step', 'the complete trace');
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
      if (sm.ast_tree) {
        const roots = astRoots(sm.ast_tree);
        if (!roots.some((r) => r.key === state.astRoot)) state.astRoot = roots.length ? roots[0].key : null;
        const cur = roots.find((r) => r.key === state.astRoot);
        h += sec('Annotated syntax tree', 'every node carries the type the checker synthesised for it');
        h += `<div class="chips" style="margin-bottom:10px">${roots.map((r) => `<button class="chip${r.key === state.astRoot ? ' on' : ''}" data-ast="${r.key}">${esc(r.title)}</button>`).join('')}</div>`;
        if (cur) h += `<div class="graph-box">${treeSvg(cur.node, { aria: 'annotated syntax tree' })}</div>`;
      }
      h += fold('sem-ast-text', 'Syntax tree as text', code('ast', sm.ast, { lang: 'ir', height: 620 }), 'the same tree, indented');
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
      if (f.dag_graph && f.dag_graph.length) {
        if (!f.dag_graph.some((b) => b.block === state.dagBlock)) {
          const best = f.dag_graph.slice().sort((a, b) => b.nodes.length - a.nodes.length)[0];
          state.dagBlock = best.block;
        }
        const cur = f.dag_graph.find((b) => b.block === state.dagBlock);
        h += sec('DAG of a basic block', 'two instructions that land on one node are the same computation - that is how common subexpressions are found');
        h += `<div class="chips" style="margin-bottom:10px">${f.dag_graph.map((b) => `<button class="chip${b.block === state.dagBlock ? ' on' : ''}" data-dag="${b.block}">B${b.block} <span class="dim">· ${b.nodes.length}</span></button>`).join('')}</div>`;
        if (cur) h += `<div class="graph-box">${dagSvg(cur.nodes)}</div>`;
        h += fold('opt-dag-text-' + f.name, 'DAG as text', code('dag / value numbering', f.dag.flatMap((b) => [`B${b.block}:`, ...b.nodes.map((n) => '   ' + n)]), { plain: true }));
      }
      if (f.opt_notes.length) h += fold('opt-notes-' + f.name, 'Optimiser notes', code('notes', f.opt_notes, { lang: 'text', plain: true }), `${f.opt_notes.length}`);
      return h;
    },

    dataflow() {
      const f = fnData();
      if (!f) return needsCompiled('Module 5');
      let h = head('Module 5 · Data-flow analysis', `Four analyses over ${f.name}`,
        'Each analysis starts from an initial guess and applies its transfer function round after round until nothing changes - the fixed point. The rounds below are the real ones.');
      if (f.dataflow.length) {
        if (!f.dataflow.some((a) => a.name === state.dfSel)) state.dfSel = f.dataflow[0].name;
        const a = f.dataflow.find((x) => x.name === state.dfSel);
        const annot = {};
        a.table.rows.forEach((r) => { annot[+String(r[0]).slice(1)] = [`IN  ${r[1]}`, `OUT ${r[2]}`]; });
        h += `<div class="sec"><h3>Facts on the flow graph</h3><span class="aside">${esc(a.name)} · ${a.direction} · meet ${a.meet}</span></div>
          <div class="chips" style="margin-bottom:10px">${f.dataflow.map((x) => `<button class="chip${x.name === state.dfSel ? ' on' : ''}" data-df="${esc(x.name)}">${esc(x.name)}</button>`).join('')}</div>
          <div class="cfg-box">${cfgSvg(f.cfg_before, { annot })}</div>`;
        h += sec('The solutions and how they converged');
      }
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
      h += regTimeline(f);
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
      h += sec('Dominator tree', 'a block’s children are the blocks it immediately dominates; DF is its dominance frontier');
      h += `<div class="graph-box">${domTree(f)}</div>`;
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
      h += sec('Step through the machine', 'the operand stack, the locals and the call depth at every instruction');
      h += vmStepper();
      h += sec('Execution trace', `first ${fmt(r.trace.total)} steps`);
      h += table('run-trace', [{ t: 'Step', cls: 'num' }, { t: 'Function', cls: 'mono' }, { t: 'pc', cls: 'num' }, { t: 'Instruction', fmt: (v) => `<span class="mono">${highlightIR(String(v))}</span>` },
        { t: 'Operand stack', cls: 'mono dim' }, { t: 'Depth', cls: 'num' }, { t: 'Locals', cls: 'mono dim clip' }], r.trace, { noun: 'steps', limit: 120 });
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
      h += `<div class="card"><div class="card-title"><h4>Take the data with you</h4><span class="sub">the whole glass box as one JSON document</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn small" data-action="download-json">Download compile JSON</button>
        <button class="btn small ghost" data-action="share">Copy a link to this program</button></div></div>`;
      return h;
    },

    syllabus() {
      const d = state.data;
      const s = d.summary;
      const g = state.grammar;
      const lx = d.lexical ? d.lexical.stats : null;
      const sx = d.syntax;
      const bc = d.bytecode;
      const run = d.run;
      const lalr = sx.tables.find((t) => t.kind.startsWith('LALR'));
      const clr = sx.tables.find((t) => t.kind.startsWith('CLR'));
      const mods = [
        { n: 'M1', title: 'Compilation & lexical analysis', asks: 'regular expressions, finite automata, scanner generation; introduction to LLVM',
          does: 'Every token is an extended regular expression; nullable / firstpos / lastpos / followpos build the DFA directly (no NFA), Moore’s algorithm minimises it, and the scanner runs it with maximal munch. A third back-end prints textual LLVM IR.',
          fact: lx ? `${lx.token_patterns} patterns → ${lx.dfa_states_after_min}-state DFA · ${fmt(s.tokens)} tokens in this program` : 'not reached', see: [['lexical', 'Lexical'], ['ssa', 'LLVM IR']] },
        { n: 'M2', title: 'Syntax analysis', asks: 'context-free grammars, ambiguity, top-down (LL) and bottom-up (SLR, CLR, LALR) parsing, error recovery',
          does: 'FIRST/FOLLOW and the LL(1) table with every conflict explained; left-recursion elimination; SLR(1), CLR(1) and LALR(1) tables built from one grammar and compared; a recursive-descent parser with panic-mode recovery, cross-checked by an LALR(1) driver whose every step is shown.',
          fact: lalr ? `LALR ${fmt(lalr.states)} states / ${fmt(lalr.entries)} entries${clr ? ` vs CLR ${fmt(clr.states)} / ${fmt(clr.entries)}` : ''} · ${fmt(s.lr_steps)} parse steps` : 'tables cached', see: [['syntax', 'Syntax']] },
        { n: 'M3', title: 'Semantic analysis', asks: 'symbol tables, scopes, type checking, syntax-directed definitions with inherited and synthesised attributes',
          does: 'A scoped symbol table with shadowing; one L-attributed pass computes every attribute, logging which flowed down and which flowed up; a poisoned error type stops cascades.',
          fact: `${fmt(s.symbols)} symbols · ${d.semantic ? fmt(d.semantic.sdd.total) : 0} attribute events · ${plural(s.errors, 'error')}, ${plural(s.warnings, 'warning')}`, see: [['semantic', 'Semantics']] },
        { n: 'M4', title: 'Intermediate code generation', asks: 'three-address code, syntax-directed translation, backpatching, control-flow translation',
          does: 'Quadruples from an SDT scheme; booleans as short-circuit jumping code; makelist / merge / backpatch with every patch logged; case → a real jump table.',
          fact: d.functions.length ? `${fmt(d.functions.reduce((a, f) => a + f.ir.length, 0))} quadruples · ${plural(d.backpatch.length, 'backpatch')}` : 'not reached', see: [['ir', 'Three-address']] },
        { n: 'M5', title: 'Code optimisation & data-flow analysis', asks: 'basic blocks, flow graphs, DAGs, local and global optimisation, data-flow frameworks',
          does: 'Leaders → blocks → CFG with dominators and natural loops; DAG / value numbering; reaching definitions, liveness, available and very busy expressions solved to a fixed point with every round kept; eight passes that report what they removed.',
          fact: d.functions.length ? `${s.ir_before} → ${s.ir_after} IR instructions · ${plural(s.blocks, 'block')} · ${plural(s.loops, 'loop')}` : 'not reached', see: [['optimiser', 'Optimiser'], ['dataflow', 'Data flow']] },
        { n: 'M6', title: 'Code generation', asks: 'next-use information, register allocation, activation records, a naive code generator for a virtual machine',
          does: 'Next-use by backward scan; getreg with register and address descriptors and Belady spilling; activation records with return address and control link; two executable targets - a register machine and a stack bytecode - that must agree.',
          fact: d.functions.length ? `${fmt(d.functions.reduce((a, f) => a + f.target.length, 0))} target instructions · ${plural(s.spills, 'spill')} · ${bc ? fmt(bc.opt_total) + ' bytecode' : ''}` : 'not reached', see: [['codegen', 'Code gen'], ['verify', 'Bytecode']] },
        { n: 'M7', title: 'Parallelism, SSA and domain-specific languages', asks: 'static single assignment, dominance frontiers, dependence analysis, automatic parallelisation',
          does: 'φ-functions placed on iterated dominance frontiers and renamed over the dominator tree; loops classified as vectorisable, reductions or sequential from their carried dependences; interchange and tiling advice for nested loops.',
          fact: d.functions.length ? `${plural(s.phis, 'φ-function')} · ${plural(s.loops, 'loop')} analysed` : 'not reached', see: [['ssa', 'SSA & parallel']] },
        { n: 'M8', title: 'Contemporary issues', asks: 'security checking of virtual-machine code, sandboxing, hostile input',
          does: 'Abstract interpretation proves six properties of the bytecode before it runs; the VM enforces instruction, frame and stack budgets; eight hand-written attacks are stopped - six statically, two by the sandbox.',
          fact: d.verifier.length ? `${d.verifier.reduce((a, v) => a + v.checks.length, 0)} properties proved · ${run ? fmt(run.steps) + ' steps run' : ''}` : 'not reached', see: [['verify', 'Verifier'], ['security', 'Security lab'], ['run', 'Execution']] },
      ];
      let h = head('Syllabus map', 'Eight modules, one program', 'What each module of the Compiler Design syllabus asks for, what Nova does about it, and where to see it on this very program.');
      h += '<div class="syl-grid">' + mods.map((m) => `<div class="card syl">
          <div class="syl-head"><span class="syl-n">${m.n}</span><h4>${esc(m.title)}</h4></div>
          <div class="syl-asks">${esc(m.asks)}</div>
          <p>${esc(m.does)}</p>
          <div class="syl-fact">${esc(m.fact)}</div>
          <div class="chips">${m.see.map(([t, l]) => `<button class="chip" data-tab="${t}">${esc(l)} →</button>`).join('')}</div></div>`).join('') + '</div>';
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
    stopTimers();
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
    let src = null;
    if (p.get('src')) { try { src = b64.dec(p.get('src')); } catch (e) { src = null; } }
    return { tab: p.get('tab'), fn: p.get('fn'), example: p.get('example'), src };
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
    $('#btn-share').addEventListener('click', shareLink);

    const live = $('#live');
    const opt = $('#optimise');
    live.checked = state.live;
    opt.checked = state.optimise;
    live.addEventListener('change', () => { state.live = live.checked; store.set('live', state.live); if (state.live) compile('live'); toast(state.live ? 'Live compile on' : 'Live compile off - press Run', ''); });
    opt.addEventListener('change', () => { state.optimise = opt.checked; store.set('optimise', state.optimise); compile('run', true); });

    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab],[data-fn],[data-copy],[data-more],[data-cfg],[data-action],[data-dock],[data-dock-open],.problem,[data-scan],[data-lrstate],[data-lrstep],[data-lrpage],[data-pstep],[data-ast],[data-dag],[data-df]');
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
      else if (t.dataset.action === 'download-json') downloadJson();
      else if (t.dataset.action === 'share') shareLink();
      else if (t.dataset.dock) showDock(t.dataset.dock);
      else if (t.dataset.dockOpen) showDock(t.dataset.dockOpen);
      else if (t.classList.contains('problem')) jumpToLine(+t.dataset.line, +t.dataset.col);
      else if (t.dataset.scan != null) { state.scanIdx = +t.dataset.scan; renderView(false); }
      else if (t.dataset.lrstate != null) { state.lrState = +t.dataset.lrstate; replaceCard('#lr-card', lrStateCard()); }
      else if (t.dataset.lrstep) { state.lrState += +t.dataset.lrstep; replaceCard('#lr-card', lrStateCard()); }
      else if (t.dataset.lrpage) { state.lrFrom += 18 * +t.dataset.lrpage; replaceCard('#lr-table', lrTable()); }
      else if (t.dataset.pstep) playerStep(t.closest('[data-player]').dataset.player, t.dataset.pstep);
      else if (t.dataset.ast) { state.astRoot = t.dataset.ast; renderView(false); }
      else if (t.dataset.dag) { state.dagBlock = +t.dataset.dag; renderView(false); }
      else if (t.dataset.df) { state.dfSel = t.dataset.df; renderView(false); }
    });

    view.addEventListener('input', (e) => {
      if (e.target.id === 'lr-state-input') { state.lrState = +e.target.value; const c = $('#lr-card'); if (c) { c.outerHTML = lrStateCard(); const inp = $('#lr-state-input'); if (inp) inp.focus(); } return; }
      if (e.target.classList.contains('player-range')) { playerSet(e.target.closest('[data-player]').dataset.player, +e.target.value); return; }
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
      const pl = e.target.closest && e.target.closest('.player');
      if (pl && !mod && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName) && [' ', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        const id = pl.querySelector('[data-player]').dataset.player;
        playerStep(id, { ' ': 'play', ArrowLeft: '-1', ArrowRight: '1', Home: 'first', End: 'last' }[e.key]);
        return;
      }
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

  // ---- players (LR parse, VM) ---------------------------------------
  const PLAYERS = {
    lr: { get: () => state.player, max: () => (state.data ? state.data.syntax.lr_trace.rows.length : 0), render: () => replaceCard('#lr-player', parsePlayer()), ms: 420 },
    vm: { get: () => state.vm, max: () => (state.data && state.data.run ? state.data.run.trace.rows.length : 0), render: () => { replaceCard('#vm-stepper', vmStepper()); const c = $('#vm-code .cur'); if (c) c.scrollIntoView({ block: 'nearest' }); }, ms: 260 },
  };

  function replaceCard(sel, html) {
    const el = $(sel);
    if (el) el.outerHTML = html;
  }

  function playerSet(id, i) {
    const p = PLAYERS[id];
    if (!p) return;
    const n = p.max();
    p.get().i = Math.max(0, Math.min(n - 1, i));
    const had = document.activeElement && document.activeElement.closest('.player');
    p.render();
    if (had) { const c = $(id === 'lr' ? '#lr-player' : '#vm-stepper'); if (c) c.focus({ preventScroll: true }); }
  }

  function playerStep(id, how) {
    const p = PLAYERS[id];
    if (!p) return;
    const s = p.get();
    const n = p.max();
    if (how === 'play') {
      if (state.timers[id]) { clearInterval(state.timers[id]); delete state.timers[id]; p.render(); return; }
      state.timers[id] = setInterval(() => {
        if (s.i >= n - 1) { clearInterval(state.timers[id]); delete state.timers[id]; p.render(); return; }
        s.i += 1;
        p.render();
      }, p.ms);
      p.render();
      return;
    }
    if (how === 'first') s.i = 0;
    else if (how === 'last') s.i = n - 1;
    else s.i += +how;
    playerSet(id, s.i);
  }

  function downloadJson() {
    if (!state.data) return;
    const blob = new Blob([JSON.stringify(state.data, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = state.fileName.replace(/\.[^.]+$/, '') + '.compile.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Compile JSON downloaded', 'ok');
  }

  const b64 = {
    enc: (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    dec: (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))),
  };

  function shareLink() {
    const p = new URLSearchParams();
    p.set('tab', state.tab);
    p.set('src', b64.enc(ta.value));
    const url = `${location.origin}${location.pathname}#${p.toString()}`;
    if (url.length > 8000) { toast('This program is too long for a link - use Download instead', 'bad'); return; }
    copyText(url, 'Link copied - it carries the whole program');
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
    if (h.src != null) {
      sel.value = '';
      loadSource(h.src, 'shared.nova', null);
      toast('Opened the program from the link', 'ok');
    } else if (h.example && state.examples.some((e) => e.file === h.example)) {
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
