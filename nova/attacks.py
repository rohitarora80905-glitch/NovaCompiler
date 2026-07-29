"""
nova.attacks - hand-written *malicious* bytecode, so the verifier has something
to catch.

A verifier nobody ever defeats is indistinguishable from a verifier that does
nothing.  Each function below builds bytecode that no honest compiler would ever
emit - the kind of thing an attacker hands a virtual machine directly - and the
demo shows the verifier refusing it, naming the property that was violated.

The last two are *verifiable* but hostile: they pass every static check and are
then stopped by the sandbox at run time, which is exactly the division of labour
between static verification and dynamic limits in real systems.
"""
from __future__ import annotations

from typing import Callable, List, Tuple

from .bytecode import BFunction, BProgram, Ins
from .verifier import verify_program
from .vm import VM


def _prog(code: List[Ins], nslots: int = 2, nparams: int = 0,
          strings: List[str] = None) -> BProgram:
    p = BProgram()
    p.strings = list(strings or [])
    p.functions["main"] = BFunction("main", nparams, nslots, code, False)
    return p


def jump_out_of_range() -> Tuple[str, str, BProgram]:
    return ("Branch outside the code",
            "A jump whose target is past the end of the instruction array. On a "
            "real machine this is how you make execution continue into data you "
            "control.",
            _prog([Ins("ICONST", 1), Ins("STORE", 0), Ins("GOTO", 9999),
                   Ins("ICONST", 0), Ins("RETURN")]))


def stack_underflow() -> Tuple[str, str, BProgram]:
    return ("Operand-stack underflow",
            "ADD is executed with nothing on the stack. An unchecked stack machine "
            "would read whatever memory sits below the stack.",
            _prog([Ins("ADD"), Ins("ICONST", 0), Ins("RETURN")]))


def inconsistent_merge() -> Tuple[str, str, BProgram]:
    return ("Inconsistent stack depth at a merge point",
            "Two paths reach the same instruction with different stack depths, so "
            "the machine cannot know what is on the stack there. This is the "
            "property that makes bytecode verification possible at all.",
            _prog([Ins("ICONST", 1), Ins("ICONST", 1), Ins("IF_EQ", 5),
                   Ins("ICONST", 7),                       # one path pushes
                   Ins("GOTO", 5),
                   Ins("PRINT"),                           # merge point
                   Ins("ICONST", 0), Ins("RETURN")]))


def type_confusion() -> Tuple[str, str, BProgram]:
    return ("Type confusion",
            "A string is multiplied by an integer. If the machine simply trusted "
            "the opcode, the string's internal pointer would be used as a number - "
            "the classic route to arbitrary memory access.",
            _prog([Ins("SCONST", 0), Ins("ICONST", 4), Ins("MUL"),
                   Ins("STORE", 0), Ins("ICONST", 0), Ins("RETURN")],
                  strings=["harmless looking text"]))


def uninitialised_local() -> Tuple[str, str, BProgram]:
    return ("Reading an uninitialised local",
            "Slot 1 is read before anything is ever written to it, which leaks "
            "whatever the previous call left in that stack slot.",
            _prog([Ins("LOAD", 1), Ins("PRINT"), Ins("ICONST", 0), Ins("RETURN")]))


def frame_escape() -> Tuple[str, str, BProgram]:
    return ("Escaping the activation record",
            "LOAD addresses slot 40 in a frame that only has 2 slots, reaching "
            "into the caller's frame or past the end of the stack entirely.",
            _prog([Ins("LOAD", 40), Ins("PRINT"), Ins("ICONST", 0), Ins("RETURN")]))


def infinite_loop() -> Tuple[str, str, BProgram]:
    return ("Denial of service: a loop that never ends",
            "This bytecode is perfectly type-safe and passes every static check. "
            "Nothing static can prove it terminates, so the *sandbox* has to stop "
            "it with an instruction budget.",
            _prog([Ins("GOTO", 0), Ins("ICONST", 0), Ins("RETURN")]))


def runaway_recursion() -> Tuple[str, str, BProgram]:
    p = BProgram()
    p.functions["main"] = BFunction("main", 0, 1, [
        Ins("CALL", ("boom", 0)), Ins("POP"), Ins("ICONST", 0), Ins("RETURN")], False)
    p.functions["boom"] = BFunction("boom", 0, 1, [
        Ins("CALL", ("boom", 0)), Ins("RETURN")], True)
    return ("Denial of service: unbounded recursion",
            "Also statically valid. The sandbox caps the number of activation "
            "records, so the machine reports a policy violation instead of "
            "exhausting memory.",
            p)


ATTACKS: List[Callable[[], Tuple[str, str, BProgram]]] = [
    jump_out_of_range, stack_underflow, inconsistent_merge, type_confusion,
    uninitialised_local, frame_escape, infinite_loop, runaway_recursion,
]


def run_demo() -> List[dict]:
    """Verify (and where appropriate run) every attack; report what stopped it."""
    out = []
    for maker in ATTACKS:
        name, why, prog = maker()
        ok, reports = verify_program(prog)
        errors = [e for r in reports for e in r.errors]
        if not ok:
            stopped_by = "static verifier"
            detail = "\n      ".join(errors[:3])
        else:
            res = VM(prog, max_steps=200_000, max_frames=64, trace_limit=0).run()
            if res.error:
                stopped_by, detail = "run-time sandbox", res.error
            else:
                stopped_by, detail = "NOTHING - it ran", "output: " + ", ".join(res.output)
        out.append({"attack": name, "why": why,
                    "stopped_by": stopped_by, "detail": detail,
                    "blocked": stopped_by != "NOTHING - it ran"})
    return out


def text_report() -> str:
    lines = ["Hostile bytecode, handed straight to the virtual machine",
             "=" * 72, ""]
    rows = run_demo()
    for i, r in enumerate(rows, 1):
        mark = "BLOCKED" if r["blocked"] else "GOT THROUGH"
        lines.append(f"{i}. {r['attack']}")
        lines.append(f"   {r['why']}")
        lines.append(f"   -> {mark} by the {r['stopped_by']}")
        lines.append(f"      {r['detail']}")
        lines.append("")
    blocked = sum(1 for r in rows if r["blocked"])
    lines.append(f"{blocked} of {len(rows)} attacks stopped before they could do "
                 f"anything.")
    return "\n".join(lines)
