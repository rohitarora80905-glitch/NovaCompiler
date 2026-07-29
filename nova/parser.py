"""
nova.parser - Module 2: the top-down parser.

A hand-written recursive-descent parser (predictive, one token of lookahead,
with the usual precedence-climbing chain for expressions).  It builds the AST
that every later phase consumes.

Two things make it worth reading:
  * panic-mode error recovery, so one missing ';' does not produce fifty
    cascading errors;
  * a call trace, which the Glass-Box viewer renders as the top-down
    derivation next to the bottom-up LR animation of the same program.
"""
from __future__ import annotations

from typing import List, Optional

from . import ast_nodes as A
from .errors import CompileError, ErrorBag
from .lexer import DISPLAY, Token

# tokens that a statement can legally start with - used to resynchronise
STMT_START = {"LET", "IDENT", "PRINT", "RETURN", "IF", "WHILE", "CASE", "FUNC"}
SYNC = STMT_START | {"END", "ELSE", "WHEN", "OTHERWISE", "EOF"}

REL_OPS = {"EQ": "==", "NE": "!=", "LT": "<", "GT": ">", "LE": "<=", "GE": ">="}
ADD_OPS = {"PLUS": "+", "MINUS": "-"}
MUL_OPS = {"STAR": "*", "SLASH": "/", "PERCENT": "%"}


class ParseError(Exception):
    pass


