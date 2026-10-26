"""
tests/test_all.py - the compiler's self-test suite.

    python -m nova test          (or)     python tests/test_all.py

Two kinds of test matter here.  The first kind checks that a phase produces the
answer the textbook says it should - the (a|b)*abb DFA really does have four
states, an ambiguous grammar really does conflict.  The second kind is stronger:
it checks that the *whole* compiler still means the same thing after every
transformation.  Every program is run three ways - unoptimised bytecode,
optimised bytecode, and the completely separate register machine - and all three
must print exactly the same thing.  An optimisation that changes the answer is
not an optimisation, and this is what catches it.
"""
from __future__ import annotations

import os
import sys
import traceback
from typing import Callable, List, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from nova.attacks import run_demo
from nova.bytecode import BFunction, BProgram, Ins
from nova.grammar import EPS, Grammar
from nova.lexer import Lexer
from nova.lr import LRBuilder
from nova.nova_grammar import AMBIGUOUS_NOVA_EXPR, NOVA_GRAMMAR
from nova.pipeline import compile_source
from nova.regexdfa import build_lexer_dfa
from nova.verifier import verify_program

HERE = os.path.dirname(os.path.abspath(__file__))
EXAMPLES = os.path.join(os.path.dirname(HERE), "examples")

_tests: List[Tuple[str, Callable[[], None]]] = []


def accepts(dfa, word: str):
    """Run a DFA over a whole word; return the accepting token id, or None."""
    st = dfa.start
    for ch in word:
        st = dfa.step(st, ch)
        if st < 0:
            return None
    return dfa.accept.get(st)


def test(name: str):
    def deco(fn):
        _tests.append((name, fn))
        return fn
    return deco


def eq(got, want, what: str = "") -> None:
    if got != want:
        raise AssertionError(f"{what}\n   expected: {want!r}\n   got:      {got!r}")


def compile_ok(src: str, label: str = "test"):
    res = compile_source(src, label, deep_tables=False)
    hard = [e for e in res.errors if "warning" not in (e.hint or "")]
    if hard:
        raise AssertionError("unexpected errors:\n" + res.errors.report())
    return res


# ============================================================ Module 1
@test("M1  regex to DFA by the direct method: (a|b)*abb has 4 states")
def _():
    dfa, _ = build_lexer_dfa([(1, "T", "(a|b)*abb")])
    eq(dfa.n_states, 4, "state count of the textbook example")
    eq(accepts(dfa, "abb"), 1, "accepts abb")
    eq(accepts(dfa, "ababb"), 1, "accepts ababb")
    eq(accepts(dfa, "abab"), None, "rejects abab")


@test("M1  DFA minimisation merges equivalent states")
def _():
    dfa, tr = build_lexer_dfa([(1, "T", "abc|abd|xbc|xbd")])
    before, after = tr.dfa_before.n_states, tr.dfa_after.n_states
    if before <= after:
        raise AssertionError(f"nothing was merged: {before} -> {after}")
    for w in ("abc", "abd", "xbc", "xbd"):
        eq(accepts(dfa, w), 1, f"accepts {w}")
    eq(accepts(dfa, "abx"), None, "rejects abx")


@test("M1  the scanner takes the longest match and keeps keywords apart")
def _():
    toks = [t for t in Lexer('let letter = 125; if x <= 3 then # note\n'
                             'print "hi"; end').tokenize() if t.type != "EOF"]
    kinds = [t.type for t in toks]
    eq(kinds[:4], ["LET", "IDENT", "ASSIGN", "NUMBER"], "let vs letter")
    eq(toks[1].lexeme, "letter", "longest match wins over the keyword 'let'")
    eq(toks[3].lexeme, "125", "the digits form one token, not three")
    eq(toks[3].value, 125, "the attribute carried by the token")
    if "LE" not in kinds:
        raise AssertionError("'<=' was split into '<' and '=' - not longest match")
    if any(t.type == "COMMENT" for t in toks):
        raise AssertionError("comments should not reach the parser")


