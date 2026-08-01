#!/usr/bin/env python3
"""
faxx-hr — detektor skrytého obsahu v CV + rozdělovač textu (v2).

Detektor NENÍ cíl sám o sobě. Je to PRVNÍ FÁZE hodnoticí pipeline a jeho
skutečný výstup jsou DVA oddělené korpusy:

    visible_text  — jde do AI vrstvy k posouzení relevance vůči inzerátu
    hidden_text   — NIKDY nejde do AI vrstvy; jen do review panelu personalisty

Tím je injection neutralizována už na vstupu: co člověk na papíře nevidí, to
model nedostane. Flag se personalistovi ZOBRAZÍ (nefiltruje se tiše), protože
pokus o manipulaci je sám o sobě relevantní informace o uchazeči.

Princip je DETERMINISTICKÝ (žádný jazykový model): reprodukovatelné,
auditovatelné, a samo o sobě to nepřidává další plochu pro útok.

Změny proti v1 (viz docs/DETECTOR-V2.md):
  - kontrast vůči SKUTEČNÉMU pozadí (WCAG) místo absolutního prahu na bílou
  - neviditelné Unicode nosiče (zero-width, bidi, Unicode Tags E0000+)
  - hlavičky a patičky (word/header*.xml, word/footer*.xml)
  - správná polarita: mimo-tokový ale VIDITELNÝ obsah (textboxy, sidebary)
    se neflaguje; flaguje se jen obsah pro člověka NEVIDITELNÝ
  - PDF: render mode 3, mimo-stránkové souřadnice, pozadí z vykreslených ploch
  - odolnost proti XML/ZIP bombám u nedůvěryhodného vstupu
  - regex je jen ESKALÁTOR severity, nikdy jediná brána detekce

Použití:
    python hidden_text.py soubor.docx [dalsi.pdf ...]
    python hidden_text.py --json soubor.pdf

Návratový kód: 0 = čisto, 2 = nalezen kritický flag, 1 = chyba vstupu.
"""
from __future__ import annotations

import json
import os
import re
import sys
import unicodedata
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field, asdict

# defusedxml pokud je k dispozici — vstup je z definice nedůvěryhodný
try:  # pragma: no cover
    from defusedxml.ElementTree import fromstring as _xml_fromstring
except ImportError:  # pragma: no cover
    _xml_fromstring = ET.fromstring

# ---------------------------------------------------------------------------
# Limity proti dekompresním bombám (vstup je nepřátelský z definice)
# ---------------------------------------------------------------------------
MAX_PART_BYTES = 32 * 1024 * 1024      # jedna XML část po dekompresi
MAX_TOTAL_BYTES = 128 * 1024 * 1024    # celý balík po dekompresi
MAX_RATIO = 200                        # dekompresní poměr

# ---------------------------------------------------------------------------
# Prahy (kalibrují se empiricky na held-out sadě ve fázi F0)
# ---------------------------------------------------------------------------
CONTRAST_HIDDEN = 1.6      # pod tímto poměrem = pro člověka neviditelné
CONTRAST_LOW = 2.5         # mezi = podezřele nízký kontrast
MIN_FONT_PT = 4.0          # pod = nečitelné
MIN_TEXT_LEN = 12          # kratší útržky v metadatech neřešíme (šum)

# ---------------------------------------------------------------------------
# Neviditelné Unicode nosiče
# ---------------------------------------------------------------------------
INVISIBLE_CHARS = {
    0x00AD,  # soft hyphen
    0x200B, 0x200C, 0x200D,  # zero-width space / non-joiner / joiner
    0x200E, 0x200F,          # LRM / RLM
    0x2060, 0x2061, 0x2062, 0x2063, 0x2064,  # word joiner, invisible operators
    0xFEFF,  # zero-width no-break space / BOM
    0x180E,  # mongolian vowel separator
}
INVISIBLE_RANGES = [
    (0x202A, 0x202E),    # bidi embedding/override
    (0x2066, 0x2069),    # bidi isolate
    (0xE0000, 0xE007F),  # Unicode Tags — nosič „neviditelného promptu"
    (0xFE00, 0xFE0F),    # variation selectors
]


def is_invisible_cp(cp: int) -> bool:
    if cp in INVISIBLE_CHARS:
        return True
    for lo, hi in INVISIBLE_RANGES:
        if lo <= cp <= hi:
            return True
    try:
        return unicodedata.category(chr(cp)) == "Cf"
    except ValueError:
        return False


