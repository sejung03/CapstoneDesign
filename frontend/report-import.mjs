import {hasHealthConsent} from './health-consent.mjs';
import {locales,phrase} from './i18n.mjs';
export const reportImportLimits={bytes:5*1024*1024,pages:20,characters:20000};
export function createReportImport(){return {open:false,confirmed:null};}
export function canUsePreviousReport(state){return hasHealthConsent(state)&&(!(state.assistant?.connected||state.rankingConnected)||state.healthConsent?.notice?.allowReportImport===true);}
export function reviewedPreviousReport({text,recordDate='',source='text'}){
 const value=String(text||'').trim();
 if(!value)throw Error('importEmpty');
 if(value.length>reportImportLimits.characters)throw Error('importTooLong');
 if(!['text','pdf'].includes(source))throw Error('importInvalid');
 if(recordDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(recordDate)||!Number.isFinite(Date.parse(recordDate))||new Date(recordDate).toISOString().slice(0,10)!==recordDate))throw Error('importDate');
 return {text:value,recordDate:recordDate||null,source,temporalScope:'past',verification:'userReviewed',needsCurrentStatusConfirmation:true,untrustedDocument:true,reviewedAt:new Date().toISOString()};
}
export function pdfTextItems(items){
 let text='',lastY=null;
 for(const item of items){
  if(typeof item.str!=='string')continue;
  const y=item.transform?.[5];
  if(lastY!==null&&Number.isFinite(y)&&Math.abs(y-lastY)>3&&!text.endsWith('\n'))text+='\n';
  text+=item.str+(item.hasEOL?'\n':' ');if(Number.isFinite(y))lastY=y;
 }
 return text.trim();
}
export async function extractPreviousPdf(file,{signal,loadPdf=()=>import('pdfjs-dist/build/pdf.mjs'),workerSrc='/pdfjs/pdf.worker.min.mjs',timeoutMs=15000}={}){
 if(!file||!String(file.name||'').toLowerCase().endsWith('.pdf'))throw Error('importType');
 if(!Number.isFinite(file.size)||file.size>reportImportLimits.bytes)throw Error('importSize');
 if(signal?.aborted)throw Error('importCancelled');
 const bytes=new Uint8Array(await file.arrayBuffer());
 if(signal?.aborted)throw Error('importCancelled');
 if(String.fromCharCode(...bytes.slice(0,5))!=='%PDF-')throw Error('importInvalid');
 let task,timer,abort,wasPassword=false;
 try{
  const pdfjs=await loadPdf();if(signal?.aborted)throw Error('importCancelled');
  pdfjs.GlobalWorkerOptions.workerSrc=workerSrc;
  task=pdfjs.getDocument({data:bytes,cMapUrl:'/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/pdfjs/standard_fonts/',wasmUrl:'/pdfjs/wasm/',isEvalSupported:false,enableXfa:false,disableAutoFetch:true});
  const stopped=new Promise((_,reject)=>{abort=()=>{void task.destroy();reject(Error('importCancelled'));};signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>{void task.destroy();reject(Error('importTimeout'));},timeoutMs);});
  task.onPassword=()=>{wasPassword=true;void task.destroy();};
  const read=async()=>{
   const doc=await task.promise;if(doc.numPages>reportImportLimits.pages)throw Error('importPages');
   const pages=[];let length=0;
   for(let i=1;i<=doc.numPages;i++){
    if(signal?.aborted)throw Error('importCancelled');
    const page=await doc.getPage(i),content=await page.getTextContent();
    const text=pdfTextItems(content.items);length+=text.length;
    if(length>reportImportLimits.characters)throw Error('importTooLong');
    pages.push(text);page.cleanup();
   }
   const text=pages.join('\n\n').trim();if(!text)throw Error('importScanned');
   const compact=text.replace(/\s/g,'');
   const supportedTitles=locales.map(locale=>phrase(locale,'Pre-visit health notes').replace(/\s/g,'').toLowerCase());
   if(!supportedTitles.some(title=>compact.toLowerCase().includes(title)))throw Error('importUnsupported');
   return text;
  };
  return await Promise.race([read(),stopped]);
 }catch(error){if(signal?.aborted)throw Error('importCancelled');if(wasPassword||error.name==='PasswordException')throw Error('importPassword');if(String(error.message).startsWith('import'))throw error;throw Error('importInvalid');}
 finally{clearTimeout(timer);if(abort)signal?.removeEventListener('abort',abort);await task?.destroy();}
}
