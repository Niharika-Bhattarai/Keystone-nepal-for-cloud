"""Rebuild local, private source Markdown and a page/chapter search index.

PDF extraction is text-only: diagrams and tables remain authoritative in originals.
EPUB resources are preserved and linked. Never execute embedded document content.
"""
from pathlib import Path, PurePosixPath
from html.parser import HTMLParser
from urllib.parse import unquote, quote
import hashlib
import json
import re
import sqlite3
import xml.etree.ElementTree as ET
import zipfile
from contextlib import closing

ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT.parent / 'Design Files'
SOURCES = [
 ('bylaws-resource-2023', 'Resource_Book_on_Building_Bylaws and Building Permit System in_Nepal.pdf', 'MoFAGA/PLGSP — Building By-laws and Building Permit System (June 2023)', 'guidance', 'reference_requires_local_instrument'),
 ('nbc105-2025', 'NBC 2025.pdf', 'NBC 105:2025 — Seismic design of buildings in Nepal', 'code', 'project_adoption_review_required'),
 ('nbc201-1994', '1679824311_10.pdf', 'NBC 201:1994 — RC buildings with masonry infill', 'code', 'historical_scope_review'),
 ('nbc202-2015', '1679824354_21.pdf', 'NBC 202:2015 — Load bearing masonry', 'code', 'different_structural_system'),
 ('nbc204-2015', '1679824428_31.pdf', 'NBC 204:2015 — Earthen buildings', 'code', 'different_structural_system'),
 ('nbc208-2003', '1679824552_72.pdf', 'NBC 208:2003 — Sanitary and plumbing', 'code', 'adoption_review_required'),
 ('nbc105-commentary-draft', '1679826147_18.pdf', 'NBC 105:2019 commentary — DRAFT V1.2', 'commentary', 'draft_not_current_code'),
 ('nbc203-2015', '1679826255_5.pdf', 'NBC 203:2015 — Low strength masonry', 'code', 'different_structural_system'),
 ('nbc205-2024', 'NBC_205_READY-TO-USE_DETAILING_GUIDELINE_FOR-signed.pdf', 'NBC 205:2024 — Low rise RC without masonry infill', 'code', 'eligibility_and_adoption_review'),
 ('nbc206-2024', 'NBC_206_ARCHITECTURAL_DESIGN_REQUIREMENTS-signed.pdf', 'NBC 206:2024 — Architectural design requirements', 'code', 'adoption_review_required'),
 ('vastu-pathi', 'Vastu/First, 1_*.epub', 'A S Sethu Pathi — 280+ 2BHK plans (2019)', 'vastu', 'illustrative_plan_collection'),
 ('vastu-jain', 'Vastu/Nidhi Jain*.epub', 'Nidhi Jain and Ashish Jain — Vastu Shastra (2017)', 'vastu', 'author_tradition'),
 ('vastu-svoboda', 'Vastu/Robert*.epub', 'Robert E. Svoboda — Vastu: Breathing Life into Space (2013)', 'vastu', 'author_tradition'),
 ('vastu-chakrabarti', 'Vastu/Vibhuti*.pdf', 'Vibhuti Chakrabarti — Indian Architectural Theory and Practice (1998)', 'vastu', 'comparative_theory'),
 ('architecture-kathpalia', 'Vastu/[[]Architectural*.pdf', 'Architectural Design 77(6), 2007 — architecture practice profiles', 'architecture', 'not_vastu_rulebook'),
]

def clean(text):
    text = text.replace('\x00', '').replace('\r', '')
    text = re.sub(r'[ \t]+\n', '\n', text)
    return re.sub(r'\n{3,}', '\n\n', text).strip()

