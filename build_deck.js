// build_deck.js - the Nova presentation
const pptxgen = require("pptxgenjs");

const INK = "0F2233";      // deep petrol - the machine interior
const INK2 = "1B3648";     // lighter ink for panels on dark slides
const COPPER = "C4622D";   // the accent: a glass box lit from inside
const TEAL = "0E7C66";     // verified / safe
const PANEL = "EEF3F6";    // cool light panel
const MUTED = "5D6B7A";
const WHITE = "FFFFFF";
const CODE = "DCE7EE";

const HEAD = "Cambria";
const BODY = "Calibri";
const MONO = "Courier New";

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";          // 10 x 5.625 inches
pres.author = "Nova compiler project";
pres.title = "Nova - a glass-box compiler";

let slideNo = 0;

function shadow() {
  return { type: "outer", color: "9AACB8", blur: 8, offset: 2, angle: 90, opacity: 0.35 };
}

function base(dark) {
  slideNo += 1;
  const s = pres.addSlide();
  s.background = { color: dark ? INK : WHITE };
  if (slideNo > 1) {
    s.addText(String(slideNo), {
      x: 9.25, y: 5.16, w: 0.5, h: 0.28, fontSize: 9, fontFace: BODY,
      color: dark ? "5F7A8C" : "A9B8C2", align: "right",
    });
  }
  return s;
}

// numbered copper chip + title: the motif repeated on every phase slide
function head(s, num, title, sub, dark) {
  let tx = 0.55;
  if (num !== null) {
    s.addShape(pres.ShapeType.ellipse, {
      x: 0.55, y: 0.34, w: 0.52, h: 0.52, fill: { color: COPPER },
    });
    s.addText(String(num), {
      x: 0.55, y: 0.34, w: 0.52, h: 0.52, fontSize: 20, bold: true,
      color: WHITE, align: "center", valign: "middle", fontFace: HEAD, margin: 0,
    });
    tx = 1.22;
  }
  s.addText(title, {
    x: tx, y: 0.3, w: 9.9 - tx - 0.4, h: 0.6, fontSize: 30, bold: true,
    fontFace: HEAD, color: dark ? WHITE : INK, valign: "middle", margin: 0,
  });
  if (sub) {
    s.addText(sub, {
      x: tx, y: 0.88, w: 9.9 - tx - 0.4, h: 0.36, fontSize: 13.5, italic: true,
      fontFace: BODY, color: dark ? "9FBACB" : MUTED, valign: "middle", margin: 0,
    });
  }
}

function card(s, x, y, w, h, fill) {
  s.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.08, fill: { color: fill || PANEL }, shadow: shadow(),
  });
}

function codePanel(s, x, y, w, h, caption, lines, size) {
  s.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.08, fill: { color: INK },
  });
  if (caption) {
    s.addText(caption, {
      x: x + 0.16, y: y + 0.08, w: w - 0.32, h: 0.24, fontSize: 9.5, bold: true,
      color: COPPER, fontFace: BODY, margin: 0, charSpacing: 1,
    });
  }
  s.addText(lines.join("\n"), {
    x: x + 0.16, y: y + (caption ? 0.34 : 0.14), w: w - 0.32,
    h: h - (caption ? 0.46 : 0.28), fontSize: size || 10.5, fontFace: MONO,
    color: CODE, margin: 0, lineSpacing: (size || 10.5) * 1.35, valign: "top",
  });
}

function stat(s, x, y, w, value, label, color) {
  s.addText(value, {
    x, y, w, h: 0.62, fontSize: 40, bold: true, fontFace: HEAD,
    color: color || COPPER, margin: 0, align: "left",
  });
  s.addText(label, {
    x, y: y + 0.6, w, h: 0.5, fontSize: 11, fontFace: BODY, color: MUTED,
    margin: 0, align: "left",
  });
}

function bullets(s, x, y, w, h, items, size, color) {
  s.addText(items.map((t, i) => ({
    text: t, options: { bullet: true, breakLine: i !== items.length - 1 },
  })), {
    x, y, w, h, fontSize: size || 13, fontFace: BODY, color: color || INK,
    paraSpaceAfter: 8, margin: 0, valign: "top",
  });
}

// ==================================================================== 1 title
{
  const s = base(true);
  s.addShape(pres.ShapeType.roundRect, {
    x: 5.65, y: 0.75, w: 3.85, h: 4.1, rectRadius: 0.1, fill: { color: INK2 },
  });
  s.addText("GLASS BOX", {
    x: 5.85, y: 0.92, w: 3.45, h: 0.28, fontSize: 10, bold: true, color: COPPER,
    fontFace: BODY, charSpacing: 2, margin: 0,
  });
  const phases = [
    "source text", "tokens  (DFA)", "parse tree  (LALR)", "annotated tree  (SDD)",
    "three-address code", "optimised flow graph", "target code  +  bytecode",
    "verified  ->  running",
  ];
  phases.forEach((p, i) => {
    const y = 1.35 + i * 0.42;
    s.addShape(pres.ShapeType.ellipse, {
      x: 5.9, y: y + 0.09, w: 0.14, h: 0.14,
      fill: { color: i === 7 ? TEAL : COPPER },
    });
    s.addText(p, {
      x: 6.2, y, w: 3.1, h: 0.32, fontSize: 12, fontFace: MONO,
      color: i === 7 ? "8FD8C4" : CODE, margin: 0, valign: "middle",
    });
    if (i < 7) {
      s.addShape(pres.ShapeType.line, {
        x: 5.97, y: y + 0.23, w: 0, h: 0.19,
        line: { color: "3D5A6E", width: 1 },
      });
    }
  });

  s.addText("Nova", {
    x: 0.6, y: 1.15, w: 5, h: 1.0, fontSize: 60, bold: true, fontFace: HEAD,
    color: WHITE, margin: 0,
  });
  s.addText("a glass-box compiler", {
    x: 0.6, y: 2.1, w: 5, h: 0.5, fontSize: 24, fontFace: HEAD, color: COPPER,
    margin: 0,
  });
  s.addText(
    "A complete compiler for an original language, built from scratch in pure " +
    "Python - and deliberately transparent, so you can watch every phase happen.",
    { x: 0.6, y: 2.75, w: 4.75, h: 1.0, fontSize: 13.5, fontFace: BODY,
      color: "AFC6D4", margin: 0, lineSpacing: 20 });
  s.addText(
    "7,600 lines   |   27 modules   |   zero dependencies   |   26 / 26 tests passing",
    { x: 0.6, y: 4.35, w: 4.9, h: 0.4, fontSize: 11.5, bold: true, fontFace: BODY,
      color: WHITE, margin: 0 });
  s.addText("Compiler Design  -  course project", {
    x: 0.6, y: 4.75, w: 4.9, h: 0.35, fontSize: 11, fontFace: BODY,
    color: "7D9AAC", margin: 0,
  });
  s.addNotes(
    "Open by naming the one-sentence idea: a compiler is usually a black box - " +
    "source goes in, a program comes out, and everything in between is invisible. " +
    "Nova does the same job but keeps every intermediate form and shows it. " +
    "Mention the three constraints we set ourselves: pure Python, no parser " +
    "generator, nothing installed. Everything on the right of this slide is a " +
    "real artefact the tool will show you.");
}

