"""Generate the per-style status icons (err, warn, info, ok) for the Paper Test Editor.

The drawings are the Blackboard Question Editor's (tools/make-status-icons.py in that repo),
so both tools show the same signs in each style. Keep the two scripts' drawings in step.
Paper, this editor's own default style, uses the Question Editor's default set ("studio").

Usage, from anywhere:  python3 tools/make-status-icons.py
It rewrites all 36 files in icons/status/<style>/. Needs only Python 3, no packages.

Retro OS styles (win98, system) are pixel art drawn on a 16x16 grid.
XP and Win7 are glossy vector drawings. The clean styles are single-colour
silhouettes used as CSS masks, so they take the theme's colours (day and night).
"""
import math, os, sys

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons', 'status')

# ---------------------------------------------------------------- pixel helpers
def blank(n=16):
    return [['.'] * n for _ in range(n)]

def to_svg(grid, pal, title):
    n = len(grid)
    paths = {}
    for y, row in enumerate(grid):
        x = 0
        while x < n:
            c = row[x]
            if c == '.':
                x += 1; continue
            run = 1
            while x + run < n and row[x + run] == c: run += 1
            paths.setdefault(c, []).append(f'M{x} {y}h{run}v1h-{run}z')
            x += run
    body = ''.join(f'<path fill="{pal[c]}" d="{"".join(d)}"/>' for c, d in paths.items())
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n} {n}" width="{n}" height="{n}" '
            f'shape-rendering="crispEdges"><title>{title}</title>{body}</svg>\n')

def outline(grid, inside_ch, edge_ch):
    """Mark pixels of `inside_ch` that touch the outside as `edge_ch`."""
    n = len(grid)
    inside = {(x, y) for y in range(n) for x in range(n) if grid[y][x] != '.'}
    for (x, y) in list(inside):
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            if (x + dx, y + dy) not in inside:
                grid[y][x] = edge_ch; break

def shadow(grid, ch, dx=1, dy=1, dither=True):
    n = len(grid)
    filled = {(x, y) for y in range(n) for x in range(n) if grid[y][x] != '.'}
    for (x, y) in filled:
        sx, sy = x + dx, y + dy
        if 0 <= sx < n and 0 <= sy < n and (sx, sy) not in filled:
            if not dither or (sx + sy) % 2 == 0:
                grid[sy][sx] = ch

def stamp(grid, rows, ox, oy, mapping):
    for j, r in enumerate(rows):
        for i, c in enumerate(r):
            if c != ' ' and c in mapping:
                grid[oy + j][ox + i] = mapping[c]

def circle(n=15, r=6.95):
    g = blank()
    c = (n - 1) / 2  # centre on a 15px disc, leaves room for the shadow
    for y in range(n):
        for x in range(n):
            if math.hypot(x - c, y - c) <= r: g[y][x] = 'F'
    return g

def triangle():
    g = blank()
    # apex row 0 (cols 7..7), base row 14 cols 0..14 on a 15px wide shape
    for y in range(15):
        half = 0.5 + y * 7 / 14
        for x in range(15):
            if abs(x - 7) <= half: g[y][x] = 'F'
    return g

def shade_circle(g, light, dark, n=15):
    """Win98-ish shading: light upper-left rim, dark lower-right rim inside the outline."""
    c = (n - 1) / 2
    for y in range(n):
        for x in range(n):
            if g[y][x] == 'F':
                d = math.hypot(x - c, y - c)
                if d > 4.9:
                    if (x - c) + (y - c) > 3.5: g[y][x] = dark
                    elif (x - c) + (y - c) < -4.5: g[y][x] = light

