"""
report/tools/measure.py - regenerate every number quoted in the IEEE report.

    python report/tools/measure.py            writes report/data/measurements.json

Nothing in the paper is typed in by hand: each table is built from this file.
Timings are medians over repeated runs with warm caches; the one-time cost of
building the LR tables is measured separately because the pipeline caches them.
"""
from __future__ import annotations

import http.client
import json
import os
import platform
import statistics
import sys

import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)

from nova import pipeline                                   # noqa: E402
from nova.attacks import run_demo                           # noqa: E402
from nova.bytecode import EFFECT                            # noqa: E402
from nova.lexer import KEYWORDS, TOKEN_SPECS                # noqa: E402
from nova.lr import LRBuilder                               # noqa: E402
from nova.nova_grammar import AMBIGUOUS_NOVA_EXPR, NOVA_GRAMMAR   # noqa: E402
from nova.pipeline import compile_source                    # noqa: E402
from nova.report_json import build_json, grammar_view       # noqa: E402

EXAMPLES = os.path.join(ROOT, "examples")
OUT = os.path.join(ROOT, "report", "data", "measurements.json")
RUNS = 60                      # timing repetitions per program
HTTP_RUNS = 30


def power_state() -> str:
    """'mains' or 'battery' on Windows - a laptop on battery runs the CPU slower."""
    if os.name != "nt":
        return "unknown"
    try:
        import ctypes

        class _Status(ctypes.Structure):
            _fields_ = [("ACLineStatus", ctypes.c_byte), ("BatteryFlag", ctypes.c_byte),
                        ("BatteryLifePercent", ctypes.c_byte), ("Reserved1", ctypes.c_byte),
                        ("BatteryLifeTime", ctypes.c_ulong), ("BatteryFullLifeTime", ctypes.c_ulong)]
        st = _Status()
        ctypes.windll.kernel32.GetSystemPowerStatus(ctypes.byref(st))
        return {0: "battery", 1: "mains"}.get(st.ACLineStatus, "unknown")
    except Exception:                                   # pragma: no cover
        return "unknown"


def raise_priority() -> bool:
    """Best effort: run above normal priority so other desktop work interferes less."""
    if os.name != "nt":
        return False
    try:
        import ctypes
        k32 = ctypes.windll.kernel32
        return bool(k32.SetPriorityClass(k32.GetCurrentProcess(), 0x80))  # HIGH
    except Exception:                                   # pragma: no cover
        return False


def median_ms(samples):
    return round(statistics.median(samples) * 1000, 3)


def timed(fn, runs):
    samples = []
    result = None
    for _ in range(runs):
        t0 = time.perf_counter()
        result = fn()
        samples.append(time.perf_counter() - t0)
    return result, samples


# ------------------------------------------------------------------ grammar
def grammar_stats() -> dict:
    g = NOVA_GRAMMAR
    _, ll1 = g.ll1_table()
    g2, _ = g.eliminate_left_recursion()
    _, ll1_after = g2.ll1_table()
    amb = LRBuilder(AMBIGUOUS_NOVA_EXPR).build_slr()
    tables = {}
    for kind, build in (("SLR", "build_slr"), ("CLR", "build_clr"), ("LALR", "build_lalr")):
        samples = []
        t = None
        for _ in range(3):
            b = LRBuilder(g)                       # fresh builder: no shared caches
            t0 = time.perf_counter()
            t = getattr(b, build)()
            samples.append(time.perf_counter() - t0)
        tables[kind] = {"states": t.n_states, "entries": t.size(),
                        "conflicts": len(t.conflicts), "build_ms": median_ms(samples)}
    return {
        "productions": len(g.productions), "terminals": len(g.terminals),
        "nonterminals": len(g.nonterminals),
        "ll1_conflicts": len(ll1), "ll1_conflicts_after_left_recursion": len(ll1_after),
        "nonterminals_after_left_recursion": len(g2.nonterminals),
        "productions_after_left_recursion": len(g2.productions),
        "ambiguous_productions": len(AMBIGUOUS_NOVA_EXPR.productions),
        "ambiguous_conflicts": [{"state": c.state, "symbol": c.symbol, "kind": c.kind}
                                for c in amb.conflicts],
        "tables": tables,
    }


