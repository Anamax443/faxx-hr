/**
 * Bezpečnostní hlavičky a security.txt — společné pro oba workery
 * (hodnoticí appka `app.ts` i demo detektoru `upload.ts`).
 *
 * Proč přísně: appka je veřejná a pracuje s cizími dokumenty (CV od neznámých lidí).
 * Do stránky se vypisují jména a útržky textu z těch dokumentů — kdyby se přes ně
 * někdy propašoval kus HTML, prohlížeč ho nesmí spustit. Proto:
 *   - žádné externí zdroje (všechno servíruje jeden worker, nic z CDN),
 *   - inline <script> běží jen s NONCE, který se losuje pro každý požadavek zvlášť
 *     (cizí <script> ho nezná → prohlížeč ho neprovede),
 *   - inline `onclick=...` se v projektu nepoužívá (CSP je stejně nespustí).
 *
 * Co CSP vědomě povoluje:
 *   - style-src 'unsafe-inline' — stránky mají <style> a style="…" přímo v HTML;
 *     styl sám o sobě kód nespustí a rozdělovat CSS do souborů kvůli auditu nemá cenu,
 *   - img-src data: — favicona je inline SVG,
 *   - blob: v object/frame/img — appka otevírá nahraný CV (PDF) přes URL.createObjectURL;
 *     blob dokument dědí politiku téhle stránky, takže mu ji nesmíme zavřít.
 */

// Sběrné místo pro porušení CSP — Pages Function na maxferit.cz (sdílené s ostatními weby).
const CSP_REPORT_URI = "https://maxferit.cz/api/report-csp";

/** Náhodný nonce pro jeden požadavek (base64 z 16 bajtů). */
export function makeNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/=+$/, "");
}

function csp(nonce?: string): string {
  if (!nonce) {
    // odpovědi bez HTML (JSON, text) — nemá se z nich načítat vůbec nic
    return "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
  }
  return [
    "default-src 'self'",
    // static.cloudflareinsights.com = beacon Web Analytics, který Cloudflare sám vstřikuje
    // do stránky na zóně maxferit.cz. Bez téhle výjimky by ho CSP zablokovala a měření
    // návštěvnosti by na téhle doméně tiše umřelo. Data posílá na vlastní origin
    // (/cdn-cgi/rum), takže connect-src 'self' stačí.
    `script-src 'nonce-${nonce}' https://static.cloudflareinsights.com`,
    "style-src 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    // object-src by měl být 'none', ale prohlížeč jím zavírá i vlastní PDF prohlížeč:
    // dokument otevřený z blob: URL dědí CSP téhle stránky a Chrome jeho PDF viewer
    // pod 'none' nespustí (chromium issue 40328564). Appka takhle otevírá nahrané CV,
    // takže je povolené jen schéma blob: — same-origin <object>/<embed> nepoužíváme.
    "object-src blob:",
    "frame-src 'self' blob:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    // stránka nic přes http: nenačítá; direktiva je pojistka proti budoucímu překlepu
    "upgrade-insecure-requests",
    // porušení CSP se hlásí na sběrné místo na maxferit.cz (report-uri = starší
    // prohlížeče, report-to = Reporting API; endpoint umí oba tvary)
    `report-uri ${CSP_REPORT_URI}`,
    "report-to csp",
  ].join("; ");
}

/**
 * Hlavičky do každé odpovědi. `nonce` se předává jen u HTML stránek.
 * `x-xss-protection: 0` je záměr: starý XSS Auditor v prohlížečích měl vlastní
 * zranitelnosti, moderní obranou je CSP výše.
 */
export function securityHeaders(nonce?: string): Record<string, string> {
  return {
    "content-security-policy": csp(nonce),
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "x-xss-protection": "0",
    "permissions-policy":
      "accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), usb=(), xr-spatial-tracking=()",
    // cíl pro `report-to csp` v CSP výše (Reporting API); bez téhle hlavičky se skupina
    // „csp" nikam nepřeloží a moderní prohlížeč report zahodí
    "reporting-endpoints": `csp="${CSP_REPORT_URI}"`,
    // popupy (tisk protokolu / výstupu) musí zůstat spojené s otvírající stránkou,
    // proto -allow-popups a ne tvrdé same-origin
    "cross-origin-opener-policy": "same-origin-allow-popups",
    "cross-origin-resource-policy": "same-origin",
  };
}

/** HTML odpověď s hlavičkami (stránky se nekešují — lišta ukazuje živý stav). */
export function htmlResponse(body: string, nonce: string): Response {
  return new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...securityHeaders(nonce) },
  });
}

/**
 * RFC 9116 — kontakt pro nálezy. `Expires` se počítá za běhu (rok dopředu),
 * aby soubor nezestárnul tím, že na něj někdo zapomene.
 */
export function securityTxt(host: string): Response {
  const exp = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().replace(/\.\d+Z$/, "Z");
  const body = [
    "# faxx-hr — nález v bezpečnosti nám prosím pošli na kontakt níž.",
    "# Security issue? Please report it to the contact below.",
    "Contact: mailto:info@maxferit.cz",
    `Expires: ${exp}`,
    "Preferred-Languages: cs, en",
    `Canonical: https://${host}/.well-known/security.txt`,
    "",
  ].join("\n");
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
      ...securityHeaders(),
    },
  });
}
