"""
nova.codegen - Module 6: the target code generator.

This is the textbook *simple code generator*:

  * next-use information is computed for every instruction of every basic block
    by a backward scan (Algorithm 8.7 territory);
  * getreg() picks a register using the register descriptor (what is in each
    register) and the address descriptor (where each value currently lives),
    spilling the value whose next use is furthest away when it must;
  * values that are live at the end of a block are stored back to their slot in
    the activation record, so blocks can be generated independently.

Both descriptors are recorded at every step, so the viewer can show the
allocation decision instruction by instruction rather than just its result.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple

from .cfg import CFG, CONDS, Block
from .dag import as_int, is_const
from .dataflow import defs_of, live_variables, uses_of
from .tac import ARITH, Quad

N_REGISTERS = 4
INF = 10 ** 9

OPNAME = {"+": "ADD", "-": "SUB", "*": "MUL", "/": "DIV", "%": "MOD"}
CONDNAME = {"iflt": "JLT", "ifgt": "JGT", "ifle": "JLE",
            "ifge": "JGE", "ifeq": "JEQ", "ifne": "JNE"}


@dataclass
class Instr:
    op: str
    args: List[str] = field(default_factory=list)
    comment: str = ""

    def text(self) -> str:
        s = f"{self.op:<6} {', '.join(self.args)}"
        return f"{s:<28}" + (f"; {self.comment}" if self.comment else "")


@dataclass
class Frame:
    """The activation record layout for one function."""
    name: str
    params: List[str]
    slots: Dict[str, int]
    n_slots: int

    def rows(self) -> List[List[str]]:
        rows = [["-2", "return address", "set by CALL"],
                ["-1", "control link (caller's FP)", "set by CALL"]]
        inv = {v: k for k, v in self.slots.items()}
        for i in range(self.n_slots):
            nm = inv.get(i, "-")
            kind = "parameter" if nm in self.params else \
                   ("temporary" if nm.startswith("t") and nm[1:].isdigit() else "local")
            rows.append([str(i), nm, kind])
        return rows


@dataclass
class NextUseRow:
    block: int
    index: int
    instr: str
    nextuse: str
    live: str


class CodeGenerator:
    def __init__(self, cfg: CFG, name: str, params: List[str], n_registers: int = N_REGISTERS):
        self.cfg = cfg
        self.name = name
        self.params = params
        self.nreg = n_registers
        self.code: List[Instr] = []
        self.block_start: Dict[int, int] = {}
        self.nextuse_rows: List[NextUseRow] = []
        self.decisions: List[List[str]] = []
        self.spills = 0
        self.frame = self._build_frame()
        self.liveout = live_variables(cfg).OUT

    # ----------------------------------------------------------- frame layout
    def _build_frame(self) -> Frame:
        slots: Dict[str, int] = {}
        for p in self.params:
            slots.setdefault(p, len(slots))
        for b in self.cfg.blocks:
            for q in b.quads:
                for v in sorted(defs_of(q) | uses_of(q)):
                    if not is_const(v):
                        slots.setdefault(v, len(slots))
        return Frame(self.name, list(self.params), slots, len(slots))

    def slot(self, name: str) -> int:
        return self.frame.slots.setdefault(name, len(self.frame.slots))

    # -------------------------------------------------------------- next use
    def compute_next_use(self, b: Block) -> List[Dict[str, int]]:
        """next_use[i][v] = index of the next instruction in this block that
        uses v, or INF if v is live-out, or -1 if v is dead after i."""
        live_out = self.liveout[b.id]
        table: List[Dict[str, int]] = [dict() for _ in b.quads]
        state: Dict[str, int] = {v: INF for v in live_out}
        for i in range(len(b.quads) - 1, -1, -1):
            q = b.quads[i]
            table[i] = dict(state)
            for v in defs_of(q):
                state[v] = -1
            for v in uses_of(q):
                state[v] = i
        for i, q in enumerate(b.quads):
            names = sorted(set(list(defs_of(q)) + list(uses_of(q))))
            desc = ", ".join(
                f"{v}:{'live-out' if table[i].get(v, -1) == INF else (table[i].get(v, -1) if table[i].get(v, -1) >= 0 else 'dead')}"
                for v in names) or "-"
            from .cfg import fmt_block
            self.nextuse_rows.append(NextUseRow(
                b.id, i, fmt_block(q), desc,
                ", ".join(sorted(v for v, u in table[i].items() if u != -1)) or "-"))
        return table

    # --------------------------------------------------------- register file
    def emit(self, op, args, comment=""):
        self.code.append(Instr(op, [str(a) for a in args], comment))

    def generate(self) -> List[Instr]:
        for b in self.cfg.blocks:
            self.block_start[b.id] = len(self.code)
            self.gen_block(b)
        # patch symbolic jump targets to instruction indices
        for ins in self.code:
            if ins.args and ins.args[-1].startswith("@B"):
                bid = int(ins.args[-1][2:])
                ins.args[-1] = str(self.block_start.get(bid, len(self.code)))
        return self.code

    def gen_block(self, b: Block) -> None:
        nu = self.compute_next_use(b)
        reg_desc: Dict[int, Optional[str]] = {r: None for r in range(self.nreg)}
        addr_desc: Dict[str, Set[str]] = {}

        def where(v: str) -> Set[str]:
            return addr_desc.setdefault(v, {"mem"})

        def in_reg(v: str) -> Optional[int]:
            for r, held in reg_desc.items():
                if held == v:
                    return r
            return None

        def spill(r: int) -> None:
            v = reg_desc[r]
            if v is not None and "mem" not in where(v):
                self.emit("ST", [f"[fp+{self.slot(v)}]", f"R{r}"], f"spill {v}")
                where(v).add("mem")
                self.spills += 1
            if v is not None:
                where(v).discard(f"R{r}")
            reg_desc[r] = None

        def getreg(i: int, avoid: Set[int]) -> int:
            for r in range(self.nreg):                      # an empty register
                if reg_desc[r] is None:
                    return r
            for r in range(self.nreg):                      # one holding a dead value
                v = reg_desc[r]
                if r in avoid:
                    continue
                if v is not None and nu[i].get(v, -1) == -1:
                    return r
            best, bestuse = None, -1                        # furthest next use
            for r in range(self.nreg):
                if r in avoid:
                    continue
                v = reg_desc[r]
                u = nu[i].get(v, INF) if v else INF
                u = INF if u == INF else u
                if u > bestuse:
                    best, bestuse = r, u
            best = best if best is not None else 0
            spill(best)
            return best

        def load(v: str, i: int, avoid: Set[int]) -> int:
            r = in_reg(v)
            if r is not None:
                return r
            r = getreg(i, avoid)
            if is_const(v):
                self.emit("LDI", [f"R{r}", f"#{v}"], f"literal {v}")
                reg_desc[r] = None
                addr_desc.setdefault(f"#{v}", set())
                reg_desc[r] = v
                where(v).add(f"R{r}")
            else:
                self.emit("LD", [f"R{r}", f"[fp+{self.slot(v)}]"], f"load {v}")
                reg_desc[r] = v
                where(v).add(f"R{r}")
            return r

        def redefine(name: str, rd: int) -> None:
            """`name` now lives only in register rd.  Any other register that
            still claims to hold `name` is holding a stale copy and must be
            forgotten, or a later spill would write the old value to memory."""
            for r in range(self.nreg):
                if r != rd and reg_desc[r] == name:
                    reg_desc[r] = None
            for locs in addr_desc.values():
                locs.discard(f"R{rd}")
            reg_desc[rd] = name
            addr_desc[name] = {f"R{rd}"}

        def snapshot(i: int, note: str) -> None:
            rd = ", ".join(f"R{r}={reg_desc[r] or '-'}" for r in range(self.nreg))
            ad = ", ".join(f"{v}:{'/'.join(sorted(locs))}"
                           for v, locs in sorted(addr_desc.items()) if locs)
            self.decisions.append([f"B{b.id}.{i}", note, rd, ad or "-"])

        for i, q in enumerate(b.quads):
            if q.op in ARITH:
                r1 = load(q.a, i, set())
                r2 = load(q.b, i, {r1})
                # the destination may reuse r1 if a is dead after this instruction
                if nu[i].get(q.a, -1) == -1 and reg_desc[r1] == q.a:
                    rd = r1
                    where(q.a).discard(f"R{r1}")
                else:
                    rd = getreg(i, {r1, r2})
                self.emit(OPNAME[q.op], [f"R{rd}", f"R{r1}", f"R{r2}"],
                          f"{q.r} = {q.a} {q.op} {q.b}")
                redefine(q.r, rd)
                snapshot(i, f"{q.r} := {q.a} {q.op} {q.b}")

            elif q.op == "uminus":
                r1 = load(q.a, i, set())
                rd = getreg(i, {r1})
                self.emit("NEG", [f"R{rd}", f"R{r1}"], f"{q.r} = -{q.a}")
                redefine(q.r, rd)
                snapshot(i, f"{q.r} := -{q.a}")

            elif q.op == "=":
                if is_const(q.a):
                    rd = getreg(i, set())
                    self.emit("LDI", [f"R{rd}", f"#{q.a}"], f"{q.r} = {q.a}")
                else:
                    r1 = load(q.a, i, set())
                    rd = getreg(i, {r1}) if reg_desc[r1] != q.a or \
                        nu[i].get(q.a, -1) != -1 else r1
                    if rd != r1:
                        self.emit("MOV", [f"R{rd}", f"R{r1}"], f"{q.r} = {q.a}")
                redefine(q.r, rd)
                snapshot(i, f"{q.r} := {q.a}")

            elif q.op in CONDS:
                self.store_live(reg_desc, addr_desc, b, spill_all=True)
                r1 = load(q.a, i, set())
                r2 = load(q.b, i, {r1})
                self.emit(CONDNAME[q.op], [f"R{r1}", f"R{r2}", f"@B{q.r}"],
                          "conditional jump")
                snapshot(i, "conditional jump")

            elif q.op == "goto":
                self.store_live(reg_desc, addr_desc, b, spill_all=True)
                self.emit("JMP", [f"@B{q.r}"])

            elif q.op == "jtab":
                self.store_live(reg_desc, addr_desc, b, spill_all=True)
                r1 = load(q.a, i, set())
                for val, tgt in q.b:
                    rt = getreg(i, {r1})
                    self.emit("LDI", [f"R{rt}", f"#{val}"])
                    self.emit("JEQ", [f"R{r1}", f"R{rt}", f"@B{tgt}"],
                              f"case {val}")
                    reg_desc[rt] = None
                self.emit("JMP", [f"@B{q.r}"], "default")

            elif q.op == "param":
                r1 = load(q.a, i, set())
                self.emit("PARAM", [f"R{r1}"], f"argument {q.a}")

            elif q.op == "call":
                self.store_live(reg_desc, addr_desc, b, spill_all=True)
                reg_desc = {r: None for r in range(self.nreg)}
                self.emit("CALL", [q.a, q.b], "push a new activation record")
                if q.r:
                    self.emit("ST", [f"[fp+{self.slot(q.r)}]", "R0"],
                              f"{q.r} = returned value")
                    for r in range(self.nreg):
                        if reg_desc[r] == q.r:
                            reg_desc[r] = None
                    addr_desc[q.r] = {"mem"}
                snapshot(i, f"call {q.a}")

            elif q.op == "print":
                r1 = load(q.a, i, set())
                self.emit("PRINT", [f"R{r1}"])

            elif q.op == "ret":
                if q.a is not None:
                    r1 = load(q.a, i, set())
                    self.emit("RET", [f"R{r1}"], "value in R0 by convention")
                else:
                    self.emit("RET", [])

        if not (b.quads and b.quads[-1].op in ("goto", "ret") or
                (b.quads and b.quads[-1].op == "jtab")):
            self.store_live(reg_desc, addr_desc, b, spill_all=True)

    def store_live(self, reg_desc, addr_desc, b: Block, spill_all: bool = False) -> None:
        """Everything live past the end of this block must be back in memory."""
        live_out = self.liveout[b.id]
        for r in range(self.nreg):
            v = reg_desc.get(r)
            if v is None or is_const(v):
                continue
            if (spill_all or v in live_out) and "mem" not in addr_desc.get(v, set()):
                self.emit("ST", [f"[fp+{self.slot(v)}]", f"R{r}"], f"save {v}")
                addr_desc.setdefault(v, set()).add("mem")

    # ------------------------------------------------------------- rendering
    def listing(self) -> List[str]:
        rev = {v: k for k, v in self.block_start.items()}
        out = []
        for i, ins in enumerate(self.code):
            lab = f"B{rev[i]}:" if i in rev else ""
            out.append(f"{i:>3}  {lab:<5} {ins.text()}")
        return out
