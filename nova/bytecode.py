"""
nova.bytecode - the second back-end: a compact stack bytecode.

The syllabus line "implementation of a naive code generator for a virtual
machine, security checking of virtual machine code" is taken literally here.
This module is the naive code generator; nova/verifier.py is the security check;
nova/vm.py is the sandboxed interpreter.

The instruction set is deliberately JVM-shaped, because the verifier that
follows is a small version of the real JVM bytecode verifier.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

from .cfg import CFG, CONDS, Block
from .dag import is_const
from .dataflow import defs_of, uses_of
from .tac import ARITH, Quad

# stack effect: (popped, pushed) - the verifier uses this table
EFFECT: Dict[str, Tuple[int, int]] = {
    "ICONST": (0, 1), "SCONST": (0, 1), "LOAD": (0, 1), "STORE": (1, 0),
    "ADD": (2, 1), "SUB": (2, 1), "MUL": (2, 1), "DIV": (2, 1), "MOD": (2, 1),
    "NEG": (1, 1), "DUP": (1, 2), "POP": (1, 0),
    "IF_LT": (2, 0), "IF_GT": (2, 0), "IF_LE": (2, 0), "IF_GE": (2, 0),
    "IF_EQ": (2, 0), "IF_NE": (2, 0),
    "GOTO": (0, 0), "SWITCH": (1, 0), "PRINT": (1, 0),
    "CALL": (0, 0),          # handled specially: pops nargs, pushes 1
    "RETURN": (1, 0), "HALT": (0, 0),
}

CONDMAP = {"iflt": "IF_LT", "ifgt": "IF_GT", "ifle": "IF_LE",
           "ifge": "IF_GE", "ifeq": "IF_EQ", "ifne": "IF_NE"}
ARITHMAP = {"+": "ADD", "-": "SUB", "*": "MUL", "/": "DIV", "%": "MOD"}


@dataclass
class Ins:
    op: str
    arg: object = None
    comment: str = ""

    def text(self) -> str:
        a = "" if self.arg is None else (
            " " + (str(self.arg) if not isinstance(self.arg, list)
                   else "[" + " ".join(f"{v}->{t}" for v, t in self.arg) + "]"))
        s = f"{self.op}{a}"
        return f"{s:<26}" + (f"; {self.comment}" if self.comment else "")


@dataclass
class BFunction:
    name: str
    nparams: int
    nslots: int
    code: List[Ins] = field(default_factory=list)
    returns_value: bool = False
    max_stack: int = 0

    def listing(self) -> List[str]:
        return [f"{i:>3}  {ins.text()}" for i, ins in enumerate(self.code)]


@dataclass
class BProgram:
    functions: Dict[str, BFunction] = field(default_factory=dict)
    strings: List[str] = field(default_factory=list)
    entry: str = "main"

    def total_instructions(self) -> int:
        return sum(len(f.code) for f in self.functions.values())

    def listing(self) -> List[str]:
        out: List[str] = []
        if self.strings:
            out.append("string pool:")
            out += [f'  #{i}  "{s}"' for i, s in enumerate(self.strings)]
            out.append("")
        for name, f in self.functions.items():
            out.append(f".function {name}  params={f.nparams} slots={f.nslots} "
                       f"returns={'value' if f.returns_value else 'void'}")
            out += ["    " + l for l in f.listing()]
            out.append("")
        return out


class BytecodeGen:
    """One CFG in, one stack-bytecode function out."""

    def __init__(self, prog: BProgram):
        self.prog = prog

    def intern(self, s: str) -> int:
        if s not in self.prog.strings:
            self.prog.strings.append(s)
        return self.prog.strings.index(s)

    def gen_function(self, cfg: CFG, name: str, params: List[str],
                     returns_value: bool) -> BFunction:
        slots: Dict[str, int] = {}
        for p in params:
            slots.setdefault(p, len(slots))
        for b in cfg.blocks:
            for q in b.quads:
                for v in sorted(defs_of(q) | uses_of(q)):
                    if not is_const(v):
                        slots.setdefault(v, len(slots))

        code: List[Ins] = []
        block_start: Dict[int, int] = {}
        fixups: List[Tuple[int, int]] = []          # (instruction index, block id)
        switch_fixups: List[Tuple[int, List[Tuple[int, int]], int]] = []

        def push_operand(x: str) -> None:
            if is_const(x):
                if x.startswith('"'):
                    code.append(Ins("SCONST", self.intern(x[1:-1]), f'{x}'))
                else:
                    code.append(Ins("ICONST", int(x)))
            else:
                code.append(Ins("LOAD", slots[x], x))

        for b in cfg.blocks:
            block_start[b.id] = len(code)
            for q in b.quads:
                if q.op in ARITH:
                    push_operand(q.a)
                    push_operand(q.b)
                    code.append(Ins(ARITHMAP[q.op]))
                    code.append(Ins("STORE", slots[q.r], q.r))
                elif q.op == "uminus":
                    push_operand(q.a)
                    code.append(Ins("NEG"))
                    code.append(Ins("STORE", slots[q.r], q.r))
                elif q.op == "=":
                    push_operand(q.a)
                    code.append(Ins("STORE", slots[q.r], q.r))
                elif q.op in CONDS:
                    push_operand(q.a)
                    push_operand(q.b)
                    fixups.append((len(code), q.r))
                    code.append(Ins(CONDMAP[q.op], 0))
                elif q.op == "goto":
                    fixups.append((len(code), q.r))
                    code.append(Ins("GOTO", 0))
                elif q.op == "jtab":
                    push_operand(q.a)
                    switch_fixups.append((len(code), list(q.b), q.r))
                    code.append(Ins("SWITCH", []))
                elif q.op == "param":
                    push_operand(q.a)
                elif q.op == "call":
                    code.append(Ins("CALL", (q.a, int(q.b)), f"call {q.a}"))
                    if q.r:
                        code.append(Ins("STORE", slots[q.r], q.r))
                    else:
                        code.append(Ins("POP", None, "result discarded"))
                elif q.op == "print":
                    push_operand(q.a)
                    code.append(Ins("PRINT"))
                elif q.op == "ret":
                    if q.a is None:
                        code.append(Ins("ICONST", 0, "void functions return 0"))
                    else:
                        push_operand(q.a)
                    code.append(Ins("RETURN"))
        end = len(code)
        if not code or code[-1].op != "RETURN":
            code.append(Ins("ICONST", 0))
            code.append(Ins("RETURN"))

        for idx, bid in fixups:
            code[idx].arg = block_start.get(bid, end)
        for idx, table, default in switch_fixups:
            code[idx].arg = [(v, block_start.get(t, end)) for v, t in table]
            code[idx].comment = f"default {block_start.get(default, end)}"
            code[idx].arg = code[idx].arg + [(-1, block_start.get(default, end))]

        fn = BFunction(name, len(params), len(slots), code, returns_value)
        return fn


# ==========================================================================
def peephole(fn: BFunction) -> Tuple[BFunction, List[str]]:
    """A small peephole pass on the final bytecode."""
    notes: List[str] = []
    code = list(fn.code)
    changed = True
    while changed:
        changed = False
        # never merge across an instruction that something jumps to
        targets = set()
        for ins in code:
            if ins.op == "GOTO" or ins.op.startswith("IF_"):
                if isinstance(ins.arg, int):
                    targets.add(ins.arg)
            elif ins.op == "SWITCH" and isinstance(ins.arg, list):
                targets.update(t for _, t in ins.arg)
        out: List[Ins] = []
        i = 0
        remap: Dict[int, int] = {}
        while i < len(code):
            remap[i] = len(out)
            a = code[i]
            b = code[i + 1] if i + 1 < len(code) else None
            # STORE x ; LOAD x   ->   DUP ; STORE x
            if (b is not None and a.op == "STORE" and b.op == "LOAD"
                    and a.arg == b.arg and (i + 1) not in targets):
                out.append(Ins("DUP", None, "peephole: store+reload"))
                out.append(Ins("STORE", a.arg, a.comment))
                remap[i + 1] = len(out) - 1
                i += 2
                changed = True
                notes.append(f"replaced STORE {a.arg}; LOAD {a.arg} with DUP; STORE {a.arg}")
                continue
            # GOTO to the very next instruction
            if a.op == "GOTO" and isinstance(a.arg, int) and a.arg == i + 1:
                i += 1
                changed = True
                notes.append("removed a GOTO that jumped to the next instruction")
                continue
            # NEG ; NEG
            if (b is not None and a.op == "NEG" and b.op == "NEG"
                    and (i + 1) not in targets):
                remap[i + 1] = len(out)
                i += 2
                changed = True
                notes.append("removed a double NEG")
                continue
            out.append(a)
            i += 1
        remap[len(code)] = len(out)
        for idx in range(len(code), -1, -1):        # fill any gap
            if idx not in remap:
                remap[idx] = remap[idx + 1]
        for ins in out:
            if ins.op in ("GOTO",) or ins.op.startswith("IF_"):
                if isinstance(ins.arg, int):
                    ins.arg = remap.get(ins.arg, ins.arg)
            elif ins.op == "SWITCH" and isinstance(ins.arg, list):
                ins.arg = [(v, remap.get(t, t)) for v, t in ins.arg]
        code = out
    fn.code = code
    return fn, notes