def strip_invisible(text: str) -> str:
    return "".join(ch for ch in text if not is_invisible_cp(ord(ch)))


def decode_unicode_tags(text: str) -> str:
    """Unicode Tags block mapuje 1:1 na ASCII — dekóduj skrytou zprávu."""
    out = []
    for ch in text:
        cp = ord(ch)
        if 0xE0020 <= cp <= 0xE007E:
            out.append(chr(cp - 0xE0000))
    return "".join(out)


# ---------------------------------------------------------------------------
# Heuristika „text vypadá jako instrukce pro AI"
# POZOR: slouží jen k ESKALACI severity, nikdy jako jediná podmínka detekce.
# Blocklist je obejitelný přeformulováním — detekce stojí na neviditelnosti.
# ---------------------------------------------------------------------------
INJECTION_PATTERNS = [
    # přímé adresování / override
    r"ignore\s+(all\s+)?(the\s+)?(previous|prior|above)",
    r"disregard\s+(all\s+)?(the\s+)?(previous|prior|above)",
    r"ignoruj\s+(v[sš]echn[ay]\s+)?p[rř]edchoz",
    r"ignoruj\s+(v[sš]echn[ay]\s+)?predchoz",
    r"nev[sš][ií]mej\s+si\s+p[rř]edchoz",
    r"system\s+prompt",
    r"\bas\s+an\s+ai\b",
    r"you\s+are\s+(an?\s+)?(ai|assistant|language\s+model|recruiter|screening)",
    r"jsi\s+(ai|jazykov|asistent|n[aá]borov)",
    r"\[?(resume|cv)[_\s-]?evaluation[_\s-]?context\]?",
    # manipulace verdiktu
    r"(best|top|ideal|perfect|strongest)\s+candidate",
    r"nejlep[sš][ií]\s+(kandid|uchaze)",
    r"ide[aá]ln[ií]\s+(kandid|uchaze)",
    r"highly\s+qualified",
    r"(recommend|advance)\s+(this\s+)?(candidate\s+)?(to|for)\s+(the\s+)?interview",
    r"doporu[cč]\w*\s+(k|na)\s+pohovor",
    r"(hire|interview)\s+(this|the)\s+candidate",
    # manipulace skóre
    r"(score|rating|rate)\s*[:=]\s*\d{2,3}\s*(/\s*100)?",
    r"sk[oó]re\s*[:=]\s*\d{2,3}",
    r"(rate|score)\s+(this\s+)?(candidate|applicant)\s+(highly|100|maximum)",
]
INJ_RE = re.compile("|".join(INJECTION_PATTERNS), re.IGNORECASE)


def fold(text: str) -> str:
    """Sjednotí diakritiku i mezery, ať regex neuteče přes 'ignoruj předchozí'."""
    t = strip_invisible(text or "")
    t = unicodedata.normalize("NFKD", t)
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", t)


def injection_hit(text: str) -> str | None:
    for probe in (text or "", fold(text or "")):
        m = INJ_RE.search(probe)
        if m:
            return m.group(0)[:120]
    return None


# ---------------------------------------------------------------------------
# Barvy a kontrast (WCAG relativní jas)
# ---------------------------------------------------------------------------
NAMED_HIGHLIGHTS = {
    "yellow": (255, 255, 0), "green": (0, 255, 0), "cyan": (0, 255, 255),
    "magenta": (255, 0, 255), "blue": (0, 0, 255), "red": (255, 0, 0),
    "darkBlue": (0, 0, 139), "darkCyan": (0, 139, 139), "darkGreen": (0, 100, 0),
    "darkMagenta": (139, 0, 139), "darkRed": (139, 0, 0), "darkYellow": (128, 128, 0),
    "darkGray": (169, 169, 169), "lightGray": (211, 211, 211),
    "black": (0, 0, 0), "white": (255, 255, 255),
}


def parse_hex(val: str | None) -> tuple[int, int, int] | None:
    if not val:
        return None
    v = val.strip().lstrip("#")
    if v.lower() in ("auto", "none"):
        return None
    if len(v) != 6:
        return None
    try:
        return int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16)
    except ValueError:
        return None


def luminance(rgb: tuple[int, int, int]) -> float:
    def chan(c: float) -> float:
        c /= 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (chan(x) for x in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(fg: tuple[int, int, int], bg: tuple[int, int, int]) -> float:
    l1, l2 = luminance(fg), luminance(bg)
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)


