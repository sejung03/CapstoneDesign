export const FAVORITES_LIMIT=20;
export function createFavorites(){return {items:[],phase:'ready',pendingId:'',error:'',scope:'guest'};}
export function favoriteRecord(item){
 if(!item||typeof item.id!=='string'||!/^[\w:.-]{1,128}$/.test(item.id)||!['hospital','pharmacy'].includes(item.type)||typeof item.name?.ko!=='string'||!item.name.ko.trim()||item.name.ko.length>300)throw new TypeError('Invalid favorite');
 const name={ko:item.name.ko,en:typeof item.name.en==='string'?item.name.en.slice(0,300):item.name.ko};
 return {id:item.id,type:item.type,name,address:typeof item.address==='string'?item.address.slice(0,500):typeof item.roadAddress==='string'?item.roadAddress.slice(0,500):typeof item.area?.ko==='string'?item.area.ko.slice(0,500):''};
}
export function normalizeFavorites(raw){
 if(!Array.isArray(raw)||raw.length>FAVORITES_LIMIT)throw new TypeError('Invalid favorites');const items=raw.map(favoriteRecord);
 if(new Set(items.map(item=>item.id)).size!==items.length)throw new TypeError('Duplicate favorites');return items;
}
export function favoriteFirst(items,favorites=[]){const ids=new Set(favorites.map(item=>item.id));return [...items.filter(item=>ids.has(item.id)),...items.filter(item=>!ids.has(item.id))];}
