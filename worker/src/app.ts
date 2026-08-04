/**
 * faxx-hr — hodnoticí appka (Cloudflare Worker). Spojuje ověřené jádro:
 *   detect.ts  (viditelný/skrytý split + flagy)  → extract.ts (LLM #1 do schématu)
 *   → rubric.ts (deterministické skóre + pořadí).
 *
 * Skórovací cesta NIKDY nevidí surový text; skrytý/injection text se vlajkuje,
 * do hodnocení nejde. Rating ≠ rozhodnutí — postup dělá vždy člověk (AI Act čl. 14).
 *
 * Záložky: Hodnocení / Nastavení / Dokumentace.
 * Deploy: wrangler deploy -c wrangler.app.jsonc
 */
import { scanDocument, type DetectEnv } from "./detect";
import { extractQualification, aiJson, EXTRACT_MODEL_DEFAULT, type AiBinding } from "./extract";
import { scoreCandidate, rankCandidates, type Rubric, type Qualification } from "./rubric";

interface Env extends DetectEnv { AI: AiBinding & DetectEnv["AI"] }

const MAX_TOTAL_BYTES = 10 * 1024 * 1024; // ≤10 MB celkem
const MAX_FILE_BYTES = 8 * 1024 * 1024;

// --- pomůcky ----------------------------------------------------------------
const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" ? (x as Record<string, unknown>) : {});
const str = (x: unknown): string => (typeof x === "string" ? x : x == null ? "" : String(x));
const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : Number(x) || 0);
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

interface Requirements { jobTitle: string; minYears: number; requiredSkills: string[] }

function buildRubric(r: Requirements): Rubric {
  return {
    jobTitle: r.jobTitle || "Pozice",
    gates: r.minYears > 0 ? [{ key: "min_praxe", field: "years_total_experience", op: ">=", value: r.minYears, reason: `Méně než ${r.minYears} let praxe = diskvalifikace.` }] : [],
    criteria: [
      { key: "roky_praxe", label: "Roky praxe", type: "numeric_scale", weight: 0.25, min: 0, max: Math.max(8, r.minYears + 3) },
      { key: "dovednosti", label: "Shoda klíčových dovedností", type: "set_overlap", weight: 0.30, required: r.requiredSkills },
      { key: "vzdelani", label: "Vzdělání", type: "category_map", weight: 0.15, aggregate: "max", map: { secondary: 5, bachelor: 7, master: 10, phd: 10, course: 4, other: 2 } },
      { key: "en", label: "Angličtina", type: "cefr_map", weight: 0.10, language: "EN", map: { A1: 0, A2: 0, B1: 4, B2: 7, C1: 9, C2: 10, native: 10 } },
      { key: "stabilita", label: "Stabilita zaměstnání", type: "tenure", weight: 0.10, penaltyBelowMonths: 6 },
      { key: "certifikace", label: "Relevantní certifikace", type: "bonus", weight: 0.10, pointsEach: 2, cap: 10 },
    ],
  };
}

const DERIVE_SYS = 'Jsi HR asistent. Z textu pracovního inzerátu vytáhni strukturované požadavky a vrať VÝHRADNĚ JSON: {"jobTitle": string, "minYears": number, "requiredSkills": [string]}. minYears = minimální požadované roky praxe jako číslo (0 když neuvedeno). requiredSkills = klíčové technické dovednosti/technologie malými písmeny, 3 až 8 položek. Bez markdownu, bez komentářů.';
const DERIVE_SCHEMA = { type: "object", properties: { jobTitle: { type: "string" }, minYears: { type: "number" }, requiredSkills: { type: "array", items: { type: "string" } } }, required: ["jobTitle", "minYears", "requiredSkills"] };

async function deriveRequirements(inzerat: string, ai: AiBinding, model: string): Promise<{ req: Requirements; ok: boolean; ms: number; error?: string }> {
  const r = await aiJson(ai, model, [{ role: "system", content: DERIVE_SYS }, { role: "user", content: inzerat.slice(0, 8000) }], DERIVE_SCHEMA);
  const o = obj(r.obj);
  const req: Requirements = {
    jobTitle: str(o.jobTitle) || "Pozice",
    minYears: Math.max(0, Math.round(num(o.minYears))),
    requiredSkills: arr(o.requiredSkills).map((s) => str(s).toLowerCase().trim()).filter(Boolean).slice(0, 12),
  };
  return { req, ok: r.ok, ms: r.ms, error: r.error };
}

