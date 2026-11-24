// Server/tool use only. Import this module only from routes and development scripts.
// OpenAI Responses API with a strict JSON schema. store:false so OpenAI does not keep the response.
export async function generateOpenAiJson({apiKey,model='gpt-6-luna',instructions,input,schema,schemaName='result',reasoningEffort='low',fetchImpl=fetch,signal,maxOutputTokens=4096}){
 if(!apiKey)throw Object.assign(new Error('openai_not_configured'),{status:503});
 if(!/^[a-zA-Z0-9._-]+$/.test(model))throw new Error('invalid_openai_model');
 const response=await fetchImpl('https://api.openai.com/v1/responses',{
  method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+apiKey},signal:signal||AbortSignal.timeout(120000),
  body:JSON.stringify({model,instructions,input,reasoning:{effort:reasoningEffort},max_output_tokens:maxOutputTokens,store:false,
   text:{format:{type:'json_schema',name:schemaName,schema,strict:true}}}),
 });
 if(!response.ok)throw Object.assign(new Error(response.status===429?'openai_rate_limited':'openai_request_failed'),{status:response.status===429?429:502});
 const body=await response.json();
 if(body.status&&body.status!=='completed')throw new Error('openai_incomplete_response');
 const text=typeof body.output_text==='string'?body.output_text:(body.output||[]).flatMap(item=>item.content||[]).filter(part=>part.type==='output_text').map(part=>part.text).join('');
 if(!text)throw new Error('openai_incomplete_response');
 try{return JSON.parse(text);}catch{throw new Error('openai_invalid_response');}
}
