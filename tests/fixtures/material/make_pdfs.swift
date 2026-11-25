// Regenerates the synthetic PDF fixtures (text drawn with the system font; `nil` = an image-only page with no text,
// standing in for a scanned page or a picture of a graph). Content written for CURIVEN tests; not real course material.
//   swiftc tests/fixtures/material/make_pdfs.swift -o /tmp/mkpdf && /tmp/mkpdf tests/fixtures/material
import AppKit
func pdf(_ path: String, _ pages: [String?]) {
    var box = CGRect(x: 0, y: 0, width: 595, height: 842)
    let ctx = CGContext(URL(fileURLWithPath: path) as CFURL, mediaBox: &box, nil)!
    for p in pages {
        ctx.beginPDFPage(nil)
        NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: false)
        if let t = p { NSAttributedString(string: t, attributes: [.font: NSFont.systemFont(ofSize: 13)]).draw(in: CGRect(x: 50, y: 50, width: 495, height: 742)) }
        else { ctx.setFillColor(NSColor.lightGray.cgColor); ctx.fill(CGRect(x: 60, y: 300, width: 470, height: 300)); ctx.setStrokeColor(NSColor.darkGray.cgColor); ctx.stroke(CGRect(x: 60, y: 300, width: 470, height: 300)) }
        ctx.endPDFPage()
    }
    ctx.closePDF()
}
let dir = CommandLine.arguments[1]
pdf(dir + "/math_lecture.pdf", [
  "미분 강의 노트 1주차\n\n1. 평균변화율\n함수 y = f(x)에서 x가 a에서 b까지 변할 때 평균변화율은 (f(b) − f(a)) / (b − a)이다.\n\n2. 순간변화율\n구간의 길이를 0에 가깝게 줄인 평균변화율의 극한을 x = a에서의 순간변화율 또는 미분계수라고 한다.",
  "3. 미분계수의 정의\nf'(a) = lim h→0 (f(a + h) − f(a)) / h\n이 극한이 존재할 때 f는 x = a에서 미분가능하다고 한다.\n\n4. 도함수\n각 x에 그 점에서의 미분계수를 대응시키는 함수 f'(x)를 f의 도함수라고 한다.",
  nil,
  "연습 문제\nf(x) = x²일 때 x = 3에서의 미분계수를 정의를 이용해 구하시오.\n(그래프는 앞 쪽의 그림을 참고)"])
pdf(dir + "/history_handout.pdf", [
  "조선 후기 실학 — 수업 유인물\n\n실학은 17~19세기 조선에서 현실 문제를 해결하려 한 학문 경향이다.\n토지 제도 개혁을 중시한 경세치용 학파와 상공업 진흥을 주장한 이용후생 학파로 나누어 설명하기도 한다.",
  "생각해 볼 질문\n유형원은 균전론을, 박지원은 수레와 선박의 이용을 주장했다.\n두 주장의 공통점과 차이점을 당시 사회 문제와 연결해 정리해 보자."])
pdf(dir + "/missing_sections.pdf", ["과학 실험 보고서\n\n1. 실험 목적\n온도에 따른 효소 활성 변화를 관찰한다.", nil, nil, "4. 결론\n효소는 특정 온도 범위에서 가장 활발하게 작용했다."])
pdf(dir + "/scanned_only.pdf", [nil, nil])
