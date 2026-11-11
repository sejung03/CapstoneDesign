import test from 'node:test';
import assert from 'node:assert/strict';
import {createReportImport,canUsePreviousReport,reviewedPreviousReport,extractPreviousPdf,pdfTextItems} from '../report-import.mjs';
import {createHealthConsent,healthConsentKey,localHealthNotice,normalizeHealthNotice} from '../health-consent.mjs';
import {assistantContent,assistantContentKey} from '../assistant.mjs';
import {mountApp} from './dom-harness.mjs';
function pdfFile(text='Pre-visit health notes'){
 const stream=`BT /F1 12 Tf 30 700 Td (${text}) Tj ET`;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Count 1 /Kids [3 0 R] >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 let data='%PDF-1.4\n',offsets=[0];objects.forEach((value,index)=>{offsets.push(Buffer.byteLength(data));data+=`${index+1} 0 obj\n${value}\nendobj\n`;});const xref=Buffer.byteLength(data);
 data+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 const bytes=Buffer.from(data);return {name:'notes.pdf',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
}
test('confirmed previous record is kept separate from current symptoms and omitted until explicitly confirmed',()=>{
 const state={profile:{},healthConsent:createHealthConsent(true),assistant:{connected:false,answers:[]},chat:{messages:[],intakeContext:null},reportImport:createReportImport()};
 state.healthConsent.acceptedKey=healthConsentKey(state);assert.equal(assistantContent(state).previousReport,undefined);
 const before=assistantContentKey(state);state.reportImport.confirmed=reviewedPreviousReport({text:'예전 증상',recordDate:'2025-02-03'});
 assert.equal(assistantContent(state).previousReport.temporalScope,'past');assert.equal(assistantContent(state).previousReport.needsCurrentStatusConfirmation,true);assert.equal(assistantContent(state).intake,null);assert.notEqual(assistantContentKey(state),before);
 state.assistant.connected=true;state.healthConsent.notice=normalizeHealthNotice({...localHealthNotice,version:'external'});state.healthConsent.acceptedKey=healthConsentKey(state);assert.equal(canUsePreviousReport(state),false);assert.equal(assistantContent(state).previousReport,undefined);
 state.healthConsent.notice.allowReportImport=true;state.healthConsent.acceptedKey=healthConsentKey(state);assert.ok(assistantContent(state).previousReport);
 for(const value of [{text:''},{text:'x'.repeat(20001)},{text:'x',recordDate:'2025-02-30'}])assert.throws(()=>reviewedPreviousReport(value));
});
test('PDF extraction reads an actual text PDF locally with a self-hosted worker',async()=>{
 const text=await extractPreviousPdf(pdfFile(),{loadPdf:()=>import('pdfjs-dist/legacy/build/pdf.mjs'),workerSrc:import.meta.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')});
 assert.match(text,/Pre-visit health notes/);
 assert.equal(pdfTextItems([{str:'A',transform:[1,0,0,1,0,30]},{str:'B',transform:[1,0,0,1,0,10]}]),'A \nB');
 await assert.rejects(extractPreviousPdf(pdfFile('Unrelated document'),{loadPdf:()=>import('pdfjs-dist/legacy/build/pdf.mjs'),workerSrc:import.meta.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')}),/importUnsupported/);
});
test('file size, extension and PDF signature are checked before invoking the parser',async()=>{
 const loadPdf=()=>{throw Error('parser must not run');};
 await assert.rejects(extractPreviousPdf({...pdfFile(),name:'x.txt'},{loadPdf}),/importType/);
 await assert.rejects(extractPreviousPdf({...pdfFile(),size:6*1024*1024},{loadPdf}),/importSize/);
 await assert.rejects(extractPreviousPdf({name:'x.pdf',size:3,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer},{loadPdf}),/importInvalid/);
 const c=new AbortController();c.abort();await assert.rejects(extractPreviousPdf(pdfFile(),{loadPdf,signal:c.signal}),/importCancelled/);
});
test('PDF page and text limits, scanned PDFs and parser cleanup are enforced',async()=>{
 for(const [numPages,items,error] of [[21,[],'importPages'],[1,[],'importScanned'],[1,[{str:'x'.repeat(20001)}],'importTooLong']]){
  let destroyed=0;const loadPdf=async()=>({GlobalWorkerOptions:{},getDocument(options){assert.equal(options.isEvalSupported,false);return {destroy:async()=>{destroyed++;},promise:Promise.resolve({numPages,getPage:async()=>({getTextContent:async()=>({items}),cleanup(){}})})};}});
  await assert.rejects(extractPreviousPdf(pdfFile(),{loadPdf}),new RegExp(error));assert.ok(destroyed>0);
 }
});
test('removing a previous report changes assistant context without overwriting the current draft',()=>{
 const ui=mountApp({source:null});ui.run("state.draft.symptom='현재 증상';changePreviousReport({confirm:{text:'과거 기록',source:'text'}})");
 assert.equal(ui.run('state.draft.symptom'),'현재 증상');assert.equal(ui.run('state.reportImport.confirmed.text'),'과거 기록');
 ui.run('changePreviousReport({remove:true})');assert.equal(ui.run('state.reportImport.confirmed'),null);assert.equal(ui.run('state.draft.symptom'),'현재 증상');assert.equal(ui.storage.size,0);
});
