// build_doc.js - "Nova explained in plain English"
const fs = require("fs");
const d = require("docx");
const {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel,
  LevelFormat, PageBreak, PageNumber, Packer, Paragraph, ShadingType, Table,
  TableCell, TableOfContents, TableRow, TextRun, WidthType, convertInchesToTwip,
} = d;

const INK = "0F2233";
const COPPER = "B0551F";
const TEAL = "0C6B58";
const MUTED = "56646F";
const PANEL = "EFF3F6";
const TEALBG = "E7F1EE";
const COPPERBG = "F8EDE5";

const HEAD = "Cambria";
const BODY = "Calibri";
const MONO = "Courier New";

const PAGE_W = 9360;          // A4 usable width in DXA (11906 - 2*1273 margins)

const kids = [];

/* ------------------------------------------------------------------ helpers */
function h1(text) {
  kids.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 160 },
    children: [new TextRun({ text, font: HEAD, size: 32, bold: true, color: INK })],
  }));
}

function h2(text) {
  kids.push(new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 120 },
    children: [new TextRun({ text, font: HEAD, size: 25, bold: true, color: COPPER })],
  }));
}

function h3(text) {
  kids.push(new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text, font: BODY, size: 22, bold: true, color: INK })],
  }));
}

function p(text, opts) {
  const o = opts || {};
  kids.push(new Paragraph({
    spacing: { after: o.after === undefined ? 140 : o.after, line: 300 },
    alignment: o.align,
    children: [new TextRun({
      text, font: BODY, size: o.size || 22, italic: o.italic,
      bold: o.bold, color: o.color || "1A1A1A",
    })],
  }));
}

// a paragraph with a bold lead-in, e.g. "The problem.  Text follows..."
function lead(label, text) {
  kids.push(new Paragraph({
    spacing: { after: 140, line: 300 },
    children: [
      new TextRun({ text: label + "  ", font: BODY, size: 22, bold: true, color: INK }),
      new TextRun({ text, font: BODY, size: 22, color: "1A1A1A" }),
    ],
  }));
}

function bullet(text, level) {
  kids.push(new Paragraph({
    numbering: { reference: "dots", level: level || 0 },
    spacing: { after: 70, line: 290 },
    children: [new TextRun({ text, font: BODY, size: 22, color: "1A1A1A" })],
  }));
}

// shaded callout: an analogy, or the one-sentence summary
function callout(title, text, kind) {
  const bg = kind === "teal" ? TEALBG : COPPERBG;
  const fg = kind === "teal" ? TEAL : COPPER;
  kids.push(new Table({
    width: { size: PAGE_W, type: WidthType.DXA },
    columnWidths: [PAGE_W],
    borders: {
      top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
      left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.NONE },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: [new TableRow({
      children: [new TableCell({
        width: { size: PAGE_W, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: bg },
        margins: { top: 150, bottom: 150, left: 200, right: 200 },
        children: [
          new Paragraph({
            spacing: { after: 60 },
            children: [new TextRun({
              text: title, font: BODY, size: 19, bold: true, color: fg,
              allCaps: true,
            })],
          }),
          new Paragraph({
            spacing: { line: 290 },
            children: [new TextRun({ text, font: BODY, size: 21, color: "1A1A1A" })],
          }),
        ],
      })],
    })],
  }));
  kids.push(new Paragraph({ spacing: { after: 160 }, children: [] }));
}

function code(lines, caption) {
  const rows = [];
  if (caption) {
    rows.push(new TableRow({
      children: [new TableCell({
        width: { size: PAGE_W, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: INK },
        margins: { top: 110, bottom: 40, left: 180, right: 180 },
        children: [new Paragraph({
          children: [new TextRun({
            text: caption, font: BODY, size: 16, bold: true, color: "E08B54",
            allCaps: true,
          })],
        })],
      })],
    }));
  }
  rows.push(new TableRow({
    children: [new TableCell({
      width: { size: PAGE_W, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: INK },
      margins: { top: caption ? 40 : 130, bottom: 130, left: 180, right: 180 },
      children: lines.map((l) => new Paragraph({
        spacing: { line: 250 },
        children: [new TextRun({
          text: l === "" ? " " : l, font: MONO, size: 17, color: "DCE7EE",
        })],
      })),
    })],
  }));
  kids.push(new Table({
    width: { size: PAGE_W, type: WidthType.DXA },
    columnWidths: [PAGE_W],
    borders: {
      top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
      left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.NONE },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows,
  }));
  kids.push(new Paragraph({ spacing: { after: 160 }, children: [] }));
}

function table(headers, rows, widths) {
  const w = widths || headers.map(() => Math.floor(PAGE_W / headers.length));
  const total = w.reduce((a, b) => a + b, 0);
  w[w.length - 1] += PAGE_W - total;
  const mk = (text, opts) => new Paragraph({
    spacing: { before: 40, after: 40, line: 260 },
    children: [new TextRun({
      text, font: BODY, size: opts.size || 19, bold: opts.bold,
      color: opts.color || "1A1A1A",
    })],
  });
  const head = new TableRow({
    tableHeader: true,
    children: headers.map((hh, i) => new TableCell({
      width: { size: w[i], type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: INK },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [mk(hh, { bold: true, color: "FFFFFF" })],
    })),
  });
  const body = rows.map((r, ri) => new TableRow({
    children: r.map((c, i) => new TableCell({
      width: { size: w[i], type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: ri % 2 ? "FFFFFF" : PANEL },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [mk(String(c), { bold: i === 0 })],
    })),
  }));
  kids.push(new Table({
    width: { size: PAGE_W, type: WidthType.DXA },
    columnWidths: w,
    rows: [head, ...body],
  }));
  kids.push(new Paragraph({ spacing: { after: 200 }, children: [] }));
}

