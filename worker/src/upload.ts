/**
 * faxx-hr — upload Worker (F0, živá verze na Cloudflare).
 *
 * Stejná funkčnost jako lokální detector/serve.py: drag&drop PDF/DOCX → detekce
 * skrytého / injection textu.
 *  - DOCX: detekce portovaná 1:1 do TS (ZIP přes fflate + XML) → identická s Python jádrem.
 *  - PDF:  dekomprese FlateDecode streamů + extrakce textu + injection klasifikátor.
 *          Hloubková detekce SKRYTÍ (delta E, render mode, CID/Identity-H fonty,
 *          dual-path) běží až ve F1 na on-prem runneru (PyMuPDF).
 *
 * Bez bindings (D1/R2 se přidají ve F1). Deploy: wrangler deploy -c wrangler.upload.jsonc
 */
import { unzipSync, strFromU8, unzlibSync, inflateSync } from "fflate";

interface Flag {
  type: string;
  severity: "info" | "warn" | "critical";
  location: string;
  evidence: string;
  method: string;
}

// "text vypadá jako instrukce pro AI". Text se nejdřív foldne (NFD + odstranění
// diakritiky + přibližné mapování WinAnsi/CP1250 vysokých bajtů dekódovaných jako
// latin1), aby detekce fungovala napříč kódováními PDF/DOCX. Vzory jsou ASCII.
const HIGH: Record<number, string> = { 0x8a: "s", 0x9a: "s", 0x8c: "s", 0x9c: "s", 0x8e: "z", 0x9e: "z", 0x9f: "y" };
function fold(s: string): string {
  let r = "";
  for (const ch of (s || "").normalize("NFD")) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x300 && c <= 0x36f) continue; // odstranění kombinujících diakritických znamének
    if (c >= 0x80 && c <= 0x9f) r += HIGH[c] ?? " "; // WinAnsi/CP1250 speciály (latin1-decoded)
    else r += ch;
  }
  return r.toLowerCase();
}
const INJ =
  /ignore (all )?(the )?previous|disregard (all )?(the )?previous|ignoruj (vsechny )?predchoz|nevsimej si predchoz|best candidate|top candidate|ideal candidate|nejlep\w* kandid|idealn\w* kandid|strongly recommend|must recommend|doporuc|hire (this|the) candidate|as an ai|you are (an|a|the)|system prompt|jsi (nejlep|ideal)/;
const inj = (t: string): string | null => {
  const m = fold(t).match(INJ);
  return m ? m[0] : null;
};

const unesc = (s: string): string =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, "&");

function textOf(xml: string): string {
  const out: string[] = [];
  const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(unesc(m[1]));
  return out.join("");
}

function nearWhite(hex: string | undefined): boolean {
  if (!hex || hex.toLowerCase() === "auto") return false;
  const h = hex.replace("#", "");
  if (h.length !== 6) return false;
  const r = parseInt(h.slice(0, 2), 16),
    g = parseInt(h.slice(2, 4), 16),
    b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return false;
  return Math.min(r, g, b) >= 0xf0; // zachytí i #FEFEFE
}

function scanDocx(buf: Uint8Array): Flag[] {
  const flags: Flag[] = [];
  const zip = unzipSync(buf);
  const get = (n: string): string | null => (zip[n] ? strFromU8(zip[n]) : null);

  const doc = get("word/document.xml");
  if (doc) {
    for (const run of doc.match(/<w:r\b[\s\S]*?<\/w:r>/g) || []) {
      const txt = textOf(run).trim();
      if (!txt) continue;
      const vm = run.match(/<w:vanish\b([^>]*)\/?>/);
      if (vm && !/w:val="(?:false|0|off)"/i.test(vm[1])) {
        flags.push({ type: "docx_vanish", severity: inj(txt) ? "critical" : "warn", location: "word/document.xml (w:vanish)", evidence: txt.slice(0, 200), method: "deterministic" });
        continue;
      }
      const cm = run.match(/<w:color\b[^>]*w:val="([0-9A-Fa-f]{6}|auto)"/);
      if (cm && nearWhite(cm[1])) {
        flags.push({ type: "docx_white_font", severity: inj(txt) ? "critical" : "warn", location: `word/document.xml (w:color=${cm[1]})`, evidence: txt.slice(0, 200), method: "deterministic" });
      }
    }
    let dm: RegExpExecArray | null;
    const descRe = /\bdescr="([^"]+)"/g;
    while ((dm = descRe.exec(doc))) {
      const v = unesc(dm[1]);
      if (inj(v)) flags.push({ type: "docx_alt_text", severity: "warn", location: "word/document.xml (alt-text obrázku)", evidence: v.slice(0, 200), method: "deterministic" });
    }
  }

  for (const [part, label] of [["word/comments.xml", "komentář"], ["word/footnotes.xml", "poznámka pod čarou"], ["word/endnotes.xml", "vysvětlivka"]] as [string, string][]) {
    const x = get(part);
    if (x) {
      const t = textOf(x).trim();
      if (t) flags.push({ type: "docx_annotation", severity: inj(t) ? "warn" : "info", location: `${part} (${label})`, evidence: t.slice(0, 200), method: "deterministic" });
    }
  }

  for (const part of ["docProps/core.xml", "docProps/app.xml", "docProps/custom.xml"]) {
    const x = get(part);
    if (x) {
      const t = unesc(x.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
      const h = inj(t);
      if (h) flags.push({ type: "docx_metadata", severity: "warn", location: part, evidence: (h + " … " + t).slice(0, 200), method: "deterministic" });
    }
  }
  return flags;
}