# ============================================================ Module 2
@test("M2  FIRST and FOLLOW on the dragon-book expression grammar")
def _():
    g = Grammar([("E", ["T", "Ep"]),
                 ("Ep", ["+", "T", "Ep"]), ("Ep", []),
                 ("T", ["F", "Tp"]),
                 ("Tp", ["*", "F", "Tp"]), ("Tp", []),
                 ("F", ["(", "E", ")"]), ("F", ["id"])], start="E")
    first, follow = g.first_sets(), g.follow_sets()
    eq(first["E"], {"(", "id"}, "FIRST(E)")
    eq(first["Ep"], {"+", EPS}, "FIRST(E')")
    eq(follow["E"], {")", "$"}, "FOLLOW(E)")
    eq(follow["T"], {"+", ")", "$"}, "FOLLOW(T)")
    table, conflicts = g.ll1_table()
    eq(conflicts, [], "this grammar is LL(1), so the table must be conflict free")


@test("M2  left recursion is detected and removed")
def _():
    g = Grammar([("E", ["E", "+", "T"]), ("E", ["T"]), ("T", ["id"])], start="E")
    if "E" not in g.left_recursive_nts():
        raise AssertionError("failed to notice direct left recursion")
    g2, log = g.eliminate_left_recursion()
    if g2.left_recursive_nts():
        raise AssertionError("still left recursive after the transformation")
    _, conflicts = g2.ll1_table()
    eq(conflicts, [], "the rewritten grammar should be LL(1)")


@test("M2  an ambiguous grammar really does produce shift/reduce conflicts")
def _():
    t = LRBuilder(AMBIGUOUS_NOVA_EXPR).build_slr()
    if not t.conflicts:
        raise AssertionError("an ambiguous grammar with no conflicts is impossible")
    if not any(c.kind == "shift/reduce" for c in t.conflicts):
        raise AssertionError("expected at least one shift/reduce conflict")


@test("M2  SLR, CLR and LALR all accept the Nova grammar; LALR is the compact one")
def _():
    slr = LRBuilder(NOVA_GRAMMAR).build_slr()
    clr = LRBuilder(NOVA_GRAMMAR).build_clr()
    lalr = LRBuilder(NOVA_GRAMMAR).build_lalr()
    for t in (slr, clr, lalr):
        eq(t.conflicts, [], f"{t.kind} should have no conflicts on this grammar")
    eq(lalr.n_states, slr.n_states, "LALR must have the same state count as SLR")
    if clr.n_states <= lalr.n_states:
        raise AssertionError("CLR is supposed to be much larger than LALR")


@test("M2  the LALR parser accepts exactly what the hand-written parser accepts")
def _():
    for path in sorted(os.listdir(EXAMPLES)):
        if not path.endswith(".nova") or "broken" in path:
            continue
        with open(os.path.join(EXAMPLES, path), encoding="utf-8") as fh:
            res = compile_source(fh.read(), path, deep_tables=False)
        if not res.lr_ok:
            raise AssertionError(f"{path}: recursive descent accepted it but "
                                 f"LALR did not - {res.lr_msg}")


# ============================================================ Module 3
@test("M3  the type checker catches the mistakes and allows the rest")
def _():
    bad = compile_source('let s = "x" * 2;', "t", deep_tables=False)
    if not any("cannot be applied" in e.message for e in bad.errors):
        raise AssertionError("multiplying a string was not reported")
    bad2 = compile_source("print nope;", "t", deep_tables=False)
    if not any("before it is declared" in e.message for e in bad2.errors):
        raise AssertionError("use of an undeclared name was not reported")
    compile_ok('let a = 1 + 2; let b = "x" + "y"; let c = a > 0 and true;'
               ' print a; print b; if c then print 1; end')


@test("M3  an inner declaration shadows an outer one instead of overwriting it")
def _():
    res = compile_ok("let x = 10;\nlet n = 1;\nwhile n > 0 do\n"
                     "  let x = 100;\n  x = x + 1;\n  n = n - 1;\nend\nprint x;")
    eq(res.run_opt.output, ["10"], "the outer x must survive")


