"""One-time independent source snapshot; no links, secrets, history or deployment config."""
from pathlib import Path
import subprocess,json,hashlib,shutil

LOCAL=Path(__file__).resolve().parents[1]
SOURCE=LOCAL.parents[1]
def git(repo,*args):
    return subprocess.check_output(['git','-C',str(repo),*args]).decode('utf-8').strip()

def main():
    if (LOCAL/'COPY-MANIFEST.json').exists():raise SystemExit('Snapshot already exists; refusing to overwrite local development.')
    manifest={'source_root':str(SOURCE),'files':[],'excluded':[],'repositories':{}}
    for name in ['backend-keystone','frontend-keystone']:
        repo=SOURCE/name
        manifest['repositories'][name]={'head':git(repo,'rev-parse','HEAD'),'status':git(repo,'status','--porcelain')}
        files=subprocess.check_output(['git','-C',str(repo),'ls-files','-z']).decode('utf-8').split('\0')
        for rel in filter(None,files):
            p=Path(rel);lower=rel.lower()
            reason=None
            if p.parts[0] in ('deploy','.github','vercel-proxy'):reason='deployment-only'
            elif p.name in ('Dockerfile','deploy.cmd','vercel.json','.gcloudignore','.dockerignore'):reason='deployment-only'
            elif p.name.startswith('.env') or p.suffix in ('.pem','.key','.p12','.pfx') or 'service-account' in lower or 'deploy key' in lower:reason='environment-or-credential-file'
            elif any(x in p.parts for x in ('node_modules','dist','tmp','__pycache__')):reason='generated-or-dependency'
            if reason:
                manifest['excluded'].append({'path':name+'/'+rel,'reason':reason});continue
            src=repo/p
            if src.is_symlink():raise ValueError(f'Refusing linked source: {src}')
            if not src.is_file():continue
            dest=LOCAL/name/p;dest.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(src,dest)
            manifest['files'].append({'path':name+'/'+rel,'sha256':hashlib.sha256(src.read_bytes()).hexdigest(),'bytes':src.stat().st_size})
    # Frontend package scripts reference these sibling development utilities.
    for src in sorted((SOURCE/'scripts').glob('*')):
        if src.is_file() and src.suffix in ('.js','.cjs','.mjs','.py'):
            dest=LOCAL/'scripts'/src.name;dest.parent.mkdir(exist_ok=True);shutil.copy2(src,dest)
            manifest['files'].append({'path':'scripts/'+src.name,'sha256':hashlib.sha256(src.read_bytes()).hexdigest(),'bytes':src.stat().st_size})
    (LOCAL/'COPY-MANIFEST.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    print(f'Copied {len(manifest["files"])} files; excluded {len(manifest["excluded"])} deployment/environment/generated files')

if __name__=='__main__':main()
