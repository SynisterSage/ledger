package com.ledger.noteocr

import android.graphics.BitmapFactory
import android.net.Uri
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.genai.llminference.LlmInference
import com.google.mediapipe.tasks.genai.llminference.LlmInferenceSession
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import com.paddle.ocr.PaddleOCR
import com.paddle.ocr.EngineConfig
import com.paddle.ocr.PaddleOCRConfig
import com.paddle.ocr.util.OpenCVUtils
import java.io.File
import java.util.concurrent.TimeUnit

class LedgerNoteOcrModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LedgerNoteOcr")

    AsyncFunction("visionModelStatus") {
      val context = appContext.reactContext ?: throw IllegalStateException("React context unavailable")
      val model = File(context.filesDir, "ledger-vision/gemma-3n-E2B-it-int4.task")
      mapOf("installed" to (model.exists() && model.length() > 0), "bytes" to model.length(), "expectedBytes" to 3136226711L)
    }

    AsyncFunction("installVisionModel") Coroutine { sourceUri: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("React context unavailable")
      val targetDirectory = File(context.filesDir, "ledger-vision")
      targetDirectory.mkdirs()
      val target = File(targetDirectory, "gemma-3n-E2B-it-int4.task")
      val temporary = File(targetDirectory, "gemma-3n-E2B-it-int4.task.part")
      val source = Uri.parse(sourceUri)
      val input = context.contentResolver.openInputStream(source) ?: throw IllegalArgumentException("The selected model file could not be opened.")
      try {
        input.use { stream -> temporary.outputStream().use { output -> stream.copyTo(output, 1024 * 1024) } }
        if (temporary.length() != 3136226711L) {
          temporary.delete()
          throw IllegalArgumentException("That is not the expected Gemma 3n E2B model file.")
        }
        if (target.exists()) target.delete()
        if (!temporary.renameTo(target)) throw IllegalStateException("Could not install Ledger Vision.")
      } finally { if (temporary.exists()) temporary.delete() }
      mapOf("installed" to true, "bytes" to target.length(), "expectedBytes" to 3136226711L)
    }

    AsyncFunction("recognizeText") Coroutine { imageUri: String, language: String? ->
      val bytes = readImageBytes(imageUri)
      val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        ?: throw IllegalArgumentException("The selected image could not be decoded.")
      val context = appContext.reactContext ?: throw IllegalStateException("React context unavailable")
      val visionModel = File(context.filesDir, "ledger-vision/gemma-3n-E2B-it-int4.task")
      if (!visionModel.exists()) {
        throw IllegalStateException("Ledger Vision is not installed on this Android device.")
      }
      return@Coroutine recognizeWithVision(context, bitmap, visionModel, language)
      /*
       * Paddle remains in the source temporarily for migration/debug builds,
       * but is intentionally unreachable for the user-facing Android path.
       */
      @Suppress("UNREACHABLE_CODE")
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

  private fun recognizeWithVision(
    context: android.content.Context,
    bitmap: android.graphics.Bitmap,
    modelFile: File,
    language: String?
  ): Map<String, Any> {
    val started = System.currentTimeMillis()
    val inference = LlmInference.createFromOptions(
      context,
      LlmInference.LlmInferenceOptions.builder()
        .setModelPath(modelFile.absolutePath)
        .setMaxTokens(4096)
        .build()
    )
    val session = LlmInferenceSession.createFromOptions(
      inference,
      LlmInferenceSession.LlmInferenceSessionOptions.builder()
        .setTemperature(0.1f)
        .setTopK(40)
        .setTopP(0.95f)
        .build()
    )
    try {
      session.addImage(BitmapImageBuilder(bitmap).build())
      session.addQueryChunk("Transcribe this handwritten note exactly. Preserve line breaks. Do not guess; use [unclear] for unreadable text. Return JSON only with text, lines, blocks, uncertain, and unclearRegions. Language: ${language ?: "auto"}.")
      val response = session.generateResponse()
      return mapOf(
        "text" to response,
        "lines" to emptyList<Map<String, Any>>(),
        "engine" to "local-vision",
        "language" to (language ?: "auto"),
        "durationMs" to (System.currentTimeMillis() - started).toInt()
      )
    } finally {
      session.close()
      inference.close()
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
