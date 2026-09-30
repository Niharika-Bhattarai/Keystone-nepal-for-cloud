"""Drawing-wide BYLAYER hierarchy. DXF lineweights are hundredths of mm."""
LAYERS = [
    ('A-WALL', 7, 50),             # cut wall faces: 0.50 mm
    ('A-STAIR-CUT', 7, 50),
    ('A-DOOR', 1, 25),             # visible secondary outlines
    ('A-STAIR', 7, 25),
    ('A-ELEV-WALL', 7, 25),
    ('A-ELEV-ROOF', 7, 35),
    ('A-WINDOW', 5, 13),           # glazing and symbolic swing arcs
    ('A-DOOR-SWNG', 1, 13),
    ('A-STAIR-RISR', 8, 18),
    ('A-STAIR-PATH', 3, 18),
    ('A-STAIR-OVHD', 8, 9),        # overhead/hidden information
    ('A-ELEV-DATUM', 8, 9),
    ('A-FURN', 8, 13),
    ('A-FIXT', 6, 13),
    ('A-ROOM', 7, 18),
    ('A-OPEN-TAGS', 2, 18),
    ('A-DIMS', 4, 13),
    ('A-DIMS-DETAIL', 4, 13),
    ('A-SCHEDULE', 7, 13),
    ('A-TITLE', 7, 35),
    ('A-VPORT', 8, 0),
]


def install(doc):
    doc.header['$LWDISPLAY'] = 1
    doc.header['$CELWEIGHT'] = -1  # new CAD entities inherit their layer
    for name, color, weight in LAYERS:
        doc.layers.new(name, dxfattribs={'color': color, 'lineweight': weight})
    doc.layers.get('A-VPORT').dxf.plot = 0


def configure_sheet(layout):
    # Physical paper widths, independent of viewport scale. Do not require a
    # custom CTB file to make the hierarchy survive transfer to another CAD app.
    layout.print_lineweights(True)
    layout.scale_lineweights(False)
    layout.use_plot_styles(False)
