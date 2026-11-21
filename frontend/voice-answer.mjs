import {intakeLabel} from './intake-data.mjs';

const submittedTranscripts = new WeakMap();
const leadingAnswer = /^(?:네|예|응|넵|네에|예에)(?=\s|$)|^(?:아니요|아니오|아니|아뇨)(?=\s|$)/u;
const negativeAnswer = /^(?:아니요|아니오|아니|아뇨)$/u;
const sinoDigits = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
const nativePositions = ['', '첫', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열'];
const ordinalAliases = new Map([['한', 1]]);
for (let index = 1; index < nativePositions.length; index++) ordinalAliases.set(nativePositions[index], index);
for (let index = 1; index < 100; index++) ordinalAliases.set(sinoNumber(index), index);

function sinoNumber(index) {
  const tens = Math.floor(index / 10);
  return (tens ? (tens === 1 ? '십' : sinoDigits[tens] + '십') : '') + sinoDigits[index % 10];
}

const choicePrefixes={en:'Option ',zh:'选项 ',vi:'Phương án ',uz:'Variant '};
export function spokenChoiceNumber(index,locale='ko') {
  if(locale!=='ko')return (choicePrefixes[locale]||choicePrefixes.en)+index;
  return (Number.isInteger(index) && index > 0 && index < 100 ? sinoNumber(index) : String(index)) + ' 번';
}


function normalizedAnswer(text) {
  const cleaned = text.normalize('NFKC').replace(/[\p{P}\p{Z}\s]+/gu, ' ').trim();
  const prefix = cleaned.match(leadingAnswer)?.[0];
  const reply = prefix ? cleaned.slice(prefix.length).trim() : cleaned;
  const polarity = prefix ? (negativeAnswer.test(prefix) ? 'no' : 'yes') : '';
  const meaning = reply.replace(/\s/gu, '')
    .replace(/괜찮(?:습니다|아요|아)$/u, '괜찮아')
    .replace(/모르겠(?:습니다|어요|어)$/u, '모르겠어')
    .replace(/있(?:습니다|어요|어)$/u, '있어')
    .replace(/없(?:습니다|어요|어)$/u, '없어')
    .replace(/아니(?:에요|예요|야)$/u, '아니야');
  return {polarity, meaning: /^(?:(?:잘)?모르겠어|모름)$/u.test(meaning) ? '모르겠어' : meaning, whole:cleaned.replace(/\s/gu, '')};
}

const voiceReplies={
  en:{yes:['yes','yeah','yep'],no:['no','nope'],unsure:['not sure',"i'm not sure","i don’t know","i don't know","i do not know","unsure"],
    numbers:['one','two','three','four','five','six','seven','eight','nine','ten'],prefixes:['option','choice','number']},
  zh:{yes:['是','是的','对','有'],no:['不是','没有','否','不'],unsure:['不确定','不知道','不清楚'],
    numbers:['一','二','三','四','五','六','七','八','九','十'],prefixes:['选项','第']},
  vi:{yes:['có','vâng','dạ có'],no:['không','dạ không'],unsure:['không chắc','tôi không chắc','không biết','tôi không biết'],
    numbers:['một','hai','ba','bốn','năm','sáu','bảy','tám','chín','mười'],prefixes:['phương án','lựa chọn','số']},
  uz:{yes:['ha'],no:['yoʻq','yo‘q','yo’q',"yo'q"],unsure:['bilmayman','aniq bilmayman','ishonchim komil emas'],
    numbers:['bir','ikki','uch','toʻrt','besh','olti','yetti','sakkiz','toʻqqiz','oʻn'],prefixes:['variant']},
};
const normalizedForeign=text=>text.normalize('NFKC').toLowerCase()
  .replace(/[‘’ʻʼ]/gu,"'").replace(/[^\p{L}\p{M}\p{N}'\s]+/gu,' ').replace(/\s+/gu,' ').trim();
// A bare number means position only if the choices are not numeric values.
function optionAtBareNumber(index,options,locale){
  if(!index||options.some(option=>/^\d/.test(intakeLabel(option.label,locale).normalize('NFKC').trim())))return null;
  return options[index-1]??null;
}
function foreignOption(text,options,locale) {
  const rules=voiceReplies[locale], answer=normalizedForeign(text);
  if(!rules||!answer)return null;
  const isBoundary=(label,word)=>label===word||label.startsWith(word+' ')||(locale==='zh'&&label.startsWith(word));
  const aliases=kind=>rules[kind].map(normalizedForeign);
  const kind=['yes','no','unsure'].find(key=>aliases(key).includes(answer));
  if(kind){
    // Prefer the canonical Korean label when a translated label is missing.
    const candidates=options.filter(option=>{
      const ko=normalizedAnswer(intakeLabel(option.label,'ko')||'');
      if(ko.meaning==='모르겠어')return kind==='unsure';
      if(ko.polarity)return ko.polarity===kind;
      const label=normalizedForeign(intakeLabel(option.label,locale));
      // Check longer negatives/unknown phrases before short affirmative terms.
      return ['unsure','no','yes'].find(key=>aliases(key).some(word=>key==='unsure'?label===word:isBoundary(label,word)))===kind;
    });
    return candidates.length===1?candidates[0]:null;
  }
  const matches=options.filter(option=>normalizedForeign(intakeLabel(option.label,locale))===answer);
  if(matches.length)return matches.length===1?matches[0]:null;
  const bare=text.normalize('NFKC').trim().match(/^([1-9]\d*)[.!?。！？]?$/u);
  if(bare)return optionAtBareNumber(Number(bare[1]),options,locale);
  for(const prefix of rules.prefixes){
    const marker=prefix+(locale==='zh'?'':' ');
    if(!answer.startsWith(marker))continue;
    const rawNumber=answer.slice(marker.length).trim();
    const number=locale==='zh'?rawNumber.replace(/[个號号]$/u,''):rawNumber;
    const index=/^[1-9]\d*$/u.test(number)?Number(number):rules.numbers.map(normalizedForeign).indexOf(number)+1;
    if(index>0)return options[index-1]??null;
  }
  return null;
}

export function matchSpokenOption(text, options, locale='ko') {
  if(/\d[.,]\d/u.test(text.normalize('NFKC')))return null;
  if(locale!=='ko')return foreignOption(text,options,locale);
  const answer = normalizedAnswer(text);
  if (!answer.polarity && !answer.meaning) return null;

  const labeled = options.map(option => ({option, label: normalizedAnswer(intakeLabel(option.label, 'ko') || '')}));
  if (!answer.meaning && answer.polarity) {
    const candidates = labeled.filter(({label}) => label.polarity === answer.polarity);
    return candidates.length === 1 ? candidates[0].option : null;
  }
  const matches = labeled.filter(({label}) => {
    return answer.meaning === label.meaning &&
      (answer.polarity === label.polarity || (
        answer.meaning && (!answer.polarity || !label.polarity)
      ));
  });

  if (matches.length) return matches.length === 1 ? matches[0].option : null;

  if (answer.polarity === 'no') return null;
  const bare=text.normalize('NFKC').trim().match(/^([1-9]\d*|일|이|삼|사|오|육|칠|팔|구|십)[.!?。！？]?$/u)?.[1];
  if(bare)return optionAtBareNumber(/^\d/.test(bare)?Number(bare):ordinalAliases.get(bare),options,locale);
  const position = /^(?:선택지)?([1-9]\d*|[가-힣]+?)번(?:째)?(?:이요|요|입니다)?$/u;
  const ordinal = (answer.whole.match(position) ?? answer.meaning.match(position))?.[1];
  const index = /^\d+$/.test(ordinal ?? '') ? Number(ordinal) : ordinalAliases.get(ordinal) ?? 0;
  return index > 0 ? options[index - 1] ?? null : null;
}

export function rememberSpokenAnswer(input, text, question, locale='ko') {
  submittedTranscripts.set(input, {text, question, locale});
}

export function consumeSpokenAnswer(input, text, question, typedLocale) {
  if (!input) return null;
  const transcript = submittedTranscripts.get(input);
  submittedTranscripts.delete(input);
  if(!question)return null;
  if(transcript?.text===text){
    return transcript.question===question?matchSpokenOption(text,question.options,transcript.locale):null;
  }
  return typedLocale?matchSpokenOption(text,question.options,typedLocale):null;
}
