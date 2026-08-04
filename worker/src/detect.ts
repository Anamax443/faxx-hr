/**
 * faxx-hr — sdílený detekční modul (edge). Rozdělí dokument na viditelný /
 * skrytý text a vrátí flagy. Sem NEPATŘÍ hodnocení — jen split + detekce.
 *
 * Zdroj pravdy pro DOCX/PDF detekci na edge; importuje ho jak F0 upload demo
 * (worker/src/upload.ts), tak appka (worker/src/app.ts). Plná hloubková detekce
 * skrytí podle barvy/render-mode + OCR skenů je on-prem runner (detector/*.py).
 *
 * Port z detector/hidden_text.py v2 (viz docs/DETECTOR-V2.md).
 */
import { unzipSync, strFromU8, unzlibSync, inflateSync } from "fflate";

// Cloudflare Workers AI binding — toMarkdown převede PDF→text na CF infrastruktuře.
export interface DetectEnv {
  AI?: { toMarkdown: (docs: { name: string; blob: Blob }[]) => Promise<Array<{ name: string; data: string }>> };
}

export interface Flag {
  type: string;
  severity: "info" | "warn" | "critical";
  location: string;
  evidence: string;
  method: string;
}

// Jazyk lidsky čitelných řetezců (labely nálezů, poznámky). Logika je stejná.
export type Lang = "cs" | "en";
const L = (lang: Lang, cs: string, en: string): string => (lang === "en" ? en : cs);

// --- injection heuristika (jen eskalátor severity) -------------------------
const HIGH: Record<number, string> = { 0x8a: "s", 0x9a: "s", 0x8c: "s", 0x9c: "s", 0x8e: "z", 0x9e: "z", 0x9f: "y" };
export function fold(s: string): string {
  let r = "";
  for (const ch of (s || "").normalize("NFKD")) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x300 && c <= 0x36f) continue;
    if (c >= 0x80 && c <= 0x9f) r += HIGH[c] ?? " ";
    else r += ch;
  }
  return r.replace(/\s+/g, " ").toLowerCase();
}
const INJ =
  /ignore\s+(all\s+)?(the\s+)?(previous|prior|above)|disregard\s+(all\s+)?(the\s+)?(previous|prior|above)|ignoruj\s+(vsechn[ay]\s+)?predchoz|nevsimej\s+si\s+predchoz|system\s+prompt|\bas\s+an\s+ai\b|you\s+are\s+(an?\s+)?(ai|assistant|language\s+model|recruiter|screening)|jsi\s+(ai|jazykov|asistent|naborov)|(best|top|ideal|perfect|strongest)\s+candidate|nejlep(si|si)\s+(kandid|uchaze)|idealn[ií]\s+(kandid|uchaze)|highly\s+qualified|doporuc\w*\s+(k|na)\s+pohovor|(hire|interview)\s+(this|the)\s+candidate|(score|rating|rate|skore)\s*[:=]\s*\d{2,3}|(rate|score)\s+(this\s+)?(candidate|applicant)\s+(highly|100|maximum)/;
export const inj = (t: string): string | null => {
  const m = fold(t).match(INJ);
  return m ? m[0].slice(0, 120) : null;
};
// Manipulace SMĚŘOVANÁ NA AI/systém (bez pouhé sebeprezentace). Použije se u
// VIDITELNÉHO textu (PDF/vision), kde „jsem ideální kandidát" je legitimní názor,
// ale „ignoruj pokyny / ohodnoť mě 100 / jsi AI" je i viditelně podezřelé.
const INJ_OVERRIDE =
  /ignore\s+(all\s+)?(the\s+)?(previous|prior|above)|disregard\s+(all\s+)?(the\s+)?(previous|prior|above)|ignoruj\s+(vsechn[ay]\s+)?predchoz|nevsimej\s+si\s+predchoz|system\s+prompt|\bas\s+an\s+ai\b|you\s+are\s+(an?\s+)?(ai|assistant|language\s+model|recruiter|screening)|jsi\s+(ai|jazykov|asistent|naborov)|doporuc\w*\s+(k|na)\s+pohovor|(hire|interview)\s+(this|the)\s+candidate|(score|rating|rate|skore)\s*[:=]\s*\d{2,3}|(rate|score)\s+(this\s+)?(candidate|applicant)\s+(highly|100|maximum)/;
