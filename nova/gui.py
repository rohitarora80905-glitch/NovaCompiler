"""
nova.gui - the Glass-Box desktop window.

Tkinter ships with the Windows Python installer, so this needs no extra package
and no build step.  One tab per compiler phase; the same compilation drives all
of them.  If Tkinter is missing (some Linux distributions ship Python without
it) the command line and the HTML report give identical information.
"""
from __future__ import annotations

import os
import sys
import traceback
from typing import List, Optional

try:
    import tkinter as tk
    from tkinter import filedialog, font as tkfont, messagebox, ttk
    HAVE_TK = True
except Exception:                                   # pragma: no cover
    HAVE_TK = False

from .cfg import fmt_block
from .dataflow import fmt_def, fmt_expr
from .grammar import EOF
from .nova_grammar import AMBIGUOUS_NOVA_EXPR, NOVA_GRAMMAR
from .lr import LRBuilder
from .pipeline import CompileResult, compile_source
from .report_html import build_report

MONO = ("Consolas", 10)
UI = ("Segoe UI", 10)

# Black and orange, the same palette as Nova Studio (nova/web/studio.css).
BG, SURFACE, SURFACE2, LINE = "#0b0b0d", "#141417", "#1c1c21", "#2a2a31"
TEXT, MUTED = "#f4f4f3", "#9a9aa4"
ORANGE, ORANGE_HI, ORANGE_DEEP = "#ff7a1a", "#ff9a45", "#e2470b"
CODE_BG, SELECT = "#0f0f12", "#5a2a0a"
OK, BAD = "#3ddc97", "#ff5d5d"

SAMPLE ='''# Nova - a tiny language, compiled all the way down and run.
func fib(n)
    if n < 2 then return n; end
    return fib(n - 1) + fib(n - 2);
end

let total = 0;
let i = 0;
while i < 10 do
    total = total + fib(i);
    i = i + 1;
end
print total;

case total of
    when 0:  print "zero";
    when 88: print "eighty-eight";
    otherwise print "something else";
end
'''


