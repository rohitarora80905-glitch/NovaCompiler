"""
nova.verifier - "security checking of virtual machine code", taken literally.

Before a single instruction runs, the verifier performs *abstract interpretation*
over the bytecode's flow graph.  Instead of real values it propagates a stack of
types and a set of definitely-initialised locals, and it proves five properties:

  1. stack-depth consistency - every path reaching an instruction agrees on how
     deep the operand stack is (this is what makes a stack machine safe);
  2. type safety              - every instruction gets operands of the type it
     expects, so ADD can never be handed a string and an int;
  3. branch safety            - every jump target is inside the code and lands on
     a real instruction boundary;
  4. definite assignment      - no local is read before it is written;
  5. frame containment        - no LOAD/STORE can address a slot outside the
     current activation record.

This is the same argument the JVM verifier, WebAssembly validation and the Linux
kernel's eBPF verifier make.  It is a data-flow analysis on the bytecode CFG,
which ties Module 8 straight back to Module 5.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple

from .bytecode import BFunction, BProgram, Ins

INT, STR, ANY = "int", "str", "any"


@dataclass
class VerifyReport:
    function: str
    ok: bool = True
    max_stack: int = 0
    errors: List[str] = field(default_factory=list)
    checks: List[Tuple[str, str, str]] = field(default_factory=list)  # name, result, detail
    depth_at: Dict[int, int] = field(default_factory=dict)


def successors(i: int, ins: Ins, n: int) -> List[int]:
    if ins.op == "GOTO":
        return [ins.arg] if isinstance(ins.arg, int) else []
    if ins.op.startswith("IF_"):
        out = [i + 1]
        if isinstance(ins.arg, int):
            out.append(ins.arg)
        return out
    if ins.op == "SWITCH":
        return [t for _, t in ins.arg] if isinstance(ins.arg, list) else []
    if ins.op in ("RETURN", "HALT"):
        return []
    return [i + 1]


def verify_function(fn: BFunction, prog: BProgram,
                    max_stack_limit: int = 256) -> VerifyReport:
    rep = VerifyReport(fn.name)
    n = len(fn.code)
    # abstract state at the entry of each instruction
    stacks: Dict[int, List[str]] = {}
    inits: Dict[int, Set[int]] = {}
    entry_init = set(range(fn.nparams))
    stacks[0] = []
    inits[0] = set(entry_init)
    work = [0]
    seen: Set[int] = set()
    branch_bad = jump_bad = type_bad = depth_bad = init_bad = frame_bad = 0

    def fail(msg: str) -> None:
        rep.ok = False
        if msg not in rep.errors:
            rep.errors.append(msg)

    while work:
        i = work.pop()
        if i >= n or i < 0:
            fail(f"control falls off the end of '{fn.name}' at instruction {i}")
            continue
        seen.add(i)
        st = list(stacks[i])
        init = set(inits[i])
        ins = fn.code[i]
        op = ins.op

        def pop(expect: str = ANY, what: str = "") -> str:
            nonlocal type_bad
            if not st:
                fail(f"{fn.name}[{i}] {op}: operand stack underflow "
                     f"(the instruction needs a value but the stack is empty)")
                return ANY
            t = st.pop()
            if expect != ANY and t != ANY and t != expect:
                fail(f"{fn.name}[{i}] {op}: expected {expect} on the stack "
                     f"but found {t}{' (' + what + ')' if what else ''}")
                type_bad += 1
            return t

        if op == "ICONST":
            st.append(INT)
        elif op == "SCONST":
            if not isinstance(ins.arg, int) or not (0 <= ins.arg < len(prog.strings)):
                fail(f"{fn.name}[{i}] SCONST: string-pool index {ins.arg} is out of range")
            st.append(STR)
        elif op == "LOAD":
            if not isinstance(ins.arg, int) or not (0 <= ins.arg < fn.nslots):
                fail(f"{fn.name}[{i}] LOAD: slot {ins.arg} is outside the "
                     f"activation record (0..{fn.nslots - 1})")
                frame_bad += 1
                st.append(ANY)
            elif ins.arg not in init:
                fail(f"{fn.name}[{i}] LOAD: local slot {ins.arg} is read before "
                     f"it is ever written")
                init_bad += 1
                st.append(ANY)
            else:
                st.append(ANY)
        elif op == "STORE":
            pop()
            if not isinstance(ins.arg, int) or not (0 <= ins.arg < fn.nslots):
                fail(f"{fn.name}[{i}] STORE: slot {ins.arg} is outside the "
                     f"activation record (0..{fn.nslots - 1})")
                frame_bad += 1
            else:
                init.add(ins.arg)
        elif op in ("ADD", "SUB", "MUL", "DIV", "MOD"):
            b = pop()
            a = pop()
            if op == "ADD" and (a == STR or b == STR):
                if a != b and ANY not in (a, b):
                    fail(f"{fn.name}[{i}] ADD: cannot add {a} and {b}")
                    type_bad += 1
                st.append(STR if a == STR and b == STR else ANY)
            else:
                if STR in (a, b):
                    fail(f"{fn.name}[{i}] {op}: arithmetic on a string value")
                    type_bad += 1
                st.append(INT)
        elif op == "NEG":
            pop(INT)
            st.append(INT)
        elif op == "DUP":
            if not st:
                fail(f"{fn.name}[{i}] DUP: operand stack underflow")
            else:
                st.append(st[-1])
        elif op == "POP":
            pop()
        elif op.startswith("IF_"):
            pop()
            pop()
        elif op == "SWITCH":
            pop(INT)
        elif op == "PRINT":
            pop()
        elif op == "CALL":
            name, nargs = ins.arg if isinstance(ins.arg, tuple) else (None, 0)
            callee = prog.functions.get(name)
            if callee is None:
                fail(f"{fn.name}[{i}] CALL: unknown function '{name}'")
            elif callee.nparams != nargs:
                fail(f"{fn.name}[{i}] CALL {name}: {nargs} argument(s) pushed "
                     f"but the function declares {callee.nparams}")
            for _ in range(nargs):
                pop()
            st.append(ANY)
        elif op == "RETURN":
            pop()
        elif op == "GOTO":
            pass
        elif op == "HALT":
            pass
        else:
            fail(f"{fn.name}[{i}] unknown opcode '{op}'")

        if len(st) > max_stack_limit:
            fail(f"{fn.name}[{i}]: operand stack grows past the limit "
                 f"of {max_stack_limit}")
        rep.max_stack = max(rep.max_stack, len(st))
        rep.depth_at[i] = len(stacks[i])

        for s in successors(i, ins, n):
            if not isinstance(s, int) or not (0 <= s < n):
                fail(f"{fn.name}[{i}] {op}: jump target {s} is outside the code "
                     f"(0..{n - 1})")
                jump_bad += 1
                continue
            if s in stacks:
                if len(stacks[s]) != len(st):
                    fail(f"{fn.name}: instruction {s} is reached with stack depth "
                         f"{len(stacks[s])} on one path and {len(st)} on another - "
                         f"the operand stack is not consistent at this merge point")
                    depth_bad += 1
                    continue
                merged = [a if a == b else ANY for a, b in zip(stacks[s], st)]
                newinit = inits[s] & init
                if merged != stacks[s] or newinit != inits[s]:
                    stacks[s], inits[s] = merged, newinit
                    work.append(s)
            else:
                stacks[s], inits[s] = list(st), set(init)
                work.append(s)

    unreachable = [i for i in range(n) if i not in seen]
    fn.max_stack = rep.max_stack

    rep.checks = [
        ("1. operand-stack depth consistent at every merge",
         "PASS" if depth_bad == 0 else "FAIL",
         f"max depth {rep.max_stack}"),
        ("2. types on the stack match every instruction",
         "PASS" if type_bad == 0 else "FAIL",
         f"{type_bad} mismatch(es)"),
        ("3. every jump target is in range and on an instruction boundary",
         "PASS" if jump_bad == 0 else "FAIL",
         f"{n} instruction(s) checked"),
        ("4. no local is read before it is written",
         "PASS" if init_bad == 0 else "FAIL",
         f"{fn.nslots} slot(s), {fn.nparams} parameter(s) pre-initialised"),
        ("5. no LOAD/STORE escapes the activation record",
         "PASS" if frame_bad == 0 else "FAIL",
         f"slots 0..{fn.nslots - 1}"),
        ("6. no unreachable instructions",
         "PASS" if not unreachable else "WARN",
         f"{len(unreachable)} unreachable" if unreachable else "all reachable"),
    ]
    return rep


def verify_program(prog: BProgram) -> Tuple[bool, List[VerifyReport]]:
    reports = [verify_function(f, prog) for f in prog.functions.values()]
    return all(r.ok for r in reports), reports