export const injOverride = (t: string): string | null => {
  const m = fold(t).match(INJ_OVERRIDE);
  return m ? m[0].slice(0, 120) : null;
};
// Pro VIDITELNÝ text hlásíme jen manipulaci na AI, ne běžnou sebeprezentaci.
export function injectionContext(text: string): string | null {
  const chunks = (text || "").split(/[\r\n]+/).flatMap((l) => l.split(/(?<=[.!?])\s+/));
  for (const c of chunks) {
    const t = c.trim();
    if (t && injOverride(t)) return t.slice(0, 300);
  }
  return injOverride(text) ? (text || "").replace(/\s+/g, " ").trim().slice(0, 300) : null;
}
function sevFor(txt: string, base: "info" | "warn" = "warn", lang: Lang = "cs"): ["info" | "warn" | "critical", string] {
  const hit = inj(txt);
  if (hit) return ["critical", `${L(lang, "[shoda: ", "[match: ")}${hit}] ${txt.slice(0, 180)}`];
  return [base, txt.slice(0, 180)];
}

// --- neviditelné Unicode nosiče --------------------------------------------
const INVIS = new Set([0x00ad, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0xfeff, 0x180e]);
const INVIS_RANGES: [number, number][] = [[0x202a, 0x202e], [0x2066, 0x2069], [0xe0000, 0xe007f], [0xfe00, 0xfe0f]];
function isInvisibleCp(cp: number): boolean {
  if (INVIS.has(cp)) return true;
  for (const [lo, hi] of INVIS_RANGES) if (cp >= lo && cp <= hi) return true;
  return false;
}
function stripInvisible(s: string): string {
  let out = "";
  for (const ch of s) if (!isInvisibleCp(ch.codePointAt(0)!)) out += ch;
  return out;
}
function decodeUnicodeTags(s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0xe0020 && cp <= 0xe007e) out += String.fromCharCode(cp - 0xe0000);
  }
  return out;
}
function invisibleCps(s: string): number[] {
  const r: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (isInvisibleCp(cp)) r.push(cp);
  }
  return r;
}

// --- barvy a WCAG kontrast --------------------------------------------------
type RGB = [number, number, number];
const NAMED: Record<string, RGB> = {
  yellow: [255, 255, 0], green: [0, 255, 0], cyan: [0, 255, 255], magenta: [255, 0, 255],
  blue: [0, 0, 255], red: [255, 0, 0], darkBlue: [0, 0, 139], darkCyan: [0, 139, 139],
  darkGreen: [0, 100, 0], darkMagenta: [139, 0, 139], darkRed: [139, 0, 0], darkYellow: [128, 128, 0],
  darkGray: [169, 169, 169], lightGray: [211, 211, 211], black: [0, 0, 0], white: [255, 255, 255],
};
function parseHex(v: string | null): RGB | null {
  if (!v) return null;
  const h = v.trim().replace(/^#/, "");
  if (h.toLowerCase() === "auto" || h.toLowerCase() === "none" || h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return [r, g, b].some(Number.isNaN) ? null : [r, g, b];
}
function luminance([r, g, b]: RGB): number {
  const ch = (c: number) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}
function contrast(fg: RGB, bg: RGB): number {
  const l1 = luminance(fg), l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
const CONTRAST_HIDDEN = 1.6, CONTRAST_LOW = 2.5, MIN_FONT_PT = 4.0, MIN_TEXT_LEN = 12;

// --- OOXML helpers (regex, ne DOM) -----------------------------------------
const unesc = (s: string): string =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");
function wtText(frag: string): string {
  const s = frag.replace(/<w:(tab|br|cr)\b[^>]*\/?>/g, " ");
  let out = "";
  const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out += unesc(m[1]);
  return out;
}
function rprOf(run: string): string {
  const m = run.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/);
  return m ? m[0] : "";
}
function valOf(rpr: string, tag: string): string | null {
  const m = rpr.match(new RegExp(`<w:${tag}\\b[^>]*\\bw:val="([^"]+)"`));
  return m ? m[1] : null;
}
function shdFill(rpr: string): string | null {
  const m = rpr.match(/<w:shd\b[^>]*\bw:fill="([^"]+)"/);
  return m && m[1].toLowerCase() !== "auto" ? m[1] : null;
}
function effectiveBg(rpr: string, docBg: RGB): RGB {
  const hl = valOf(rpr, "highlight");
  if (hl && NAMED[hl]) return NAMED[hl];
  const fill = parseHex(shdFill(rpr));
  return fill ?? docBg;
}
function docBackground(doc: string): RGB {
  const m = doc.match(/<w:background\b[^>]*\bw:color="([^"]+)"/);
  return parseHex(m ? m[1] : null) ?? [255, 255, 255];
}

