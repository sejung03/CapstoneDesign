import {localizedText} from '../i18n.mjs';
import {signupConsentPolicy} from '../signup-consent.mjs';

export const legalTitleKey={terms:'Terms of Use',licenses:'Open-source licenses'};

const licenses=[
 ['Next.js','MIT','/licenses/next.txt'],
 ['React','MIT','/licenses/react.txt'],
 ['React DOM','MIT','/licenses/react-dom.txt'],
 ['PDF.js','Apache-2.0','/licenses/pdfjs.txt'],
 ['Neon serverless driver','MIT','/licenses/neon.txt'],
 ['Supabase SSR and JavaScript SDK','MIT',['/licenses/supabase-ssr.txt','/licenses/supabase-js.txt']],
 ['SUIT','SIL OFL 1.1','/fonts/SUIT-LICENSE.txt'],
 ['SUITE','SIL OFL 1.1','/fonts/SUITE-LICENSE.txt'],
];

export function LegalDocumentBody({document,locale,separateTab=false}){
 if(document==='terms')return signupConsentPolicy.sections.find(item=>item.id==='terms').details.map((clause,index)=><p key={index}>{localizedText(clause,locale)}</p>);
 return <ul>{licenses.map(([name,license,links])=><li key={name}>{[links].flat().map((href,index)=><a key={href} href={href} target={separateTab?'_blank':undefined} rel={separateTab?'noopener noreferrer':undefined}>{Array.isArray(links)?(index===0?'Supabase SSR':'Supabase JS'):name} · {license}</a>)}</li>)}</ul>;
}