GLYPH_X = [
    'XX     XX',
    'XXX   XXX',
    ' XXX XXX ',
    '  XXXXX  ',
    '   XXX   ',
    '  XXXXX  ',
    ' XXX XXX ',
    'XXX   XXX',
    'XX     XX',
]
GLYPH_X7 = [
    'XX   XX',
    'XXX XXX',
    ' XXXXX ',
    '  XXX  ',
    ' XXXXX ',
    'XXX XXX',
    'XX   XX',
]
GLYPH_EXCL = ['XX', 'XX', 'XX', 'XX', 'XX', '  ', 'XX', 'XX']
GLYPH_I = [' XX ', ' XX ', '    ', 'XXX ', ' XX ', ' XX ', ' XX ', 'XXXX']
GLYPH_CHECK = [
    '       XX',
    '      XXX',
    '     XXX ',
    'XX  XXX  ',
    'XXXXXX   ',
    ' XXXX    ',
    '  XX     ',
]

# ---------------------------------------------------------------- Windows 98
W98 = {'K': '#000000', 'R': '#ff0000', 'r': '#800000', 'p': '#ff8080', 'W': '#ffffff', 'Y': '#ffff00', 'y': '#808000',
       'B': '#0000ff', 'b': '#000080', 'G': '#00a000', 'g': '#006000', 'l': '#80ff80', 'S': '#808080', 'L': '#c0c0c0'}

def w98_err():
    g = circle(); shade_circle(g, 'p', 'r'); outline(g, 'F', 'K')
    for row in g:
        for i, c in enumerate(row):
            if c == 'F': row[i] = 'R'
    stamp(g, GLYPH_X7, 4, 4, {'X': 'W'}); shadow(g, 'S'); return g

def w98_warn():
    g = triangle(); outline(g, 'F', 'K')
    for y, row in enumerate(g):
        for i, c in enumerate(row):
            if c == 'F': row[i] = 'Y'
    # darker olive along the lower inside edge, like a bevel
    for i in range(1, 14):
        if g[13][i] == 'Y': g[13][i] = 'y'
    stamp(g, GLYPH_EXCL, 6, 4, {'X': 'K'}); shadow(g, 'S'); return g

def w98_info():
    # white speech balloon, blue "i", black outline, tail at lower left
    g = blank()
    for y in range(12):
        for x in range(15):
            if ((x - 7) / 7.2) ** 2 + ((y - 5.5) / 5.9) ** 2 <= 1: g[y][x] = 'F'
    for (x, y) in ((3, 11), (4, 11), (2, 12), (3, 12), (1, 13), (2, 13), (1, 14)): g[y][x] = 'F'
    outline(g, 'F', 'K')
    for row in g:
        for i, c in enumerate(row):
            if c == 'F': row[i] = 'W'
    stamp(g, GLYPH_I, 6, 2, {'X': 'B'})
    shadow(g, 'S'); return g

def w98_ok():
    g = circle(); shade_circle(g, 'l', 'g'); outline(g, 'F', 'K')
    for row in g:
        for i, c in enumerate(row):
            if c == 'F': row[i] = 'G'
    stamp(g, GLYPH_CHECK, 3, 4, {'X': 'W'}); shadow(g, 'S'); return g

# ---------------------------------------------------------------- classic Mac (1-bit)
MAC = {'K': '#000000', 'W': '#ffffff'}

def mac_err():
    # black octagon (stop sign), white X
    g = blank()
    for y in range(15):
        for x in range(15):
            if abs(x - 7) + abs(y - 7) <= 10: g[y][x] = 'K'
    stamp(g, GLYPH_X7, 4, 4, {'X': 'W'})
    return g

def mac_warn():
    g = triangle(); outline(g, 'F', 'K')
    for row in g:
        for i, c in enumerate(row):
            if c == 'F': row[i] = 'W'
    stamp(g, GLYPH_EXCL, 6, 4, {'X': 'K'})
    return g

