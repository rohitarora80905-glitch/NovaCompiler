"""
nova.cfg - Module 5: basic blocks, the flow graph, dominators, natural loops.

Once the code is in blocks, every jump target is a *block id* instead of an
instruction index.  That is what makes the optimiser safe: a pass can delete or
insert instructions freely without silently breaking every jump in the program.
`linearise()` turns blocks back into a flat quad list at the end.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Set, Tuple

from .tac import Quad, IRFunction, fmt

JUMPS = {"goto"}
CONDS = {"iflt", "ifgt", "ifle", "ifge", "ifeq", "ifne"}
TERMINATORS = JUMPS | CONDS | {"ret", "jtab"}


@dataclass
class Block:
    id: int
    quads: List[Quad] = field(default_factory=list)
    succs: List[int] = field(default_factory=list)
    preds: List[int] = field(default_factory=list)

    @property
    def name(self) -> str:
        return f"B{self.id}"

    def terminator(self) -> Optional[Quad]:
        return self.quads[-1] if self.quads and self.quads[-1].op in TERMINATORS else None

    def body(self) -> List[Quad]:
        return self.quads[:-1] if self.terminator() else list(self.quads)


class CFG:
    def __init__(self, blocks: List[Block], entry: int = 0,
                 params: Optional[List[str]] = None):
        self.blocks = blocks
        self.entry = entry
        # Parameters are definitions too: they are assigned by the caller before
        # the first instruction runs.  Every analysis has to know that, or it
        # will believe a parameter's only definition is the one inside the loop.
        self.params: List[str] = list(params or [])
        self._recompute_edges()

    # ---------------------------------------------------------------- edges
    def _recompute_edges(self) -> None:
        for b in self.blocks:
            b.succs, b.preds = [], []
        n = len(self.blocks)
        for i, b in enumerate(self.blocks):
            t = b.terminator()
            if t is None:
                if i + 1 < n:
                    b.succs.append(i + 1)
            elif t.op == "goto":
                b.succs.append(t.r)
            elif t.op in CONDS:
                b.succs.append(t.r)
                if i + 1 < n:
                    b.succs.append(i + 1)
            elif t.op == "jtab":
                for _, tgt in t.b:
                    if tgt not in b.succs:
                        b.succs.append(tgt)
                if t.r not in b.succs:
                    b.succs.append(t.r)
            # 'ret' has no successor
        for i, b in enumerate(self.blocks):
            for s in b.succs:
                if 0 <= s < n and i not in self.blocks[s].preds:
                    self.blocks[s].preds.append(i)

    def reachable(self) -> Set[int]:
        seen, stack = {self.entry}, [self.entry]
        while stack:
            b = stack.pop()
            for s in self.blocks[b].succs:
                if s not in seen:
                    seen.add(s)
                    stack.append(s)
        return seen

    # ----------------------------------------------------------- dominators
    def dominators(self) -> Dict[int, Set[int]]:
        n = len(self.blocks)
        allb = set(range(n))
        dom = {i: set(allb) for i in range(n)}
        dom[self.entry] = {self.entry}
        changed = True
        while changed:
            changed = False
            for i in range(n):
                if i == self.entry:
                    continue
                preds = self.blocks[i].preds
                if not preds:
                    new = {i}
                else:
                    new = set(allb)
                    for p in preds:
                        new &= dom[p]
                    new |= {i}
                if new != dom[i]:
                    dom[i] = new
                    changed = True
        return dom

    def idom(self) -> Dict[int, Optional[int]]:
        dom = self.dominators()
        out: Dict[int, Optional[int]] = {self.entry: None}
        for i in range(len(self.blocks)):
            if i == self.entry:
                continue
            strict = dom[i] - {i}
            best = None
            for d in strict:
                if all(d == o or d not in dom[o] - {o} for o in strict):
                    # d is dominated by every other strict dominator => nearest
                    if best is None or d in dom[best]:
                        best = d
            # fall back: pick the strict dominator with the largest dom set
            if best is None and strict:
                best = max(strict, key=lambda x: len(dom[x]))
            out[i] = best
        return out

    def dominance_frontiers(self) -> Dict[int, Set[int]]:
        """DF(n) = blocks where n's dominance stops - where phi functions go."""
        idom = self.idom()
        df: Dict[int, Set[int]] = {i: set() for i in range(len(self.blocks))}
        for b in range(len(self.blocks)):
            preds = self.blocks[b].preds
            if len(preds) < 2:
                continue
            for p in preds:
                runner = p
                while runner is not None and runner != idom.get(b):
                    df[runner].add(b)
                    runner = idom.get(runner)
        return df

    # --------------------------------------------------------- natural loops
    def back_edges(self) -> List[Tuple[int, int]]:
        dom = self.dominators()
        return [(i, s) for i, b in enumerate(self.blocks)
                for s in b.succs if s in dom.get(i, set())]

    def natural_loops(self) -> List[Tuple[int, Set[int]]]:
        """[(header, body-blocks)] for every back edge n -> h."""
        loops = []
        for n, h in self.back_edges():
            body = {h, n}
            stack = [n]
            while stack:
                m = stack.pop()
                for p in self.blocks[m].preds:
                    if p not in body:
                        body.add(p)
                        stack.append(p)
            loops.append((h, body))
        return loops

    # ------------------------------------------------------------ rendering
    def text(self) -> str:
        out = []
        for b in self.blocks:
            head = (f"{b.name}   preds: {', '.join('B%d' % p for p in b.preds) or '-'}"
                    f"   succs: {', '.join('B%d' % s for s in b.succs) or '-'}")
            out.append(head)
            for q in b.quads:
                out.append("      " + fmt_block(q))
            out.append("")
        return "\n".join(out)

    def edges(self) -> List[Tuple[int, int]]:
        return [(i, s) for i, b in enumerate(self.blocks) for s in b.succs]

    def n_instructions(self) -> int:
        return sum(len(b.quads) for b in self.blocks)