// ============================================================ 2 the idea
{
  const s = base(false);
  head(s, null, "Compilers are black boxes. This one is not.", null, false);

  card(s, 0.55, 1.35, 4.3, 3.5, PANEL);
  s.addText("The usual experience", {
    x: 0.8, y: 1.55, w: 3.8, h: 0.35, fontSize: 15, bold: true, fontFace: HEAD,
    color: INK, margin: 0,
  });
  s.addShape(pres.ShapeType.roundRect, {
    x: 1.35, y: 2.05, w: 2.7, h: 1.0, rectRadius: 0.08, fill: { color: "36454F" },
  });
  s.addText("?", {
    x: 1.35, y: 2.05, w: 2.7, h: 1.0, fontSize: 34, bold: true, color: "7C8B95",
    align: "center", valign: "middle", fontFace: HEAD, margin: 0,
  });
  s.addText("source in", { x: 1.35, y: 1.78, w: 2.7, h: 0.25, fontSize: 10,
    color: MUTED, align: "center", fontFace: BODY, margin: 0 });
  s.addText("a.out", { x: 1.35, y: 3.07, w: 2.7, h: 0.25, fontSize: 10,
    color: MUTED, align: "center", fontFace: BODY, margin: 0 });
  bullets(s, 0.85, 3.45, 3.7, 1.3, [
    "You learn the phases as diagrams on a slide",
    "You never see a real DFA, a real LALR table or a real flow graph",
    "When it breaks, there is nothing to look at",
  ], 11.5, MUTED);

  card(s, 5.15, 1.35, 4.3, 3.5, "E8F2EF");
  s.addText("What Nova does instead", {
    x: 5.4, y: 1.55, w: 3.8, h: 0.35, fontSize: 15, bold: true, fontFace: HEAD,
    color: TEAL, margin: 0,
  });
  const boxes = ["DFA", "LALR", "SDD", "TAC", "CFG", "SSA", "ASM", "VM"];
  boxes.forEach((b, i) => {
    const x = 5.42 + (i % 4) * 0.98;
    const y = 2.05 + Math.floor(i / 4) * 0.52;
    s.addShape(pres.ShapeType.roundRect, {
      x, y, w: 0.86, h: 0.42, rectRadius: 0.06, fill: { color: WHITE },
      line: { color: TEAL, width: 1 },
    });
    s.addText(b, { x, y, w: 0.86, h: 0.42, fontSize: 10.5, bold: true,
      color: TEAL, align: "center", valign: "middle", fontFace: MONO, margin: 0 });
  });
  bullets(s, 5.45, 3.3, 3.7, 1.45, [
    "Every table the compiler builds is kept and displayed",
    "Nothing is a mock-up: the tables shown are the tables used",
    "One tab per phase, in the order the textbook teaches them",
  ], 11.5, INK);
  s.addNotes(
    "This is the motivation slide. The point to land: we did not build a viewer " +
    "that draws a picture of a DFA; we built a compiler that runs on a DFA and " +
    "then shows you the one it is actually running on. If the display and the " +
    "behaviour could ever disagree, the display would be worthless.");
}

// ============================================================ 3 pipeline
{
  const s = base(false);
  head(s, null, "What happens to your program",
       "Eight phases. Every arrow is a real data structure, not a metaphor.", false);

  const st = [
    ["1", "Scanner", "regex -> DFA,\nlongest match"],
    ["2", "Parser", "LALR tables +\nrecursive descent"],
    ["3", "Semantics", "symbol table,\ntypes as an SDD"],
    ["4", "Intermediate", "three-address code,\nbackpatching"],
    ["5", "Optimiser", "flow graph, DAG,\n8 passes"],
    ["6", "Code gen", "next use, registers,\nframes"],
    ["7", "SSA", "phi functions,\ndependence tests"],
    ["8", "Verifier", "prove it safe,\nthen run it"],
  ];
  st.forEach((p, i) => {
    const x = 0.55 + (i % 4) * 2.34;
    const y = 1.5 + Math.floor(i / 4) * 1.82;
    const last = i === 7;
    s.addShape(pres.ShapeType.roundRect, {
      x, y, w: 2.06, h: 1.5, rectRadius: 0.08,
      fill: { color: last ? "E8F2EF" : PANEL }, shadow: shadow(),
    });
    s.addShape(pres.ShapeType.ellipse, {
      x: x + 0.14, y: y + 0.14, w: 0.36, h: 0.36,
      fill: { color: last ? TEAL : COPPER },
    });
    s.addText(p[0], { x: x + 0.14, y: y + 0.14, w: 0.36, h: 0.36, fontSize: 13,
      bold: true, color: WHITE, align: "center", valign: "middle",
      fontFace: HEAD, margin: 0 });
    s.addText(p[1], { x: x + 0.58, y: y + 0.14, w: 1.4, h: 0.36, fontSize: 13.5,
      bold: true, color: last ? TEAL : INK, valign: "middle", fontFace: HEAD,
      margin: 0 });
    s.addText(p[2], { x: x + 0.16, y: y + 0.6, w: 1.78, h: 0.78, fontSize: 10.5,
      color: MUTED, fontFace: BODY, margin: 0, lineSpacing: 13 });
    if (i % 4 !== 3) {
      s.addShape(pres.ShapeType.line, {
        x: x + 2.06, y: y + 0.75, w: 0.28, h: 0,
        line: { color: COPPER, width: 1.5, endArrowType: "triangle" },
      });
    }
  });
  s.addShape(pres.ShapeType.line, {
    x: 8.48, y: 3.0, w: 0, h: 0.16, line: { color: COPPER, width: 1.5 } });
  s.addShape(pres.ShapeType.line, {
    x: 1.58, y: 3.16, w: 6.9, h: 0,
    line: { color: COPPER, width: 1.5, dashType: "dash" } });
  s.addShape(pres.ShapeType.line, {
    x: 1.58, y: 3.16, w: 0, h: 0.16,
    line: { color: COPPER, width: 1.5, endArrowType: "triangle" } });
  s.addNotes(
    "Walk left to right, top row then bottom row, one sentence each - the detail " +
    "comes in the next eight slides. The two things worth flagging now: phase 2 " +
    "runs two independent parsers on the same grammar so they can check each " +
    "other, and phase 8 is the one no textbook pipeline has - we verify our own " +
    "output before we trust it.");
}

// ============================================================ 4 the language
{
  const s = base(false);
  head(s, null, "The language we compile",
       "Deliberately not C-like: 'then', 'do' and 'end' instead of braces.", false);
  codePanel(s, 0.55, 1.4, 5.0, 3.5, "EXAMPLES/02_FIBONACCI.NOVA", [
    "func fib(n)",
    "    if n < 2 then return n; end",
    "    return fib(n - 1) + fib(n - 2);",
    "end",
    "",
    "let total = 0;",
    "let i = 0;",
    "while i < 10 do",
    "    total = total + fib(i);",
    "    i = i + 1;",
    "end",
    "print total;",
    "",
    "case total of",
    '    when 0:  print "zero";',
    '    when 88: print "eighty-eight";',
    '    otherwise print "other";',
    "end",
  ], 10.5);

  card(s, 5.85, 1.4, 3.6, 1.55, PANEL);
  s.addText("What it has", { x: 6.05, y: 1.52, w: 3.2, h: 0.3, fontSize: 13,
    bold: true, fontFace: HEAD, color: INK, margin: 0 });
  bullets(s, 6.05, 1.85, 3.25, 1.05, [
    "recursion, nested scopes, shadowing",
    "int / str / bool, inferred and checked",
    "case -> a real jump table, not an if-chain",
  ], 10.5, MUTED);

  card(s, 5.85, 3.1, 3.6, 1.8, "E8F2EF");
  s.addText("It really runs", { x: 6.05, y: 3.22, w: 3.2, h: 0.3, fontSize: 13,
    bold: true, fontFace: HEAD, color: TEAL, margin: 0 });
  s.addText("88\neighty-eight", {
    x: 6.05, y: 3.55, w: 3.2, h: 0.7, fontSize: 15, fontFace: MONO, color: INK,
    margin: 0, lineSpacing: 20 });
  s.addText("4,074 bytecode instructions executed,\n10 activation records deep " +
            "at the bottom of the recursion.", {
    x: 6.05, y: 4.25, w: 3.2, h: 0.55, fontSize: 10.5, fontFace: BODY,
    color: MUTED, margin: 0, lineSpacing: 13 });
  s.addNotes(
    "Show the program once, and say clearly: every slide after this one is about " +
    "this exact program. The syntax is intentionally unlike C - a rule we set so " +
    "we could not lean on anything familiar and had to write the grammar " +
    "ourselves. If someone asks why 'end' instead of braces: it makes the grammar " +
    "LALR-friendly and it makes error recovery much easier to explain.");
}

