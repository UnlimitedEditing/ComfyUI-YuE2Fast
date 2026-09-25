"""Turn ABC notation typed or pasted into a chat prompt into text YuE2 can use as a score."""
import re

# Chat frontends may flatten newlines, so these two stand in for them: a literal backslash-n and "@@"
# (ABC never uses "@@"). Real newlines pass through untouched.
NEWLINE_MARKERS = ("\\n", "@@")

_FENCE = re.compile(r"```[A-Za-z0-9_-]*[ \t]*\n?(.*?)```", re.S)
_FIELD_START = re.compile(r"[ \t]+(?=(?:[XTCMLQVPZNOR]|K|[wW]):)")
_KEY_LINE_END = re.compile(
    r"(?m)^(K:[ \t]*[A-G][#b]?(?:[ \t]*(?:major|minor|maj|min|mix|dor|phr|lyd|loc|ion|aeo|m)\b)?)[ \t]+(?=\S)")


def normalize_abc(text):
    """Return (abc, notes). Raises ValueError if the text can't be a score."""
    notes = []
    t = (text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    fence = _FENCE.search(t)
    if fence:
        t = fence.group(1).strip()
        notes.append("removed code fence")
    for marker in NEWLINE_MARKERS:
        if marker in t:
            t = t.replace(marker, "\n")
            notes.append(f"newline marker {marker!r}")
    if "\n" not in t and re.search(r"(?:^|\s)K:", t):
        # Fully flattened: header and lyric fields each start a line, and the key ends the header line.
        # Body line breaks and "%" comments can't be recovered -- send real newlines when possible.
        t = _FIELD_START.sub("\n", t)
        t = _KEY_LINE_END.sub(r"\1\n", t)
        notes.append("rebuilt line breaks from flattened text")
    t = "\n".join(line.rstrip() for line in t.split("\n")).strip()
    if not re.search(r"(?m)^K:", t):
        raise ValueError("abc_text needs a 'K:' key line (e.g. K:Am) before the music")
    if "|" not in t:
        raise ValueError("abc_text has no bar lines ('|') -- is it really ABC notation?")
    return t, notes


# ---- instrumental: silence the vocal voice of a native-dialect score --------------------------------
# Port of makeInstrumental() in docs/index.html (the Score Studio's "Instr" button): the `V: Vocal`
# voice becomes rests with the chord symbols kept at their onsets; the score's other voice is untouched.
_TOKEN = re.compile(r'"[^"]*"|\[[A-Za-z]:[^\]]*\]|[_^=]*[A-Ga-g][\',]*\d*-?|z\d*|Z\d*|\s+|.')
_MULTS = (48, 32, 24, 16, 12, 8, 6, 4, 3, 2, 1)
_VOCAL_SECTIONS = {"verse", "prechorus", "chorus", "postchorus", "bridge"}
_VOCAL_WORDS = re.compile(r"\b(?:vocals?|vocalists?|singers?|singing|choir|rapper|rap)\b", re.I)
_NEGATED = re.compile(r"\b(?:no|without|non)\b|instrumental", re.I)


def _rests(n):
    out = ""
    for m in _MULTS:
        while n >= m:
            out += "z" + ("" if m == 1 else str(m))
            n -= m
    return out


def _bar_units(meter, unit):
    num, den = (meter or "4/4").split("/")
    return float(num) / float(den) * float((unit or "1/8").split("/")[1])


def _token_dur(tok):
    m = re.search(r"(\d+)-?$", tok)
    return int(m.group(1)) if m else 1


def _instrumental_bar(bar, want):
    t = bar.strip()
    if not t or re.fullmatch(r"Z\d*", t):
        return bar
    pos, last, out, kept = 0, 0, "", []
    for tok in _TOKEN.findall(t):
        if tok.startswith('"'):
            kept.append((pos, tok))
        elif re.match(r"\[[A-Za-z]:", tok):
            kept.append((pos, tok))  # inline M:/K:/L: changes must survive
        elif re.match(r"[_^=]*[A-Ga-g]", tok) or tok.startswith("z"):
            pos += _token_dur(tok)
    if not any(tok.startswith('"') for _, tok in kept):
        return "Z" if not kept else "".join(tok for _, tok in kept) + "Z"
    for at, tok in kept:
        if at > last:
            out += _rests(at - last)
            last = at
        out += tok
    return out + _rests(max(0, int(round(want)) - last))


def make_instrumental(abc):
    """Return the score with its `V: Vocal` voice replaced by rests (chords kept) and vocal-type
    sections (verse/chorus/...) renamed `interlude`, as the Score Studio does per section."""
    lines = abc.replace("\r", "").split("\n")
    meter = unit = None
    voice = None
    out = []
    for line in lines:
        m = re.match(r"^M:\s*(\S+)", line)
        if m:
            meter = m.group(1)
        m = re.match(r"^L:\s*(\S+)", line)
        if m:
            unit = m.group(1)
        sec = re.match(r"^%\s*(.+?)\s*$", line)
        if sec:
            voice = None
            base = re.sub(r"\d+$", "", re.sub(r"[^a-z0-9]", "", sec.group(1).lower()))
            out.append("% interlude" if base in _VOCAL_SECTIONS else line)
            continue
        v = re.match(r"^V:\s*(\S+)", line)
        if v:
            voice = v.group(1)
            out.append(line)
            continue
        if voice != "Vocal" or re.match(r"^[A-Za-z]:", line):
            out.append(line)
            continue
        want = _bar_units(meter, unit)
        out.append("|".join(_instrumental_bar(bar, want) for bar in line.split("|")))
    return "\n".join(out)


def instrumental_style(style):
    """Drop comma-separated vocal descriptors (only when there are several) and say it plainly."""
    parts = [p.strip() for p in (style or "").split(",") if p.strip()]
    if len(parts) > 1:
        parts = [p for p in parts if _NEGATED.search(p) or not _VOCAL_WORDS.search(p)]
    lowered = " ".join(parts).lower()
    if "instrumental" not in lowered:
        parts.append("instrumental")
    if not re.search(r"\bno (?:lead )?vocals?\b", lowered):
        parts.append("no vocals")
    return ", ".join(parts)
