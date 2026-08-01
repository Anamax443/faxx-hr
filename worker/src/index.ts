/**
 * faxx-hr — Cloudflare Worker (SKELETON, fáze F1).
 *
 * Zatím jen kostra: e-mail ingest + health endpoint. Vlastní pipeline
 * (sanitizace → dual-path → extrakce → validace → skórování) se doplňuje ve F1–F3.
 *
 * Princip, který se NESMÍ porušit: skórovací model nikdy nevidí surový text;
 * dostane až validovaný `qualification_json`. Detekce skrytého textu = FLAG,
 * ne tiché filtrování.
 */

import PostalMime from "postal-mime";

export interface Env {
  DB: D1Database;
  DOCS: R2Bucket;
  CONDUIT_URL: string;
  ANTHROPIC_API_KEY: string; // secret
}

const COMMIT = "dev"; // F4: nahradit build hashem

export default {
  // --- HTTP: health-check + (F2) API pro review UI ---
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "faxx-hr", commit: COMMIT });
    }
    // TODO F2: GET /candidates, /candidates/:id (skóre, breakdown, evidence, flagy)
    // TODO F3: POST /decisions (záznam lidského rozhodnutí → tabulka decisions)
    return new Response("faxx-hr worker — viz status.html", { status: 404 });
  },

  // --- E-mail: příjem CV (recyklace vzoru z job-watch-mail) ---
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const parsed = await PostalMime.parse(message.raw);

    for (const att of parsed.attachments ?? []) {
      // FÁZE 1 — INGEST: originál → R2 (immutable), stav → D1
      const bytes = att.content as ArrayBuffer;
      const sha256 = await digest(bytes);
      const r2Key = `raw/${sha256}`;
      await env.DOCS.put(r2Key, bytes, { httpMetadata: { contentType: att.mimeType } });

      // TODO F1: založit candidate + document (D1), stav 'received', audit_log
      // TODO F1: FÁZE 2 — poslat na Conduit (env.CONDUIT_URL) na rasterizaci + OCR/vision,
      //          udělat dual-path diff proti textové vrstvě → flags
      // TODO F1: FÁZE 3 — LLM#1 extrakce do schema/extraction.schema.json (Sonnet 5)
      // TODO F1: FÁZE 4 — validace/normalizace kódem
      // TODO F3: FÁZE 5 — deterministický rubrik → scores
      console.log(`ingest: ${att.filename} → ${r2Key} (${att.mimeType})`);
    }
  },
} satisfies ExportedHandler<Env>;

async function digest(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