// ============================================================ 5 lexical
{
  const s = base(false);
  head(s, 1, "Scanning: regular expressions become one DFA",
       "The direct method - firstpos, lastpos and followpos. No NFA is ever built.",
       false);

  codePanel(s, 0.55, 1.55, 4.35, 1.45, "TOKEN SPECIFICATIONS", [
    'NUMBER   [0-9]+',
    'IDENT    [A-Za-z_][A-Za-z0-9_]*',
    'STRING   "[^"]*"',
    'LE       <=          WHILE   while',
  ], 10.5);

  s.addShape(pres.ShapeType.line, {
    x: 2.7, y: 3.05, w: 0, h: 0.3,
    line: { color: COPPER, width: 1.5, endArrowType: "triangle" } });
  s.addText("combine with |,  annotate positions,  compute followpos", {
    x: 0.55, y: 3.3, w: 4.35, h: 0.28, fontSize: 10, italic: true, color: MUTED,
    fontFace: BODY, align: "center", margin: 0 });

  codePanel(s, 0.55, 3.6, 4.35, 1.3, "followpos, THE HEART OF THE METHOD", [
    "pos 1  a   ->  {1, 2, 3}",
    "pos 2  b   ->  {1, 2, 3}",
    "pos 3  a   ->  {4}",
  ], 10.5);

  card(s, 5.2, 1.55, 4.25, 3.35, PANEL);
  s.addText("Measured on the real scanner", {
    x: 5.45, y: 1.7, w: 3.8, h: 0.32, fontSize: 13, bold: true, fontFace: HEAD,
    color: INK, margin: 0 });
  stat(s, 5.45, 2.1, 1.8, "41", "token patterns");
  stat(s, 7.5, 2.1, 1.8, "147", "leaf positions");
  stat(s, 5.45, 3.1, 1.8, "92", "DFA states");
  stat(s, 7.5, 3.1, 1.8, "37", "symbol classes");
  s.addText(
    "A state of the DFA is nothing more exotic than a set of positions in that " +
    "tree. Equivalent states are then merged by partition refinement, and the " +
    "scanner takes the longest match - which is why 'letter' is one identifier " +
    "and not the keyword 'let' followed by 'ter'.",
    { x: 5.45, y: 4.0, w: 3.8, h: 0.85, fontSize: 10.5, color: MUTED,
      fontFace: BODY, margin: 0, lineSpacing: 13 });
  s.addNotes(
    "The claim to make loudly: Python's own regular-expression library is never " +
    "imported. We parse the regular expressions ourselves, build the syntax tree, " +
    "compute nullable / firstpos / lastpos / followpos, and construct the DFA " +
    "directly by subset construction over positions - the method from Module 1, " +
    "not a library call. If asked why 92 states for 41 patterns: the keywords " +
    "share prefixes, so the automaton is far smaller than 41 separate machines.");
}

// ============================================================ 6 parsing
{
  const s = base(false);
  head(s, 2, "Parsing: one grammar, four parsers",
       "58 productions. SLR, CLR and LALR tables are all built and compared.",
       false);

  s.addChart(pres.ChartType.bar, [{
    name: "States in the parse table",
    labels: ["SLR", "CLR", "LALR"],
    values: [116, 478, 116],
  }], {
    x: 0.5, y: 1.5, w: 4.7, h: 3.35,
    barDir: "col", chartColors: [COPPER, "8A98A2", TEAL],
    varyColors: true, showTitle: true, title: "Table size for the Nova grammar",
    titleFontSize: 12, titleColor: INK, titleFontFace: BODY,
    showValue: true, dataLabelPosition: "outEnd", dataLabelFontSize: 12,
    dataLabelColor: INK, dataLabelFontFace: BODY,
    showLegend: false, catAxisLabelColor: MUTED, valAxisLabelColor: MUTED,
    catAxisLabelFontSize: 12, valAxisLabelFontSize: 9,
    valGridLine: { color: "E2E8EC", size: 1 }, catGridLine: { style: "none" },
    valAxisMaxVal: 560, barGapWidthPct: 90,
  });

  card(s, 5.45, 1.5, 4.0, 1.55, "E8F2EF");
  s.addText("The result the textbook promises", {
    x: 5.68, y: 1.62, w: 3.55, h: 0.3, fontSize: 12.5, bold: true, fontFace: HEAD,
    color: TEAL, margin: 0 });
  s.addText(
    "LALR has the same 116 states as SLR and the same power as CLR, at a quarter " +
    "of CLR's size. All three accept our grammar with zero conflicts. That is " +
    "exactly why every real parser generator emits LALR - and here it is measured, " +
    "not asserted.",
    { x: 5.68, y: 1.95, w: 3.55, h: 1.05, fontSize: 10.5, color: INK,
      fontFace: BODY, margin: 0, lineSpacing: 13 });

  card(s, 5.45, 3.2, 4.0, 1.65, PANEL);
  s.addText("Two parsers, cross-checked", {
    x: 5.68, y: 3.32, w: 3.55, h: 0.3, fontSize: 12.5, bold: true, fontFace: HEAD,
    color: INK, margin: 0 });
  bullets(s, 5.68, 3.65, 3.55, 1.1, [
    "A hand-written recursive-descent parser builds the tree the compiler uses",
    "The LALR tables re-parse the same tokens independently - 297 steps, animated",
    "If they ever disagreed, one of them would be wrong",
  ], 10.5, MUTED);
  s.addNotes(
    "Two points. First, the comparison is the whole lesson of Module 2 made " +
    "concrete - CLR blows up to 478 states and buys nothing on this grammar. " +
    "Second, we did not choose between top-down and bottom-up; we implemented " +
    "both, on one grammar, and use each to check the other. The parse animation " +
    "in the viewer shows stack, symbols, remaining input and action for all 297 " +
    "steps.");
}

// ============================================================ 7 ambiguity
{
  const s = base(false);
  head(s, 2, "When a grammar fights back",
       "The tool does not just report a conflict - it explains it.", false);

  codePanel(s, 0.55, 1.5, 4.35, 1.5, "AMBIGUOUS: NO PRECEDENCE, NO ASSOCIATIVITY", [
    "expr -> expr + expr",
    "      | expr * expr",
    "      | ( expr )",
    "      | id",
  ], 11);
  card(s, 0.55, 3.15, 4.35, 1.7, "F7EAE3");
  s.addText("4 shift / reduce conflicts", {
    x: 0.78, y: 3.28, w: 3.9, h: 0.32, fontSize: 13, bold: true, fontFace: HEAD,
    color: COPPER, margin: 0 });
  s.addText(
    "\"In this state the parser has already seen expr + expr and the next symbol " +
    "is *. It can reduce, giving (a+b)*c, or shift, giving a+(b*c). The grammar " +
    "does not say which.\"",
    { x: 0.78, y: 3.62, w: 3.9, h: 1.1, fontSize: 10.5, italic: true, color: INK,
      fontFace: BODY, margin: 0, lineSpacing: 13 });

  codePanel(s, 5.1, 1.5, 4.35, 1.5, "UNAMBIGUOUS: PRECEDENCE IN THE SHAPE", [
    "expr -> expr + term | term",
    "term -> term * fact | fact",
    "fact -> ( expr ) | id",
  ], 11);
  card(s, 5.1, 3.15, 4.35, 1.7, "E8F2EF");
  s.addText("0 conflicts", {
    x: 5.33, y: 3.28, w: 3.9, h: 0.32, fontSize: 13, bold: true, fontFace: HEAD,
    color: TEAL, margin: 0 });
  s.addText(
    "The precedence is now built into the levels of the grammar itself, so the " +
    "parser never has a choice to make. The same tool also removes left recursion " +
    "and left-factors a grammar on demand, and re-checks the LL(1) table " +
    "afterwards.",
    { x: 5.33, y: 3.62, w: 3.9, h: 1.1, fontSize: 10.5, color: INK,
      fontFace: BODY, margin: 0, lineSpacing: 13 });
  s.addNotes(
    "This is the slide that shows we understand conflicts rather than just avoid " +
    "them. Demonstrate live if there is time: the viewer prints the state number, " +
    "the lookahead, and a sentence in English explaining what the parser could not " +
    "decide. Mention that our own grammar is left-recursive on purpose - left " +
    "recursion gives natural left associativity, and it is precisely what a " +
    "bottom-up parser handles and a top-down one cannot.");
}