function pageBreak() {
  kids.push(new Paragraph({ children: [new PageBreak()] }));
}

/* ==================================================================== cover */
kids.push(new Paragraph({ spacing: { before: 1800, after: 0 }, children: [] }));
kids.push(new Paragraph({
  spacing: { after: 80 },
  children: [new TextRun({
    text: "Nova", font: HEAD, size: 84, bold: true, color: INK })],
}));
kids.push(new Paragraph({
  spacing: { after: 300 },
  children: [new TextRun({
    text: "a glass-box compiler, explained in plain English",
    font: HEAD, size: 32, color: COPPER })],
}));
kids.push(new Paragraph({
  spacing: { after: 120, line: 320 },
  children: [new TextRun({
    text: "This document assumes you have never written a compiler and do not " +
          "want to. It explains what the program does, why each part of it " +
          "exists, and how the pieces fit together - in ordinary words, with " +
          "the technical terms introduced gently and always defined.",
    font: BODY, size: 23, color: MUTED })],
}));
kids.push(new Paragraph({
  spacing: { before: 500 },
  border: { top: { style: BorderStyle.SINGLE, size: 6, color: "C9D4DB" } },
  children: [],
}));
kids.push(new Paragraph({
  spacing: { before: 200 },
  children: [new TextRun({
    text: "Compiler Design  -  course project",
    font: BODY, size: 22, bold: true, color: INK })],
}));
kids.push(new Paragraph({
  children: [new TextRun({
    text: "7,600 lines of Python  |  27 modules  |  no external libraries  |  " +
          "26 of 26 self-tests passing",
    font: BODY, size: 20, color: MUTED })],
}));
pageBreak();

/* =================================================================== contents */
kids.push(new Paragraph({
  spacing: { after: 200 },
  children: [new TextRun({
    text: "Contents", font: HEAD, size: 32, bold: true, color: INK })],
}));
kids.push(new TableOfContents("Contents", {
  hyperlink: true, headingStyleRange: "1-2",
}));
kids.push(new Paragraph({
  spacing: { before: 300 },
  children: [new TextRun({
    text: "If Word shows an empty box above, click it once and press F9 to build " +
          "the table of contents.",
    font: BODY, size: 18, italic: true, color: MUTED })],
}));
pageBreak();

/* ================================================================= chapter 1 */
h1("1.  Start here: what a compiler is");

p("A computer processor does not understand words. It understands numbers - " +
  "very simple ones, meaning things like \"add these two\", \"copy this there\", " +
  "\"if that is smaller, jump to instruction 40\". Nothing else. It has no idea " +
  "what a variable is, what a loop is, or what a function call means.");

p("People, on the other hand, cannot work in numbers like that for very long " +
  "without making mistakes. So we write in a programming language, which looks " +
  "roughly like a mixture of English and algebra, and then something has to " +
  "translate it. That something is a compiler.");

callout("The one-sentence version",
  "A compiler reads a program written for humans and rewrites it as " +
  "instructions a machine can execute - checking, as it goes, that the program " +
  "makes sense at all.", "copper");

h2("1.1  Why it is not just \"find and replace\"");

p("Translation sounds like it should be mechanical: swap each line for its " +
  "machine equivalent. It is not, for the same reason that translating a novel " +
  "is not a word-by-word dictionary lookup. Meaning lives in structure. " +
  "Consider this line:");

code(["total = total + fib(i);"]);

p("To translate it you have to know that total is a variable that already " +
  "exists, that fib is a function and not a variable, that i must be a number " +
  "because fib expects one, that the function has to be called before the " +
  "addition can happen, and that the result has to be put back where total " +
  "lives - which might be a processor register, or a slot in memory, depending " +
  "on how busy the processor is at that moment. None of that is written down " +
  "in the line. All of it has to be worked out.");

h2("1.2  So it is done in stages");

p("Because there is too much to work out at once, every compiler ever built " +
  "does the job in stages, each one turning the program into a slightly more " +
  "machine-like form. This is the single most important idea in the subject, " +
  "and it is worth having a picture of it before anything else.");

table(
  ["Stage", "In human terms", "What comes out"],
  [
    ["1. Scanning", "Recognising the words on the page", "a list of words (\"tokens\")"],
    ["2. Parsing", "Working out the sentence structure", "a tree"],
    ["3. Semantics", "Checking the sentence means something", "an annotated tree"],
    ["4. Intermediate code", "Rewriting as very simple steps", "a flat list of tiny instructions"],
    ["5. Optimisation", "Editing to remove wasted effort", "a shorter list"],
    ["6. Code generation", "Assigning the machine's actual resources", "machine instructions"],
    ["7. SSA and parallelism", "Version-numbering, looking for work that can happen at once", "analysis reports"],
    ["8. Verification", "A safety inspection before anything runs", "a pass / fail proof"],
  ],
  [1900, 3600, 3860]);

