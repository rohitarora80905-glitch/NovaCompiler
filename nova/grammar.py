"""
nova.grammar - Module 2, first half.

Context-free grammars, FIRST and FOLLOW sets, the LL(1) parsing table, plus the
two classical grammar transformations: elimination of left recursion and left
factoring.  Everything reports *why* a conflict happens, because that is the
part students never get to see.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Set, Tuple

EOF = "$"
EPS = "ε"


@dataclass(frozen=True)
class Production:
    lhs: str
    rhs: Tuple[str, ...]
    index: int = 0

    def __str__(self) -> str:
        return f"{self.lhs} -> {' '.join(self.rhs) if self.rhs else EPS}"


class Grammar:
    def __init__(self, rules: Sequence[Tuple[str, Sequence[str]]], start: str,
                 name: str = "grammar"):
        self.name = name
        self.start = start
        self.productions: List[Production] = [
            Production(lhs, tuple(rhs), i) for i, (lhs, rhs) in enumerate(rules)
        ]
        self.nonterminals: List[str] = []
        for p in self.productions:
            if p.lhs not in self.nonterminals:
                self.nonterminals.append(p.lhs)
        syms: List[str] = []
        for p in self.productions:
            for s in p.rhs:
                if s not in self.nonterminals and s not in syms:
                    syms.append(s)
        self.terminals: List[str] = syms
        self._first: Optional[Dict[str, Set[str]]] = None
        self._follow: Optional[Dict[str, Set[str]]] = None

    # ------------------------------------------------------------------ util
    def prods_for(self, nt: str) -> List[Production]:
        return [p for p in self.productions if p.lhs == nt]

    def is_nt(self, s: str) -> bool:
        return s in self.nonterminals

    def __str__(self) -> str:
        return "\n".join(f"{i:>3}. {p}" for i, p in enumerate(self.productions))

    # ----------------------------------------------------------------- FIRST
    def first_sets(self) -> Dict[str, Set[str]]:
        if self._first is not None:
            return self._first
        first: Dict[str, Set[str]] = {t: {t} for t in self.terminals}
        for nt in self.nonterminals:
            first[nt] = set()
        changed = True
        while changed:
            changed = False
            for p in self.productions:
                before = len(first[p.lhs])
                first[p.lhs] |= self.first_of_string(p.rhs, first)
                if len(first[p.lhs]) != before:
                    changed = True
        self._first = first
        return first

    def first_of_string(self, symbols: Sequence[str],
                        first: Optional[Dict[str, Set[str]]] = None) -> Set[str]:
        """FIRST of a whole string of grammar symbols (includes ε if nullable)."""
        first = first if first is not None else self.first_sets()
        out: Set[str] = set()
        for s in symbols:
            fs = first.get(s, {s})
            out |= (fs - {EPS})
            if EPS not in fs:
                return out
        out.add(EPS)
        return out

    # ---------------------------------------------------------------- FOLLOW
    def follow_sets(self) -> Dict[str, Set[str]]:
        if self._follow is not None:
            return self._follow
        first = self.first_sets()
        follow: Dict[str, Set[str]] = {nt: set() for nt in self.nonterminals}
        follow[self.start].add(EOF)
        changed = True
        while changed:
            changed = False
            for p in self.productions:
                for i, B in enumerate(p.rhs):
                    if not self.is_nt(B):
                        continue
                    rest = p.rhs[i + 1:]
                    fr = self.first_of_string(rest, first)
                    add = fr - {EPS}
                    if EPS in fr or not rest:
                        add |= follow[p.lhs]
                    if not add <= follow[B]:
                        follow[B] |= add
                        changed = True
        self._follow = follow
        return follow

    # ------------------------------------------------------------ LL(1) table
    def ll1_table(self) -> Tuple[Dict[Tuple[str, str], List[Production]], List[str]]:
        first, follow = self.first_sets(), self.follow_sets()
        table: Dict[Tuple[str, str], List[Production]] = {}
        conflicts: List[str] = []
        for p in self.productions:
            fr = self.first_of_string(p.rhs, first)
            for t in fr - {EPS}:
                table.setdefault((p.lhs, t), []).append(p)
            if EPS in fr:
                for t in follow[p.lhs]:
                    table.setdefault((p.lhs, t), []).append(p)
        for (nt, t), ps in sorted(table.items()):
            if len(ps) > 1:
                why = ("left recursion" if any(p.rhs and p.rhs[0] == nt for p in ps)
                       else "common prefix / needs left factoring")
                conflicts.append(
                    f"M[{nt}, {t}] holds {len(ps)} productions "
                    f"({' | '.join(str(p) for p in ps)}) - {why}")
        return table, conflicts

    # ------------------------------------------------- grammar transformations
    def left_recursive_nts(self) -> List[str]:
        return [nt for nt in self.nonterminals
                if any(p.rhs and p.rhs[0] == nt for p in self.prods_for(nt))]

    def eliminate_left_recursion(self) -> Tuple["Grammar", List[str]]:
        """Remove *immediate* left recursion:  A -> A a | b  ==>  A -> b A', A' -> a A' | ε"""
        log: List[str] = []
        rules: List[Tuple[str, Sequence[str]]] = []
        for nt in self.nonterminals:
            prods = self.prods_for(nt)
            rec = [p.rhs[1:] for p in prods if p.rhs and p.rhs[0] == nt]
            non = [p.rhs for p in prods if not (p.rhs and p.rhs[0] == nt)]
            if not rec:
                rules.extend((nt, list(p.rhs)) for p in prods)
                continue
            tail = nt + "'"
            log.append(f"{nt}: {len(rec)} left-recursive production(s) rewritten using {tail}")
            for b in non:
                rules.append((nt, list(b) + [tail]))
            for a in rec:
                rules.append((tail, list(a) + [tail]))
            rules.append((tail, []))
        return Grammar(rules, self.start, self.name + " (no left recursion)"), log

    def left_factor(self) -> Tuple["Grammar", List[str]]:
        """A -> a b | a c  ==>  A -> a A'', A'' -> b | c   (repeated to a fixed point)"""
        log: List[str] = []
        rules = [(p.lhs, list(p.rhs)) for p in self.productions]
        suffix = 0
        changed = True
        while changed:
            changed = False
            by_lhs: Dict[str, List[List[str]]] = {}
            order: List[str] = []
            for lhs, rhs in rules:
                if lhs not in by_lhs:
                    by_lhs[lhs] = []
                    order.append(lhs)
                by_lhs[lhs].append(rhs)
            for lhs in order:
                alts = by_lhs[lhs]
                groups: Dict[str, List[List[str]]] = {}
                for rhs in alts:
                    key = rhs[0] if rhs else EPS
                    groups.setdefault(key, []).append(rhs)
                for key, group in groups.items():
                    if key == EPS or len(group) < 2:
                        continue
                    # longest common prefix of the group
                    plen = 1
                    while all(len(r) > plen for r in group) and \
                            len({r[plen] for r in group}) == 1:
                        plen += 1
                    prefix = group[0][:plen]
                    suffix += 1
                    newnt = f"{lhs}__f{suffix}"
                    log.append(f"{lhs}: factored common prefix "
                               f"'{' '.join(prefix)}' into {newnt}")
                    rules = [(l, r) for (l, r) in rules
                             if not (l == lhs and r in group)]
                    rules.append((lhs, prefix + [newnt]))
                    for r in group:
                        rules.append((newnt, r[plen:]))
                    changed = True
                    break
                if changed:
                    break
        return Grammar(rules, self.start, self.name + " (left factored)"), log


# ==========================================================================
# Demo grammars used by the Glass-Box "grammar workbench" tab
# ==========================================================================
AMBIGUOUS_EXPR = Grammar(
    [("E", ["E", "+", "E"]),
     ("E", ["E", "*", "E"]),
     ("E", ["(", "E", ")"]),
     ("E", ["id"])],
    "E", "ambiguous expression grammar")

UNAMBIGUOUS_EXPR = Grammar(
    [("E", ["E", "+", "T"]),
     ("E", ["T"]),
     ("T", ["T", "*", "F"]),
     ("T", ["F"]),
     ("F", ["(", "E", ")"]),
     ("F", ["id"])],
    "E", "unambiguous expression grammar")
