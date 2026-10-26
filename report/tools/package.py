"""
report/tools/package.py - build the Overleaf upload for the IEEE report.

    python report/tools/package.py      writes report/Nova-IEEE-Report-Overleaf.zip

The zip holds exactly what Overleaf needs to compile the paper: main.tex,
IEEEtran.cls, the figures and the command-line listings in data/cli.  Upload
it with New Project > Upload Project.
"""
from __future__ import annotations

import os
import zipfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, "Nova-IEEE-Report-Overleaf.zip")


def main() -> None:
    files = ["main.tex", "IEEEtran.cls"]
    figs = sorted(f for f in os.listdir(os.path.join(HERE, "figures")) if f.endswith(".png"))
    cli = sorted(f for f in os.listdir(os.path.join(HERE, "data", "cli")) if f.endswith(".txt"))
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            z.write(os.path.join(HERE, f), f)
        for f in figs:
            z.write(os.path.join(HERE, "figures", f), f"figures/{f}")
        for f in cli:
            z.write(os.path.join(HERE, "data", "cli", f), f"data/cli/{f}")
    print(f"wrote {OUT}: {len(files) + len(figs) + len(cli)} files, "
          f"{os.path.getsize(OUT) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
