// 진료과 추천(설계 §8-1). 시드 CSV의 symptom_department_variant에서 고른다(DB 함수 ref.recommend_departments와 같은 결과).
// never_recommend(응급의학과)를 한 번 더 거르고, search_key가 없는 과는 뺀다.
// 11/17 EF(I2): 확정 증상의 성별 제한과 filter.sex가 어긋나면 runCare가 증상 모름으로 바꾼 뒤 이 함수를 부른다
// (symptomSexMismatch). 그 경우만 DB 함수와 결과가 다르다(DB 함수는 남성 variant 행을 그대로 돌려줌).

/**
 * 11/17 EF(I2): 증상의 성별 제한(sexRestriction)과 filter.sex(female/male)가 서로 다른가.
 * 성별을 모르거나(unknown) 제한이 없으면 false.
 */
export function symptomSexMismatch(symptom, sex) {
  if (!symptom || !symptom.sexRestriction) return false;
  if (sex !== 'female' && sex !== 'male') return false;
  return symptom.sexRestriction !== sex;
}

function usable(deptId, data, never, {sex, ageBand}) {
  if (never.has(deptId)) return null;
  const d = data.departments.get(deptId);
  if (!d || !d.searchKey) return null;
  // fallback 목록에도 같은 대상 조건을 적용(variant에는 빌드 때 이미 반영됨)
  if (d.sexOnly && (sex === 'female' || sex === 'male') && d.sexOnly !== sex) return null;
  if (Number.isFinite(d.maxAge) && ageBand === 'adult') return null;
  return d;
}

/**
 * @param {{symptom:object|null, filter:{sex:string, ageBand:string}, injuryAnswer?:boolean, data:object}} input
 *   symptom: refData.symptoms의 항목(모르면 null). injuryAnswer: F2(다쳐서 생긴 증상) = 예
 * @returns {{departments:Array<{deptId, nameKo, searchKey, rank}>, group:string|null, search:object}}
 */
export function recommend({symptom, filter, injuryAnswer = false, data}) {
  const max = data.appConfig.max_recommendations;
  const never = new Set(Array.isArray(data.appConfig.never_recommend) ? data.appConfig.never_recommend : []);
  const sex = filter?.sex ?? 'unknown';
  const ageBand = filter?.ageBand ?? 'unknown';
  const pick = (ids) => {
    const out = [];
    for (const id of ids) {
      if (out.length >= max) break;
      const d = usable(id, data, never, {sex, ageBand});
      if (d && !out.some((x) => x.deptId === d.deptId)) out.push({deptId: d.deptId, nameKo: d.nameKo, searchKey: d.searchKey, rank: out.length + 1});
    }
    return out;
  };

  let departments = [];
  let group = null;
  const sd = symptom ? data.symptomDept.get(symptom.id) : null;
  if (symptom && !symptom.isFallback && sd && !sd.fallback) {
    departments = pick((data.variants.get(`${symptom.id}|${sex}|${ageBand}`) ?? []).map((v) => v.deptId));
  }
  if (departments.length === 0) {
    // 증상이 fallback이거나 모름(또는 variant 행이 없어 DB 함수가 fallback을 돌려주는 경우)
    if (injuryAnswer || symptom?.isInjury) group = 'injury';
    else if (symptom?.fallbackGroup === 'pediatric') group = 'pediatric';
    else group = 'general';
    departments = pick(data.fallbackDepartments.get(group) ?? []);
    if (departments.length === 0 && group !== 'general') {
      group = 'general';
      departments = pick(data.fallbackDepartments.get('general') ?? []);
    }
  }
  const search = departments.length > 0 ? {type: 'hospital', department: departments[0].searchKey} : {type: 'hospital'};
  return {departments, group, search};
}