def mac_info():
    # a note card with a folded corner and an "i"
    rows = [
        'KKKKKKKKKK     ',
        'KWWWWWWWWKK    ',
        'KWWWWWWWWKWK   ',
        'KWWWWWWWWKWWK  ',
        'KWWWWWWWWKKKKK ',
        'KWWWWWWWWWWWWK ',
        'KWWWWWWWWWWWWK ',
        'KWWWWWWWWWWWWK ',
        'KWWWWWWWWWWWWK ',
        'KWWWWWWWWWWWWK ',
        'KWWWWWWWWWWWWK ',
        'KWWWWWWWWWWWWK ',
        'KWWWWWWWWWWWWK ',
        'KWWWWWWWWWWWWK ',
        'KKKKKKKKKKKKKK ',
    ]
    g = blank()
    stamp(g, rows, 0, 0, {'K': 'K', 'W': 'W'})
    stamp(g, GLYPH_I, 5, 5, {'X': 'K'})
    return g

def mac_ok():
    # rounded checkbox with a bold check, the way Mac dialogs drew a ticked box
    g = blank()
    for y in range(1, 14):
        for x in range(1, 14):
            g[y][x] = 'W'
    for i in range(1, 14):
        g[1][i] = g[13][i] = g[i][1] = g[i][13] = 'K'
    for (x, y) in ((1, 1), (13, 1), (1, 13), (13, 13)): g[y][x] = '.'
    stamp(g, GLYPH_CHECK, 3, 3, {'X': 'K'})
    return g

# ---------------------------------------------------------------- vector helpers
def svg(inner, title, size=32, defs=''):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}">'
            f'<title>{title}</title>{"<defs>" + defs + "</defs>" if defs else ""}{inner}</svg>\n')

TRI = 'M16 2.6c.9 0 1.7.5 2.2 1.3l12 21.3c.9 1.7-.3 3.8-2.2 3.8H4c-1.9 0-3.1-2.1-2.2-3.8l12-21.3c.5-.8 1.3-1.3 2.2-1.3z'

# ---------------------------------------------------------------- Windows XP
def xp(level):
    shadow_el = '<ellipse cx="16.5" cy="29.6" rx="11" ry="2" fill="#000" opacity=".22"/>'
    if level == 'err':
        defs = ('<radialGradient id="a" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="#ff9a85"/>'
                '<stop offset=".45" stop-color="#e8261b"/><stop offset="1" stop-color="#9c0b05"/></radialGradient>')
        body = (shadow_el + '<circle cx="16" cy="15" r="13" fill="url(#a)" stroke="#7a0a04" stroke-width="1.2"/>'
                '<path d="M10.6 9.6l10.8 10.8m0-10.8L10.6 20.4" stroke="#fff" stroke-width="3.6" stroke-linecap="round"/>')
    elif level == 'warn':
        defs = ('<linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff2a6"/>'
                '<stop offset=".5" stop-color="#ffd21f"/><stop offset="1" stop-color="#eda400"/></linearGradient>')
        body = (shadow_el + f'<path d="{TRI}" fill="url(#a)" stroke="#a36a00" stroke-width="1.2" transform="translate(0 -1.2)"/>'
                '<path d="M16 9.6v8.2" stroke="#1a1a1a" stroke-width="3.6" stroke-linecap="round"/>'
                '<circle cx="16" cy="22.6" r="2.1" fill="#1a1a1a"/>')
    elif level == 'info':
        defs = ('<radialGradient id="a" cx=".38" cy=".3" r=".78"><stop offset="0" stop-color="#bfe0ff"/>'
                '<stop offset=".45" stop-color="#3b8cf0"/><stop offset="1" stop-color="#0a3fa8"/></radialGradient>')
        body = (shadow_el + '<circle cx="16" cy="15" r="13" fill="url(#a)" stroke="#0a3482" stroke-width="1.2"/>'
                '<circle cx="16" cy="8.8" r="2.2" fill="#fff"/>'
                '<path d="M13 13h4.4v8.4H19v1.8h-6v-1.8h1.6v-6.6H13z" fill="#fff"/>')
    else:
        defs = ('<radialGradient id="a" cx=".38" cy=".3" r=".78"><stop offset="0" stop-color="#c8f5a8"/>'
                '<stop offset=".45" stop-color="#43b02a"/><stop offset="1" stop-color="#1c6e10"/></radialGradient>')
        body = (shadow_el + '<circle cx="16" cy="15" r="13" fill="url(#a)" stroke="#155c0b" stroke-width="1.2"/>'
                '<path d="M9.6 15.4l4.4 4.4 8.6-9.2" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>')
    return svg(body, 'XP ' + level, defs=defs)