class MarkdownHTML(HTMLParser):
    def __init__(self, href, assets):
        super().__init__(convert_charrefs=True)
        self.parts, self.hidden, self.href, self.assets = [], 0, href, assets
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ('script', 'style'): self.hidden += 1
        if self.hidden: return
        if tag in ('p', 'div', 'section', 'br', 'tr'): self.parts.append('\n')
        if tag in ('td', 'th'): self.parts.append(' | ')
        if re.fullmatch(r'h[1-6]', tag): self.parts.append('\n\n### ')
        if tag == 'li': self.parts.append('\n- ')
        if tag in ('img', 'image'):
            src = a.get('src', a.get('xlink:href', a.get('href', '')))
            import posixpath
            key = posixpath.normpath(posixpath.join(posixpath.dirname(self.href), unquote(src)))
            target = self.assets.get(key)
            self.parts.append(f'\n![{a.get("alt", "Source illustration; inspect visually")}](<{target}>)\n' if target else '\n[Image not extracted: inspect original]\n')
    def handle_endtag(self, tag):
        if tag in ('script', 'style'): self.hidden = max(0, self.hidden-1)
        if tag in ('p', 'div', 'section', 'li') or re.fullmatch(r'h[1-6]',tag): self.parts.append('\n')
    def handle_data(self, data):
        if not self.hidden: self.parts.append(data)

def epub_sections(path, sid):
    with zipfile.ZipFile(path) as z:
        container = ET.fromstring(z.read('META-INF/container.xml'))
        opf = next(e.attrib['full-path'] for e in container.iter() if e.tag.endswith('rootfile'))
        doc = ET.fromstring(z.read(opf))
        import posixpath
        base = posixpath.dirname(opf)
        items = {e.attrib['id']: e.attrib for e in doc.iter() if e.tag.endswith('}item')}
        assets = {}
        for item in items.values():
            if not item.get('media-type', '').startswith('image/'): continue
            member = posixpath.normpath(posixpath.join(base, unquote(item['href'])))
            # Opaque names prevent zip paths escaping our output directory.
            name = hashlib.sha256(member.encode()).hexdigest()[:16] + PurePosixPath(member).suffix
            dest = ROOT / 'assets' / sid / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(z.read(member))
            assets[member] = f'../assets/{sid}/{name}'
        spine = [e.attrib['idref'] for e in doc.iter() if e.tag.endswith('}itemref')]
        for n, ref in enumerate(spine, 1):
            item = items[ref]
            href = posixpath.normpath(posixpath.join(base, unquote(item['href'])))
            parser = MarkdownHTML(href, assets)
            parser.feed(z.read(href).decode('utf-8-sig'))
            text = clean(''.join(parser.parts))
            flags = ['images_require_visual_review'] if '![' in text else []
            if len(re.sub(r'!\[.*?\]\(.*?\)', '', text)) < 100: flags.append('sparse_text')
            yield f'section-{n:04d}', href, text, flags

def pdf_sections(path):
    from pypdf import PdfReader
    doc = PdfReader(path)
    for n, page in enumerate(doc.pages, 1):
        text = clean(page.extract_text() or '')
        flags = []
        if len(text) < 100: flags.append('sparse_text_or_figure_page')
        if '\ufffd' in text: flags.append('replacement_characters')
        if re.search(r'ldlt|sf] |g]kfn|;DalGw|k|sflzt', text):
            # Legacy font detection is heuristic; inspect originals for Nepali text.
            if re.search(r'ldlt|sf] |g]kfn|;DalGw', text): flags.append('possible_legacy_font')
        yield f'page-{n:04d}', f'PDF page {n}', text, flags

