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

**Windows** — double-click `run.bat`. That is the whole installation.

**Any platform**

```
python -m nova gui examples/02_fibonacci.nova     the desktop Glass-Box viewer
python -m nova run examples/03_gcd.nova           compile, verify and run
python -m nova report examples/02_fibonacci.nova  a full HTML report you can open
python -m nova phases examples/05_optimiser.nova  every phase, printed
python -m nova attack                             hostile bytecode vs the verifier
python -m nova test                               the 26-test self-check
```

There is **nothing to install**. No PLY, no ANTLR, no LLVM, no C or C++
compiler, no `pip install`. `requirements.txt` is empty on purpose.

If your Python was built without `tkinter` (some Linux builds are), the GUI will
say so and everything else still works — `python -m nova report file.nova`
writes exactly the same information to a single HTML file.

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
| Optimiser on `05_optimiser.nova` | **18 → 13** instructions |
| Hostile bytecode programs stopped | **8 of 8** |
| Self-tests passing | **26 of 26** |

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

---

## Layout

```
NovaCompiler/
├── run.bat            double-click launcher (Windows)
├── test.bat           double-click self-test
├── requirements.txt   intentionally empty
├── nova/              the compiler (23 modules)
├── examples/          8 sample programs
├── tests/test_all.py  26 self-tests
└── docs/              generated reports
```

Requires Python 3.8+. Tested on 3.12.