# ---------------------------------------------------------------- Windows 7 (glass)
def w7(level):
    gloss_c = '<path d="M5.2 13.2C5.6 7.4 10.3 3.2 16 3.2s10.4 4.2 10.8 10c-3 1.9-6.8 2.8-10.8 2.8s-7.8-.9-10.8-2.8z" fill="url(#g)"/>'
    gdef = ('<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".85"/>'
            '<stop offset="1" stop-color="#fff" stop-opacity=".08"/></linearGradient>')
    def disc(c0, c1, c2, edge):
        return ('<linearGradient id="a" x1="0" y1="0" x2="0" y2="1">'
                f'<stop offset="0" stop-color="{c0}"/><stop offset=".55" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/></linearGradient>' + gdef,
                f'<circle cx="16" cy="16" r="13.4" fill="url(#a)" stroke="{edge}" stroke-width="1"/>'
                '<circle cx="16" cy="16" r="12.3" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1"/>')
    if level == 'err':
        defs, base = disc('#f38a74', '#d8301c', '#a51708', '#7c1408')
        glyph = '<path d="M11.2 11.2l9.6 9.6m0-9.6l-9.6 9.6" stroke="#fff" stroke-width="3" stroke-linecap="round"/>'
        return svg(base + glyph + gloss_c, 'Windows 7 ' + level, defs=defs)
    if level == 'info':
        defs, base = disc('#8cc4f7', '#2f7fd8', '#1553a8', '#0e3f86')
        glyph = '<circle cx="16" cy="9.6" r="2" fill="#fff"/><path d="M14.4 13.4h3.2v9.4h-3.2z" fill="#fff"/>'
        return svg(base + glyph + gloss_c, 'Windows 7 ' + level, defs=defs)
    if level == 'ok':
        defs, base = disc('#9be38b', '#3aa83c', '#1d7a21', '#145c17')
        glyph = '<path d="M10.4 16.4l3.8 3.8 7.6-8" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'
        return svg(base + glyph + gloss_c, 'Windows 7 ' + level, defs=defs)
    defs = ('<linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe98a"/>'
            '<stop offset=".55" stop-color="#f7c21b"/><stop offset="1" stop-color="#d99a00"/></linearGradient>' + gdef)
    body = (f'<path d="{TRI}" fill="url(#a)" stroke="#9a6b00" stroke-width="1"/>'
            '<path d="M16 4.6c.5 0 .9.3 1.2.7l5.4 9.6c-2 .8-4.3 1.2-6.6 1.2s-4.6-.4-6.6-1.2l5.4-9.6c.3-.4.7-.7 1.2-.7z" fill="url(#g)"/>'
            '<path d="M16 11v7.4" stroke="#2b2b2b" stroke-width="3" stroke-linecap="round"/><circle cx="16" cy="22.8" r="1.8" fill="#2b2b2b"/>')
    return svg(body, 'Windows 7 ' + level, defs=defs)

# ---------------------------------------------------------------- clean styles (masks, black = shown)
def mask_svg(inner, title):
    return svg(inner, title, size=24)

STROKE = 'fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round"'
TRI24 = 'M12 3.2 2.6 19.6c-.5.9.1 2 1.2 2h16.4c1 0 1.7-1.1 1.2-2L12 3.2z'