def build():
    (ROOT / 'sources').mkdir(parents=True, exist_ok=True)
    dbpath = ROOT / 'library.sqlite'
    cached={}
    if dbpath.exists() and (ROOT/'manifest.json').exists():
        old_manifest=json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))
        with closing(sqlite3.connect(dbpath)) as old:
            for m in old_manifest:
                flags={x['locator']:x['flags'] for x in m['flagged_sections']}
                rows=old.execute('SELECT locator,original_locator,text FROM chunks WHERE source_id=? ORDER BY rowid',(m['id'],)).fetchall()
                cached[m['id']]=(m['sha256'],[(a,b,t,flags.get(a,[])) for a,b,t in rows])
    staged_db=ROOT/'library.next.sqlite'
    db = sqlite3.connect(staged_db)
    db.executescript('DROP TABLE IF EXISTS chunks; CREATE VIRTUAL TABLE chunks USING fts5(source_id UNINDEXED, category UNINDEXED, status UNINDEXED, locator UNINDEXED, original_locator UNINDEXED, markdown UNINDEXED, title, text, tokenize="unicode61");')
    manifest = []
    for sid, pattern, title, category, status in SOURCES:
        matches = list(INPUT.glob(pattern))
        if len(matches) != 1: raise ValueError(f'{sid}: expected one source, got {matches}')
        path = matches[0]
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        sections = cached[sid][1] if sid in cached and cached[sid][0]==digest else list(epub_sections(path, sid) if path.suffix == '.epub' else pdf_sections(path))
        supplement_path=ROOT/'ocr'/f'{sid}.json'
        if supplement_path.exists():
            supplement=json.loads(supplement_path.read_text(encoding='utf-8'))
            if supplement['source_sha256']!=digest: raise ValueError(f'{sid}: stale OCR supplement')
            replaced=[]
            for locator,original,text,flags in sections:
                if locator in supplement['pages']:
                    raw=text.split('\n\n[OCR supplement')[0]
                    extra=supplement['pages'][locator]['text']
                    text=raw+'\n\n[OCR supplement — unverified; equations, Nepali and table ordering require visual review]\n\n'+extra
                    flags=sorted(set(flags+['ocr_unverified']))
                replaced.append((locator,original,text,flags))
            sections=replaced
        rel = path.relative_to(ROOT.parent).as_posix()
        md = f'# {title}\n\nSource ID: `{sid}`\n\nOriginal: [user-supplied file](<../../{rel}>)\n\nSHA-256: `{digest}`\n\nStatus: `{status}`. Text extraction, not an approved rule interpretation. PDF page numbers are physical 1-based pages, not printed page labels. Tables, diagrams, equations and legacy-font text must be checked against originals. Keep user-supplied books and extracted text private.\n'
        flagged = []
        for locator, original, text, flags in sections:
            md += f'\n<a id="{locator}"></a>\n\n## {locator} — {original}\n\n'
            if flags:
                md += 'Extraction flags: ' + ', '.join(flags) + '\n\n'
                flagged.append({'locator':locator,'flags':flags})
            md += (text or '[No extractable text; inspect original visually.]') + '\n'
            db.execute('INSERT INTO chunks VALUES (?,?,?,?,?,?,?,?)', (sid,category,status,locator,original,f'sources/{sid}.md#{locator}',title,text))
        (ROOT / 'sources' / f'{sid}.md').write_text(md, encoding='utf-8')
        manifest.append(dict(id=sid,title=title,category=category,status=status,original=rel,sha256=digest,sections=len(sections),characters=sum(len(s[2]) for s in sections),flagged_sections=flagged))
    db.commit(); db.close()
    staged_db.replace(dbpath)
    (ROOT / 'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    index=['# Converted source index','',f'{len(manifest)} supplied documents; {sum(m["sections"] for m in manifest)} physical PDF pages / EPUB spine sections. These counts are not a claim of complete professional review.','', '| Source | Pages/sections | Flagged | Status |','|---|---:|---:|---|']
    for m in manifest:
        index.append(f'| [{m["title"]}](sources/{m["id"]}.md) | {m["sections"]} | {len(m["flagged_sections"])} | `{m["status"]}` |')
    index += ['', 'Flags identify sparse text, legacy fonts, replacement characters, EPUB images or unverified OCR. Every PDF may also contain tables/diagrams whose semantics need original-page inspection. Follow the source-file link and hash at the beginning of each converted document.', '', 'Detailed flags and provenance: [manifest.json](manifest.json). Current code interpretation notes: [CODE-REVIEW.md](CODE-REVIEW.md).']
    (ROOT/'SOURCE-INDEX.md').write_text('\n'.join(index)+'\n',encoding='utf-8')
    print(json.dumps([{'id':m['id'],'sections':m['sections'],'flagged':len(m['flagged_sections']),'characters':m['characters']} for m in manifest],indent=2))

if __name__ == '__main__': build()