# ----------------------------------------------------------------- programs
def program_stats(name: str, src: str) -> dict:
    res = compile_source(src, name)                         # warm
    cpu0 = time.process_time()
    _, samples = timed(lambda: compile_source(src, name), RUNS)
    # Windows' CPU clock ticks every ~15.6 ms, so CPU time is taken over the batch
    cpu_ms = (time.process_time() - cpu0) * 1000 / RUNS
    phase = {}
    for _ in range(RUNS):
        r = compile_source(src, name)
        for k, v in r.timings.items():
            phase.setdefault(k, []).append(v)
    phase_ms = {k: median_ms(v) for k, v in phase.items()}

    fns = res.functions
    toks = [t for t in res.tokens if t.type != "EOF"]
    lines = src.splitlines()
    data = {
        "file": name,
        "lines": len(lines),
        "code_lines": sum(1 for l in lines if l.strip() and not l.strip().startswith("#")),
        "ok": res.ok,
        "tokens": len(toks),
        "lr_ok": res.lr_ok,
        "lr_steps": len(res.lr_trace),
        "rd_calls": len(res.parser.trace) if res.parser else 0,
        "symbols": len(res.sema.all_symbols) if res.sema else 0,
        "functions": len(fns),
        "sdd_events": len(res.sema.sdd_log) if res.sema else 0,
        "tac": sum(len(f.ir.code) for f in fns.values()),
        "backpatches": len(res.tacgen.patch_log) if res.tacgen else 0,
        "ir_before": sum(f.n_before for f in fns.values()),
        "ir_after": sum(f.n_after for f in fns.values()),
        "blocks": sum(len(f.cfg_before.blocks) for f in fns.values()),
        "loops": sum(len(f.loops) for f in fns.values()),
        "phis": sum(f.ssa.phis_inserted for f in fns.values()),
        "ssa_constants": sum(f.ssa.const_folded for f in fns.values()),
        "spills": sum(f.codegen.spills for f in fns.values()),
        "target": sum(len(f.codegen.code) for f in fns.values()),
        "bytecode_raw": res.bprog_raw.total_instructions() if res.bprog_raw else 0,
        "bytecode_opt": res.bprog_opt.total_instructions() if res.bprog_opt else 0,
        "peephole": len(res.peephole_notes),
        "verify_ok": res.verify_ok,
        "verify_checks": sum(len(v.checks) for v in res.verify),
        "verify_pass": sum(1 for v in res.verify for c in v.checks if c[1] == "PASS"),
        "max_stack_proved": max((v.max_stack for v in res.verify), default=0),
        "llvm_lines": len(res.llvm.splitlines()) if res.llvm else 0,
        "compile_ms": median_ms(samples),
        "compile_ms_p10": round(sorted(samples)[int(0.1 * len(samples))] * 1000, 3),
        "compile_ms_p90": round(sorted(samples)[int(0.9 * len(samples)) - 1] * 1000, 3),
        "compile_cpu_ms": round(cpu_ms, 3),
        "phase_ms": phase_ms,
        "json_bytes": len(json.dumps(build_json(res), separators=(",", ":"))),
        "diagnostics": [{"phase": e.phase, "line": e.line, "col": e.col,
                         "message": e.message, "hint": e.hint or "",
                         "warning": "never used" in e.message} for e in res.errors],
        "dataflow": {fn: {d.name: len(d.rounds) for d in
                          (f.reaching, f.live, f.available, f.busy) if d is not None}
                     for fn, f in fns.items()},
        "loop_reports": [{"function": fn, "header": l.header, "verdict": l.verdict,
                          "carried": l.carried, "reductions": l.reductions,
                          "induction": l.induction, "privatisable": l.privatisable}
                         for fn, f in fns.items() for l in f.loops],
        "passes": {fn: [{"name": p.name, "before": p.before, "after": p.after,
                         "removed": p.removed, "detail": p.detail} for p in f.opt.records]
                   for fn, f in fns.items()},
    }
    if res.run_opt is not None:
        reg = res.run_reg
        data["run"] = {
            "output": list(res.run_opt.output), "error": res.run_opt.error,
            "steps_opt": res.run_opt.steps,
            "steps_raw": res.run_raw.steps if res.run_raw else None,
            "steps_reg": getattr(reg, "steps", None),
            "max_frames": res.run_opt.max_frames, "max_stack": res.run_opt.max_stack,
            "agree": (list(res.run_opt.output) == list(getattr(reg, "output", []))
                      == list(res.run_raw.output)),
        }
        off = compile_source(src, name, optimise=False)
        data["optimiser_off"] = {
            "ir": sum(f.n_after for f in off.functions.values()),
            "bytecode": off.bprog_opt.total_instructions(),
            "steps": off.run_opt.steps,
            "same_output": list(off.run_opt.output) == list(res.run_opt.output),
        }
    return data


