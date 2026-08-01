/**
 * faxx-hr — upload Worker (F0, živá verze na Cloudflare). Detekce v2.
 *
 *  - DOCX: WCAG kontrast vůči skutečnému pozadí (highlight/shd/background),
 *    Unicode nosiče (zero-width/bidi/Tags E0000+), hlavičky/patičky, vanish,
 *    mikropísmo. Regex je jen ESKALÁTOR severity, ne brána detekce.
 *    Vrací visible_text (→ AI vrstva) a hidden_text (→ jen review).
 *  - PDF: dekomprese FlateDecode streamů + injection klasifikátor. Hloubková
 *    detekce SKRYTÍ (render mode, CID glyfy) zůstává pro on-prem runner (PyMuPDF).
 *
 * Port z detector/hidden_text.py v2. Deploy: wrangler deploy -c wrangler.upload.jsonc
 */
import { unzipSync, strFromU8, unzlibSync, inflateSync } from "fflate";
import { extractText, getDocumentProxy } from "unpdf";

// build stamp — injektuje se přes wrangler --define při deployi (scripts/deploy-upload.mjs)
declare const __COMMIT__: string;
declare const __COMMIT_FULL__: string;
declare const __BUILT__: string;
const COMMIT = typeof __COMMIT__ !== "undefined" ? __COMMIT__ : "dev";
const COMMIT_FULL = typeof __COMMIT_FULL__ !== "undefined" ? __COMMIT_FULL__ : "";
const BUILT = typeof __BUILT__ !== "undefined" ? __BUILT__ : "local";

interface Flag {
  type: string;
  severity: "info" | "warn" | "critical";
  location: string;
  evidence: string;
  method: string;
}