function worstSeverity(flags: { severity: string }[]): string {
  for (const s of ["critical", "warn", "info"]) if (flags.some((f) => f.severity === s)) return s;
  return "clean";
}

interface CandidateInput { name: string; visible?: string; flags?: { type: string; severity: string; location: string; evidence: string }[]; hidden_chars?: number; note?: string; buf?: Uint8Array; ext?: string }

async function evaluate(cands: CandidateInput[], req: Requirements, ai: AiBinding, model: string, env: Env) {
  const rubric = buildRubric(req);
  const results = [];
  for (const c of cands) {
    let visible = c.visible ?? "";
    let flags = c.flags ?? [];
    let hiddenChars = c.hidden_chars ?? 0;
    let note = c.note ?? "";
    if (c.buf) {
      const scan = await scanDocument(c.name, c.buf, env);
      visible = scan.visible;
      flags = scan.flags;
      hiddenChars = scan.hiddenChars;
      note = scan.note;
    }
    const ext = await extractQualification(visible, ai, model);
    const score = scoreCandidate(ext.qualification, rubric);
    results.push({
      name: c.name, score,
      flags, worstSeverity: worstSeverity(flags), flagCount: flags.length,
      qualification: ext.qualification,
      extract_ms: ext.ms, extract_ok: ext.ok, extract_error: ext.error,
      visible_chars: visible.length, hidden_chars: hiddenChars, note,
    });
  }
  const ranking = rankCandidates(results).map((r, i) => ({
    rank: i + 1, name: r.name, total: r.score.total, disqualified: r.score.disqualified,
    gatesFailed: r.score.gates.filter((g) => !g.passed).map((g) => ({ key: g.key, reason: g.reason, value: g.value })),
    breakdown: r.score.breakdown.map((b) => ({ label: b.label, score: b.score, detail: b.detail })),
    flags: r.flags, worstSeverity: r.worstSeverity, flagCount: r.flagCount,
    extract_ms: r.extract_ms, extract_ok: r.extract_ok, visible_chars: r.visible_chars, hidden_chars: r.hidden_chars, note: r.note,
  }));
  return { rubric: { jobTitle: req.jobTitle, minYears: req.minYears, requiredSkills: req.requiredSkills }, model, count: ranking.length, ranking };
}

