export const emergencyCallHref = 'tel:119';
export const emergencySmsHref = 'sms:119';

// Match complete, explicit Korean requests. Transcripts never start a call or send a text.
export function requestsEmergencyHelp(text) {
  const command = text.normalize('NFKC').replace(/[\s.!?。？！]/gu, '');
  return /^(?:119|일일구)(?:에)?(?:전화|신고|연락)(?:를)?해(?:줘|주세요|주십시오)$/u.test(command);
}