// --- injection heuristika (jen eskalátor severity) -------------------------
const HIGH: Record<number, string> = { 0x8a: "s", 0x9a: "s", 0x8c: "s", 0x9c: "s", 0x8e: "z", 0x9e: "z", 0x9f: "y" };
function fold(s: string): string {
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
const inj = (t: string): string | null => {
  const m = fold(t).match(INJ);
  return m ? m[0].slice(0, 120) : null;
};
function sevFor(txt: string, base: "info" | "warn" = "warn"): ["info" | "warn" | "critical", string] {
  const hit = inj(txt);
  if (hit) return ["critical", `[shoda: ${hit}] ${txt.slice(0, 180)}`];
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

interface Out {
  flags: Flag[];
  visible: string;
  hidden: string;
}

function scanPart(xml: string, label: string, docBg: RGB, out: Out): void {
  for (const run of xml.match(/<w:r\b[\s\S]*?<\/w:r>/g) || []) {
    const rpr = rprOf(run);
    const raw = wtText(run);
    const txt = stripInvisible(raw).trim();

    // 1) neviditelné Unicode nosiče
    const hiddenCps = invisibleCps(raw);
    if (hiddenCps.length >= 3) {
      const tags = decodeUnicodeTags(raw);
      const [sev] = sevFor(tags || "", "warn");
      const payload = tags || `${hiddenCps.length} neviditelných kódových bodů`;
      out.flags.push({ type: "unicode_invisible", severity: sev, location: label, evidence: payload.slice(0, 150), method: "deterministic" });
      if (tags) out.hidden += tags + "\n";
    }
    if (!txt) continue;

    // 2) explicitní skrytí
    const vm = rpr.match(/<w:(?:vanish|specVanish|webHidden)\b([^>]*)\/?>/);
    if (vm && !/w:val="(?:false|0|off)"/i.test(vm[1])) {
      const [sev, ev] = sevFor(txt);
      out.flags.push({ type: "docx_vanish", severity: sev, location: `${label} (w:vanish)`, evidence: ev, method: "deterministic" });
      out.hidden += txt + "\n";
      continue;
    }

    // 3) kontrast vůči skutečnému pozadí
    const bg = effectiveBg(rpr, docBg);
    let fg = parseHex(valOf(rpr, "color"));
    if (!fg) fg = luminance(bg) > 0.5 ? [0, 0, 0] : [255, 255, 255];
    const ratio = contrast(fg, bg);
    const szVal = valOf(rpr, "sz");
    const size = szVal ? parseFloat(szVal) / 2 : null;

    const hex = (c: RGB) => `#${c.map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
    if (ratio < CONTRAST_HIDDEN) {
      const [sev, ev] = sevFor(txt);
      out.flags.push({ type: "docx_low_contrast", severity: sev, location: `${label} (${hex(fg)} na ${hex(bg)}, kontrast ${ratio.toFixed(2)}:1)`, evidence: ev, method: "deterministic" });
      out.hidden += txt + "\n";
      continue;
    }
    if (size !== null && size < MIN_FONT_PT) {
      const [sev, ev] = sevFor(txt);
      out.flags.push({ type: "docx_tiny_font", severity: sev, location: `${label} (${size.toFixed(1)} pt)`, evidence: ev, method: "deterministic" });
      out.hidden += txt + "\n";
      continue;
    }
    if (ratio < CONTRAST_LOW) {
      out.flags.push({ type: "docx_faint_text", severity: "info", location: `${label} (kontrast ${ratio.toFixed(2)}:1)`, evidence: txt.slice(0, 180), method: "deterministic" });
    }
    out.visible += txt + " ";
  }
}

function scanDocx(buf: Uint8Array): Out {
  const out: Out = { flags: [], visible: "", hidden: "" };
  const zip = unzipSync(buf);
  const get = (n: string): string | null => (zip[n] ? strFromU8(zip[n]) : null);

  const doc = get("word/document.xml");
  let docBg: RGB = [255, 255, 255];
  if (doc) {
    docBg = docBackground(doc);
    scanPart(doc, "hlavní tok", docBg, out);
    // alt-texty a názvy obrázků — sighted čtenář je nevidí
    for (const am of doc.matchAll(/\b(?:descr|title)="([^"]+)"/g)) {
      const v = unesc(am[1]).trim();
      if (v.length >= MIN_TEXT_LEN) {
        const [sev, ev] = sevFor(v, "info");
        out.flags.push({ type: "docx_alt_text", severity: sev, location: "word/document.xml (alt-text obrázku)", evidence: ev, method: "deterministic" });
        out.hidden += v + "\n";
      }
    }
  }

  // hlavičky a patičky
  for (const name of Object.keys(zip)) {
    if (/^word\/(header|footer)\d*\.xml$/.test(name)) {
      const label = name.includes("header") ? "hlavička" : "patička";
      const part = get(name);
      if (part) scanPart(part, label, docBg, out);
    }
  }

  // části pro člověka NEVIDITELNÉ — flag na přítomnost, regex jen eskaluje
  for (const [part, label] of [["word/comments.xml", "komentář"], ["word/footnotes.xml", "poznámka pod čarou"], ["word/endnotes.xml", "vysvětlivka"]] as [string, string][]) {
    const x = get(part);
    if (x) {
      const t = stripInvisible(wtText(x)).trim();
      if (t.length >= MIN_TEXT_LEN) {
        const [sev, ev] = sevFor(t, "info");
        out.flags.push({ type: "docx_annotation", severity: sev, location: `${part} (${label})`, evidence: ev, method: "deterministic" });
        out.hidden += t + "\n";
      }
    }
  }
  for (const part of ["docProps/core.xml", "docProps/app.xml", "docProps/custom.xml"]) {
    const x = get(part);
    if (x) {
      const t = stripInvisible(unesc(x.replace(/<[^>]+>/g, " "))).replace(/\s+/g, " ").trim();
      if (t.length >= MIN_TEXT_LEN) {
        const [sev, ev] = sevFor(t, "info");
        out.flags.push({ type: "docx_metadata", severity: sev, location: part, evidence: ev, method: "deterministic" });
        out.hidden += t + "\n";
      }
    }
  }
  return out;
}

// --- PDF: dekomprese FlateDecode streamů + extrakce textu -------------------
function inflate(bytes: Uint8Array): Uint8Array | null {
  try {
    return unzlibSync(bytes);
  } catch {
    try {
      return inflateSync(bytes);
    } catch {
      return null;
    }
  }
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

// Text z PDF dvěma cestami a injekci hledáme ve SJEDNOCENÍ:
//  - unpdf (pdf.js) čte textovou vrstvu přes ToUnicode/CID fonty (Word export,
//    i neviditelné bílé písmo, které má textovou vrstvu)
//  - ruční fflate extraktor pokryje edge případy s nestandardním kódováním
async function extractPdfText(buf: Uint8Array): Promise<{ text: string; via: string }> {
  const parts: string[] = [];
  const via: string[] = [];
  try {
    const pdf = await getDocumentProxy(buf.slice()); // kopie: pdf.js jinak odpojí buffer
    const { text } = await extractText(pdf, { mergePages: true });
    const t = Array.isArray(text) ? text.join("\n") : text || "";
    if (t.trim()) {
      parts.push(t);
      via.push("pdf.js");
    }
  } catch {
    /* pokračuj ručním */
  }
  try {
    const raw = pdfText(buf);
    if (raw.trim()) {
      parts.push(raw);
      via.push("raw");
    }
  } catch {
    /* nic */
  }
  return { text: parts.join("\n"), via: via.join("+") || "none" };
}

const PAGE = `<!DOCTYPE html><html lang="cs"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>faxx-hr — upload CV (F0)</title>
<style>
:root{--bg:#0d1424;--panel:#141d33;--panel2:#1b2740;--line:#26324f;--txt:#e6edf7;
--muted:#8da2c4;--accent:#3fd6a0;--amber:#f0b429;--red:#f0556b;--blue:#5aa9f0}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);
font:15px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
.wrap{max-width:820px;margin:0 auto;padding:36px 22px 70px}
h1{font-size:22px;margin:0}.sub{color:var(--muted);margin:4px 0 22px}
.drop{border:2px dashed var(--line);border-radius:14px;padding:44px 20px;text-align:center;
background:var(--panel);cursor:pointer;transition:.15s}
.drop.hot{border-color:var(--accent);background:rgba(63,214,160,.06)}
.drop b{font-size:16px}.drop p{color:var(--muted);margin:8px 0 0;font-size:13px}
input[type=file]{display:none}
.res{margin-top:22px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:12px}
.sum{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.pill{font-size:12px;font-weight:700;padding:4px 11px;border-radius:999px}
.pill.ok{color:var(--accent);background:rgba(63,214,160,.12)}
.pill.bad{color:var(--red);background:rgba(240,85,107,.12)}
.split{color:var(--muted);font-size:12px;margin-top:8px}
.split b{color:var(--txt)}
.flag{display:flex;gap:10px;padding:11px 12px;border-radius:9px;margin-top:9px;font-size:13px;align-items:flex-start}
.flag.critical{background:rgba(240,85,107,.09);border:1px solid #5a2430}
.flag.warn{background:rgba(240,180,41,.08);border:1px solid #5a4a18}
.flag.info{background:rgba(90,169,240,.07);border:1px solid #274a6b}
.flag .b{font-weight:600}.flag code{background:var(--panel2);padding:1px 6px;border-radius:5px;font-size:12px}
.flag q{color:var(--txt);font-style:italic}
.note{color:var(--amber);font-size:13px;margin-top:8px}
.f0{margin-top:20px;color:var(--muted);font-size:12px;text-align:center}
.build{margin-top:6px;color:var(--muted);opacity:.55;font-size:11px;text-align:center;font-family:ui-monospace,Consolas,monospace}
.build span{cursor:help}
.ver{margin:6px 0 0;color:var(--muted);font-size:12px;font-family:ui-monospace,Consolas,monospace}
.ver b{color:var(--accent);font-weight:600;cursor:help}
a{color:var(--accent)}
</style></head><body><div class="wrap">
<h1>🛡️ faxx-hr — upload CV <span style="color:var(--muted);font-size:13px">(F0 · v2 · živě na Cloudflare)</span></h1>
<div class="ver">commit <b title="${COMMIT_FULL}">${COMMIT}</b> · build ${BUILT}</div>
<p class="sub">Přetáhni PDF nebo Word (.docx). Skrytý text se oddělí od viditelného; do „AI vrstvy" by šel jen viditelný. Soubor se zpracuje v paměti a neukládá se.</p>
<label class="drop" id="drop">
  <b>Přetáhni sem CV</b> nebo klikni pro výběr
  <p>PDF · DOCX</p>
  <input type="file" id="file" accept=".pdf,.docx">
</label>
<div class="res" id="res"></div>
<div class="f0">DOCX: WCAG kontrast, Unicode nosiče, hlavičky/patičky, visible/hidden split. PDF: čtení textové vrstvy (pdf.js) + injection sken; detekce skrytí podle barvy = on-prem F1.</div>
<div class="build">faxx-hr · v2 · commit <span title="${COMMIT_FULL}">${COMMIT}</span> · build ${BUILT}</div>
</div>
<script>
const drop=document.getElementById('drop'),file=document.getElementById('file'),res=document.getElementById('res');
['dragenter','dragover'].forEach(e=>drop.addEventListener(e,ev=>{ev.preventDefault();drop.classList.add('hot')}));
['dragleave','drop'].forEach(e=>drop.addEventListener(e,ev=>{ev.preventDefault();drop.classList.remove('hot')}));
drop.addEventListener('drop',ev=>{if(ev.dataTransfer.files[0])send(ev.dataTransfer.files[0])});
file.addEventListener('change',()=>{if(file.files[0])send(file.files[0])});
function esc(s){return (s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
function send(f){
  res.innerHTML='<div class="card">⏳ Skenuji <b>'+esc(f.name)+'</b>…</div>';
  fetch('/scan',{method:'POST',headers:{'X-Filename':encodeURIComponent(f.name)},body:f})
   .then(r=>r.json()).then(render).catch(e=>res.innerHTML='<div class="card">Chyba: '+esc(''+e)+'</div>');
}
function render(d){
  const n=d.flags.length, crit=d.flags.filter(x=>x.severity==='critical').length;
  let h='<div class="card"><div class="sum"><b>'+esc(decodeURIComponent(d.filename))+'</b>';
  h+= n? '<span class="pill bad">'+n+' nálezů'+(crit?' · '+crit+'× critical':'')+'</span>'
       : '<span class="pill ok">✓ čisto — žádný skrytý/injection obsah</span>';
  h+='</div>';
  if(d.visible_chars!==undefined)
    h+='<div class="split">viditelný text <b>'+d.visible_chars+'</b> zn. (→ AI vrstva) · skrytý <b>'+d.hidden_chars+'</b> zn. (→ jen review)</div>';
  if(d.note) h+='<div class="note">⚠ '+esc(d.note)+'</div>';
  for(const x of d.flags){
    const ico=x.severity==='critical'?'⛔':x.severity==='warn'?'⚠️':'ℹ️';
    h+='<div class="flag '+x.severity+'"><span>'+ico+'</span><div>'+
       '<span class="b">'+esc(x.type)+'</span> · <code>'+esc(x.location)+'</code>'+
       '<br><q>'+esc(x.evidence)+'</q></div></div>';
  }
  h+='</div>';
  res.innerHTML=h;
}
</script></body></html>`;

export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (req.method === "POST" && url.pathname === "/scan") {
      const fname = decodeURIComponent(req.headers.get("X-Filename") || "upload.bin");
      const ext = (fname.split(".").pop() || "").toLowerCase();
      const buf = new Uint8Array(await req.arrayBuffer());
      const result: { filename: string; flags: Flag[]; note: string; visible_chars?: number; hidden_chars?: number } = { filename: fname, flags: [], note: "" };
      try {
        if (ext === "docx") {
          const out = scanDocx(buf);
          result.flags = out.flags;
          result.visible_chars = out.visible.trim().length;
          result.hidden_chars = out.hidden.trim().length;
        } else if (ext === "pdf") {
          const { text, via } = await extractPdfText(buf);
          const h = inj(text);
          if (h) result.flags.push({ type: "pdf_injection_text", severity: "warn", location: `PDF (textová vrstva, ${via})`, evidence: "instrukční text: „" + h + "“", method: "classifier" });
          result.note = h
            ? "Nalezen text instrukčního charakteru (čte se i neviditelné bílé písmo, které má textovou vrstvu). Detekci SKRYTÍ podle barvy/render mode/pozice doplní on-prem runner (PyMuPDF)."
            : text.trim()
            ? `PDF: přečtena textová vrstva (${via}), nic instrukčního nenalezeno. Detekci skrytí podle barvy doplní on-prem (F1).`
            : "PDF: textovou vrstvu se nepodařilo přečíst (naskenované/obrázkové CV) → OCR/vision na on-prem runneru (F1).";
        } else {
          result.note = "Podporováno: .docx (plná v2 detekce), .pdf (dekomprese + injection sken).";
        }
      } catch (e: any) {
        result.note = "chyba při čtení souboru: " + (e?.message || String(e));
      }
      return Response.json(result);
    }
    return new Response("faxx-hr upload — GET / pro stránku", { status: 404 });
  },
};