// --- PDF: dekomprese FlateDecode streamů + extrakce textu ---
function inflate(bytes: Uint8Array): Uint8Array | null {
  try {
    return unzlibSync(bytes); // zlib (FlateDecode s hlavičkou)
  } catch {
    try {
      return inflateSync(bytes); // raw deflate (fallback)
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
  const lit = /\(((?:[^()\\]|\\.)*)\)/g; // literální řetězce (…) v content streamu
  let m: RegExpExecArray | null;
  while ((m = lit.exec(s))) t += unescapePdf(m[1]) + " ";
  return t;
}

function pdfText(buf: Uint8Array): string {
  const raw = strFromU8(buf, true); // latin1: index == pozice bajtu
  let out = "";
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) continue;
    const header = raw.slice(Math.max(0, m.index - 400), m.index);
    let dEnd = end; // ořízni EOL mezi daty a "endstream" (jinak zlib hlásí junk za streamem)
    while (dEnd > start && (raw.charCodeAt(dEnd - 1) === 0x0a || raw.charCodeAt(dEnd - 1) === 0x0d)) dEnd--;
    let data = buf.subarray(start, dEnd);
    if (/\/FlateDecode/.test(header)) {
      const inf = inflate(data);
      if (!inf) continue;
      data = inf;
    }
    out += " " + contentText(strFromU8(data, true));
  }
  return out + " " + contentText(raw); // i nekomprimovaný přímý text
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
.flag{display:flex;gap:10px;padding:11px 12px;border-radius:9px;margin-top:9px;font-size:13px;align-items:flex-start}
.flag.critical{background:rgba(240,85,107,.09);border:1px solid #5a2430}
.flag.warn{background:rgba(240,180,41,.08);border:1px solid #5a4a18}
.flag.info{background:rgba(90,169,240,.07);border:1px solid #274a6b}
.flag .b{font-weight:600}.flag code{background:var(--panel2);padding:1px 6px;border-radius:5px;font-size:12px}
.flag q{color:var(--txt);font-style:italic}
.note{color:var(--amber);font-size:13px;margin-top:8px}
.f0{margin-top:20px;color:var(--muted);font-size:12px;text-align:center}
a{color:var(--accent)}
</style></head><body><div class="wrap">
<h1>🛡️ faxx-hr — upload CV <span style="color:var(--muted);font-size:13px">(F0 · živě na Cloudflare)</span></h1>
<p class="sub">Přetáhni PDF nebo Word (.docx). Detekuje se skrytý / injection text. Soubor se zpracuje v Cloudflare Workeru v paměti a neukládá se.</p>
<label class="drop" id="drop">
  <b>Přetáhni sem CV</b> nebo klikni pro výběr
  <p>PDF · DOCX</p>
  <input type="file" id="file" accept=".pdf,.docx">
</label>
<div class="res" id="res"></div>
<div class="f0">F0 = detekce skrytého / injection textu. DOCX plně; PDF = dekomprese streamů + injection klasifikátor (hloubková detekce skrytí přes barvu/render/CID fonty = F1 on-prem). Extrakce dat a skóre přijdou ve fázi F1–F3.</div>
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
  if(d.note) h+='<div class="note">⚠ '+esc(d.note)+'</div>';
  for(const x of d.flags){
    const ico=x.severity==='critical'?'⛔':x.severity==='warn'?'⚠️':'ℹ️';
    h+='<div class="flag '+x.severity+'"><span>'+ico+'</span><div>'+
       '<span class="b">'+esc(x.type)+'</span> · <code>'+esc(x.location)+'</code> · '+esc(x.method)+
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
      const result: { filename: string; flags: Flag[]; note: string } = { filename: fname, flags: [], note: "" };
      try {
        if (ext === "docx") {
          result.flags = scanDocx(buf);
        } else if (ext === "pdf") {
          const text = pdfText(buf);
          const h = inj(text);
          if (h) result.flags.push({ type: "pdf_injection_text", severity: "warn", location: "PDF (text ze streamů)", evidence: "instrukční text: „" + h + "“", method: "classifier" });
          result.note = h
            ? "Nalezen text instrukčního charakteru. Hloubková detekce SKRYTÍ (barva/kontrast, render mode, CID/Identity-H fonty, dual-path) běží ve fázi F1 na on-prem runneru (PyMuPDF)."
            : text.trim()
            ? "PDF: přečten text streamů, nic instrukčního nenalezeno. Hloubková detekce skrytí = F1 on-prem."
            : "PDF: text streamů se nepodařilo dekódovat (pravděpodobně CID/Identity-H font) → plná detekce běží na on-prem runneru (F1).";
        } else {
          result.note = "Podporováno: .docx (plně), .pdf (dekomprese + injection sken).";
        }
      } catch (e: any) {
        result.note = "chyba při čtení souboru: " + (e?.message || String(e));
      }
      return Response.json(result);
    }
    return new Response("faxx-hr upload — GET / pro stránku", { status: 404 });
  },
};