p("Stages 1 to 6 are what every textbook calls \"the phases of a compiler\". " +
  "Stage 7 is what modern compilers add on top. Stage 8 is what systems that " +
  "run code they did not write - your web browser, Java, the Linux kernel - " +
  "add on top of that. Nova does all eight.");

pageBreak();

/* ================================================================= chapter 2 */
h1("2.  What Nova is, and why it is called a glass box");

p("Nova is a working compiler for a small programming language we designed " +
  "ourselves. You can write a program in it, and Nova will translate, check, " +
  "and run that program. In that sense it is an ordinary compiler.");

p("The unusual part is what it does with the working-out. A normal compiler " +
  "throws away every intermediate form the moment it has finished with it: you " +
  "put source code in, an executable comes out, and everything between is " +
  "invisible. Nova keeps all of it and shows it to you, one screen per stage.");

callout("The analogy",
  "Most compilers are a car with the bonnet welded shut. Nova is the same car " +
  "with a glass bonnet: the engine is doing real work, and you can watch it " +
  "doing it. Nothing on screen is a drawing of what a compiler might do - it " +
  "is a display of the data structure the compiler is genuinely using at that " +
  "moment.", "teal");

h2("2.1  The rules we set ourselves");

bullet("Pure Python, and nothing else. No C, no C++, no C#. If a table is " +
  "needed, we build it.");
bullet("No parser generator. Tools like Lex, YACC and ANTLR exist precisely to " +
  "do stage 2 for you. Using one would have skipped the part of the course we " +
  "were meant to learn, so the scanner and both parsers are written by hand.");
bullet("Nothing to install. No downloads, no libraries, no build step. On " +
  "Windows you double-click one file.");
bullet("A language that does not look like C, so we could not lean on " +
  "familiar shapes and had to think about the grammar properly.");

h2("2.2  The program we will follow");

p("Every explanation in this document uses the same short program, so you can " +
  "watch one thing travel the whole way through. Here it is. Even if you do not " +
  "program, it is readable: it defines the Fibonacci calculation, adds up the " +
  "first ten Fibonacci numbers, prints the total, and then prints a word " +
  "depending on what that total turned out to be.");

code([
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
  "    when 0:  print \"zero\";",
  "    when 88: print \"eighty-eight\";",
  "    otherwise print \"something else\";",
  "end",
], "the whole example program");

p("When Nova runs it, the answer is 88, and then the words eighty-eight. " +
  "Getting to that answer takes 4,074 machine-level instructions and, at the " +
  "deepest point of the recursion, ten function calls stacked on top of each " +
  "other. All of that is measured, not estimated - the numbers in this document " +
  "are printed by the tool itself.");

pageBreak();

/* ================================================================= chapter 3 */
h1("3.  Stage 1 - reading the words");

lead("The problem.",
  "The program arrives as one long line of characters. Before anything else " +
  "can happen, it has to be broken into meaningful units: this is the word " +
  "while, this is the number 10, this is the two-character symbol <=, this is " +
  "a comment nobody needs.");

callout("The analogy",
  "Reading a sentence in a language you know, you do not consciously assemble " +
  "letters into words - it happens instantly and automatically. Stage 1 builds " +
  "the machine that does that instantly and automatically. In the trade the " +
  "units are called tokens, and the machine is called a finite automaton.",
  "copper");

h2("3.1  How the machine is built");

p("Each kind of word is described by a short pattern. A number is \"one or " +
  "more digits\". A name is \"a letter, then any number of letters, digits or " +
  "underscores\". These patterns are called regular expressions, and Nova has " +
  "41 of them.");

p("You cannot read 41 patterns one after another for every word - it would be " +
  "hopelessly slow. Instead all 41 are merged into a single machine with a " +
  "fixed number of states. Reading a character moves the machine from one state " +
  "to another, and if it stops in a state marked \"accepting\", it has just " +
  "recognised a word. Reading a character costs one table lookup, no matter how " +
  "many patterns there were.");

p("The interesting part is how you get from patterns to that machine. The " +
  "textbook method - and the one Nova implements - is called the direct method. " +
  "Every character position in every pattern is numbered, and then, for each " +
  "position, you work out which positions could legally come immediately after " +
  "it. That relation is called followpos, and, remarkably, it is all you need: " +
  "each state of the finished machine is simply a set of positions.");

table(
  ["Measured on the real scanner", "Value"],
  [
    ["Patterns described", "41"],
    ["Numbered positions across all of them", "147"],
    ["States in the finished machine", "92"],
    ["Groups of characters that behave identically", "37"],
    ["Words recognised in our example program", "84"],
  ],
  [6600, 2760]);

lead("A detail that matters.",
  "The scanner always takes the longest match. Faced with the letters l-e-t-t-e-r " +
  "it does not stop after let and announce the keyword; it keeps going and " +
  "reports the single name letter. Without that rule, no language with keywords " +
  "would work at all.");

lead("What you can check yourself.",
  "Every compiler textbook builds the machine for the pattern (a|b)*abb as its " +
  "worked example, and every textbook gets four states. Nova's builder, given " +
  "the same pattern, produces four states. That is one of the automatic tests.");

pageBreak();

/* ================================================================= chapter 4 */
h1("4.  Stage 2 - working out the structure");

