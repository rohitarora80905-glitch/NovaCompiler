"""
nova.nova_grammar - the Nova language written as a context-free grammar.

This is the *same* language the recursive-descent parser in nova/parser.py
accepts, written in BNF so that the SLR / CLR / LALR machinery in nova/lr.py can
build tables for it and the viewer can animate a bottom-up parse of the very
program the user just compiled.  Keeping one language and two independent
parsers is what lets the tool cross-check top-down against bottom-up.
"""
from __future__ import annotations

from .grammar import Grammar

NOVA_RULES = [
    ("program", ["decls"]),
    ("decls", ["decls", "decl"]),
    ("decls", []),
    ("decl", ["func"]),
    ("decl", ["stmt"]),

    ("func", ["FUNC", "IDENT", "LPAREN", "params", "RPAREN", "stmts", "END"]),
    ("params", ["plist"]),
    ("params", []),
    ("plist", ["plist", "COMMA", "IDENT"]),
    ("plist", ["IDENT"]),

    ("stmts", ["stmts", "stmt"]),
    ("stmts", []),

    ("stmt", ["LET", "IDENT", "ASSIGN", "expr", "SEMI"]),
    ("stmt", ["IDENT", "ASSIGN", "expr", "SEMI"]),
    ("stmt", ["IDENT", "LPAREN", "args", "RPAREN", "SEMI"]),
    ("stmt", ["PRINT", "expr", "SEMI"]),
    ("stmt", ["RETURN", "expr", "SEMI"]),
    ("stmt", ["IF", "expr", "THEN", "stmts", "END"]),
    ("stmt", ["IF", "expr", "THEN", "stmts", "ELSE", "stmts", "END"]),
    ("stmt", ["WHILE", "expr", "DO", "stmts", "END"]),
    ("stmt", ["CASE", "expr", "OF", "whens", "END"]),
    ("stmt", ["CASE", "expr", "OF", "whens", "OTHERWISE", "stmts", "END"]),

    ("whens", ["whens", "when"]),
    ("whens", ["when"]),
    ("when", ["WHEN", "NUMBER", "COLON", "stmts"]),

    ("expr", ["expr", "OR", "join"]),
    ("expr", ["join"]),
    ("join", ["join", "AND", "eq"]),
    ("join", ["eq"]),
    ("eq", ["eq", "EQ", "rel"]),
    ("eq", ["eq", "NE", "rel"]),
    ("eq", ["rel"]),
    ("rel", ["rel", "LT", "add"]),
    ("rel", ["rel", "GT", "add"]),
    ("rel", ["rel", "LE", "add"]),
    ("rel", ["rel", "GE", "add"]),
    ("rel", ["add"]),
    ("add", ["add", "PLUS", "term"]),
    ("add", ["add", "MINUS", "term"]),
    ("add", ["term"]),
    ("term", ["term", "STAR", "unary"]),
    ("term", ["term", "SLASH", "unary"]),
    ("term", ["term", "PERCENT", "unary"]),
    ("term", ["unary"]),
    ("unary", ["MINUS", "unary"]),
    ("unary", ["NOT", "unary"]),
    ("unary", ["factor"]),
    ("factor", ["NUMBER"]),
    ("factor", ["STRING"]),
    ("factor", ["TRUE"]),
    ("factor", ["FALSE"]),
    ("factor", ["IDENT"]),
    ("factor", ["IDENT", "LPAREN", "args", "RPAREN"]),
    ("factor", ["LPAREN", "expr", "RPAREN"]),
    ("args", ["alist"]),
    ("args", []),
    ("alist", ["alist", "COMMA", "expr"]),
    ("alist", ["expr"]),
]

NOVA_GRAMMAR = Grammar(NOVA_RULES, "program", "Nova")

# A deliberately ambiguous version of the expression part, kept so the report
# can show a real shift/reduce conflict and then its cure.
AMBIGUOUS_NOVA_EXPR = Grammar(
    [("expr", ["expr", "PLUS", "expr"]),
     ("expr", ["expr", "STAR", "expr"]),
     ("expr", ["LPAREN", "expr", "RPAREN"]),
     ("expr", ["NUMBER"]),
     ("expr", ["IDENT"])],
    "expr", "Nova expressions, written ambiguously")
