"""
nova.lr - Module 2, second half.

LR(0) items, the canonical collection, and three parsing tables built from the
same grammar so they can be compared side by side:

    SLR(1)   - LR(0) items  + FOLLOW sets for the reduce entries
    CLR(1)   - canonical LR(1) items (lookahead carried in the item)
    LALR(1)  - CLR states merged by identical core

Conflicts are not just detected, they are *explained*: which two actions
collide, on which lookahead, and which productions are responsible.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, FrozenSet, List, Optional, Sequence, Set, Tuple

from .grammar import EOF, EPS, Grammar, Production

Item0 = Tuple[int, int]                     # (production index, dot position)
Item1 = Tuple[int, int, str]                # (production index, dot, lookahead)


@dataclass
class Conflict:
    state: int
    symbol: str
    kind: str                                # shift/reduce or reduce/reduce
    detail: str


@dataclass
class LRTable:
    kind: str                                # SLR / CLR / LALR
    action: Dict[Tuple[int, str], Tuple[str, int]]
    goto: Dict[Tuple[int, str], int]
    states: List[FrozenSet]
    conflicts: List[Conflict]
    grammar: Grammar
    n_states: int = 0

    def size(self) -> int:
        return len(self.action) + len(self.goto)


class LRBuilder:
    def __init__(self, g: Grammar):
        # augment:  S' -> S
        aug = [(g.start + "'", [g.start])] + [(p.lhs, list(p.rhs)) for p in g.productions]
        self.g = Grammar(aug, g.start + "'", g.name)
        self.orig = g
        self.first = self.g.first_sets()
        self.follow = self.g.follow_sets()

    # -------------------------------------------------------------- LR(0)
    def closure0(self, items: Set[Item0]) -> FrozenSet[Item0]:
        out = set(items)
        stack = list(items)
        while stack:
            pi, dot = stack.pop()
            p = self.g.productions[pi]
            if dot < len(p.rhs) and self.g.is_nt(p.rhs[dot]):
                for q in self.g.prods_for(p.rhs[dot]):
                    it = (q.index, 0)
                    if it not in out:
                        out.add(it)
                        stack.append(it)
        return frozenset(out)

    def goto0(self, I: FrozenSet[Item0], X: str) -> FrozenSet[Item0]:
        moved = {(pi, dot + 1) for pi, dot in I
                 if dot < len(self.g.productions[pi].rhs)
                 and self.g.productions[pi].rhs[dot] == X}
        return self.closure0(moved) if moved else frozenset()

    def canonical0(self) -> Tuple[List[FrozenSet[Item0]], Dict[Tuple[int, str], int]]:
        start = self.closure0({(0, 0)})
        C = [start]
        index = {start: 0}
        trans: Dict[Tuple[int, str], int] = {}
        i = 0
        symbols = self.g.nonterminals + self.g.terminals
        while i < len(C):
            I = C[i]
            for X in symbols:
                J = self.goto0(I, X)
                if not J:
                    continue
                if J not in index:
                    index[J] = len(C)
                    C.append(J)
                trans[(i, X)] = index[J]
            i += 1
        return C, trans

    # -------------------------------------------------------------- LR(1)
    def closure1(self, items: Set[Item1]) -> FrozenSet[Item1]:
        out = set(items)
        stack = list(items)
        while stack:
            pi, dot, la = stack.pop()
            p = self.g.productions[pi]
            if dot < len(p.rhs) and self.g.is_nt(p.rhs[dot]):
                beta = list(p.rhs[dot + 1:]) + [la]
                lookaheads = self.g.first_of_string(beta, self.first) - {EPS}
                for q in self.g.prods_for(p.rhs[dot]):
                    for b in lookaheads:
                        it = (q.index, 0, b)
                        if it not in out:
                            out.add(it)
                            stack.append(it)
        return frozenset(out)

    def goto1(self, I: FrozenSet[Item1], X: str) -> FrozenSet[Item1]:
        moved = {(pi, dot + 1, la) for pi, dot, la in I
                 if dot < len(self.g.productions[pi].rhs)
                 and self.g.productions[pi].rhs[dot] == X}
        return self.closure1(moved) if moved else frozenset()

    def canonical1(self) -> Tuple[List[FrozenSet[Item1]], Dict[Tuple[int, str], int]]:
        start = self.closure1({(0, 0, EOF)})
        C = [start]
        index = {start: 0}
        trans: Dict[Tuple[int, str], int] = {}
        i = 0
        symbols = self.g.nonterminals + self.g.terminals
        while i < len(C):
            I = C[i]
            for X in symbols:
                J = self.goto1(I, X)
                if not J:
                    continue
                if J not in index:
                    index[J] = len(C)
                    C.append(J)
                trans[(i, X)] = index[J]
            i += 1
        return C, trans

    # ------------------------------------------------------- table assembly
    def _put(self, action, key, value, conflicts, state, sym, states, kind):
        old = action.get(key)
        if old is not None and old != value:
            what = "shift/reduce" if "s" in (old[0], value[0]) else "reduce/reduce"
            def describe(a):
                if a[0] == "s":
                    return f"shift and go to state {a[1]}"
                if a[0] == "r":
                    return f"reduce by ({self.g.productions[a[1]]})"
                return "accept"
            conflicts.append(Conflict(
                state, sym, what,
                f"on lookahead '{sym}' the parser could {describe(old)} "
                f"or {describe(value)} - {kind} cannot decide"))
            # classic resolution: prefer shift, and the earlier production
            if old[0] == "s" or (old[0] == "r" and value[0] == "r" and old[1] < value[1]):
                return
        action[key] = value

    def build_slr(self) -> LRTable:
        C, trans = self.canonical0()
        action: Dict[Tuple[int, str], Tuple[str, int]] = {}
        goto: Dict[Tuple[int, str], int] = {}
        conflicts: List[Conflict] = []
        for i, I in enumerate(C):
            for (s, X), j in trans.items():
                if s != i:
                    continue
                if self.g.is_nt(X):
                    goto[(i, X)] = j
                else:
                    self._put(action, (i, X), ("s", j), conflicts, i, X, C, "SLR(1)")
            for pi, dot in I:
                p = self.g.productions[pi]
                if dot == len(p.rhs):
                    if pi == 0:
                        action[(i, EOF)] = ("acc", 0)
                    else:
                        for a in self.follow[p.lhs]:
                            self._put(action, (i, a), ("r", pi), conflicts, i, a, C, "SLR(1)")
        return LRTable("SLR(1)", action, goto, C, conflicts, self.g, len(C))

    def build_clr(self) -> LRTable:
        C, trans = self.canonical1()
        return self._assemble1(C, trans, "CLR(1)")

    def build_lalr(self) -> LRTable:
        C, trans = self.canonical1()
        # merge states whose LR(0) cores are equal
        cores: Dict[FrozenSet[Item0], int] = {}
        remap: Dict[int, int] = {}
        merged: List[Set[Item1]] = []
        for i, I in enumerate(C):
            core = frozenset((pi, dot) for pi, dot, _ in I)
            if core not in cores:
                cores[core] = len(merged)
                merged.append(set())
            remap[i] = cores[core]
            merged[cores[core]] |= set(I)
        newC = [frozenset(s) for s in merged]
        newtrans: Dict[Tuple[int, str], int] = {}
        for (i, X), j in trans.items():
            newtrans[(remap[i], X)] = remap[j]
        return self._assemble1(newC, newtrans, "LALR(1)")

    def _assemble1(self, C, trans, kind) -> LRTable:
        action: Dict[Tuple[int, str], Tuple[str, int]] = {}
        goto: Dict[Tuple[int, str], int] = {}
        conflicts: List[Conflict] = []
        for i, I in enumerate(C):
            for (s, X), j in trans.items():
                if s != i:
                    continue
                if self.g.is_nt(X):
                    goto[(i, X)] = j
                else:
                    self._put(action, (i, X), ("s", j), conflicts, i, X, C, kind)
            for pi, dot, la in I:
                p = self.g.productions[pi]
                if dot == len(p.rhs):
                    if pi == 0 and la == EOF:
                        action[(i, EOF)] = ("acc", 0)
                    elif pi != 0:
                        self._put(action, (i, la), ("r", pi), conflicts, i, la, C, kind)
        return LRTable(kind, action, goto, C, conflicts, self.g, len(C))

    # ------------------------------------------------------------- printing
    def item0_str(self, it: Item0) -> str:
        pi, dot = it
        p = self.g.productions[pi]
        rhs = list(p.rhs)
        rhs.insert(dot, "•")
        return f"{p.lhs} -> {' '.join(rhs) if rhs else '•'}"

    def item1_str(self, it: Item1) -> str:
        pi, dot, la = it
        return f"{self.item0_str((pi, dot))} , {la}"


# ==========================================================================
# Table-driven LR parser with a full trace (the "animation" data)
# ==========================================================================
@dataclass
class TraceStep:
    step: int
    stack: str
    symbols: str
    input: str
    action: str


class ParseTreeNode:
    def __init__(self, label: str, children: Optional[List["ParseTreeNode"]] = None):
        self.label = label
        self.children = children or []

    def render(self, indent: int = 0) -> str:
        s = "  " * indent + self.label + "\n"
        for c in self.children:
            s += c.render(indent + 1)
        return s

    def count(self) -> int:
        return 1 + sum(c.count() for c in self.children)


def lr_parse(table: LRTable, tokens: Sequence[str],
             max_steps: int = 20000) -> Tuple[bool, List[TraceStep], Optional[ParseTreeNode], str]:
    """Drive the table over a list of terminal names; build the parse tree."""
    stack: List[int] = [0]
    syms: List[str] = []
    forest: List[ParseTreeNode] = []
    inp = list(tokens) + [EOF]
    ip = 0
    trace: List[TraceStep] = []
    step = 0
    g = table.grammar
    while step < max_steps:
        step += 1
        s = stack[-1]
        a = inp[ip]
        act = table.action.get((s, a))
        shown_input = " ".join(inp[ip:ip + 12]) + (" ..." if len(inp) - ip > 12 else "")
        if act is None:
            expected = sorted({sym for (st, sym) in table.action if st == s})
            trace.append(TraceStep(step, " ".join(map(str, stack)), " ".join(syms),
                                   shown_input, "ERROR"))
            return False, trace, None, (
                f"syntax error at '{a}': expected one of "
                f"{', '.join(expected[:8])}{' ...' if len(expected) > 8 else ''}")
        if act[0] == "s":
            trace.append(TraceStep(step, " ".join(map(str, stack)), " ".join(syms),
                                   shown_input, f"shift {act[1]}"))
            stack.append(act[1])
            syms.append(a)
            forest.append(ParseTreeNode(a))
            ip += 1
        elif act[0] == "r":
            p: Production = g.productions[act[1]]
            n = len(p.rhs)
            trace.append(TraceStep(step, " ".join(map(str, stack)), " ".join(syms),
                                   shown_input, f"reduce {p}"))
            kids = forest[len(forest) - n:] if n else []
            if n:
                del stack[-n:]
                del syms[-n:]
                del forest[-n:]
            node = ParseTreeNode(p.lhs, kids if kids else [ParseTreeNode(EPS)])
            forest.append(node)
            syms.append(p.lhs)
            stack.append(table.goto[(stack[-1], p.lhs)])
        else:
            trace.append(TraceStep(step, " ".join(map(str, stack)), " ".join(syms),
                                   shown_input, "accept"))
            return True, trace, (forest[-1] if forest else None), ""
    return False, trace, None, "parser did not terminate (step limit reached)"
