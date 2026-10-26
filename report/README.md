# Nova — IEEE conference-format project report

`Nova-IEEE-Report.pdf` is the compiled report: 29 pages, 50 figures (46 of
them screenshots of Nova Studio, the desktop viewer and the HTML report),
17 tables and 67 references. It uses the official IEEE Conference Template
(`IEEEtran`, conference mode), as on Overleaf, and has the sections the final
review asks for:

1. Abstract (and Index Terms)
2. Introduction
3. Literature Review
4. Methodology
5. Results and Discussion
6. Conclusions and Future Work

It ends with an Acknowledgment and the References.

## Before you submit: fill in the authors

The author block and the acknowledgment hold bracketed placeholders. Edit
them near the top of `main.tex` (search for `>>> AUTHORS`) and in the
`Acknowledgment` section near the end. Add or remove `\and` blocks to match
the number of authors.

## Editing on Overleaf

1. Overleaf → **New Project → Upload Project**.
2. Choose `Nova-IEEE-Report-Overleaf.zip`.
3. Click **Recompile**. The default pdfLaTeX compiler is the right one.

## Building locally

```
cd report
latexmk -pdf main.tex
```

This needs a TeX distribution such as MiKTeX or TeX Live.

## Regenerating every number and screenshot

Nothing in the paper is typed in by hand.

| Script | Produces |
|---|---|
| `tools/measure.py` | `data/measurements.json` — every statistic and timing in the paper, including the scaling series; it also records whether the laptop was on mains or battery |
| `tools/tables.py` | the LaTeX table rows, printed from `measurements.json` |
| `tools/capture.mjs` | `figures/*.png` — the 52 Nova Studio and HTML-report screenshots, at 2× pixel density |
| `tools/desktop_capture.ps1` | `figures/desktop-*.png` — three tabs of the Tkinter desktop viewer, photographed from its own window |
| `tools/package.py` | `Nova-IEEE-Report-Overleaf.zip` |

`capture.mjs` needs Nova Studio and a headless Chrome to be running first:

```
python -m nova serve --no-browser
chrome --headless=new --remote-debugging-port=9333 --hide-scrollbars
node report/tools/capture.mjs
```

Run `measure.py` on its own, with nothing else busy on the machine: the
timings in the paper were taken that way, on battery power, and the paper
says so. On mains power the same machine runs the compiler roughly 3.5×
faster; re-run the script and rebuild the PDF if you want those numbers.
