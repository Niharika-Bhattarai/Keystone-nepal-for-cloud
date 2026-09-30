# MEP: Nepal pilot and shared US capability

## Research conclusion

Add MEP as connected, spatially coordinated systems in the building model. Colored lines on a plan are insufficient: equipment, connection ports, routing, clearances, capacities and calculations must agree.

DUDBC lists NBC 208 for sanitary/plumbing and describes NBC 207 as electrical design requirements for **public buildings**. Verify what applies to the residential pilot rather than assuming that title covers it automatically [S01, S06]. Obtain the municipality's and utility's project-specific requirements.

For the US, ACCA publishes residential load, equipment-selection and duct-design methods; ASHRAE 62.2 addresses residential ventilation; NFPA 70 addresses electrical installation. Applicable editions and local amendments must come from the jurisdiction, not simply the latest publisher release [S07, S08, S10, S11]. This research does not supply licensed standards text or validate a sizing implementation.

## Shared model

Use systems, equipment and ports with explicit units, level/elevation, connection direction, route geometry, specification and review state. buildingSMART's `IfcDistributionPort` is a useful reference for interoperable connection semantics [S13]; full IFC import/export is optional later, not a month-one prerequisite.

Store separate networks for potable water, hot water where present, sanitary waste, vents, rainwater, electrical power and any mechanical/fuel services. Each component has a stable ID and source revision. Graph checks detect disconnected fixtures, incompatible connections and impossible downstream paths. Geometry checks detect collisions and missing service/maintenance access.

## Nepal month-one work

| System | Design inputs | Pilot deliverable | Professional decisions |
|---|---|---|---|
| Water | Source reliability/pressure, occupancy, fixtures, tank locations, hot water/solar intent | Fixture and riser diagram, routes, tank/pump locations, maintenance access, reviewed schedule | Storage, pump duty, pipe sizing, backflow/water quality provisions |
| Sanitary/vent | Fixture elevations, sewer availability and invert; site disposal constraints | Stacked wet cores, waste/vent routes, inspection access, connection/outfall | Pipe sizes/slopes/vents; disposal system design and permissions |
| Rainwater | Roof/terrace areas, drainage levels, rainfall basis, outfall | Falls, outlets/downpipes, overflow paths, drainage coordination | Capacity/design storm and lawful disposal |
| Electrical | Supply/service confirmed with utility, loads, metering, equipment and backup | Lighting/power layout, distribution-board locations, riser/single-line concept and approved schedules | Demand/diversity, service/circuit/conductor/protection/earthing design |
| Mechanical/indoor air | Room use, local climate, natural ventilation, kitchen/bath exhaust, AC/hot water needs | Ventilation and equipment locations, routes, condensate and service access | Required ventilation, equipment sizing, exhaust termination and any fuel safety details |

Roof tanks and solar equipment must feed structural loading and anchorage review. Drain routes must fit real floor/beam elevations; prohibit automatic cutting of columns or beams. Electrical/plumbing routing and separation must follow reviewed rules. A shaft consumes usable floor area and needs access; reserve it before final room fitting.

Pilot drawings can contain engineer-authored calculations and details attached to the coordinated model. Record manual versus automated content. Do not invent conductor sizes, reinforcement, pipe sizes or equipment capacity to make a sheet appear complete.

## US extension after the shared foundation

1. Select one US jurisdiction and construction type; identify adopted plumbing/mechanical/electrical/energy provisions and responsible reviewer.
2. Reuse system graphs and clash detection; keep country-specific units, assemblies and rule values isolated.
3. Collect envelope, infiltration, weather, occupancy and equipment data needed for residential load calculations. Do not size HVAC by floor area alone.
4. Implement or integrate a validated calculation workflow, preserving assumptions/results and the review record. Verify against independent professional examples before claiming design accuracy.
5. Add branch/circuit/fixture schedules, routing, sections and export layers. Check structural penetrations and accessible maintenance envelopes.
6. Release one reviewed service/system slice at a time, with US/Nepal regression tests. Do not promise full automated MEP for both markets inside the Nepal permit month.

## Quality gates

- Each served fixture/equipment item has an explicit connection or a reported missing design.
- Slope/elevation checks follow actual coordinates and downstream levels.
- No unresolved route/structure or access-zone collisions in issued drawings.
- System schedules match objects in plans, risers and quantities.
- Calculation input revisions match the issued architecture/structure.
- Unknown utility and site values remain unknown until confirmed.
- Engineering approval covers the issued revision, and is invalidated when dependent geometry or loads change.

See [source register](07-source-register.md) for primary MEP references and [release checklist](06-verification-and-release.md) for issue controls.
