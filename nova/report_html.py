"""
nova.report_html - the Glass-Box viewer as a single self-contained HTML file.

Same content as the desktop window, but it needs nothing except a browser, which
makes it the easiest way to take the screenshots a project report needs.  No
external CSS, no JavaScript libraries, no internet: one file you can e-mail.
"""
from __future__ import annotations

import html
from typing import Dict, List, Optional, Sequence

from .cfg import CFG, fmt_block
from .dataflow import fmt_def, fmt_expr
from .grammar import EOF, EPS
from .nova_grammar import AMBIGUOUS_NOVA_EXPR, NOVA_GRAMMAR
from .lr import LRBuilder
from .pipeline import CompileResult

CSS = """
:root{
  --ink:#f4f4f3; --muted:#9a9aa4; --line:#26262c; --bg:#09090b; --panel:#121215;
  --accent:#ff7a1a; --accent2:#ff9a45; --warn:#ff5d5d; --ok:#3ddc97;
  --code:#0b0b0d; --head:#18181c;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
     font-family:Segoe UI,Calibri,Arial,sans-serif;font-size:15px;line-height:1.55}
header{background:radial-gradient(900px 260px at 0 0,rgba(255,122,26,.20),transparent 70%),
       #0d0d10;color:var(--ink);padding:28px 34px;border-bottom:1px solid var(--line)}
header h1{margin:0 0 6px;font-size:27px;letter-spacing:-.2px}
header h1 b{color:var(--accent)}
header .sub{color:var(--muted);font-size:14px}
header .pills{margin-top:14px}
.pill{display:inline-block;background:rgba(255,122,26,.10);color:#ffc38a;
      border:1px solid rgba(255,122,26,.35);border-radius:20px;
      padding:3px 12px;margin:3px 6px 3px 0;font-size:12.5px}
.pill.bad{background:rgba(255,93,93,.12);color:#ff9d9d;border-color:rgba(255,93,93,.4)}
nav{display:flex;flex-wrap:wrap;gap:4px;background:#0d0d10;padding:0 22px;
    border-bottom:1px solid var(--line);position:sticky;top:0;z-index:2}
nav button{background:transparent;color:var(--muted);border:0;padding:12px 14px 11px;
     cursor:pointer;font-size:13.5px;font-family:inherit;border-bottom:2px solid transparent}
nav button:hover{color:var(--ink)}
nav button.on{color:var(--ink);font-weight:600;border-bottom-color:var(--accent)}
main{padding:26px 34px 70px;max-width:1500px}
section{display:none}
section.on{display:block}
h2{font-size:22px;margin:4px 0 4px;letter-spacing:-.2px}
h3{font-size:16.5px;margin:28px 0 8px;color:var(--accent2)}
p.note{color:var(--muted);margin:2px 0 16px;max-width:960px}
.card{background:linear-gradient(180deg,#141417,#101013);border:1px solid var(--line);
      border-radius:12px;padding:16px 18px;margin:0 0 18px;overflow:auto}
table{border-collapse:collapse;width:100%;font-size:13.5px}
th{background:var(--head);color:var(--muted);text-align:left;padding:8px 10px;
   border-bottom:1px solid #33333b;font-weight:600;white-space:nowrap;font-size:12px;
   text-transform:uppercase;letter-spacing:.05em}
td{padding:6px 10px;border-bottom:1px solid #1c1c21;vertical-align:top}
tr:hover td{background:rgba(255,122,26,.05)}
pre{background:var(--code);color:#e4e4e6;padding:14px 16px;border-radius:9px;
    border:1px solid var(--line);overflow:auto;font-family:Consolas,Courier New,monospace;
    font-size:13px;line-height:1.5;margin:0}
code{font-family:Consolas,Courier New,monospace;background:#1c1c21;color:#ffc38a;
     padding:1px 5px;border-radius:4px;font-size:13px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.stat{display:inline-block;min-width:150px;margin:0 22px 14px 0}
.stat b{display:block;font-size:27px;color:var(--accent)}
.stat span{color:var(--muted);font-size:12.5px}
.ok{color:var(--ok);font-weight:600}
.bad{color:var(--warn);font-weight:600}
.warn{color:var(--accent2);font-weight:600}
.small{font-size:12.5px;color:var(--muted)}
ul.tight{margin:6px 0 0 18px;padding:0}
ul.tight li{margin:3px 0}
@media print{
  :root{--ink:#111;--muted:#555;--line:#ddd;--bg:#fff;--panel:#fff;--code:#f6f6f6;--head:#f2f2f2}
  header,nav{background:#fff;color:#111}
  nav{display:none}
  section{display:block !important;page-break-before:always}
  .card,pre{background:#fff;color:#111}
  code{background:#f2f2f2;color:#8a3a00}
  td{border-bottom-color:#eee}
}
"""