class GlassBox:
    def __init__(self, root, path: Optional[str] = None):
        self.root = root
        self.result: Optional[CompileResult] = None
        root.title("Nova - Glass-Box Compiler")
        root.geometry("1320x840")

        bar = ttk.Frame(root, padding=(12, 10))
        bar.pack(fill="x")
        ttk.Label(bar, text="✦ Nova", style="Brand.TLabel").pack(side="left")
        ttk.Label(bar, text="GLASS-BOX COMPILER", style="Sub.TLabel").pack(
            side="left", padx=(8, 18), pady=(4, 0))
        ttk.Button(bar, text="Open .nova", command=self.open_file).pack(side="left")
        ttk.Button(bar, text="Compile  (F5)", command=self.compile).pack(side="left", padx=6)
        ttk.Button(bar, text="▶  Run", style="Accent.TButton",
                   command=self.run_only).pack(side="left")
        ttk.Button(bar, text="Save HTML report",
                   command=self.save_report).pack(side="left", padx=6)
        self.optimise = tk.BooleanVar(value=True)
        ttk.Checkbutton(bar, text="optimiser on", variable=self.optimise,
                        command=self.compile).pack(side="left", padx=12)
        self.status = ttk.Label(bar, text="ready", style="Status.TLabel")
        self.status.pack(side="right")

        self.nb = ttk.Notebook(root)
        self.nb.pack(fill="both", expand=True, padx=8, pady=(0, 8))

        self.src = self._text_tab("0 - Source", editable=True)
        self.t_tokens = self._table_tab(
            "1 - Tokens", ["Token", "Lexeme", "Line", "Col", "Attribute"])
        self.t_dfa = self._table_tab(
            "1 - DFA", ["State", "Accepts", "Transitions"])
        self.t_grammar = self._text_tab("2 - Grammar")
        self.t_tables = self._table_tab(
            "2 - LR tables", ["Table", "States", "Entries", "Conflicts", "Usable"])
        self.t_parse = self._table_tab(
            "2 - LR parse", ["Step", "Stack", "Symbols", "Input", "Action"])
        self.t_sym = self._table_tab(
            "3 - Symbols", ["Name", "Kind", "Type", "Scope", "Depth", "Slot",
                            "Line", "Used"])
        self.t_ast = self._text_tab("3 - Annotated AST")
        self.t_tac = self._text_tab("4 - Three-address code")
        self.t_cfg = self._text_tab("5 - Blocks & flow graph")
        self.t_opt = self._table_tab(
            "5 - Optimiser", ["Pass", "Before", "After", "Removed", "What it did"])
        self.t_df = self._text_tab("5 - Data flow")
        self.t_gen = self._text_tab("6 - Target code")
        self.t_nu = self._table_tab(
            "6 - Next use", ["At", "Instruction", "Next use", "Live after"])
        self.t_ssa = self._text_tab("7 - SSA & parallelism")
        self.t_byte = self._text_tab("8 - Bytecode")
        self.t_ver = self._table_tab(
            "8 - Verifier", ["Function", "Property proved", "Result", "Detail"])
        self.t_run = self._text_tab("9 - Run")
        self.t_trace = self._table_tab(
            "9 - VM trace", ["Step", "Function", "pc", "Instruction",
                             "Operand stack", "Depth"])
        self.t_metrics = self._table_tab("Metrics", ["Module", "Measurement", "Value"])
        self.t_err = self._table_tab(
            "Diagnostics", ["Phase", "Where", "Message", "Hint"])

        text = SAMPLE
        if path and os.path.exists(path):
            with open(path, encoding="utf-8") as fh:
                text = fh.read()
        self.src.insert("1.0", text)
        root.bind("<F5>", lambda e: self.compile())
        self.compile()

    # ------------------------------------------------------------- widgets
    def _text_tab(self, title: str, editable: bool = False):
        frame = ttk.Frame(self.nb)
        self.nb.add(frame, text=title)
        txt = tk.Text(frame, wrap="none", font=MONO, undo=True,
                      background=CODE_BG if not editable else BG,
                      foreground="#e4e4e6", insertbackground=ORANGE,
                      selectbackground=SELECT, selectforeground=TEXT,
                      relief="flat", borderwidth=0, highlightthickness=0,
                      padx=10, pady=8, insertwidth=2)
        ys = ttk.Scrollbar(frame, orient="vertical", command=txt.yview)
        xs = ttk.Scrollbar(frame, orient="horizontal", command=txt.xview)
        txt.configure(yscrollcommand=ys.set, xscrollcommand=xs.set)
        txt.grid(row=0, column=0, sticky="nsew")
        ys.grid(row=0, column=1, sticky="ns")
        xs.grid(row=1, column=0, sticky="ew")
        frame.rowconfigure(0, weight=1)
        frame.columnconfigure(0, weight=1)
        return txt

    def _table_tab(self, title: str, columns: List[str]):
        frame = ttk.Frame(self.nb)
        self.nb.add(frame, text=title)
        tv = ttk.Treeview(frame, columns=columns, show="headings", height=30)
        for c in columns:
            tv.heading(c, text=c)
            tv.column(c, width=max(90, min(460, 12 * len(c) + 60)), anchor="w")
        ys = ttk.Scrollbar(frame, orient="vertical", command=tv.yview)
        xs = ttk.Scrollbar(frame, orient="horizontal", command=tv.xview)
        tv.configure(yscrollcommand=ys.set, xscrollcommand=xs.set)
        tv.grid(row=0, column=0, sticky="nsew")
        ys.grid(row=0, column=1, sticky="ns")
        xs.grid(row=1, column=0, sticky="ew")
        frame.rowconfigure(0, weight=1)
        frame.columnconfigure(0, weight=1)
        return tv

    @staticmethod
    def _fill(tv, rows) -> None:
        tv.delete(*tv.get_children())
        for r in rows[:4000]:
            tv.insert("", "end", values=[str(x) for x in r])

    @staticmethod
    def _set(txt, content: str) -> None:
        state = txt.cget("state")
        txt.configure(state="normal")
        txt.delete("1.0", "end")
        txt.insert("1.0", content)
        txt.configure(state=state)

    # -------------------------------------------------------------- actions
    def open_file(self) -> None:
        path = filedialog.askopenfilename(
            filetypes=[("Nova source", "*.nova"), ("All files", "*.*")])
        if not path:
            return
        with open(path, encoding="utf-8") as fh:
            self.src.delete("1.0", "end")
            self.src.insert("1.0", fh.read())
        self.compile()

    def save_report(self) -> None:
        if self.result is None:
            return
        path = filedialog.asksaveasfilename(
            defaultextension=".html", initialfile="nova-report.html",
            filetypes=[("HTML report", "*.html")])
        if not path:
            return
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(build_report(self.result))
        messagebox.showinfo("Saved", f"Report written to\n{path}")

    def run_only(self) -> None:
        self.compile()
        self.nb.select(self.t_run.master)

    def compile(self, *_):
        source = self.src.get("1.0", "end-1c")
        self.status.configure(text="compiling...", foreground=MUTED)
        self.root.update_idletasks()
        try:
            res = compile_source(source, "editor buffer",
                                 optimise=self.optimise.get())
        except Exception as exc:
            traceback.print_exc()
            self._fill(self.t_err, [["internal", "-", f"{type(exc).__name__}: {exc}",
                                     "the full traceback is in the console"]])
            self.nb.select(self.t_err.master)
            self.status.configure(text="internal error", foreground=BAD)
            return
        self.result = res
        self.populate(res)
        self.status.configure(
            text=("compiled - " + ("verified and run" if res.verify_ok else "errors"))
            + f"   ({len(res.errors)} diagnostic(s))",
            foreground=ORANGE if res.verify_ok else BAD)

    # ------------------------------------------------------------- populate
    def populate(self, res: CompileResult) -> None:
        self._fill(self.t_tokens, [[t.type, t.lexeme, t.line, t.col, t.attribute]
                                   for t in res.tokens if t.type != "EOF"])
        if res.lexer:
            self._fill(self.t_dfa, res.lexer.dfa_table())
            st = res.lexer.dfa_stats()
            head = (f"token patterns: {st['token_patterns']}   "
                    f"positions: {st['positions']}   "
                    f"DFA states: {st['dfa_states_before_min']} -> "
                    f"{st['dfa_states_after_min']} after minimisation   "
                    f"symbol classes: {st['symbol_classes']}\n\n")
        else:
            head = ""

        g = NOVA_GRAMMAR
        first, follow = g.first_sets(), g.follow_sets()
        txt = ["The Nova grammar", "=" * 60, str(g), "",
               "FIRST / FOLLOW", "=" * 60]
        for nt in g.nonterminals:
            txt.append(f"{nt:<10} FIRST {{{', '.join(sorted(first[nt]))}}}")
            txt.append(f"{'':<10} FOLLOW {{{', '.join(sorted(follow[nt]))}}}")
        _, conf = g.ll1_table()
        txt += ["", f"LL(1) conflicts: {len(conf)}  (the grammar is left recursive, "
                    f"which is exactly what a top-down parser cannot do)", "=" * 60]
        txt += conf[:12]
        _, log = g.eliminate_left_recursion()
        txt += ["", "after eliminating left recursion:", "=" * 60] + log
        txt += ["", "A deliberately ambiguous grammar, and its conflicts:", "=" * 60,
                str(AMBIGUOUS_NOVA_EXPR), ""]
        for c in LRBuilder(AMBIGUOUS_NOVA_EXPR).build_slr().conflicts:
            txt.append(f"state {c.state} on '{c.symbol}': {c.detail}")
        self._set(self.t_grammar, head + "\n".join(txt))

        rows = []
        for kind in ("SLR", "CLR", "LALR"):
            if kind in res.tables:
                t = res.tables[kind]
                rows.append([t.kind, t.n_states, t.size(), len(t.conflicts),
                             "yes" if not t.conflicts else "no"])
        self._fill(self.t_tables, rows)
        self._fill(self.t_parse, [[s.step, s.stack, s.symbols, s.input, s.action]
                                  for s in res.lr_trace])

        if res.sema:
            self._fill(self.t_sym, res.sema.symbol_rows())
        if res.ast:
            from .ast_nodes import dump
            self._set(self.t_ast, dump(res.ast))

        out = []
        for name, art in res.functions.items():
            out.append(f"function {name}({', '.join(art.params)})")
            out.append("-" * 60)
            out += art.ir.listing()
            out.append("")
        if res.tacgen:
            out += ["backpatching performed", "-" * 60] + res.tacgen.patch_log
        self._set(self.t_tac, "\n".join(out))

        out, optrows, dfout, genout, nurows = [], [], [], [], []
        ssaout, byteout, verrows = [], [], []
        for name, art in res.functions.items():
            out.append(f"=== {name} : basic blocks before optimisation ===")
            out.append(art.cfg_before.text())
            out.append(f"=== {name} : after optimisation ===")
            out.append(art.cfg_after.text())
            for r in art.opt.records:
                optrows.append([f"{name}: {r.name}", r.before, r.after,
                                r.removed, r.detail])
            dfout.append(f"=== {name} ===")
            for df, f in ((art.reaching, fmt_def), (art.live, str),
                          (art.available, fmt_expr), (art.busy, fmt_expr)):
                if df is None:
                    continue
                dfout.append(f"\n{df.name}  ({df.direction}, meet={df.meet}, "
                             f"{len(df.rounds)} round(s) to converge)")
                for row in df.table(f):
                    dfout.append(f"   {row[0]:<5} IN {row[1]:<44} OUT {row[2]}")
            genout.append(f"=== {name} : activation record ===")
            for r in art.codegen.frame.rows():
                genout.append(f"   {r[0]:>4}  {r[1]:<14} {r[2]}")
            genout.append(f"=== {name} : target code "
                          f"({len(art.codegen.code)} instructions, "
                          f"{art.codegen.spills} spill(s)) ===")
            genout += art.codegen.listing()
            genout.append("")
            for r in art.codegen.nextuse_rows:
                nurows.append([f"B{r.block}.{r.index}", r.instr, r.nextuse, r.live])
            ssaout.append(f"=== {name} : SSA ===")
            for bl in art.ssa.blocks:
                ssaout += bl
            ssaout += art.ssa.notes
            for l in art.loops:
                ssaout.append(f"loop at B{l.header}: {l.verdict} - {l.reason}")
                ssaout += ["    " + s for s in l.suggestions]
            ssaout.append("")
        self._set(self.t_cfg, "\n".join(out))
        self._fill(self.t_opt, optrows)
        self._set(self.t_df, "\n".join(dfout))
        self._set(self.t_gen, "\n".join(genout))
        self._fill(self.t_nu, nurows)
        ssaout += ["", "=== LLVM IR ===", res.llvm]
        self._set(self.t_ssa, "\n".join(ssaout))

        if res.bprog_opt:
            byteout = res.bprog_opt.listing()
        if res.peephole_notes:
            byteout += ["", "peephole:"] + res.peephole_notes
        self._set(self.t_byte, "\n".join(byteout))
        for r in res.verify:
            for c in r.checks:
                verrows.append([r.function, c[0], c[1], c[2]])
            for e in r.errors:
                verrows.append([r.function, "REJECTED", "FAIL", e])
        self._fill(self.t_ver, verrows)

        runtxt = []
        if res.run_opt:
            runtxt.append("output")
            runtxt.append("-" * 60)
            runtxt += res.run_opt.output or ["(none)"]
            if res.run_opt.error:
                runtxt += ["", res.run_opt.error]
            runtxt += ["", f"VM instructions executed: {res.run_opt.steps}"]
            if res.run_raw:
                runtxt.append(f"without the optimiser:    {res.run_raw.steps}")
            runtxt.append(f"deepest call stack:       {res.run_opt.max_frames}")
            if res.run_reg is not None:
                runtxt += ["", "register back-end output (must match):",
                           "  " + ", ".join(getattr(res.run_reg, "output", []))]
            if res.run_opt.frames_snapshots:
                runtxt += ["", "activation-record stack at its deepest", "-" * 60]
                runtxt += res.run_opt.frames_snapshots
            self._fill(self.t_trace,
                       [[t.step, t.func, t.pc, t.instr, t.stack, t.depth]
                        for t in res.run_opt.trace])
        self._set(self.t_run, "\n".join(runtxt))

        self._fill(self.t_metrics, res.metrics)
        self._fill(self.t_err, [[e.phase, f"{e.line}:{e.col}" if e.line else "-",
                                 e.message, e.hint or ""] for e in res.errors])