// ============================================================ 8 semantics
{
  const s = base(false);
  head(s, 3, "Semantic analysis as a syntax-directed definition",
       "Attributes flow down the tree and values flow back up - one pass, L-attributed.",
       false);

  card(s, 0.55, 1.5, 5.15, 3.35, PANEL);
  const nodes = [
    ["let  total = fib(i) + 1", 1.0, 1.75, 3.3],
    ["fib(i) + 1", 1.55, 2.5, 2.4],
    ["fib(i)", 1.1, 3.25, 1.5],
    ["1", 3.15, 3.25, 0.9],
  ];
  nodes.forEach((n) => {
    s.addShape(pres.ShapeType.roundRect, {
      x: n[1], y: n[2], w: n[3], h: 0.5, rectRadius: 0.06, fill: { color: WHITE },
      line: { color: "C3D0D8", width: 1 },
    });
    s.addText(n[0], { x: n[1], y: n[2], w: n[3], h: 0.5, fontSize: 10.5,
      fontFace: MONO, color: INK, align: "center", valign: "middle", margin: 0 });
  });
  s.addShape(pres.ShapeType.line, { x: 2.2, y: 2.25, w: 0.35, h: 0.25,
    line: { color: "9FB0BC", width: 1 } });
  s.addShape(pres.ShapeType.line, { x: 2.1, y: 3.0, w: -0.3, h: 0.25,
    line: { color: "9FB0BC", width: 1 } });
  s.addShape(pres.ShapeType.line, { x: 3.2, y: 3.0, w: 0.35, h: 0.25,
    line: { color: "9FB0BC", width: 1 } });

  s.addShape(pres.ShapeType.line, {
    x: 0.85, y: 2.0, w: 0, h: 1.6,
    line: { color: COPPER, width: 2, endArrowType: "triangle" } });
  s.addText("inherited\nscope, depth,\nexpected type", {
    x: 0.6, y: 3.9, w: 1.35, h: 0.75, fontSize: 9.5, color: COPPER, fontFace: BODY,
    align: "center", margin: 0, lineSpacing: 11 });
  s.addShape(pres.ShapeType.line, {
    x: 5.35, y: 3.6, w: 0, h: -1.6,
    line: { color: TEAL, width: 2, endArrowType: "triangle" } });
  s.addText("synthesised\nthe type of\nthe expression", {
    x: 4.3, y: 3.9, w: 1.35, h: 0.75, fontSize: 9.5, color: TEAL, fontFace: BODY,
    align: "center", margin: 0, lineSpacing: 11 });

  card(s, 6.0, 1.5, 3.45, 1.55, "E8F2EF");
  s.addText("Why one pass is enough", {
    x: 6.22, y: 1.62, w: 3.0, h: 0.3, fontSize: 12.5, bold: true, fontFace: HEAD,
    color: TEAL, margin: 0 });
  s.addText(
    "No attribute ever needs a value from a sibling to its right, so the " +
    "definition is L-attributed and a single left-to-right walk computes " +
    "everything.",
    { x: 6.22, y: 1.95, w: 3.0, h: 1.0, fontSize: 10.5, color: INK, fontFace: BODY,
      margin: 0, lineSpacing: 13 });

  codePanel(s, 6.0, 3.2, 3.45, 1.65, "WHAT IT CATCHES", [
    '"text" * 4',
    "  -> * cannot be applied",
    "     to str and int",
    "",
    "print undeclared",
    "  -> used before declared",
  ], 10);
  s.addNotes(
    "Explain the two arrows and nothing else - that is the whole idea of an SDD. " +
    "Inherited attributes are what the context tells the node (which scope you are " +
    "in, how deep, what type is expected); synthesised attributes are what the " +
    "node tells its parent (the type it produced). Our viewer logs every one of " +
    "these events, so you can read the attribute flow production by production. " +
    "The symbol table it builds is also what assigns each variable its slot in the " +
    "activation record later on.");
}

// ============================================================ 9 IR
{
  const s = base(false);
  head(s, 4, "Intermediate code, and the backpatching problem",
       "When the jump is emitted, nobody yet knows where it goes.", false);

  codePanel(s, 0.55, 1.5, 4.35, 1.75, "AS EMITTED - TARGETS UNKNOWN", [
    "if i < 10 goto ____",
    "goto ____",
    "total = total + t0",
    "i = i + 1",
    "goto L0",
  ], 11);
  s.addText("truelist = {0}    falselist = {1}", {
    x: 0.55, y: 3.3, w: 4.35, h: 0.3, fontSize: 10.5, fontFace: MONO,
    color: COPPER, align: "center", margin: 0 });

  s.addShape(pres.ShapeType.line, {
    x: 5.0, y: 2.3, w: 0.35, h: 0,
    line: { color: COPPER, width: 2, endArrowType: "triangle" } });

  codePanel(s, 5.45, 1.5, 4.0, 1.75, "AFTER BACKPATCHING", [
    "L0: if i < 10 goto L1",
    "    goto L2",
    "L1: total = total + t0",
    "    i = i + 1",
    "    goto L0",
  ], 11);

  card(s, 0.55, 3.75, 4.35, 1.1, PANEL);
  s.addText("Short-circuit code, for free", {
    x: 0.78, y: 3.85, w: 3.9, h: 0.28, fontSize: 12, bold: true, fontFace: HEAD,
    color: INK, margin: 0 });
  s.addText(
    "Booleans are compiled as jumps rather than values, so 'n > 0 and 100 / n > 1' " +
    "never divides by zero. There is a test for exactly that.",
    { x: 0.78, y: 4.15, w: 3.9, h: 0.6, fontSize: 10.5, color: MUTED,
      fontFace: BODY, margin: 0, lineSpacing: 13 });

  card(s, 5.45, 3.75, 4.0, 1.1, "E8F2EF");
  s.addText("case -> jump table", {
    x: 5.68, y: 3.85, w: 3.55, h: 0.28, fontSize: 12, bold: true, fontFace: HEAD,
    color: TEAL, margin: 0 });
  s.addText(
    "jumptable total [0 -> L3, 88 -> L4] default L5 - one dispatch, not a chain " +
    "of comparisons. 6 backpatches in this program alone.",
    { x: 5.68, y: 4.15, w: 3.55, h: 0.6, fontSize: 10.5, color: INK,
      fontFace: BODY, margin: 0, lineSpacing: 13 });
  s.addNotes(
    "Backpatching is the neatest idea in Module 4 and it is easy to show: you " +
    "cannot know where 'if' jumps to until you have read the body that follows " +
    "it, so you emit the jump with a hole, remember the hole in a list, and fill " +
    "it in when you arrive at the destination. makelist, merge and backpatch. Our " +
    "compiler logs every single patch it performs, and a test asserts that no " +
    "unpatched jump survives to the next phase.");
}

