"""
nova.semantic - Module 3: semantics as a syntax-directed definition.

The whole phase is one *L-attributed* pass over the AST, which means every
attribute is either

  * inherited  - passed DOWN from a parent (current scope, enclosing function,
                 loop depth, the type a context expects), or
  * synthesised- passed UP from children (the type of an expression).

Both directions are recorded in `sdd_log` so the viewer can show, production by
production, which attribute flowed which way.  That is the single hardest idea
in Module 3 to picture, and here it is a table you can scroll.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

from . import ast_nodes as A
from .errors import CompileError, ErrorBag

INT, BOOL, STR, VOID, ERR = "int", "bool", "str", "void", "<error>"


@dataclass
class Symbol:
    name: str
    kind: str                 # var | param | func
    type: str
    scope: str                # global | function name
    depth: int                # nesting depth of the block that declared it
    slot: int = -1            # index inside the activation record / globals
    line: int = 0
    params: List[str] = field(default_factory=list)
    used: bool = False
    ir_name: str = ""          # unique name used by the three-address code


class Scope:
    def __init__(self, name: str, depth: int, parent: Optional["Scope"] = None):
        self.name = name
        self.depth = depth
        self.parent = parent
        self.table: Dict[str, Symbol] = {}

    def declare(self, sym: Symbol) -> Optional[Symbol]:
        if sym.name in self.table:
            return self.table[sym.name]        # duplicate in the *same* scope
        self.table[sym.name] = sym
        return None

    def lookup(self, name: str) -> Optional[Symbol]:
        s: Optional[Scope] = self
        while s is not None:
            if name in s.table:
                return s.table[name]
            s = s.parent
        return None


@dataclass
class FunctionInfo:
    name: str
    params: List[str]
    ret: str = VOID
    n_slots: int = 0
    node: Optional[A.FuncDecl] = None


class SemanticAnalyzer:
    def __init__(self, errors: Optional[ErrorBag] = None):
        self.errors = errors if errors is not None else ErrorBag()
        self.globals = Scope("global", 0)
        self.all_symbols: List[Symbol] = []
        self.functions: Dict[str, FunctionInfo] = {}
        self.sdd_log: List[Dict[str, str]] = []
        self.n_globals = 0
        self._slot = 0
        self._max_slot = 0
        self._cur_func: Optional[FunctionInfo] = None
        self._names_used: Dict[str, int] = {}

    # ------------------------------------------------------------- logging
    def log(self, production: str, inherited: str, synthesized: str) -> None:
        self.sdd_log.append({
            "production": production,
            "inherited": inherited,
            "synthesized": synthesized,
        })

    def err(self, node, msg, hint=None) -> None:
        self.errors.add(CompileError("Semantic", msg,
                                     getattr(node, "line", 0),
                                     getattr(node, "col", 0), hint))

    # --------------------------------------------------------------- driver
    def analyse(self, prog: A.Program) -> A.Program:
        # pass 1: collect function signatures so calls can be forward references
        for f in prog.funcs:
            if f.name in self.functions:
                self.err(f, f"function '{f.name}' is declared twice",
                         "rename one of them")
                continue
            info = FunctionInfo(f.name, list(f.params), VOID, 0, f)
            self.functions[f.name] = info
            sym = Symbol(f.name, "func", "func", "global", 0, -1, f.line, list(f.params))
            self.globals.declare(sym)
            self.all_symbols.append(sym)

        # pass 2: check the bodies
        for f in prog.funcs:
            self.check_function(f)

        # pass 3: the top-level block is compiled as a function called 'main',
        # so that *every* variable in the language lives in an activation record
        main = FunctionInfo("main", [], VOID, 0, None)
        self.functions["main"] = main
        self._cur_func = main
        self._slot = 0
        self._max_slot = 0
        self._names_used = {}
        main_scope = Scope("main", 1, self.globals)
        for st in prog.main:
            self.statement(st, main_scope, 1)
        main.n_slots = self._max_slot
        self.n_globals = self._max_slot

        for sym in self.all_symbols:
            if sym.kind == "var" and not sym.used:
                self.errors.add(CompileError(
                    "Semantic", f"variable '{sym.name}' is declared but never used",
                    sym.line, 0, hint="delete it, or use it - this is a warning, "
                                      "compilation continues"))
        return prog

    def check_function(self, f: A.FuncDecl) -> None:
        info = self.functions[f.name]
        self._cur_func = info
        scope = Scope(f.name, 1, self.globals)
        self._slot = 0
        self._max_slot = 0
        self._names_used = {}
        for p in f.params:
            sym = Symbol(p, "param", INT, f.name, 1, self._slot, f.line)
            sym.ir_name = self._unique(p)
            sym.used = True
            if scope.declare(sym):
                self.err(f, f"parameter '{p}' is repeated in '{f.name}'")
            self.all_symbols.append(sym)
            self._slot += 1
            self._max_slot = max(self._max_slot, self._slot)
        self.log(f"func {f.name}({', '.join(f.params)})",
                 "scope := new frame, depth := 1",
                 f"{len(f.params)} parameter slot(s)")
        for st in f.body:
            self.statement(st, scope, 1)
        info.n_slots = self._max_slot
        f.n_locals = self._max_slot
        f.type = info.ret
        self._cur_func = None

    def _unique(self, name: str) -> str:
        """Two different variables may share a source name (different blocks);
        the IR needs one unique name per symbol."""
        n = self._names_used.get(name, 0)
        self._names_used[name] = n + 1
        return name if n == 0 else f"{name}.{n}"

    def new_slot(self) -> int:
        s = self._slot
        self._slot += 1
        self._max_slot = max(self._max_slot, self._slot)
        return s

    # ---------------------------------------------------------- statements
    def statement(self, node, scope: Scope, depth: int) -> None:
        """`scope` and `depth` are the INHERITED attributes of every statement."""
        if isinstance(node, A.Let):
            t = self.expression(node.expr, scope, depth)
            existing = scope.table.get(node.name)
            if existing is not None:
                self.err(node, f"'{node.name}' is already declared in this scope "
                               f"(line {existing.line})", "use a different name, or "
                                                          "assign without 'let'")
            slot = self.new_slot()
            sym = Symbol(node.name, "var", t, self._cur_func.name, depth, slot, node.line)
            sym.ir_name = self._unique(node.name)
            scope.declare(sym)
            node.sym = sym
            self.all_symbols.append(sym)
            node.type = t
            self.log(f"let {node.name} = E",
                     f"scope=({scope.name}, depth {depth})",
                     f"{node.name} : {t}  -> slot {slot}")

        elif isinstance(node, A.Assign):
            sym = scope.lookup(node.name)
            t = self.expression(node.expr, scope, depth)
            if sym is None:
                self.err(node, f"'{node.name}' is assigned before it is declared",
                         f"write  let {node.name} = ...;  the first time")
            elif sym.kind == "func":
                self.err(node, f"'{node.name}' is a function and cannot be assigned to")
            else:
                sym.used = True
                node.sym = sym
                if sym.type != t and ERR not in (sym.type, t):
                    self.err(node, f"cannot assign {t} to '{node.name}', which is {sym.type}",
                             "Nova variables keep the type they were given by 'let'")
            node.type = t

        elif isinstance(node, A.Print):
            node.type = self.expression(node.expr, scope, depth)

        elif isinstance(node, A.Return):
            t = self.expression(node.expr, scope, depth)
            if self._cur_func is None:
                self.err(node, "'return' outside a function",
                         "return is only legal inside func ... end")
            else:
                if self._cur_func.ret == VOID:
                    self._cur_func.ret = t
                elif self._cur_func.ret != t and ERR not in (t, self._cur_func.ret):
                    self.err(node, f"'{self._cur_func.name}' returns {self._cur_func.ret} "
                                   f"elsewhere but {t} here",
                             "make every return in a function agree")
            node.type = t

        elif isinstance(node, A.If):
            t = self.expression(node.cond, scope, depth)
            if t not in (BOOL, ERR):
                self.err(node.cond, f"the condition of 'if' must be bool, not {t}",
                         "use a comparison such as  x > 0")
            inner = Scope(scope.name, depth + 1, scope)
            self.log("if E then S1 else S2 end",
                     f"E.expected := bool ; S.scope := child of depth {depth}",
                     f"E.type = {t}")
            for s in node.then_body:
                self.statement(s, inner, depth + 1)
            if node.else_body:
                inner2 = Scope(scope.name, depth + 1, scope)
                for s in node.else_body:
                    self.statement(s, inner2, depth + 1)

        elif isinstance(node, A.While):
            t = self.expression(node.cond, scope, depth)
            if t not in (BOOL, ERR):
                self.err(node.cond, f"the condition of 'while' must be bool, not {t}",
                         "use a comparison such as  i < 10")
            inner = Scope(scope.name, depth + 1, scope)
            for s in node.body:
                self.statement(s, inner, depth + 1)

        elif isinstance(node, A.Case):
            t = self.expression(node.expr, scope, depth)
            if t not in (INT, ERR):
                self.err(node.expr, f"'case' needs an int selector, not {t}")
            seen = set()
            for c in node.clauses:
                if c.value in seen:
                    self.err(c, f"duplicate case label {c.value}")
                seen.add(c.value)
                inner = Scope(scope.name, depth + 1, scope)
                for s in c.body:
                    self.statement(s, inner, depth + 1)
            if node.otherwise:
                inner = Scope(scope.name, depth + 1, scope)
                for s in node.otherwise:
                    self.statement(s, inner, depth + 1)

        elif isinstance(node, A.CallStmt):
            node.type = self.call(node, scope, depth)

        elif isinstance(node, A.FuncDecl):
            self.err(node, "nested functions are not supported in Nova")

    # ---------------------------------------------------------- expressions
    def expression(self, node, scope: Scope, depth: int) -> str:
        """Returns the SYNTHESISED attribute `type` of the expression."""
        if node is None:
            return ERR

        if isinstance(node, A.Num):
            node.type = INT
        elif isinstance(node, A.Str):
            node.type = STR
        elif isinstance(node, A.Bool):
            node.type = BOOL
        elif isinstance(node, A.Var):
            sym = scope.lookup(node.name)
            if sym is None:
                self.err(node, f"'{node.name}' is used before it is declared",
                         f"add  let {node.name} = ...;  above this line")
                node.type = ERR
            elif sym.kind == "func":
                self.err(node, f"'{node.name}' is a function; did you mean {node.name}(...)?")
                node.type = ERR
            else:
                sym.used = True
                node.type = sym.type
                node.scope_depth = sym.depth
                node.sym = sym
        elif isinstance(node, A.Unary):
            t = self.expression(node.operand, scope, depth)
            if node.op == "-":
                if t not in (INT, ERR):
                    self.err(node, f"unary '-' needs an int, not {t}")
                node.type = INT if t != ERR else ERR
            else:
                if t not in (BOOL, ERR):
                    self.err(node, f"'not' needs a bool, not {t}")
                node.type = BOOL if t != ERR else ERR
        elif isinstance(node, A.Binary):
            lt = self.expression(node.left, scope, depth)
            rt = self.expression(node.right, scope, depth)
            node.type = self.binary_type(node, lt, rt)
            self.log(f"E -> E1 '{node.op}' E2",
                     "operands inherit the current scope",
                     f"E1.type={lt}, E2.type={rt}  =>  E.type={node.type}")
        elif isinstance(node, A.Call):
            node.type = self.call(node, scope, depth)
        else:
            node.type = ERR
        return node.type

    def binary_type(self, node, lt: str, rt: str) -> str:
        op = node.op
        if ERR in (lt, rt):
            return ERR
        if op in ("+", "-", "*", "/", "%"):
            if op == "+" and lt == STR and rt == STR:
                return STR                      # string concatenation
            if lt == INT and rt == INT:
                return INT
            self.err(node, f"'{op}' cannot be applied to {lt} and {rt}",
                     "arithmetic works on int; '+' also joins two strings")
            return ERR
        if op in ("<", ">", "<=", ">="):
            if lt == INT and rt == INT:
                return BOOL
            self.err(node, f"'{op}' compares ints, not {lt} and {rt}")
            return ERR
        if op in ("==", "!="):
            if lt == rt:
                return BOOL
            self.err(node, f"'{op}' compares two values of the same type, "
                           f"but got {lt} and {rt}")
            return ERR
        if op in ("and", "or"):
            if lt == BOOL and rt == BOOL:
                return BOOL
            self.err(node, f"'{op}' needs two bools, not {lt} and {rt}",
                     "wrap comparisons in brackets:  (a > 1) and (b < 2)")
            return ERR
        return ERR

    def call(self, node, scope: Scope, depth: int) -> str:
        info = self.functions.get(node.name)
        arg_types = [self.expression(a, scope, depth) for a in node.args]
        if info is None:
            self.err(node, f"call to unknown function '{node.name}'",
                     "check the spelling, or declare it with  func " + node.name + "(...)")
            return ERR
        if len(arg_types) != len(info.params):
            self.err(node, f"'{node.name}' takes {len(info.params)} argument(s) "
                           f"but got {len(arg_types)}")
            return ERR
        for i, (p, t) in enumerate(zip(info.params, arg_types)):
            if t not in (INT, ERR):
                self.err(node.args[i], f"argument {i + 1} of '{node.name}' "
                                       f"({p}) must be int, not {t}")
        self.log(f"call {node.name}({len(arg_types)} args)",
                 "each argument inherits the caller's scope",
                 f"result type = {info.ret}")
        return info.ret if info.ret != VOID else VOID

    # ------------------------------------------------------------ reporting
    def symbol_rows(self) -> List[List[str]]:
        rows = []
        for s in self.all_symbols:
            rows.append([s.name, s.kind, s.type, s.scope, str(s.depth),
                         "-" if s.slot < 0 else str(s.slot), str(s.line),
                         "yes" if s.used else "no"])
        return rows
