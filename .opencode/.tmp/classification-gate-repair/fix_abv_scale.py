"""Fix alcohol_by_volume scale in infra/staging-data/seed.sql (percent → fraction).

Field-aware: rewrites ONLY the ABV token (5th CSV field) of product VALUES
rows (identified by a numeric/NULL 5th field AND numeric/NULL 6th field —
transport/review rows carry quoted 6th fields). Unconverted lines stay
byte-identical. Also repairs glued `X.XXX,Y.YYY` tokens left by an earlier
partial pass.
"""
import re
import sys


def top_level_commas(line: str) -> list[int]:
    out: list[int] = []
    in_quote = False
    for i, c in enumerate(line):
        if c == "'":
            in_quote = not in_quote
        elif c == "," and not in_quote:
            out.append(i)
    return out


def parse_num(token: str) -> float | None:
    t = token.strip()
    if not re.fullmatch(r"[0-9]+\.[0-9]+", t):
        return None
    try:
        return float(t)
    except ValueError:
        return None


def fix_line(line: str) -> str:
    if not re.match(r"^\s*\(", line) or line.lstrip().startswith("--"):
        return line
    cs = top_level_commas(line)
    if len(cs) < 9:
        return line
    abv = parse_num(line[cs[3] + 1 : cs[4]])
    vol = line[cs[4] + 1 : cs[5]].strip()
    if abv is None or abv <= 1:
        return line
    if not (re.fullmatch(r"[0-9]+\.[0-9]+", vol) or vol == "NULL"):
        return line  # 6th field quoted → not a product row (e.g. transport)
    return line[: cs[3] + 1] + " " + f"{abv / 100:.3f} " + line[cs[4] :]


path = sys.argv[1]
with open(path) as f:
    lines = f.readlines()
lines = [fix_line(l) for l in lines]
out = "".join(lines)
out = re.sub(r"(\d\.\d{3}),(\d+\.)", r"\1, \2", out)  # repair glued tokens
with open(path, "w") as f:
    f.write(out)
print(f"done: {path}")
