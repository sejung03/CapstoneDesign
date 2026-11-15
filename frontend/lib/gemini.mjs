// Server/tool use only. Import this module only from routes and development scripts.
export async function generateGeminiJson({apiKey,model='gemini-3.1-flash-lite',prompt,schema,fetchImpl=fetch,signal,maxOutputTokens=4096}){
 if(!apiKey)throw Object.assign(new Error('gemini_not_configured'),{status:503});
 if(!/^[a-zA-Z0-9.-]+$/.test(model))throw new Error('invalid_gemini_model');
 const response=await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{
  method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},signal:signal||AbortSignal.timeout(45000),
  body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{temperature:0.2,maxOutputTokens,responseMimeType:'application/json',...(schema?{responseJsonSchema:schema}:{})}}),
 });
 if(!response.ok)throw Object.assign(new Error(response.status===429?'gemini_rate_limited':'gemini_request_failed'),{status:response.status===429?429:502});
 const body=await response.json(),text=body.candidates?.[0]?.content?.parts?.filter(part=>!part.thought).map(part=>part.text||'').join('');
 if(!text||body.candidates?.[0]?.finishReason==='MAX_TOKENS')throw new Error('gemini_incomplete_response');
 try{return JSON.parse(text);}catch{throw new Error('gemini_invalid_response');}
}
