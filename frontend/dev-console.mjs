// Imported only by Next development builds. No OAuth, tokens or server writes.
export function installDevConsole(host,app,{enabled=false}={}){
 if(!enabled)return ()=>{};
 if(Object.hasOwn(host,'medicalDev'))throw new Error('medicalDev is already installed');
 const accounts=new Map();
 const api=Object.freeze({
  async login(name='demo'){
   if(typeof name!=='string'||!/^[a-zA-Z0-9_-]{1,32}$/.test(name))throw new TypeError('Use a short development account name');
   const id='dev-'+name;if(!accounts.has(id))accounts.set(id,new Map());const favorites=accounts.get(id);let authenticated=true;
   await app.setAccountAdapter({
    getSession:async()=>({authenticated,accountId:id}),
    logout:async()=>{authenticated=false;},
    favorites:{list:async()=>[...favorites.values()],set:async({facility,favorite})=>{if(favorite)favorites.set(facility.id,structuredClone(facility));else favorites.delete(facility.id);}}
   });
   return '개발용 로그인 완료: 내 정보에서 로그아웃 버튼을 확인하세요. 실제 카카오 인증이나 DB 저장은 하지 않습니다.';
  }
 });
 Object.defineProperty(host,'medicalDev',{value:api,configurable:true});
 return ()=>{if(host.medicalDev===api)delete host.medicalDev;};
}