export interface Out {
  flags: Flag[];
  visible: string;
  hidden: string;
}

function scanPart(xml: string, label: string, docBg: RGB, out: Out, lang: Lang): void {
  const kontrast = L(lang, "kontrast", "contrast");
  for (const run of xml.match(/<w:r\b[\s\S]*?<\/w:r>/g) || []) {
    const rpr = rprOf(run);
    const raw = wtText(run);
    const txt = stripInvisible(raw).trim();

    const hiddenCps = invisibleCps(raw);
    if (hiddenCps.length >= 3) {
      const tags = decodeUnicodeTags(raw);
      const [sev] = sevFor(tags || "", "warn", lang);
      const payload = tags || `${hiddenCps.length} ${L(lang, "neviditelných kódových bodů", "invisible code points")}`;
      out.flags.push({ type: "unicode_invisible", severity: sev, location: label, evidence: payload.slice(0, 150), method: "deterministic" });
      if (tags) out.hidden += tags + "\n";
    }
    if (!txt) continue;

    const vm = rpr.match(/<w:(?:vanish|specVanish|webHidden)\b([^>]*)\/?>/);
    if (vm && !/w:val="(?:false|0|off)"/i.test(vm[1])) {
      const [sev, ev] = sevFor(txt, "warn", lang);
      out.flags.push({ type: "docx_vanish", severity: sev, location: `${label} (w:vanish)`, evidence: ev, method: "deterministic" });
      out.hidden += txt + "\n";
      continue;
    }

    const bg = effectiveBg(rpr, docBg);
    let fg = parseHex(valOf(rpr, "color"));
    if (!fg) fg = luminance(bg) > 0.5 ? [0, 0, 0] : [255, 255, 255];
    const ratio = contrast(fg, bg);
    const szVal = valOf(rpr, "sz");
    const size = szVal ? parseFloat(szVal) / 2 : null;
    const hex = (c: RGB) => `#${c.map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase()}`;

    if (ratio < CONTRAST_HIDDEN) {
      const [sev, ev] = sevFor(txt, "warn", lang);
      out.flags.push({ type: "docx_low_contrast", severity: sev, location: `${label} (${hex(fg)} ${L(lang, "na", "on")} ${hex(bg)}, ${kontrast} ${ratio.toFixed(2)}:1)`, evidence: ev, method: "deterministic" });
      out.hidden += txt + "\n";
      continue;
    }
    if (size !== null && size < MIN_FONT_PT) {
      const [sev, ev] = sevFor(txt, "warn", lang);
      out.flags.push({ type: "docx_tiny_font", severity: sev, location: `${label} (${size.toFixed(1)} pt)`, evidence: ev, method: "deterministic" });
      out.hidden += txt + "\n";
      continue;
    }
    if (ratio < CONTRAST_LOW) {
      out.flags.push({ type: "docx_faint_text", severity: "info", location: `${label} (${kontrast} ${ratio.toFixed(2)}:1)`, evidence: txt.slice(0, 180), method: "deterministic" });
    }
    out.visible += txt + " ";
  }
}