def studio(level):  # outline icons, same stroke weight as the app's toolbar icons
    s = f'{STROKE} stroke-width="1.9"'
    return mask_svg({
        'err': f'<circle cx="12" cy="12" r="9.2" {s}/><path d="M8.8 8.8l6.4 6.4m0-6.4-6.4 6.4" {s}/>',
        'warn': f'<path d="M10.3 4.2 2.9 17.4c-.8 1.4.2 3.1 1.8 3.1h14.6c1.6 0 2.6-1.7 1.8-3.1L13.7 4.2c-.8-1.4-2.6-1.4-3.4 0z" {s}/><path d="M12 9.2v4.6" {s}/><circle cx="12" cy="17.1" r="1.15"/>',
        'info': f'<circle cx="12" cy="12" r="9.2" {s}/><path d="M12 11v5.6" {s}/><circle cx="12" cy="7.8" r="1.15"/>',
        'ok': f'<circle cx="12" cy="12" r="9.2" {s}/><path d="M8.2 12.3l2.6 2.6 5-5.4" {s}/>',
    }[level], 'Studio ' + level)

# knock-out helper: a mask with white glyph inside a black shape
def knock(shape, glyph, title):
    return mask_svg(f'<mask id="k"><rect width="24" height="24" fill="#fff"/>{glyph}</mask><g mask="url(#k)">{shape}</g>', title)

G_X = '<path d="M8.6 8.6l6.8 6.8m0-6.8-6.8 6.8" stroke="#000" stroke-width="2.4" stroke-linecap="round"/>'
G_I = '<circle cx="12" cy="7.6" r="1.5" fill="#000"/><path d="M12 11v6" stroke="#000" stroke-width="2.4" stroke-linecap="round"/>'
G_C = '<path d="M7.8 12.4l2.8 2.8 5.6-6" fill="none" stroke="#000" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'
G_E = '<path d="M12 9v4.6" stroke="#000" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="17.2" r="1.5" fill="#000"/>'

def pico(level):  # solid discs with the sign cut out
    circ = '<circle cx="12" cy="12" r="10"/>'
    tri = '<path d="M10.2 3.6 1.9 18c-.8 1.4.2 3.2 1.8 3.2h16.6c1.6 0 2.6-1.8 1.8-3.2L13.8 3.6c-.8-1.4-2.8-1.4-3.6 0z"/>'
    return {'err': knock(circ, G_X, 'Pico err'), 'warn': knock(tri, G_E.replace('9v4.6', '9.4v4.4').replace('17.2', '17.4'), 'Pico warn'),
            'info': knock(circ, G_I, 'Pico info'), 'ok': knock(circ, G_C, 'Pico ok')}[level]

def mvp(level):  # chunky rounded squares; warning is the same square turned on its corner
    sq = '<rect x="2" y="2" width="20" height="20" rx="5.5"/>'
    dia = '<rect x="4.2" y="4.2" width="15.6" height="15.6" rx="3.6" transform="rotate(45 12 12)"/>'
    gx = G_X.replace('2.4', '3')
    gi = G_I.replace('2.4', '3').replace('r="1.5"', 'r="1.8"')
    gc = G_C.replace('2.4', '3')
    ge = '<path d="M12 7.4v5" stroke="#000" stroke-width="3" stroke-linecap="round"/><circle cx="12" cy="16.2" r="1.8" fill="#000"/>'
    return {'err': knock(sq, gx, 'MVP err'), 'warn': knock(dia, ge, 'MVP warn'), 'info': knock(sq, gi, 'MVP info'), 'ok': knock(sq, gc, 'MVP ok')}[level]

def new(level):  # bare signs, no badge: geometric and quiet, like new.css itself
    s = 'fill="none" stroke="#000" stroke-width="2.6" stroke-linecap="square"'
    return mask_svg({
        'err': f'<path d="M6 6l12 12M18 6 6 18" {s}/>',
        'warn': f'<path d="M12 3.5v11" {s}/><rect x="10.7" y="18" width="2.6" height="2.6"/>',
        'info': f'<rect x="10.7" y="3.4" width="2.6" height="2.6"/><path d="M8.5 9.6H12v10.8M8.5 20.4h7" {s}/>',
        'ok': f'<path d="M4 12.6l5.2 5.2L20 7" {s} stroke-linejoin="miter"/>',
    }[level], 'new.css ' + level)