// ============================================================ 10 optimiser
{
  const s = base(false);
  head(s, 5, "Optimisation: eight passes over a flow graph",
       "Instructions are cut into basic blocks; every pass reports what it removed.",
       false);

  const rows = [
    ["Local value numbering / DAG", "1 sub-expression reused, 1 constant folded"],
    ["Constant + copy propagation", "operands replaced by what they must equal"],
    ["Loop-invariant code motion", "width * height hoisted out of the loop"],
    ["Strength reduction", "i * 8 becomes an addition of 8 per iteration"],
    ["Dead-code elimination", "3 instructions whose result nobody reads"],
    ["Unreachable code + jumps", "blocks no path reaches, jumps to jumps"],
  ];
  rows.forEach((r, i) => {
    const y = 1.5 + i * 0.56;
    s.addShape(pres.ShapeType.roundRect, {
      x: 0.55, y, w: 5.6, h: 0.48, rectRadius: 0.06, fill: { color: PANEL },
    });
    s.addShape(pres.ShapeType.ellipse, {
      x: 0.68, y: y + 0.14, w: 0.2, h: 0.2, fill: { color: COPPER } });
    s.addText(r[0], { x: 1.0, y, w: 2.5, h: 0.48, fontSize: 11, bold: true,
      color: INK, fontFace: BODY, valign: "middle", margin: 0 });
    s.addText(r[1], { x: 3.5, y, w: 2.55, h: 0.48, fontSize: 9.5, color: MUTED,
      fontFace: BODY, valign: "middle", margin: 0 });
  });

  card(s, 6.5, 1.5, 2.95, 1.6, "E8F2EF");
  s.addText("Instructions executed", {
    x: 6.7, y: 1.6, w: 2.6, h: 0.28, fontSize: 11, bold: true, fontFace: BODY,
    color: TEAL, margin: 0 });
  s.addText("188", { x: 6.7, y: 1.9, w: 1.2, h: 0.55, fontSize: 30, bold: true,
    fontFace: HEAD, color: MUTED, margin: 0 });
  s.addText("148", { x: 8.1, y: 1.9, w: 1.2, h: 0.55, fontSize: 30, bold: true,
    fontFace: HEAD, color: TEAL, margin: 0 });
  s.addText("before                after", {
    x: 6.7, y: 2.45, w: 2.6, h: 0.25, fontSize: 9.5, color: MUTED, fontFace: BODY,
    margin: 0 });
  s.addText("21% less work at run time", {
    x: 6.7, y: 2.7, w: 2.6, h: 0.28, fontSize: 10.5, bold: true, color: TEAL,
    fontFace: BODY, margin: 0 });

  card(s, 6.5, 3.25, 2.95, 1.6, PANEL);
  s.addText("Nothing is taken on trust", {
    x: 6.7, y: 3.35, w: 2.6, h: 0.28, fontSize: 11, bold: true, fontFace: BODY,
    color: INK, margin: 0 });
  s.addText(
    "Every example is run before and after optimisation, and by a second, " +
    "completely separate back-end. All three outputs must match, or the test " +
    "suite fails.",
    { x: 6.7, y: 3.65, w: 2.6, h: 1.05, fontSize: 10, color: MUTED, fontFace: BODY,
      margin: 0, lineSpacing: 12.5 });
  s.addNotes(
    "Do not read the list - point at two entries. Loop-invariant code motion: the " +
    "multiplication does not change between iterations, so it is computed once " +
    "before the loop instead of five times inside it. Strength reduction: i times " +
    "eight is replaced by adding eight each time round, because addition is " +
    "cheaper than multiplication. The honest number here is the run-time one: 188 " +
    "instructions executed becomes 148.");
}

// ============================================================ 11 data flow
{
  const s = base(false);
  head(s, 5, "How the optimiser knows what is safe",
       "Four data-flow analyses, each iterated to a fixed point.", false);

  const an = [
    ["Reaching definitions", "forward, union",
     "Which assignment could have produced the value in this variable?", COPPER],
    ["Live variables", "backward, union",
     "Will anybody read this value again? If not, the instruction is dead.", TEAL],
    ["Available expressions", "forward, intersection",
     "Has this expression already been computed on every path here?", COPPER],
    ["Very busy expressions", "backward, intersection",
     "Will this be needed on every path from here? Then compute it once.", TEAL],
  ];
  an.forEach((a, i) => {
    const x = 0.55 + (i % 2) * 4.7;
    const y = 1.5 + Math.floor(i / 2) * 1.72;
    card(s, x, y, 4.35, 1.5, PANEL);
    s.addShape(pres.ShapeType.ellipse, {
      x: x + 0.22, y: y + 0.22, w: 0.34, h: 0.34, fill: { color: a[3] } });
    s.addText(String(i + 1), { x: x + 0.22, y: y + 0.22, w: 0.34, h: 0.34,
      fontSize: 12, bold: true, color: WHITE, align: "center", valign: "middle",
      fontFace: HEAD, margin: 0 });
    s.addText(a[0], { x: x + 0.68, y: y + 0.2, w: 2.6, h: 0.3, fontSize: 13,
      bold: true, fontFace: HEAD, color: INK, margin: 0, valign: "middle" });
    s.addText(a[1], { x: x + 0.68, y: y + 0.48, w: 3.4, h: 0.25, fontSize: 9.5,
      italic: true, color: a[3], fontFace: BODY, margin: 0 });
    s.addText(a[2], { x: x + 0.28, y: y + 0.78, w: 3.85, h: 0.6, fontSize: 10.5,
      color: MUTED, fontFace: BODY, margin: 0, lineSpacing: 13 });
  });

  s.addText(
    "Each one starts from a guess and applies its transfer function round after " +
    "round until nothing changes. The viewer shows every round, so you can watch " +
    "the sets stop moving.",
    { x: 0.55, y: 4.92, w: 8.3, h: 0.4, fontSize: 11, italic: true, color: MUTED,
      fontFace: BODY, align: "center", margin: 0 });
  s.addNotes(
    "The one sentence that makes data flow click for an audience: these are four " +
    "questions you must be able to answer before you are allowed to change any " +
    "code, and each is answered by going round the flow graph until the answer " +
    "stops changing. Note the symmetry on the slide - forward/backward crossed " +
    "with union/intersection gives exactly these four analyses.");
}

// ============================================================ 12 code gen
{
  const s = base(false);
  head(s, 6, "Code generation: four registers, and a decision every instruction",
       "Next-use information decides what stays in a register and what gets spilled.",
       false);

  codePanel(s, 0.55, 1.55, 4.5, 1.85, "TARGET CODE, WITH THE REASONING KEPT", [
    "LD   R0, [fp+1]     ; load i",
    "LDI  R1, #10        ; literal 10",
    "JLT  R0, R1, 8      ; conditional jump",
    "PARAM R0            ; argument i",
    "CALL fib, 1         ; push a frame",
    "ST   [fp+2], R0     ; t0 = result",
  ], 10);
  s.addText(
    "When every register is full, the value needed furthest in the future is the " +
    "one written back to memory - Belady's rule, applied to registers.",
    { x: 0.55, y: 3.5, w: 4.5, h: 0.6, fontSize: 10.5, color: MUTED,
      fontFace: BODY, margin: 0, lineSpacing: 13 });

  card(s, 5.35, 1.55, 4.1, 3.3, PANEL);
  s.addText("One activation record", {
    x: 5.58, y: 1.66, w: 3.6, h: 0.3, fontSize: 13, bold: true, fontFace: HEAD,
    color: INK, margin: 0 });
  const frame = [
    ["+0", "return address", "where to resume"],
    ["+1", "control link", "the caller's frame"],
    ["+2", "parameter n", "passed by the caller"],
    ["+3", "local total", "this call's own copy"],
    ["+4", "temporary t0", "the compiler's scratch"],
  ];
  frame.forEach((f, i) => {
    const y = 2.05 + i * 0.5;
    s.addShape(pres.ShapeType.roundRect, {
      x: 5.58, y, w: 3.6, h: 0.42, rectRadius: 0.05,
      fill: { color: i < 2 ? "DCE6EB" : WHITE },
      line: { color: "C3D0D8", width: 1 },
    });
    s.addText(f[0], { x: 5.66, y, w: 0.4, h: 0.42, fontSize: 9.5, fontFace: MONO,
      color: COPPER, valign: "middle", margin: 0 });
    s.addText(f[1], { x: 6.1, y, w: 1.5, h: 0.42, fontSize: 10.5, bold: true,
      color: INK, fontFace: BODY, valign: "middle", margin: 0 });
    s.addText(f[2], { x: 7.6, y, w: 1.5, h: 0.42, fontSize: 9, color: MUTED,
      fontFace: BODY, valign: "middle", margin: 0 });
  });
  s.addText(
    "Recursion works because each call gets its own copy of this. At the bottom " +
    "of fib(9) there are ten of them stacked up.",
    { x: 5.58, y: 4.5, w: 3.6, h: 0.35, fontSize: 10, italic: true, color: MUTED,
      fontFace: BODY, margin: 0, lineSpacing: 12 });
  s.addNotes(
    "Two ideas here. Next-use: before generating code for an instruction we work " +
    "out, for every value, how far away the next instruction that reads it is - " +
    "and when we run out of registers we evict the one needed furthest away. " +
    "Activation records: the diagram on the right is what a function call " +
    "actually pushes, and it is why recursion works at all. The viewer shows the " +
    "register and address descriptors changing instruction by instruction.");
}

