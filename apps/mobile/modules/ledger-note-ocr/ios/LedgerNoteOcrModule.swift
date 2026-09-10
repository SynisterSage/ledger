import ExpoModulesCore
import Vision

public final class LedgerNoteOcrModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LedgerNoteOcr")

    AsyncFunction("recognizeText") { (imageUri: String, language: String?) throws -> [String: Any] in
      guard let url = Self.fileURL(from: imageUri) else {
        throw NoteOcrModuleError.invalidImage
      }

      let request = VNRecognizeTextRequest()
      request.recognitionLevel = .accurate
      request.usesLanguageCorrection = true
      if let language, !language.isEmpty, language != "auto" {
        request.recognitionLanguages = [language == "en" ? "en-US" : language]
      }

      let started = Date()
      let handler = VNImageRequestHandler(url: url, options: [:])
      try handler.perform([request])

      let observations = (request.results ?? []).sorted { left, right in
        let leftY = 1 - left.boundingBox.maxY
        let rightY = 1 - right.boundingBox.maxY
        if abs(leftY - rightY) > 0.02 { return leftY < rightY }
        return left.boundingBox.minX < right.boundingBox.minX
      }

      var lines: [[String: Any]] = []
      for observation in observations {
        guard let candidate = observation.topCandidates(1).first else { continue }
        let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { continue }
        lines.append([
          "text": text,
          "confidence": Double(candidate.confidence),
          "boundingBox": [
            "x": Double(observation.boundingBox.minX),
            "y": Double(1 - observation.boundingBox.maxY),
            "width": Double(observation.boundingBox.width),
            "height": Double(observation.boundingBox.height)
          ]
        ])
      }

      return [
        "text": lines.map { $0["text"] as? String ?? "" }.joined(separator: "\n"),
        "lines": lines,
        "engine": "apple-vision",
        "language": language ?? "auto",
        "durationMs": Int(Date().timeIntervalSince(started) * 1000)
      ]
    }
  }

  private static func fileURL(from value: String) -> URL? {
    if let url = URL(string: value), url.isFileURL { return url }
    if value.hasPrefix("/") { return URL(fileURLWithPath: value) }
    return nil
  }
}

private enum NoteOcrModuleError: Error {
  case invalidImage
}