class Parser:
    def __init__(self, tokens: List[Token], errors: Optional[ErrorBag] = None):
        self.toks = tokens
        self.i = 0
        self.errors = errors if errors is not None else ErrorBag()
        self.trace: List[str] = []
        self.depth = 0

    # ------------------------------------------------------------- plumbing
    @property
    def cur(self) -> Token:
        return self.toks[self.i]

    def at(self, *types: str) -> bool:
        return self.cur.type in types

    def advance(self) -> Token:
        tok = self.cur
        if self.i < len(self.toks) - 1:
            self.i += 1
        return tok

    def expect(self, ttype: str, what: str = "") -> Token:
        if self.cur.type == ttype:
            return self.advance()
        nice = DISPLAY.get(ttype, ttype)
        got = DISPLAY.get(self.cur.type, self.cur.lexeme)
        self.errors.add(CompileError(
            "Syntax", f"expected '{nice}'{' ' + what if what else ''} but found '{got}'",
            self.cur.line, self.cur.col,
            hint=f"insert '{nice}' before '{got}'"))
        raise ParseError()

    def _enter(self, rule: str) -> None:
        self.trace.append("  " * self.depth + f"{rule}   [lookahead: {self.cur.type}]")
        self.depth += 1

    def _exit(self) -> None:
        self.depth -= 1

    def synchronise(self) -> None:
        """Panic-mode recovery: skip to something a statement can start with."""
        while not self.at("EOF"):
            if self.toks[self.i - 1].type == "SEMI" and self.cur.type in SYNC:
                return
            if self.cur.type in SYNC:
                return
            self.advance()

    # -------------------------------------------------------------- program
    def parse(self) -> A.Program:
        self._enter("program")
        prog = A.Program(line=1, col=1)
        while not self.at("EOF"):
            before = self.i
            try:
                if self.at("FUNC"):
                    prog.funcs.append(self.func_decl())
                else:
                    st = self.statement()
                    if st is not None:
                        prog.main.append(st)
            except ParseError:
                self.synchronise()
                if self.i == before:          # guarantee progress
                    self.advance()
        self._exit()
        return prog

    def func_decl(self) -> A.FuncDecl:
        self._enter("func_decl")
        kw = self.expect("FUNC")
        name = self.expect("IDENT", "as the function name")
        self.expect("LPAREN")
        params: List[str] = []
        if not self.at("RPAREN"):
            params.append(self.expect("IDENT", "as a parameter name").lexeme)
            while self.at("COMMA"):
                self.advance()
                params.append(self.expect("IDENT", "as a parameter name").lexeme)
        self.expect("RPAREN")
        body = self.block({"END"})
        self.expect("END", "to close the function")
        self._exit()
        return A.FuncDecl(kw.line, kw.col, "", name.lexeme, params, body)

    def block(self, stop: set) -> List[A.Node]:
        out: List[A.Node] = []
        while not self.at("EOF") and self.cur.type not in stop:
            before = self.i
            try:
                st = self.statement()
                if st is not None:
                    out.append(st)
            except ParseError:
                self.synchronise()
                if self.cur.type in stop:
                    break
                if self.i == before:
                    self.advance()
        return out

    # ------------------------------------------------------------ statements
    def statement(self) -> Optional[A.Node]:
        t = self.cur
        if t.type == "LET":
            return self.let_stmt()
        if t.type == "PRINT":
            self._enter("print_stmt")
            self.advance()
            e = self.expression()
            self.expect("SEMI", "after a print statement")
            self._exit()
            return A.Print(t.line, t.col, "", e)
        if t.type == "RETURN":
            self._enter("return_stmt")
            self.advance()
            e = self.expression()
            self.expect("SEMI", "after a return statement")
            self._exit()
            return A.Return(t.line, t.col, "", e)
        if t.type == "IF":
            return self.if_stmt()
        if t.type == "WHILE":
            return self.while_stmt()
        if t.type == "CASE":
            return self.case_stmt()
        if t.type == "FUNC":
            self.errors.add(CompileError(
                "Syntax", "functions cannot be declared inside another block",
                t.line, t.col, hint="move this func to the top level of the file"))
            raise ParseError()
        if t.type == "IDENT":
            self._enter("assign_or_call")
            name = self.advance()
            if self.at("LPAREN"):
                self.advance()
                args = self.arg_list()
                self.expect("RPAREN")
                self.expect("SEMI", "after a call statement")
                self._exit()
                return A.CallStmt(t.line, t.col, "", name.lexeme, args)
            self.expect("ASSIGN", "in an assignment")
            e = self.expression()
            self.expect("SEMI", "after an assignment")
            self._exit()
            return A.Assign(t.line, t.col, "", name.lexeme, e)
        self.errors.add(CompileError(
            "Syntax", f"'{t.lexeme}' cannot start a statement", t.line, t.col,
            hint="statements start with let, if, while, case, print, return, "
                 "func or a variable name"))
        raise ParseError()

    def let_stmt(self) -> A.Let:
        self._enter("let_stmt")
        kw = self.advance()
        name = self.expect("IDENT", "as the variable name")
        self.expect("ASSIGN", "in a let declaration")
        e = self.expression()
        self.expect("SEMI", "after a let declaration")
        self._exit()
        return A.Let(kw.line, kw.col, "", name.lexeme, e)

    def if_stmt(self) -> A.If:
        self._enter("if_stmt")
        kw = self.advance()
        cond = self.expression()
        self.expect("THEN", "after the if condition")
        then_body = self.block({"ELSE", "END"})
        else_body: List[A.Node] = []
        if self.at("ELSE"):
            self.advance()
            else_body = self.block({"END"})
        self.expect("END", "to close the if")
        self._exit()
        return A.If(kw.line, kw.col, "", cond, then_body, else_body)

    def while_stmt(self) -> A.While:
        self._enter("while_stmt")
        kw = self.advance()
        cond = self.expression()
        self.expect("DO", "after the while condition")
        body = self.block({"END"})
        self.expect("END", "to close the while")
        self._exit()
        return A.While(kw.line, kw.col, "", cond, body)

    def case_stmt(self) -> A.Case:
        self._enter("case_stmt")
        kw = self.advance()
        e = self.expression()
        self.expect("OF", "after the case selector")
        clauses: List[A.WhenClause] = []
        while self.at("WHEN"):
            w = self.advance()
            num = self.expect("NUMBER", "as the case label")
            self.expect("COLON", "after the case label")
            body = self.block({"WHEN", "OTHERWISE", "END"})
            clauses.append(A.WhenClause(w.line, w.col, "", int(num.lexeme), body))
        otherwise: List[A.Node] = []
        if self.at("OTHERWISE"):
            self.advance()
            otherwise = self.block({"END"})
        self.expect("END", "to close the case")
        if not clauses:
            self.errors.add(CompileError(
                "Syntax", "a case statement needs at least one 'when' clause",
                kw.line, kw.col, hint="add:  when 1: ... "))
        self._exit()
        return A.Case(kw.line, kw.col, "", e, clauses, otherwise)

    # ----------------------------------------------------------- expressions
    def expression(self) -> A.Node:
        return self.or_expr()

    def or_expr(self) -> A.Node:
        node = self.and_expr()
        while self.at("OR"):
            t = self.advance()
            node = A.Binary(t.line, t.col, "", "or", node, self.and_expr())
        return node

    def and_expr(self) -> A.Node:
        node = self.equality()
        while self.at("AND"):
            t = self.advance()
            node = A.Binary(t.line, t.col, "", "and", node, self.equality())
        return node

    def equality(self) -> A.Node:
        node = self.relational()
        while self.at("EQ", "NE"):
            t = self.advance()
            node = A.Binary(t.line, t.col, "", REL_OPS[t.type], node, self.relational())
        return node

    def relational(self) -> A.Node:
        node = self.additive()
        while self.at("LT", "GT", "LE", "GE"):
            t = self.advance()
            node = A.Binary(t.line, t.col, "", REL_OPS[t.type], node, self.additive())
        return node

    def additive(self) -> A.Node:
        node = self.term()
        while self.at("PLUS", "MINUS"):
            t = self.advance()
            node = A.Binary(t.line, t.col, "", ADD_OPS[t.type], node, self.term())
        return node

    def term(self) -> A.Node:
        node = self.unary()
        while self.at("STAR", "SLASH", "PERCENT"):
            t = self.advance()
            node = A.Binary(t.line, t.col, "", MUL_OPS[t.type], node, self.unary())
        return node

    def unary(self) -> A.Node:
        if self.at("MINUS"):
            t = self.advance()
            return A.Unary(t.line, t.col, "", "-", self.unary())
        if self.at("NOT"):
            t = self.advance()
            return A.Unary(t.line, t.col, "", "not", self.unary())
        return self.factor()

    def arg_list(self) -> List[A.Node]:
        args: List[A.Node] = []
        if not self.at("RPAREN"):
            args.append(self.expression())
            while self.at("COMMA"):
                self.advance()
                args.append(self.expression())
        return args

    def factor(self) -> A.Node:
        t = self.cur
        if t.type == "NUMBER":
            self.advance()
            return A.Num(t.line, t.col, "", t.value)
        if t.type == "STRING":
            self.advance()
            return A.Str(t.line, t.col, "", t.value)
        if t.type in ("TRUE", "FALSE"):
            self.advance()
            return A.Bool(t.line, t.col, "", t.type == "TRUE")
        if t.type == "IDENT":
            self.advance()
            if self.at("LPAREN"):
                self.advance()
                args = self.arg_list()
                self.expect("RPAREN", "to close the argument list")
                return A.Call(t.line, t.col, "", t.lexeme, args)
            return A.Var(t.line, t.col, "", t.lexeme)
        if t.type == "LPAREN":
            self.advance()
            e = self.expression()
            self.expect("RPAREN", "to close the bracket")
            return e
        self.errors.add(CompileError(
            "Syntax", f"expected a value but found '{DISPLAY.get(t.type, t.lexeme)}'",
            t.line, t.col,
            hint="a value is a number, string, true/false, variable or (expression)"))
        raise ParseError()


def parse_source(tokens: List[Token], errors: Optional[ErrorBag] = None):
    p = Parser(tokens, errors)
    return p.parse(), p
