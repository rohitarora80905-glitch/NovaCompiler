"""
nova.parallel - Module 7: automatic parallelisation, in miniature.

For every natural loop the analyser answers the question a vectoriser has to
answer first: *is there a loop-carried dependence?*  A value written in one
iteration and read in the next is a carried dependence and forbids running the
iterations at the same time - unless it matches a recognised reduction pattern
(`acc = acc + e`), in which case the loop parallelises with a reduction clause,
exactly as OpenMP's `reduction(+:acc)` does.

It also reports the two classical cache-locality transformations - interchange
and tiling - when a nested loop is present.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Set, Tuple

from .cfg import CFG
from .dag import as_int, is_const
from .dataflow import defs_of, uses_of


@dataclass
class LoopReport:
    header: int
    blocks: List[int]
    induction: List[str] = field(default_factory=list)
    carried: List[str] = field(default_factory=list)
    reductions: List[str] = field(default_factory=list)
    privatisable: List[str] = field(default_factory=list)
    verdict: str = ""
    reason: str = ""
    depth: int = 1
    suggestions: List[str] = field(default_factory=list)


def analyse(cfg: CFG) -> List[LoopReport]:
    loops = cfg.natural_loops()
    reports: List[LoopReport] = []
    for header, body in loops:
        rep = LoopReport(header, sorted(body))
        written: Dict[str, int] = {}
        read_before_write: Set[str] = set()
        reduction_vars: Set[str] = set()
        seen_written: Set[str] = set()

        for bid in sorted(body):
            for q in cfg.blocks[bid].quads:
                for u in uses_of(q):
                    if u not in seen_written:
                        read_before_write.add(u)
                for d in defs_of(q):
                    written[d] = written.get(d, 0) + 1
                    seen_written.add(d)
                # x = x + e  /  x = x * e  is a reduction
                if q.op in ("+", "*") and q.r in (q.a, q.b):
                    reduction_vars.add(q.r)
                # i = i + const is a basic induction variable
                if q.op == "+" and q.r == q.a and as_int(q.b) is not None:
                    rep.induction.append(q.r)

        rep.induction = sorted(set(rep.induction))
        carried = sorted((set(written) & read_before_write) - set(rep.induction))
        rep.reductions = sorted(reduction_vars & set(carried))
        rep.carried = [c for c in carried if c not in rep.reductions]
        rep.privatisable = sorted(set(written) - read_before_write - set(rep.induction))

        # nesting depth: how many other loops contain this header
        rep.depth = sum(1 for h2, b2 in loops if header in b2 and h2 != header) + 1

        if not rep.carried and not rep.reductions:
            rep.verdict = "VECTORISABLE / PARALLELISABLE"
            rep.reason = ("no loop-carried dependence: every value written in one "
                          "iteration is dead before the next one starts")
        elif not rep.carried and rep.reductions:
            rep.verdict = "PARALLELISABLE AS A REDUCTION"
            rep.reason = (f"the only carried dependence is the accumulator "
                          f"{', '.join(rep.reductions)}, which matches the "
                          f"reduction pattern x = x op e")
        else:
            rep.verdict = "SEQUENTIAL"
            rep.reason = (f"loop-carried dependence on {', '.join(rep.carried)}: "
                          f"iteration i+1 reads a value iteration i wrote")

        if rep.privatisable:
            rep.suggestions.append(
                f"privatise {', '.join(rep.privatisable)} - each thread needs its own copy")
        if rep.depth > 1:
            rep.suggestions.append(
                "nested loop: consider loop interchange so the innermost loop walks "
                "memory with stride 1, then tile the iteration space to fit the cache")
        if rep.verdict.startswith("VECTOR"):
            rep.suggestions.append(
                "safe to unroll and vectorise; the trip count is the only thing a "
                "real vectoriser would still need to prove")
        reports.append(rep)
    return reports


def summary(reports: List[LoopReport]) -> str:
    if not reports:
        return "no loops in this function"
    good = sum(1 for r in reports if not r.verdict.startswith("SEQ"))
    return (f"{len(reports)} loop(s) analysed - {good} could run in parallel, "
            f"{len(reports) - good} must stay sequential")
