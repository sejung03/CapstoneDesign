// 문진 후 "정리본을 PDF로 받을까요?" 카드의 표시 조건. 화면(components/pdf-offer.jsx)과 app.js가 같이 쓴다.
import {assistantContentKey} from './assistant.mjs';

/**
 * 문진이 끝나 요약이 나왔을 때(더 물을 질문이 없고 응급 안내가 아닐 때) 이 응답의 contentKey, 아니면 ''.
 * 카드는 응답마다 한 번 묻고, "괜찮아요"를 고르면 작은 "PDF 받기" 버튼으로 줄어든다.
 */
export function pdfOfferKey(state){
 const a=state.assistant,r=a?.response;
 if(!a?.connected||a.status!=='ready'||!r?.summary||r.followUp||r.emergency?.active)return '';
 return r.contentKey===assistantContentKey(state)?r.contentKey:'';
}