// ============================================================ 13 SSA
{
  const s = base(false);
  head(s, 7, "SSA: every variable written exactly once",
       "So a use has exactly one definition - and optimisation gets much easier.",
       false);

  codePanel(s, 0.55, 1.55, 4.0, 1.5, "BEFORE", [
    "i = 0",
    "loop:",
    "  i = i + 1",
    "  if i < 5 goto loop",
  ], 11);
  codePanel(s, 0.55, 3.25, 4.0, 1.6, "AFTER", [
    "i1 = 0",
    "loop:",
    "  i2 = phi(i1, i3)",
    "  i3 = i2 + 1",
    "  if i3 < 5 goto loop",
  ], 11);

  card(s, 4.9, 1.55, 4.55, 1.55, "E8F2EF");
  s.addText("What is a phi function?", {
    x: 5.12, y: 1.67, w: 4.1, h: 0.3, fontSize: 13, bold: true, fontFace: HEAD,
    color: TEAL, margin: 0 });
  s.addText(
    "Where two paths meet, the value of i depends on which path you came in on. " +
    "phi(i1, i3) says exactly that: take i1 if you arrived from the entry, i3 if " +
    "you came round the loop.",
    { x: 5.12, y: 2.0, w: 4.1, h: 1.0, fontSize: 11, color: INK, fontFace: BODY,
      margin: 0, lineSpacing: 13.5 });

  card(s, 4.9, 3.25, 4.55, 1.6, PANEL);
  s.addText("Where do they go? The dominance frontier.", {
    x: 5.12, y: 3.37, w: 4.1, h: 0.3, fontSize: 12.5, bold: true, fontFace: HEAD,
    color: INK, margin: 0 });
  s.addText(
    "A block dominates another if every path to it passes through the first. The " +
    "dominance frontier is the boundary where a definition stops being the only " +
    "possibility - and that is precisely where a phi function is needed. We " +
    "compute the frontiers, insert 3 phi functions for this program, then rename.",
    { x: 5.12, y: 3.7, w: 4.1, h: 1.05, fontSize: 10.5, color: MUTED,
      fontFace: BODY, margin: 0, lineSpacing: 13 });
  s.addNotes(
    "SSA is the form every modern compiler uses internally - LLVM, GCC, the JVM's " +
    "JIT. The reason is on this slide: once each name is written once, 'where did " +
    "this value come from' has exactly one answer, and analyses that needed a " +
    "whole data-flow pass become a single pointer lookup. Phi is not an " +
    "instruction the machine runs; it is a note about which path you took.");
}

// ============================================================ 14 parallel
{
  const s = base(false);
  head(s, 7, "Which loops could run in parallel?",
       "Three loops that look almost identical. Only one of them is sequential.",
       false);

  const loops = [
    ["a = i * 2;", "VECTORISABLE", TEAL,
     "Nothing written in one iteration is read by the next. Every iteration could " +
     "run at the same time, on different cores or in one vector instruction."],
    ["b = b + i;", "A REDUCTION", COPPER,
     "Iterations do depend on each other - but only through an accumulator, and " +
     "addition is associative. Split the range, add the partial sums."],
    ["c = c * 3 - i;", "SEQUENTIAL", "A11C1C",
     "Each iteration needs the value the previous one produced, and the operation " +
     "is not associative. No amount of hardware makes this faster."],
  ];
  loops.forEach((l, i) => {
    const x = 0.55 + i * 3.05;
    card(s, x, 1.5, 2.8, 3.35, PANEL);
    s.addShape(pres.ShapeType.roundRect, {
      x: x + 0.2, y: 1.68, w: 2.4, h: 0.5, rectRadius: 0.06, fill: { color: INK } });
    s.addText(l[0], { x: x + 0.2, y: 1.68, w: 2.4, h: 0.5, fontSize: 11.5,
      fontFace: MONO, color: CODE, align: "center", valign: "middle", margin: 0 });
    s.addText(l[1], { x: x + 0.2, y: 2.35, w: 2.4, h: 0.35, fontSize: 13,
      bold: true, fontFace: HEAD, color: l[2], align: "center", margin: 0 });
    s.addText(l[3], { x: x + 0.25, y: 2.8, w: 2.3, h: 1.9, fontSize: 10.5,
      color: MUTED, fontFace: BODY, margin: 0, lineSpacing: 13.5 });
  });
  s.addNotes(
    "This is the Module 7 slide and it is the one non-programmers enjoy most. The " +
    "three loops differ by a couple of characters and have completely different " +
    "answers. The compiler decides by asking one question: does any iteration read " +
    "something a previous iteration wrote? If no, it is parallel. If yes but the " +
    "operation is an associative accumulation, it is a reduction and can still be " +
    "split. Otherwise it is genuinely sequential. This is the analysis behind " +
    "auto-vectorisation in real compilers.");
}

// ============================================================ 15 verifier
{
  const s = base(true);
  head(s, 8, "We do not trust our own output", null, true);
  s.addText(
    "Before a single instruction runs, the verifier walks the bytecode with types " +
    "instead of values and proves it cannot misbehave. Then we attacked it.",
    { x: 1.22, y: 0.88, w: 8.2, h: 0.4, fontSize: 13.5, italic: true,
      color: "9FBACB", fontFace: BODY, margin: 0 });

  const attacks = [
    "Jump outside the code", "Operand-stack underflow",
    "Inconsistent stack at a merge", "Type confusion: string x int",
    "Uninitialised local read", "Escape from the activation record",
    "Infinite loop", "Runaway recursion",
  ];
  attacks.forEach((a, i) => {
    const x = 0.55 + (i % 2) * 3.35;
    const y = 1.5 + Math.floor(i / 2) * 0.62;
    s.addShape(pres.ShapeType.roundRect, {
      x, y, w: 3.15, h: 0.5, rectRadius: 0.06, fill: { color: INK2 } });
    s.addShape(pres.ShapeType.ellipse, {
      x: x + 0.15, y: y + 0.15, w: 0.2, h: 0.2, fill: { color: TEAL } });
    s.addText(a, { x: x + 0.45, y, w: 2.6, h: 0.5, fontSize: 10.5, color: CODE,
      fontFace: BODY, valign: "middle", margin: 0 });
  });

  s.addShape(pres.ShapeType.roundRect, {
    x: 7.3, y: 1.5, w: 2.15, h: 2.36, rectRadius: 0.08, fill: { color: TEAL } });
  s.addText("8/8", { x: 7.3, y: 1.75, w: 2.15, h: 1.0, fontSize: 54, bold: true,
    fontFace: HEAD, color: WHITE, align: "center", margin: 0 });
  s.addText("hostile programs\nstopped", {
    x: 7.3, y: 2.75, w: 2.15, h: 0.7, fontSize: 12, color: "D6F0E7",
    align: "center", fontFace: BODY, margin: 0, lineSpacing: 15 });

  codePanel(s, 0.55, 4.0, 8.9, 0.95, null, [
    "main[0] LOAD: slot 40 is outside the activation record (0..1)",
    "main[2] MUL : arithmetic on a string value",
  ], 11);
  s.addNotes(
    "This is the slide to slow down on, because it is the part no standard course " +
    "project has. A verifier nobody ever defeats is indistinguishable from one " +
    "that does nothing, so we wrote eight bytecode programs by hand that no honest " +
    "compiler would ever emit - the kind of thing an attacker hands a virtual " +
    "machine directly. Six are caught statically, before anything runs. The last " +
    "two are perfectly type-safe and simply never stop, which nothing static can " +
    "detect - those are caught by the sandbox at run time. That split is exactly " +
    "how Java, WebAssembly and the Linux kernel's eBPF verifier work.");
}