lead("The problem.",
  "A list of words is not yet a program. \"while i < 10 do\" has to be " +
  "recognised as a loop whose test is i < 10, and total + fib(i) has to be " +
  "recognised as an addition whose right-hand side is a function call. The " +
  "output of this stage is a tree: the shape of the program.");

callout("The analogy",
  "This is sentence diagramming, the thing you may have done at school with " +
  "subject, verb and object. The rules that say what a valid sentence looks " +
  "like are called a grammar, and ours has 58 of them.", "copper");

h2("4.1  Two ways to do it, and we did both");

p("There are two families of parser, and the difference is the direction they " +
  "work in.");

table(
  ["Approach", "How it works", "In everyday terms"],
  [
    ["Top-down", "Start from \"this is a program\" and guess your way down to the words",
     "predicting what comes next, and being right"],
    ["Bottom-up", "Start from the words and combine them upwards until a whole program is left",
     "recognising a phrase once you have seen all of it"],
  ],
  [1900, 4200, 3260]);

p("Nova implements both. The top-down parser is written by hand and is the one " +
  "whose tree the rest of the compiler uses. The bottom-up parser is built from " +
  "tables generated automatically from the grammar, and it re-reads the same " +
  "words independently. They must always agree. If they ever disagreed, we " +
  "would know immediately that one of them was wrong - and this cross-check " +
  "costs nothing.");

h2("4.2  The three kinds of table, compared");

p("Bottom-up parsers are driven by a table, and there are three standard ways " +
  "to build one. They differ in how much information they keep about what might " +
  "come next. Every textbook says the same thing about them; Nova lets you " +
  "measure it.");

table(
  ["Table", "States", "Entries", "Unresolved choices"],
  [
    ["SLR - simplest", "116", "1,229", "0"],
    ["CLR - most detailed", "478", "4,790", "0"],
    ["LALR - the compromise", "116", "1,214", "0"],
  ],
  [3200, 1900, 2100, 2160]);

callout("Why this table is the point of stage 2",
  "LALR needs the same 116 states as the simplest method, handles everything " +
  "the most detailed method handles, and is a quarter of its size. That is " +
  "exactly why every real-world parser generator produces LALR tables - and " +
  "here it is a measurement rather than a claim.", "teal");

h2("4.3  When a grammar is genuinely unclear");

p("Some grammars do not describe one unambiguous structure. The classic case " +
  "is arithmetic written with no precedence rules at all, where a + b * c could " +
  "mean either (a + b) * c or a + (b * c). A parser reaching that point has a " +
  "choice it cannot make, and the tool reports it in words:");

code([
  "state 14, lookahead '*':  shift/reduce conflict",
  "  the parser has already seen  expr + expr  and the next symbol is '*'.",
  "  It can reduce, giving (a+b)*c, or shift, giving a+(b*c).",
  "  The grammar does not say which.",
], "a conflict, explained rather than just counted");

p("The cure is to rewrite the grammar so the precedence is built into its " +
  "shape, which removes all four conflicts. Nova will also perform two other " +
  "standard grammar repairs on demand - removing left recursion and left " +
  "factoring - and re-check the result afterwards, so you can see the repair " +
  "work.");

pageBreak();

/* ================================================================= chapter 5 */
h1("5.  Stage 3 - does the program actually mean anything?");

lead("The problem.",
  "A sentence can be perfectly grammatical and still be nonsense: \"the number " +
  "five ate a sandwich\" breaks no rule of English grammar. Programs are the " +
  "same. Multiplying a piece of text by 4, or using a variable that was never " +
  "created, are grammatically fine and completely meaningless.");

h2("5.1  The symbol table");

p("The compiler builds a register of every name the program introduces: what " +
  "it is (a variable, a parameter, a function), what kind of value it holds, " +
  "which region of the program it belongs to, and where it will live in memory " +
  "later. This register is the symbol table, and almost every later stage " +
  "consults it.");

p("Regions matter more than they sound. A name declared inside a loop is a " +
  "different thing from a name spelled the same way outside it - it shadows the " +
  "outer one and disappears when the loop body ends. Nova tracks this properly, " +
  "and one of the automatic tests is a program that would loop forever if it " +
  "did not.");

h2("5.2  Information travelling in two directions");

p("Checking is done in a single walk over the tree, with information flowing " +
  "both ways at once. This is the idea the course calls a syntax-directed " +
  "definition, and it is simpler than the name suggests:");

table(
  ["Direction", "Name", "Examples of what travels"],
  [
    ["Downwards, from the context into the node", "inherited",
     "which region am I in, how deeply nested, which function am I inside, what type is expected here"],
    ["Upwards, from the node into its context", "synthesised",
     "the type this expression produced"],
  ],
  [3100, 1500, 4760]);

callout("Why one pass is enough",
  "No piece of information ever needs a value from something to its right that " +
  "has not been looked at yet. That property has a name - the definition is " +
  "L-attributed - and it is what makes a single left-to-right walk sufficient. " +
  "Nova records every one of these events, so you can read the flow " +
  "step by step.", "teal");

p("When something is wrong, the message says what and where, and suggests a " +
  "fix. Just as importantly, the compiler does not stop at the first mistake - " +
  "it recovers and keeps checking, so you get the whole list at once instead of " +
  "one error per attempt:");

