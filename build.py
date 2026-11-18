"""Build the self-contained TraffiCalm Technician game for GitHub Pages."""

import base64
from collections import Counter
import json
from pathlib import Path
import re

root = Path(__file__).resolve().parent
source = root / "src"
output = root / "docs" / "index.html"

questions = json.loads((source / "questions.json").read_text(encoding="utf-8-sig"))
if not isinstance(questions, list):
    raise SystemExit("questions.json must contain a list of questions.")

seen = set()
counts = Counter()
for question in questions:
    identifier = question["id"]
    if not re.fullmatch(r"(?:W0[1-5]|[FDBM][0-9]+)", identifier) or identifier in seen:
        raise SystemExit(f"Invalid or repeated question ID {identifier}.")
    for key in ("category", "prompt", "hint"):
        if not isinstance(question[key], str) or not question[key].strip():
            raise SystemExit(f"Question {identifier} needs a {key}.")
    options = question["options"]
    if (not isinstance(options, list) or len(options) != 4
            or any(not isinstance(value, str) or not value.strip() for value in options)
            or len({value.strip().casefold() for value in options}) != 4):
        raise SystemExit(f"Question {identifier} needs four distinct, nonempty choices.")
    seen.add(identifier)
    counts[identifier[0]] += 1

minimums = {"W": 5, "F": 5, "D": 4, "B": 5, "M": 1}
if any(counts[phase] < required for phase, required in minimums.items()):
    raise SystemExit("Need five tutorial questions and enough questions for each scored round.")

questions.sort(key=lambda question: question["id"])
bank = "// Question bank. The first choice is the key. The game shuffles choices when it displays them.\nconst QUESTION_BANK = "
bank += json.dumps(questions, ensure_ascii=False, indent=2).replace("</", "<\\/") + ";"
art = base64.b64encode((source / "hot-seat-stage.webp").read_bytes()).decode("ascii")
styles = (source / "stage.css").read_text(encoding="utf-8")
styles = styles.replace("/* STAGE_ART */", "data:image/webp;base64," + art)
html = (source / "shell.html").read_text(encoding="utf-8")
html = html.replace("/* QUESTION_BANK */", bank).replace("/* STYLES */", styles)
html = html.replace("/* GAME_ENGINE */", (source / "engine.js").read_text(encoding="utf-8"))
output.parent.mkdir(parents=True, exist_ok=True)
with output.open("w", encoding="utf-8", newline="\n") as file:
    file.write(html)
print(f"Built docs/index.html with {len(questions)} questions.")
