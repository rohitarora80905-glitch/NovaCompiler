# Nova — a glass-box compiler

Nova is a complete compiler for a small original programming language, written
from scratch in pure Python 3. It takes a `.nova` source file through every
classical phase — scanning, parsing, semantic analysis, intermediate code,
optimisation, code generation — verifies the bytecode it produced, and then runs
it on a sandboxed virtual machine.

What makes it a *glass box* is that nothing is thrown away. Every table, every
graph, every intermediate form the compiler builds along the way is kept and can
be looked at: the DFA the scanner runs on, the LALR parse tables, the dominance
frontiers, the register descriptors at each instruction. Most compilers are
black boxes. This one is deliberately transparent.

```
source ─► scanner ─► parser ─► semantic ─► three-address ─► optimiser ─┐
          (DFA)      (LALR)     analysis      code            (8 passes)│
                                                                       ▼
        output ◄── sandboxed VM ◄── verifier ◄── bytecode ◄────────────┤
                                                                       │
                    register machine ◄── code generator ◄──────────────┤
                                        (next-use, spilling)           │
                              LLVM IR ◄──────────────────────────────── ┘
```

---

## Quick start

**Windows** — double-click `serve.bat` for Nova Studio in your browser, or
`run.bat` for the desktop viewer. That is the whole installation.

**Any platform**

```
python -m nova serve                              Nova Studio, the web UI, at http://127.0.0.1:8765
python -m nova gui examples/02_fibonacci.nova     the desktop Glass-Box viewer
python -m nova run examples/03_gcd.nova           compile, verify and run
python -m nova report examples/02_fibonacci.nova  a full HTML report you can open
python -m nova phases examples/05_optimiser.nova  every phase, printed
python -m nova attack                             hostile bytecode vs the verifier
python -m nova test                               the 34-test self-check
```

There is **nothing to install**. No PLY, no ANTLR, no LLVM, no C or C++
compiler, no `pip install`. `requirements.txt` is empty on purpose.

If your Python was built without `tkinter` (some Linux builds are), the GUI will
say so and everything else still works — `python -m nova serve` and
`python -m nova report file.nova` show exactly the same information in a browser.

---

## Nova Studio — the web UI

`python -m nova serve` starts a small local server (standard library only) and
opens the studio in your browser: an editor on the left, the whole compiler on
the right, in a black-and-orange interface.

- **Live compilation.** Every keystroke recompiles in a few milliseconds; the
  pipeline rail shows each phase passing, failing or being skipped, with its
  timing. `Ctrl+Enter` runs with the full instruction budget.
- **Every phase, drawn.** Token stream and minimised DFA; SLR vs CLR vs LALR and
  the bottom-up parse; symbol table and attribute flow; three-address code;
  the optimiser pass by pass with before/after **control-flow graphs**; the four
  data-flow analyses converging; activation records, next-use and register
  allocation; SSA, dominance frontiers and loop-parallelism verdicts; the
  verifier's proofs; the VM trace and the activation-record stack.
- **Step through it.** A **parse player** replays the LALR(1) driver one action
  at a time, with the state stack, the symbol stack, the handle being reduced
  and the remaining input; a **VM stepper** walks the bytecode with the operand
  stack, the locals, the call depth and the output so far. Both play, pause and
  scrub, and answer the keyboard.
- **The machinery itself.** Click any token to see the DFA states the scanner
  walked; browse every state of the LALR(1) automaton with its items,
  look-aheads, ACTION and GOTO entries, and the table they come from; see the
  annotated syntax tree, the DAG of each basic block, the dominator tree and
  the data-flow facts drawn onto the flow graph; watch registers fill and empty
  on a timeline.
- **Three back-ends side by side.** Optimised bytecode, unoptimised bytecode
  and the register machine must print the same thing — the overview shows it.
- **Security lab.** The eight hostile bytecode programs, and what stopped each.
- **Problems that point at the code.** Diagnostics are marked in the gutter;
  click one to jump to the line.
- **Syllabus map.** Each of the eight modules: what it asks for, what Nova does,
  the numbers for this program, and a link to the view that shows it.
- **Optimiser switch**, example programs, open or drag-and-drop a `.nova` file,
  download the full HTML report or the compile JSON, **share a link** that
  carries the whole program, deep links (`#tab=optimiser&fn=main`), and a
  layout that works down to phone width.

While you type, each program gets a 250,000-instruction budget so a loop you
have not finished writing cannot freeze the page; **Run** uses the normal
2,000,000. The server binds to `127.0.0.1`, accepts only JSON POSTs, and
rejects foreign `Host` headers, so other web pages cannot drive it.

| Endpoint | |
|---|---|
| `GET /api/health` | version and budgets |
| `GET /api/examples` | the example programs |
| `GET /api/grammar` | grammar, FIRST/FOLLOW, LL(1) conflicts, the ambiguity demo, the DFA's accepting states and the whole LALR(1) automaton with its ACTION/GOTO table (computed once) |
| `POST /api/compile` | `{source, optimise, mode: "live"\|"run"}` → every phase as JSON |
| `POST /api/report` | the HTML report as a download |
| `GET /api/attacks` | hostile bytecode vs the verifier and sandbox |

---

## The language

```nova
# Recursion, a loop, and a jump table.
func fib(n)
    if n < 2 then return n; end
    return fib(n - 1) + fib(n - 2);
end

let total = 0;
let i = 0;
while i < 10 do
    total = total + fib(i);
    i = i + 1;
end
print total;

case total of
    when 0:  print "zero";
    when 88: print "eighty-eight";
    otherwise print "something else";
end
```

Deliberately *not* C-like: `then`/`do`/`end` instead of braces, `let` for
declarations, `case … of … when` instead of `switch`. Types are `int`, `str`
and `bool`, inferred and checked. Functions are recursive; scopes nest and
shadow.

