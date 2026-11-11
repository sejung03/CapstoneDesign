import {normalizeEmergencyGuides} from './emergency.mjs';
import {normalizeHealthNotice} from './health-consent.mjs';
import {normalizeIntakeQuestionnaire} from './intake-data.mjs';
let connection=0;
/** Browser-only integration boundary. The backend team supplies its HTTP client.
 * requestAssistant(payload,{signal}) -> Promise<{summary?,followUpQuestionId?,followUp?,search?,emergency?,profileUpdates?}>
 * rankFacilities(payload,{signal}) -> Promise<{resultSetId,items:[{facilityId,reason}]}>
 * No endpoint, credentials or medical rules are embedded in the frontend.
 */
export async function connectCare({requestAssistant=null,rankFacilities=null,healthNotice=null,questionnaire=null,followUpQuestionnaire=null,emergencyGuides=null}={}){
 if(requestAssistant!==null&&typeof requestAssistant!=='function')throw new TypeError('requestAssistant must be a function');
 if(rankFacilities!==null&&typeof rankFacilities!=='function')throw new TypeError('rankFacilities must be a function');
 const guides=emergencyGuides===null?null:normalizeEmergencyGuides(emergencyGuides);
 const notice=healthNotice===null?null:normalizeHealthNotice(healthNotice);
 const intake=questionnaire?normalizeIntakeQuestionnaire(questionnaire):null;
 const followup=followUpQuestionnaire?normalizeIntakeQuestionnaire(followUpQuestionnaire):null;
 if(typeof window==='undefined')throw new Error('connectCare must be called in the browser');
 const token=++connection,app=await import('./app.js');
 if(token!==connection)return ()=>{};
 if(intake)app.setIntakeQuestionnaire(intake);
 app.setEmergencyGuides(guides);
 app.setHealthNotice(notice);
 app.setAssistantAdapter(requestAssistant,{questionnaire:followup});
 app.setRecommendationAdapter(rankFacilities);
 return ()=>{if(token===connection){connection++;app.setAssistantAdapter(null);app.setRecommendationAdapter(null);app.setEmergencyNotice(null);app.setEmergencyGuides(null);app.setHealthNotice(null);}};
}

// The account owner supplies authenticated list/set requests and a new scope per account.
export async function connectFavorites(adapter=null,options={}){const app=await import('./app.js');return app.setFavoritesAdapter(adapter,options);}

// Call from the authenticated app bootstrap on every page load. The server owns cookies and identity.
export async function connectAccount(adapter){const app=await import('./app.js');await app.setAccountAdapter(adapter);return ()=>{void app.setAccountAdapter(null);};}