def apply_theme(root) -> None:
    """Black and orange on ttk's 'clam' theme, which honours custom colours."""
    st = ttk.Style(root)
    st.theme_use("clam")
    root.configure(background=BG)
    root.option_add("*TCombobox*Listbox.background", SURFACE)
    st.configure(".", background=BG, foreground=TEXT, fieldbackground=SURFACE,
                 bordercolor=LINE, lightcolor=SURFACE, darkcolor=SURFACE,
                 troughcolor=BG, focuscolor=ORANGE, font=UI)
    st.configure("TFrame", background=BG)
    st.configure("TLabel", background=BG, foreground=MUTED)
    st.configure("Brand.TLabel", foreground=ORANGE, font=("Segoe UI Semibold", 15))
    st.configure("Sub.TLabel", foreground=MUTED, font=("Segoe UI", 8))
    st.configure("Status.TLabel", foreground=ORANGE, font=("Consolas", 10))
    st.configure("TButton", background=SURFACE2, foreground=TEXT, bordercolor=LINE,
                 lightcolor=SURFACE2, darkcolor=SURFACE2, padding=(12, 6), relief="flat")
    st.map("TButton", background=[("pressed", ORANGE_DEEP), ("active", "#26262c")],
           bordercolor=[("active", ORANGE)])
    st.configure("Accent.TButton", background=ORANGE, foreground="#140a02",
                 bordercolor=ORANGE, lightcolor=ORANGE, darkcolor=ORANGE,
                 font=("Segoe UI Semibold", 10))
    st.map("Accent.TButton", background=[("pressed", ORANGE_DEEP), ("active", ORANGE_HI)],
           foreground=[("active", "#140a02")])
    st.configure("TCheckbutton", background=BG, foreground=TEXT,
                 indicatorbackground=SURFACE2, indicatorforeground="#140a02")
    st.map("TCheckbutton", background=[("active", BG)],
           indicatorbackground=[("selected", ORANGE), ("active", "#26262c")])
    st.configure("TNotebook", background=BG, borderwidth=0, tabmargins=(8, 4, 8, 0))
    st.configure("TNotebook.Tab", background=SURFACE, foreground=MUTED, padding=(6, 5),
                 bordercolor=LINE, lightcolor=SURFACE, darkcolor=SURFACE,
                 font=("Segoe UI", 9))
    st.map("TNotebook.Tab", background=[("selected", SURFACE2), ("active", "#1a1a1f")],
           foreground=[("selected", ORANGE), ("active", TEXT)],
           lightcolor=[("selected", ORANGE)])
    st.configure("Treeview", background=SURFACE, fieldbackground=SURFACE, foreground=TEXT,
                 rowheight=24, bordercolor=LINE, lightcolor=SURFACE, darkcolor=SURFACE,
                 font=MONO)
    st.map("Treeview", background=[("selected", SELECT)], foreground=[("selected", ORANGE_HI)])
    st.configure("Treeview.Heading", background=SURFACE2, foreground=MUTED, relief="flat",
                 bordercolor=LINE, lightcolor=SURFACE2, darkcolor=SURFACE2,
                 font=("Segoe UI Semibold", 9))
    st.map("Treeview.Heading", background=[("active", "#26262c")],
           foreground=[("active", ORANGE)])
    for orient in ("Vertical", "Horizontal"):
        st.configure(f"{orient}.TScrollbar", background=SURFACE2, troughcolor=BG,
                     bordercolor=BG, lightcolor=SURFACE2, darkcolor=SURFACE2,
                     arrowcolor=MUTED, gripcount=0)
        st.map(f"{orient}.TScrollbar", background=[("active", "#3a3a44")])


def main(path: Optional[str] = None) -> int:
    if not HAVE_TK:
        print("Tkinter is not available in this Python installation.\n"
              "On Windows it ships with the official installer. Meanwhile you can "
              "use:\n    python -m nova report yourfile.nova\nwhich writes the same "
              "information to an HTML file.")
        return 1
    root = tk.Tk()
    apply_theme(root)
    GlassBox(root, path)
    root.mainloop()
    return 0


if __name__ == "__main__":                          # pragma: no cover
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else None))
