#!/usr/bin/env python3
"""
faxx-hr — lokální web upload pro F0 (bez závislostí, bez sítě ven).

Spusť:   python detector/serve.py
Otevře:  http://127.0.0.1:8765  (přetáhni PDF/DOCX → detekce skrytého textu)

Používá stejné jádro jako hidden_text.py. Toto je F0 náhrada za budoucí
Cloudflare Pages upload — až bude Worker, stránka bude mířit na něj místo na
localhost. PDF sken vyžaduje PyMuPDF (`pip install pymupdf`); DOCX jede vždy.
"""
from __future__ import annotations

import json
import os
import tempfile
import webbrowser
from dataclasses import asdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import hidden_text

HOST, PORT = "127.0.0.1", 8765

PAGE = r"""<!DOCTYPE html><html lang="cs"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>faxx-hr — upload CV (F0 demo)</title>
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
<h1>🛡️ faxx-hr — upload CV <span style="color:var(--muted);font-size:13px">(F0 demo, lokálně)</span></h1>
<p class="sub">Přetáhni PDF nebo Word (.docx). Detekuje se skrytý text (nosič prompt injection). Soubor neopustí tvůj počítač.</p>
<label class="drop" id="drop">
  <b>Přetáhni sem CV</b> nebo klikni pro výběr
  <p>PDF · DOCX · žádná data se nikam neposílají</p>
  <input type="file" id="file" accept=".pdf,.docx">
</label>
<div class="res" id="res"></div>
<div class="f0">F0 = jen detekce skrytého textu. Extrakce dat a skóre (Claude + rubrik) přijdou ve fázi F1–F3.</div>
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
       : '<span class="pill ok">✓ čisto — žádný skrytý obsah</span>';
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
</script></body></html>"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # ticho
        pass

    def _send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path not in ("/", "/index.html"):
            self.send_error(404)
            return
        self._send(200, PAGE.encode("utf-8"), "text/html; charset=utf-8")

    def do_POST(self):
        if self.path != "/scan":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        data = self.rfile.read(length)
        fname = self.headers.get("X-Filename", "upload.bin")
        ext = os.path.splitext(fname)[1].lower()
        result = {"filename": fname, "flags": [], "note": ""}
        tmp = None
        try:
            fd, tmp = tempfile.mkstemp(suffix=ext)
            os.close(fd)
            with open(tmp, "wb") as f:
                f.write(data)
            if ext == ".pdf":
                try:
                    import fitz  # noqa: F401
                except ImportError:
                    result["note"] = "PDF sken vyžaduje PyMuPDF (pip install pymupdf) — DOCX jede i bez toho."
            result["flags"] = [asdict(x) for x in hidden_text.scan(tmp)]
        except Exception as e:  # noqa: BLE001
            result["note"] = f"chyba: {e}"
        finally:
            if tmp and os.path.exists(tmp):
                os.remove(tmp)
        self._send(200, json.dumps(result, ensure_ascii=False).encode("utf-8"),
                   "application/json; charset=utf-8")


def main():
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    url = f"http://{HOST}:{PORT}"
    print(f"faxx-hr upload běží na {url}   (Ctrl+C ukončí)")
    if not os.environ.get("FAXXHR_NOBROWSER"):
        try:
            webbrowser.open(url)
        except Exception:
            pass
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nkonec")


if __name__ == "__main__":
    main()
