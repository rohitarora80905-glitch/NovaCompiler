"""
report/tools/tables.py - print the LaTeX table rows of the IEEE report from
report/data/measurements.json, so no number in the paper is typed by hand.

    python report/tools/tables.py
"""
from __future__ import annotations

import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(ROOT, "report", "data", "measurements.json")

SHORT = {"01_hello.nova": "hello", "02_fibonacci.nova": "fibonacci", "03_gcd.nova": "gcd",
         "04_primes.nova": "primes", "05_optimiser.nova": "optimiser",
         "06_parallel.nova": "parallel", "07_types_and_scopes.nova": "types",
         "08_broken.nova": "broken", "09_nested_loops.nova": "nested",
         "10_strings.nova": "strings", "11_deep_recursion.nova": "recursion"}


def tt(s: str) -> str:
    return "\\texttt{" + s + "}"


def pct(a: int, b: int) -> str:
    return "--" if not a else f"{100 * (a - b) / a:.0f}"


def main() -> None:
    d = json.load(open(DATA, encoding="utf-8"))
    progs = d["programs"]

    print("% ---- benchmark suite")
    for p in progs:
        print(f"{tt(SHORT[p['file']])} & {p['code_lines']} & {p['tokens']} & {p['functions']} \\\\")

    print("\n% ---- per-program results")
    for p in progs:
        r = p.get("run")
        if not r:
            print(f"{tt(SHORT[p['file']])} & {p['tokens']} & {p['lr_steps']} & {p['symbols']} & "
                  "\\multicolumn{11}{c}{\\textit{stopped after semantic analysis: "
                  f"{sum(1 for e in p['diagnostics'] if not e['warning'])} errors, "
                  f"{sum(1 for e in p['diagnostics'] if e['warning'])} warnings}}}} \\\\")
            continue
        print(f"{tt(SHORT[p['file']])} & {p['tokens']} & {p['lr_steps']} & {p['symbols']} & "
              f"{p['tac']} & {p['backpatches']} & {p['blocks']} & {p['ir_before']}$\\to${p['ir_after']} & "
              f"{p['loops']} & {p['phis']} & {p['target']} & {p['spills']} & "
              f"{p['bytecode_raw']}$\\to${p['bytecode_opt']} & "
              f"{p['verify_pass']}/{p['verify_checks']} & {p['compile_ms']:.2f} \\\\")

    print("\n% ---- execution and agreement")
    for p in progs:
        r = p.get("run")
        if not r:
            continue
        o = p["optimiser_off"]
        print(f"{tt(SHORT[p['file']])} & {r['steps_raw']:,} & {r['steps_opt']:,} & {pct(r['steps_raw'], r['steps_opt'])} & "
              f"{r['steps_reg']:,} & {r['max_frames']} & {r['max_stack']} & "
              f"{'\\cmark' if r['agree'] and o['same_output'] else '\\xmark'} \\\\")

    print("\n% ---- optimiser on/off")
    for p in progs:
        r = p.get("run")
        if not r:
            continue
        o = p["optimiser_off"]
        print(f"{tt(SHORT[p['file']])} & {o['ir']} & {p['ir_after']} & {pct(o['ir'], p['ir_after'])} & "
              f"{o['bytecode']} & {p['bytecode_opt']} & {pct(o['bytecode'], p['bytecode_opt'])} & "
              f"{o['steps']:,} & {r['steps_opt']:,} & {pct(o['steps'], r['steps_opt'])} \\\\")

    print("\n% ---- passes, optimiser.nova / main")
    for x in progs[4]["passes"]["main"]:
        delta = x["after"] - x["before"]
        print(f"{x['name']} & {x['before']} & {x['after']} & {delta:+d} & {x['detail']} \\\\")

    print("\n% ---- data-flow rounds")
    names = ["Reaching definitions", "Live variables", "Available expressions",
             "Very busy expressions"]
    for p in progs:
        for fn, rounds in p["dataflow"].items():
            print(f"{tt(SHORT[p['file']])}/{tt(fn)} & " + " & ".join(str(rounds[n]) for n in names) + " \\\\")

    print("\n% ---- attacks")
    for i, a in enumerate(d["attacks"], 1):
        print(f"{i} & {a['attack']} & {a['stopped_by']} \\\\")

    print("\n% ---- timing chart coordinates (ms)")
    groups = [("front", ["1. Lexical analysis", "2. Syntax analysis", "3. Semantic analysis"]),
              ("ir", ["4. Intermediate code"]),
              ("mid", ["5-7. Optimise, data flow, code generation"]),
              ("verify", ["8. Bytecode verification"]),
              ("exec", ["Execution"])]
    for label, keys in groups:
        coords = " ".join(f"({sum(p['phase_ms'].get(k, 0) for k in keys):.3f},{SHORT[p['file']].replace(chr(92), '')})"
                          for p in progs)
        print(f"{label}: {coords}")

    print("\n% ---- http")
    h = d["http"]
    for name, v in h["compile_roundtrip_ms"].items():
        print(f"{SHORT[name]}: {v['ms']} ms, {v['bytes']} B")
    print("health", h["health_ms"], "assets", h["assets"])


if __name__ == "__main__":
    main()