// ============================================================ 16 two layers
{
  const s = base(false);
  head(s, null, "Two layers, because one is not enough",
       "The same division of labour as the JVM, WebAssembly and eBPF.", false);

  card(s, 0.55, 1.5, 4.35, 3.35, PANEL);
  s.addShape(pres.ShapeType.ellipse, {
    x: 0.8, y: 1.72, w: 0.42, h: 0.42, fill: { color: COPPER } });
  s.addText("A", { x: 0.8, y: 1.72, w: 0.42, h: 0.42, fontSize: 15, bold: true,
    color: WHITE, align: "center", valign: "middle", fontFace: HEAD, margin: 0 });
  s.addText("Static verification", {
    x: 1.35, y: 1.72, w: 3.2, h: 0.42, fontSize: 15, bold: true, fontFace: HEAD,
    color: INK, valign: "middle", margin: 0 });
  s.addText("Before anything runs", {
    x: 1.35, y: 2.12, w: 3.2, h: 0.25, fontSize: 10, italic: true, color: COPPER,
    fontFace: BODY, margin: 0 });
  bullets(s, 0.85, 2.5, 3.75, 2.2, [
    "Walks the code with types in place of values",
    "Proves the stack depth is the same on every path to every instruction",
    "Proves every jump lands on a real instruction",
    "Proves no variable is read before it is written",
    "Proves no access escapes the activation record",
    "Cost: milliseconds, paid once",
  ], 10.5, MUTED);

  card(s, 5.1, 1.5, 4.35, 3.35, "E8F2EF");
  s.addShape(pres.ShapeType.ellipse, {
    x: 5.35, y: 1.72, w: 0.42, h: 0.42, fill: { color: TEAL } });
  s.addText("B", { x: 5.35, y: 1.72, w: 0.42, h: 0.42, fontSize: 15, bold: true,
    color: WHITE, align: "center", valign: "middle", fontFace: HEAD, margin: 0 });
  s.addText("The sandbox", {
    x: 5.9, y: 1.72, w: 3.2, h: 0.42, fontSize: 15, bold: true, fontFace: HEAD,
    color: INK, valign: "middle", margin: 0 });
  s.addText("While it runs", {
    x: 5.9, y: 2.12, w: 3.2, h: 0.25, fontSize: 10, italic: true, color: TEAL,
    fontFace: BODY, margin: 0 });
  bullets(s, 5.4, 2.5, 3.75, 2.2, [
    "Caps the number of instructions executed",
    "Caps how deep the call stack may grow",
    "Caps the operand stack",
    "Catches what no static analysis can: does this program ever stop?",
    "Reports a policy violation instead of hanging or crashing",
    "Cost: one comparison per instruction",
  ], 10.5, INK);
  s.addNotes(
    "The reason there are two layers is a genuine theoretical limit, not laziness: " +
    "whether a program halts is undecidable, so no amount of static checking can " +
    "prove termination. Static verification gets you everything that is decidable " +
    "and costs nothing at run time; the sandbox catches the rest with a budget. " +
    "If someone asks for the real-world parallel - this is exactly why a browser " +
    "can run untrusted WebAssembly from a random website without asking you.");
}

// ============================================================ 17 correctness
{
  const s = base(false);
  head(s, null, "How do we know any of it is correct?",
       "Because a compiler that produces the wrong answer quickly is worthless.",
       false);

  card(s, 0.55, 1.45, 5.6, 1.75, PANEL);
  s.addText("Every program is run three ways", {
    x: 0.8, y: 1.57, w: 5.1, h: 0.3, fontSize: 13.5, bold: true, fontFace: HEAD,
    color: INK, margin: 0 });
  const ways = ["unoptimised\nbytecode", "optimised\nbytecode", "the register\nmachine"];
  ways.forEach((w, i) => {
    const x = 0.85 + i * 1.8;
    s.addShape(pres.ShapeType.roundRect, {
      x, y: 1.95, w: 1.6, h: 0.72, rectRadius: 0.06, fill: { color: WHITE },
      line: { color: "C3D0D8", width: 1 } });
    s.addText(w, { x, y: 1.95, w: 1.6, h: 0.72, fontSize: 10, color: INK,
      align: "center", valign: "middle", fontFace: BODY, margin: 0,
      lineSpacing: 12 });
    if (i < 2) {
      s.addText("=", { x: x + 1.6, y: 1.95, w: 0.2, h: 0.72, fontSize: 16,
        bold: true, color: COPPER, align: "center", valign: "middle", margin: 0 });
    }
  });
  s.addText(
    "All three must print exactly the same thing, on every example, every time.",
    { x: 0.85, y: 2.75, w: 5.1, h: 0.3, fontSize: 10.5, italic: true, color: MUTED,
      fontFace: BODY, margin: 0 });

  card(s, 0.55, 3.35, 5.6, 1.5, "F7EAE3");
  s.addText("It caught a real bug", {
    x: 0.8, y: 3.47, w: 5.1, h: 0.3, fontSize: 13.5, bold: true, fontFace: HEAD,
    color: COPPER, margin: 0 });
  s.addText(
    "Copy propagation was replacing t with b inside Euclid's algorithm - but b is " +
    "reassigned on the very next line, so the copy had already been killed. gcd " +
    "returned 0. The fix was to compute available copies properly, as a data-flow " +
    "analysis. The three-way check is what exposed it.",
    { x: 0.8, y: 3.78, w: 5.15, h: 1.0, fontSize: 10.5, color: INK, fontFace: BODY,
      margin: 0, lineSpacing: 13 });

  card(s, 6.4, 1.45, 3.05, 3.4, "E8F2EF");
  s.addText("Self-tests", { x: 6.62, y: 1.58, w: 2.6, h: 0.3, fontSize: 13,
    bold: true, fontFace: HEAD, color: TEAL, margin: 0 });
  s.addText("26", { x: 6.62, y: 1.9, w: 2.6, h: 0.85, fontSize: 52, bold: true,
    fontFace: HEAD, color: TEAL, margin: 0 });
  s.addText("passing, 0 failing", { x: 6.62, y: 2.72, w: 2.6, h: 0.3,
    fontSize: 11, color: MUTED, fontFace: BODY, margin: 0 });
  bullets(s, 6.62, 3.1, 2.7, 1.6, [
    "(a|b)*abb really has 4 states",
    "the ambiguous grammar really conflicts",
    "no unpatched jump survives",
    "every attack is still blocked",
  ], 10, INK);
  s.addNotes(
    "If you take one slide seriously, take this one. Anyone can write something " +
    "that produces plausible-looking assembly. The question is how you would ever " +
    "know it is right. Our answer: build two independent back-ends and make them " +
    "agree, run everything with and without optimisation and make those agree, and " +
    "assert the textbook results the phases are supposed to produce. The gcd bug " +
    "is worth telling as a story - it is a classic mistake, it is subtle, and the " +
    "test suite found it rather than a person.");
}

