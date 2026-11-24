// 11/18 되묻기(SYM_RETRY)의 빠른 답장: 불편한 곳(부위) → 그 부위의 흔한 증상 고르기(SYM_AREA_PICK).
// 사전·LLM이 증상을 못 찾았을 때만 나온다(주 경로는 대화).
// 선택지는 질문당 최대 12개(프론트 제한): 부위 11개 + '잘 모르겠어요' 1개.
// 증상 목록은 손으로 정했다: 통계의 환자 수 순서(symptom_department.clinic_ranking)는 사람들이 흔히 말하는 증상 순서와 달라
//   (예: 팔다리 묶음에 무릎·발목이 빠지고, 코 묶음에 콧물이 빠짐) 쓰지 않는다.
// 성별 제한이 다른 증상은 빼고 앞에서부터 AREA_PICK_MAX개를 보여 준다(그래서 소변·생식기는 여성·남성 증상을 함께 적어 둔다).

/** @type {ReadonlyArray<{id:string, ko:string, symptoms:ReadonlyArray<string>}>} */
export const SYMPTOM_AREAS = Object.freeze([
  {id: 'area_head', ko: '머리·어지럼증', symptoms: ['N01', 'N17', 'N05', 'N06', 'N18', 'N03']},
  {id: 'area_eye_ear', ko: '눈·귀', symptoms: ['F02', 'F13', 'F01', 'F05', 'H01', 'H02']},
  {id: 'area_nose_throat', ko: '코·목·기침', symptoms: ['R07', 'R05', 'R21', 'R25', 'R23', 'R06']},
  {id: 'area_chest', ko: '가슴·두근거림', symptoms: ['A11', 'K04', 'R02', 'R29', 'K05', 'R03']},
  {id: 'area_belly', ko: '배·소화', symptoms: ['D01', 'D11', 'D07', 'D09', 'D10', 'D12']},
  {id: 'area_mouth', ko: '입·치아', symptoms: ['D19', 'D20-02', 'D20-01', 'D20-03', 'L07', 'D21']},
  {id: 'area_bone', ko: '목·어깨·허리·팔다리', symptoms: ['L03', 'L01', 'L08', 'L15', 'L16', 'L20']},
  {id: 'area_skin', ko: '피부·상처', symptoms: ['S02', 'S06', 'EX02', 'S12', 'S17', 'S14']},
  {id: 'area_urine', ko: '소변·생식기·임신', symptoms: ['U01', 'U02', 'U06', 'X02', 'X14', 'X07', 'Y02', 'Y07', 'Y03']},
  {id: 'area_mind', ko: '마음·잠', symptoms: ['P06', 'P01', 'P03', 'P02', 'P04', 'P20']},
  {id: 'area_body', ko: '열·피로 등 온몸', symptoms: ['A03', 'A04', 'A02', 'A01', 'A09', 'T08']},
].map((a) => Object.freeze({...a, symptoms: Object.freeze(a.symptoms)})));

export const AREA_BY_ID = new Map(SYMPTOM_AREAS.map((a) => [a.id, a]));
/** 부위 고르기 질문에 보여 줄 증상 수(+ '여기 없어요') */
export const AREA_PICK_MAX = 6;

/**
 * 부위의 후보 증상(정해 둔 순서). 후보가 될 수 있는 증상만, 성별을 알면 성별 제한이 다른 증상은 뺀다.
 * @param {string} areaId
 * @param {{symptoms:Map}} refData
 * @param {{sex?:'female'|'male'|null, max?:number}} [opts]
 * @returns {Array<{id:string, nameKo:string}>}
 */
export function areaSymptoms(areaId, refData, {sex = null, max = AREA_PICK_MAX} = {}) {
  const area = AREA_BY_ID.get(areaId);
  if (!area) return [];
  return area.symptoms
    .map((id) => refData.symptoms.get(id))
    .filter((s) => s && s.isCandidate && (sex !== 'female' && sex !== 'male' ? true : s.sexRestriction == null || s.sexRestriction === sex))
    .slice(0, max)
    .map((s) => ({id: s.id, nameKo: s.nameKo}));
}