---

## What is inside

| File | Phase | What it actually does |
|---|---|---|
| `regexdfa.py` | 1 | Regular expressions → syntax tree → `nullable`/`firstpos`/`lastpos`/`followpos` → DFA → Moore minimisation. **`re` is never imported.** |
| `lexer.py` | 1 | 41 token patterns, one combined DFA, longest-match scanning |
| `grammar.py` | 2 | FIRST/FOLLOW, LL(1) table with conflict explanations, left-recursion elimination, left factoring |
| `lr.py` | 2 | LR(0)/LR(1) items, canonical collections, **SLR, CLR and LALR** table construction, conflict diagnosis, parse animation |
| `parser.py` | 2 | Hand-written recursive-descent parser with panic-mode error recovery |
| `semantic.py` | 3 | Scoped symbol table, type checking written as an **L-attributed SDD**, with the attribute flow logged |
| `tac.py` | 4 | Three-address code, **backpatching**, short-circuit boolean jumping code, `case` → jump table |
| `cfg.py` | 5 | Leaders → basic blocks → flow graph, dominators, **dominance frontiers**, natural loops |
| `dag.py` | 5 | DAG construction / local value numbering: CSE, constant folding, algebraic identities |
| `dataflow.py` | 5 | Reaching definitions, live variables, available expressions, very busy expressions — with every round recorded |
| `optimizer.py` | 5 | 8 passes: LVN, constant propagation, **copy propagation on available copies**, LICM, strength reduction, DCE, unreachable-code elimination, jump optimisation |
| `codegen.py` | 6 | **Next-use** information, register allocation with register/address descriptors and spilling, activation records |
| `regvm.py` | 6 | Simulator for the register target, so the generated code really runs |
| `bytecode.py` | 6 | JVM-shaped stack bytecode + peephole optimiser |
| `ssa.py` | 7 | Phi placement by **iterated dominance frontier**, renaming over the dominator tree |
| `parallel.py` | 7 | Loop-carried dependence testing, reduction recognition, vectorisation and tiling advice |
| `llvmir.py` | 1, 7 | Textual LLVM IR back-end (plain text — no LLVM installation needed) |
| `verifier.py` | 5, 8 | Bytecode verification by **abstract interpretation**: five safety properties proved before anything runs |
| `vm.py` | 6, 8 | Sandboxed stack machine with real activation records and hard resource limits |
| `attacks.py` | 8 | Eight hand-written hostile bytecode programs, for the verifier to catch |
| `report_html.py` | — | The whole compilation as one self-contained HTML file |
| `report_json.py` | — | The same compilation as JSON, for Nova Studio |
| `server.py` | — | Nova Studio's local HTTP server (standard library only) |
| `web/` | — | Nova Studio's page: `index.html`, `studio.css`, `studio.js` — no frameworks, no build step |
| `gui.py` | — | The Tkinter Glass-Box viewer, one tab per phase |

---

## Results

Numbers produced by the compiler itself, not claims:

| Measurement | Value |
|---|---|
| Token patterns → DFA states (after minimisation) | 41 → **92** |
| Grammar productions | **58** |
| **SLR** states / entries / conflicts | 116 / 1229 / **0** |
| **CLR** states / entries / conflicts | 478 / 4790 / **0** |
| **LALR** states / entries / conflicts | 116 / 1214 / **0** |
| Optimiser on `05_optimiser.nova` | **21 → 19** IR, **55 → 47** bytecode, **188 → 148** VM steps |
| Hostile bytecode programs stopped | **8 of 8** |
| Self-tests passing | **34 of 34** |

The LALR line is the point of the exercise: same state count as SLR, the power
of CLR, a quarter of CLR's size. That is why every real parser generator emits
LALR, and here it is measured rather than asserted.

### Correctness, checked three ways

Every example program is executed by **unoptimised bytecode**, by **optimised
bytecode**, and by the **completely separate register machine**. All three must
print the same thing. Any optimisation that changes the answer fails the test
suite — this is how a genuine copy-propagation bug (propagating a copy that had
already been killed inside a loop) was caught and fixed in `gcd`.

---

## Example programs

| File | Shows |
|---|---|
| `01_hello.nova` | the smallest program |
| `02_fibonacci.nova` | recursion, a loop, a jump table — the demo program |
| `03_gcd.nova` | two functions, two live activation records |
| `04_primes.nova` | nested loops, short-circuit `and` |
| `05_optimiser.nova` | written badly on purpose: CSE, LICM, strength reduction, DCE, folding |
| `06_parallel.nova` | three loops — vectorisable, a reduction, genuinely sequential |
| `07_types_and_scopes.nova` | shadowing, scopes, type checking |
| `08_broken.nova` | one mistake per phase; the compiler reports all of them and recovers |
| `09_nested_loops.nova` | a nested loop pair: two verdicts, plus interchange and tiling advice |
| `10_strings.nova` | strings, booleans, if/else inside a function, `case` with `otherwise` |
| `11_deep_recursion.nova` | 200 nested activation records, inside the sandbox's limit of 256 |

---

## Layout

```
NovaCompiler/
├── serve.bat          double-click Nova Studio (Windows)
├── run.bat            double-click desktop viewer (Windows)
├── test.bat           double-click self-test
├── requirements.txt   intentionally empty
├── nova/              the compiler (25 modules)
├── report/            the IEEE-format project report and the scripts that regenerate it
│   └── web/           Nova Studio's page
├── examples/          11 sample programs
├── tests/test_all.py  34 self-tests
└── docs/              generated reports
```

Requires Python 3.8+. Tested on 3.12 and 3.14.
