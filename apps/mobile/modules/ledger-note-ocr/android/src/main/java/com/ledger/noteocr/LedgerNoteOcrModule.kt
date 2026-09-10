package com.ledger.noteocr

import android.graphics.BitmapFactory
import android.net.Uri
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import com.paddle.ocr.PaddleOCR
import com.paddle.ocr.EngineConfig
import com.paddle.ocr.PaddleOCRConfig
import com.paddle.ocr.util.OpenCVUtils

class LedgerNoteOcrModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LedgerNoteOcr")

    AsyncFunction("recognizeText") Coroutine { imageUri: String, language: String? ->
      val bytes = readImageBytes(imageUri)
      val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        ?: throw IllegalArgumentException("The selected image could not be decoded.")
      val context = appContext.reactContext ?: throw IllegalStateException("React context unavailable")
      if (!OpenCVUtils.init(context)) throw IllegalStateException("Android OCR image runtime is unavailable.")
      val ocr = PaddleOCR.create(
        context,
        PaddleOCRConfig(recBatchSize = 1),
        EngineConfig(numThreads = 4),
        "models/det/inference.onnx",
        "models/rec/inference.onnx",
        "models/rec/inference.yml"
      )
      try {
        val result = ocr.recognize(bitmap)
        val lines = result.results.map { item ->
          mapOf(
            "text" to item.text,
            "confidence" to item.confidence.toDouble(),
            "boundingBox" to mapOf(
              "x" to item.box.points.minOf { it.x / bitmap.width },
              "y" to item.box.points.minOf { 1 - (it.y / bitmap.height) },
              "width" to ((item.box.points.maxOf { it.x } - item.box.points.minOf { it.x }) / bitmap.width),
              "height" to ((item.box.points.maxOf { it.y } - item.box.points.minOf { it.y }) / bitmap.height)
            )
          )
        }
        mapOf(
          "text" to lines.joinToString("\n") { it["text"].toString() },
          "lines" to lines,
          "engine" to "paddleocr",
          "language" to (language ?: "auto"),
          "durationMs" to result.totalTimeMs.toInt()
        )
      } finally {
        ocr.release()
      }
    }
  }

  private fun readImageBytes(value: String): ByteArray {
    val uri = Uri.parse(value)
    return if (uri.scheme == "content" || uri.scheme == "file") {
      appContext.reactContext?.contentResolver?.openInputStream(uri)?.use { it.readBytes() }
        ?: throw IllegalArgumentException("The selected image could not be read.")
    } else {
      java.io.File(value).readBytes()
    }
  }
}