@test("M3  a function that is called is marked used in the symbol table")
def _():
    res = compile_ok("func twice(v)\n  return v + v;\nend\n"
                     "func idle(v)\n  return v;\nend\nprint twice(4);")
    used = {r[0]: r[7] for r in res.sema.symbol_rows() if r[1] == "func"}
    eq(used, {"twice": "yes", "idle": "no"}, "function 'used' flags")


# ============================================================ Module 4
@test("M4  booleans are compiled as jumping code, so 'and' short circuits")
def _():
    res = compile_ok("let n = 0;\nif n > 0 and 100 / n > 1 then print 1; "
                     "else print 2; end")
    eq(res.run_opt.output, ["2"], "the right operand must never be evaluated")
    eq(res.run_opt.error, "", "a short circuit means no division by zero")


@test("M4  'case' becomes a jump table and every jump gets backpatched")
def _():
    res = compile_ok('let v = 2;\ncase v of\n when 1: print "one";\n'
                     ' when 2: print "two";\n otherwise print "other";\nend')
    eq(res.run_opt.output, ["two"], "jump table dispatch")
    text = "\n".join(res.functions["main"].ir.listing())
    if "jumptable" not in text:
        raise AssertionError("case did not produce a jump table")
    if not res.tacgen.patch_log:
        raise AssertionError("nothing was backpatched, which cannot be right")
    for line in res.functions["main"].ir.listing():
        if "goto _" in line or "goto None" in line:
            raise AssertionError(f"an unpatched jump survived: {line}")


# ============================================================ Module 5
@test("M5  copy propagation refuses to propagate a killed copy (the gcd trap)")
def _():
    res = compile_ok("func gcd(a, b)\n while b > 0 do\n  let t = b;\n"
                     "  b = a % b;\n  a = t;\n end\n return a;\nend\n"
                     "print gcd(1071, 462);")
    eq(res.run_opt.output, ["21"], "gcd(1071, 462)")


@test("M5  the optimiser really removes instructions on code written badly")
def _():
    with open(os.path.join(EXAMPLES, "05_optimiser.nova"), encoding="utf-8") as fh:
        res = compile_source(fh.read(), "05", deep_tables=False)
    art = res.functions["main"]
    if art.n_after >= art.n_before:
        raise AssertionError(f"no instructions removed: {art.n_before} -> "
                             f"{art.n_after}")
    names = {r.name: r for r in art.opt.records}
    for want in ("Local value numbering / DAG", "Dead-code elimination",
                 "Loop-invariant code motion", "Strength reduction"):
        if want not in names:
            raise AssertionError(f"the {want} pass did not run")
    eq(res.run_opt.output, ["320"], "the optimised program still prints 320")


@test("M5  every data-flow analysis reaches a fixed point")
def _():
    res = compile_ok(open(os.path.join(EXAMPLES, "02_fibonacci.nova"),
                          encoding="utf-8").read(), "02")
    for name, art in res.functions.items():
        for df in (art.reaching, art.live, art.available, art.busy):
            if df is None or not df.rounds:
                raise AssertionError(f"{name}: {df} never ran")
            last, prev = df.rounds[-1], df.rounds[-2] if len(df.rounds) > 1 else None
            if prev is not None and last != prev:
                raise AssertionError(f"{name}: {df.name} did not converge")


# ============================================================ Module 6
@test("M6  the register machine and the stack machine agree on every example")
def _():
    for path in sorted(os.listdir(EXAMPLES)):
        if not path.endswith(".nova") or "broken" in path:
            continue
        with open(os.path.join(EXAMPLES, path), encoding="utf-8") as fh:
            res = compile_source(fh.read(), path, deep_tables=False)
        a = list(res.run_opt.output)
        b = list(res.run_reg.output)
        if a != b:
            raise AssertionError(f"{path}: stack machine printed {a} but the "
                                 f"register machine printed {b}")


@test("M6  optimised and unoptimised code produce identical output")
def _():
    for path in sorted(os.listdir(EXAMPLES)):
        if not path.endswith(".nova") or "broken" in path:
            continue
        with open(os.path.join(EXAMPLES, path), encoding="utf-8") as fh:
            res = compile_source(fh.read(), path, deep_tables=False)
        if list(res.run_raw.output) != list(res.run_opt.output):
            raise AssertionError(f"{path}: the optimiser changed the answer from "
                                 f"{res.run_raw.output} to {res.run_opt.output}")


