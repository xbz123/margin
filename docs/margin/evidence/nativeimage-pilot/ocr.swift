// On-device OCR (Vision, no network) of each image given; prints one JSON object per
// line: {"file":..., "lines":[...]}.   swift ocr.swift <image>...
import Foundation
import Vision
import AppKit

for file in CommandLine.arguments.dropFirst() {
    guard let img = NSImage(contentsOfFile: file),
          let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        print("{\"file\":\"\(file)\",\"error\":\"unreadable\"}"); continue
    }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = false
    req.recognitionLanguages = ["zh-Hans", "en-US"]
    try! VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
    let lines = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    let data = try! JSONSerialization.data(withJSONObject: ["file": (file as NSString).lastPathComponent, "lines": lines])
    print(String(data: data, encoding: .utf8)!)
}
