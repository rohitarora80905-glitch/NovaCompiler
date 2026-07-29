"""
nova.optimizer - Module 5: the machine-independent optimiser.

Passes, in the order they run:

  1. local value numbering / DAG      - CSE, constant folding, algebraic identities
  2. global constant propagation      - driven by reaching definitions
  3. global copy propagation          - driven by reaching definitions
  4. loop-invariant code motion       - natural loops + a synthesised preheader
  5. strength reduction               - induction variables, and x*2 -> x+x
  6. dead-code elimination            - driven by live-variable analysis
  7. unreachable-code elimination     - reachability on the flow graph
  8. jump optimisation                - goto-to-goto, goto-to-next-block

Each pass records how many instructions it removed, so the report can carry a
real before/after table instead of a claim.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple

from .cfg import CFG, Block, CONDS, build_cfg, linearise
from .dag import DagNode, is_const, as_int, local_value_numbering
from .dataflow import (defs_of, live_variables, live_at_each_instruction,
                       reaching_definitions, uses_of)
from .tac import ARITH, Quad, fmt


@dataclass
class PassRecord:
    name: str
    before: int
    after: int
    detail: str = ""
    code_after: List[str] = field(default_factory=list)

    @property
    def removed(self) -> int:
        return self.before - self.after


class Optimizer:
    def __init__(self, cfg: CFG, params: List[str]):
        self.cfg = cfg
        self.params = params
        self.records: List[PassRecord] = []
        self.dag_nodes: Dict[int, List[DagNode]] = {}
        self.notes: List[str] = []

    # ------------------------------------------------------------- plumbing
    def count(self) -> int:
        return sum(len(b.quads) for b in self.cfg.blocks)

    def record(self, name: str, before: int, detail: str = "") -> None:
        from .cfg import fmt_block
        listing = []
        for b in self.cfg.blocks:
            listing.append(f"{b.name}:")
            listing += ["    " + fmt_block(q) for q in b.quads]
        self.records.append(PassRecord(name, before, self.count(), detail, listing))

    def run_all(self) -> CFG:
        self.pass_local_dag()
        self.pass_constant_propagation()
        self.pass_copy_propagation()
        self.pass_licm()
        self.pass_strength_reduction()
        self.pass_dead_code()
        self.pass_unreachable()
        self.pass_jump_opt()
        # a second cheap sweep: earlier passes expose new opportunities
        self.pass_local_dag(second=True)
        self.pass_dead_code(second=True)
        return self.cfg

    # ------------------------------------------------ 1. local DAG / value nos
    def pass_local_dag(self, second: bool = False) -> None:
        before = self.count()
        cse = fold = ident = 0
        for b in self.cfg.blocks:
            res = local_value_numbering(b.quads)
            b.quads = res.quads
            if not second:
                self.dag_nodes[b.id] = res.nodes
            cse += res.cse_hits
            fold += res.folded
            ident += res.identities
        self.cfg._recompute_edges()
        self.record("Local value numbering / DAG" + (" (2nd sweep)" if second else ""),
                    before,
                    f"{cse} common sub-expression(s) reused, {fold} constant(s) "
                    f"folded, {ident} algebraic identity(ies) simplified")

    # ------------------------------------------- 2. global constant propagation
    def pass_constant_propagation(self) -> None:
        before = self.count()
        changed_total = 0
        for _ in range(5):
            rd = reaching_definitions(self.cfg)
            defmap: Dict[Tuple[int, int, str], Quad] = {}
            for b in self.cfg.blocks:
                for i, q in enumerate(b.quads):
                    for v in defs_of(q):
                        defmap[(b.id, i, v)] = q
            changed = False
            for b in self.cfg.blocks:
                live_in = set(rd.IN[b.id])
                for i, q in enumerate(b.quads):
                    for slot in ("a", "b"):
                        x = getattr(q, slot)
                        if not isinstance(x, str) or is_const(x) or x is None:
                            continue
                        if q.op == "call" and slot == "a":
                            continue
                        reaching = [d for d in live_in if d[2] == x]
                        vals = set()
                        for d in reaching:
                            dq = defmap.get(d)
                            if dq is not None and dq.op == "=" and is_const(dq.a):
                                vals.add(dq.a)
                            else:
                                vals.add(None)
                        if len(vals) == 1 and None not in vals and reaching:
                            setattr(q, slot, vals.pop())
                            changed = True
                            changed_total += 1
                    # advance the local view of reaching definitions
                    for v in defs_of(q):
                        live_in = {d for d in live_in if d[2] != v}
                        live_in.add((b.id, i, v))
            if not changed:
                break
        # fold anything the substitution made constant
        for b in self.cfg.blocks:
            b.quads = local_value_numbering(b.quads).quads
        self.cfg._recompute_edges()
        self.record("Global constant propagation", before,
                    f"{changed_total} operand(s) replaced by a constant")

    # ------------------------------------------------ 3. global copy propagation
    def available_copies(self) -> Dict[int, Set[Tuple[str, str]]]:
        """Forward analysis, meet = intersection.

        The pair (x, y) is *available* at a point when, on every path reaching
        it, the copy x = y has been executed and neither x nor y has been
        assigned since.  Only then may a use of x be rewritten to y.  Getting
        this wrong is the classic copy-propagation bug: inside

            t = b;  b = a % b;  a = t;

        the copy t = b is killed by the very next instruction, so the third
        line must keep reading t.
        """
        universe: Set[Tuple[str, str]] = set()
        for b in self.cfg.blocks:
            for q in b.quads:
                if q.op == "=" and isinstance(q.a, str) and not is_const(q.a) \
                        and q.r != q.a:
                    universe.add((q.r, q.a))

        def transfer(inset: Set[Tuple[str, str]], blk) -> Set[Tuple[str, str]]:
            cur = set(inset)
            for q in blk.quads:
                for v in defs_of(q):
                    cur = {c for c in cur if c[0] != v and c[1] != v}
                if q.op == "=" and isinstance(q.a, str) and not is_const(q.a) \
                        and q.r != q.a:
                    cur.add((q.r, q.a))
            return cur

        IN = {b.id: set() for b in self.cfg.blocks}
        OUT = {b.id: (set() if b.id == self.cfg.entry else set(universe))
               for b in self.cfg.blocks}
        for _ in range(60):
            changed = False
            for b in self.cfg.blocks:
                if b.id == self.cfg.entry or not b.preds:
                    newin: Set[Tuple[str, str]] = set()
                else:
                    newin = set(universe)
                    for pr in b.preds:
                        newin &= OUT[pr]
                newout = transfer(newin, b)
                if newin != IN[b.id] or newout != OUT[b.id]:
                    IN[b.id], OUT[b.id] = newin, newout
                    changed = True
            if not changed:
                break
        return IN

    def pass_copy_propagation(self) -> None:
        before = self.count()
        replaced = 0
        for _ in range(5):
            IN = self.available_copies()
            changed = False
            for b in self.cfg.blocks:
                cur = set(IN[b.id])
                for q in b.quads:
                    for slot in ("a", "b"):
                        x = getattr(q, slot)
                        if not isinstance(x, str) or is_const(x):
                            continue
                        if q.op == "call" and slot == "a":
                            continue
                        src = {y for (xx, y) in cur if xx == x}
                        if len(src) != 1:
                            continue
                        y = src.pop()
                        setattr(q, slot, y)
                        replaced += 1
                        changed = True
                    for v in defs_of(q):
                        cur = {c for c in cur if c[0] != v and c[1] != v}
                    if q.op == "=" and isinstance(q.a, str) and not is_const(q.a) \
                            and q.r != q.a:
                        cur.add((q.r, q.a))
            if not changed:
                break
        self.cfg._recompute_edges()
        self.record("Global copy propagation", before,
                    f"{replaced} use(s) of a copy replaced by the original")

    # --------------------------------------------------------------- 4. LICM
    def preheader_for(self, header: int, body: Set[int]) -> int:
        """Create (or reuse) a block that runs once, just before the loop."""
        outside = [p for p in self.cfg.blocks[header].preds if p not in body]
        if len(outside) == 1:
            p = outside[0]
            blk = self.cfg.blocks[p]
            if len(blk.succs) == 1 and blk.succs[0] == header:
                return p                       # already a perfectly good preheader
        new_id = len(self.cfg.blocks)
        pre = Block(new_id, [Quad("goto", None, None, header)])
        self.cfg.blocks.append(pre)
        for p in outside:
            blk = self.cfg.blocks[p]
            t = blk.terminator()
            if t is None:
                blk.quads.append(Quad("goto", None, None, new_id))
            else:
                if t.op == "goto" and t.r == header:
                    t.r = new_id
                elif t.op in CONDS and t.r == header:
                    t.r = new_id
                elif t.op == "jtab":
                    t.b = [(v, new_id if tg == header else tg) for v, tg in t.b]
                    if t.r == header:
                        t.r = new_id
                if t.op in CONDS and p + 1 == header:
                    blk.quads.append(Quad("goto", None, None, new_id))
        self.cfg._recompute_edges()
        return new_id

    def pass_licm(self) -> None:
        before = self.count()
        moved = 0
        for header, body in self.cfg.natural_loops():
            defined_in_loop: Dict[str, int] = {}
            for bid in body:
                for q in self.cfg.blocks[bid].quads:
                    for v in defs_of(q):
                        defined_in_loop[v] = defined_in_loop.get(v, 0) + 1
            dom = self.cfg.dominators()
            exits = {bid for bid in body
                     if any(s not in body for s in self.cfg.blocks[bid].succs)}
            # A `while` body never dominates the loop exit - the test runs first -
            # so a strict "guaranteed to execute" rule would hoist nothing at all.
            # The standard relaxation is to hoist *speculatively* when the
            # instruction cannot fault (no division, no memory access) and its
            # result is dead once the loop finishes, so computing it needlessly
            # on a zero-trip loop can be observed by nobody.
            live = live_variables(self.cfg)
            live_after: Set[str] = set()
            for bid in exits:
                for s2 in self.cfg.blocks[bid].succs:
                    if s2 not in body:
                        live_after |= live.IN[s2]
            SAFE = {"+", "-", "*"}
            pre = None
            for bid in sorted(body):
                blk = self.cfg.blocks[bid]
                always_runs = all(bid in dom[e] for e in exits)
                keep: List[Quad] = []
                for q in blk.quads:
                    invariant = (
                        q.op in ARITH
                        and q.r is not None
                        and defined_in_loop.get(q.r, 0) == 1
                        and all(x is None or is_const(x) or
                                defined_in_loop.get(x, 0) == 0
                                for x in (q.a, q.b))
                        and (always_runs or
                             (q.op in SAFE and q.r not in live_after))
                    )
                    if invariant:
                        if pre is None:
                            pre = self.preheader_for(header, body)
                            blk = self.cfg.blocks[bid]
                        pblk = self.cfg.blocks[pre]
                        t = pblk.terminator()
                        at = len(pblk.quads) - (1 if t else 0)
                        pblk.quads.insert(at, q)
                        defined_in_loop[q.r] = 0
                        moved += 1
                        self.notes.append(
                            f"hoisted '{fmt(q)}' out of the loop headed by B{header}")
                    else:
                        keep.append(q)
                blk.quads = keep
        self.cfg._recompute_edges()
        self.record("Loop-invariant code motion", before,
                    f"{moved} instruction(s) hoisted into a loop preheader")

    # --------------------------------------------------- 5. strength reduction
    def pass_strength_reduction(self) -> None:
        before = self.count()
        n_alg = 0
        n_iv = 0
        # (a) cheap algebraic form:  x * 2  ->  x + x
        for b in self.cfg.blocks:
            for q in b.quads:
                if q.op == "*":
                    if as_int(q.b) == 2 and not is_const(q.a):
                        q.op, q.b = "+", q.a
                        n_alg += 1
                    elif as_int(q.a) == 2 and not is_const(q.b):
                        q.op, q.a = "+", q.b
                        q.b = q.a
                        n_alg += 1

        # (b) induction variables:  j = i * c  inside a loop where  i = i + d
        for header, body in self.cfg.natural_loops():
            steps: Dict[str, int] = {}
            def_count: Dict[str, int] = {}
            for bid in body:
                for q in self.cfg.blocks[bid].quads:
                    for v in defs_of(q):
                        def_count[v] = def_count.get(v, 0) + 1
            for bid in body:
                for q in self.cfg.blocks[bid].quads:
                    if q.op == "+" and q.r == q.a and as_int(q.b) is not None \
                            and def_count.get(q.r, 0) == 1:
                        steps[q.r] = as_int(q.b)
            if not steps:
                continue
            for bid in sorted(body):
                blk = self.cfg.blocks[bid]
                for idx, q in enumerate(list(blk.quads)):
                    if q.op != "*" or def_count.get(q.r, 0) != 1:
                        continue
                    iv, c = None, None
                    if q.a in steps and as_int(q.b) is not None:
                        iv, c = q.a, as_int(q.b)
                    elif q.b in steps and as_int(q.a) is not None:
                        iv, c = q.b, as_int(q.a)
                    if iv is None:
                        continue
                    pre = self.preheader_for(header, body)
                    blk = self.cfg.blocks[bid]
                    pblk = self.cfg.blocks[pre]
                    t = pblk.terminator()
                    at = len(pblk.quads) - (1 if t else 0)
                    pblk.quads.insert(at, Quad("*", iv, str(c), q.r))
                    blk.quads = [x for x in blk.quads if x is not q]
                    # keep the derived variable in step with the basic one
                    for bid2 in body:
                        b2 = self.cfg.blocks[bid2]
                        for k, q2 in enumerate(list(b2.quads)):
                            if q2.op == "+" and q2.r == iv and as_int(q2.b) == steps[iv]:
                                b2.quads.insert(k + 1, Quad("+", q.r,
                                                            str(steps[iv] * c), q.r))
                    n_iv += 1
                    self.notes.append(
                        f"strength reduction: '{q.r} = {iv} * {c}' replaced by an "
                        f"addition of {steps[iv] * c} per iteration")
                    break
        self.cfg._recompute_edges()
        self.record("Strength reduction", before,
                    f"{n_alg} multiplication(s) turned into addition, "
                    f"{n_iv} induction variable(s) reduced")

    # ------------------------------------------------- 6. dead-code elimination
    def pass_dead_code(self, second: bool = False) -> None:
        before = self.count()
        removed = 0
        for _ in range(4):
            lv = live_variables(self.cfg)
            per = live_at_each_instruction(self.cfg, lv.OUT)
            changed = False
            for b in self.cfg.blocks:
                keep: List[Quad] = []
                for i, q in enumerate(b.quads):
                    d = defs_of(q)
                    live_after = per[b.id][i]
                    if d and not (d & live_after):
                        if q.op == "call":
                            q.r = None          # a call may print: keep the call
                            keep.append(q)
                        else:
                            removed += 1
                            changed = True
                            continue
                    keep.append(q)
                b.quads = keep
            if not changed:
                break
        self.cfg._recompute_edges()
        self.record("Dead-code elimination" + (" (2nd sweep)" if second else ""),
                    before, f"{removed} instruction(s) whose result was never used")

    # ------------------------------------------------ 7. unreachable-code removal
    def pass_unreachable(self) -> None:
        before = self.count()
        reach = self.cfg.reachable()
        if len(reach) == len(self.cfg.blocks):
            self.record("Unreachable-code elimination", before,
                        "every block is reachable")
            return
        keep = sorted(reach)
        remap = {old: new for new, old in enumerate(keep)}
        blocks: List[Block] = []
        for old in keep:
            b = self.cfg.blocks[old]
            nb = Block(remap[old], b.quads)
            for q in nb.quads:
                if q.op == "goto" or q.op in CONDS:
                    q.r = remap.get(q.r, len(keep))
                elif q.op == "jtab":
                    q.b = [(v, remap.get(t, len(keep))) for v, t in q.b]
                    q.r = remap.get(q.r, len(keep))
            blocks.append(nb)
        self.cfg = CFG(blocks, params=list(getattr(self.cfg, 'params', [])))
        self.record("Unreachable-code elimination", before,
                    f"{len(reach)} of {len(remap) + (before and 0) or len(reach)} "
                    f"blocks reachable; the rest deleted")

    # ------------------------------------------------------ 8. jump optimisation
    def pass_jump_opt(self) -> None:
        before = self.count()
        n = 0
        for _ in range(4):
            changed = False
            # goto B, where B is only 'goto C'  ->  goto C
            for b in self.cfg.blocks:
                t = b.terminator()
                if t is None:
                    continue
                def resolve(tgt: int) -> int:
                    seen = set()
                    while 0 <= tgt < len(self.cfg.blocks) and tgt not in seen:
                        seen.add(tgt)
                        tb = self.cfg.blocks[tgt]
                        if len(tb.quads) == 1 and tb.quads[0].op == "goto":
                            tgt = tb.quads[0].r
                        else:
                            break
                    return tgt
                if t.op in ("goto",) or t.op in CONDS:
                    r = resolve(t.r)
                    if r != t.r:
                        t.r = r
                        n += 1
                        changed = True
            # goto to the very next block is redundant
            for i, b in enumerate(self.cfg.blocks):
                t = b.terminator()
                if t is not None and t.op == "goto" and t.r == i + 1:
                    b.quads.pop()
                    n += 1
                    changed = True
            if not changed:
                break
        self.cfg._recompute_edges()
        self.record("Jump optimisation", before,
                    f"{n} jump(s) shortened or removed")
