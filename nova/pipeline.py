"""
nova.pipeline - the driver that runs every phase and keeps all the evidence.

Nothing here does compiler work; it calls the phases in order and stores what
each one produced, so the GUI, the HTML report and the command line all render
exactly the same compilation rather than each doing their own.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from . import ast_nodes as A
from . import parallel as par
from .bytecode import BProgram, BytecodeGen, peephole
from .cfg import CFG, build_cfg, linearise
from .codegen import CodeGenerator
from .dataflow import (available_expressions, fmt_def, fmt_expr, live_variables,
                       reaching_definitions, very_busy_expressions)
from .errors import CompileError, ErrorBag
from .grammar import Grammar
from .lexer import Lexer, Token
from .llvmir import LLVMEmitter
from .lr import LRBuilder, LRTable, lr_parse
from .nova_grammar import AMBIGUOUS_NOVA_EXPR, NOVA_GRAMMAR
from .optimizer import Optimizer
from .parser import Parser, parse_source
from .regvm import RProgram, run as run_regvm
from .semantic import SemanticAnalyzer
from .ssa import SSAResult, to_ssa
from .tac import IRFunction, TACGen
from .verifier import VerifyReport, verify_program
from .vm import VM, RunResult

_TABLE_CACHE: Dict[str, Dict[str, LRTable]] = {}


def lr_tables(g: Grammar = NOVA_GRAMMAR, deep: bool = True) -> Dict[str, LRTable]:
    """Build (once) the SLR / CLR / LALR tables for a grammar."""
    key = g.name
    if key in _TABLE_CACHE:
        out = _TABLE_CACHE[key]
        if deep and "CLR" not in out:     # first built shallow; add CLR now
            out["CLR"] = out["_builder"].build_clr()    # type: ignore[union-attr]
        return out
    b = LRBuilder(g)
    out = {"SLR": b.build_slr(), "LALR": b.build_lalr()}
    if deep:
        out["CLR"] = b.build_clr()
    out["_builder"] = b            # type: ignore[assignment]
    _TABLE_CACHE[key] = out
    return out


@dataclass
class FuncArtifacts:
    name: str
    params: List[str]
    ir: IRFunction
    cfg_before: CFG
    cfg_after: CFG
    opt: Optimizer
    ssa: SSAResult
    codegen: CodeGenerator
    loops: List[par.LoopReport]
    reaching: object = None
    live: object = None
    available: object = None
    busy: object = None
    n_before: int = 0
    n_after: int = 0


@dataclass
class CompileResult:
    source: str = ""
    path: str = "<memory>"
    errors: ErrorBag = field(default_factory=ErrorBag)
    lexer: Optional[Lexer] = None
    tokens: List[Token] = field(default_factory=list)
    parser: Optional[Parser] = None
    ast: Optional[A.Program] = None
    sema: Optional[SemanticAnalyzer] = None
    tacgen: Optional[TACGen] = None
    functions: Dict[str, FuncArtifacts] = field(default_factory=dict)
    tables: Dict[str, LRTable] = field(default_factory=dict)
    lr_trace: List = field(default_factory=list)
    lr_ok: bool = False
    lr_msg: str = ""
    parse_tree: object = None
    bprog_opt: Optional[BProgram] = None
    bprog_raw: Optional[BProgram] = None
    verify_ok: bool = False
    verify: List[VerifyReport] = field(default_factory=list)
    peephole_notes: List[str] = field(default_factory=list)
    run_opt: Optional[RunResult] = None
    run_raw: Optional[RunResult] = None
    run_reg: object = None
    llvm: str = ""
    timings: Dict[str, float] = field(default_factory=dict)
    metrics: List[Tuple[str, str, str]] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not any(e.phase in ("Lexical", "Syntax", "Semantic")
                       and "never used" not in e.message for e in self.errors)


def compile_source(src: str, path: str = "<memory>", deep_tables: bool = True,
                   execute: bool = True, trace_limit: int = 400,
                   optimise: bool = True,
                   max_steps: int = 2_000_000) -> CompileResult:
    """Run every phase.  `optimise=False` skips the optimiser and the peephole
    pass, so the unoptimised code flows all the way to the VM; `max_steps` is
    the sandbox's instruction budget for each of the three executions."""
    res = CompileResult(source=src, path=path)
    try:
        _compile(res, deep_tables, execute, trace_limit, optimise, max_steps)
    except RecursionError:
        # A recursive-descent parser and tree walkers have a nesting limit, like
        # every real compiler; report it as a diagnostic instead of crashing.
        res.errors.add(CompileError(
            "Syntax", "the program is nested too deeply for this compiler "
                      "(an expression or block thousands of levels deep)",
            hint="split the expression into several shorter statements"))
        _metrics(res)
    return res