def fmt_block(q: Quad) -> str:
    """Format a quad whose jump targets are block ids."""
    labels = None
    if q.op == "goto":
        return f"goto B{q.r}"
    if q.op in CONDS:
        sym = {"iflt": "<", "ifgt": ">", "ifle": "<=", "ifge": ">=",
               "ifeq": "==", "ifne": "!="}[q.op]
        return f"if {q.a} {sym} {q.b} goto B{q.r}"
    if q.op == "jtab":
        cases = " ".join(f"{v}->B{t}" for v, t in q.b)
        return f"jumptable {q.a} [{cases}] default B{q.r}"
    return fmt(q, labels)


# ==========================================================================
def build_cfg(code: Sequence[Quad], params: Optional[List[str]] = None) -> CFG:
    """Partition a flat quad list into basic blocks (leaders algorithm)."""
    n = len(code)
    leaders: Set[int] = {0}
    for i, q in enumerate(code):
        if q.op in JUMPS or q.op in CONDS:
            if isinstance(q.r, int):
                leaders.add(q.r)
            leaders.add(i + 1)
        elif q.op == "jtab":
            for _, t in q.b:
                leaders.add(t)
            leaders.add(q.r)
            leaders.add(i + 1)
        elif q.op == "ret":
            leaders.add(i + 1)
    leaders = {l for l in leaders if 0 <= l < n} or {0}
    starts = sorted(leaders)
    idx_to_block: Dict[int, int] = {}
    blocks: List[Block] = []
    for bi, s in enumerate(starts):
        e = starts[bi + 1] if bi + 1 < len(starts) else n
        blk = Block(bi, [q.copy() for q in code[s:e]])
        blocks.append(blk)
        for i in range(s, e):
            idx_to_block[i] = bi
    idx_to_block[n] = len(blocks)          # a jump to "one past the end"

    # rewrite instruction-index targets into block ids
    for b in blocks:
        for q in b.quads:
            if q.op in JUMPS or q.op in CONDS:
                q.r = idx_to_block.get(q.r, len(blocks))
            elif q.op == "jtab":
                q.b = [(v, idx_to_block.get(t, len(blocks))) for v, t in q.b]
                q.r = idx_to_block.get(q.r, len(blocks))
    if any(_targets_end(b, len(blocks)) for b in blocks):
        blocks.append(Block(len(blocks), [Quad("ret", None)]))
    return CFG(blocks, params=params)


def _targets_end(b: Block, end_id: int) -> bool:
    for q in b.quads:
        if (q.op in JUMPS or q.op in CONDS) and q.r == end_id:
            return True
        if q.op == "jtab" and (q.r == end_id or any(t == end_id for _, t in q.b)):
            return True
    return False


def linearise(cfg: CFG) -> List[Quad]:
    """Blocks back to a flat quad list with instruction-index jump targets."""
    order = [i for i in range(len(cfg.blocks))]
    start: Dict[int, int] = {}
    pos = 0
    for i in order:
        start[i] = pos
        pos += len(cfg.blocks[i].quads)
    start[len(cfg.blocks)] = pos
    out: List[Quad] = []
    for i in order:
        for q in cfg.blocks[i].quads:
            q = q.copy()
            if q.op in JUMPS or q.op in CONDS:
                q.r = start.get(q.r, pos)
            elif q.op == "jtab":
                q.b = [(v, start.get(t, pos)) for v, t in q.b]
                q.r = start.get(q.r, pos)
            out.append(q)
    return out
