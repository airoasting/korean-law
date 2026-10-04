/**
 * 법제처 공식 약칭(alias-data.ts)에 없지만 실무와 보도에서 흔히 쓰는 통칭.
 *
 * 공식 약칭 사전에 없는 이름만 넣는다. 오른쪽 정식 법령명은 법제처 검색으로 확인한 값이다.
 * 늘릴 때는 find_law로 정식명을 확인하고, 다른 법령의 약칭과 겹치지 않는지 본다.
 */

const AI_BASIC_ACT = "인공지능 발전과 신뢰 기반 조성 등에 관한 기본법"

export const INFORMAL_LAW_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["인공지능법", AI_BASIC_ACT],
  ["인공지능기본법", AI_BASIC_ACT],
  ["AI법", AI_BASIC_ACT],
  ["AI기본법", AI_BASIC_ACT],
  ["도교법", "도로교통법"],
  ["화물운수법", "화물자동차 운수사업법"],
  ["화관법", "화학물질관리법"],
]
