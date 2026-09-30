# Saved bedroom approach failures

Seven complete original-survey / plan / repair-request JSON fixtures from the
2026-09-26 orientation audit. Inputs retain every generated room, closet, opening,
stair, furniture item and plan metadata field. The optional opening schedule books
are explicitly labelled diagnostic assumptions from cloned level files; they are
not verified products or construction schedules.

Source matrix: `tmp/universal-coverage/2026-09-26T19-52-10-455Z-bedroom-approach-matrix/`.
Original handler responses: `tmp/universal-coverage/2026-09-26-opening-route-handler-audit/`.
The fixtures preserve the seven 30-inch either-side failures in the matrix's
`independent-verification.json`. All original plans pass original-survey concept
validation. Finished geometry adds stricter measurements without retroactively
claiming the original plans were construction ready.

Current bounded bed/nightstand translation repairs East/standard option 2 and
West/standard option 2. Other cases stay search-limited, not declared infeasible.
North/standard option 4 needs more than a naive wall offset: that offset intersects
the reach-in closet access reservation. Tests preserve both constraints.

Fixtures are minified JSON to keep full evidence reasonably small. They are loaded
without rewriting IDs or geometry. See `test/bedroom-approach-repair.test.js` and
the root implementation log for reproduction and limitations.
