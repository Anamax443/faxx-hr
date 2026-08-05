#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
boundary_matrix.py — prožene hraniční PDF vektory OBĚMA obrannými vrstvami
a vytiskne / zapíše coverage matici:

  - on-prem = detector/hidden_text.py (PyMuPDF)
  - edge    = živý Worker /scan (Cloudflare Workers AI toMarkdown + injection klasifikátor)

Klíčové rozlišení:
  DETEKOVÁNO = vrstva zvedla relevantní flag (upozorní člověka)
  ZADRŽENO   = payload se nedostal do textu, který by šel do AI (visible_text)
               — u on-prem lze měřit (visible/hidden split); u edge PDF split
               neexistuje, proto se u edge sleduje jen DETEKCE (pdf_injection_text)

Použití:
  python detector/boundary_matrix.py [--no-remote] [--out docs/PDF-BOUNDARY-MATRIX.md]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import adversarial_pdf as adv  # noqa: E402
import hidden_text as ht  # noqa: E402

WORKER = "https://faxx-hr-detektor.maxferit.cz/scan"
# Cloudflare (Bot Fight Mode) blokuje Python-urllib UA → 403. Prohlížečový UA projde.
_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")

# Podpis injection payloadu — hledáme ho v extrahovaném textu (fold: bez diakritiky).
SIG = "nejlepsi kandid"


def _fold(s: str) -> str:
    import unicodedata
    out = []
    for ch in unicodedata.normalize("NFKD", s or ""):
        if unicodedata.combining(ch):
            continue
        out.append(ch)
    return "".join(out).lower()


def scan_local(path: str) -> dict:
    r = ht.scan(path)
    vis, hid = _fold(r.visible_text), _fold(r.hidden_text)
    flags = [{"type": f.type, "sev": f.severity, "loc": f.location} for f in r.flags]
    # relevantní = skrývací / injection flag (ne pdf_skipped)
    rel = [f for f in flags if f["type"] not in ("pdf_skipped",)]
    return {
        "ok": r.ok, "error": r.error,
        "flags": flags,
        "detected": bool(rel),
        "payload_in_visible": SIG in vis,       # NEBEZPEČÍ: doteklo by se AI
        "payload_in_hidden": SIG in hid,        # zadrženo do review
        "visible_chars": len(r.visible_text), "hidden_chars": len(r.hidden_text),
    }