code([
  "[Lexical error]  line 5, col 13: unexpected character '@'",
  "     hint: delete it, or put it inside a string literal",
  "[Syntax error]   line 6, col 15: expected a value but found ';'",
  "     hint: a value is a number, string, true/false, variable or (expression)",
  "[Semantic error] line 8, col 16: '*' cannot be applied to str and int",
  "     hint: arithmetic works on int; '+' also joins two strings",
], "one deliberately broken program, three phases reporting at once");

pageBreak();

/* ================================================================= chapter 6 */
h1("6.  Stage 4 - rewriting as very simple steps");

lead("The problem.",
  "A machine instruction does one thing. The tree still contains expressions " +
  "with several operations nested inside each other, so it has to be flattened " +
  "into a list where every line does exactly one thing and stores the answer " +
  "somewhere temporary.");

p("This flattened form is called three-address code, because a typical line " +
  "mentions at most three things: two inputs and a place to put the result. It " +
  "is not yet machine code - it is not tied to any particular processor - but " +
  "it is close enough that the last stages become straightforward.");

code([
  "t0 = call fib, 1",
  "total = total + t0",
  "i = i + 1",
], "one line of the original program, flattened");

h2("6.1  The jump-with-a-hole problem");

p("Loops and conditionals need jumps, and here is the awkward part: when the " +
  "compiler writes the jump, it does not yet know where the jump goes. The " +
  "destination is somewhere after the body it has not read yet.");

callout("The analogy",
  "You are writing a book and want to say \"see page 214\", but you have not " +
  "written page 214 yet and do not know what number it will end up being. So " +
  "you write \"see page ___\", keep a list of every blank you left, and fill " +
  "them all in at the end. That is exactly the technique, and it is called " +
  "backpatching.", "copper");

code([
  "as written:                after filling in the blanks:",
  "    if i < 10 goto ____        L0: if i < 10 goto L1",
  "    goto ____                      goto L2",
  "    total = total + t0         L1: total = total + t0",
  "    i = i + 1                      i = i + 1",
  "    goto L0                        goto L0",
]);

p("Our example program leaves and later fills six such blanks. The tool logs " +
  "every one, and an automatic test checks that no unfilled blank ever survives " +
  "into the next stage.");

h2("6.2  Two things that come out of this for free");

lead("Short-circuit conditions.",
  "Because conditions are compiled as jumps rather than as values, a test like " +
  "\"n is above zero AND 100 divided by n is above one\" never performs the " +
  "division when n is zero - it has already jumped away. There is a test for " +
  "exactly that program, and it does not crash.");

lead("A real jump table.",
  "The case construct does not become a chain of comparisons. It becomes a " +
  "single dispatch instruction that goes straight to the right branch, which is " +
  "what the equivalent construct does in C or Java.");

code(["jumptable total [0 -> L3, 88 -> L4] default L5"]);

pageBreak();

/* ================================================================= chapter 7 */
h1("7.  Stage 5 - removing wasted effort");

p("This is where a compiler earns its reputation. The program is correct " +
  "already; the question now is how much of the work it does is unnecessary.");

h2("7.1  First, cut the program into blocks");

p("The instruction list is divided into basic blocks: runs of instructions " +
  "with no jump in and no jump out except at the ends. Once you have blocks, " +
  "you can draw arrows between them showing which can follow which, and the " +
  "result is a flow graph - a map of every route the program can take. A loop " +
  "shows up as an arrow going back to a block you have already visited.");

h2("7.2  Then apply eight improvements");

table(
  ["Improvement", "In plain English"],
  [
    ["Common sub-expression elimination", "the same calculation appears twice; do it once and reuse the answer"],
    ["Constant folding", "3 x 99 never changes, so work it out now instead of every time the program runs"],
    ["Constant and copy propagation", "if x is known to be 5 here, write 5 instead of looking x up"],
    ["Loop-invariant code motion", "a calculation inside a loop that never changes is moved to just before the loop"],
    ["Strength reduction", "multiplying by 8 each time round becomes adding 8 each time round, because adding is cheaper"],
    ["Dead-code elimination", "the result is never read by anybody, so do not compute it"],
    ["Unreachable-code elimination", "no path can ever arrive at this block, so delete it"],
    ["Jump optimisation", "a jump that lands on another jump goes straight to the final destination"],
  ],
  [3400, 5960]);

p("On a program written badly on purpose, these turn 20 instructions into 18. " +
  "The static count understates the gain, because moving work out of a loop " +
  "does not delete an instruction - it stops it running five times. The " +
  "honest measure is how many instructions actually execute:");

table(
  ["Instructions actually executed", "Count"],
  [["Before optimisation", "188"], ["After optimisation", "148"],
   ["Work removed", "21%"]],
  [6600, 2760]);

h2("7.3  How the compiler knows it is allowed to");

p("Every improvement above is only safe under some condition, and the " +
  "conditions are answered by four standard analyses. Each one asks a question " +
  "about every point in the program and answers it by going round the flow " +
  "graph over and over until the answers stop changing.");

table(
  ["Analysis", "The question it answers"],
  [
    ["Reaching definitions", "which assignment could have produced the value in this variable right now?"],
    ["Live variables", "will anybody ever read this value again? If not, the instruction that made it is dead"],
    ["Available expressions", "has this exact calculation already been done on every route to this point?"],
    ["Very busy expressions", "will this be needed on every route from here? Then it is worth doing once, now"],
  ],
  [2900, 6460]);

