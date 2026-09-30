# Unit-price library

`unit-prices.csv` is the backend planning-price catalog, in USD. It currently has 40 rows: 28 estimate scopes plus foundation/HVAC/outdoor/water-heater variants.

**These are inherited model allowances, not sourced local quotes.** `date=2026-09-27` records their migration into this catalog, not a supplier quote date. `source=legacy_model_allowance` and `status=uncalibrated` are intentional. No claim of 5% accuracy is supported. NAHB aggregate house-construction cost reports cannot validate individual installed unit prices or ZIP-level pricing.

Columns:

- `key`: estimate scope or system variant; use the existing keys.
- `unit`: quantity basis (sqft, lin ft, fixture, unit, bath, kitchen). The existing soft-cost `lump` entries are fractions of hard-cost dollars, not per-room rates.
- `material`, `labor`: separate base rates; no currency symbols or thousands separators.
- `scope`: `national`, `state`, or `zip`.
- `region`: `US`, a two-letter state, or a five-character ZIP retaining leading zeros.
- `date`, `source`, `status`: provenance. For independently verified replacements, record the actual quote date and a traceable source identifier; retain quote evidence separately.

The restricted CSV format disallows embedded commas/quoted fields. The loader rejects malformed columns, negative/nonfinite rates, missing provenance and duplicate key/scope/region combinations. Restart the backend after changing the catalog.

Selection: exact five-digit ZIP (ZIP+4 normalized for lookup), then state, then national. The UI collects city, state, and ZIP; format validation does **not** establish that the supplied city/state/ZIP agree geographically. There is no geocoding or postal-address verification.

All supplied rows currently have national scope. The requested state selects the existing heuristic regional factor when national prices are used. We deliberately do not manufacture thousands of identical purportedly local quotes. A matched local row supplies installed material/labor rates without multiplying a second regional factor. System-specific keys should describe the selected foundation/HVAC/outdoor assembly; generic local scope rates apply only where that assembly scope is equivalent.

National defaults remain sensitive to the selected finish specification, budget, fixtures and system. Selected finish prices override national material defaults; some labor rates are calculated from those finish prices. The effective `materialUnitPrice` and `laborUnitPrice` are returned per line; `rateSource` identifies the base catalog allowance and is not independent validation of a selected finish. The national fallback labor values in finish rows describe the default finish, rather than overriding the existing finish-dependent labor formula.

Before representing this as a calibrated estimate:

1. Define supported markets and construction assemblies.
2. Obtain dated supplier/installer prices with matching scope and units, including exclusions, freight, tax, minimum charges and waste.
3. Replace allowance quantities with reviewed measured takeoffs where the model supports them.
4. Compare each quantity class and cost scope to independent reference projects. Report item errors; do not average incompatible quantities or hide misses in a total.
5. Add cost-date escalation, quote expiry and explicit coverage reporting before claiming current local pricing. The current fallback must stay visible.