# ---------------------------------------------------------------------------
# Datové struktury
# ---------------------------------------------------------------------------
@dataclass
class Flag:
    doc: str
    type: str
    severity: str  # info | warn | critical
    location: str
    evidence: str
    method: str = "deterministic"


@dataclass
class ScanResult:
    """Výstup fáze 1. `visible_text` je JEDINÝ vstup do AI hodnocení."""
    doc: str
    ok: bool = True
    error: str | None = None
    flags: list[Flag] = field(default_factory=list)
    visible_text: str = ""
    hidden_text: str = ""
    stats: dict = field(default_factory=dict)

    @property
    def worst_severity(self) -> str:
        for sev in ("critical", "warn", "info"):
            if any(f.severity == sev for f in self.flags):
                return sev
        return "clean"

    def to_dict(self) -> dict:
        d = asdict(self)
        d["worst_severity"] = self.worst_severity
        return d


def sev_for(text: str, base: str = "warn") -> tuple[str, str]:
    """Vrátí (severity, evidence). Regex jen eskaluje, sám nedetekuje."""
    hit = injection_hit(text)
    if hit:
        return "critical", f"[shoda: {hit}] {text[:180]}"
    return base, (text or "")[:180]


# ---------------------------------------------------------------------------
# XML / ZIP pomůcky
# ---------------------------------------------------------------------------
def localname(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def attr(el, name: str) -> str | None:
    if el is None:
        return None
    for k, v in el.attrib.items():
        if localname(k) == name:
            return v
    return None


def child(el, name: str):
    if el is None:
        return None
    for c in el:
        if localname(c.tag) == name:
            return c
    return None


def all_text(el) -> str:
    out = []
    for t in el.iter():
        ln = localname(t.tag)
        if ln == "t":
            out.append(t.text or "")
        elif ln in ("tab", "br", "cr"):
            out.append(" ")
    return "".join(out)


class SafeZip:
    """ZIP s limity — brání dekompresní bombě."""

    def __init__(self, path: str):
        self.z = zipfile.ZipFile(path)
        self.total = 0
        self.names = set(self.z.namelist())

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.z.close()
        return False

    def read_xml(self, part: str):
        info = self.z.getinfo(part)
        if info.file_size > MAX_PART_BYTES:
            raise ValueError(f"část {part} je příliš velká ({info.file_size} B)")
        if info.compress_size and info.file_size / max(info.compress_size, 1) > MAX_RATIO:
            raise ValueError(f"podezřelý dekompresní poměr u {part}")
        self.total += info.file_size
        if self.total > MAX_TOTAL_BYTES:
            raise ValueError("překročen celkový limit dekomprese")
        return _xml_fromstring(self.z.read(part))

    def parts(self, pattern: str) -> list[str]:
        rx = re.compile(pattern)
        return sorted(n for n in self.names if rx.fullmatch(n))


# ---------------------------------------------------------------------------
# DOCX
# ---------------------------------------------------------------------------
def docx_background(root) -> tuple[int, int, int]:
    bg = child(root, "background")
    rgb = parse_hex(attr(bg, "color")) if bg is not None else None
    return rgb or (255, 255, 255)


def run_is_hidden(rpr) -> str | None:
    if rpr is None:
        return None
    for c in rpr:
        if localname(c.tag) in ("vanish", "specVanish", "webHidden"):
            val = attr(c, "val")
            if val in (None, "true", "1", "on"):
                return localname(c.tag)
    return None


def run_font_size(rpr) -> float | None:
    sz = child(rpr, "sz") if rpr is not None else None
    val = attr(sz, "val") if sz is not None else None
    try:
        return float(val) / 2.0  # half-points -> pt
    except (TypeError, ValueError):
        return None


def effective_bg(rpr, ppr, doc_bg) -> tuple[int, int, int]:
    """Pozadí runu: highlight > run shd > odstavcové shd > pozadí dokumentu."""
    hl = child(rpr, "highlight") if rpr is not None else None
    if hl is not None:
        named = NAMED_HIGHLIGHTS.get(attr(hl, "val") or "")
        if named:
            return named
    for holder in (rpr, ppr):
        shd = child(holder, "shd") if holder is not None else None
        rgb = parse_hex(attr(shd, "fill")) if shd is not None else None
        if rgb:
            return rgb
    return doc_bg


def scan_docx_part(sz: SafeZip, part: str, label: str, res: ScanResult, doc_bg) -> None:
    """Projde jednu OOXML část s tokem textu (document / header / footer)."""
    root = sz.read_xml(part)
    body = child(root, "body")
    if body is None:
        body = root

    for para in (e for e in body.iter() if localname(e.tag) == "p"):
        ppr = child(para, "pPr")
        line_visible: list[str] = []

        # runy bývají zanořené (hyperlink, sdt, smartTag) -> iter()
        for run in (e for e in para.iter() if localname(e.tag) == "r"):
            raw = all_text(run)
            txt = strip_invisible(raw).strip()
            rpr = child(run, "rPr")

            # 1) neviditelné Unicode nosiče (nezávisle na viditelnosti runu)
            hidden_cps = [ord(c) for c in raw if is_invisible_cp(ord(c))]
            if len(hidden_cps) >= 3:
                tags = decode_unicode_tags(raw)
                sev, _ = sev_for(tags or "", base="warn")
                payload = tags or f"{len(hidden_cps)} neviditelných kódových bodů"
                res.flags.append(Flag(res.doc, "unicode_invisible", sev,
                                      f"{part} ({label})",
                                      f"{payload[:150]} | první U+{hidden_cps[0]:04X}"))
                if tags:
                    res.hidden_text += tags + "\n"

            if not txt:
                continue

            # 2) explicitní skrytí
            kind = run_is_hidden(rpr)
            if kind:
                sev, ev = sev_for(txt)
                res.flags.append(Flag(res.doc, "docx_vanish", sev,
                                      f"{part} ({label}, w:{kind})", ev))
                res.hidden_text += txt + "\n"
                continue

            # 3) kontrast vůči SKUTEČNÉMU pozadí
            col_el = child(rpr, "color")
            fg = parse_hex(attr(col_el, "val")) if col_el is not None else None
            bg = effective_bg(rpr, ppr, doc_bg)
            if fg is None:  # w:color=auto -> podle jasu pozadí
                fg = (0, 0, 0) if luminance(bg) > 0.5 else (255, 255, 255)
            ratio = contrast_ratio(fg, bg)
            size = run_font_size(rpr)

            if ratio < CONTRAST_HIDDEN:
                sev, ev = sev_for(txt)
                res.flags.append(Flag(
                    res.doc, "docx_low_contrast", sev,
                    f"{part} ({label}, #{fg[0]:02X}{fg[1]:02X}{fg[2]:02X} na "
                    f"#{bg[0]:02X}{bg[1]:02X}{bg[2]:02X}, kontrast {ratio:.2f}:1)", ev))
                res.hidden_text += txt + "\n"
                continue

            if size is not None and size < MIN_FONT_PT:
                sev, ev = sev_for(txt)
                res.flags.append(Flag(res.doc, "docx_tiny_font", sev,
                                      f"{part} ({label}, {size:.1f} pt)", ev))
                res.hidden_text += txt + "\n"
                continue

            if ratio < CONTRAST_LOW:
                res.flags.append(Flag(res.doc, "docx_faint_text", "info",
                                      f"{part} ({label}, kontrast {ratio:.2f}:1)",
                                      txt[:180]))

            line_visible.append(txt)

        if line_visible:
            res.visible_text += " ".join(line_visible) + "\n"


def scan_docx(path: str, res: ScanResult) -> None:
    with SafeZip(path) as sz:
        main = "word/document.xml"
        doc_bg = (255, 255, 255)

        if main in sz.names:
            root = sz.read_xml(main)
            doc_bg = docx_background(root)
            scan_docx_part(sz, main, "hlavní tok", res, doc_bg)

            # alt-texty a názvy obrázků — sighted čtenář je nevidí
            for e in root.iter():
                for k, v in e.attrib.items():
                    if localname(k) in ("descr", "title") and len((v or "").strip()) >= MIN_TEXT_LEN:
                        sev, ev = sev_for(v, base="info")
                        res.flags.append(Flag(res.doc, "docx_alt_text", sev,
                                              f"{main} (alt-text obrázku)", ev))
                        res.hidden_text += v.strip() + "\n"

        # hlavičky a patičky — pro člověka VIDITELNÉ, ale samostatné části;
        # klasický nosič bílého textu v patičce každé stránky
        for part in sz.parts(r"word/(header|footer)\d*\.xml"):
            label = "hlavička" if "header" in part else "patička"
            scan_docx_part(sz, part, label, res, doc_bg)

        # části pro člověka NEVIDITELNÉ — flag na PŘÍTOMNOST textu;
        # regex jen eskaluje severity, není jedinou branou
        for part, label in [("word/comments.xml", "komentář"),
                            ("word/footnotes.xml", "poznámka pod čarou"),
                            ("word/endnotes.xml", "vysvětlivka")]:
            if part in sz.names:
                txt = strip_invisible(all_text(sz.read_xml(part))).strip()
                if len(txt) >= MIN_TEXT_LEN:
                    sev, ev = sev_for(txt, base="info")
                    res.flags.append(Flag(res.doc, "docx_annotation", sev,
                                          f"{part} ({label})", ev))
                    res.hidden_text += txt + "\n"

        for part in ["docProps/core.xml", "docProps/app.xml", "docProps/custom.xml"]:
            if part in sz.names:
                root = sz.read_xml(part)
                txt = strip_invisible(
                    " ".join((e.text or "") for e in root.iter() if (e.text or "").strip())
                ).strip()
                if len(txt) >= MIN_TEXT_LEN:
                    sev, ev = sev_for(txt, base="info")
                    res.flags.append(Flag(res.doc, "docx_metadata", sev, part, ev))
                    res.hidden_text += txt + "\n"


# ---------------------------------------------------------------------------
# PDF (vyžaduje PyMuPDF)
# ---------------------------------------------------------------------------
def pdf_background_at(drawings, bbox) -> tuple[int, int, int]:
    """Barva nejmenší vyplněné plochy, kterou span obsahuje (jinak bílá)."""
    best, best_area = None, float("inf")
    x0, y0, x1, y1 = bbox
    for d in drawings:
        fill = d.get("fill")
        rect = d.get("rect")
        if not fill or rect is None:
            continue
        if rect.x0 <= x0 and rect.y0 <= y0 and rect.x1 >= x1 and rect.y1 >= y1:
            area = (rect.x1 - rect.x0) * (rect.y1 - rect.y0)
            if area < best_area:
                best_area, best = area, fill
    if best is None:
        return (255, 255, 255)
    return tuple(max(0, min(255, int(round(c * 255)))) for c in best[:3])


def scan_pdf(path: str, res: ScanResult) -> None:
    try:
        import fitz  # PyMuPDF
    except ImportError:
        res.flags.append(Flag(res.doc, "pdf_skipped", "warn", "-",
                              "PyMuPDF není nainstalován (pip install pymupdf) — "
                              "PDF větev neproběhla"))
        return

    doc = fitz.open(path)
    for pno, page in enumerate(doc, start=1):
        page_rect = page.rect
        try:
            drawings = page.get_drawings()
        except Exception:
            drawings = []

        # render mode 3 = neviditelný text — hrubá kontrola v content streamu
        try:
            raw = page.read_contents() or b""
            if re.search(rb"(?<![0-9.])3\s+Tr\b", raw):
                res.flags.append(Flag(
                    res.doc, "pdf_render_mode_3", "warn", f"strana {pno}",
                    "content stream obsahuje '3 Tr' (neviditelný render mode) — "
                    "hrubá detekce, přesné zaměření až on-prem runnerem",
                    method="deterministic-coarse"))
        except Exception:
            pass

        for block in page.get_text("dict").get("blocks", []):
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    raw_txt = span.get("text") or ""
                    txt = strip_invisible(raw_txt).strip()

                    hidden_cps = [ord(c) for c in raw_txt if is_invisible_cp(ord(c))]
                    if len(hidden_cps) >= 3:
                        tags = decode_unicode_tags(raw_txt)
                        sev, _ = sev_for(tags or "", base="warn")
                        res.flags.append(Flag(
                            res.doc, "unicode_invisible", sev, f"strana {pno}",
                            (tags or f"{len(hidden_cps)} neviditelných kódových bodů")[:160]))
                        if tags:
                            res.hidden_text += tags + "\n"

                    if not txt:
                        continue

                    bbox = span.get("bbox", (0, 0, 0, 0))
                    size = float(span.get("size", 12.0))
                    color = int(span.get("color", 0))
                    fg = ((color >> 16) & 255, (color >> 8) & 255, color & 255)
                    bg = pdf_background_at(drawings, bbox)
                    ratio = contrast_ratio(fg, bg)

                    if (bbox[2] < page_rect.x0 - 1 or bbox[0] > page_rect.x1 + 1
                            or bbox[3] < page_rect.y0 - 1 or bbox[1] > page_rect.y1 + 1):
                        sev, ev = sev_for(txt)
                        res.flags.append(Flag(res.doc, "pdf_offpage", sev,
                                              f"strana {pno} (bbox mimo mediabox)", ev))
                        res.hidden_text += txt + "\n"
                        continue

                    if ratio < CONTRAST_HIDDEN:
                        sev, ev = sev_for(txt)
                        res.flags.append(Flag(
                            res.doc, "pdf_low_contrast", sev,
                            f"strana {pno} (#{fg[0]:02X}{fg[1]:02X}{fg[2]:02X} na "
                            f"#{bg[0]:02X}{bg[1]:02X}{bg[2]:02X}, kontrast {ratio:.2f}:1)", ev))
                        res.hidden_text += txt + "\n"
                        continue

                    if size < MIN_FONT_PT:
                        sev, ev = sev_for(txt)
                        res.flags.append(Flag(res.doc, "pdf_tiny_font", sev,
                                              f"strana {pno} ({size:.1f} pt)", ev))
                        res.hidden_text += txt + "\n"
                        continue

                    if ratio < CONTRAST_LOW:
                        res.flags.append(Flag(res.doc, "pdf_faint_text", "info",
                                              f"strana {pno} (kontrast {ratio:.2f}:1)",
                                              txt[:180]))
                    res.visible_text += txt + " "
            res.visible_text += "\n"

    res.stats["pages"] = doc.page_count
    doc.close()


# ---------------------------------------------------------------------------
# Veřejné API
# ---------------------------------------------------------------------------
def scan(path: str) -> ScanResult:
    res = ScanResult(doc=os.path.basename(path))
    ext = os.path.splitext(path)[1].lower()
    try:
        if ext == ".docx":
            scan_docx(path, res)
        elif ext == ".pdf":
            scan_pdf(path, res)
        else:
            res.ok, res.error = False, f"nepodporovaný formát: {ext or '(bez přípony)'}"
            return res
    except Exception as e:  # noqa: BLE001 — vadný soubor nesmí shodit celou dávku
        res.ok, res.error = False, f"{type(e).__name__}: {e}"
        return res

    res.visible_text = res.visible_text.strip()
    res.hidden_text = res.hidden_text.strip()
    res.stats.update({
        "visible_chars": len(res.visible_text),
        "hidden_chars": len(res.hidden_text),
        "flags": len(res.flags),
    })
    return res


def scan_many(paths: list[str]) -> list[ScanResult]:
    """Dávkové zpracování — jeden vadný soubor nesmí shodit ostatní."""
    return [scan(p) for p in paths]


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
ICON = {"critical": "⛔", "warn": "⚠️ ", "info": "ℹ️ "}


def main(argv: list[str]) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # Windows konzole bývá cp1250
    except Exception:
        pass
    args = [a for a in argv[1:] if not a.startswith("--")]
    as_json = "--json" in argv
    if not args:
        print(__doc__)
        return 1

    results = scan_many(args)

    if as_json:
        print(json.dumps([r.to_dict() for r in results], ensure_ascii=False, indent=2))
    else:
        for r in results:
            print(f"\n=== {r.doc} ===")
            if not r.ok:
                print(f"  [!] {r.error}")
                continue
            if not r.flags:
                print("  ✓ žádný skrytý obsah nedetekován")
            for f in r.flags:
                print(f"  {ICON.get(f.severity, '• ')}[{f.severity}] {f.type} @ {f.location}")
                print(f"       → {f.evidence}")
            print(f"  → viditelný text: {r.stats.get('visible_chars', 0)} zn. (→ AI vrstva)"
                  f" | skrytý: {r.stats.get('hidden_chars', 0)} zn. (→ jen review)")

        crit = sum(f.severity == "critical" for r in results for f in r.flags)
        warn = sum(f.severity == "warn" for r in results for f in r.flags)
        info = sum(f.severity == "info" for r in results for f in r.flags)
        errs = sum(1 for r in results if not r.ok)
        print(f"\nDokumentů: {len(results)} (chyb: {errs})  "
              f"Nálezy: critical={crit}, warn={warn}, info={info}")

    return 2 if any(f.severity == "critical" for r in results for f in r.flags) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