callout("Why \"until the answers stop changing\"",
  "Because of loops. What is true at the top of a loop depends on what is true " +
  "at the bottom, which depends on what was true at the top. So you make a " +
  "first guess, go round, revise, go round again, and stop when a full pass " +
  "changes nothing. That settled state is called a fixed point, and the tool " +
  "shows you every round on the way to it.", "teal");

pageBreak();

/* ================================================================= chapter 8 */
h1("8.  Stage 6 - real machine instructions");

lead("The problem.",
  "The simple instruction list assumes an unlimited supply of places to put " +
  "temporary values. Real processors have a handful of extremely fast storage " +
  "slots called registers - Nova's target machine has four - and everything " +
  "else has to live in memory, which is much slower to reach.");

h2("8.1  Deciding what stays in a register");

callout("The analogy",
  "You are working at a small desk with room for four books. Everything else " +
  "goes back on the shelf. When you need a fifth book, which of the four on the " +
  "desk do you put away? The sensible answer is the one you will not need again " +
  "for the longest time.", "copper");

p("To answer that, the compiler works out, for every value and every point in " +
  "the program, how far away the next instruction that reads it is. This is " +
  "called next-use information. When registers run out, the value with the " +
  "most distant next use is written back to memory - which is called spilling " +
  "it. The viewer shows the contents of all four registers changing " +
  "instruction by instruction, and marks every spill.");

h2("8.2  What a function call really costs");

p("When one function calls another, the machine sets aside a block of memory " +
  "for that particular call, called an activation record or stack frame. It " +
  "holds everything the call needs that nothing else should touch.");

table(
  ["Slot", "What lives there", "Why it is needed"],
  [
    ["+0", "return address", "which instruction to come back to when this call finishes"],
    ["+1", "control link", "where the caller's own frame is, so it can be restored"],
    ["+2", "parameters", "the values that were passed in"],
    ["+3 and up", "local variables and temporaries", "this call's private working space"],
  ],
  [1400, 3300, 4660]);

callout("This is why recursion works",
  "fib calls fib, which calls fib again. Each call gets its own frame with its " +
  "own copy of n, so the calls do not interfere. At the deepest point of our " +
  "example there are ten frames stacked up, and the viewer draws them.", "teal");

h2("8.3  Two back-ends, on purpose");

p("Nova generates code twice: once for the register machine described above, " +
  "and once for a completely different design called a stack machine, where " +
  "instructions take their inputs from a pile rather than from named registers. " +
  "The second is how Java bytecode and WebAssembly work.");

p("Both are then executed, and both must print exactly the same thing. This " +
  "is not decoration - it is the strongest correctness check in the project, " +
  "and section 11 describes the real bug it caught.");

pageBreak();

/* ================================================================= chapter 9 */
h1("9.  Stage 7 - version numbers, and work that could happen at once");

h2("9.1  Giving every value a version number");

p("A great deal of analysis gets easier if each name is written to exactly " +
  "once. Instead of one variable i that changes, you have i1, i2, i3 - and then " +
  "the question \"where did this value come from?\" has exactly one answer " +
  "instead of needing an analysis. This is called static single assignment " +
  "form, and it is what LLVM, GCC and Java's just-in-time compiler all use " +
  "internally.");

p("The complication is loops, where two different versions arrive at the same " +
  "point depending on which way you came in. The notation for that is a phi " +
  "function:");

code([
  "before:                after:",
  "  i = 0                  i1 = 0",
  "loop:                  loop:",
  "  i = i + 1              i2 = phi(i1, i3)",
  "  if i < 5 goto loop     i3 = i2 + 1",
  "                         if i3 < 5 goto loop",
]);

p("phi(i1, i3) means: take i1 if you arrived from the entry, or i3 if you came " +
  "round the loop. It is a note about which path was taken, not an instruction " +
  "the machine executes.");

lead("Where do they go?",
  "You cannot scatter phi functions everywhere. They belong at exactly the " +
  "points where a definition stops being the only possibility - a set of blocks " +
  "with the intimidating name dominance frontier. Nova computes the frontiers " +
  "and places the phi functions accordingly; our example needs three.");

h2("9.2  Could this loop run on several cores at once?");

p("A loop can be split across processors only if the iterations do not depend " +
  "on each other. The compiler decides by asking one question: does any " +
  "iteration read something a previous iteration wrote? Three loops that look " +
  "almost identical get three different answers.");

table(
  ["The loop body", "Verdict", "Why"],
  [
    ["a = i * 2;", "can run in parallel",
     "nothing written in one round is read by the next, so all the rounds could happen simultaneously"],
    ["b = b + i;", "a reduction",
     "the rounds do depend on each other, but only through a running total, and addition can be done in any order - so split the range and add up the parts"],
    ["c = c * 3 - i;", "genuinely sequential",
     "each round needs the value the previous one produced, and the operation cannot be reordered; no amount of hardware helps"],
  ],
  [1900, 1900, 5560]);

p("This is the analysis behind automatic vectorisation in real compilers, and " +
  "it is the reason some programs get faster on a modern processor without " +
  "being rewritten, while others do not.");

pageBreak();

/* ================================================================ chapter 10 */
h1("10.  Stage 8 - proving it is safe before running it");

p("The last stage is the one no traditional compiler course pipeline has, and " +
  "it is the most modern part of the project.");

