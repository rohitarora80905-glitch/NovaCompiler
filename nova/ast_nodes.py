"""
nova.ast_nodes - the abstract syntax tree the recursive-descent parser builds.

Every node carries `line`/`col` (for diagnostics) and, after Module 3 has run,
a `type` attribute (the *synthesised* attribute) - which is why the tree dump in
the Glass-Box viewer can be shown "annotated".
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class Node:
    line: int = 0
    col: int = 0
    type: str = ""            # filled in by the semantic analyser


# ---------------------------------------------------------------- expressions
@dataclass
class Num(Node):
    value: int = 0


@dataclass
class Str(Node):
    value: str = ""


@dataclass
class Bool(Node):
    value: bool = False


@dataclass
class Var(Node):
    name: str = ""
    scope_depth: int = 0      # inherited attribute recorded by the checker


@dataclass
class Binary(Node):
    op: str = ""
    left: Optional[Node] = None
    right: Optional[Node] = None


@dataclass
class Unary(Node):
    op: str = ""
    operand: Optional[Node] = None


@dataclass
class Call(Node):
    name: str = ""
    args: List[Node] = field(default_factory=list)


# ----------------------------------------------------------------- statements
@dataclass
class Let(Node):
    name: str = ""
    expr: Optional[Node] = None


@dataclass
class Assign(Node):
    name: str = ""
    expr: Optional[Node] = None


@dataclass
class If(Node):
    cond: Optional[Node] = None
    then_body: List[Node] = field(default_factory=list)
    else_body: List[Node] = field(default_factory=list)


@dataclass
class While(Node):
    cond: Optional[Node] = None
    body: List[Node] = field(default_factory=list)


@dataclass
class WhenClause(Node):
    value: int = 0
    body: List[Node] = field(default_factory=list)


@dataclass
class Case(Node):
    expr: Optional[Node] = None
    clauses: List[WhenClause] = field(default_factory=list)
    otherwise: List[Node] = field(default_factory=list)


@dataclass
class CallStmt(Node):
    """A bare procedure call used as a statement:  greet(3);"""
    name: str = ""
    args: List[Node] = field(default_factory=list)


@dataclass
class Print(Node):
    expr: Optional[Node] = None


@dataclass
class Return(Node):
    expr: Optional[Node] = None


@dataclass
class FuncDecl(Node):
    name: str = ""
    params: List[str] = field(default_factory=list)
    body: List[Node] = field(default_factory=list)
    n_locals: int = 0          # filled by the semantic analyser


@dataclass
class Program(Node):
    funcs: List[FuncDecl] = field(default_factory=list)
    main: List[Node] = field(default_factory=list)


# ------------------------------------------------------------------- printing
def tree(node) -> dict:
    """The AST as nested dicts {label, type, kids} - what a viewer draws."""
    def kids_of(items):
        return [tree(k) for k in items if k is not None]

    def mk(label, kids=(), ty=None, line=0):
        return {"label": label, "type": ty or "", "line": line, "kids": list(kids)}

    if node is None:
        return mk("-")
    if isinstance(node, list):
        return mk("block", kids_of(node))
    ty, ln = node.type, node.line
    if isinstance(node, Num):
        return mk(str(node.value), ty=ty, line=ln)
    if isinstance(node, Str):
        return mk(f'"{node.value}"', ty=ty, line=ln)
    if isinstance(node, Bool):
        return mk(str(node.value).lower(), ty=ty, line=ln)
    if isinstance(node, Var):
        return mk(node.name, ty=ty, line=ln)
    if isinstance(node, Binary):
        return mk(node.op, kids_of([node.left, node.right]), ty, ln)
    if isinstance(node, Unary):
        return mk(node.op, kids_of([node.operand]), ty, ln)
    if isinstance(node, (Call, CallStmt)):
        return mk(f"call {node.name}", kids_of(node.args), ty, ln)
    if isinstance(node, Let):
        return mk(f"let {node.name}", kids_of([node.expr]), ty, ln)
    if isinstance(node, Assign):
        return mk(f"{node.name} =", kids_of([node.expr]), ty, ln)
    if isinstance(node, If):
        kids = [tree(node.cond), mk("then", kids_of(node.then_body))]
        if node.else_body:
            kids.append(mk("else", kids_of(node.else_body)))
        return mk("if", kids, line=ln)
    if isinstance(node, While):
        return mk("while", [tree(node.cond), mk("do", kids_of(node.body))], line=ln)
    if isinstance(node, Case):
        kids = [tree(node.expr)]
        kids += [mk(f"when {c.value}", kids_of(c.body), line=c.line) for c in node.clauses]
        if node.otherwise:
            kids.append(mk("otherwise", kids_of(node.otherwise)))
        return mk("case", kids, line=ln)
    if isinstance(node, Print):
        return mk("print", kids_of([node.expr]), line=ln)
    if isinstance(node, Return):
        return mk("return", kids_of([node.expr]), line=ln)
    if isinstance(node, FuncDecl):
        return mk(f"func {node.name}({', '.join(node.params)})", kids_of(node.body),
                  ty, ln)
    if isinstance(node, Program):
        return mk("program", [tree(f) for f in node.funcs] + [mk("main", kids_of(node.main))])
    return mk(type(node).__name__, line=ln)


def dump(node, indent: int = 0, annotated: bool = True) -> str:
    """Pretty-print the AST; with `annotated`, show the type attribute too."""
    pad = "  " * indent
    if node is None:
        return pad + "-\n"
    if isinstance(node, list):
        return "".join(dump(n, indent, annotated) for n in node)

    ty = f"  : {node.type}" if annotated and node.type else ""
    cls = type(node).__name__

    if isinstance(node, Num):
        return f"{pad}Num {node.value}{ty}\n"
    if isinstance(node, Str):
        return f'{pad}Str "{node.value}"{ty}\n'
    if isinstance(node, Bool):
        return f"{pad}Bool {str(node.value).lower()}{ty}\n"
    if isinstance(node, Var):
        return f"{pad}Var {node.name}{ty}\n"
    if isinstance(node, Binary):
        s = f"{pad}Binary '{node.op}'{ty}\n"
        return s + dump(node.left, indent + 1, annotated) + dump(node.right, indent + 1, annotated)
    if isinstance(node, Unary):
        return f"{pad}Unary '{node.op}'{ty}\n" + dump(node.operand, indent + 1, annotated)
    if isinstance(node, Call):
        s = f"{pad}Call {node.name}{ty}\n"
        return s + "".join(dump(a, indent + 1, annotated) for a in node.args)
    if isinstance(node, Let):
        return f"{pad}Let {node.name}{ty}\n" + dump(node.expr, indent + 1, annotated)
    if isinstance(node, Assign):
        return f"{pad}Assign {node.name}{ty}\n" + dump(node.expr, indent + 1, annotated)
    if isinstance(node, If):
        s = f"{pad}If\n{pad}  cond:\n" + dump(node.cond, indent + 2, annotated)
        s += f"{pad}  then:\n" + dump(node.then_body, indent + 2, annotated)
        if node.else_body:
            s += f"{pad}  else:\n" + dump(node.else_body, indent + 2, annotated)
        return s
    if isinstance(node, While):
        s = f"{pad}While\n{pad}  cond:\n" + dump(node.cond, indent + 2, annotated)
        return s + f"{pad}  body:\n" + dump(node.body, indent + 2, annotated)
    if isinstance(node, Case):
        s = f"{pad}Case\n" + dump(node.expr, indent + 1, annotated)
        for c in node.clauses:
            s += f"{pad}  when {c.value}:\n" + dump(c.body, indent + 2, annotated)
        if node.otherwise:
            s += f"{pad}  otherwise:\n" + dump(node.otherwise, indent + 2, annotated)
        return s
    if isinstance(node, CallStmt):
        s = f"{pad}CallStmt {node.name}{ty}\n"
        return s + "".join(dump(a, indent + 1, annotated) for a in node.args)
    if isinstance(node, Print):
        return f"{pad}Print\n" + dump(node.expr, indent + 1, annotated)
    if isinstance(node, Return):
        return f"{pad}Return\n" + dump(node.expr, indent + 1, annotated)
    if isinstance(node, FuncDecl):
        s = f"{pad}Func {node.name}({', '.join(node.params)}){ty}\n"
        return s + dump(node.body, indent + 1, annotated)
    if isinstance(node, Program):
        s = f"{pad}Program\n"
        s += "".join(dump(f, indent + 1, annotated) for f in node.funcs)
        s += f"{pad}  main:\n" + dump(node.main, indent + 2, annotated)
        return s
    return f"{pad}{cls}\n"
