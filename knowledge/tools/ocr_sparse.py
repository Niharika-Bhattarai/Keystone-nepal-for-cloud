"""Local OCR supplements for sparse PDF pages; preserved as unverified OCR.

Install optional dependencies outside production, then use --dependencies PATH.
English OCR does not reliably transcribe Nepali. Original page remains authoritative.
"""
from pathlib import Path
import argparse,json,sys,hashlib

ROOT=Path(__file__).resolve().parents[1]

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source');parser.add_argument('--dependencies',type=Path,required=True)
    args=parser.parse_args()
    sys.path.insert(0,str(args.dependencies.resolve()))
    import pymupdf
    from rapidocr import RapidOCR
    manifest=json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))
    source=next(m for m in manifest if m['id']==args.source)
    original=ROOT.parent/source['original']
    if hashlib.sha256(original.read_bytes()).hexdigest()!=source['sha256']: raise ValueError('Stale extraction')
    doc=pymupdf.open(original)
    engine=RapidOCR()
    destination=ROOT/'ocr'/f'{args.source}.json'
    destination.parent.mkdir(exist_ok=True)
    data={'source_sha256':source['sha256'],'method':'RapidOCR; unverified English-oriented OCR; Nepali and equations require visual review','pages':{}}
    if destination.exists():
        old=json.loads(destination.read_text(encoding='utf-8'))
        if old['source_sha256']==source['sha256']: data=old
    for item in source['flagged_sections']:
        if not any(f.startswith('sparse_text') for f in item['flags']):continue
        loc=item['locator']
        if loc in data['pages']:continue
        n=int(loc.split('-')[1])-1
        pix=doc[n].get_pixmap(matrix=pymupdf.Matrix(2,2))
        out=engine(pix.tobytes('png'))
        lines=list(out.txts) if out.txts is not None else []
        data['pages'][loc]={'text':'\n'.join(lines),'mean_confidence':float(sum(out.scores)/len(out.scores)) if lines else None}
        destination.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
        print(f'{loc}: {len(lines)} OCR lines',flush=True)

if __name__=='__main__':main()
