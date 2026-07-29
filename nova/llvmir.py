"""
nova.llvmir - a third back-end that prints textual LLVM IR.

The syllabus opens with "Introduction to LLVM", so Nova can emit a `.ll` file.
Textual LLVM IR is plain text, so producing it needs no LLVM installation, no C
toolchain and no build step - which keeps the project's "pure Python, Windows,
double-click" rule intact.  Anyone who *does* have clang can run
`clang out.ll -o out.exe`; nothing in the project depends on that.

The strategy is the one clang itself uses at -O0: every Nova variable becomes an
`alloca`, reads become `load` and writes become `store`.  LLVM's own mem2reg
pass would then put it into SSA form - the same SSA we build ourselves in
nova/ssa.py.
"""
from __future__ import annotations

from typing import Dict, List

from .cfg import CFG, CONDS
from .dag import is_const
from .dataflow import defs_of, uses_of
from .tac import ARITH

ICMP = {"iflt": "slt", "ifgt": "sgt", "ifle": "sle",
        "ifge": "sge", "ifeq": "eq", "ifne": "ne"}
BINOP = {"+": "add", "-": "sub", "*": "mul", "/": "sdiv", "%": "srem"}


class LLVMEmitter:
    def __init__(self):
        self.lines: List[str] = []
        self.strings: Dict[str, str] = {}
        self.n = 0

    def tmp(self) -> str:
        self.n += 1
        return f"%r{self.n}"

    def gstr(self, s: str) -> str:
        if s not in self.strings:
            name = f"@.str{len(self.strings)}"
            self.strings[s] = name
        return self.strings[s]

    # ------------------------------------------------------------------ API
    def emit_program(self, functions: Dict[str, "CFGFunction"]) -> str:
        body: List[str] = []
        for name, item in functions.items():
            body += self.emit_function(name, item["cfg"], item["params"],
                                       item["returns"])
            body.append("")
        head = ["; LLVM IR emitted by the Nova compiler",
                "; textual IR only - no LLVM toolchain is needed to produce this file",
                "target triple = \"x86_64-pc-windows-msvc\"",
                "",
                "declare void @nova_print_int(i32)",
                "declare void @nova_print_str(i8*)",
                ""]
        for s, name in self.strings.items():
            esc = s.replace("\\", "\\5C").replace('"', "\\22")
            head.append(f'{name} = private unnamed_addr constant '
                        f'[{len(s) + 1} x i8] c"{esc}\\00"')
        if self.strings:
            head.append("")
        return "\n".join(head + body)

    def emit_function(self, name: str, cfg: CFG, params: List[str],
                      returns_value: bool) -> List[str]:
        out: List[str] = []
        names = set(params)
        for b in cfg.blocks:
            for q in b.quads:
                names |= defs_of(q) | uses_of(q)
        names = sorted(n for n in names if not is_const(n))
        args = ", ".join(f"i32 %{p}.arg" for p in params)
        rty = "i32"
        out.append(f"define {rty} @{name}({args}) {{")
        out.append("entry:")
        for v in names:
            out.append(f"  %{v} = alloca i32")
        for p in params:
            out.append(f"  store i32 %{p}.arg, i32* %{p}")
        out.append(f"  br label %B0" if cfg.blocks else "  ret i32 0")

        for b in cfg.blocks:
            out.append(f"B{b.id}:")
            terminated = False
            for k, q in enumerate(b.quads):
                if q.op in ARITH:
                    a = self.operand(q.a, out)
                    c = self.operand(q.b, out)
                    r = self.tmp()
                    out.append(f"  {r} = {BINOP[q.op]} i32 {a}, {c}")
                    out.append(f"  store i32 {r}, i32* %{q.r}")
                elif q.op == "uminus":
                    a = self.operand(q.a, out)
                    r = self.tmp()
                    out.append(f"  {r} = sub i32 0, {a}")
                    out.append(f"  store i32 {r}, i32* %{q.r}")
                elif q.op == "=":
                    a = self.operand(q.a, out)
                    out.append(f"  store i32 {a}, i32* %{q.r}")
                elif q.op in CONDS:
                    a = self.operand(q.a, out)
                    c = self.operand(q.b, out)
                    r = self.tmp()
                    out.append(f"  {r} = icmp {ICMP[q.op]} i32 {a}, {c}")
                    fall = b.id + 1 if b.id + 1 < len(cfg.blocks) else b.id
                    out.append(f"  br i1 {r}, label %B{q.r}, label %B{fall}")
                    terminated = True
                elif q.op == "goto":
                    out.append(f"  br label %B{q.r}")
                    terminated = True
                elif q.op == "jtab":
                    a = self.operand(q.a, out)
                    cases = " ".join(f"i32 {v}, label %B{t}" for v, t in q.b)
                    out.append(f"  switch i32 {a}, label %B{q.r} [ {cases} ]")
                    terminated = True
                elif q.op == "print":
                    if is_const(q.a) and q.a.startswith('"'):
                        body = q.a[1:-1]
                        g = self.gstr(body)
                        r = self.tmp()
                        out.append(f"  {r} = getelementptr [{len(body) + 1} x i8], "
                                   f"[{len(body) + 1} x i8]* {g}, i32 0, i32 0")
                        out.append(f"  call void @nova_print_str(i8* {r})")
                    else:
                        a = self.operand(q.a, out)
                        out.append(f"  call void @nova_print_int(i32 {a})")
                elif q.op == "param":
                    b.pending = getattr(b, "pending", [])
                    b.pending.append(self.operand(q.a, out))
                elif q.op == "call":
                    argv = getattr(b, "pending", [])
                    b.pending = []
                    r = self.tmp()
                    out.append(f"  {r} = call i32 @{q.a}("
                               f"{', '.join('i32 ' + x for x in argv)})")
                    if q.r:
                        out.append(f"  store i32 {r}, i32* %{q.r}")
                elif q.op == "ret":
                    if q.a is None:
                        out.append("  ret i32 0")
                    else:
                        a = self.operand(q.a, out)
                        out.append(f"  ret i32 {a}")
                    terminated = True
            if not terminated:
                nxt = b.id + 1
                out.append(f"  br label %B{nxt}" if nxt < len(cfg.blocks)
                           else "  ret i32 0")
        out.append("}")
        return out

    def operand(self, x, out: List[str]) -> str:
        if x is None:
            return "0"
        if is_const(x):
            if x.startswith('"'):
                return "0"
            return x
        r = self.tmp()
        out.append(f"  {r} = load i32, i32* %{x}")
        return r


CFGFunction = dict