JS = """
function show(i){
  document.querySelectorAll('section').forEach(function(s,k){
    s.className = (k===i)?'on':''; });
  document.querySelectorAll('nav button').forEach(function(b,k){
    b.className = (k===i)?'on':''; });
  window.scrollTo(0,0);
}
"""


def esc(x) -> str:
    return html.escape(str(x))


def table(headers: Sequence[str], rows: Sequence[Sequence[str]],
          limit: int = 400) -> str:
    body = ""
    for r in rows[:limit]:
        body += "<tr>" + "".join(f"<td>{esc(c)}</td>" for c in r) + "</tr>"
    extra = ""
    if len(rows) > limit:
        extra = (f"<p class='small'>showing the first {limit} of "
                 f"{len(rows)} rows</p>")
    return ("<div class='card'><table><tr>" +
            "".join(f"<th>{esc(h)}</th>" for h in headers) +
            "</tr>" + body + "</table>" + extra + "</div>")


def pre(text: str) -> str:
    return f"<div class='card'><pre>{esc(text)}</pre></div>"


def stat(value, label) -> str:
    return f"<div class='stat'><b>{esc(value)}</b><span>{esc(label)}</span></div>"


# --------------------------------------------------------------- CFG as SVG
def cfg_svg(cfg: CFG, title: str = "") -> str:
    n = len(cfg.blocks)
    if n == 0:
        return "<p class='small'>no blocks</p>"
    level: Dict[int, int] = {cfg.entry: 0}
    order = [cfg.entry]
    seen = {cfg.entry}
    while order:
        b = order.pop(0)
        for s in cfg.blocks[b].succs:
            if s < n and s not in seen:
                seen.add(s)
                level[s] = level[b] + 1
                order.append(s)
    for i in range(n):
        level.setdefault(i, 0)
    rows: Dict[int, List[int]] = {}
    for i in range(n):
        rows.setdefault(level[i], []).append(i)

    BW, LH, VGAP, HGAP = 250, 15, 62, 26
    pos: Dict[int, tuple] = {}
    heights: Dict[int, int] = {}
    y = 20
    width = 0
    for lv in sorted(rows):
        h = max(28 + LH * len(cfg.blocks[b].quads) for b in rows[lv])
        x = 20
        for b in rows[lv]:
            pos[b] = (x, y)
            heights[b] = 28 + LH * max(1, len(cfg.blocks[b].quads))
            x += BW + HGAP
        width = max(width, x)
        y += h + VGAP
    height = y

    parts = [f'<svg viewBox="0 0 {width} {height}" width="100%" '
             f'style="max-width:{width}px;background:#0b0b0d;border:1px solid #26262c;'
             f'border-radius:10px" xmlns="http://www.w3.org/2000/svg">']
    parts.append('<defs><marker id="ar" markerWidth="9" markerHeight="9" refX="8" '
                 'refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#6a6a76"/>'
                 '</marker><marker id="ar-o" markerWidth="9" markerHeight="9" refX="8" '
                 'refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#ff7a1a"/>'
                 '</marker></defs>')
    for i, b in enumerate(cfg.blocks):
        x, yy = pos[i]
        hgt = heights[i]
        for s in b.succs:
            if s >= n:
                continue
            sx, sy = pos[s]
            x1, y1 = x + BW / 2, yy + hgt
            x2, y2 = sx + BW / 2, sy
            if sy <= yy:                       # back edge - draw it round the side
                parts.append(
                    f'<path d="M{x + BW} {yy + hgt / 2} C{x + BW + 46} '
                    f'{yy + hgt / 2}, {sx + BW + 46} {sy + 12}, {sx + BW} {sy + 12}" '
                    f'fill="none" stroke="#ff7a1a" stroke-width="1.6" '
                    f'marker-end="url(#ar-o)" stroke-dasharray="5,3"/>')
            else:
                parts.append(
                    f'<path d="M{x1} {y1} C{x1} {y1 + 26}, {x2} {y2 - 26}, {x2} {y2}" '
                    f'fill="none" stroke="#5a5a66" stroke-width="1.4" '
                    f'marker-end="url(#ar)"/>')
    for i, b in enumerate(cfg.blocks):
        x, yy = pos[i]
        hgt = heights[i]
        entry = i == cfg.entry
        parts.append(f'<rect x="{x}" y="{yy}" width="{BW}" height="{hgt}" rx="7" '
                     f'fill="{"#1f140b" if entry else "#141417"}" '
                     f'stroke="{"#ff7a1a" if entry else "#34343c"}" stroke-width="1.3"/>')
        parts.append(f'<text x="{x + 9}" y="{yy + 16}" font-family="Consolas,monospace" '
                     f'font-size="12" font-weight="bold" fill="#ff9a45">B{i}</text>')
        for k, q in enumerate(b.quads[:14]):
            parts.append(
                f'<text x="{x + 9}" y="{yy + 30 + k * LH}" '
                f'font-family="Consolas,monospace" font-size="11.5" fill="#e4e4e6">'
                f'{esc(fmt_block(q)[:34])}</text>')
    parts.append("</svg>")
    return ("<div class='card'>" + (f"<p class='small'>{esc(title)}</p>" if title else "")
            + "".join(parts) + "</div>")


