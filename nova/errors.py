"""
nova.errors - one error type for every phase, with line/column and a hint.

Every phase *records* errors and keeps going (panic-mode recovery in the parser,
poisoned types in the checker) instead of raising on the first problem, so a
single compile can report many diagnostics at once.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional


@dataclass
class CompileError:
    phase: str              # Lexical / Syntax / Semantic / Codegen / Verifier
    message: str
    line: int = 0
    col: int = 0
    hint: Optional[str] = None

    def __str__(self) -> str:
        where = f"line {self.line}, col {self.col}" if self.line else "-"
        base = f"[{self.phase} error] {where}: {self.message}"
        return base + (f"\n    hint: {self.hint}" if self.hint else "")


class ErrorBag:
    """Collects diagnostics from every phase so compilation can continue."""

    def __init__(self) -> None:
        self.items: List[CompileError] = []

    def add(self, err: CompileError) -> None:
        self.items.append(err)

    def extend(self, others: "ErrorBag") -> None:
        self.items.extend(others.items)

    def has_errors(self) -> bool:
        return bool(self.items)

    def by_phase(self, phase: str) -> List[CompileError]:
        return [e for e in self.items if e.phase == phase]

    def report(self) -> str:
        if not self.items:
            return "no errors"
        return "\n".join(str(e) for e in self.items)

    def __len__(self) -> int:
        return len(self.items)

    def __iter__(self):
        return iter(self.items)
