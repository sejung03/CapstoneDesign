// 제공업체 인터페이스와 선택(설계 4절). API를 끼우는 유일한 자리.
/**
 * @typedef {Object} StructuredRequest
 * @property {string} system          시스템 지시문
 * @property {string} user            사용자 입력(이미 PII 가림)
 * @property {object} schema          schemas.mjs의 공통 스키마
 * @property {string} schemaName      예: 'symptom_pick_v1'
 * @property {number} timeoutMs
 * @property {AbortSignal} signal     프론트 취소와 연결
 *
 * @typedef {Object} StructuredResult
 * @property {boolean} ok
 * @property {object=} data           파싱된 JSON (ok=true일 때)
 * @property {('timeout'|'rate_limit'|'server'|'network'|'blocked'|'bad_json'|'aborted'|'not_implemented')=} error
 * @property {{provider:string, model:string|null, latencyMs:number, inputTokens?:number, outputTokens?:number}} meta
 */
import {createMockProvider} from './providers/mock.mjs';
import {createGeminiProvider} from './providers/gemini.mjs';
import {createOpenAiProvider} from './providers/openai.mjs';
import {getConfig} from './config.mjs';

export const PROVIDER_NAMES = Object.freeze(['mock', 'gemini', 'openai']);

/**
 * LLM_PROVIDER(기본 'mock')로 제공업체를 고른다. 모르는 이름이면 오류(조용히 다른 업체로 바꾸지 않는다).
 * @param {{config?:object, fixtures?:object, mockOptions?:object}} [opts]
 * @returns {{name:string, model:string|null, generateStructured(req:StructuredRequest):Promise<StructuredResult>}}
 */
export function getProvider({config = getConfig(), fixtures = {}, mockOptions = {}} = {}) {
  switch (config.provider) {
    case 'mock': return createMockProvider(fixtures, {model: config.model ?? 'mock-v0', ...mockOptions});
    case 'gemini': return createGeminiProvider({model: config.model});
    case 'openai': return createOpenAiProvider({model: config.model});
    default: throw new Error(`getProvider: 알 수 없는 LLM_PROVIDER '${config.provider}'`);
  }
}
