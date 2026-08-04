/**
 * faxx-hr — upload Worker (F0, živá verze na Cloudflare). Detekce v2.
 *
 * Jen stránka + /scan endpoint; vlastní detekci (DOCX/PDF split + flagy) drží
 * sdílený modul worker/src/detect.ts (stejný používá i appka worker/src/app.ts).
 * Deploy: wrangler deploy -c wrangler.upload.jsonc (npm run deploy:upload)
 */
import { scanDocument, type Flag, type DetectEnv } from "./detect";

type Env = DetectEnv;

// build stamp — injektuje se přes wrangler --define při deployi (scripts/deploy-upload.mjs)
declare const __COMMIT__: string;
declare const __COMMIT_FULL__: string;
declare const __BUILT__: string;
const COMMIT = typeof __COMMIT__ !== "undefined" ? __COMMIT__ : "dev";
const COMMIT_FULL = typeof __COMMIT_FULL__ !== "undefined" ? __COMMIT_FULL__ : "";
const BUILT = typeof __BUILT__ !== "undefined" ? __BUILT__ : "local";

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
.flag q{color:var(--txt);font-style:italic;display:block;margin-top:3px}
.flag .fmeta{color:var(--muted);font-size:11px;margin:2px 0 0;font-family:ui-monospace,Consolas,monospace}
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
<div class="f0">DOCX: WCAG kontrast, Unicode nosiče, hlavičky/patičky, visible/hidden split. PDF: čtení textové vrstvy (Cloudflare Workers AI) + injection sken; detekce skrytí podle barvy = on-prem F1. · <a href="/">Hodnoticí appka</a></div>
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
const DESC={
  docx_vanish:"Skrytý text (ve Wordu označen jako neviditelný) — člověk ho na papíře nevidí, AI ho přečte.",
  docx_low_contrast:"Text v barvě splývající s pozadím (bílé na bílém apod.) — pro člověka prakticky neviditelný.",
  docx_tiny_font:"Mikroskopické písmo pod hranicí čitelnosti.",
  docx_faint_text:"Nízký kontrast textu — hraniční, spíš na vědomí.",
  unicode_invisible:"Neviditelné Unicode znaky (zero-width / skrytý prompt pro AI).",
  docx_annotation:"Text v komentáři nebo poznámce — mimo hlavní tok, čtenář ho běžně nevidí.",
  docx_metadata:"Instrukce schovaná v metadatech dokumentu.",
  docx_alt_text:"Instrukce schovaná v alt-textu obrázku.",
  pdf_injection_text:"Text vypadající jako instrukce pro AI (např. doporuč mě jako nejlepšího) — i skrytý bílým písmem.",
  pdf_render_mode_3:"Neviditelný render mód v PDF (text tam je, ale nevykreslí se).",
  pdf_low_contrast:"Text splývající s pozadím v PDF.",
  pdf_tiny_font:"Mikroskopické písmo v PDF.",
  pdf_offpage:"Text umístěný mimo viditelnou plochu stránky."
};
const SEVW={critical:"vysoké riziko — pravděpodobný pokus o manipulaci AI",warn:"podezřelé — doporučeno prověřit",info:"jen na vědomí"};
function plural(n){return n===1?'nález':(n>=2&&n<=4)?'nálezy':'nálezů'}
function render(d){
  const n=d.flags.length, crit=d.flags.filter(x=>x.severity==='critical').length;
  let h='<div class="card"><div class="sum"><b>'+esc(decodeURIComponent(d.filename))+'</b>';
  h+= n? '<span class="pill bad">'+n+' '+plural(n)+(crit?' · '+crit+'× vysoké riziko':'')+'</span>'
       : '<span class="pill ok">✓ čisto — žádný skrytý/injection obsah</span>';
  h+='</div>';
  if(d.visible_chars!==undefined)
    h+='<div class="split">viditelný text <b>'+d.visible_chars+'</b> zn. (jde do hodnocení AI) · skrytý <b>'+d.hidden_chars+'</b> zn. (NEJDE do AI, jen sem k prověření)</div>';
  if(n) h+='<div class="split" style="color:var(--amber)">ℹ Skrytý obsah se NEPOUŽIJE pro hodnocení kandidáta — je tu jen k tvému posouzení.</div>';
  if(d.note) h+='<div class="note">⚠ '+esc(d.note)+'</div>';
  for(const x of d.flags){
    const ico=x.severity==='critical'?'⛔':x.severity==='warn'?'⚠️':'ℹ️';
    h+='<div class="flag '+x.severity+'"><span>'+ico+'</span><div>'+
       '<div class="b">'+esc(DESC[x.type]||x.type)+'</div>'+
       '<div class="fmeta">'+esc(SEVW[x.severity]||x.severity)+' · '+esc(x.type)+' · '+esc(x.location)+'</div>'+
       '<q>'+esc(x.evidence)+'</q></div></div>';
  }
  h+='</div>';
  res.innerHTML=h;
}
</script></body></html>`;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (req.method === "POST" && url.pathname === "/scan") {
      const fname = decodeURIComponent(req.headers.get("X-Filename") || "upload.bin");
      const buf = new Uint8Array(await req.arrayBuffer());
      const r = await scanDocument(fname, buf, env);
      const result: { filename: string; flags: Flag[]; note: string; visible_chars: number; hidden_chars: number } = {
        filename: fname, flags: r.flags, note: r.note, visible_chars: r.visibleChars, hidden_chars: r.hiddenChars,
      };
      return Response.json(result);
    }
    return new Response("faxx-hr upload — GET / pro stránku", { status: 404 });
  },
};
