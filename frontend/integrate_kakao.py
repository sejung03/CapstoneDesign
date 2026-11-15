"""Apply the Kakao login UI integration to frontend v0.24.2.
Run from the frontend directory after backing up your project.
"""
from pathlib import Path

root = Path(__file__).resolve().parent

def replace_once(rel, old, new):
    path = root / rel
    content = path.read_text(encoding='utf-8')
    if new in content:
        print(f'Already integrated: {rel}')
        return
    n = content.count(old)
    if n != 1:
        raise RuntimeError(f'Expected one matching location in {rel}, found {n}. The repository version may have changed; no update applied to this file.')
    backup = path.with_suffix(path.suffix + '.before-kakao.bak')
    if not backup.exists():
        backup.write_text(content, encoding='utf-8')
    path.write_text(content.replace(old, new, 1),encoding='utf-8')
    print(f'Updated: {rel} (backup: {backup.name})')

old_profile = "{accountOpen&&!signedIn&&<AccountDialog locale={state.locale} onDismiss={()=>setAccountOpen(false)} />}"
new_profile = "{accountOpen&&!signedIn&&<AccountDialog locale={state.locale} needsSignupConsent={false} onContinue={()=>window.location.assign('/api/auth/kakao')} onDismiss={()=>setAccountOpen(false)} />}"
replace_once('components/profile.jsx', old_profile, new_profile)

replace_once('app/medical-app.jsx',
             'let cancelled=false,dispose,disposeDev,revision=0;',
             'let cancelled=false,dispose,disposeDev,disposeAccount,revision=0;')
replace_once('app/medical-app.jsx',
             "   }\n  }).catch(()=>{if(!cancelled)setFailed(true);});",
             """   }
   if(!cancelled){
    const {connectAccount}=await import('../care-client.mjs');
    const disconnect=await connectAccount({
     getSession:async({signal})=>{
      const result=await fetch('/api/auth/session',{credentials:'same-origin',signal,cache:'no-store'});
      if(!result.ok)throw Error('session_request_failed');
      return result.json();
     },
     logout:async({signal})=>{
      const result=await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin',signal});
      if(!result.ok)throw Error('logout_failed');
     }
    });
    if(cancelled)disconnect();else disposeAccount=disconnect;
   }
  }).catch(()=>{if(!cancelled)setFailed(true);});""")
replace_once('app/medical-app.jsx',
             'return ()=>{cancelled=true;disposeDev?.();dispose?.();};',
             'return ()=>{cancelled=true;disposeDev?.();disposeAccount?.();dispose?.();};')

ignore = root / '.gitignore'
s = ignore.read_text(encoding='utf-8') if ignore.exists() else ''
if '.local-data/' not in s:
    ignore.write_text(s.rstrip() + '\n.local-data/\n',encoding='utf-8')
    print('Added .local-data/ to .gitignore')
print('Integration complete. Review changes using git diff, then run npm run dev.')