def scan_remote(path: str, timeout: int = 45) -> dict:
    with open(path, "rb") as f:
        body = f.read()
    fname = os.path.basename(path)
    req = urllib.request.Request(
        WORKER, data=body, method="POST",
        headers={"X-Filename": urllib.parse.quote(fname),
                 "Content-Type": "application/octet-stream",
                 "User-Agent": _UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"{type(e).__name__}: {e}", "flags": [],
                "detected": False, "via": "-", "note": ""}
    flags = data.get("flags", [])
    note = data.get("note", "") or ""
    inj = [f for f in flags if f.get("type") == "pdf_injection_text"]
    # 'via' je uvnitř location flagu nebo v note ([extrakce: ...])
    via = "-"
    for f in flags:
        loc = f.get("location", "")
        if "cf-toMarkdown" in loc or "raw" in loc or "cf-md" in loc:
            via = loc.split("(")[-1].rstrip(")")
            break
    if via == "-" and "extrakce:" in note:
        via = note.split("extrakce:")[-1].split("]")[0].strip()
    return {"ok": True, "error": None, "flags": flags, "detected": bool(inj),
            "via": via, "note": note}


def run(no_remote: bool) -> list[dict]:
    tmp = tempfile.mkdtemp(prefix="faxxhr_adv_")
    manifest = adv.generate(tmp)
    rows = []
    for m in manifest:
        if not m["path"]:
            rows.append({**m, "skipped": True})
            continue
        local = scan_local(m["path"])
        remote = None if no_remote else scan_remote(m["path"])
        rows.append({**m, "local": local, "remote": remote, "skipped": False})
    return rows


# --- výstup ---------------------------------------------------------------
def _mark(b: bool) -> str:
    return "✅" if b else "❌"


def to_markdown(rows: list[dict], remote: bool) -> str:
    L = []
    L.append("# PDF boundary matrix — F0")
    L.append("")
    L.append("> Vygenerováno `detector/boundary_matrix.py` nad `detector/adversarial_pdf.py`.")
    L.append("> Reprodukce: `python detector/boundary_matrix.py`. Vektory jsou laboratorní,")
    L.append("> ne reálná CV — reálná held-out sada je jiná položka F0.")
    L.append("")
    L.append("**Legenda.** _on-prem_ = `detector/hidden_text.py` (PyMuPDF). "
             "_edge_ = živý Worker `/scan` (Cloudflare Workers AI toMarkdown + injection klasifikátor). "
             "**DET** = vrstva zvedla flag. **ZADRŽ** = payload se nedostal do `visible_text` "
             "(jen on-prem má split; u edge PDF split neexistuje → `n/a`).")
    L.append("")

    # --- spočítaný souhrn (reprodukovatelný, ne ručně psaný) ---------------
    atk = [r for r in rows if r["attack"] and not r.get("skipped")]
    leaks = [r["id"] for r in atk if r["local"]["payload_in_visible"]]          # proteklo do visible
    onprem_missed = [r["id"] for r in atk if not r["local"]["detected"]]        # on-prem nehlásí
    edge_missed = ([r["id"] for r in atk if not (r["remote"] and r["remote"]["ok"] and r["remote"]["detected"])]
                   if remote else [])
    both_silent = [r["id"] for r in atk if r["id"] in onprem_missed and r["id"] in edge_missed]
    # dosáhne modelu NEzachyceno = proteklo do on-prem visible_text A ani edge nehlásí
    reaches_ai = [r["id"] for r in atk if r["local"]["payload_in_visible"]
                  and (not remote or not (r["remote"] and r["remote"]["ok"] and r["remote"]["detected"]))]
    edge_fp = ([r["id"] for r in rows if not r["attack"] and not r.get("skipped")
                and r["remote"] and r["remote"]["ok"] and r["remote"]["detected"]] if remote else [])

    L.append("## Shrnutí")
    L.append("")
    L.append(f"- **Útočných vektorů:** {len(atk)} · **FP kontrol:** "
             f"{len([r for r in rows if not r['attack'] and not r.get('skipped')])}")
    L.append(f"- **Propluje k modelu nezachyceno napříč OBĚMA vrstvami:** "
             f"{('žádný ✅' if not reaches_ai else ', '.join('`'+x+'`' for x in reaches_ai))} "
             f"— defense-in-depth (on-prem split + edge klasifikátor).")
    L.append(f"- **on-prem protéká do `visible_text` (dostalo by se k AI):** "
             f"{('žádný ✅' if not leaks else ', '.join('`'+x+'`' for x in leaks))} "
             f"→ render-mode-3 / alfa 0 / offpage už zadrženy do `hidden_text`; zbývá jen "
             f"ToUnicode/cmap mismatch (V-PDF-06), kde displej≠extrakce — payload ve `visible_text` "
             f"jistí `visible_instruction_tone` (warn), hlubší glyf↔ToUnicode porovnání je odložené.")
    L.append(f"- **Nenahlásí ani jedna vrstva (transparency gap):** "
             f"{('žádný ✅' if not both_silent else ', '.join('`'+x+'`' for x in both_silent))} "
             f"→ XFA/AcroForm (V-PDF-07) i offpage teď na on-prem hlásí. JS/OpenAction (V-PDF-08) "
             f"jistí jen edge; na on-prem je zatím jen zadržen (payload se neextrahuje).")
    L.append(f"- **edge FP (viditelný legit text označen):** "
             f"{('žádný' if not edge_fp else ', '.join('`'+x+'`' for x in edge_fp))} "
             f"→ vědomý trade-off; on-prem i edge to teď hlásí jako mírnější `visible_instruction_tone` "
             f"(_warn_), oddělenou kategorii od skryté injection — rozhoduje člověk.")
    L.append("")

    # útoky
    L.append("## Útočné vektory (V-)")
    L.append("")
    L.append("| Vektor | Nosič | on-prem DET | on-prem ZADRŽ | edge DET | edge extrakce | on-prem flagy |")
    L.append("|---|---|:--:|:--:|:--:|---|---|")
    for r in rows:
        if not r["attack"]:
            continue
        if r.get("skipped"):
            L.append(f"| `{r['id']}` | {r['desc']} | — | — | — | _přeskočeno_ | — |")
            continue
        lo = r["local"]
        contained = not lo["payload_in_visible"]
        det_o = _mark(lo["detected"])
        zad_o = _mark(contained)
        types = ", ".join(sorted({f["type"] for f in lo["flags"]})) or "—"
        if remote and r["remote"]:
            det_e = _mark(r["remote"]["detected"]) if r["remote"]["ok"] else "⚠️err"
            via = r["remote"].get("via", "-")
        else:
            det_e, via = "—", "—"
        L.append(f"| `{r['id']}` | {r['desc']} | {det_o} | {zad_o} | {det_e} | {via} | {types} |")

    # FP kontroly
    L.append("")
    L.append("## FP kontroly (N-) — musí zůstat čisté (u edge sledujeme přeplácnutí)")
    L.append("")
    L.append("| Vektor | Popis | on-prem flagy | edge DET (pdf_injection_text) | edge note |")
    L.append("|---|---|:--:|:--:|---|")
    for r in rows:
        if r["attack"] or r.get("skipped"):
            continue
        lo = r["local"]
        onprem_types = ", ".join(sorted({f["type"] for f in lo["flags"]}))
        onprem_cell = "✅ clean" if not lo["detected"] else onprem_types
        if remote and r["remote"]:
            fp_e = ("🚩 FP" if r["remote"]["detected"] else "✅ čisto") if r["remote"]["ok"] else "⚠️err"
            note = (r["remote"].get("note", "") or "").replace("\n", " ")[:70]
        else:
            fp_e, note = "—", "—"
        L.append(f"| `{r['id']}` | {r['desc']} | {onprem_cell} | {fp_e} | {note} |")

    L.append("")
    L.append("## Poznámky k interpretaci")
    L.append("")
    L.append("- **on-prem ZADRŽ ✅** = payload skončil v `hidden_text` (nebo se vůbec "
             "neextrahoval) → nedostal by se do AI. To je hlavní bezpečnostní invariant.")
    L.append("- **edge** nemá u PDF visible/hidden split (na hraně chybí barva/pozice) → "
             "může jen DETEKOVAT injection v textu. Skrytí podle barvy/render-mode je proto "
             "delegováno na on-prem runner (viz DESIGN, DETECTOR-V2 §6).")
    L.append("- **N-PDF-02 (viditelná sebeprezentace)**: injection klasifikátor běží i na "
             "VIDITELNÉM textu, takže legitimní „jsem ideální kandidát“ označí. on-prem i edge to "
             "teď hlásí jako `visible_instruction_tone` (_warn_) — samostatnou, MÍRNĚJŠÍ kategorii "
             "oddělenou od skryté injection. Vědomý trade-off (raději warn než průnik), rozhoduje "
             "člověk. Skutečná FP kontrola „čisto“ je N-PDF-01.")
    L.append("")
    L.append("## Stav oprav (hardening z nálezů)")
    L.append("")
    L.append("1. ✅ **on-prem: render mode 3 zadržen do `hidden_text`.** `get_texttrace` označí "
             "spany s render mode Tr 3/7 (a nulovou alfou `ca 0`); jejich text jde do "
             "`hidden_text`, ne do `visible_text` (V-PDF-01, V-PDF-10). Hrubá `3 Tr` sonda "
             "zůstává jen jako fallback pro starší PyMuPDF bez `get_texttrace`.")
    L.append("2. 🟡 **on-prem: ToUnicode/cmap ↔ glyph mismatch** (V-PDF-06). Injection nad "
             "`visible_text` teď flagne payload jako `visible_instruction_tone` (warn) — jistí, "
             "že se člověk dozví. Payload ale ve `visible_text` **zůstává** (dosáhne modelu); "
             "hlubší oprava = porovnat vyrenderované glyfy s ToUnicode a nesoulad routovat do "
             "`hidden_text`. Zmírněno tím, že extrakce (LLM #1) plní jen pevné schéma bez skóre.")
    L.append("3. ✅ **on-prem: XFA/AcroForm + offpage.** XFA XML se čte přes catalog→AcroForm→XFA "
             "(stream i pole), přítomnost = `pdf_xfa` (warn), injection uvnitř = critical, obsah "
             "do `hidden_text` (V-PDF-07). Text zcela mimo mediabox, který `get_text` zahazuje, "
             "hlásí `pdf_offpage` z `get_texttrace` (V-PDF-04).")
    L.append("4. ✅ **edge FP → mírnější kategorie.** Instrukční tón ve viditelném textu je "
             "`visible_instruction_tone` (_warn_), oddělený od skryté injection (_critical_) — "
             "sníží únavu z falešných poplachů (N-PDF-02).")
    L.append("")
    L.append("## Zbývá")
    L.append("")
    L.append("- **V-PDF-06 do `hidden_text`**: glyf↔ToUnicode porovnání (payload teď ve "
             "`visible_text` zůstává, jen se warnuje).")
    L.append("- **V-PDF-08 JS/OpenAction na on-prem**: dnes jen zadržen (neextrahuje se), hlásí "
             "jen edge. Volitelně přidat flag „dokument obsahuje JavaScript“ (CV ho mít nemá).")
    L.append("- **Kalibrace prahů** (`CONTRAST_HIDDEN`, `MIN_FONT_PT`) na held-out sadě — jiná "
             "položka F0.")
    return "\n".join(L) + "\n"


def print_summary(rows: list[dict], remote: bool) -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    print("\n=== PDF BOUNDARY MATRIX (souhrn) ===\n")
    for r in rows:
        if r.get("skipped"):
            print(f"  {r['id']:30s}  PŘESKOČENO ({r['desc']})")
            continue
        lo = r["local"]
        tag = "ATTACK" if r["attack"] else "FP-CTRL"
        det_o = "DET" if lo["detected"] else "---"
        zad_o = "ZADRŽ" if not lo["payload_in_visible"] else "PRŮNIK!"
        if remote and r["remote"] and r["remote"]["ok"]:
            det_e = "DET" if r["remote"]["detected"] else "---"
            via = r["remote"].get("via", "-")
        else:
            det_e, via = "n/a", "-"
        print(f"  [{tag:7s}] {r['id']:28s} on-prem:{det_o}/{zad_o:8s} edge:{det_e:3s} ({via})")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-remote", action="store_true", help="jen lokální detektor")
    ap.add_argument("--out", default=None, help="zapsat markdown matici do souboru")
    args = ap.parse_args()
    remote = not args.no_remote
    rows = run(no_remote=args.no_remote)
    print_summary(rows, remote)
    if args.out:
        md = to_markdown(rows, remote)
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(md)
        print(f"\n→ matice zapsána: {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