// ============================================================ 18 the viewer
{
  const s = base(false);
  head(s, null, "The Glass-Box viewer",
       "One tab per phase. Double-click run.bat - there is nothing to install.",
       false);

  s.addShape(pres.ShapeType.roundRect, {
    x: 0.55, y: 1.45, w: 8.9, h: 3.4, rectRadius: 0.08, fill: { color: PANEL },
    shadow: shadow() });
  const tabs = ["Source", "Tokens", "DFA", "Grammar", "LR tables", "Parse",
                "Symbols", "TAC", "Flow graph", "Optimiser", "Data flow",
                "Target", "SSA", "Bytecode", "Verifier", "Run"];
  tabs.forEach((t, i) => {
    const x = 0.7 + (i % 8) * 1.09;
    const y = 1.6 + Math.floor(i / 8) * 0.42;
    const on = i === 9;
    s.addShape(pres.ShapeType.roundRect, {
      x, y, w: 1.0, h: 0.34, rectRadius: 0.05,
      fill: { color: on ? COPPER : "DCE6EB" } });
    s.addText(t, { x, y, w: 1.0, h: 0.34, fontSize: 8.5,
      color: on ? WHITE : MUTED, bold: on, align: "center", valign: "middle",
      fontFace: BODY, margin: 0 });
  });
  codePanel(s, 0.7, 2.5, 8.6, 2.2, "OPTIMISER TAB - WHAT YOU ACTUALLY SEE", [
    "pass                              before  after  removed  what it did",
    "Local value numbering / DAG           20     20        0  1 sub-expression reused, 1 constant folded",
    "Loop-invariant code motion            20     20        0  hoisted 'area = width * height' out of B1",
    "Strength reduction                    20     21       -1  'scaled = i * 8' -> an addition of 8 per pass",
    "Dead-code elimination                 21     18        3  results nobody ever reads",
  ], 9);
  s.addNotes(
    "If you have a laptop, stop here and do it live - open the viewer, load " +
    "05_optimiser.nova, and click through four or five tabs. If not, this slide " +
    "stands in for it. Mention the alternative: 'python -m nova report file.nova' " +
    "writes the same content as a single HTML file you can e-mail, and everything " +
    "is also available from the command line without any window at all.");
}

// ============================================================ 19 coverage
{
  const s = base(false);
  head(s, null, "Every module of the syllabus, in working code", null, false);

  const cov = [
    ["1", "Lexical analysis", "regex -> DFA by the direct method, minimisation, LLVM IR"],
    ["2", "Syntax analysis", "ambiguity, recursive descent, LL(1), SLR, CLR, LALR"],
    ["3", "Semantic analysis", "symbol table, type checking as an L-attributed SDD"],
    ["4", "Intermediate code", "three-address code, backpatching, jump tables"],
    ["5", "Optimisation", "blocks, DAG, 4 data-flow analyses, 8 passes, peephole"],
    ["6", "Code generation", "next use, register allocation, activation records"],
    ["7", "Parallelism, SSA", "phi insertion, dominance frontiers, dependence tests"],
    ["8", "Contemporary", "bytecode verification and a sandboxed virtual machine"],
  ];
  cov.forEach((c, i) => {
    const y = 1.32 + i * 0.47;
    s.addShape(pres.ShapeType.roundRect, {
      x: 0.55, y, w: 8.9, h: 0.4, rectRadius: 0.05,
      fill: { color: i % 2 ? WHITE : PANEL } });
    s.addShape(pres.ShapeType.ellipse, {
      x: 0.68, y: y + 0.08, w: 0.24, h: 0.24, fill: { color: COPPER } });
    s.addText(c[0], { x: 0.68, y: y + 0.08, w: 0.24, h: 0.24, fontSize: 9,
      bold: true, color: WHITE, align: "center", valign: "middle", fontFace: HEAD,
      margin: 0 });
    s.addText(c[1], { x: 1.05, y, w: 2.2, h: 0.4, fontSize: 11.5, bold: true,
      color: INK, fontFace: BODY, valign: "middle", margin: 0 });
    s.addText(c[2], { x: 3.3, y, w: 6.0, h: 0.4, fontSize: 10.5, color: MUTED,
      fontFace: BODY, valign: "middle", margin: 0 });
  });
  s.addText(
    "The 14 lab exercises are covered too - the lexical simulator, the symbol " +
    "table, the predictive parser, source to intermediate code, three-address to " +
    "assembly, common sub-expression and dead-code elimination are each a live " +
    "tab rather than a separate program.",
    { x: 0.55, y: 5.09, w: 8.3, h: 0.4, fontSize: 9.5, italic: true, color: MUTED,
      fontFace: BODY, align: "center", margin: 0 });
  s.addNotes(
    "This is the slide for the examiner rather than the class. Do not read it - " +
    "say 'every row is a tab you can open' and move on. If asked about the lab " +
    "list specifically: we did not write fourteen small disconnected programs, we " +
    "wrote one compiler in which each of those fourteen things is a phase you can " +
    "inspect, which is strictly more work and much closer to the real thing.");
}

// ============================================================ 20 close
{
  const s = base(true);
  s.addText("Try it in ten seconds", {
    x: 0.6, y: 0.55, w: 8.8, h: 0.6, fontSize: 32, bold: true, fontFace: HEAD,
    color: WHITE, margin: 0 });

  codePanel(s, 0.6, 1.35, 5.2, 2.25, "COMMAND LINE", [
    "run.bat                            (Windows: just double-click)",
    "",
    "python -m nova gui   program.nova   the Glass-Box viewer",
    "python -m nova run   program.nova   compile, verify, execute",
    "python -m nova report program.nova  a full HTML report",
    "python -m nova attack               8 attacks vs the verifier",
    "python -m nova test                 the 26 self-tests",
  ], 9.5);

  s.addShape(pres.ShapeType.roundRect, {
    x: 6.1, y: 1.35, w: 3.3, h: 2.25, rectRadius: 0.08, fill: { color: INK2 } });
  s.addText("What we would add next", {
    x: 6.32, y: 1.5, w: 2.9, h: 0.3, fontSize: 12.5, bold: true, fontFace: HEAD,
    color: COPPER, margin: 0 });
  bullets(s, 6.32, 1.85, 2.9, 1.65, [
    "Arrays and a heap, with bounds checks the verifier can prove away",
    "Register allocation by graph colouring, to compare against ours",
    "A real x86-64 or WASM back-end",
  ], 10, CODE);

  const facts = [["7,600", "lines of Python"], ["0", "dependencies"],
                 ["8 / 8", "attacks blocked"], ["26 / 26", "tests passing"]];
  facts.forEach((f, i) => {
    const x = 0.6 + i * 2.24;
    s.addText(f[0], { x, y: 3.85, w: 2.1, h: 0.55, fontSize: 26, bold: true,
      fontFace: HEAD, color: i > 1 ? "5FCBAC" : WHITE, margin: 0 });
    s.addText(f[1], { x, y: 4.4, w: 2.1, h: 0.3, fontSize: 10.5, color: "8CA7B8",
      fontFace: BODY, margin: 0 });
  });
  s.addText(
    "A compiler you can see through - because the only way to be sure it does " +
    "what the textbook says is to watch it do it.",
    { x: 0.6, y: 4.85, w: 8.8, h: 0.4, fontSize: 12.5, italic: true,
      color: "9FBACB", fontFace: BODY, margin: 0 });
  s.addNotes(
    "Close on the italic line, then invite questions. Likely questions and short " +
    "answers: Why Python? Because the phases had to be readable and the rule was " +
    "no C anywhere. Why no PLY or ANTLR? Because building the LALR tables is the " +
    "assignment, not an obstacle to it. What was hardest? The register allocator - " +
    "two registers claimed to hold the same variable and a stale one got written " +
    "back to memory; the two back-ends disagreeing is what found it. What is it " +
    "good for? Learning, and marking - every claim on these slides is a number the " +
    "tool prints.");
}

pres.writeFile({ fileName: "/home/claude/NovaCompiler/docs/Nova-Compiler-Presentation.pptx" })
  .then(() => console.log("deck written"));