// ---------------------------------------------------------------------------
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const json = (o: unknown, status = 200) => Response.json(o, { status });

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }

    if (req.method === "POST" && url.pathname === "/api/extract-text") {
      try {
        const form = await req.formData();
        const f = form.get("file");
        if (!(f instanceof File)) return json({ error: "chybí soubor" }, 400);
        if (f.size > MAX_FILE_BYTES) return json({ error: "Soubor je větší než 8 MB." }, 413);
        const ext = (f.name.split(".").pop() || "").toLowerCase();
        const buf = new Uint8Array(await f.arrayBuffer());
        if (ext === "txt" || ext === "md") return json({ text: new TextDecoder().decode(buf), source: f.name });
        if (ext === "pdf" || ext === "docx") {
          const s = await scanDocument(f.name, buf, env);
          return json({ text: s.visible, source: f.name, note: s.note });
        }
        return json({ error: "Podporováno: TXT, PDF, DOCX. Screenshot/obrázek (vision) přijde později." }, 400);
      } catch (e: unknown) { return json({ error: String((e as { message?: string })?.message || e) }, 500); }
    }

    if (req.method === "POST" && url.pathname === "/api/derive") {
      try {
        const b = obj(await req.json());
        const inzerat = str(b.inzerat).trim();
        const model = str(b.model) || EXTRACT_MODEL_DEFAULT;
        if (!inzerat) return json({ error: "chybí text inzerátu" }, 400);
        if (model.startsWith("claude")) return json({ error: "Claude backend vyžaduje API klíč (zatím není nastaven). Zvol free Cloudflare model." }, 400);
        const d = await deriveRequirements(inzerat, env.AI, model);
        return json({ ...d.req, ok: d.ok, ms: d.ms, error: d.error });
      } catch (e: unknown) { return json({ error: String((e as { message?: string })?.message || e) }, 500); }
    }

    if (req.method === "POST" && url.pathname === "/api/evaluate") {
      try {
        const ctype = req.headers.get("content-type") || "";
        let cands: CandidateInput[] = [];
        let req0: Requirements | null = null;
        let inzerat = "";
        let model = EXTRACT_MODEL_DEFAULT;

        if (ctype.includes("application/json")) {
          const b = obj(await req.json());
          model = str(b.model) || model;
          inzerat = str(b.inzerat);
          if (b.requirements) { const r = obj(b.requirements); req0 = { jobTitle: str(r.jobTitle), minYears: Math.max(0, Math.round(num(r.minYears))), requiredSkills: arr(r.requiredSkills).map((s) => str(s).toLowerCase().trim()).filter(Boolean) }; }
          cands = arr(b.candidates).map((c) => { const o = obj(c); return { name: str(o.name) || "kandidát", visible: str(o.visible_text) }; });
        } else {
          const form = await req.formData();
          model = str(form.get("model")) || model;
          inzerat = str(form.get("inzerat"));
          const rq = form.get("requirements");
          if (typeof rq === "string" && rq) { const r = obj(JSON.parse(rq)); req0 = { jobTitle: str(r.jobTitle), minYears: Math.max(0, Math.round(num(r.minYears))), requiredSkills: arr(r.requiredSkills).map((s) => str(s).toLowerCase().trim()).filter(Boolean) }; }
          let total = 0;
          for (const f of form.getAll("cv")) {
            if (typeof f === "string") continue;
            const file = f as File;
            if (file.size > MAX_FILE_BYTES) return json({ error: `Soubor ${file.name} je větší než 8 MB.` }, 413);
            total += file.size;
            if (total > MAX_TOTAL_BYTES) return json({ error: "Součet souborů přesahuje 10 MB." }, 413);
            cands.push({ name: file.name, buf: new Uint8Array(await file.arrayBuffer()) });
          }
        }

        if (model.startsWith("claude")) return json({ error: "Claude backend vyžaduje API klíč (zatím není nastaven). Zvol free Cloudflare model." }, 400);
        if (!cands.length) return json({ error: "žádná CV k vyhodnocení" }, 400);
        if (!req0) {
          if (inzerat.trim()) req0 = (await deriveRequirements(inzerat, env.AI, model)).req;
          else return json({ error: "chybí požadavky (inzerát nebo vyplněný formulář)" }, 400);
        }
        return json(await evaluate(cands, req0, env.AI, model, env));
      } catch (e: unknown) { return json({ error: String((e as { message?: string })?.message || e) }, 500); }
    }

    return new Response("faxx-hr appka — GET / pro stránku", { status: 404 });
  },
};

