import Foundation
import ImageIO
import Vision

struct BoundingBox: Encodable {
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

struct Line: Encodable {
  let text: String
  let confidence: Double
  let boundingBox: BoundingBox
}

struct Result: Encodable {
  let text: String
  let lines: [Line]
  let engine = "apple-vision"
  let language: String
  let durationMs: Int
}

func argument(_ name: String) -> String? {
  guard let index = CommandLine.arguments.firstIndex(of: name), index + 1 < CommandLine.arguments.count else { return nil }
  return CommandLine.arguments[index + 1]
}

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data("Apple Vision OCR failed: \(message)\n".utf8))
  exit(1)
}

guard let input = argument("--input") else { fail("Missing --input") }
let language = argument("--language") ?? "auto"
let url = URL(fileURLWithPath: input)
let imageOptions: [CFString: Any] = [
  kCGImageSourceCreateThumbnailFromImageAlways: true,
  kCGImageSourceCreateThumbnailWithTransform: true,
  kCGImageSourceThumbnailMaxPixelSize: 4096,
]
guard let imageData = try? Data(contentsOf: url) else { fail("Could not read image data") }
guard let source = CGImageSourceCreateWithData(imageData as CFData, nil) else { fail("ImageIO could not create source") }
guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, imageOptions as CFDictionary) ?? CGImageSourceCreateImageAtIndex(source, 0, nil) else { fail("ImageIO could not create CGImage") }
let colorSpace = CGColorSpaceCreateDeviceRGB()
guard let context = CGContext(data: nil, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: image.width * 4, space: colorSpace, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { fail("Could not create normalized image context") }
context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
guard let normalizedImage = context.makeImage() else { fail("Could not create normalized image") }

let started = Date()
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
if language != "auto" && !language.isEmpty {
  request.recognitionLanguages = [language == "en" ? "en-US" : language]
}

do {
  let handler = VNImageRequestHandler(cgImage: normalizedImage, orientation: .up, options: [:])
  try handler.perform([request])
  let observations = (request.results ?? []).sorted { left, right in
    let leftY = 1 - left.boundingBox.maxY
    let rightY = 1 - right.boundingBox.maxY
    if abs(leftY - rightY) > 0.02 { return leftY < rightY }
    return left.boundingBox.minX < right.boundingBox.minX
  }
  let lines = observations.compactMap { observation -> Line? in
    guard let candidate = observation.topCandidates(1).first else { return nil }
    let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return nil }
    let box = observation.boundingBox
    return Line(text: text, confidence: Double(candidate.confidence), boundingBox: BoundingBox(x: box.minX, y: 1 - box.maxY, width: box.width, height: box.height))
  }
  let result = Result(text: lines.map(\.text).joined(separator: "\n"), lines: lines, language: language, durationMs: Int(Date().timeIntervalSince(started) * 1000))
  let data = try JSONEncoder().encode(result)
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
} catch {
  let nsError = error as NSError
  fail("\(nsError.domain) (\(nsError.code)): \(nsError.localizedDescription) \(nsError.userInfo)")
}