# ------------------------------------------------------------------ scaling
def scaling() -> list:
    """Compile time against program size, on synthetic programs made of N
    copies of a small loop (seven statements each)."""
    out = []
    for n in (1, 2, 4, 8, 16, 32, 64):
        body = "".join(f"let x{k} = 0;\nlet i{k} = 0;\nwhile i{k} < 5 do\n"
                       f"    x{k} = x{k} + i{k} * 2;\n    i{k} = i{k} + 1;\nend\nprint x{k};\n"
                       for k in range(n))
        res = compile_source(body, f"scale{n}")                   # warm
        runs = 12 if n >= 32 else 25
        _, samples = timed(lambda: compile_source(body, f"scale{n}"), runs)
        out.append({"loops": n, "lines": body.count("\n"), "tokens": len(res.tokens) - 1,
                    "lr_steps": len(res.lr_trace), "blocks": sum(len(f.cfg_before.blocks) for f in res.functions.values()),
                    "ir": sum(f.n_before for f in res.functions.values()),
                    "compile_ms": median_ms(samples),
                    "phase_ms": {k: round(v * 1000, 3) for k, v in res.timings.items()},
                    "json_bytes": len(json.dumps(build_json(res), separators=(",", ":")))})
    return out


# --------------------------------------------------------------- robustness
def robustness() -> dict:
    loop = "let i = 0;\nwhile true do i = i + 1; end\nprint i;"
    out = {}
    for label, budget in (("live", 250_000), ("run", 2_000_000)):
        _, s = timed(lambda: compile_source(loop, "loop", max_steps=budget), 3)
        r = compile_source(loop, "loop", max_steps=budget)
        out[f"nonterminating_{label}"] = {"budget": budget, "ms": median_ms(s),
                                          "error": r.run_opt.error}
    deep = "print " + "(" * 3000 + "1" + ")" * 3000 + ";"
    _, s = timed(lambda: compile_source(deep, "deep"), 5)
    r = compile_source(deep, "deep")
    out["deep_nesting"] = {"depth": 3000, "ms": median_ms(s),
                           "diagnostic": r.errors.items[0].message if len(r.errors) else ""}
    rec = "func f(n) return f(n + 1); end\nprint f(0);"
    r = compile_source(rec, "rec")
    out["runaway_recursion"] = {"error": r.run_opt.error, "reg_error": r.run_reg.error}
    return out


