"""
nova.dag - Module 5: the DAG representation of a basic block.

Building the DAG and doing local value numbering are the same algorithm seen
from two sides, so this module does both at once:

  * it returns the DAG (nodes, children, the variable labels attached to each
    node) purely so the viewer can draw it, and
  * it returns rewritten code in which common sub-expressions have been
    eliminated, constants folded, copies propagated and algebraic identities
    (x+0, x*1, x*0, x-x, x/1) simplified.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

from .tac import ARITH, Quad, fmt
from .cfg import CONDS

COMMUTATIVE = {"+", "*"}


def is_const(x) -> bool:
    if not isinstance(x, str) or not x:
        return False
    if x.startswith('"'):
        return True
    body = x[1:] if x[0] == "-" else x
    return body.isdigit()


def as_int(x: str) -> Optional[int]:
    try:
        return int(x)
    except (TypeError, ValueError):
        return None


@dataclass
class DagNode:
    id: int
    op: str                       # 'leaf' or an operator
    children: List[int] = field(default_factory=list)
    value: str = ""               # for leaves: the initial name or constant
    labels: List[str] = field(default_factory=list)   # variables attached

    def render(self) -> str:
        kids = ", ".join(f"n{c}" for c in self.children)
        head = f"n{self.id}: {self.value}" if self.op == "leaf" else \
               f"n{self.id}: {self.op}({kids})"
        return head + (f"   <- {', '.join(self.labels)}" if self.labels else "")


@dataclass
class LVNResult:
    quads: List[Quad]
    nodes: List[DagNode]
    cse_hits: int = 0
    folded: int = 0
    identities: int = 0
    copies: int = 0


def local_value_numbering(quads: Sequence[Quad]) -> LVNResult:
    value_num: Dict[str, int] = {}
    vn_const: Dict[int, str] = {}
    vn_name: Dict[int, str] = {}
    expr_table: Dict[Tuple, int] = {}
    nodes: List[DagNode] = []
    out: List[Quad] = []
    res = LVNResult([], [])

    def new_vn(op: str, kids: List[int], value: str = "") -> int:
        node = DagNode(len(nodes), op, kids, value)
        nodes.append(node)
        return node.id

    def vn_of(x: str) -> int:
        """Value number of an operand, creating a leaf node if it is new."""
        if is_const(x):
            key = ("const", x)
            if key in expr_table:
                return expr_table[key]
            v = new_vn("leaf", [], x)
            vn_const[v] = x
            expr_table[key] = v
            return v
        if x in value_num:
            return value_num[x]
        v = new_vn("leaf", [], x)
        vn_name[v] = x
        value_num[x] = v
        return v

    def canon(x):
        """Best available spelling of an operand: constant > canonical name."""
        if x is None or not isinstance(x, str):
            return x
        if is_const(x):
            return x
        v = value_num.get(x)
        if v is None:
            return x
        if v in vn_const:
            return vn_const[v]
        return vn_name.get(v, x)

    def kill(name: str) -> None:
        """`name` is being redefined: it can no longer stand for its old value."""
        old = value_num.get(name)
        if old is not None and vn_name.get(old) == name:
            del vn_name[old]

    def define(name: str, v: int) -> None:
        kill(name)
        value_num[name] = v
        if v not in vn_name and v not in vn_const:
            vn_name[v] = name
        if name not in nodes[v].labels:
            nodes[v].labels.append(name)

    for q in quads:
        op = q.op

        if op == "=":
            a = canon(q.a)
            v = vn_of(a)
            if not is_const(a):
                res.copies += 1
            define(q.r, v)
            out.append(Quad("=", a, None, q.r))
            continue

        if op in ARITH:
            a, b = canon(q.a), canon(q.b)
            # --- constant folding -----------------------------------------
            ia, ib = as_int(a), as_int(b)
            if ia is not None and ib is not None and not (op in ("/", "%") and ib == 0):
                val = {"+": ia + ib, "-": ia - ib, "*": ia * ib,
                       "/": int(ia / ib) if ib else 0,
                       "%": ia - ib * int(ia / ib) if ib else 0}[op]
                res.folded += 1
                v = vn_of(str(val))
                define(q.r, v)
                out.append(Quad("=", str(val), None, q.r))
                continue
            if op == "+" and is_const(a) and is_const(b) and a.startswith('"'):
                v = vn_of('"' + a[1:-1] + b[1:-1] + '"')
                res.folded += 1
                define(q.r, v)
                out.append(Quad("=", vn_const[v], None, q.r))
                continue
            # --- algebraic identities -------------------------------------
            simplified = None
            if op == "+" and ib == 0:
                simplified = a
            elif op == "+" and ia == 0:
                simplified = b
            elif op == "-" and ib == 0:
                simplified = a
            elif op == "-" and a == b and not is_const(a):
                simplified = "0"
            elif op == "*" and (ia == 1):
                simplified = b
            elif op == "*" and (ib == 1):
                simplified = a
            elif op == "*" and (ia == 0 or ib == 0):
                simplified = "0"
            elif op == "/" and ib == 1:
                simplified = a
            if simplified is not None:
                res.identities += 1
                v = vn_of(simplified)
                define(q.r, v)
                out.append(Quad("=", simplified, None, q.r))
                continue
            # --- common sub-expression elimination ------------------------
            va, vb = vn_of(a), vn_of(b)
            key = (op, min(va, vb), max(va, vb)) if op in COMMUTATIVE else (op, va, vb)
            if key in expr_table:
                v = expr_table[key]
                src = vn_const.get(v) or vn_name.get(v)
                if src is not None:
                    res.cse_hits += 1
                    define(q.r, v)
                    out.append(Quad("=", src, None, q.r))
                    continue
            v = new_vn(op, [va, vb])
            expr_table[key] = v
            define(q.r, v)
            out.append(Quad(op, a, b, q.r))
            continue

        if op == "uminus":
            a = canon(q.a)
            ia = as_int(a)
            if ia is not None:
                res.folded += 1
                v = vn_of(str(-ia))
                define(q.r, v)
                out.append(Quad("=", str(-ia), None, q.r))
                continue
            va = vn_of(a)
            key = ("uminus", va, va)
            if key in expr_table and (vn_name.get(expr_table[key]) or
                                      vn_const.get(expr_table[key])):
                v = expr_table[key]
                res.cse_hits += 1
                define(q.r, v)
                out.append(Quad("=", vn_name.get(v) or vn_const[v], None, q.r))
                continue
            v = new_vn("uminus", [va])
            expr_table[key] = v
            define(q.r, v)
            out.append(Quad("uminus", a, None, q.r))
            continue

        # ---- everything else: rewrite operands, keep the instruction -------
        nq = q.copy()
        nq.a = canon(q.a) if op != "call" else q.a
        if op in CONDS:
            nq.b = canon(q.b)
        elif op == "jtab":
            nq.a = canon(q.a)
        if op == "call" and q.r:
            kill(q.r)
            v = new_vn("call", [], f"call {q.a}")
            value_num[q.r] = v
            vn_name[v] = q.r
            nodes[v].labels.append(q.r)
        out.append(nq)

    res.quads = out
    res.nodes = nodes
    return res
