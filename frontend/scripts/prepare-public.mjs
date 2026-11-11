import {mkdir,copyFile,cp} from 'node:fs/promises';
const root=new URL('../',import.meta.url),out=new URL('public/',root);
await mkdir(out,{recursive:true});
// Explicit asset list: never copy source files, .env, tests or server modules.
for(const name of ['favicon.svg','clinic-demo.png'])await copyFile(new URL(name,root),new URL(name,out));
await cp(new URL('fonts/',root),new URL('fonts/',out),{recursive:true});

// Self-host PDF text extraction worker and resources; never use a third-party CDN.
await mkdir(new URL('pdfjs/',out),{recursive:true});
await copyFile(new URL('node_modules/pdfjs-dist/build/pdf.worker.min.mjs',root),new URL('pdfjs/pdf.worker.min.mjs',out));
for(const name of ['cmaps','standard_fonts','wasm'])await cp(new URL('node_modules/pdfjs-dist/'+name+'/',root),new URL('pdfjs/'+name+'/',out),{recursive:true});
