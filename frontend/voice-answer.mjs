import {intakeLabel} from './intake-data.mjs';

const submittedTranscripts = new WeakMap();
const leadingAnswer = /^(?:네|예|응|넵|네에|예에)(?=\s|$)|^(?:아니요|아니오|아니|아뇨)(?=\s|$)/u;
const negativeAnswer = /^(?:아니요|아니오|아니|아뇨)$/u;

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
  return {polarity, meaning};
}

export function matchSpokenOption(text, options) {
  const answer = normalizedAnswer(text);
  if (!answer.polarity && !answer.meaning) return null;

  const matches = options.filter(option => {
    const label = normalizedAnswer(intakeLabel(option.label, 'ko') || '');
    return answer.meaning === label.meaning &&
      (answer.polarity === label.polarity || (
        answer.meaning && (!answer.polarity || !label.polarity)
      ));
  });

  return matches.length === 1 ? matches[0] : null;
}

export function rememberSpokenAnswer(input, text, question) {
  submittedTranscripts.set(input, {text, question});
}

export function consumeSpokenAnswer(input, text, question) {
  if (!input) return null;
  const transcript = submittedTranscripts.get(input);
  submittedTranscripts.delete(input);
  if (!question || transcript?.question !== question || transcript.text !== text) return null;
  return matchSpokenOption(text, question.options);
}
