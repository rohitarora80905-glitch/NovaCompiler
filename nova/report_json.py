"""
nova.report_json - the same compilation as JSON, for the Nova Studio web page.

report_html renders a CompileResult as one HTML file; this module renders it as
plain dicts and lists that `json.dumps` accepts, so the browser can draw every
phase itself.  Nothing is recomputed here - it only reads what the pipeline
kept.  Long lists are capped and carry their true length, so a program with a
hundred thousand parse steps still produces a response of sensible size.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Sequence

from .cfg import CFG, fmt_block
from .dataflow import fmt_def, fmt_expr
from .lexer import TOKEN_SPECS
from .lr import LRBuilder
from .nova_grammar import AMBIGUOUS_NOVA_EXPR, NOVA_GRAMMAR
from .pipeline import CompileResult

ROW_LIMIT = 2500

_GRAMMAR_CACHE: Optional[dict] = None


def rows(data: Sequence, limit: int = ROW_LIMIT) -> dict:
    """A capped table: the first `limit` rows plus how many there really were."""
    return {"rows": [[_cell(c) for c in r] for r in data[:limit]],
            "total": len(data)}


def lines(data: Sequence, limit: int = ROW_LIMIT) -> dict:
    """A capped list of plain strings, shaped like `rows` without the columns."""
    return {"rows": [str(x) for x in data[:limit]], "total": len(data)}


def _cell(c):
    return c if isinstance(c, (int, float)) and not isinstance(c, bool) else str(c)


def is_warning(e) -> bool:
    return "never used" in e.message


# ------------------------------------------------------------------ grammar
def grammar_view() -> dict:
    """Everything about the grammar itself.  It never changes, so build it once."""
    global _GRAMMAR_CACHE
    if _GRAMMAR_CACHE is not None:
        return _GRAMMAR_CACHE
    g = NOVA_GRAMMAR
    first, follow = g.first_sets(), g.follow_sets()
    _, ll1 = g.ll1_table()
    g2, log = g.eliminate_left_recursion()
    _, ll1_after = g2.ll1_table()
    amb = LRBuilder(AMBIGUOUS_NOVA_EXPR).build_slr()
    _GRAMMAR_CACHE = {
        "text": str(g),
        "productions": len(g.productions),
        "terminals": len(g.terminals),
        "nonterminals": len(g.nonterminals),
        "first_follow": rows([[nt, "{" + ", ".join(sorted(first[nt])) + "}",
                               "{" + ", ".join(sorted(follow[nt])) + "}"]
                              for nt in g.nonterminals]),
        "ll1_conflicts": lines(ll1, 40),
        "left_recursion_log": log,
        "ll1_conflicts_after": len(ll1_after),
        "ambiguous": {"text": str(AMBIGUOUS_NOVA_EXPR),
                      "conflicts": rows([[c.state, c.symbol, c.kind, c.detail]
                                         for c in amb.conflicts])},
        "token_specs": rows([[i, n, r] for i, (n, r) in enumerate(TOKEN_SPECS)]),
    }
    return _GRAMMAR_CACHE


# ------------------------------------------------------------------ helpers
def cfg_view(cfg: CFG) -> dict:
    back = set(cfg.back_edges())
    return {"entry": cfg.entry,
            "blocks": [{"id": b.id, "lines": [fmt_block(q) for q in b.quads],
                        "succs": [s for s in b.succs if s < len(cfg.blocks)],
                        "preds": list(b.preds)} for b in cfg.blocks],
            "back_edges": [list(e) for e in back],
            "instructions": cfg.n_instructions()}


def _dataflow(df, fmt) -> dict:
    return {"name": df.name, "direction": df.direction, "meet": df.meet,
            "rounds": len(df.rounds), "table": rows(df.table(fmt)),
            "convergence": rows(df.convergence(fmt, 4), 400)}


def _function(name: str, art) -> dict:
    cg = art.codegen
    df = art.cfg_after.dominance_frontiers()
    flows = [(art.reaching, fmt_def), (art.live, str),
             (art.available, fmt_expr), (art.busy, fmt_expr)]
    return {
        "name": name,
        "params": list(art.params),
        "ir": art.ir.listing(),
        "n_before": art.n_before,
        "n_after": art.n_after,
        "cfg_before": cfg_view(art.cfg_before),
        "cfg_after": cfg_view(art.cfg_after),
        "passes": [{"name": r.name, "before": r.before, "after": r.after,
                    "removed": r.removed, "detail": r.detail}
                   for r in art.opt.records],
        "opt_notes": list(art.opt.notes),
        "dag": [{"block": bid, "nodes": [nd.render() for nd in nodes]}
                for bid, nodes in sorted(art.opt.dag_nodes.items()) if nodes],
        "dataflow": [_dataflow(d, f) for d, f in flows if d is not None],
        "frame": rows(cg.frame.rows()),
        "nextuse": rows([[f"B{r.block}.{r.index}", r.instr, r.nextuse, r.live]
                         for r in cg.nextuse_rows]),
        "decisions": rows(cg.decisions),
        "target": cg.listing(),
        "spills": cg.spills,
        "dominators": rows([[f"B{b}",
                             f"B{art.ssa.idom[b]}" if art.ssa.idom.get(b) is not None
                             else "-",
                             "{" + ", ".join(f"B{x}" for x in sorted(df.get(b, ()))) + "}"]
                            for b in range(len(art.cfg_after.blocks))]),
        "ssa": ["\n".join(bl) for bl in art.ssa.blocks],
        "ssa_notes": list(art.ssa.notes),
        "phis": art.ssa.phis_inserted,
        "loops": [{"header": l.header, "blocks": list(l.blocks),
                   "induction": list(l.induction), "carried": list(l.carried),
                   "reductions": list(l.reductions),
                   "privatisable": list(getattr(l, "privatisable", [])),
                   "verdict": l.verdict, "reason": l.reason,
                   "suggestions": list(l.suggestions)} for l in art.loops],
    }


def _run(r) -> Optional[dict]:
    if r is None:
        return None
    return {"output": list(r.output), "error": r.error or "",
            "steps": getattr(r, "steps", 0)}


# ===================================================================== main
def build_json(res: CompileResult, optimise: bool = True,
               max_steps: int = 0) -> dict:
    lx = res.lexer
    errors = list(res.errors)
    out: Dict[str, object] = {
        "path": res.path,
        "ok": res.ok,
        "optimise": optimise,
        "max_steps": max_steps,
        "verify_ok": res.verify_ok,
        "diagnostics": [{"phase": e.phase, "line": e.line, "col": e.col,
                         "message": e.message, "hint": e.hint or "",
                         "severity": "warning" if is_warning(e) else "error"}
                        for e in errors],
        "timings": [{"phase": k, "ms": round(v * 1000, 3)}
                    for k, v in res.timings.items()],
        "metrics": rows(res.metrics),
    }

    # -------------------------------------------------------------- module 1
    toks = [t for t in res.tokens if t.type != "EOF"]
    out["lexical"] = None if lx is None else {
        "stats": lx.dfa_stats(),
        "tokens": rows([[t.type, t.lexeme, t.line, t.col, t.attribute] for t in toks]),
        "followpos": rows(lx.followpos_rows(400)),
        "dfa": rows(lx.dfa_table()),
    }

    # -------------------------------------------------------------- module 2
    out["syntax"] = {
        "tables": [{"kind": t.kind, "states": t.n_states, "entries": t.size(),
                    "conflicts": len(t.conflicts)}
                   for k in ("SLR", "CLR", "LALR") if k in res.tables
                   for t in [res.tables[k]]],
        "lr_ok": res.lr_ok,
        "lr_msg": res.lr_msg,
        "lr_trace": rows([[s.step, s.stack, s.symbols, s.input, s.action]
                          for s in res.lr_trace], 1500),
        "rd_trace": lines(res.parser.trace if res.parser else [], 600),
    }

    # -------------------------------------------------------------- module 3
    if res.sema:
        from .ast_nodes import dump
        out["semantic"] = {
            "symbols": rows(res.sema.symbol_rows()),
            "sdd": rows([[r["production"], r["inherited"], r["synthesized"]]
                         for r in res.sema.sdd_log]),
            "ast": dump(res.ast) if res.ast else "",
        }
    else:
        out["semantic"] = None

    # ----------------------------------------------------------- modules 4-7
    out["functions"] = [_function(n, a) for n, a in res.functions.items()]
    out["backpatch"] = list(res.tacgen.patch_log) if res.tacgen else []
    out["llvm"] = res.llvm

    # -------------------------------------------------------------- module 8
    out["bytecode"] = None if res.bprog_opt is None else {
        "listing": res.bprog_opt.listing(),
        "raw_total": res.bprog_raw.total_instructions() if res.bprog_raw else 0,
        "opt_total": res.bprog_opt.total_instructions(),
        "peephole": list(res.peephole_notes),
    }
    out["verifier"] = [{"function": r.function, "ok": r.ok, "max_stack": r.max_stack,
                        "checks": [list(c) for c in r.checks],
                        "errors": list(r.errors)} for r in res.verify]

    # ------------------------------------------------------------- execution
    run = res.run_opt
    if run is not None:
        reg = _run(res.run_reg)
        raw = _run(res.run_raw)
        out["run"] = {
            "output": list(run.output), "error": run.error or "",
            "steps": run.steps, "max_frames": run.max_frames,
            "max_stack": run.max_stack,
            "frames": [str(f) for f in run.frames_snapshots],
            "trace": rows([[t.step, t.func, t.pc, t.instr, t.stack, t.depth]
                           for t in run.trace]),
            "raw": raw, "reg": reg,
            "agree": bool(reg and raw and run.output == reg["output"] == raw["output"]),
        }
    else:
        out["run"] = None

    # -------------------------------------------------------------- headline
    fns = res.functions.values()
    out["summary"] = {
        "tokens": len(toks),
        "functions": len(res.functions),
        "ir_before": sum(f.n_before for f in fns),
        "ir_after": sum(f.n_after for f in fns),
        "blocks": sum(len(f.cfg_before.blocks) for f in fns),
        "loops": sum(len(f.loops) for f in fns),
        "phis": sum(f.ssa.phis_inserted for f in fns),
        "spills": sum(f.codegen.spills for f in fns),
        "symbols": len(res.sema.all_symbols) if res.sema else 0,
        "lr_steps": len(res.lr_trace),
        "errors": sum(1 for e in errors if not is_warning(e)),
        "warnings": sum(1 for e in errors if is_warning(e)),
    }
    return out