lead("The problem.",
  "Your browser downloads code from a website and runs it. Java runs code " +
  "compiled by someone else's compiler. The Linux kernel accepts small programs " +
  "from ordinary users and runs them inside itself. In each case the code " +
  "cannot be trusted - and asking \"is this program safe?\" by running it and " +
  "seeing what happens is obviously not an option.");

h2("10.1  The verifier");

p("Before a single instruction executes, Nova walks through the generated " +
  "bytecode using types in place of values. It never runs the program; it " +
  "reasons about every route through it at once, and proves five things.");

table(
  ["What is proved", "What it prevents"],
  [
    ["The working stack has the same depth on every route to every instruction",
     "the machine losing track of what it is holding"],
    ["No operation is applied to the wrong kind of value",
     "a piece of text being used as a memory address"],
    ["Every jump lands on a real instruction",
     "execution running off into data an attacker controls"],
    ["No variable is read before it is written",
     "leaking whatever the previous function left behind"],
    ["No access reaches outside this call's own frame",
     "one function reading or corrupting another's data"],
  ],
  [4300, 5060]);

h2("10.2  Then we attacked it");

callout("Why this section exists",
  "A security check that nobody ever tries to defeat is indistinguishable from " +
  "a security check that does nothing. So we hand-wrote eight bytecode " +
  "programs that no honest compiler would ever produce - the kind of thing an " +
  "attacker would feed straight to the machine - and recorded what stopped " +
  "each one.", "copper");

table(
  ["The attack", "Stopped by"],
  [
    ["A jump to instruction 9999, past the end of the code", "the verifier"],
    ["An addition performed with nothing to add", "the verifier"],
    ["Two routes arriving at one instruction in different states", "the verifier"],
    ["A piece of text multiplied by a number", "the verifier"],
    ["Reading a variable that was never written", "the verifier"],
    ["Reading slot 40 of a frame that has two slots", "the verifier"],
    ["A loop that never ends", "the sandbox, at run time"],
    ["A function that calls itself for ever", "the sandbox, at run time"],
  ],
  [6100, 3260]);

p("Eight out of eight, and the last two are the interesting ones. They are " +
  "perfectly type-safe: nothing about them is illegal, they simply never stop. " +
  "No amount of static checking can catch that, because whether a program halts " +
  "is famously undecidable. So the second layer - a sandbox that caps how many " +
  "instructions may run and how deep the calls may go - reports a policy " +
  "violation instead of hanging.");

callout("The same two layers you already rely on",
  "Static checking gets everything that is decidable and costs nothing while " +
  "the program runs. A run-time budget catches the rest. That is exactly how " +
  "Java, WebAssembly in your browser, and the Linux kernel's eBPF verifier are " +
  "built - and it is why a web page can run downloaded code without asking your " +
  "permission first.", "teal");

pageBreak();

/* ================================================================ chapter 11 */
h1("11.  How do we know any of it is correct?");

p("This is the question that matters most, and the least satisfying answer " +
  "would be \"it looks right\". Anything can produce plausible-looking output. " +
  "Nova is checked three ways.");

h2("11.1  Run everything three times, three different ways");

p("Every example program is executed by the unoptimised bytecode, by the " +
  "optimised bytecode, and by the entirely separate register machine. All three " +
  "must print exactly the same thing. An optimisation that changes the answer " +
  "is not an optimisation, and this catches it immediately.");

h2("11.2  It found a real bug");

p("It is worth telling this story, because it is the best evidence that the " +
  "checking is real. Consider three lines from Euclid's algorithm for the " +
  "greatest common divisor:");

code([
  "t = b;",
  "b = a % b;",
  "a = t;",
]);

p("One of the optimisations, copy propagation, notices that t is just a copy " +
  "of b and replaces later uses of t with b - which is usually correct and " +
  "saves an instruction. Here it is wrong, because b is changed on the very " +
  "next line, so by the time you reach the third line, t and b are no longer " +
  "the same thing. The optimiser turned the algorithm into nonsense and " +
  "gcd(1071, 462) came back as 0 instead of 21.");

p("The three-way check caught it at once: the unoptimised run said 21 and the " +
  "optimised run said 0. The fix was to stop guessing and compute the answer " +
  "properly, as a data-flow analysis that tracks which copies are still valid " +
  "at each point. It is a classic mistake, it is subtle, and a test found it " +
  "rather than a person.");

h2("11.3  Twenty-six automatic tests");

p("The suite checks textbook results as well as behaviour, so a phase cannot " +
  "quietly stop doing its job:");

bullet("the machine built for (a|b)*abb really does have four states");
bullet("the deliberately ambiguous grammar really does produce conflicts");
bullet("the two independent parsers accept exactly the same programs");
bullet("no unfilled jump ever survives into the next stage");
bullet("a condition with AND really does skip its right-hand side");
bullet("every one of the eight attacks is still blocked");
bullet("every example still prints the answer it is supposed to");

p("Run them yourself with one command; the whole suite takes a few seconds.", { after: 200 });

pageBreak();

/* ================================================================ chapter 12 */
h1("12.  Using it");

h2("12.1  If you are on Windows");

p("Double-click run.bat. That is the entire installation procedure. A window " +
  "opens with one tab per stage; load a program, press Compile, and click " +
  "through the tabs in order to watch it travel the pipeline.");

h2("12.2  From the command line");

