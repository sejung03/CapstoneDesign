// Run once with the local Windows Korean voice service listening on port 3091.
import {mkdir,writeFile} from 'node:fs/promises';
const output = new URL('../public/voice/', import.meta.url);
const response = await fetch('http://127.0.0.1:3091/tts',{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({text:'어디가 아프신가요?'}),
});
if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/wav')) {
  throw new Error('Start the local Windows Korean voice service first.');
}
const wav=Buffer.from(await response.arrayBuffer());
if(wav.toString('ascii',0,4)!=='RIFF')throw new Error('Expected WAV audio');
await mkdir(output,{recursive:true});
await writeFile(new URL('first-question-ko.wav',output),wav);
console.log('Created public/voice/first-question-ko.wav');
