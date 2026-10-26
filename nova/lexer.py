"""
nova.lexer - Module 1 front half.

Token specifications are written as *extended regular expressions*; they are
turned into one minimised DFA by nova.regexdfa, and scanning is done by
simulating that DFA with the maximal-munch (longest match) rule.  Python's `re`
module is never used - this is a real hand-built scanner generator, exactly the
way Lex does it.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .regexdfa import BuildTrace, DFA, build_lexer_dfa
from .errors import CompileError, ErrorBag

# --------------------------------------------------------------------------
# Token specifications, in priority order (earlier wins a tie on length).
# --------------------------------------------------------------------------
KEYWORDS = [
    "let", "if", "then", "else", "end", "while", "do", "case", "of", "when",
    "otherwise", "func", "return", "print", "and", "or", "not", "true", "false",
]

_IDENT = r"[A-Za-z_][A-Za-z0-9_]*"

TOKEN_SPECS: List[Tuple[str, str]] = (
    [("WS", r"[ \t\r\n]+"), ("COMMENT", r"#[^\n]*")]
    + [(k.upper(), k) for k in KEYWORDS]
    + [
        ("NUMBER", r"[0-9]+"),
        ("STRING", r"\"[^\"\n]*\""),
        ("IDENT", _IDENT),
        ("EQ", r"=="), ("NE", r"!="), ("LE", r"<="), ("GE", r">="),
        ("ASSIGN", r"="), ("LT", r"<"), ("GT", r">"),
        ("PLUS", r"\+"), ("MINUS", r"-"), ("STAR", r"\*"),
        ("SLASH", r"/"), ("PERCENT", r"%"),
        ("LPAREN", r"\("), ("RPAREN", r"\)"),
        ("COMMA", r","), ("SEMI", r";"), ("COLON", r":"),
    ]
)

SKIP = {"WS", "COMMENT"}

# Human-friendly names used in error messages and in the parse tables.
DISPLAY = {
    "ASSIGN": "=", "EQ": "==", "NE": "!=", "LE": "<=", "GE": ">=", "LT": "<",
    "GT": ">", "PLUS": "+", "MINUS": "-", "STAR": "*", "SLASH": "/",
    "PERCENT": "%", "LPAREN": "(", "RPAREN": ")", "COMMA": ",", "SEMI": ";",
    "COLON": ":",
}
for _k in KEYWORDS:
    DISPLAY[_k.upper()] = _k


@dataclass
class Token:
    type: str
    lexeme: str
    line: int
    col: int
    value: object = None          # the *attribute* (int value, string body, ...)
    path: List[int] = field(default_factory=list)   # DFA states visited
    overrun: int = 0              # characters read past the token, then given back
    ahead: str = ""               # those characters

    def __repr__(self) -> str:            # pragma: no cover - debugging aid
        return f"<{self.type} {self.lexeme!r} @{self.line}:{self.col}>"

    @property
    def attribute(self) -> str:
        if self.type == "NUMBER":
            return f"value={self.value}"
        if self.type == "STRING":
            return f'text="{self.value}"'
        if self.type == "IDENT":
            return "symbol-table entry"
        if self.type in DISPLAY:
            return "-"
        return "-"


class Lexer:
    """Scanner generated from TOKEN_SPECS.  One DFA, maximal munch."""

    _dfa: Optional[DFA] = None
    _trace: Optional[BuildTrace] = None
    _names: Dict[int, str] = {}

    @classmethod
    def build(cls) -> Tuple[DFA, BuildTrace]:
        """Build (once) and cache the minimised DFA for the whole token set."""
        if cls._dfa is None:
            specs = [(i, name, rx) for i, (name, rx) in enumerate(TOKEN_SPECS)]
            cls._names = {i: name for i, name, _ in specs}
            cls._dfa, cls._trace = build_lexer_dfa(specs)
        return cls._dfa, cls._trace

    def __init__(self, source: str, errors: Optional[ErrorBag] = None):
        self.source = source
        self.errors = errors if errors is not None else ErrorBag()
        self.dfa, self.trace = Lexer.build()
        self.names = Lexer._names
        self.tokens: List[Token] = []
        self.all_tokens: List[Token] = []      # including whitespace/comments

    # ---------------------------------------------------------------- scan
    def tokenize(self) -> List[Token]:
        src, i = self.source, 0
        line, col = 1, 1
        n = len(src)
        while i < n:
            state = self.dfa.start
            last_accept = -1
            last_pos = i
            j = i
            path = [state]                  # the states this token walked through
            while j < n:
                nxt = self.dfa.step(state, src[j])
                if nxt < 0:
                    break
                state = nxt
                j += 1
                path.append(state)
                if state in self.dfa.accept:
                    last_accept = self.dfa.accept[state]
                    last_pos = j
            if last_accept < 0:
                # No token matched: report, skip one character, keep going.
                self.errors.add(CompileError(
                    "Lexical", f"unexpected character {src[i]!r}", line, col,
                    hint="delete it, or put it inside a string literal"))
                i += 1
                col += 1
                continue

            lexeme = src[i:last_pos]
            ttype = self.names[last_accept]
            tok = Token(ttype, lexeme, line, col, path=path, overrun=j - last_pos,
                        ahead=src[last_pos:j])
            if ttype == "NUMBER":
                tok.value = int(lexeme)
            elif ttype == "STRING":
                tok.value = lexeme[1:-1]
            self.all_tokens.append(tok)
            if ttype not in SKIP:
                self.tokens.append(tok)

            # advance line/column bookkeeping
            for ch in lexeme:
                if ch == "\n":
                    line += 1
                    col = 1
                else:
                    col += 1
            i = last_pos

        # An unterminated string is the classic error-recovery demo: the `"`
        # cannot start any token, so it surfaces above; we make the message good.
        self.tokens.append(Token("EOF", "$", line, col))
        return self.tokens

    # ------------------------------------------------------------ reporting
    def dfa_stats(self) -> Dict[str, int]:
        return {
            "positions": len(self.trace.positions),
            "dfa_states_before_min": self.trace.dfa_before.n_states,
            "dfa_states_after_min": self.trace.dfa_after.n_states,
            "symbol_classes": len(self.dfa.classes),
            "token_patterns": len(TOKEN_SPECS),
        }

    def followpos_rows(self, limit: int = 40) -> List[List[str]]:
        rows = []
        for pos in sorted(self.trace.followpos)[:limit]:
            leaf = self.trace.positions[pos]
            follows = sorted(self.trace.followpos[pos])
            rows.append([str(pos), leaf.label,
                         "{" + ", ".join(map(str, follows)) + "}" if follows else "{}"])
        return rows

    def dfa_table(self) -> List[List[str]]:
        return self.dfa.table_rows(self.names)