export function scanDocx(buf: Uint8Array, lang: Lang = "cs"): Out {
  const out: Out = { flags: [], visible: "", hidden: "" };
  const zip = unzipSync(buf);
  const get = (n: string): string | null => (zip[n] ? strFromU8(zip[n]) : null);

  const doc = get("word/document.xml");
  let docBg: RGB = [255, 255, 255];
  if (doc) {
    docBg = docBackground(doc);
    scanPart(doc, L(lang, "hlavní tok", "main body"), docBg, out, lang);
    for (const am of doc.matchAll(/\b(?:descr|title)="([^"]+)"/g)) {
      const v = unesc(am[1]).trim();
      if (inj(v)) {
        const [sev, ev] = sevFor(v, "warn", lang);
        out.flags.push({ type: "docx_alt_text", severity: sev, location: L(lang, "word/document.xml (alt-text obrázku)", "word/document.xml (image alt text)"), evidence: ev, method: "deterministic" });
        out.hidden += v + "\n";
      }
    }
  }
  for (const name of Object.keys(zip)) {
    if (/^word\/(header|footer)\d*\.xml$/.test(name)) {
      const label = name.includes("header") ? L(lang, "hlavička", "header") : L(lang, "patička", "footer");
      const part = get(name);
      if (part) scanPart(part, label, docBg, out, lang);
    }
  }
  const annParts: [string, string][] = [
    ["word/comments.xml", L(lang, "komentář", "comment")],
    ["word/footnotes.xml", L(lang, "poznámka pod čarou", "footnote")],
    ["word/endnotes.xml", L(lang, "vysvětlivka", "endnote")],
  ];
  for (const [part, label] of annParts) {
    const x = get(part);
    if (x) {
      const t = stripInvisible(wtText(x)).trim();
      if (t.length >= MIN_TEXT_LEN) {
        const [sev, ev] = sevFor(t, "info", lang);
        out.flags.push({ type: "docx_annotation", severity: sev, location: `${part} (${label})`, evidence: ev, method: "deterministic" });
        out.hidden += t + "\n";
      }
    }
  }
  for (const part of ["docProps/core.xml", "docProps/app.xml", "docProps/custom.xml"]) {
    const x = get(part);
    if (x) {
      const t = stripInvisible(unesc(x.replace(/<[^>]+>/g, " "))).replace(/\s+/g, " ").trim();
      if (inj(t)) {
        const [sev, ev] = sevFor(t, "warn", lang);
        out.flags.push({ type: "docx_metadata", severity: sev, location: part, evidence: ev, method: "deterministic" });
        out.hidden += t + "\n";
      }
    }
  }
  return out;
}