def _compile(res: CompileResult, deep_tables: bool, execute: bool,
             trace_limit: int, optimise: bool, max_steps: int) -> None:
    src = res.source
    errors = res.errors
    clock = time.perf_counter

    # ---------------------------------------------------- Module 1: lexical
    t0 = clock()
    lx = Lexer(src, errors)
    res.tokens = lx.tokenize()
    res.lexer = lx
    res.timings["1. Lexical analysis"] = clock() - t0

    # ----------------------------------------------------- Module 2: syntax
    t0 = clock()
    ast, p = parse_source(res.tokens, errors)
    res.ast = ast
    res.parser = p
    res.tables = lr_tables(NOVA_GRAMMAR, deep_tables)
    table = res.tables["LALR"]
    stream = [t.type for t in res.tokens if t.type != "EOF"]
    res.lr_ok, res.lr_trace, res.parse_tree, res.lr_msg = lr_parse(table, stream)
    res.timings["2. Syntax analysis"] = clock() - t0

    # --------------------------------------------------- Module 3: semantics
    t0 = clock()
    sema = SemanticAnalyzer(errors)
    sema.analyse(ast)
    res.sema = sema
    res.timings["3. Semantic analysis"] = clock() - t0

    if not res.ok:
        _metrics(res)
        return

    # ------------------------------------------- Module 4: intermediate code
    t0 = clock()
    tg = TACGen(sema)
    irfuncs = tg.generate(ast)
    res.tacgen = tg
    res.timings["4. Intermediate code"] = clock() - t0

    # ------------------------- Modules 5-7: optimisation, data flow, codegen
    t0 = clock()
    raw = BProgram()
    opt = BProgram()
    graw = BytecodeGen(raw)
    gopt = BytecodeGen(opt)
    rprog = RProgram()
    llvm_input: Dict[str, dict] = {}

    for name, irf in irfuncs.items():
        cfg0 = build_cfg(irf.code, irf.params)
        n_before = cfg0.n_instructions()
        raw.functions[name] = graw.gen_function(cfg0, name, irf.params,
                                                irf.ret_type != "void")

        art_reaching = reaching_definitions(cfg0)
        art_live = live_variables(cfg0)
        art_avail = available_expressions(cfg0)
        art_busy = very_busy_expressions(cfg0)

        cfg1 = build_cfg(irf.code, irf.params)
        o = Optimizer(cfg1, irf.params)
        if optimise:
            cfg1 = o.run_all()
        ssa = to_ssa(cfg1, irf.params)
        loops = par.analyse(cfg1)
        cg = CodeGenerator(cfg1, name, irf.params)
        cg.generate()

        fn = gopt.gen_function(cfg1, name, irf.params, irf.ret_type != "void")
        if optimise:
            fn, notes = peephole(fn)
            res.peephole_notes += [f"{name}: {n}" for n in notes]
        opt.functions[name] = fn

        rprog.code[name] = cg.code
        rprog.nslots[name] = max(cg.frame.n_slots, 1)
        rprog.nparams[name] = len(irf.params)
        llvm_input[name] = {"cfg": cfg1, "params": irf.params,
                            "returns": irf.ret_type != "void"}

        res.functions[name] = FuncArtifacts(
            name, irf.params, irf, cfg0, cfg1, o, ssa, cg, loops,
            art_reaching, art_live, art_avail, art_busy,
            n_before, cfg1.n_instructions())

    res.bprog_raw = raw
    res.bprog_opt = opt
    res.timings["5-7. Optimise, data flow, code generation"] = clock() - t0

    # ------------------------------------------ Module 8: verify, then run
    t0 = clock()
    res.verify_ok, res.verify = verify_program(opt)
    res.timings["8. Bytecode verification"] = clock() - t0

    if execute:
        t0 = clock()
        slot_names = {n: _slot_names(res.functions[n]) for n in res.functions}
        if res.verify_ok:
            res.run_opt = VM(opt, max_steps=max_steps, trace_limit=trace_limit,
                             slot_names=slot_names).run()
        else:
            res.run_opt = RunResult(error="refused to run: the verifier rejected "
                                          "this bytecode")
        res.run_raw = VM(raw, max_steps=max_steps, trace_limit=0).run()
        res.run_reg = run_regvm(rprog, max_steps=max_steps)
        res.timings["Execution"] = clock() - t0

    em = LLVMEmitter()
    res.llvm = em.emit_program(llvm_input)

    _metrics(res)


