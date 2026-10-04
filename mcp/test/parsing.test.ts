import { describe, expect, it } from "vitest"
import { toJoCode, fromJoCode } from "../src/jo.js"
import { normalizeCitationText, stripSentenceLead } from "../src/normalize.js"
import { extractArticleCitations } from "../src/citations.js"
import { findCaseNumbers, isImpossibleCase } from "../src/cases.js"
import { aliasKey, officialName, tidyLawQuery } from "../src/aliases.js"
import { compareTitles, plainTitle } from "../src/title-match.js"

describe("조문 코드", () => {
  it("표기 → 여섯 자리 코드 → 표기", () => {
    expect(toJoCode("제750조")).toBe("075000")
    expect(toJoCode("382조의3 제2항")).toBe("038203")
    expect(toJoCode("제 382 조 - 3")).toBe("038203")
    expect(fromJoCode("038203")).toBe("제382조의3")
    expect(fromJoCode("000100")).toBe("제1조")
    expect(fromJoCode("제7조")).toBe("제7조")
    expect(() => toJoCode("부칙")).toThrow()
  })
})

describe("표기 정규화", () => {
  it("'제'가 빠진 조문, §, 항, 같은 법, 약칭 정의", () => {
    expect(normalizeCitationText("민법 750조, 민법 §398, 근로기준법 23조 1항").text).toBe("민법 제750조, 민법 제398조, 근로기준법 제23조 제1항")
    expect(normalizeCitationText("매출 3조 원").text).toBe("매출 3조 원")
    expect(normalizeCitationText("상법 제399조, 제401조").text).toBe("상법 제399조, 같은 법 제401조")
    expect(normalizeCitationText("상속세 및 증여세법 제35조(저가 양수)나 제45조의5").text).toBe("상속세 및 증여세법 제35조(저가 양수)나 같은 법 제45조의5")
    const t = normalizeCitationText("같은 내용으로 쓰이므로 약관의 규제에 관한 법률(이하 '약관법')이 적용된다. 약관법 제7조").text
    expect(t).toBe("같은 내용으로 쓰이므로 약관의 규제에 관한 법률이 적용된다. 약관의 규제에 관한 법률 제7조")
    expect(stripSentenceLead("금액이 지나치게 낮으면 약관법")).toBe("약관법")
  })
})

describe("조문 인용 추출", () => {
  const cite = (t: string) => extractArticleCitations(normalizeCitationText(t).text)
  it("법령명, 같은 법, 제목, 항·호", () => {
    const c = cite("민법 제750조(불법행위의 내용)에 따른다. 또한 같은 법 제398조에 따라 감액된다. 「근로기준법」 제23조 제1항과 동법 제26조, 상법 제382조의3 제2항 제3호")
    expect(c.map((x) => [x.lawName, x.display, x.hang, x.ho])).toEqual([
      ["민법", "제750조", undefined, undefined], ["민법", "제398조", undefined, undefined],
      ["근로기준법", "제23조", 1, undefined], ["근로기준법", "제26조", undefined, undefined], ["상법", "제382조의3", 2, 3],
    ])
    expect(c[0].claimTitle).toBe("불법행위의 내용")
  })
  it("앞에 붙은 문장 조각과 '구'·'경우'를 뗀다", () => {
    expect(cite("판매 목표를 강제하는 행위는 공정거래법 제45조에 해당한다")[0].lawName).toBe("공정거래법")
    expect(cite("당시 시행되던 구 증권거래법 제188조의2가 적용된다")[0].lawName).toBe("당시 시행되던 구 증권거래법")
    expect(cite("판매하는 경우 전자상거래 등에서의 소비자보호에 관한 법률 제17조")[0].lawName).toBe("전자상거래 등에서의 소비자보호에 관한 법률")
    expect(cite("법인세법 제28조 제1항 제4호와 시행령 제53조")[1].lawName).toBe("시행령")
    expect(cite("소득세법 시행령 제5조")[0].lawName).toBe("소득세법 시행령")
  })
  it("법령명이 없거나 문서 자체 조항이면 lawName 없이 남긴다", () => {
    const c = cite("본 약관 제11조(책임의 제한)는 수정이 필요하다")
    expect(c).toHaveLength(1)
    expect(c[0].lawName).toBeUndefined()
  })
  it("'(이하 …)'나 날짜는 제목이 아니다", () => {
    expect(cite("민법 제2조 (2020. 1. 1. 시행)")[0].claimTitle).toBeUndefined()
  })
})

describe("사건번호 추출", () => {
  it("판례·헌재, 수량 낱말 제외, 미래 연도", () => {
    const refs = findCaseNumbers("대법원 2013다61381, 헌법재판소 2004헌마554, 2030도3000명 증가, 서울고법 2018노2389")
    expect(refs.map((r) => r.caseNo)).toEqual(["2013다61381", "2004헌마554", "2018노2389"])
    expect(refs[1].constitutional).toBe(true)
    expect(isImpossibleCase({ caseNo: "2031다1", index: 0, year: 2031, constitutional: false }, new Date("2026-10-04"))).toBe(true)
  })
})

describe("약칭과 검색어", () => {
  it("공식 약칭, 통칭, 하위 법령 접미사", () => {
    expect(officialName("공정거래법")).toEqual({ name: "독점규제 및 공정거래에 관한 법률", viaAlias: "공정거래법" })
    expect(officialName("AI기본법").name).toBe("인공지능 발전과 신뢰 기반 조성 등에 관한 기본법")
    expect(officialName("공정거래법 시행규칙").name).toBe("독점규제 및 공정거래에 관한 법률 시행규칙")
    expect(officialName("「민법」")).toEqual({ name: "민법" })
  })
  it("비교 키는 가운뎃점 다섯 가지와 공백을 지우고, 검색어의 'ㆍ'는 그대로 둔다", () => {
    for (const dot of ["·", "ㆍ", "‧", "•", "・"]) expect(aliasKey(`보건${dot}의료`)).toBe("보건의료")
    expect(tidyLawQuery("“119구조ㆍ구급에   관한 법률”")).toBe("119구조ㆍ구급에 관한 법률")
  })
})

describe("제목 대조", () => {
  it("같음, 포함, 조각 겹침은 통과, 다른 조문 제목은 탈락", () => {
    expect(compareTitles("손해배상", "손해배상의 범위").how).toBe("contains")
    expect(compareTitles("이사의 충실 의무", "이사의 충실의무").ok).toBe(true)
    expect(compareTitles("명예훼손죄", "명예훼손").ok).toBe(true)
    expect(compareTitles("업무무관 가지급금 등의 범위", "업무무관자산등에 대한 지급이자의 손금불산입").ok).toBe(false)
    expect(compareTitles("계약해제", "불법행위의 내용")).toEqual({ ok: false, how: "differ", score: 0 })
    expect(compareTitles("", "정의").ok).toBe(false)
    expect(plainTitle("『상법』 ⑳ 및 ㊿")).toBe("상법 (20) 및 (50)")
  })
})
