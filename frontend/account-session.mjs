// Authentication is server-verified. No tokens or health information are stored here.
export function createAccountSession(){return {phase:'guest',accountId:null,error:''};}
export function normalizeAccountSession(value){
 if(!value||typeof value.authenticated!=='boolean')throw new TypeError('Invalid account session');
 if(!value.authenticated)return createAccountSession();
 if(typeof value.accountId!=='string'||!value.accountId||value.accountId.length>120||/[\u0000-\u001f]/.test(value.accountId))throw new TypeError('Invalid account ID');
 return {phase:'authenticated',accountId:value.accountId,error:''};
}