# ==========================================================================
def build_report(res: CompileResult) -> str:
    tabs: List[tuple] = []

    # ------------------------------------------------------------ overview
    ok = res.ok
    cov = [
        ("M1 - Compilation &amp; lexical analysis",
         "regex &rarr; DFA by the direct method, DFA minimisation, hand-built scanner, LLVM IR back-end"),
        ("M2 - Syntax analysis",
         "ambiguity elimination, recursive descent / LL(1), SLR, CLR and LALR tables side by side, parse animation"),
        ("M3 - Semantic analysis",
         "scoped symbol table, type checking as an L-attributed SDD with inherited and synthesised attributes"),
        ("M4 - Intermediate code",
         "three-address code from an SDT scheme, backpatching, short-circuit control flow, case &rarr; jump table"),
        ("M5 - Code optimisation &amp; data flow",
         "basic blocks, flow graph, DAG, CSE, constant/copy propagation, DCE, LICM, strength reduction, 4 data-flow analyses"),
        ("M6 - Code generation",
         "next-use information, register allocation with spilling, activation records, two executable back-ends"),
        ("M7 - Parallelism, DSL, SSA",
         "SSA with dominance frontiers and phi insertion, loop-carried dependence testing, vectorisation report"),
        ("M8 - Contemporary issues",
         "bytecode verification by abstract interpretation and a sandboxed VM - the JVM / WebAssembly / eBPF idea"),
    ]
    o = ["<h2>What this program is</h2>",
         "<p class='note'>Nova is a complete compiler for an original programming "
         "language, written in pure Python. It takes a <code>.nova</code> source "
         "file all the way to bytecode, verifies that bytecode is safe, and runs "
         "it. Every intermediate form the compiler builds is kept and shown, "
         "which is why it is called a glass box: nothing inside is hidden.</p>"]
    o.append("<div class='card'>")
    o.append(stat(len([t for t in res.tokens if t.type != 'EOF']), "tokens"))
    o.append(stat(len(res.functions), "functions compiled"))
    if res.functions:
        o.append(stat(sum(f.n_before for f in res.functions.values()),
                      "IR instructions before"))
        o.append(stat(sum(f.n_after for f in res.functions.values()),
                      "IR instructions after"))
    if res.bprog_opt:
        o.append(stat(res.bprog_opt.total_instructions(), "bytecode instructions"))
    o.append(stat("PASS" if res.verify_ok else "FAIL", "verifier"))
    o.append("</div>")

    o.append("<h3>Source program</h3>")
    o.append(pre(res.source))

    if res.run_opt:
        o.append("<h3>Program output</h3>")
        out = "\n".join(res.run_opt.output) or "(no output)"
        if res.run_opt.error:
            out += "\n\n" + res.run_opt.error
        o.append(pre(out))
        if res.run_reg is not None:
            same = list(res.run_opt.output) == list(getattr(res.run_reg, "output", []))
            o.append(f"<p class='note'>The same program was also executed by the "
                     f"<b>register</b> back-end produced in Module 6. The two "
                     f"back-ends agree: <span class='{'ok' if same else 'bad'}'>"
                     f"{'YES' if same else 'NO'}</span>. Agreement between two "
                     f"independently generated targets is a real correctness check "
                     f"on register allocation.</p>")

    o.append("<h3>Measurements</h3>")
    o.append("<p class='note'>Numbers, not claims. Everything below was produced by "
             "this compilation.</p>")
    o.append(table(["Module", "Measurement", "Value"], res.metrics, 200))

    o.append("<h3>Where each syllabus module is implemented</h3>")
    o.append("<div class='card'><table><tr><th>Module</th><th>What the project does for it</th></tr>"
             + "".join(f"<tr><td><b>{a}</b></td><td>{b}</td></tr>" for a, b in cov)
             + "</table></div>")

    o.append("<h3>Time taken by each phase</h3>")
    o.append(table(["Phase", "Milliseconds"],
                   [[k, f"{v * 1000:.1f}"] for k, v in res.timings.items()]))
    tabs.append(("Overview", "".join(o)))

    # ------------------------------------------------------ M1 lexical
    lx = res.lexer
    o = ["<h2>Module 1 &mdash; Lexical analysis</h2>",
         "<p class='note'>Each token is written as an extended regular expression. "
         "Those expressions are combined into one syntax tree, and "
         "<code>nullable</code>, <code>firstpos</code>, <code>lastpos</code> and "
         "<code>followpos</code> are computed on it &mdash; the <b>direct method</b>, "
         "which builds the DFA without ever constructing an NFA. The DFA is then "
         "minimised and used to scan the input with the longest-match rule. "
         "Python's <code>re</code> module is never imported.</p>"]
    if lx:
        st = lx.dfa_stats()
        o.append("<div class='card'>")
        for k, label in [("token_patterns", "regular expressions"),
                         ("positions", "leaf positions"),
                         ("dfa_states_before_min", "DFA states built"),
                         ("dfa_states_after_min", "after minimisation"),
                         ("symbol_classes", "symbol classes")]:
            o.append(stat(st[k], label))
        o.append("</div>")
        o.append("<h3>The token specifications</h3>")
        from .lexer import TOKEN_SPECS
        o.append(table(["#", "Token", "Extended regular expression"],
                       [[i, n, r] for i, (n, r) in enumerate(TOKEN_SPECS)]))
        o.append("<h3>followpos table (the direct method)</h3>")
        o.append("<p class='note'>followpos(i) is the set of positions that can "
                 "legally come straight after position i. The DFA states are simply "
                 "sets of positions, and this table is what generates them.</p>")
        o.append(table(["Position", "Symbol at that position", "followpos"],
                       lx.followpos_rows(60)))
        o.append("<h3>The minimised DFA</h3>")
        o.append(table(["State", "Accepts", "Transitions"], lx.dfa_table(), 80))
        o.append("<h3>Tokens found in this program</h3>")
        rows = [[t.type, t.lexeme, t.line, t.col, t.attribute]
                for t in res.tokens if t.type != "EOF"]
        o.append(table(["Token", "Lexeme", "Line", "Col", "Attribute"], rows, 250))
    tabs.append(("1. Lexical", "".join(o)))

    # ------------------------------------------------------- M2 syntax
    o = ["<h2>Module 2 &mdash; Syntax analysis</h2>",
         "<p class='note'>The same grammar drives four parsers so they can be "
         "compared honestly: a hand-written recursive-descent parser (which builds "
         "the AST the rest of the compiler uses) and the SLR, CLR and LALR "
         "table-driven parsers (which independently re-parse the same token stream). "
         "If the two disagreed, one of them would be wrong.</p>"]
    g = NOVA_GRAMMAR
    o.append("<h3>The Nova grammar</h3>")
    o.append(pre(str(g)))

    first, follow = g.first_sets(), g.follow_sets()
    rows = [[nt,
             "{" + ", ".join(sorted(first[nt])) + "}",
             "{" + ", ".join(sorted(follow[nt])) + "}"] for nt in g.nonterminals]
    o.append("<h3>FIRST and FOLLOW</h3>")
    o.append(table(["Non-terminal", "FIRST", "FOLLOW"], rows))

    _, ll1conf = g.ll1_table()
    o.append("<h3>Why this grammar is not LL(1)</h3>")
    o.append(f"<p class='note'>The LL(1) table has "
             f"<b>{len(ll1conf)}</b> multiply-defined entries, because the grammar "
             f"is written left-recursively for the natural left-associative "
             f"precedence chain. Left recursion is exactly what a top-down parser "
             f"cannot handle, and exactly what a bottom-up parser eats for "
             f"breakfast &mdash; which is the reason the real parser is LALR.</p>")
    o.append(pre("\n".join(ll1conf[:14]) or "none"))
    g2, log = g.eliminate_left_recursion()
    o.append("<h3>The same grammar after left-recursion elimination</h3>")
    o.append("<p class='note'>A -&gt; A&alpha; | &beta; becomes A -&gt; &beta;A', "
             "A' -&gt; &alpha;A' | &epsilon;. The tool performs the transformation "
             "and re-checks the table.</p>")
    o.append(pre("\n".join(log)))
    _, ll1conf2 = g2.ll1_table()
    o.append(f"<p class='note'>Conflicts remaining after the rewrite: "
             f"<b>{len(ll1conf2)}</b>.</p>")

    o.append("<h3>SLR vs CLR vs LALR on this grammar</h3>")
    rows = []
    for kind in ("SLR", "CLR", "LALR"):
        if kind in res.tables:
            t = res.tables[kind]
            rows.append([t.kind, t.n_states, t.size(), len(t.conflicts),
                         "yes" if not t.conflicts else "no"])
    o.append(table(["Table", "States", "Entries", "Conflicts", "Usable"], rows))
    o.append("<p class='note'>This is the classic result made concrete: CLR has "
             "many more states than LALR for no extra power on this grammar, which "
             "is precisely why real parser generators emit LALR.</p>")

    o.append("<h3>A grammar that <i>does</i> conflict</h3>")
    o.append("<p class='note'>Written ambiguously, with no precedence, the "
             "expression grammar produces genuine shift/reduce conflicts. This is "
             "what the tool reports:</p>")
    ab = LRBuilder(AMBIGUOUS_NOVA_EXPR).build_slr()
    o.append(pre(str(AMBIGUOUS_NOVA_EXPR)))
    o.append(table(["State", "Lookahead", "Kind", "Explanation"],
                   [[c.state, c.symbol, c.kind, c.detail] for c in ab.conflicts]))

    o.append("<h3>Bottom-up parse of your program (LALR)</h3>")
    o.append(f"<p class='note'>Result: "
             f"<span class='{'ok' if res.lr_ok else 'bad'}'>"
             f"{'accepted' if res.lr_ok else esc(res.lr_msg)}</span> in "
             f"{len(res.lr_trace)} steps. Stack, symbols, remaining input and the "
             f"action taken, exactly as the table dictates.</p>")
    o.append(table(["Step", "State stack", "Symbols", "Input", "Action"],
                   [[s.step, s.stack, s.symbols, s.input, s.action]
                    for s in res.lr_trace], 160))
    if res.parser and res.parser.trace:
        o.append("<h3>Top-down derivation (recursive descent), same program</h3>")
        o.append(pre("\n".join(res.parser.trace[:120])))
    tabs.append(("2. Syntax", "".join(o)))

    # ---------------------------------------------------- M3 semantics
    o = ["<h2>Module 3 &mdash; Semantic analysis</h2>",
         "<p class='note'>One pass over the AST computes every attribute. "
         "<b>Inherited</b> attributes travel downwards (which scope am I in, how "
         "deeply nested, which function am I inside, what type does this context "
         "expect); <b>synthesised</b> attributes travel upwards (the type of an "
         "expression). Because no attribute ever needs a value from a sibling to "
         "its right, the definition is L-attributed and one left-to-right pass is "
         "enough.</p>"]
    if res.sema:
        o.append("<h3>Symbol table</h3>")
        o.append(table(["Name", "Kind", "Type", "Scope", "Depth",
                        "Slot in frame", "Line", "Used"], res.sema.symbol_rows()))
        o.append("<h3>Attribute flow, production by production</h3>")
        o.append(table(["Production / construct", "Inherited (passed down)",
                        "Synthesised (passed up)"],
                       [[r["production"], r["inherited"], r["synthesized"]]
                        for r in res.sema.sdd_log], 120))
    if res.ast:
        from .ast_nodes import dump
        o.append("<h3>Annotated syntax tree</h3>")
        o.append("<p class='note'>The type after each colon is the synthesised "
                 "attribute the checker computed for that node.</p>")
        o.append(pre(dump(res.ast)))
    tabs.append(("3. Semantics", "".join(o)))

    # ------------------------------------------------- M4 intermediate code
    o = ["<h2>Module 4 &mdash; Intermediate code</h2>",
         "<p class='note'>Three-address code: at most one operator per instruction, "
         "so every instruction maps to roughly one machine instruction later. "
         "Boolean expressions are compiled as jumping code, so <code>a and b</code> "
         "never evaluates <code>b</code> when <code>a</code> is false. The jump "
         "targets are unknown when the jump is emitted, so they are left blank and "
         "<b>backpatched</b> once the destination is reached.</p>"]
    for name, art in res.functions.items():
        o.append(f"<h3>function <code>{esc(name)}</code>"
                 f"({esc(', '.join(art.params))})</h3>")
        o.append(pre("\n".join(art.ir.listing())))
    if res.tacgen and res.tacgen.patch_log:
        o.append("<h3>Every backpatch this compilation performed</h3>")
        o.append(pre("\n".join(res.tacgen.patch_log)))
    tabs.append(("4. Intermediate code", "".join(o)))

    # -------------------------------------------------------- M5 optimiser
    o = ["<h2>Module 5 &mdash; Optimisation</h2>",
         "<p class='note'>The code is cut into basic blocks (straight-line runs with "
         "one entry and one exit) and the blocks are joined into a flow graph. Every "
         "optimisation below is a transformation of that graph, and each one reports "
         "how many instructions it removed.</p>"]
    for name, art in res.functions.items():
        o.append(f"<h3>function <code>{esc(name)}</code> &mdash; flow graph before "
                 f"optimisation</h3>")
        o.append(cfg_svg(art.cfg_before,
                         "solid arrows = normal flow, dashed orange = back edge "
                         "(a back edge is what makes a loop a loop)"))
        rows = [[r.name, r.before, r.after, r.removed, r.detail]
                for r in art.opt.records]
        o.append("<h3>Pass by pass</h3>")
        o.append(table(["Optimisation pass", "Instructions before", "After",
                        "Removed", "What it did"], rows))
        if art.opt.notes:
            o.append(pre("\n".join(art.opt.notes)))
        o.append("<h3>DAG of each basic block</h3>")
        o.append("<p class='note'>Building the DAG and doing local value numbering "
                 "are the same algorithm. Two instructions that land on the same DAG "
                 "node are the same computation, which is how common sub-expressions "
                 "are found.</p>")
        dagtxt = []
        for bid, nodes in sorted(art.opt.dag_nodes.items()):
            if not nodes:
                continue
            dagtxt.append(f"B{bid}:")
            dagtxt += ["   " + nd.render() for nd in nodes]
        o.append(pre("\n".join(dagtxt) or "(no computations to share)"))
        o.append(f"<h3>function <code>{esc(name)}</code> &mdash; flow graph after "
                 f"optimisation</h3>")
        o.append(cfg_svg(art.cfg_after))
    tabs.append(("5. Optimisation", "".join(o)))

    # -------------------------------------------------------- data flow
    o = ["<h2>Module 5 &mdash; Data-flow analysis</h2>",
         "<p class='note'>Each analysis starts from an initial guess and applies its "
         "transfer function round after round until nothing changes &mdash; the "
         "fixed point. The convergence tables below are the actual rounds, not an "
         "illustration.</p>"]
    for name, art in res.functions.items():
        o.append(f"<h3>function <code>{esc(name)}</code></h3>")
        for df, fmtf in ((art.reaching, fmt_def), (art.live, str),
                         (art.available, fmt_expr), (art.busy, fmt_expr)):
            if df is None:
                continue
            o.append(f"<h3>{esc(df.name)} "
                     f"<span class='small'>({df.direction}, meet = {df.meet}, "
                     f"converged after {len(df.rounds)} round(s))</span></h3>")
            o.append(table(["Block", "IN", "OUT"], df.table(fmtf)))
            if len(df.rounds) > 1:
                o.append(table(["Round", "Block", "IN", "OUT"],
                               df.convergence(fmtf, 3), 60))
    tabs.append(("5b. Data flow", "".join(o)))

    # ------------------------------------------------------------- M6 codegen
    o = ["<h2>Module 6 &mdash; Code generation</h2>",
         "<p class='note'>Registers are scarce, so the generator computes "
         "<b>next-use</b> information: for every value, how far away is the next "
         "instruction that reads it. When all registers are full, the one whose "
         "value is needed furthest in the future is spilled to the activation "
         "record. This is Belady's rule applied to registers, and it is what the "
         "descriptor tables below record.</p>"]
    for name, art in res.functions.items():
        cg = art.codegen
        o.append(f"<h3>function <code>{esc(name)}</code></h3>")
        o.append("<h3>Activation record layout</h3>")
        o.append("<p class='note'>This is what a call pushes onto the run-time "
                 "stack: somewhere to come back to, a link to the caller's frame, "
                 "the parameters and then the locals and temporaries.</p>")
        o.append(table(["Offset", "Holds", "Kind"], cg.frame.rows()))
        o.append("<h3>Next-use information</h3>")
        o.append(table(["Block.instr", "Instruction", "Next use of each name",
                        "Live after"],
                       [[f"B{r.block}.{r.index}", r.instr, r.nextuse, r.live]
                        for r in cg.nextuse_rows], 120))
        o.append("<h3>Register allocation decisions</h3>")
        o.append(table(["At", "Decision", "Register descriptor",
                        "Address descriptor"], cg.decisions, 120))
        o.append(f"<h3>Target code &mdash; {len(cg.code)} instructions, "
                 f"{cg.spills} spill(s)</h3>")
        o.append(pre("\n".join(cg.listing())))
    tabs.append(("6. Code generation", "".join(o)))

    # ------------------------------------------------------------- M7 SSA
    o = ["<h2>Module 7 &mdash; SSA, parallelism and DSLs</h2>",
         "<p class='note'>In static single assignment form every name is written "
         "exactly once, so a use has exactly one definition. Where control flow "
         "merges, a phi function chooses the version that arrived. Phi functions "
         "belong on the <b>dominance frontier</b> of each definition &mdash; the "
         "blocks where that definition stops being the only possibility.</p>"]
    for name, art in res.functions.items():
        o.append(f"<h3>function <code>{esc(name)}</code></h3>")
        df = art.cfg_after.dominance_frontiers()
        o.append(table(["Block", "Immediate dominator", "Dominance frontier"],
                       [[f"B{b}",
                         f"B{art.ssa.idom.get(b)}" if b in art.ssa.idom else "-",
                         "{" + ", ".join(f"B{x}" for x in sorted(df.get(b, set()))) + "}"]
                        for b in range(len(art.cfg_after.blocks))]))
        o.append(pre("\n".join("\n".join(bl) for bl in art.ssa.blocks)))
        o.append(pre("\n".join(art.ssa.notes)))
        if art.loops:
            o.append("<h3>Loop dependence analysis</h3>")
            o.append("<p class='note'>Can the iterations of this loop run at the "
                     "same time? Only if nothing written in one iteration is read by "
                     "the next &mdash; unless it is a recognised reduction.</p>")
            rows = []
            for l in art.loops:
                rows.append([f"B{l.header}",
                             ", ".join(f"B{b}" for b in l.blocks),
                             ", ".join(l.induction) or "-",
                             ", ".join(l.carried) or "none",
                             ", ".join(l.reductions) or "-",
                             l.verdict, l.reason])
            o.append(table(["Header", "Blocks", "Induction variables",
                            "Carried dependences", "Reductions", "Verdict",
                            "Why"], rows))
            sugg = [s for l in art.loops for s in l.suggestions]
            if sugg:
                o.append(pre("\n".join(sugg)))
    o.append("<h3>LLVM IR back-end</h3>")
    o.append("<p class='note'>Textual LLVM IR is plain text, so emitting it needs no "
             "LLVM installation and no C toolchain. Variables become "
             "<code>alloca</code> slots exactly as clang does at -O0; LLVM's own "
             "mem2reg pass would then produce the same SSA form built above.</p>")
    o.append(pre(res.llvm[:9000] + ("\n..." if len(res.llvm) > 9000 else "")))
    tabs.append(("7. SSA &amp; parallelism", "".join(o)))

    # ----------------------------------------------------- M8 verify + run
    o = ["<h2>Module 8 &mdash; Bytecode, verification, sandbox</h2>",
         "<p class='note'>The compiler does not trust its own output. Before "
         "anything runs, the verifier walks the bytecode with types instead of "
         "values and proves five safety properties. This is the same argument the "
         "Java verifier, WebAssembly validation and the Linux kernel's eBPF verifier "
         "make about untrusted code.</p>"]
    for r in res.verify:
        cls = "ok" if r.ok else "bad"
        o.append(f"<h3>function <code>{esc(r.function)}</code> &mdash; "
                 f"<span class='{cls}'>{'VERIFIED' if r.ok else 'REJECTED'}</span></h3>")
        o.append(table(["Property proved", "Result", "Detail"],
                       [[c[0], c[1], c[2]] for c in r.checks]))
        if r.errors:
            o.append(pre("\n".join(r.errors)))
    if res.bprog_opt:
        o.append("<h3>The bytecode</h3>")
        o.append(pre("\n".join(res.bprog_opt.listing())))
    if res.peephole_notes:
        o.append("<h3>Peephole optimisations applied to the final bytecode</h3>")
        o.append(pre("\n".join(res.peephole_notes)))
    tabs.append(("8. Verifier", "".join(o)))

    # ------------------------------------------------------------- run
    o = ["<h2>Running it</h2>"]
    if res.run_opt:
        o.append("<div class='card'>")
        o.append(stat(res.run_opt.steps, "VM instructions executed"))
        if res.run_raw:
            o.append(stat(res.run_raw.steps, "without the optimiser"))
        o.append(stat(res.run_opt.max_frames, "deepest call stack"))
        o.append(stat(res.run_opt.max_stack, "deepest operand stack"))
        o.append("</div>")
        o.append("<h3>Output</h3>")
        o.append(pre("\n".join(res.run_opt.output) or "(none)"))
        if res.run_opt.error:
            o.append(f"<p class='bad'>{esc(res.run_opt.error)}</p>")
        if res.run_opt.frames_snapshots:
            o.append("<h3>The activation-record stack at its deepest</h3>")
            o.append("<p class='note'>Each line is one frame: the function, where it "
                     "will resume, the control link back to its caller, and the "
                     "contents of its locals.</p>")
            o.append(pre("\n".join(res.run_opt.frames_snapshots)))
        o.append("<h3>Execution trace</h3>")
        o.append(table(["Step", "Function", "pc", "Instruction", "Operand stack",
                        "Call depth"],
                       [[t.step, t.func, t.pc, t.instr, t.stack, t.depth]
                        for t in res.run_opt.trace], 250))
    tabs.append(("9. Run", "".join(o)))

    # ---------------------------------------------------------- diagnostics
    o = ["<h2>Diagnostics</h2>",
         "<p class='note'>Every phase records its errors and carries on instead of "
         "stopping at the first one, so one missing semicolon does not produce fifty "
         "cascading messages.</p>"]
    if len(res.errors):
        rows = [[e.phase, f"{e.line}:{e.col}" if e.line else "-", e.message,
                 e.hint or ""] for e in res.errors]
        o.append(table(["Phase", "Line:Col", "Message", "Hint"], rows))
    else:
        o.append("<p class='ok'>No errors or warnings.</p>")
    tabs.append(("Diagnostics", "".join(o)))

    # ---------------------------------------------------------------- shell
    nav = "".join(f"<button class=\"{'on' if i == 0 else ''}\" "
                  f"onclick=\"show({i})\">{t}</button>"
                  for i, (t, _) in enumerate(tabs))
    body = "".join(f"<section class=\"{'on' if i == 0 else ''}\">{c}</section>"
                   for i, (_, c) in enumerate(tabs))
    pills = "".join(f"<span class='pill'>{p}</span>" for p in [
        "regex &rarr; DFA (direct method)", "LL(1) + SLR + CLR + LALR",
        "L-attributed SDD", "backpatching", "DAG + data flow",
        "next-use + register allocation", "SSA + phi", "verifier + sandbox"])
    status = ("<span class='pill'>compiled cleanly</span>" if res.ok else
              "<span class='pill bad'>compilation reported errors</span>")
    return f"""<!doctype html><html><head><meta charset="utf-8">
<title>Nova - Glass-Box Compiler report - {esc(res.path)}</title>
<style>{CSS}</style></head><body>
<header>
  <h1><b>&#10022;</b> Nova &mdash; a glass-box compiler</h1>
  <div class="sub">Every phase of the compilation of
     <b>{esc(res.path)}</b>, opened up and laid out</div>
  <div class="pills">{status}{pills}</div>
</header>
<nav>{nav}</nav>
<main>{body}</main>
<script>{JS}</script>
</body></html>"""