// --- PDF: dekomprese FlateDecode streamů + extrakce textu -------------------
function inflate(bytes: Uint8Array): Uint8Array | null {
  try { return unzlibSync(bytes); } catch { try { return inflateSync(bytes); } catch { return null; } }
}
function unescapePdf(s: string): string {
  const map: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, c) => (c in map ? map[c] : String.fromCharCode(parseInt(c, 8) & 0xff)));
}
function contentText(s: string): string {
  let t = "";
  const lit = /\(((?:[^()\\]|\\.)*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = lit.exec(s))) t += unescapePdf(m[1]) + " ";
  return t;
}
function pdfText(buf: Uint8Array): string {
  const raw = strFromU8(buf, true);
  let out = "";
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) continue;
    const header = raw.slice(Math.max(0, m.index - 400), m.index);
    let dEnd = end;
    while (dEnd > start && (raw.charCodeAt(dEnd - 1) === 0x0a || raw.charCodeAt(dEnd - 1) === 0x0d)) dEnd--;
    let data = buf.subarray(start, dEnd);
    if (/\/FlateDecode/.test(header)) {
      const inf = inflate(data);
      if (!inf) continue;
      data = inf;
    }
    out += " " + contentText(strFromU8(data, true));
  }
  return out + " " + contentText(raw);
}
// toMarkdown přidává na začátek hlavičku "# soubor\n## Metadata\n- key=val…" —
// pro člověka i AI je to šum, odstraníme ji (jen když je přesně v tomto tvaru).
function stripMdMeta(md: string): string {
  let s = md.replace(/^﻿/, "");
  s = s.replace(/^#[^\n]*\n+/, "");                     // úvodní nadpis (název souboru)
  s = s.replace(/^##\s*Metadata\s*\n(?:\s*-[^\n]*\n?)*/i, ""); // blok metadat
  return s.trim();
}

export async function extractPdfText(buf: Uint8Array, fname: string, env: DetectEnv): Promise<{ text: string; raw: string; via: string; err?: string }> {
  const via: string[] = [];
  let err: string | undefined;
  let md = "";
  if (env?.AI?.toMarkdown) {
    try {
      const res = await env.AI.toMarkdown([{ name: fname || "cv.pdf", blob: new Blob([buf], { type: "application/pdf" }) }]);
      md = Array.isArray(res) ? stripMdMeta(res.map((r) => r?.data || "").join("\n")) : "";
      via.push(md.trim() ? "cf-toMarkdown" : "cf-md:0");
    } catch (e: unknown) {
      err = String((e as { message?: string })?.message || e).slice(0, 180);
      via.push("cf-md:ERR");
    }
  }
  // raw fflate extraktor slouží k injection skenu; jako VIDITELNÝ text jen když
  // toMarkdown nic nevrátí — u PDF s vloženými fonty (Word/reportlab) dává glyf-smetí.
  let raw = "";
  try { raw = pdfText(buf); } catch { /* nic */ }
  let text = md.trim();
  if (!text) { text = raw.trim(); if (text) via.push("raw"); }
  return { text, raw, via: via.join("+") || "none", err };
}

// --- veřejné API: jeden dokument → split + flagy ---------------------------
export interface ScanDocResult {
  filename: string;
  ext: string;
  flags: Flag[];
  visible: string;
  hidden: string;
  visibleChars: number;
  hiddenChars: number;
  note: string;
}

export async function scanDocument(fname: string, buf: Uint8Array, env: DetectEnv, lang: Lang = "cs"): Promise<ScanDocResult> {
  const ext = (fname.split(".").pop() || "").toLowerCase();
  const res: ScanDocResult = { filename: fname, ext, flags: [], visible: "", hidden: "", visibleChars: 0, hiddenChars: 0, note: "" };
  try {
    if (ext === "docx") {
      const out = scanDocx(buf, lang);
      res.flags = out.flags;
      res.visible = out.visible.trim();
      res.hidden = out.hidden.trim();
    } else if (ext === "pdf") {
      const { text, raw, via, err } = await extractPdfText(buf, fname, env);
      res.visible = text.trim();
      // injection hledáme ve viditelném textu I v raw extrakci (union) — ale raw už do visible NEjde
      const ctx = injectionContext(text) || (raw && raw !== text ? injectionContext(raw) : null);
      if (ctx) res.flags.push({ type: "pdf_injection_text", severity: "warn", location: L(lang, `PDF (textová vrstva, ${via})`, `PDF (text layer, ${via})`), evidence: L(lang, "nalezená pasáž: „", "found passage: “") + ctx + (lang === "en" ? "”" : "“"), method: "classifier" });
      const base = ctx
        ? L(lang, "Nalezen text instrukčního charakteru (čte se i neviditelné bílé písmo s textovou vrstvou). Hloubkovou detekci skrytí podle barvy doplní on-prem runner.", "Found instruction-like text (invisible white text with a text layer is read too). Deep colour-based hiding detection is added by the on-prem runner.")
        : text.trim()
        ? L(lang, "PDF: přečtena textová vrstva, nic instrukčního nenalezeno. Detekci skrytí podle barvy doplní on-prem.", "PDF: text layer read, nothing instruction-like found. Colour-based hiding detection is added on-prem.")
        : L(lang, "PDF: textovou vrstvu se nepodařilo přečíst (naskenované CV / chyba parseru) → OCR/vision na on-prem runneru.", "PDF: could not read the text layer (scanned CV / parser error) → OCR/vision on the on-prem runner.");
      res.note = `${base} [${L(lang, "extrakce", "extraction")}: ${via}${err ? " · " + L(lang, "chyba", "error") + ": " + err : ""}]`;
    } else if (["jpg", "jpeg", "png", "webp", "gif", "bmp", "tiff"].includes(ext)) {
      res.note = L(lang, "Obrázek/sken — čtení textu (OCR/vision) zatím není dostupné. Kandidát se nevyhodnotí; převeď CV do PDF/DOCX s textovou vrstvou.", "Image/scan — text reading (OCR/vision) not available here. Candidate cannot be scored; convert the CV to PDF/DOCX with a text layer.");
      res.flags.push({ type: "needs_ocr", severity: "info", location: L(lang, "soubor (obrázek)", "file (image)"), evidence: res.note, method: "n/a" });
    } else {
      res.note = L(lang, "Podporováno: .docx (plná v2 detekce), .pdf (dekomprese + injection sken), obrázky jen upozornění (OCR přijde).", "Supported: .docx (full v2 detection), .pdf (decompression + injection scan), images warn only (OCR to come).");
    }
  } catch (e: unknown) {
    res.note = L(lang, "chyba při čtení souboru: ", "error reading file: ") + ((e as { message?: string })?.message || String(e));
  }
  res.visibleChars = res.visible.length;
  res.hiddenChars = res.hidden.length;
  return res;
}