// ===========================================================================
const PAGE = `<!DOCTYPE html><html lang="cs"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>faxx-hr — hodnocení kandidátů</title>
<style>
:root{--bg:#0d1424;--panel:#141d33;--panel2:#1b2740;--line:#26324f;--txt:#e6edf7;
--muted:#8da2c4;--accent:#3fd6a0;--amber:#f0b429;--red:#f0556b;--blue:#5aa9f0}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);
font:15px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
.wrap{max-width:960px;margin:0 auto;padding:26px 22px 80px}
h1{font-size:22px;margin:0 0 2px}.lead{color:var(--muted);margin:0 0 18px;font-size:13px}
.tabs{display:flex;gap:6px;border-bottom:1px solid var(--line);margin-bottom:22px}
.tab{padding:9px 16px;cursor:pointer;color:var(--muted);border-bottom:2px solid transparent;font-weight:600}
.tab.on{color:var(--txt);border-bottom-color:var(--accent)}
.view{display:none}.view.on{display:block}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:14px}
.card h3{margin:0 0 10px;font-size:14px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
label{display:block;font-size:12px;color:var(--muted);margin:10px 0 4px}
textarea,input[type=text],input[type=number],select{width:100%;background:var(--panel2);border:1px solid var(--line);
border-radius:8px;color:var(--txt);padding:9px 11px;font:14px/1.5 inherit}
textarea{min-height:120px;resize:vertical}
.row{display:flex;gap:12px;flex-wrap:wrap}.row>div{flex:1;min-width:180px}
button{background:var(--accent);color:#06281c;border:0;border-radius:8px;padding:10px 16px;font-weight:700;cursor:pointer;font-size:14px}
button.ghost{background:var(--panel2);color:var(--txt);border:1px solid var(--line)}
button:disabled{opacity:.5;cursor:not-allowed}
.filebtn{display:inline-block;background:var(--panel2);color:var(--txt);border:1px solid var(--line);border-radius:8px;padding:10px 16px;font-weight:700;cursor:pointer;font-size:14px}
.filebtn:hover{border-color:var(--accent)}
.hint{color:var(--muted);font-size:12px;margin-top:6px}
.drop{border:2px dashed var(--line);border-radius:12px;padding:26px 18px;text-align:center;background:var(--panel2);cursor:pointer}
.drop.hot{border-color:var(--accent)}
.files{margin-top:10px;font-size:13px}.files .fi{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line)}
.files .fi b{font-weight:600}.files .x{color:var(--red);cursor:pointer}
.total{font-size:12px;color:var(--muted);margin-top:6px}
.total.over{color:var(--red)}
.rank{width:100%;border-collapse:collapse;font-size:14px}
.rank th{text-align:left;color:var(--muted);font-size:11px;text-transform:uppercase;padding:6px 8px;border-bottom:1px solid var(--line)}
.rank td{padding:9px 8px;border-bottom:1px solid var(--line);vertical-align:top}
.rank tr.dq{opacity:.6}
.score{font-weight:800;font-size:16px}
.bar{height:6px;background:var(--panel2);border-radius:4px;margin-top:4px;overflow:hidden}
.bar>i{display:block;height:100%;background:var(--accent)}
.badge{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px}
.badge.critical{color:var(--red);background:rgba(240,85,107,.14)}
.badge.warn{color:var(--amber);background:rgba(240,180,41,.14)}
.badge.info{color:var(--blue);background:rgba(90,169,240,.12)}
.badge.clean{color:var(--accent);background:rgba(63,214,160,.12)}
.badge.dq{color:var(--red);background:rgba(240,85,107,.14)}
.det{background:var(--panel2);border-radius:8px;padding:10px 12px;margin-top:8px;font-size:13px;display:none}
.det.on{display:block}
.det .crit{margin:3px 0;color:var(--muted)}.det .crit b{color:var(--txt)}
.flg{margin-top:8px;padding:8px 10px;border-radius:7px;font-size:12px}
.flg.critical{background:rgba(240,85,107,.09);border:1px solid #5a2430}
.flg.warn{background:rgba(240,180,41,.08);border:1px solid #5a4a18}
.flg.info{background:rgba(90,169,240,.07);border:1px solid #274a6b}
.expand{cursor:pointer;color:var(--accent);font-size:12px}
.err{color:var(--red);font-size:13px;margin-top:8px}
.doc p{margin:8px 0}.doc code{background:var(--panel2);padding:1px 6px;border-radius:5px;font-size:13px}
.foot{color:var(--muted);font-size:11px;text-align:center;margin-top:24px;opacity:.6}
a{color:var(--accent)}
@media print{.tabs,.drop,.files,button,#inzeratCard,#reqCard,.foot{display:none!important}.view{display:block!important}}
</style></head><body><div class="wrap">
<h1>🛡️ faxx-hr</h1>
<p class="lead">Hodnocení kandidátů proti inzerátu s obranou proti skrytým instrukcím v CV. Skóre počítá pevný rubrik nad extrahovanými daty — rozhoduješ ty.</p>
<div class="tabs">
  <div class="tab on" data-v="hod">Hodnocení</div>
  <div class="tab" data-v="nast">Nastavení</div>
  <div class="tab" data-v="dok">Dokumentace</div>
</div>

<!-- HODNOCENÍ -->
<div class="view on" id="hod">
  <div class="card" id="inzeratCard">
    <h3>1 · Inzerát</h3>
    <textarea id="inzerat" placeholder="Vlož text inzerátu, nebo ho nahraj ze souboru (📎), nebo rovnou vyplň požadavky níže…"></textarea>
    <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <label class="filebtn" title="Nahraj inzerát jako TXT, PDF nebo DOCX — text se vloží do pole výše">📎 Vložit ze souboru<input type="file" id="inzFile" accept=".txt,.md,.pdf,.docx" style="display:none"></label>
      <button class="ghost" id="deriveBtn" title="AI z inzerátu navrhne požadavky, které pak můžeš upravit">✨ Odvodit požadavky z inzerátu</button>
      <span class="hint" id="deriveMsg"></span>
    </div>
  </div>
  <div class="card" id="reqCard">
    <h3>2 · Požadavky (uprav podle sebe)</h3>
    <div class="row">
      <div><label>Název pozice</label><input type="text" id="jobTitle" placeholder="Backend vývojář"></div>
      <div style="max-width:160px"><label>Min. roky praxe (gate)</label><input type="number" id="minYears" min="0" value="0"></div>
    </div>
    <label>Klíčové dovednosti (oddělené čárkou)</label>
    <input type="text" id="skills" placeholder="python, sql, git, docker, rest api">
    <div class="hint">Gate = tvrdý požadavek: kdo ho nesplní, je diskvalifikován (nezamítá se automaticky — jen se označí).</div>
  </div>
  <div class="card">
    <h3>3 · Životopisy</h3>
    <label class="drop" id="drop"><b>Přetáhni sem CV</b> nebo klikni (víc souborů) · PDF/DOCX · ≤ 10 MB celkem
      <input type="file" id="file" accept=".pdf,.docx" multiple style="display:none"></label>
    <div class="files" id="files"></div>
    <div class="total" id="total"></div>
    <div style="margin-top:14px"><button id="evalBtn">Vyhodnotit kandidáty</button> <span class="hint" id="evalMsg"></span></div>
    <div class="err" id="err"></div>
  </div>
  <div id="results"></div>
</div>

<!-- NASTAVENÍ -->
<div class="view" id="nast">
  <div class="card">
    <h3>AI model</h3>
    <label>Model pro extrakci dat z CV</label>
    <select id="model">
      <option value="@cf/meta/llama-3.1-8b-instruct-fp8">Cloudflare Workers AI · Llama 3.1 8B (zdarma, rychlý — doporučeno)</option>
      <option value="@cf/meta/llama-3.3-70b-instruct-fp8-fast">Cloudflare Workers AI · Llama 3.3 70B (zdarma, silnější, pomalejší)</option>
      <option value="@cf/openai/gpt-oss-120b">Cloudflare Workers AI · gpt-oss 120B (zdarma, nejsilnější, latence kolísá)</option>
      <option value="claude" disabled>Anthropic Claude (nejlepší kvalita — vyžaduje API klíč, zatím nedostupné)</option>
    </select>
    <div class="hint">Primárně běží <b>zdarma</b> na Cloudflare Workers AI. Claude se zapne, až bude nastaven API klíč (max kvalita/spolehlivost). Nastavení se ukládá v prohlížeči.</div>
  </div>
  <div class="card">
    <h3>Jak se skóruje</h3>
    <div class="doc">
      <p>Váhy kritérií (v této verzi pevné): roky praxe 25 %, shoda dovedností 30 %, vzdělání 15 %, angličtina 10 %, stabilita 10 %, certifikace 10 %.</p>
      <p>Skóre 0–100 počítá deterministický rubrik nad daty, která z CV vytáhla AI. Editovatelné váhy a šablony rubriků přijdou v další verzi.</p>
    </div>
  </div>
</div>

<!-- DOKUMENTACE -->
<div class="view" id="dok">
  <div class="card doc">
    <h3>Jak to funguje a proč je to bezpečné</h3>
    <p><b>1. Rozdělení textu.</b> Z každého CV se oddělí <b>viditelný</b> text (jde do hodnocení) od <b>skrytého</b> (bílé písmo, mikropísmo, neviditelné Unicode, metadata…). Skrytý text se <b>vlajkuje</b>, do hodnocení nejde.</p>
    <p><b>2. Extrakce.</b> AI přečte jen viditelný text a vytáhne strukturovaná fakta do pevného schématu (roky praxe, dovednosti, vzdělání, jazyky…). Schéma <b>nemá pole „skóre"</b>, takže instrukce typu „ohodnoť mě 100/100" nemá kam zapsat.</p>
    <p><b>3. Skórování.</b> Pořadí počítá <b>deterministický rubrik v kódu</b> nad těmi daty — reprodukovatelně a vysvětlitelně. Skórovací cesta <b>nikdy nevidí surový text CV</b>, takže injection nemá jak skóre ovlivnit.</p>
    <p><b>4. Rozhoduješ ty.</b> Rating je podpora rozhodnutí, ne automat. Není tu „hromadné zamítnutí“ — postup kandidáta dál dělá vždy člověk (EU AI Act čl. 14, GDPR čl. 22).</p>
    <p>Detekci skrytého textu si můžeš vyzkoušet na samostatném <a href="https://faxx-hr-upload.bass443.workers.dev" target="_blank" rel="noopener" title="otevře se v novém panelu">demu detektoru</a> (nahraješ jedno CV a uvidíš, co je skryté).</p>
  </div>
</div>

<div class="foot">faxx-hr · pracovní verze · skórování nevidí surový text · rozhoduje člověk</div>
</div>
<script>
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
function esc(s){return (s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
// tabs
$$('.tab').forEach(t=>t.onclick=()=>{$$('.tab').forEach(x=>x.classList.remove('on'));$$('.view').forEach(x=>x.classList.remove('on'));t.classList.add('on');$('#'+t.dataset.v).classList.add('on')});
// model persist
const modelSel=$('#model'); modelSel.value=localStorage.getItem('faxx_model')||modelSel.value; modelSel.onchange=()=>localStorage.setItem('faxx_model',modelSel.value);
const model=()=>modelSel.value;
// files
let files=[];
const drop=$('#drop'),fileInput=$('#file');
['dragenter','dragover'].forEach(e=>drop.addEventListener(e,ev=>{ev.preventDefault();drop.classList.add('hot')}));
['dragleave','drop'].forEach(e=>drop.addEventListener(e,ev=>{ev.preventDefault();drop.classList.remove('hot')}));
drop.addEventListener('drop',ev=>addFiles(ev.dataTransfer.files));
fileInput.addEventListener('change',()=>addFiles(fileInput.files));
function addFiles(fl){for(const f of fl){if(/\\.(pdf|docx)$/i.test(f.name))files.push(f)}renderFiles()}
function renderFiles(){
  const tot=files.reduce((a,f)=>a+f.size,0);
  $('#files').innerHTML=files.map((f,i)=>'<div class="fi"><b>'+esc(f.name)+'</b><span>'+(f.size/1024|0)+' kB <span class="x" data-i="'+i+'">✕</span></span></div>').join('');
  $$('.files .x').forEach(x=>x.onclick=()=>{files.splice(+x.dataset.i,1);renderFiles()});
  const t=$('#total');t.textContent='Celkem '+(tot/1048576).toFixed(2)+' MB / 10 MB · '+files.length+' souborů';
  t.classList.toggle('over',tot>10485760);
}
// derive requirements
$('#deriveBtn').onclick=async()=>{
  const inz=$('#inzerat').value.trim(); if(!inz){$('#deriveMsg').textContent='Vlož nejdřív text inzerátu.';return}
  $('#deriveBtn').disabled=true;$('#deriveMsg').textContent='Odvozuji…';
  try{
    const r=await fetch('/api/derive',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({inzerat:inz,model:model()})}).then(r=>r.json());
    if(r.error){$('#deriveMsg').textContent='Chyba: '+r.error}
    else{$('#jobTitle').value=r.jobTitle||'';$('#minYears').value=r.minYears||0;$('#skills').value=(r.requiredSkills||[]).join(', ');$('#deriveMsg').textContent='Hotovo ('+(r.ms||0)+' ms) — uprav podle sebe.'}
  }catch(e){$('#deriveMsg').textContent='Chyba: '+e}
  $('#deriveBtn').disabled=false;
};
// import inzerátu ze souboru
$('#inzFile').onchange=async()=>{
  const f=$('#inzFile').files[0]; if(!f)return;
  $('#deriveMsg').textContent='Načítám '+f.name+'…';
  const fd=new FormData();fd.set('file',f);
  try{
    const r=await fetch('/api/extract-text',{method:'POST',body:fd}).then(r=>r.json());
    if(r.error){$('#deriveMsg').textContent='Chyba: '+r.error}
    else{$('#inzerat').value=r.text||'';$('#deriveMsg').textContent='Načteno z '+esc(r.source||f.name)+' ('+((r.text||'').length)+' zn.). Zkontroluj text a odvoď požadavky.'}
  }catch(e){$('#deriveMsg').textContent='Chyba: '+e}
  $('#inzFile').value='';
};
// evaluate
$('#evalBtn').onclick=async()=>{
  $('#err').textContent='';
  if(!files.length){$('#err').textContent='Přidej aspoň jedno CV.';return}
  const req={jobTitle:$('#jobTitle').value.trim(),minYears:+$('#minYears').value||0,requiredSkills:$('#skills').value.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean)};
  const fd=new FormData();fd.set('model',model());fd.set('requirements',JSON.stringify(req));fd.set('inzerat',$('#inzerat').value);
  for(const f of files)fd.append('cv',f);
  $('#evalBtn').disabled=true;$('#evalMsg').textContent='Vyhodnocuji '+files.length+' CV…';
  try{
    const r=await fetch('/api/evaluate',{method:'POST',body:fd}).then(r=>r.json());
    if(r.error){$('#err').textContent=r.error}else renderResults(r);
    $('#evalMsg').textContent='';
  }catch(e){$('#err').textContent='Chyba: '+e}
  $('#evalBtn').disabled=false;
};
const SEV={critical:'⛔',warn:'⚠️',info:'ℹ️'};
function renderResults(r){
  let h='<div class="card"><h3>Pořadí — '+esc(r.rubric.jobTitle)+' · model '+esc(r.model.split("/").pop())+'</h3>';
  h+='<div class="hint">Gate: min. '+r.rubric.minYears+' let praxe · dovednosti: '+esc((r.rubric.requiredSkills||[]).join(", "))+'</div>';
  h+='<table class="rank"><tr><th>#</th><th>Kandidát</th><th>Skóre</th><th>Nález</th><th></th></tr>';
  r.ranking.forEach((c,i)=>{
    const sevB=c.disqualified?'<span class="badge dq">diskvalifikován</span>':'<span class="badge '+c.worstSeverity+'">'+(c.worstSeverity==='clean'?'čisto':(SEV[c.worstSeverity]||'')+' '+c.flagCount+'×')+'</span>';
    h+='<tr class="'+(c.disqualified?'dq':'')+'"><td>'+c.rank+'</td>'
      +'<td><b>'+esc(c.name)+'</b><div class="hint">extrakce '+c.extract_ms+' ms · viditelný '+c.visible_chars+' zn.'+(c.hidden_chars?' · skrytý '+c.hidden_chars+' zn.':'')+'</div></td>'
      +'<td><span class="score">'+c.total+'</span><div class="bar"><i style="width:'+c.total+'%"></i></div></td>'
      +'<td>'+sevB+'</td>'
      +'<td><span class="expand" data-i="'+i+'">rozpad ▾</span></td></tr>';
    h+='<tr><td colspan="5" style="padding:0"><div class="det" id="det'+i+'">'
      +(c.disqualified?'<div class="crit" style="color:var(--red)">Diskvalifikováno: '+esc(c.gatesFailed.map(g=>g.reason).join("; "))+'</div>':'')
      +c.breakdown.map(b=>'<div class="crit"><b>'+esc(b.label)+':</b> '+b.score.toFixed(1)+'/10 — '+esc(b.detail)+'</div>').join('')
      +(c.flags.length?'<div style="margin-top:8px;color:var(--muted);font-size:12px">Nálezy ve zdroji (do hodnocení NEjdou):</div>'+c.flags.map(f=>'<div class="flg '+f.severity+'">'+(SEV[f.severity]||'')+' '+esc(f.evidence)+' <span class="hint">· '+esc(f.location)+'</span></div>').join(''):'')
      +(c.note?'<div class="hint" style="margin-top:6px">'+esc(c.note)+'</div>':'')
      +'</div></td></tr>';
  });
  h+='</table>';
  h+='<div style="margin-top:14px"><button class="ghost" onclick="window.print()" title="Vytiskni nebo ulož jako PDF">🖨️ Tisk / PDF</button> <button class="ghost" id="dlHtml">⬇️ Stáhnout HTML</button></div>';
  h+='<div class="hint" style="margin-top:8px">Rating je podpora rozhodnutí. Postup kandidátů dál je na tobě.</div></div>';
  $('#results').innerHTML=h;
  $$('.expand').forEach(x=>x.onclick=()=>$('#det'+x.dataset.i).classList.toggle('on'));
  $('#dlHtml').onclick=()=>{const blob=new Blob(['<meta charset=utf-8><title>faxx-hr výsledek</title>'+$('#results').innerHTML],{type:'text/html'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='faxx-hr-hodnoceni.html';a.click()};
}
</script></body></html>`;
