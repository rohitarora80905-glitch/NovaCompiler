"""
nova.regvm - executes the *register* target code produced by nova/codegen.py.

The point of this module is that Module 6 is not just a listing on a slide: the
code that came out of next-use analysis and register allocation really runs, and
its output can be diffed against the stack back-end's output.  If register
allocation had a bug, the two outputs would disagree.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .codegen import Instr


@dataclass
class RFrame:
    func: str
    pc: int = 0
    regs: List[object] = field(default_factory=lambda: [0] * 8)
    slots: List[object] = field(default_factory=list)
    return_pc: int = -1
    result_reg: int = 0


@dataclass
class RProgram:
    code: Dict[str, List[Instr]] = field(default_factory=dict)
    nslots: Dict[str, int] = field(default_factory=dict)
    nparams: Dict[str, int] = field(default_factory=dict)


@dataclass
class RRunResult:
    output: List[str] = field(default_factory=list)
    steps: int = 0
    error: str = ""


def _imm(tok: str):
    body = tok[1:]
    if body.startswith('"'):
        return body[1:-1]
    return int(body)


def _reg(tok: str) -> int:
    return int(tok[1:])


def _slot(tok: str) -> int:
    return int(tok.split("+")[1].rstrip("]"))


def run(prog: RProgram, entry: str = "main", max_steps: int = 2_000_000,
        max_frames: int = 256) -> RRunResult:
    res = RRunResult()
    if entry not in prog.code:
        res.error = f"no entry function '{entry}'"
        return res
    frames = [RFrame(entry, 0, [0] * 8, [0] * prog.nslots[entry], -1, 0)]
    pending: List[object] = []
    steps = 0
    try:
        while frames:
            if steps >= max_steps:
                res.error = "instruction budget exhausted (non-terminating program)"
                break
            fr = frames[-1]
            code = prog.code[fr.func]
            if not (0 <= fr.pc < len(code)):
                # falling off the end behaves like RET
                value = fr.regs[0]
                frames.pop()
                if frames:
                    frames[-1].regs[0] = value
                continue
            ins = code[fr.pc]
            fr.pc += 1
            steps += 1
            op, a = ins.op, ins.args
            if op == "LD":
                fr.regs[_reg(a[0])] = fr.slots[_slot(a[1])]
            elif op == "ST":
                fr.slots[_slot(a[0])] = fr.regs[_reg(a[1])]
            elif op == "LDI":
                fr.regs[_reg(a[0])] = _imm(a[1])
            elif op == "MOV":
                fr.regs[_reg(a[0])] = fr.regs[_reg(a[1])]
            elif op in ("ADD", "SUB", "MUL", "DIV", "MOD"):
                x, y = fr.regs[_reg(a[1])], fr.regs[_reg(a[2])]
                if op == "ADD":
                    v = x + y
                elif op == "SUB":
                    v = x - y
                elif op == "MUL":
                    v = x * y
                elif op == "DIV":
                    if y == 0:
                        raise ZeroDivisionError("division by zero")
                    v = int(x / y)
                else:
                    if y == 0:
                        raise ZeroDivisionError("modulo by zero")
                    v = x - y * int(x / y)
                fr.regs[_reg(a[0])] = v
            elif op == "NEG":
                fr.regs[_reg(a[0])] = -fr.regs[_reg(a[1])]
            elif op in ("JLT", "JGT", "JLE", "JGE", "JEQ", "JNE"):
                x, y = fr.regs[_reg(a[0])], fr.regs[_reg(a[1])]
                take = {"JLT": x < y, "JGT": x > y, "JLE": x <= y,
                        "JGE": x >= y, "JEQ": x == y, "JNE": x != y}[op]
                if take:
                    fr.pc = int(a[2])
            elif op == "JMP":
                fr.pc = int(a[0])
            elif op == "PARAM":
                pending.append(fr.regs[_reg(a[0])])
            elif op == "CALL":
                name, nargs = a[0], int(a[1])
                if len(frames) >= max_frames:
                    res.error = f"call depth limit reached in '{name}'"
                    break
                args = pending[-nargs:] if nargs else []
                del pending[len(pending) - nargs:]
                nf = RFrame(name, 0, [0] * 8, [0] * prog.nslots[name], fr.pc, 0)
                for i, v in enumerate(args):
                    nf.slots[i] = v
                frames.append(nf)
            elif op == "PRINT":
                v = fr.regs[_reg(a[0])]
                res.output.append(str(v))
            elif op == "RET":
                value = fr.regs[_reg(a[0])] if a else 0
                frames.pop()
                if frames:
                    frames[-1].regs[0] = value
                else:
                    break
            else:
                res.error = f"unknown target instruction {op}"
                break
    except ZeroDivisionError as e:
        res.error = f"runtime error: {e}"
    except (IndexError, TypeError, ValueError) as e:
        res.error = f"runtime fault: {e}"
    res.steps = steps
    return res
