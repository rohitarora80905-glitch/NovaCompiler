"""
Command line for the Nova compiler.

    python -m nova run      program.nova     compile, verify and execute
    python -m nova report   program.nova     write a full HTML glass-box report
    python -m nova phases   program.nova     print every phase to the terminal
    python -m nova tokens   program.nova     just the token stream and the DFA
    python -m nova ir       program.nova     three-address code, before and after
    python -m nova asm      program.nova     target code, next use, registers
    python -m nova bytecode program.nova     bytecode plus the verifier's report
    python -m nova llvm     program.nova     textual LLVM IR
    python -m nova metrics  program.nova     the measurement table only
    python -m nova attack                    hostile bytecode vs the verifier
    python -m nova gui      [program.nova]   the desktop Glass-Box window
    python -m nova serve    [--port N]       Nova Studio, the web UI, in a browser
    python -m nova test                      run the self-test suite
"""
from __future__ import annotations

import os
import sys
from typing import List, Optional


def _read(path: str) -> str:
    if not os.path.exists(path):
        print(f"no such file: {path}")
        raise SystemExit(2)
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _bar(title: str) -> str:
    return f"\n{title}\n" + "=" * max(30, len(title))


def main(argv: Optional[List[str]] = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(__doc__)
        return 0
    cmd = argv[0]
    args = argv[1:]

    if cmd == "gui":
        from .gui import main as gui_main
        return gui_main(args[0] if args else None)

    if cmd == "serve":
        from .server import main as serve_main
        return serve_main(args)

    if cmd == "attack":
        from .attacks import text_report
        print(text_report())
        return 0

    if cmd == "test":
        from tests.test_all import run_all          # type: ignore
        return run_all()

    if not args:
        print(f"'{cmd}' needs a .nova file")
        return 2

    path = args[0]
    src = _read(path)
    from .pipeline import compile_source

    if cmd == "report":
        out = "nova-report.html"
        if "-o" in args:
            out = args[args.index("-o") + 1]
        else:
            out = os.path.splitext(path)[0] + "-report.html"
        res = compile_source(src, os.path.basename(path))
        from .report_html import build_report
        with open(out, "w", encoding="utf-8") as fh:
            fh.write(build_report(res))
        print(f"report written to {out}")
        if res.run_opt and res.run_opt.output:
            print("program output: " + " | ".join(res.run_opt.output))
        return 0 if res.ok else 1

    res = compile_source(src, os.path.basename(path),
                         deep_tables=cmd in ("phases", "metrics"))

    if len(res.errors):
        print(_bar("Diagnostics"))
        print(res.errors.report())
    if not res.ok:
        return 1

    if cmd == "run":
        if res.run_opt is None:
            print("nothing to run")
            return 1
        if res.run_opt.output:
            print("\n".join(res.run_opt.output))
        if res.run_opt.error:
            print(res.run_opt.error)
            return 1
        return 0

    if cmd == "tokens":
        print(_bar("DFA"))
        for k, v in res.lexer.dfa_stats().items():
            print(f"  {k:<26} {v}")
        print(_bar("Tokens"))
        for t in res.tokens:
            if t.type != "EOF":
                print(f"  {t.line:>3}:{t.col:<3} {t.type:<12} {t.lexeme!r:<20} "
                      f"{t.attribute}")
        return 0

    if cmd == "ir":
        for name, art in res.functions.items():
            print(_bar(f"{name}: three-address code"))
            print("\n".join(art.ir.listing()))
            print(_bar(f"{name}: optimisation"))
            for r in art.opt.records:
                print(f"  {r.name:<42} {r.before:>4} -> {r.after:<4} {r.detail}")
            print(_bar(f"{name}: optimised flow graph"))
            print(art.cfg_after.text())
        return 0

    if cmd == "asm":
        for name, art in res.functions.items():
            print(_bar(f"{name}: activation record"))
            for r in art.codegen.frame.rows():
                print(f"  {r[0]:>4}  {r[1]:<16} {r[2]}")
            print(_bar(f"{name}: target code"))
            print("\n".join(art.codegen.listing()))
        return 0

    if cmd == "bytecode":
        print(_bar("Bytecode"))
        print("\n".join(res.bprog_opt.listing()))
        print(_bar("Verifier"))
        for r in res.verify:
            print(f"  {r.function}: {'VERIFIED' if r.ok else 'REJECTED'}")
            for c in r.checks:
                print(f"     [{c[1]:<4}] {c[0]}  ({c[2]})")
            for e in r.errors:
                print(f"     !! {e}")
        return 0

    if cmd == "llvm":
        print(res.llvm)
        return 0

    if cmd == "metrics":
        print(_bar("Measurements"))
        for a, b, c in res.metrics:
            print(f"  {a:<10} {b:<58} {c}")
        return 0

    if cmd == "phases":
        print(_bar("0. Source"))
        print(src)
        print(_bar("1. Tokens"))
        print("  " + ", ".join(t.type for t in res.tokens if t.type != "EOF"))
        for k, v in res.lexer.dfa_stats().items():
            print(f"  {k:<26} {v}")
        print(_bar("2. Parsing"))
        for kind in ("SLR", "CLR", "LALR"):
            if kind in res.tables:
                t = res.tables[kind]
                print(f"  {t.kind:<8} states {t.n_states:>4}  entries {t.size():>5}"
                      f"  conflicts {len(t.conflicts)}")
        print(f"  bottom-up parse: {'accepted' if res.lr_ok else res.lr_msg} "
              f"in {len(res.lr_trace)} steps")
        print(_bar("3. Symbol table"))
        for r in res.sema.symbol_rows():
            print("  " + "  ".join(f"{x:<10}" for x in r))
        print(_bar("4. Three-address code"))
        for name, art in res.functions.items():
            print(f"  --- {name} ---")
            print("\n".join("  " + l for l in art.ir.listing()))
        print(_bar("5. Optimisation"))
        for name, art in res.functions.items():
            for r in art.opt.records:
                print(f"  {name:<6} {r.name:<42} {r.before:>4} -> {r.after:<4} "
                      f"{r.detail}")
        print(_bar("6. Target code"))
        for name, art in res.functions.items():
            print(f"  --- {name} ({art.codegen.spills} spill(s)) ---")
            print("\n".join("  " + l for l in art.codegen.listing()))
        print(_bar("7. SSA"))
        for name, art in res.functions.items():
            print(f"  --- {name} ---")
            for bl in art.ssa.blocks:
                print("\n".join("  " + l for l in bl))
            for l in art.loops:
                print(f"  loop B{l.header}: {l.verdict} - {l.reason}")
        print(_bar("8. Verification"))
        for r in res.verify:
            print(f"  {r.function}: {'VERIFIED' if r.ok else 'REJECTED'}")
        print(_bar("9. Output"))
        print("\n".join(res.run_opt.output) if res.run_opt else "")
        print(_bar("Measurements"))
        for a, b, c in res.metrics:
            print(f"  {a:<10} {b:<58} {c}")
        return 0

    print(f"unknown command '{cmd}'")
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