def blossom():
    # five rounded petals with a small notch at each tip, plus a filled centre
    petals = []
    for k in range(5):
        a = -90 + k * 72
        petals.append(f'<path transform="rotate({a + 90} 12 12)" d="M12 12C8.2 9.4 7.8 4.6 9.7 2.5c.8-.9 1.7-.7 2.3.5.6-1.2 1.5-1.4 2.3-.5 1.9 2.1 1.5 6.9-2.3 9.5z"/>')
    return ''.join(petals) + '<circle cx="12" cy="12" r="5.9"/>'

def sakura(level):  # a cherry blossom with the sign cut out of its heart
    w = 'stroke="#000" stroke-width="2.5" stroke-linecap="round"'
    gx = f'<path d="M9.7 9.7l4.6 4.6m0-4.6-4.6 4.6" {w}/>'
    ge = f'<path d="M12 8.4v3.8" {w}/><circle cx="12" cy="15.5" r="1.4" fill="#000"/>'
    gi = f'<circle cx="12" cy="8.6" r="1.4" fill="#000"/><path d="M12 11.6v3.9" {w}/>'
    gc = f'<path d="M9.2 12.1l2 2 3.8-4.2" fill="none" {w} stroke-linejoin="round"/>'
    return knock(blossom(), {'err': gx, 'warn': ge, 'info': gi, 'ok': gc}[level], 'Sakura ' + level)

# ---------------------------------------------------------------- write
SETS = {
    'win98': lambda l: to_svg({'err': w98_err, 'warn': w98_warn, 'info': w98_info, 'ok': w98_ok}[l](), W98, 'Windows 98 ' + l),
    'system': lambda l: to_svg({'err': mac_err, 'warn': mac_warn, 'info': mac_info, 'ok': mac_ok}[l](), MAC, 'System ' + l),
    'xp': xp, 'win7': w7, 'studio': studio, 'pico': pico, 'mvp': mvp, 'new': new, 'sakura': sakura,
}
for skin, fn in SETS.items():
    os.makedirs(os.path.join(OUT, skin), exist_ok=True)
    for level in ('err', 'warn', 'info', 'ok'):
        with open(os.path.join(OUT, skin, level + '.svg'), 'w') as f:
            f.write(fn(level))
print('wrote', len(SETS) * 4, 'icons to', OUT)

# ---------------------------------------------------------------- inline the masks into css/app.css
# Masks loaded from files are blocked when index.html is opened from disk (file://), so the clean styles'
# icons go into the stylesheet as data: URLs, between the generated:begin / generated:end lines.
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
CSS = os.path.join(ROOT, 'css', 'app.css')

def data_url(svg_text):
    t = ' '.join(svg_text.split())
    t = t.replace('%', '%25').replace('#', '%23').replace('<', '%3C').replace('>', '%3E').replace("'", '%27')
    return "url('data:image/svg+xml," + t + "')"

if len(sys.argv) == 1 and os.path.exists(CSS):
    lines = []
    for skin, sel in (('studio', ':root'), ('pico', ':root[data-skin="pico"]'), ('mvp', ':root[data-skin="mvp"]'),
                      ('new', ':root[data-skin="new"]'), ('sakura', ':root[data-skin="sakura"]')):
        vals = '\n'.join(f'  --ico-{l}: {data_url(SETS[skin](l))};' for l in ('err', 'warn', 'info', 'ok'))
        lines.append(sel + ' {\n' + vals + '\n}')
    with open(CSS) as f:
        css = f.read()
    b = css.index('\n', css.index('/* generated:begin')) + 1
    e = css.index('/* generated:end */')
    with open(CSS, 'w') as f:
        f.write(css[:b] + '\n'.join(lines) + '\n' + css[e:])
    print('inlined the clean-style masks into', os.path.normpath(CSS))
