# Threat model — faxx-hr

> 🇨🇿 Čeština · [🇬🇧 English](THREAT-MODEL.en.md)

Citlivý projekt (osobní data uchazečů + nepřátelský vstup). Model hrozeb dle
project-standard. Primární hrozba = **prompt injection skrytým textem v CV**
(OWASP LLM01).

## Aktéři a cíle

| Aktér | Cíl |
|---|---|
| Uchazeč-útočník | Nadhodnotit sebe (skrytá instrukce „doporuč mě") |
| Kompromitovaný odesílatel / agentura | Podvrhnout obsah CV bez vědomí uchazeče |
| — | Exfiltrace systémového promptu / kritérií |
| — | DoS (extrémně dlouhý/rekurzivní text, spotřeba tokenů) |

## Vstupní vektory → detekce

| Vektor | Technika | Detekce |
|---|---|---|
| PDF textová vrstva | barva ≈ pozadí (#FEFEFE) | delta E (CIELAB) |
| PDF textová vrstva | font < 4pt | kontrola velikosti |
| PDF content stream | render mode 3 (invisible) | kontrola Tr operátoru |
| PDF souřadnice | mimo mediabox / za obrázkem | z-order + bbox |
| PDF grafický stav | opacity < 0.1 | ExtGState ca/CA |
| DOCX běh textu | `w:vanish` | parsování rPr |
| DOCX barva | bílý/téměř bílý font | w:color vs pozadí |
| DOCX anotace | komentáře / poznámky | comments/footnotes/endnotes.xml |
| DOCX | textboxy, alt-texty | txbxContent, docPr descr |
| Metadata | docProps | core/app/custom.xml |
| Obsah | homoglyfy, zero-width, rozdělené instrukce | sémantika (PhantomLint + Haiku klasifikátor) |
| Barva | same-contrast (#666 na #777) — **dual-path ho nechytí** | delta E (nízký kontrast text↔pozadí) — nezávislá vrstva |
| Obrázek | visual injection: QR kód, mikro-text v logu | detekce QR/čár. kódu; vstup vision modelu je nedůvěryhodný |
| Font | obfuskované glyfy (cmap), EPS/PS, XFA/JS-generovaný text | dual-path mismatch + sémantika; povinné F0 hraniční případy |

## Klíčové mitigace (defense in depth)

1. **Odděl extrakci od hodnocení** — skórovací model nikdy nevidí surový text; injection nemá kam zapsat verdikt.
2. **Dual-path diff** — nezávislý detektor skrytého obsahu (textová vrstva vs. render).
3. **Deterministické detektory + CDR** — bez AI = žádný attack surface, auditovatelné.
4. **Omezené schéma** — `additionalProperties:false`, enumy; `meta.untrusted_content:true`.
5. **Flag ≠ auto-reject** — human-in-the-loop; chyba detektoru je nápravná, ne fatální.

## Ochrana dat (GDPR/NIS2)

- Osobní data zpracovávána **on-prem v ČR** (rasterizace/OCR na Beelinku přes Conduit).
- Žádné reálné CV ani klíče v gitu. Secrets v Cloudflare Secrets.
- `audit_log` append-only (integrita — hašové řetězení k doplnění).
- Retence per zadání; koordinované mazání R2 + D1.
- Least privilege: role personalista vs. správce; Conduit ↔ Beelink vzájemná auth.

## Reziduální rizika

- Sémantická detekce je pravděpodobnostní (false pos/neg) → prahy ladit na held-out F0 sadě.
- **Alert fatigue** — grafická CV (Canva/InDesign, vícesloupce) tvoří dual-path šum; FP 15–30 % → personalista přestane číst. Mitigace: dual-path je **doplňkový** (ne primární), flag gated přes injection klasifikátor, FP na grafických CV = samostatná F0 metrika.
- **Visual prompt injection** — QR/mikro-text/optika na vision model; výstup jde schématem (bez verdikt-pole), QR se flaguje.
- Proxy diskriminace přes neodstraněné signály v textu (jméno školy…).
- Bus factor sólo provozu (mitigace: BUILD.md, jednoduchý stack; pro produkt backup operátor).
