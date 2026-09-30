# Nepal design knowledge library

Start with [design principles](DESIGN-PRINCIPLES.md), then the [source-linked rule catalog](RULE-CATALOG.md). The catalog operationalizes the supplied references for house design, with Vaastu first among design preferences and mandatory safety/legal constraints enforced separately.

## Contents

- [Converted-source index](SOURCE-INDEX.md): every supplied PDF/EPUB, stable ID and extraction status.
- [Design principles](DESIGN-PRINCIPLES.md): spatial strategy, hierarchy, source disagreements and compact-house implications.
- [Rule catalog](RULE-CATALOG.md) / [JSON rules](rules.json): conditions, measurement method, repairs, conflicts and citations.
- [Integration and commands](INTEGRATION.md): local search, context retrieval, fact checks and next engine steps.
- [Code review notes](CODE-REVIEW.md): adopted-edition boundaries, numeric extraction checks and known source inconsistencies.
- [Manifest](manifest.json): original paths/hashes and quality flags.
- `library.sqlite`: rebuildable local search index.
- `sources/`: extracted Markdown, with PDF page/EPUB section anchors.
- `assets/`: extracted EPUB illustrations. `review/`: selected PDF pages rendered for visual checks. `ocr/`: unverified text supplements.

```powershell
python "Keystone Nepal/knowledge/tools/knowledge.py" context "kitchen stairs puja"
```

All references are locally accessible; no external model is needed to retrieve them. Full source text stays private. PDF extraction cannot faithfully encode every drawing, formula or complex table; follow the original-page references and review flags.

**Delivered:** conversion, search index, source-grounded synthesis, rules and tested fact-evaluation utilities. **Not delivered by this task:** production Nepal generation, automatic structural analysis or professional approval of a house.
