import {publicDataConfigured} from '../public-data-server.mjs';
import {routingConfigured} from '../routing-server.mjs';
// Only the Maps JavaScript key is public. REST/public-data keys stay on the server.
export function publicConfig(env=process.env){
 const key=String(env.KAKAO_JAVASCRIPT_KEY||'').trim();
 return {map:{provider:'kakao',configured:!!key,javascriptKey:key},publicData:{configured:publicDataConfigured(env)},routing:{configured:routingConfigured(env)}};
}
