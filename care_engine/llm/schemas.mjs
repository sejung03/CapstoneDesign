// 출력 스키마: 두 업체(Gemini·OpenAI strict) 공통 부분집합만 쓴다. 설계 4절 "공통 스키마 규칙".
//   - 키워드: type, properties, required, enum(문자열), items, additionalProperties(false)
//   - object의 properties는 모두 required
//   - minItems·maxItems·pattern·maxLength 등은 쓰지 않는다(개수·길이는 validate.mjs가 강제)

export const SYMPTOM_SCHEMA_NAME = 'symptom_pick_v1';
export const PROFILE_SCHEMA_NAME = 'profile_extract_v1';
export const RISK_SCHEMA_NAME = 'risk_signal_v1';
export const SYMPTOM_RISK_SCHEMA_NAME = 'symptom_risk_v1';

export const INTENTS = ['symptom', 'facility_search', 'medication_question', 'other'];
export const PICK_STATUSES = ['matched', 'no_match', 'unclear'];
export const PROFILE_FIELDS = ['age', 'allergies', 'medications', 'history'];
export const RISK_SIGNALS = ['none', 'emergency', 'self_harm', 'threat', 'violence'];

const ALLOWED_KEYWORDS = new Set(['type', 'properties', 'required', 'enum', 'items', 'additionalProperties']);
const ALLOWED_TYPES = new Set(['object', 'array', 'string', 'integer', 'number', 'boolean']);

/** 설계 5-4. picks.items.enum = 이번 요청의 후보 ID(순서 유지, 중복 제거). */
export function symptomPickSchema(candidateIds) {
  const ids = [...new Set((candidateIds ?? []).map(String))];
  if (ids.length === 0) throw new Error('symptomPickSchema: 후보 ID가 없다');
  const schema = {
    type: 'object',
    properties: {
      intent: {type: 'string', enum: [...INTENTS]},
      status: {type: 'string', enum: [...PICK_STATUSES]},
      picks: {type: 'array', items: {type: 'string', enum: ids}},
    },
    required: ['intent', 'status', 'picks'],
    additionalProperties: false,
  };
  assertPortableSchema(schema);
  return schema;
}

export function riskSignalSchema() {
  const schema = {
    type: 'object',
    properties: {risk_signal: {type: 'string', enum: [...RISK_SIGNALS]}},
    required: ['risk_signal'],
    additionalProperties: false,
  };
  assertPortableSchema(schema);
  return schema;
}

export function symptomRiskSchema(candidateIds) {
  const base = symptomPickSchema(candidateIds);
  const schema = {
    ...base,
    properties: {...base.properties, risk_signal: {type: 'string', enum: [...RISK_SIGNALS]}},
    required: [...base.required, 'risk_signal'],
  };
  assertPortableSchema(schema);
  return schema;
}

/** 설계 6-2. */
export function profileExtractSchema() {
  const schema = {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: {type: 'string', enum: [...PROFILE_FIELDS]},
            value: {type: 'string'},
            messageIndex: {type: 'integer'},
            quote: {type: 'string'},
          },
          required: ['field', 'value', 'messageIndex', 'quote'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  };
  assertPortableSchema(schema);
  return schema;
}

/** 공통 부분집합을 벗어나면 Error를 던진다. */
export function assertPortableSchema(schema, at = '$') {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error(`${at}: 스키마는 객체여야 한다`);
  }
  for (const key of Object.keys(schema)) {
    if (!ALLOWED_KEYWORDS.has(key)) throw new Error(`${at}: 허용하지 않는 키워드 '${key}'`);
  }
  if (!ALLOWED_TYPES.has(schema.type)) throw new Error(`${at}: type이 없거나 허용하지 않는 값 '${schema.type}'`);

  if ('enum' in schema) {
    if (schema.type !== 'string') throw new Error(`${at}: enum은 string 타입에만 쓴다`);
    if (!Array.isArray(schema.enum) || schema.enum.length === 0 || !schema.enum.every((v) => typeof v === 'string')) {
      throw new Error(`${at}: enum은 비어 있지 않은 문자열 배열이어야 한다`);
    }
    if (new Set(schema.enum).size !== schema.enum.length) throw new Error(`${at}: enum 값 중복`);
  }

  if (schema.type === 'object') {
    const props = schema.properties;
    if (props === null || typeof props !== 'object' || Array.isArray(props) || Object.keys(props).length === 0) {
      throw new Error(`${at}: object에는 properties가 있어야 한다`);
    }
    if (schema.additionalProperties !== false) throw new Error(`${at}: additionalProperties는 false여야 한다`);
    const req = schema.required;
    if (!Array.isArray(req)) throw new Error(`${at}: required가 없다`);
    const names = Object.keys(props);
    const missing = names.filter((n) => !req.includes(n));
    const extra = req.filter((n) => !names.includes(n));
    if (missing.length || extra.length || new Set(req).size !== req.length) {
      throw new Error(`${at}: 모든 properties가 required여야 한다(빠짐: ${missing.join(',')} / 없는 이름: ${extra.join(',')})`);
    }
    for (const n of names) assertPortableSchema(props[n], `${at}.${n}`);
  } else {
    for (const k of ['properties', 'required', 'additionalProperties']) {
      if (k in schema) throw new Error(`${at}: '${k}'는 object에만 쓴다`);
    }
  }

  if (schema.type === 'array') {
    if (!('items' in schema)) throw new Error(`${at}: array에는 items가 있어야 한다`);
    assertPortableSchema(schema.items, `${at}[]`);
  } else if ('items' in schema) {
    throw new Error(`${at}: items는 array에만 쓴다`);
  }
  return true;
}
