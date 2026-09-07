# QA Authoring Studio — Diagrams (Mermaid)

Two ready-to-render diagrams. Paste either block into **[mermaid.live](https://mermaid.live)**,
GitHub/GitLab markdown, Notion, or any Mermaid-capable slide tool. `mermaid.live` also exports
**PNG/SVG** for slides.

> A polished, screenshot-ready version is also in **`ARCHITECTURE_DIAGRAM.html`** (open in any browser).

---

## Diagram 1 — End-to-end flow (main slide)

```mermaid
flowchart TD
  subgraph C["1 · COMPILER — single source of product truth (build-time)"]
    direction TB
    C1["openapi.json<br/><small>API spec: structure & types</small>"]
    C2["enrichment/ · 167 files<br/><small>ranges, constraints, business rules, test guidance</small>"]
    C3["rules/ · 15 files<br/><small>cross-field invariants</small>"]
    C1 --> CM["compile.mjs<br/><small>validates every path vs spec · merges · hard-fails on drift</small>"]
    C2 --> CM
    C3 --> CM
    CM --> CD["data/compiled/<br/><small>features.json · _graph.json · drift-report.json</small><br/><b>213 features · 167 in scope · 0 drift</b>"]
  end

  subgraph S["2 · QA STUDIO — select · assemble · validate · export (browser, no server)"]
    direction TB
    S1["Scenario<br/><small>region · vehicles · jobs · Positive/Negative</small>"]
    S2["Feature tree<br/><small>live from openapi.json — auto-syncs</small>"]
    S3["Count plan<br/><small>Standard vs Important → exact targets</small>"]
    S4{{"Prompt Builder<br/><small>assembles one copy-paste prompt</small>"}}
    S1 --> S2 --> S3 --> S4
    SK["SKILLS<br/><small>_base + test-cases: how to reason + output contract</small>"] --> S4
    CD -. compiled knowledge for selected features .-> S4
    POOL["Region coordinate pool"] --> S4
  end

  subgraph CL["3 · CLAUDE — reasoning engine (manual copy/paste)"]
    direction TB
    CL1["Paste prompt → Claude proposes cases<br/><small>uses only injected knowledge; never invents facts</small>"]
    CL1 --> CL2["Returns JSON array → paste back"]
  end

  subgraph O["4 · VALIDATE & DELIVER"]
    direction TB
    O1["Validation engine<br/><small>AJV vs OpenAPI schema + 15 business rules</small>"]
    O1 --> O2["Per-case badges<br/><small>✅ valid · ❌ invalid+errors · ⚠ intended · dup/draft flags</small>"]
    O2 --> O3["Results table + Coverage matrix"]
    O3 --> O4["⬇ Export CSV"]
  end

  CD ==> S1
  S4 == "Copy prompt ⧉" ==> CL1
  CL2 ==> O1
  O3 -. "coverage gaps feed the next prompt" .-> S4

  classDef compiler fill:#eff6ff,stroke:#2563eb,color:#0f172a;
  classDef studio fill:#f0fdfa,stroke:#0d9488,color:#0f172a;
  classDef skills fill:#f5f3ff,stroke:#7c3aed,color:#0f172a;
  classDef claude fill:#fffbeb,stroke:#d97706,color:#0f172a;
  classDef output fill:#f0fdf4,stroke:#16a34a,color:#0f172a;
  class C,C1,C2,C3,CM,CD compiler;
  class S,S1,S2,S3,S4,POOL studio;
  class SK skills;
  class CL,CL1,CL2 claude;
  class O,O1,O2,O3,O4 output;
```

---

## Diagram 2 — Responsibilities (one-glance "who owns what")

Use this when you want to make the *single-source-of-truth* point in a single slide.

```mermaid
flowchart LR
  A["COMPILER<br/><b>owns the TRUTH</b><br/><small>facts · rules · constraints</small>"]:::compiler
  B["QA STUDIO<br/><b>ASSEMBLES & VALIDATES</b><br/><small>selects features · builds prompt · checks output</small>"]:::studio
  C["SKILLS<br/><b>HOW TO REASON</b><br/><small>no product facts</small>"]:::skills
  D["CLAUDE<br/><b>REASONS</b><br/><small>proposes cases</small>"]:::claude
  E["TRUSTED SUITE<br/><b>validated output</b><br/><small>table · coverage · CSV</small>"]:::output

  A -- "knowledge" --> B
  C -- "reasoning rules" --> B
  B -- "assembled prompt" --> D
  D -- "proposed cases" --> B
  B -- "verified valid" --> E

  classDef compiler fill:#eff6ff,stroke:#2563eb,color:#0f172a;
  classDef studio fill:#f0fdfa,stroke:#0d9488,color:#0f172a;
  classDef skills fill:#f5f3ff,stroke:#7c3aed,color:#0f172a;
  classDef claude fill:#fffbeb,stroke:#d97706,color:#0f172a;
  classDef output fill:#f0fdf4,stroke:#16a34a,color:#0f172a;
```

---

### The one line to say over either diagram
> "The spec is the single source of truth, Claude does the reasoning, and the tool proves every result before we trust it."