# --------------------------------------------------------------------- http
def http_stats(sources) -> dict:
    """Time the real thing: a separate `nova serve` process and one keep-alive
    connection, as a browser uses.  (A server thread inside this process would
    share the GIL with the client and inflate every number.)"""
    import socket
    import subprocess
    from nova.server import asset_version

    with socket.socket() as s:                     # a free port
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    proc = subprocess.Popen([sys.executable, "-m", "nova", "serve", "--no-browser",
                             "--port", str(port)], cwd=ROOT, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, text=True)
    out = {"compile_roundtrip_ms": {}, "assets": {}, "separate_process": True}
    try:
        for line in proc.stdout:                   # wait for the ready line
            if "running at" in line:
                break
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=60)

        def request(method, path, body=None):
            conn.request(method, path, body=body,
                         headers={"Content-Type": "application/json"} if body else {})
            r = conn.getresponse()
            return r.status, r.read()

        health = []
        for _ in range(HTTP_RUNS):
            t0 = time.perf_counter()
            request("GET", "/api/health")
            health.append(time.perf_counter() - t0)
        out["health_ms"] = median_ms(health)
        for name, src in sources:
            body = json.dumps({"source": src, "mode": "run", "name": name})
            request("POST", "/api/compile", body)
            samples = []
            data = b""
            for _ in range(HTTP_RUNS):
                t0 = time.perf_counter()
                _, data = request("POST", "/api/compile", body)
                samples.append(time.perf_counter() - t0)
            out["compile_roundtrip_ms"][name] = {"ms": median_ms(samples), "bytes": len(data)}
        for path in ("/", "/studio.css", "/studio.js", "/api/grammar", "/api/examples",
                     "/api/attacks"):
            _, data = request("GET", path)
            out["assets"][path] = len(data)
        conn.close()
        out["asset_version"] = asset_version()
    finally:
        proc.terminate()
        proc.wait(timeout=10)
    return out


# -------------------------------------------------------------------- tests
def test_inventory() -> dict:
    from tests import test_all
    names = [n for n, _ in test_all._tests]
    groups = {}
    for n in names:
        groups.setdefault(n.split()[0], []).append(n)
    import io
    import contextlib
    buf = io.StringIO()
    t0 = time.perf_counter()
    with contextlib.redirect_stdout(buf):
        rc = test_all.run_all()
    elapsed = time.perf_counter() - t0
    tail = buf.getvalue().strip().splitlines()[-1]
    return {"total": len(names), "groups": {k: len(v) for k, v in groups.items()},
            "names": names, "result": tail, "exit_code": rc,
            "seconds": round(elapsed, 2)}


def main() -> None:
    high = raise_priority()
    # one-time cost of the parse tables, measured from a cold cache
    pipeline._TABLE_CACHE.clear()
    t0 = time.perf_counter()
    pipeline.lr_tables(NOVA_GRAMMAR, True)
    table_build = time.perf_counter() - t0
    gv = grammar_view()

    sources = []
    for name in sorted(os.listdir(EXAMPLES)):
        if name.endswith(".nova"):
            with open(os.path.join(EXAMPLES, name), encoding="utf-8") as fh:
                sources.append((name, fh.read()))

    first = compile_source(sources[0][1], sources[0][0])
    data = {
        "environment": {"python": platform.python_version(),
                        "implementation": platform.python_implementation(),
                        "platform": platform.platform(), "runs": RUNS,
                        "http_runs": HTTP_RUNS, "high_priority": high,
                        "power": power_state()},
        "lexer": dict(first.lexer.dfa_stats(), keywords=len(KEYWORDS),
                      specs=len(TOKEN_SPECS)),
        "bytecode_opcodes": len(EFFECT),
        "lr_cache_build_ms": round(table_build * 1000, 1),
        "grammar": grammar_stats(),
        "grammar_json_bytes": len(json.dumps(gv, separators=(",", ":"))),
        "programs": [program_stats(n, s) for n, s in sources],
        "attacks": run_demo(),
        "scaling": scaling(),
        "robustness": robustness(),
        "http": http_stats(sources),
        "tests": test_inventory(),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=1, ensure_ascii=False)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
