import {phrase} from '../i18n.mjs';
import {pdfOfferKey} from '../pdf-offer.mjs';
import {Icon} from './shared.jsx';

// 문진이 끝나면 대화에 "문진 내용과 건강정보 정리본을 PDF로 받을까요?"를 묻는다. 인쇄는 app.js(printCareSheet)가 한다.
export function PdfOffer({state}){
 const key=pdfOfferKey(state);if(!key)return null;
 const locale=state.locale,print=<><Icon name="print" />{phrase(locale,"Get PDF")}</>;
 if(state.pdfOfferDismissed===key)return <div className="pdf-offer is-dismissed"><button id="care-pdf-print" type="button" className="text-button">{print}</button></div>;
 return <div className="chat-message bot-message pdf-offer" role="group" aria-labelledby="pdf-offer-title">
  <p id="pdf-offer-title"><strong>{phrase(locale,"Would you like a PDF of your questionnaire answers and health information?")}</strong></p>
  <p className="pdf-offer-note">{phrase(locale,"You can print it or save it as a PDF to show at the clinic. It is made on this device and is not sent anywhere.")}</p>
  <div className="assistant-actions"><button id="care-pdf-print" type="button" className="primary-button">{print}</button><button id="care-pdf-dismiss" type="button" className="text-button">{phrase(locale,"No thanks")}</button></div>
 </div>;
}