def _slot_names(art: FuncArtifacts) -> List[str]:
    inv = {v: k for k, v in art.codegen.frame.slots.items()}
    return [inv.get(i, f"s{i}") for i in range(art.codegen.frame.n_slots)]


def _metrics(res: CompileResult) -> None:
    m: List[Tuple[str, str, str]] = []
    if res.lexer:
        st = res.lexer.dfa_stats()
        m.append(("Module 1", "Token patterns (extended regular expressions)",
                  str(st["token_patterns"])))
        m.append(("Module 1", "Positions in the combined syntax tree",
                  str(st["positions"])))
        m.append(("Module 1", "DFA states before minimisation",
                  str(st["dfa_states_before_min"])))
        m.append(("Module 1", "DFA states after minimisation",
                  str(st["dfa_states_after_min"])))
        m.append(("Module 1", "Symbol equivalence classes (DFA columns)",
                  str(st["symbol_classes"])))
        m.append(("Module 1", "Tokens produced",
                  str(len([t for t in res.tokens if t.type != 'EOF']))))
    if res.tables:
        g = NOVA_GRAMMAR
        m.append(("Module 2", "Grammar productions", str(len(g.productions))))
        m.append(("Module 2", "Terminals / non-terminals",
                  f"{len(g.terminals)} / {len(g.nonterminals)}"))
        for kind in ("SLR", "CLR", "LALR"):
            if kind in res.tables:
                t = res.tables[kind]
                m.append(("Module 2", f"{kind} states / table entries / conflicts",
                          f"{t.n_states} / {t.size()} / {len(t.conflicts)}"))
        m.append(("Module 2", "Bottom-up parse of this program",
                  "accepted" if res.lr_ok else f"rejected - {res.lr_msg}"))
        m.append(("Module 2", "LR parser steps", str(len(res.lr_trace))))
    if res.sema:
        m.append(("Module 3", "Symbol-table entries", str(len(res.sema.all_symbols))))
        m.append(("Module 3", "Functions declared", str(len(res.sema.functions))))
        m.append(("Module 3", "Attribute-flow events recorded",
                  str(len(res.sema.sdd_log))))
    if res.tacgen:
        total = sum(len(f.ir.code) for f in res.functions.values())
        m.append(("Module 4", "Three-address instructions", str(total)))
        m.append(("Module 4", "Backpatch operations", str(len(res.tacgen.patch_log))))
    if res.functions:
        before = sum(f.n_before for f in res.functions.values())
        after = sum(f.n_after for f in res.functions.values())
        pct = 0 if not before else round(100 * (before - after) / before)
        m.append(("Module 5", "IR instructions before / after optimisation",
                  f"{before} / {after}  ({pct}% smaller)"))
        blocks = sum(len(f.cfg_before.blocks) for f in res.functions.values())
        m.append(("Module 5", "Basic blocks", str(blocks)))
        loops = sum(len(f.cfg_after.natural_loops()) for f in res.functions.values())
        m.append(("Module 5", "Natural loops found", str(loops)))
        m.append(("Module 6", "Target instructions (register machine)",
                  str(sum(len(f.codegen.code) for f in res.functions.values()))))
        m.append(("Module 6", "Register spills",
                  str(sum(f.codegen.spills for f in res.functions.values()))))
        m.append(("Module 7", "Phi functions inserted for SSA",
                  str(sum(f.ssa.phis_inserted for f in res.functions.values()))))
        par_ok = sum(1 for f in res.functions.values() for l in f.loops
                     if not l.verdict.startswith("SEQ"))
        m.append(("Module 7", "Loops that could run in parallel", str(par_ok)))
    if res.bprog_opt and res.bprog_raw:
        m.append(("Module 6", "Bytecode instructions before / after optimisation",
                  f"{res.bprog_raw.total_instructions()} / "
                  f"{res.bprog_opt.total_instructions()}"))
    if res.verify:
        m.append(("Module 8", "Bytecode verification",
                  "PASSED" if res.verify_ok else "REJECTED"))
        m.append(("Module 8", "Maximum operand-stack depth proved",
                  str(max((v.max_stack for v in res.verify), default=0))))
    if res.run_opt and res.run_raw:
        a, b = res.run_raw.steps, res.run_opt.steps
        pct = 0 if not a else round(100 * (a - b) / a)
        m.append(("Runtime", "VM instructions executed, unoptimised / optimised",
                  f"{a} / {b}  ({pct}% fewer)"))
        m.append(("Runtime", "Deepest activation-record stack",
                  str(res.run_opt.max_frames)))
    res.metrics = m
