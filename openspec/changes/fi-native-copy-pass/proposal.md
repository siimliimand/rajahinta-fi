# Proposal: fi-native-copy-pass

## Why

A 2026-10-06 native-reader review found the Finnish-first product reading like translated spec text rather than native Finnish. The Finnish is grammatical, but it was authored in the engineer's register: `juonetarve` (parses as *"juonet"* — the plots — + *arve*), `Ostoskorioptimointori` (a coined word; the header nav itself calls the feature "Ostoskori"), `Miten järjestäminen toimii` (*järjestäminen* is organizing an event, not ordering a list), three competing terms for allowance limits (`tullimäärärajat`, `tullivapaat määrät`, `tulliton määrä`), three surface forms of the ethanol unit price (`Etanoli-€/g`, `snt/g`, `€/g-arvo`) — including a value-table header claiming **euros**/gram above cells rendering **cents**/gram — and engineering vocabulary (`deterministinen`, `rajattu syöte`, `materialisoitu tilannekuva`, `tiedollinen`, `aineistoversio`) on consumer pages. The ranking methodology copy also strains the existing `ranking-sorting` "Documentable logic" requirement, which already mandates consumer language "without … build-time terminology" — fixing it is a compliance correction, not just polish. Root cause: catalog copy with no glossary enforcing canonical terms. The 2026-10-05 `fi-locale-surface-hardening` change fixed foreign strings leaking *into* Finnish surfaces; this change fixes the Finnish itself.

## What Changes

- Add a permanent Finnish copy glossary (`docs/fi-copy-glossary.md`): canonical terms per concept (FI + EN), register rules, before/after examples.
- Word fixes on the event, navigation, and footer surfaces: `juonetarve` → `juomatarve`; `Ostoskorioptimointori` → `Ostoskorilaskuri`; `Miten järjestäminen toimii` → `Miten järjestys muodostuu` (page) / `Järjestysperiaatteet` (nav slot); `matalin ensin` → `halvin ensin` on price sorts.
- Terminology unification: allowance limits render as the `tullivapaiden määrien` family everywhere (Tulli's official phrasing, already used by `/allowances`); the ethanol unit price renders under one canonical name (`etanolin grammahinta`) and one display unit (`snt/g`) across the value page, chips, and sort labels — fixing the value-table header/cell unit contradiction. Computation stays €/g; the unit change is rendering-only.
- Register inversion on the ranking methodology page: consumer sentence first, mechanism in plain-but-precise Finnish; every neutrality enforcement fact stays stated (no paid-placement field, test-pinned input shape, unknown-field rejection), but engineering nouns (`deterministinen`, `rajattu syöte`, `testeillä lukittu muoto`, `odottamattoman tiedon hylkäys`) leave the consumer copy.
- Spec-voice sweep on informational surfaces: `materialisoitu` (×4), `tiedollinen` (×5), `aineistoversio` (×6) replaced per glossary; *— ei neuvontaa* / informational-not-advice disclaimers preserved verbatim in intent.
- EN catalog: units, terminology parity, and wrong-word equivalents fixed; the methodology section **deliberately keeps** its conventional semi-technical register (documented asymmetry).
- `docs/legal-briefing-package.md` synced with the renamed ranking page title.
- Pinned tests asserting exact copy are updated deliberately (precedent: `fi-locale-surface-hardening`).

## Capabilities

### Modified Capabilities

- `web-application`: ADDED requirement *Canonical Finnish terminology and native register* — catalog copy carries one canonical term per concept per the glossary, in native register.
- `ranking-sorting`: MODIFIED requirement *Documentable logic* — the transparency copy standard tightens to native register with the engineering-noun ban made explicit for Finnish.
- `unit-price-metrics`: MODIFIED requirement *Category ranking by ethanol unit price* — single display unit (snt/g) with header/cell consistency and an on-surface explanation; computed values unchanged.
