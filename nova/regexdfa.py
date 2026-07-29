"""
nova.regexdfa - Module 1 back half, done the textbook way.

Extended regular expression  ->  syntax tree  ->  nullable / firstpos / lastpos
-> followpos  ->  DFA (Aho's *direct method*, no NFA, no subset construction)
->  minimised DFA (Moore partition refinement).

Nothing here uses Python's `re` module for the actual recognition.  `re` is not
imported at all; the recogniser really is our own DFA table.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, FrozenSet, List, Optional, Sequence, Set, Tuple

# --------------------------------------------------------------------------
# The alphabet we care about: printable ASCII plus the three whitespace chars.
# --------------------------------------------------------------------------
ALPHABET: List[str] = [chr(c) for c in range(32, 127)] + ["\t", "\n", "\r"]


# ==========================================================================
# 1. Regular-expression syntax tree
# ==========================================================================
class Node:
    """Base class for a node of the regular-expression syntax tree."""

    nullable: bool = False
    firstpos: Set[int] = frozenset()
    lastpos: Set[int] = frozenset()


@dataclass
class Leaf(Node):
    """A leaf = one *position*.  `chars` is the set of characters it matches."""
    pos: int
    chars: FrozenSet[str]
    label: str = "?"          # human readable, for the tree dump
    end_marker: Optional[int] = None   # token id, if this is a '#' end marker


@dataclass
class Cat(Node):
    left: Node
    right: Node


@dataclass
class Alt(Node):
    left: Node
    right: Node


@dataclass
class Star(Node):
    child: Node


@dataclass
class Empty(Node):
    """Matches the empty string (used for `?` and for empty alternatives)."""


# ==========================================================================
# 2. Regular-expression parser
#    grammar:  alt -> cat ('|' cat)*
#              cat -> rep*
#              rep -> atom ('*'|'+'|'?')*
#              atom-> '(' alt ')' | '[' class ']' | '.' | escape | char
# ==========================================================================
class RegexParser:
    def __init__(self, pattern: str, counter: List[int]):
        self.p = pattern
        self.i = 0
        self.counter = counter          # shared position counter
        self.positions: Dict[int, Leaf] = {}

    # -- helpers ----------------------------------------------------------
    def _peek(self) -> str:
        return self.p[self.i] if self.i < len(self.p) else ""

    def _next(self) -> str:
        ch = self.p[self.i]
        self.i += 1
        return ch

    def _leaf(self, chars, label) -> Leaf:
        self.counter[0] += 1
        lf = Leaf(self.counter[0], frozenset(chars), label)
        self.positions[lf.pos] = lf
        return lf

    # -- grammar ----------------------------------------------------------
    def parse(self) -> Node:
        node = self._alt()
        if self.i != len(self.p):
            raise ValueError(f"trailing junk in regex {self.p!r} at {self.i}")
        return node

    def _alt(self) -> Node:
        node = self._cat()
        while self._peek() == "|":
            self._next()
            node = Alt(node, self._cat())
        return node

    def _cat(self) -> Node:
        if self._peek() in ("", "|", ")"):
            return Empty()
        node = self._rep()
        while self._peek() not in ("", "|", ")"):
            node = Cat(node, self._rep())
        return node

    def _rep(self) -> Node:
        node = self._atom()
        while self._peek() in ("*", "+", "?"):
            op = self._next()
            if op == "*":
                node = Star(node)
            elif op == "+":                       # r+  ==  r r*
                node = Cat(node, Star(self._clone(node)))
            else:                                 # r?  ==  r | eps
                node = Alt(node, Empty())
        return node

    def _clone(self, node: Node) -> Node:
        """`+` needs a second copy of the sub-expression with *fresh* positions."""
        if isinstance(node, Leaf):
            return self._leaf(node.chars, node.label)
        if isinstance(node, Cat):
            return Cat(self._clone(node.left), self._clone(node.right))
        if isinstance(node, Alt):
            return Alt(self._clone(node.left), self._clone(node.right))
        if isinstance(node, Star):
            return Star(self._clone(node.child))
        return Empty()

    def _atom(self) -> Node:
        ch = self._peek()
        if ch == "(":
            self._next()
            node = self._alt()
            if self._peek() != ")":
                raise ValueError(f"missing ) in {self.p!r}")
            self._next()
            return node
        if ch == "[":
            return self._charclass()
        if ch == ".":
            self._next()
            return self._leaf([c for c in ALPHABET if c != "\n"], ".")
        if ch == "\\":
            self._next()
            esc = self._next()
            return self._leaf(self._escape(esc), "\\" + esc)
        if ch == "":
            raise ValueError(f"unexpected end of regex {self.p!r}")
        self._next()
        return self._leaf([ch], ch)

    def _escape(self, esc: str) -> Sequence[str]:
        table = {
            "d": [c for c in ALPHABET if c.isdigit()],
            "w": [c for c in ALPHABET if c.isalnum() or c == "_"],
            "s": [" ", "\t", "\n", "\r"],
            "n": ["\n"],
            "t": ["\t"],
            "r": ["\r"],
        }
        return table.get(esc, [esc])

    def _charclass(self) -> Node:
        self._next()                       # consume '['
        negate = False
        if self._peek() == "^":
            self._next()
            negate = True
        chars: Set[str] = set()
        raw = "["
        first = True
        while self._peek() != "]" or first:
            first = False
            if self._peek() == "":
                raise ValueError(f"unterminated [ ] in {self.p!r}")
            c = self._next()
            if c == "\\":
                chars.update(self._escape(self._next()))
                continue
            if self._peek() == "-" and self.i + 1 < len(self.p) and self.p[self.i + 1] != "]":
                self._next()               # consume '-'
                hi = self._next()
                chars.update(chr(x) for x in range(ord(c), ord(hi) + 1))
                raw += f"{c}-{hi}"
                continue
            chars.add(c)
            raw += c
        self._next()                       # consume ']'
        raw += "]"
        if negate:
            chars = set(ALPHABET) - chars
            raw = "[^" + raw[1:]
        return self._leaf(chars, raw)


# ==========================================================================
# 3. The direct method: nullable, firstpos, lastpos, followpos
# ==========================================================================
class FollowposBuilder:
    def __init__(self):
        self.followpos: Dict[int, Set[int]] = {}

    def annotate(self, node: Node) -> None:
        """Bottom-up computation of nullable / firstpos / lastpos + followpos."""
        if isinstance(node, Leaf):
            node.nullable = False
            node.firstpos = {node.pos}
            node.lastpos = {node.pos}
            self.followpos.setdefault(node.pos, set())
        elif isinstance(node, Empty):
            node.nullable = True
            node.firstpos = set()
            node.lastpos = set()
        elif isinstance(node, Alt):
            self.annotate(node.left)
            self.annotate(node.right)
            node.nullable = node.left.nullable or node.right.nullable
            node.firstpos = node.left.firstpos | node.right.firstpos
            node.lastpos = node.left.lastpos | node.right.lastpos
        elif isinstance(node, Cat):
            self.annotate(node.left)
            self.annotate(node.right)
            node.nullable = node.left.nullable and node.right.nullable
            node.firstpos = (node.left.firstpos | node.right.firstpos
                             if node.left.nullable else node.left.firstpos)
            node.lastpos = (node.left.lastpos | node.right.lastpos
                            if node.right.nullable else node.right.lastpos)
            # rule 1: c1 c2  ->  followpos(i) includes firstpos(c2)
            for i in node.left.lastpos:
                self.followpos.setdefault(i, set()).update(node.right.firstpos)
        elif isinstance(node, Star):
            self.annotate(node.child)
            node.nullable = True
            node.firstpos = node.child.firstpos
            node.lastpos = node.child.lastpos
            # rule 2: (c1)*  ->  followpos(i) includes firstpos(c1)
            for i in node.lastpos:
                self.followpos.setdefault(i, set()).update(node.firstpos)
        else:
            raise TypeError(node)


# ==========================================================================
# 4. DFA
# ==========================================================================
@dataclass
class DFA:
    n_states: int
    start: int
    # trans[state][symbol_class_index] -> state (or -1 for dead)
    trans: List[List[int]]
    accept: Dict[int, int]                       # state -> token id
    classes: List[FrozenSet[str]]                # symbol equivalence classes
    class_of: Dict[str, int]                     # char -> class index
    state_positions: List[FrozenSet[int]] = field(default_factory=list)

    # -- simulation ------------------------------------------------------
    def step(self, state: int, ch: str) -> int:
        cls = self.class_of.get(ch, -1)
        if cls < 0:
            return -1
        return self.trans[state][cls]

    # -- pretty printing --------------------------------------------------
    def class_label(self, idx: int) -> str:
        """Compact printable description of an equivalence class."""
        chars = sorted(self.classes[idx])
        if len(chars) == 1:
            return _vis(chars[0])
        # collapse consecutive runs into ranges
        runs, start, prev = [], chars[0], chars[0]
        for c in chars[1:]:
            if ord(c) == ord(prev) + 1:
                prev = c
                continue
            runs.append((start, prev))
            start = prev = c
        runs.append((start, prev))
        if len(runs) > 4:
            return f"[{len(chars)} chars]"
        return "[" + ",".join(_vis(a) if a == b else f"{_vis(a)}-{_vis(b)}"
                              for a, b in runs) + "]"

    def table_rows(self, token_names: Dict[int, str]) -> List[List[str]]:
        rows = []
        for s in range(self.n_states):
            moves = []
            for c in range(len(self.classes)):
                t = self.trans[s][c]
                if t >= 0:
                    moves.append(f"{self.class_label(c)}->{t}")
            rows.append([
                ("->" if s == self.start else "") + f"S{s}",
                token_names.get(self.accept.get(s, -1), ""),
                ", ".join(moves) if moves else "(dead end)",
            ])
        return rows


def _vis(c: str) -> str:
    return {" ": "␠", "\t": "\\t", "\n": "\\n", "\r": "\\r"}.get(c, c)


# ==========================================================================
# 5. Build a combined DFA from a list of (token_id, regex) token specs
# ==========================================================================
@dataclass
class BuildTrace:
    """Everything the Glass-Box viewer wants to show about Module 1."""
    followpos: Dict[int, Set[int]]
    positions: Dict[int, Leaf]
    dfa_before: DFA
    dfa_after: DFA
    subset_steps: List[Tuple[int, FrozenSet[int]]]


def build_lexer_dfa(specs: Sequence[Tuple[int, str, str]]) -> Tuple[DFA, BuildTrace]:
    """specs = [(token_id, name, regex), ...] in *priority order*."""
    counter = [0]
    roots: List[Node] = []
    positions: Dict[int, Leaf] = {}

    for tok_id, name, pattern in specs:
        parser = RegexParser(pattern, counter)
        tree = parser.parse()
        positions.update(parser.positions)
        # append the end marker  #tok_id
        counter[0] += 1
        marker = Leaf(counter[0], frozenset(), f"#{name}", end_marker=tok_id)
        positions[marker.pos] = marker
        roots.append(Cat(tree, marker))

    # combine every token regex with |
    root = roots[0]
    for r in roots[1:]:
        root = Alt(root, r)

    fb = FollowposBuilder()
    fb.annotate(root)
    followpos = fb.followpos

    # ---- symbol equivalence classes -----------------------------------
    # Two characters are equivalent iff no leaf distinguishes them.
    sig: Dict[str, Tuple] = {}
    leaves = [p for p in positions.values() if p.end_marker is None]
    for ch in ALPHABET:
        sig[ch] = tuple(ch in lf.chars for lf in leaves)
    groups: Dict[Tuple, Set[str]] = {}
    for ch, s in sig.items():
        groups.setdefault(s, set()).add(ch)
    classes = [frozenset(g) for g in groups.values()]
    # drop the class that no leaf ever accepts (saves a useless dead column)
    classes = [c for c in classes if any(next(iter(c)) in lf.chars for lf in leaves)]
    classes.sort(key=lambda c: min(ord(x) for x in c))
    class_of = {ch: i for i, cls in enumerate(classes) for ch in cls}

    # ---- subset construction over *positions* (the direct method) ------
    start_set = frozenset(root.firstpos)
    dstates: List[FrozenSet[int]] = [start_set]
    index = {start_set: 0}
    trans: List[List[int]] = []
    subset_steps: List[Tuple[int, FrozenSet[int]]] = [(0, start_set)]

    i = 0
    while i < len(dstates):
        S = dstates[i]
        row = [-1] * len(classes)
        for ci, cls in enumerate(classes):
            rep = next(iter(cls))
            U: Set[int] = set()
            for p in S:
                lf = positions[p]
                if lf.end_marker is None and rep in lf.chars:
                    U |= followpos.get(p, set())
            if U:
                U = frozenset(U)
                if U not in index:
                    index[U] = len(dstates)
                    dstates.append(U)
                    subset_steps.append((index[U], U))
                row[ci] = index[U]
        trans.append(row)
        i += 1

    accept: Dict[int, int] = {}
    for si, S in enumerate(dstates):
        ids = [positions[p].end_marker for p in S if positions[p].end_marker is not None]
        if ids:
            accept[si] = min(ids)          # lowest id == highest priority

    dfa = DFA(len(dstates), 0, trans, accept, classes, class_of,
              [frozenset(s) for s in dstates])
    minimized = minimize(dfa)
    trace = BuildTrace(followpos, positions, dfa, minimized, subset_steps)
    return minimized, trace


# ==========================================================================
# 6. DFA minimisation - Moore's partition refinement
# ==========================================================================
def minimize(dfa: DFA) -> DFA:
    n, k = dfa.n_states, len(dfa.classes)
    DEAD = n                                    # explicit dead state
    trans = [row[:] for row in dfa.trans] + [[DEAD] * k]
    trans = [[t if t >= 0 else DEAD for t in row] for row in trans]

    # initial partition: one block per token id, plus one for non-accepting
    block_of = [0] * (n + 1)
    key_to_block: Dict[int, int] = {}
    for s in range(n + 1):
        key = dfa.accept.get(s, -1)
        if key not in key_to_block:
            key_to_block[key] = len(key_to_block)
        block_of[s] = key_to_block[key]

    changed = True
    while changed:
        changed = False
        signature: Dict[Tuple, int] = {}
        new_block = [0] * (n + 1)
        for s in range(n + 1):
            sig = (block_of[s],) + tuple(block_of[trans[s][c]] for c in range(k))
            if sig not in signature:
                signature[sig] = len(signature)
            new_block[s] = signature[sig]
        if new_block != block_of:
            block_of = new_block
            changed = True

    # renumber so the start block is 0, dead block dropped
    dead_block = block_of[DEAD]
    order: Dict[int, int] = {block_of[dfa.start]: 0}
    for s in range(n):
        b = block_of[s]
        if b != dead_block and b not in order:
            order[b] = len(order)

    m = len(order)
    new_trans = [[-1] * k for _ in range(m)]
    new_accept: Dict[int, int] = {}
    reps: List[FrozenSet[int]] = [frozenset()] * m
    for s in range(n):
        b = block_of[s]
        if b == dead_block:
            continue
        ns = order[b]
        if dfa.state_positions:
            reps[ns] = dfa.state_positions[s]
        for c in range(k):
            t = trans[s][c]
            new_trans[ns][c] = -1 if block_of[t] == dead_block else order[block_of[t]]
        if s in dfa.accept:
            new_accept[ns] = dfa.accept[s]

    return DFA(m, 0, new_trans, new_accept, dfa.classes, dfa.class_of, reps)
