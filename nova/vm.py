"""
nova.vm - the sandboxed stack virtual machine.

Two things are on display here.

Activation records (Module 6).  A call pushes a Frame holding the callee's
locals, the return address and the control link back to the caller's frame.  The
viewer draws that stack while a recursive program runs, which is the clearest
possible answer to "what is an activation record?".

Sandboxing (Module 8).  The machine refuses to run unverified code, and even
verified code is executed under hard limits on instruction count, call depth and
operand-stack depth, so an infinite loop or runaway recursion is reported as a
policy violation rather than hanging the tool.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .bytecode import BFunction, BProgram, Ins


class VMError(Exception):
    pass


class SandboxViolation(Exception):
    pass


@dataclass
class Frame:
    func: str
    pc: int = 0
    locals: List[object] = field(default_factory=list)
    stack: List[object] = field(default_factory=list)
    return_pc: int = -1
    control_link: int = -1        # index of the caller's frame
    store_result: bool = True

    def render(self, slot_names: Optional[List[str]] = None) -> str:
        items = []
        for i, v in enumerate(self.locals):
            nm = slot_names[i] if slot_names and i < len(slot_names) else f"s{i}"
            items.append(f"{nm}={_show(v)}")
        return (f"{self.func}  pc={self.pc}  link->{self.control_link}  "
                f"ret->{self.return_pc}  [{', '.join(items)}]")


def _show(v) -> str:
    if v is None:
        return "-"
    if isinstance(v, str):
        return f'"{v}"'
    return str(v)


@dataclass
class TraceRow:
    step: int
    func: str
    pc: int
    instr: str
    stack: str
    depth: int


@dataclass
class RunResult:
    output: List[str] = field(default_factory=list)
    steps: int = 0
    trace: List[TraceRow] = field(default_factory=list)
    max_frames: int = 0
    max_stack: int = 0
    error: str = ""
    frames_snapshots: List[List[str]] = field(default_factory=list)


class VM:
    def __init__(self, prog: BProgram, max_steps: int = 2_000_000,
                 max_frames: int = 256, max_stack: int = 1024,
                 trace_limit: int = 400, slot_names: Optional[Dict[str, List[str]]] = None):
        self.prog = prog
        self.max_steps = max_steps
        self.max_frames = max_frames
        self.max_stack = max_stack
        self.trace_limit = trace_limit
        self.slot_names = slot_names or {}

    def run(self, entry: str = "main") -> RunResult:
        res = RunResult()
        fn = self.prog.functions.get(entry)
        if fn is None:
            res.error = f"no entry function '{entry}'"
            return res
        frames: List[Frame] = [Frame(entry, 0, [None] * fn.nslots, [], -1, -1)]
        step = 0
        deepest_snapshot: List[str] = []
        try:
            while frames:
                if step >= self.max_steps:
                    raise SandboxViolation(
                        f"instruction budget of {self.max_steps} exhausted - "
                        f"the program does not terminate")
                fr = frames[-1]
                fn = self.prog.functions[fr.func]
                if not (0 <= fr.pc < len(fn.code)):
                    raise VMError(f"pc {fr.pc} outside '{fr.func}'")
                ins = fn.code[fr.pc]
                if len(res.trace) < self.trace_limit:
                    res.trace.append(TraceRow(
                        step, fr.func, fr.pc, ins.text().strip(),
                        "[" + ", ".join(_show(x) for x in fr.stack) + "]",
                        len(frames)))
                fr.pc += 1
                step += 1
                res.max_stack = max(res.max_stack, len(fr.stack))
                if len(frames) > res.max_frames:
                    res.max_frames = len(frames)
                    deepest_snapshot = [f.render(self.slot_names.get(f.func))
                                        for f in frames]

                op, arg = ins.op, ins.arg
                if op == "ICONST":
                    fr.stack.append(arg)
                elif op == "SCONST":
                    fr.stack.append(self.prog.strings[arg])
                elif op == "LOAD":
                    fr.stack.append(fr.locals[arg])
                elif op == "STORE":
                    fr.locals[arg] = fr.stack.pop()
                elif op == "DUP":
                    fr.stack.append(fr.stack[-1])
                elif op == "POP":
                    fr.stack.pop()
                elif op in ("ADD", "SUB", "MUL", "DIV", "MOD"):
                    b = fr.stack.pop()
                    a = fr.stack.pop()
                    if op == "ADD" and isinstance(a, str) and isinstance(b, str):
                        fr.stack.append(a + b)
                    elif op == "DIV":
                        if b == 0:
                            raise VMError("division by zero")
                        fr.stack.append(int(a / b))
                    elif op == "MOD":
                        if b == 0:
                            raise VMError("modulo by zero")
                        fr.stack.append(a - b * int(a / b))
                    else:
                        fr.stack.append({"ADD": lambda: a + b, "SUB": lambda: a - b,
                                         "MUL": lambda: a * b}[op]())
                elif op == "NEG":
                    fr.stack.append(-fr.stack.pop())
                elif op.startswith("IF_"):
                    b = fr.stack.pop()
                    a = fr.stack.pop()
                    take = {"IF_LT": a < b, "IF_GT": a > b, "IF_LE": a <= b,
                            "IF_GE": a >= b, "IF_EQ": a == b, "IF_NE": a != b}[op]
                    if take:
                        fr.pc = arg
                elif op == "GOTO":
                    fr.pc = arg
                elif op == "SWITCH":
                    v = fr.stack.pop()
                    target = None
                    default = None
                    for val, t in arg:
                        if val == -1:
                            default = t
                        elif val == v:
                            target = t
                            break
                    fr.pc = target if target is not None else (
                        default if default is not None else fr.pc)
                elif op == "PRINT":
                    res.output.append(_print_form(fr.stack.pop()))
                elif op == "CALL":
                    name, nargs = arg
                    callee = self.prog.functions[name]
                    if len(frames) >= self.max_frames:
                        raise SandboxViolation(
                            f"call depth limit of {self.max_frames} reached - "
                            f"runaway recursion in '{name}'")
                    args = [fr.stack.pop() for _ in range(nargs)][::-1]
                    newfr = Frame(name, 0, [None] * callee.nslots, [],
                                  fr.pc, len(frames) - 1)
                    for i, a in enumerate(args):
                        newfr.locals[i] = a
                    frames.append(newfr)
                elif op == "RETURN":
                    value = fr.stack.pop()
                    frames.pop()
                    if frames:
                        frames[-1].stack.append(value)
                    else:
                        res.steps = step
                        res.frames_snapshots = deepest_snapshot
                        return res
                elif op == "HALT":
                    break
                else:
                    raise VMError(f"unknown opcode {op}")
                if len(fr.stack) > self.max_stack:
                    raise SandboxViolation(
                        f"operand stack exceeded {self.max_stack} entries")
        except SandboxViolation as e:
            res.error = f"sandbox stopped the program: {e}"
        except VMError as e:
            res.error = f"runtime error: {e}"
        except (IndexError, TypeError) as e:
            res.error = f"runtime fault: {e}"
        res.steps = step
        res.frames_snapshots = deepest_snapshot
        return res


def _print_form(v) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    return str(v)