@test("M6  recursion builds and unwinds real activation records")
def _():
    res = compile_ok("func f(n)\n if n < 1 then return 0; end\n"
                     " return 1 + f(n - 1);\nend\nprint f(6);")
    eq(res.run_opt.output, ["6"], "six nested calls")
    if res.run_opt.max_frames < 7:
        raise AssertionError(f"expected at least 7 frames, saw "
                             f"{res.run_opt.max_frames}")


# ============================================================ Module 7
@test("M7  phi functions appear exactly where the dominance frontier says")
def _():
    res = compile_ok("let i = 0;\nlet s = 0;\nwhile i < 5 do\n s = s + i;\n"
                     " i = i + 1;\nend\nprint s;")
    art = res.functions["main"]
    if art.ssa.phis_inserted < 2:
        raise AssertionError(f"a loop over two variables needs phi functions, "
                             f"got {art.ssa.phis_inserted}")
    text = "\n".join("\n".join(b) for b in art.ssa.blocks)
    if "phi" not in text:
        raise AssertionError("no phi function in the SSA listing")


@test("M7  a function that opens with a loop still gets its phi functions")
def _():
    with open(os.path.join(EXAMPLES, "03_gcd.nova"), encoding="utf-8") as fh:
        res = compile_source(fh.read(), "03", deep_tables=False)
    art = res.functions["gcd"]
    entry = art.cfg_after.entry
    if not art.cfg_after.blocks[entry].preds:
        raise AssertionError("expected gcd's loop header to be its entry block")
    head = art.ssa.blocks[entry]
    for v in ("a", "b"):
        if not any(l.strip().startswith(f"{v}_") and f"phi(entry:{v}" in l for l in head):
            raise AssertionError(f"no phi for '{v}' at the entry loop header:\n"
                                 + "\n".join(head))
    if entry not in art.cfg_after.dominance_frontiers()[entry]:
        raise AssertionError("a loop header must be in its own dominance frontier")


@test("M7  loop dependence analysis separates parallel from sequential loops")
def _():
    with open(os.path.join(EXAMPLES, "06_parallel.nova"), encoding="utf-8") as fh:
        res = compile_source(fh.read(), "06", deep_tables=False)
    verdicts = [l.verdict for l in res.functions["main"].loops]
    if not any("SEQUENTIAL" in v for v in verdicts):
        raise AssertionError(f"the factorial loop is not parallel: {verdicts}")
    if not any("PARALLEL" in v or "VECTOR" in v or "REDUCTION" in v
               for v in verdicts):
        raise AssertionError(f"no loop was found parallel: {verdicts}")


# ============================================================ Module 8
@test("M8  honest bytecode passes the verifier")
def _():
    for path in sorted(os.listdir(EXAMPLES)):
        if not path.endswith(".nova") or "broken" in path:
            continue
        with open(os.path.join(EXAMPLES, path), encoding="utf-8") as fh:
            res = compile_source(fh.read(), path, deep_tables=False)
        if not res.verify_ok:
            raise AssertionError(f"{path}: the verifier rejected our own output\n"
                                 + "\n".join(e for r in res.verify
                                             for e in r.errors))


@test("M8  every hostile bytecode program is stopped")
def _():
    rows = run_demo()
    escaped = [r["attack"] for r in rows if not r["blocked"]]
    if escaped:
        raise AssertionError("these attacks were not stopped: " + ", ".join(escaped))
    if len(rows) < 8:
        raise AssertionError("expected at least eight attacks")


@test("M8  the verifier does not reject a program merely for being unusual")
def _():
    p = BProgram()
    p.functions["main"] = BFunction("main", 0, 1, [
        Ins("ICONST", 3), Ins("STORE", 0), Ins("LOAD", 0), Ins("PRINT"),
        Ins("ICONST", 0), Ins("RETURN")], False)
    ok, reports = verify_program(p)
    if not ok:
        raise AssertionError("a valid program was rejected: "
                             + "; ".join(e for r in reports for e in r.errors))


