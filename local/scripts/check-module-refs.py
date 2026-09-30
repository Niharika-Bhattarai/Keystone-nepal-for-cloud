"""Find identifiers a module uses but never imports or declares.

Run from frontend/:   python ../scripts/check-module-refs.py

The bundler does NOT catch these. An unresolved bare identifier compiles
fine and throws only when that code path runs in the browser, so a missing
import inside, say, an export handler survives a green build and a green
page load. After splitting 6,500 lines across 40 modules that is the
failure mode that matters, and it found two real misses the build did not.
"""
import io
import os
import re
import sys

SRC = 'src'

# Every name exported by any module under src/, discovered by scanning so
# the check keeps working as modules are added or renamed.
REGISTRY = {}
FILES = []
for root, _dirs, names in os.walk(SRC):
    for name in names:
        if name.endswith(('.js', '.jsx')) and 'generated' not in name:
            path = os.path.join(root, name).replace(os.sep, '/')
            FILES.append(path)
            text = io.open(path, encoding='utf-8').read()
            for exported in re.findall(
                    r'^export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)',
                    text, re.M):
                REGISTRY[exported] = path

ALL_EXPORTS = set(REGISTRY)

problems = 0
for path in sorted(FILES):
    src = io.open(path, encoding='utf-8').read()

    imported = set()
    for m in re.finditer(r'import\s+(.+?)\s+from\s+[\'"]', src, re.S):
        clause = m.group(1)
        for group in re.findall(r'\{([^}]*)\}', clause):
            for piece in group.split(','):
                piece = piece.strip()
                if piece:
                    imported.add(piece.split(' as ')[-1].strip())
        head = re.sub(r'\{[^}]*\}', '', clause).replace(',', ' ')
        for piece in head.split():
            if piece.isidentifier():
                imported.add(piece)

    declared = set(re.findall(
        r'^(?:export\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)',
        src, re.M))

    body = re.sub(r'import\s+.+?from\s+[\'"][^\'"]+[\'"];', '', src, flags=re.S)
    # Spread syntax (`{ ...DEFAULT_FORM_DATA }`) puts dots before an
    # identifier, and the lookbehind below skips anything preceded by '.' as
    # property access. Without this, spread-only dependencies are invisible -
    # exactly how two missing imports slipped through the first time.
    body = body.replace('...', ' ')

    missing = set()
    for name in ALL_EXPORTS:
        if name in imported or name in declared:
            continue
        if re.search(r'(?<![\w$.])' + re.escape(name) + r'(?![\w$])', body):
            missing.add(name)

    if missing:
        problems += 1
        print(path)
        for name in sorted(missing):
            print('    MISSING  %-28s (exported by %s)' % (name, REGISTRY[name]))

print('\nmodules checked: %d   files with unresolved references: %d'
      % (len(FILES), problems))
sys.exit(1 if problems else 0)
