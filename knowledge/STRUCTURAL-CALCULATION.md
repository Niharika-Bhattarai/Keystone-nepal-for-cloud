# Structural calculation — method and sources

The backend calculates loads and a preliminary design for a residential RC moment frame from a Keystone Nepal hypothesis (`local/backend-keystone/lib/nepal/structural/`). It is a design aid for a licensed engineer, not a stamped design.

## Sources (physical PDF pages)
| Source | File | Use |
|---|---|---|
| NBC 105:2025 (`nbc105-2025`) | `Codes/NBC 2025.pdf` | Governing: Table 3-1 (p39), 3.6/3.7 combinations (p39–41), 3.8 bearing (p41), spectra 4.1–4.2 (p41–49), Table 4-3 soil D (p46), Table 4-4 importance (p48), period 5.1 (p50–52), seismic weight Table 5-1 (p52), Table 5-2 Rμ/Ω (p54), irregularity 5.4 (p55–57), drift 5.5 (p58–59), ESM chapter 6 (p60–61), Annex A detailing (p80–97), Annex C zoning (p122–136) |
| NBC 205:2024 (`nbc205-2024`) | `Codes/NBC_205_READY-TO-USE…pdf` | Layout restrictions 4.2 (p15–17), SBC Table 3-2 (p14), design basis 7.2–7.4 (p24–26) |
| IS 1893 (Part 1):2016 (`is1893-2016`) | `Codes/Seismic design code/kupdf.net_is-1893-2016.pdf` | Cross-check only (period 7.6.2, Sa/g) |
| IS 456:2000, IS 875 | not supplied | Member strength, unit weights, live loads — shown with "*", verify |

The NBC 105:2019 draft commentary is not used.

## Steps
1. Model from the plan: storeys, slabs, columns on the grid, beams (drawing-set layout), every wall with openings deducted, stair, parapets, tank.
2. Gravity loads by 0.1 m cells → tributary column and beam shares; takedown checked against total load.
3. Seismic weight W<sub>i</sub> = DL + 0.3 LL (roof nil).
4. Z (Annex C), soil type (Table 4-3 or input; unknown → C and D, larger governs), I = 1.0.
5. T = min(1.25 × 0.075 H^0.75, Rayleigh); Ch(T) with Ta = 0; C = Ch Z I; Cd = C/(4 × 1.5); SLS 0.2C/1.25; V = Cd W.
6. F<sub>i</sub> = W<sub>i</sub>h<sub>i</sub><sup>k</sup>/ΣW h<sup>k</sup> × V.
7. D-value storey stiffness with cracked sections, drift × Rμ × kd ≤ 0.025 h; SLS ≤ 0.006 h.
8. Torsion (CM vs CR, ±0.05b), irregularities, ESM applicability.
9. Member actions; combinations 1.5(D+L), 1.2D+1.5L, D+0.3L±E, 0.9D±E.
10. Beams, columns (biaxial), confinement, strong column/weak beam, joints, anchorage, footings, tie beams, overturning.
11. Sizes stepped up until the checks pass; each trial is reported.
