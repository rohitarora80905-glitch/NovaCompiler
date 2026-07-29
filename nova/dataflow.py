"""
nova.dataflow - Module 5: the four classical iterative data-flow analyses.

    analysis              direction   meet   used for
    --------------------  ----------  -----  ---------------------------------
    reaching definitions  forward     union  constant propagation, use-def
    live variables        backward    union  dead-code elimination, registers
    available expressions forward     inter. global CSE
    very busy expressions backward    inter. code hoisting

Every analysis records its IN/OUT sets after *each* round of the fixed-point
iteration, which is the thing a report can actually show converging.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Dict, List, Set, Tuple

from .cfg import CFG, CONDS
from .dag import is_const
from .tac import ARITH

DEFINING = set(ARITH) | {"=", "uminus"}


# ------------------------------------------------------------------ helpers
def defs_of(q) -> Set[str]:
    if q.op in DEFINING and q.r:
        return {q.r}
    if q.op == "call" and q.r:
        return {q.r}
    return set()


def uses_of(q) -> Set[str]:
    u: Set[str] = set()
    if q.op in DEFINING:
        for x in (q.a, q.b):
            if isinstance(x, str) and x and not is_const(x):
                u.add(x)
    elif q.op in CONDS:
        for x in (q.a, q.b):
            if isinstance(x, str) and x and not is_const(x):
                u.add(x)
    elif q.op in ("print", "param", "ret", "jtab"):
        if isinstance(q.a, str) and q.a and not is_const(q.a):
            u.add(q.a)
    return u


def expressions_of(q) -> Set[Tuple[str, str, str]]:
    if q.op in ARITH and q.a is not None and q.b is not None:
        return {(q.op, q.a, q.b)}
    return set()


@dataclass
class DFResult:
    name: str
    IN: Dict[int, Set]
    OUT: Dict[int, Set]
    rounds: List[Dict[int, Tuple[Set, Set]]] = field(default_factory=list)
    direction: str = "forward"
    meet: str = "union"

    def table(self, fmt_item: Callable = str) -> List[List[str]]:
        rows = []
        for b in sorted(self.IN):
            rows.append([f"B{b}",
                         "{" + ", ".join(sorted(fmt_item(x) for x in self.IN[b])) + "}",
                         "{" + ", ".join(sorted(fmt_item(x) for x in self.OUT[b])) + "}"])
        return rows

    def convergence(self, fmt_item: Callable = str, limit: int = 6) -> List[List[str]]:
        rows = []
        for i, snap in enumerate(self.rounds[:limit], start=1):
            for b in sorted(snap):
                inn, outt = snap[b]
                rows.append([f"round {i}", f"B{b}",
                             "{" + ", ".join(sorted(fmt_item(x) for x in inn)) + "}",
                             "{" + ", ".join(sorted(fmt_item(x) for x in outt)) + "}"])
        return rows


# ==================================================== reaching definitions
def reaching_definitions(cfg: CFG) -> DFResult:
    """d: (block, index, variable).  OUT = gen U (IN - kill)."""
    gen: Dict[int, Set] = {}
    kill: Dict[int, Set] = {}
    all_defs: List[Tuple[int, int, str]] = []
    for b in cfg.blocks:
        for i, q in enumerate(b.quads):
            for v in defs_of(q):
                all_defs.append((b.id, i, v))
    entry_defs: Set[Tuple[int, int, str]] = {
        (-1, i, p) for i, p in enumerate(getattr(cfg, "params", []) or [])}
    all_defs += sorted(entry_defs)
    by_var: Dict[str, Set] = {}
    for d in all_defs:
        by_var.setdefault(d[2], set()).add(d)

    for b in cfg.blocks:
        g: Set = set()
        k: Set = set()
        for i, q in enumerate(b.quads):
            for v in defs_of(q):
                g = {d for d in g if d[2] != v}
                g.add((b.id, i, v))
                k |= (by_var[v] - {(b.id, i, v)})
        gen[b.id], kill[b.id] = g, k

    IN = {b.id: set() for b in cfg.blocks}
    OUT = {b.id: set(gen[b.id]) for b in cfg.blocks}
    rounds = []
    for _ in range(100):
        changed = False
        for b in cfg.blocks:
            newin: Set = set(entry_defs) if b.id == cfg.entry else set()
            for p in b.preds:
                newin |= OUT[p]
            newout = gen[b.id] | (newin - kill[b.id])
            if newin != IN[b.id] or newout != OUT[b.id]:
                IN[b.id], OUT[b.id] = newin, newout
                changed = True
        rounds.append({b.id: (set(IN[b.id]), set(OUT[b.id])) for b in cfg.blocks})
        if not changed:
            break
    return DFResult("Reaching definitions", IN, OUT, rounds, "forward", "union")


def fmt_def(d) -> str:
    if d[0] < 0:
        return f"{d[2]}@entry"
    return f"{d[2]}@B{d[0]}.{d[1]}"


# ========================================================= live variables
def live_variables(cfg: CFG) -> DFResult:
    use: Dict[int, Set[str]] = {}
    defd: Dict[int, Set[str]] = {}
    for b in cfg.blocks:
        u, d = set(), set()
        for q in b.quads:
            u |= (uses_of(q) - d)
            d |= defs_of(q)
        use[b.id], defd[b.id] = u, d

    IN = {b.id: set() for b in cfg.blocks}
    OUT = {b.id: set() for b in cfg.blocks}
    rounds = []
    for _ in range(100):
        changed = False
        for b in reversed(cfg.blocks):
            newout: Set[str] = set()
            for s in b.succs:
                if s in IN:
                    newout |= IN[s]
            newin = use[b.id] | (newout - defd[b.id])
            if newin != IN[b.id] or newout != OUT[b.id]:
                IN[b.id], OUT[b.id] = newin, newout
                changed = True
        rounds.append({b.id: (set(IN[b.id]), set(OUT[b.id])) for b in cfg.blocks})
        if not changed:
            break
    return DFResult("Live variables", IN, OUT, rounds, "backward", "union")


def live_at_each_instruction(cfg: CFG, live_out_of_block: Dict[int, Set[str]]):
    """Instruction-level liveness, used by dead-code elimination and next-use."""
    per_block: Dict[int, List[Set[str]]] = {}
    for b in cfg.blocks:
        live = set(live_out_of_block[b.id])
        snapshots: List[Set[str]] = [set()] * len(b.quads)
        for i in range(len(b.quads) - 1, -1, -1):
            snapshots[i] = set(live)          # live AFTER instruction i
            q = b.quads[i]
            live -= defs_of(q)
            live |= uses_of(q)
        per_block[b.id] = snapshots
    return per_block


# =================================================== available expressions
def available_expressions(cfg: CFG) -> DFResult:
    universe: Set[Tuple[str, str, str]] = set()
    for b in cfg.blocks:
        for q in b.quads:
            universe |= expressions_of(q)

    gen: Dict[int, Set] = {}
    kill: Dict[int, Set] = {}
    for b in cfg.blocks:
        g: Set = set()
        k: Set = set()
        for q in b.quads:
            for v in defs_of(q):
                g = {e for e in g if v not in (e[1], e[2])}
                k |= {e for e in universe if v in (e[1], e[2])}
            g |= expressions_of(q)
        gen[b.id], kill[b.id] = g, k

    IN = {b.id: set() for b in cfg.blocks}
    OUT = {b.id: (set(universe) if b.id != cfg.entry else set(gen[b.id]))
           for b in cfg.blocks}
    OUT[cfg.entry] = gen[cfg.entry]
    rounds = []
    for _ in range(100):
        changed = False
        for b in cfg.blocks:
            if b.id == cfg.entry:
                newin: Set = set()
            elif b.preds:
                newin = set(universe)
                for p in b.preds:
                    newin &= OUT[p]
            else:
                newin = set()
            newout = gen[b.id] | (newin - kill[b.id])
            if newin != IN[b.id] or newout != OUT[b.id]:
                IN[b.id], OUT[b.id] = newin, newout
                changed = True
        rounds.append({b.id: (set(IN[b.id]), set(OUT[b.id])) for b in cfg.blocks})
        if not changed:
            break
    return DFResult("Available expressions", IN, OUT, rounds, "forward", "intersection")


# ================================================== very busy expressions
def very_busy_expressions(cfg: CFG) -> DFResult:
    universe: Set[Tuple[str, str, str]] = set()
    for b in cfg.blocks:
        for q in b.quads:
            universe |= expressions_of(q)

    use: Dict[int, Set] = {}
    kill: Dict[int, Set] = {}
    for b in cfg.blocks:
        u: Set = set()
        k: Set = set()
        for q in b.quads:
            u |= expressions_of(q)
            for v in defs_of(q):
                u = {e for e in u if v not in (e[1], e[2])}
                k |= {e for e in universe if v in (e[1], e[2])}
        use[b.id], kill[b.id] = u, k

    IN = {b.id: set() for b in cfg.blocks}
    OUT = {b.id: set() for b in cfg.blocks}
    rounds = []
    for _ in range(100):
        changed = False
        for b in reversed(cfg.blocks):
            if b.succs:
                newout = set(universe)
                for s in b.succs:
                    if s in IN:
                        newout &= IN[s]
            else:
                newout = set()
            newin = use[b.id] | (newout - kill[b.id])
            if newin != IN[b.id] or newout != OUT[b.id]:
                IN[b.id], OUT[b.id] = newin, newout
                changed = True
        rounds.append({b.id: (set(IN[b.id]), set(OUT[b.id])) for b in cfg.blocks})
        if not changed:
            break
    return DFResult("Very busy expressions", IN, OUT, rounds, "backward", "intersection")


def fmt_expr(e) -> str:
    return f"{e[1]}{e[0]}{e[2]}"
