export function createConversation(){return {messages:[],input:'',open:false};}
export function appendChat(conversation,value,{maxTotal=2000}={}){
 const text=String(value).trim();
 if(!text)return {ok:false,reason:'empty'};
 const total=conversation.messages.reduce((n,message)=>n+message.text.length,0)+conversation.messages.length;
 if(total+text.length>maxTotal)return {ok:false,reason:'limit'};
 return {ok:true,conversation:{...conversation,input:'',messages:[...conversation.messages,{role:'user',text}]}};
}
export function chatNotes(conversation){return conversation.messages.map(message=>message.text).join('\n');}
export function setChatOpen(conversation,open){return {...conversation,open};}