code([
  "python -m nova gui      program.nova    the Glass-Box window",
  "python -m nova run      program.nova    compile, verify and execute",
  "python -m nova report   program.nova    write a full HTML report",
  "python -m nova phases   program.nova    print every stage to the screen",
  "python -m nova attack                   hostile bytecode vs the verifier",
  "python -m nova test                     the 26 self-tests",
]);

p("The report command is the easiest one to share: it writes a single HTML " +
  "file, openable in any browser, with every table in this document filled in " +
  "for whichever program you gave it. Nothing is downloaded and nothing has to " +
  "be installed for it to work.");

h2("12.3  The example programs");

table(
  ["File", "What it demonstrates"],
  [
    ["01_hello.nova", "the smallest program that does anything"],
    ["02_fibonacci.nova", "recursion, a loop and a jump table - the program in this document"],
    ["03_gcd.nova", "two functions, two live call frames, and the bug from section 11"],
    ["04_primes.nova", "nested loops and conditions that skip their right-hand side"],
    ["05_optimiser.nova", "written badly on purpose, so every optimisation has something to do"],
    ["06_parallel.nova", "three loops, three different verdicts about parallelism"],
    ["07_types_and_scopes.nova", "names that shadow other names, and type checking"],
    ["08_broken.nova", "one mistake per stage, all reported at once"],
  ],
  [2900, 6460]);

pageBreak();

/* ================================================================ chapter 13 */
h1("13.  Glossary");

p("Every term used in this document, in the order you are likely to meet it.",
  { italic: true, color: MUTED });

table(
  ["Term", "What it means"],
  [
    ["Token", "one meaningful word or symbol in the program: a number, a name, a keyword, an operator"],
    ["Regular expression", "a short pattern describing a family of words, such as \"one or more digits\""],
    ["Finite automaton (DFA)", "a machine with a fixed set of states that recognises words one character at a time"],
    ["followpos", "for each position in a pattern, the positions that may come immediately after it; the basis of building the automaton directly"],
    ["Grammar", "the rules describing what a valid program looks like, in the way sentence rules describe valid English"],
    ["Parsing", "working out the structure of a program according to the grammar, producing a tree"],
    ["Ambiguity", "a grammar that allows more than one structure for the same program; a defect"],
    ["Conflict", "a point where a table-driven parser cannot decide what to do; the symptom of ambiguity"],
    ["LALR", "the standard method for building parser tables: small like the simplest method, powerful like the most detailed"],
    ["Symbol table", "the compiler's register of every name in the program and what is known about it"],
    ["Scope", "the region of a program in which a particular name is meaningful"],
    ["Attribute", "a piece of information attached to a node of the tree, travelling either down from context or up from children"],
    ["Three-address code", "the flattened instruction list where each line does exactly one thing"],
    ["Backpatching", "leaving a jump destination blank, remembering where the blank is, and filling it in later"],
    ["Basic block", "a run of instructions with no jump in or out except at its ends"],
    ["Flow graph", "the map of which blocks can follow which; loops appear as arrows pointing backwards"],
    ["Data-flow analysis", "answering a question at every point in the program by going round the flow graph until the answers stop changing"],
    ["Fixed point", "the settled state where another pass would change nothing"],
    ["Register", "one of a processor's few extremely fast storage slots"],
    ["Spilling", "writing a register's value back to memory because the register is needed for something else"],
    ["Next use", "how far away the next instruction that reads a given value is; used to decide what to spill"],
    ["Activation record", "the private block of memory belonging to one particular function call; also called a stack frame"],
    ["Bytecode", "instructions for a simple imaginary machine rather than for a real processor; Java and WebAssembly both use this idea"],
    ["SSA", "a form in which every name is written exactly once, so every value has a single unambiguous origin"],
    ["Phi function", "a note at a merge point saying which version of a value arrived, depending on the route taken"],
    ["Dominance frontier", "the blocks where a definition stops being the only possibility; exactly where phi functions belong"],
    ["Reduction", "a loop whose iterations depend on each other only through a running total, which can therefore still be split up"],
    ["Verifier", "a check that proves properties of code before running it, by reasoning about types rather than values"],
    ["Sandbox", "limits applied while code runs, catching what static checking provably cannot - such as whether it ever stops"],
  ],
  [2400, 6960]);

/* ================================================================== assemble */
const doc = new Document({
  creator: "Nova compiler project",
  title: "Nova - a glass-box compiler, explained in plain English",
  numbering: {
    config: [{
      reference: "dots",
      levels: [
        { level: 0, format: LevelFormat.BULLET, text: "\u2022",
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 460, hanging: 260 } } } },
        { level: 1, format: LevelFormat.BULLET, text: "\u2013",
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 880, hanging: 260 } } } },
      ],
    }],
  },
  styles: {
    default: {
      document: { run: { font: BODY, size: 22, color: "1A1A1A" } },
    },
  },
  sections: [{
    properties: {
      page: {
        margin: { top: 1200, right: 1273, bottom: 1200, left: 1273 },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing: { after: 120 },
          children: [new TextRun({
            text: "Nova  -  a glass-box compiler",
            font: BODY, size: 16, color: "9AA8B2" })],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({
            children: [PageNumber.CURRENT], font: BODY, size: 17, color: MUTED })],
        })],
      }),
    },
    children: kids,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync("/home/claude/NovaCompiler/docs/Nova-Explained-Simply.docx", buf);
  console.log("document written");
});