# ============================================================ end to end
@test("E2E every example compiles, verifies, runs and prints what it should")
def _():
    expected = {
        "01_hello.nova": ["hello from the Nova compiler", "42"],
        "02_fibonacci.nova": ["88", "eighty-eight"],
        "03_gcd.nova": ["21", "42"],
        "04_primes.nova": ["129"],
        "05_optimiser.nova": ["320"],
        "06_parallel.nova": ["14", "28", "551"],
        "07_types_and_scopes.nova": ["positive", "negative", "zero", "10"],
        "09_nested_loops.nova": ["18"],
        "10_strings.nova": ["== nova ==", "hello, everyone", "checks pass", "many"],
        "11_deep_recursion.nova": ["200", "479001600"],
    }
    for name, want in expected.items():
        with open(os.path.join(EXAMPLES, name), encoding="utf-8") as fh:
            res = compile_source(fh.read(), name, deep_tables=False)
        eq(res.run_opt.output, want, name)
        if res.run_opt.error:
            raise AssertionError(f"{name}: {res.run_opt.error}")


@test("E2E the broken example produces diagnostics from several phases at once")
def _():
    with open(os.path.join(EXAMPLES, "08_broken.nova"), encoding="utf-8") as fh:
        res = compile_source(fh.read(), "08", deep_tables=False)
    phases = {e.phase for e in res.errors}
    for want in ("Lexical", "Syntax", "Semantic"):
        if want not in phases:
            raise AssertionError(f"no {want} reported; got {sorted(phases)}")
    if len(res.errors) < 5:
        raise AssertionError("the compiler stopped at the first error instead of "
                             "recovering")


@test("E2E the HTML report is generated for a real program")
def _():
    from nova.report_html import build_report
    with open(os.path.join(EXAMPLES, "02_fibonacci.nova"), encoding="utf-8") as fh:
        res = compile_source(fh.read(), "02_fibonacci.nova")
    html = build_report(res)
    if len(html) < 40000 or "</html>" not in html:
        raise AssertionError("the report looks truncated")
    for marker in ("followpos", "LALR", "phi", "activation record", "verifier"):
        if marker.lower() not in html.lower():
            raise AssertionError(f"the report never mentions {marker}")


@test("E2E the optimiser switch changes the code but never the answer")
def _():
    for name in sorted(os.listdir(EXAMPLES)):
        if not name.endswith(".nova") or name.startswith("08"):
            continue
        with open(os.path.join(EXAMPLES, name), encoding="utf-8") as fh:
            src = fh.read()
        on = compile_source(src, name, deep_tables=False)
        off = compile_source(src, name, deep_tables=False, optimise=False)
        eq(off.run_opt.output, on.run_opt.output, f"{name}: output with the optimiser off")
        for f in off.functions.values():
            if f.opt.records or f.n_before != f.n_after:
                raise AssertionError(f"{name}: '{f.name}' was optimised with optimise=False")
        if off.peephole_notes:
            raise AssertionError(f"{name}: peephole ran with optimise=False")


@test("E2E deeply nested input is reported as a diagnostic, not a crash")
def _():
    for src in ("print " + "(" * 3000 + "1" + ")" * 3000 + ";",
                "print " + " + ".join(["1"] * 5000) + ";"):
        res = compile_source(src, "deep", deep_tables=False)
        if res.ok or not any("nested too deeply" in e.message for e in res.errors):
            raise AssertionError("expected a 'nested too deeply' diagnostic, got "
                                 + res.errors.report())


@test("E2E the sandbox's instruction budget can be set per compilation")
def _():
    res = compile_source("let i = 0;\nwhile true do i = i + 1; end\nprint i;", "loop",
                         deep_tables=False, max_steps=5000)
    if "5000" not in res.run_opt.error:
        raise AssertionError(f"budget not applied: {res.run_opt.error!r}")
    if not getattr(res.run_reg, "error", ""):
        raise AssertionError("the register machine ignored the budget")


@test("M2  the parse-table cache adds CLR after a shallow build")
def _():
    from nova import pipeline
    pipeline._TABLE_CACHE.clear()          # earlier tests may have built CLR already
    compile_source("print 1;", "shallow", deep_tables=False)
    res = compile_source("print 1;", "deep", deep_tables=True)
    if "CLR" not in res.tables:
        raise AssertionError("CLR missing after a shallow build was cached")


@test("WEB every example serialises to JSON for Nova Studio")
def _():
    import json
    from nova.report_json import build_json, grammar_view
    for name in sorted(os.listdir(EXAMPLES)):
        if not name.endswith(".nova"):
            continue
        with open(os.path.join(EXAMPLES, name), encoding="utf-8") as fh:
            res = compile_source(fh.read(), name, deep_tables=False)
        data = json.loads(json.dumps(build_json(res)))
        for key in ("summary", "diagnostics", "lexical", "syntax", "functions",
                    "verifier", "metrics", "timings"):
            if key not in data:
                raise AssertionError(f"{name}: '{key}' missing from the JSON")
        if res.ok and (not data["run"] or data["run"]["output"] != res.run_opt.output):
            raise AssertionError(f"{name}: run output lost in the JSON")
        if not res.ok and not data["diagnostics"]:
            raise AssertionError(f"{name}: diagnostics lost in the JSON")
    g = json.loads(json.dumps(grammar_view()))
    if not g["first_follow"]["rows"] or not isinstance(g["ll1_conflicts"]["rows"][0], str):
        raise AssertionError("the grammar view is malformed")


@test("WEB the studio server answers over HTTP and refuses unsafe requests")
def _():
    import http.client
    import json
    import threading
    from http.server import ThreadingHTTPServer
    from nova.server import Handler

    Handler.quiet = True
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    def call(method, path, body=None, headers=None):
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=60)
        c.request(method, path, body=body, headers=headers or {})
        r = c.getresponse()
        data = r.read()
        c.close()
        return r.status, r.getheader("Content-Type") or "", data

    try:
        st, ct, page = call("GET", "/")
        eq((st, "text/html" in ct, b"studio.js" in page), (200, True, True), "the page")
        for path in ("/studio.css", "/studio.js", "/api/health", "/api/examples"):
            eq(call("GET", path)[0], 200, path)
        st, _, data = call("POST", "/api/compile",
                           json.dumps({"source": "let x = 6;\nprint x * 7;", "mode": "run"}),
                           {"Content-Type": "application/json"})
        eq((st, json.loads(data)["run"]["output"]), (200, ["42"]), "compile over HTTP")
        st, ct, data = call("POST", "/api/report", json.dumps({"source": "print 1;"}),
                            {"Content-Type": "application/json"})
        eq((st, "text/html" in ct, b"</html>" in data), (200, True, True), "report download")
        eq(call("POST", "/api/compile", '{"source": "print 1;"}',
                {"Content-Type": "text/plain"})[0], 415, "a form-style cross-site POST")
        eq(call("GET", "/api/health", headers={"Host": "attacker.example"})[0], 403,
           "a DNS-rebinding Host header")
        eq(call("POST", "/api/compile", "{nope", {"Content-Type": "application/json"})[0],
           400, "malformed JSON")
        eq(call("GET", "/../nova/server.py")[0], 404, "path traversal")
    finally:
        httpd.shutdown()
        httpd.server_close()


# ============================================================ runner
def run_all() -> int:
    width = max(len(n) for n, _ in _tests)
    passed = failed = 0
    print(f"Nova self-test - {len(_tests)} tests\n" + "=" * (width + 12))
    for name, fn in _tests:
        try:
            fn()
        except Exception as exc:
            failed += 1
            print(f"{name:<{width}}  FAIL")
            for line in str(exc).splitlines():
                print(f"{'':<{width}}    {line}")
            if not isinstance(exc, AssertionError):
                traceback.print_exc()
        else:
            passed += 1
            print(f"{name:<{width}}  ok")
    print("=" * (width + 12))
    print(f"{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(run_all())
