import AVFoundation
import CoreMedia
import CoreGraphics
import Foundation
import ScreenCaptureKit

// A deliberately small, line-oriented native companion. Electron owns the
// session identity and IPC boundary; this process owns the macOS audio APIs.

final class AudioCaptureBridge: NSObject, SCStreamDelegate, SCStreamOutput {
    private var microphoneRecorder: AVAudioRecorder?
    private var systemStream: SCStream?
    private var systemAudioFile: AVAudioFile?
    private var systemAudioFormat: AVAudioFormat?
    private var sessionId: String?
    private var sessionDirectory: String?
    private var microphoneFileName: String?
    private var systemFileName: String?
    private var microphoneChunkStartAt: Date?
    private var systemChunkStartAt: Date?
    private var microphoneSequence = 0
    private var systemSequence = 0
    private var startedAt: Date?
    private var pausedAt: Date?
    private var accumulatedPause: TimeInterval = 0
    private var isPaused = false
    private var systemStreamOutputAttached = false
    private var microphoneLevelTimer: DispatchSourceTimer?
    private var lastSystemLevelAt = Date.distantPast
    private let outputLock = NSLock()

    private let workQueue = DispatchQueue(label: "com.ledger.audio-capture", qos: .userInitiated)
    private let chunkDuration: TimeInterval = 30

    func handle(_ input: [String: Any]) {
        let command = input["command"] as? String ?? "status"
        switch command {
        case "permission-status": permissionStatus()
        case "request-permissions": requestPermissions()
        case "start": start(input)
        case "test-source": start(input)
        case "pause": pause()
        case "resume": resume()
        case "stop": stop()
        case "status": emit(statusPayload())
        default: emit(errorPayload("invalid_command", "Unknown audio capture command."))
        }
    }

    private func emit(_ value: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(value), let data = try? JSONSerialization.data(withJSONObject: value), let line = String(data: data, encoding: .utf8) else { return }
        outputLock.lock()
        defer { outputLock.unlock() }
        print(line)
        fflush(stdout)
    }

    private func errorPayload(_ code: String, _ message: String) -> [String: Any] {
        ["ok": false, "code": code, "error": message]
    }

    private func microphonePermission() -> String {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return "granted"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "not_requested"
        @unknown default: return "unavailable"
        }
    }

    private func screenPermission() -> String {
        if #available(macOS 10.15, *) {
            return CGPreflightScreenCaptureAccess() ? "granted" : "not_requested"
        }
        return "unavailable"
    }

    private func permissionStatus() {
        emit(["ok": true, "microphone": microphonePermission(), "systemAudio": screenPermission()])
    }

    private func requestPermissions() {
        AVCaptureDevice.requestAccess(for: .audio) { [weak self] _ in
            DispatchQueue.main.async {
                // macOS does not provide a reliable in-app prompt for Screen
                // & System Audio Recording from this standalone capture
                // helper. Calling CGRequestScreenCaptureAccess here can leave
                // the IPC request pending while the app is absent from the
                // System Settings list. Report the current state and let the
                // renderer open the user-facing settings page instead.
                let screenState = self?.screenPermission() ?? "unavailable"
                let microphoneState = self?.microphonePermission() ?? "unavailable"
                self?.emit(["ok": true, "microphone": microphoneState, "systemAudio": screenState])
            }
        }
    }

    private func fileSettings() -> [String: Any] {
        [
            AVFormatIDKey: Int(kAudioFormatLinearPCM),
            AVSampleRateKey: 16_000,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false
        ]
    }

    private func start(_ input: [String: Any]) {
        guard sessionId == nil else { emit(errorPayload("already_recording", "Another audio capture session is already active.")); return }
        guard let requestedSession = input["sessionId"] as? String, !requestedSession.isEmpty,
              let directory = input["directory"] as? String, !directory.isEmpty else {
            emit(errorPayload("invalid_session", "Audio capture session details are invalid.")); return
        }
        let wantMicrophone = input["microphone"] as? Bool ?? true
        let wantSystemAudio = input["systemAudio"] as? Bool ?? true
        guard wantMicrophone || wantSystemAudio else { emit(errorPayload("no_sources", "Select at least one audio source.")); return }

        do { try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true) }
        catch { emit(errorPayload("directory_failed", "Ledger could not prepare temporary audio storage.")); return }

        sessionId = requestedSession
        sessionDirectory = directory
        microphoneChunkStartAt = nil
        systemChunkStartAt = nil
        microphoneSequence = 0
        systemSequence = 0
        startedAt = Date()
        pausedAt = nil
        accumulatedPause = 0
        isPaused = false

        var sources: [[String: Any]] = []
        var warnings: [[String: Any]] = []
        if wantMicrophone {
            do {
                let recorder = try startMicrophoneChunk()
                recorder.isMeteringEnabled = true
                guard recorder.record() else { throw NSError(domain: "LedgerAudio", code: 1, userInfo: [NSLocalizedDescriptionKey: "Microphone recording could not start."]) }
                microphoneRecorder = recorder
                let levelTimer = DispatchSource.makeTimerSource(queue: workQueue)
                levelTimer.schedule(deadline: .now(), repeating: .milliseconds(100))
                levelTimer.setEventHandler { [weak self] in
                    guard let self, let recorder = self.microphoneRecorder else { return }
                    recorder.updateMeters()
                    if recorder.currentTime >= self.chunkDuration { self.rotateMicrophoneChunk() }
                    let decibels = max(-60, recorder.averagePower(forChannel: 0))
                    let level = min(1, max(0, (decibels + 60) / 60))
                    self.emit(["event": "level", "source": "user_microphone", "level": level])
                }
                levelTimer.resume()
                microphoneLevelTimer = levelTimer
                sources.append(["source": "user_microphone", "sampleRate": 16_000, "channels": 1, "active": true])
            } catch { warnings.append(["source": "user_microphone", "error": error.localizedDescription]) }
        }

        if wantSystemAudio {
            let semaphore = DispatchSemaphore(value: 0)
            var systemError: String?
            startSystemAudio { error in systemError = error; semaphore.signal() }
            semaphore.wait()
            if let systemError {
                warnings.append(["source": "system_audio", "error": systemError])
            } else {
                sources.append(["source": "system_audio", "sampleRate": 16_000, "channels": 1, "active": true])
            }
        }

        guard !sources.isEmpty else {
            cleanupSession()
            emit(errorPayload("no_sources_started", "Ledger could not start microphone or system audio."))
            return
        }
        var response: [String: Any] = ["ok": true, "sessionId": requestedSession, "sources": sources]
        if !warnings.isEmpty { response["warnings"] = warnings }
        emit(response)
    }

    private func startSystemAudio(completion: @escaping (String?) -> Void) {
        if #available(macOS 13.0, *) {
            Task {
                do {
                    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                    guard let display = content.displays.first else { throw NSError(domain: "LedgerAudio", code: 2, userInfo: [NSLocalizedDescriptionKey: "No display is available for system-audio capture."]) }
                    let filter = SCContentFilter(display: display, excludingWindows: [])
                    let configuration = SCStreamConfiguration()
                    configuration.capturesAudio = true
                    configuration.excludesCurrentProcessAudio = false
                    configuration.sampleRate = 16_000
                    configuration.channelCount = 1
                    let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
                    try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: workQueue)
                    systemStreamOutputAttached = true
                    try await stream.startCapture()
                    systemStream = stream
                    completion(nil)
                } catch { completion(error.localizedDescription) }
            }
        } else {
            completion("System-audio capture requires macOS 13 or later.")
        }
    }

    private func startMicrophoneChunk() throws -> AVAudioRecorder {
        guard let directory = sessionDirectory, let sessionId else { throw NSError(domain: "LedgerAudio", code: 3, userInfo: [NSLocalizedDescriptionKey: "Audio session storage is unavailable."]) }
        let name = "user-microphone-\(String(format: "%06d", microphoneSequence)).wav"
        let recorder = try AVAudioRecorder(url: URL(fileURLWithPath: (directory as NSString).appendingPathComponent(name)), settings: fileSettings())
        microphoneFileName = name
        microphoneChunkStartAt = Date()
        _ = sessionId
        return recorder
    }

    private func rotateMicrophoneChunk() {
        guard let recorder = microphoneRecorder else { return }
        recorder.stop()
        finalizeMicrophoneChunk(endAt: Date())
        do {
            let next = try startMicrophoneChunk()
            next.isMeteringEnabled = true
            guard next.record() else { throw NSError(domain: "LedgerAudio", code: 4, userInfo: [NSLocalizedDescriptionKey: "Microphone chunk could not start."]) }
            microphoneRecorder = next
        } catch {
            microphoneRecorder = nil
            emit(["event": "error", "source": "user_microphone", "error": error.localizedDescription])
        }
    }

    private func startSystemChunk(format: AVAudioFormat) {
        guard let directory = sessionDirectory else { return }
        let name = "system-audio-\(String(format: "%06d", systemSequence)).wav"
        systemFileName = name
        systemChunkStartAt = Date()
        systemAudioFile = try? AVAudioFile(forWriting: URL(fileURLWithPath: (directory as NSString).appendingPathComponent(name)), settings: format.settings)
    }

    private func finalizeMicrophoneChunk(endAt: Date) {
        guard let name = microphoneFileName, let start = microphoneChunkStartAt, let sessionId else { return }
        let size = fileSize(name)
        emit(["event": "chunk-finalized", "id": "\(sessionId)-user_microphone-\(microphoneSequence)", "sessionId": sessionId, "source": "user_microphone", "sequence": microphoneSequence, "startAt": iso(start) ?? "", "endAt": iso(endAt) ?? "", "durationSeconds": max(0, endAt.timeIntervalSince(start)), "fileName": name, "sizeBytes": size, "finalized": true])
        microphoneSequence += 1
        microphoneFileName = nil
        microphoneChunkStartAt = nil
    }

    private func finalizeSystemChunk(endAt: Date) {
        guard let name = systemFileName, let start = systemChunkStartAt, let sessionId else { return }
        let size = fileSize(name)
        emit(["event": "chunk-finalized", "id": "\(sessionId)-system_audio-\(systemSequence)", "sessionId": sessionId, "source": "system_audio", "sequence": systemSequence, "startAt": iso(start) ?? "", "endAt": iso(endAt) ?? "", "durationSeconds": max(0, endAt.timeIntervalSince(start)), "fileName": name, "sizeBytes": size, "finalized": true])
        systemSequence += 1
        systemFileName = nil
        systemChunkStartAt = nil
        systemAudioFile = nil
    }

    private func fileSize(_ name: String) -> Int {
        guard let directory = sessionDirectory else { return 0 }
        let url = URL(fileURLWithPath: (directory as NSString).appendingPathComponent(name))
        return (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.intValue ?? 0
    }

    private func pause() {
        guard sessionId != nil, !isPaused else { emit(errorPayload("invalid_state", "Audio capture is not currently recording.")); return }
        microphoneRecorder?.pause()
        if #available(macOS 13.0, *), let systemStream, systemStreamOutputAttached {
            try? systemStream.removeStreamOutput(self, type: .audio)
            systemStreamOutputAttached = false
        }
        pausedAt = Date()
        isPaused = true
        emit(["ok": true, "state": "paused"])
    }

    private func resume() {
        guard sessionId != nil, isPaused else { emit(errorPayload("invalid_state", "Audio capture is not paused.")); return }
        if let pausedAt { accumulatedPause += Date().timeIntervalSince(pausedAt) }
        microphoneRecorder?.record()
        if #available(macOS 13.0, *), let systemStream, !systemStreamOutputAttached {
            try? systemStream.addStreamOutput(self, type: .audio, sampleHandlerQueue: workQueue)
            systemStreamOutputAttached = true
        }
        self.pausedAt = nil
        isPaused = false
        emit(["ok": true, "state": "recording"])
    }

    private func stop() {
        guard let activeSession = sessionId else { emit(["ok": true, "state": "idle", "sources": []]); return }
        microphoneRecorder?.stop()
        finalizeMicrophoneChunk(endAt: Date())
        microphoneRecorder = nil
        microphoneLevelTimer?.cancel()
        microphoneLevelTimer = nil
        if #available(macOS 13.0, *) {
            let semaphore = DispatchSemaphore(value: 0)
            systemStream?.stopCapture { _ in semaphore.signal() }
            semaphore.wait()
        }
        workQueue.sync {}
        finalizeSystemChunk(endAt: Date())
        systemStream = nil
        systemStreamOutputAttached = false
        systemAudioFile = nil
        let endedAt = Date()
        let sources: [[String: Any]] = [
            microphoneRecorder != nil || microphoneSequence > 0 ? ["source": "user_microphone", "active": true] : nil,
            systemAudioFile != nil || systemSequence > 0 ? ["source": "system_audio", "active": true] : nil
        ].compactMap { $0 }
        emit(["ok": true, "sessionId": activeSession, "state": "stopped", "startedAt": iso(startedAt) ?? "", "endedAt": iso(endedAt) ?? "", "durationSeconds": max(0, endedAt.timeIntervalSince(startedAt ?? endedAt) - accumulatedPause), "sources": sources])
        cleanupSession()
    }

    private func cleanupSession() {
        microphoneRecorder = nil
        microphoneLevelTimer?.cancel()
        microphoneLevelTimer = nil
        systemStream = nil
        systemStreamOutputAttached = false
        systemAudioFile = nil
        sessionId = nil
        sessionDirectory = nil
        microphoneFileName = nil
        systemFileName = nil
        microphoneChunkStartAt = nil
        systemChunkStartAt = nil
        startedAt = nil
        pausedAt = nil
        accumulatedPause = 0
        isPaused = false
    }

    private func iso(_ date: Date?) -> String? { date.map { ISO8601DateFormatter().string(from: $0) } }

    private func statusPayload() -> [String: Any] {
        ["ok": true, "state": sessionId == nil ? "idle" : (isPaused ? "paused" : "recording"), "sessionId": sessionId as Any]
    }

    @available(macOS 13.0, *)
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, CMSampleBufferIsValid(sampleBuffer), let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer), let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription) else { return }
        if systemAudioFormat == nil { systemAudioFormat = AVAudioFormat(streamDescription: asbd) }
        guard let format = systemAudioFormat, let buffer = makePCMBuffer(sampleBuffer, format: format) else { return }
        if systemAudioFile == nil { startSystemChunk(format: format) }
        if let systemAudioFile { try? systemAudioFile.write(from: buffer) }
        if let systemChunkStartAt, Date().timeIntervalSince(systemChunkStartAt) >= chunkDuration {
            finalizeSystemChunk(endAt: Date())
            startSystemChunk(format: format)
        }
        if Date().timeIntervalSince(lastSystemLevelAt) >= 0.1 {
            lastSystemLevelAt = Date()
            emit(["event": "level", "source": "system_audio", "level": level(buffer)])
        }
    }

    @available(macOS 13.0, *)
    func stream(_ stream: SCStream, didStopWithError error: Error) { emit(["event": "error", "source": "system_audio", "error": error.localizedDescription]) }

    private func makePCMBuffer(_ sampleBuffer: CMSampleBuffer, format: AVAudioFormat) -> AVAudioPCMBuffer? {
        guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer), let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer), let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription) else { return nil }
        let length = CMBlockBufferGetDataLength(blockBuffer)
        guard let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(length) / format.streamDescription.pointee.mBytesPerFrame) else { return nil }
        pcm.frameLength = pcm.frameCapacity
        guard let channelData = pcm.audioBufferList.pointee.mBuffers.mData else { return nil }
        CMBlockBufferCopyDataBytes(blockBuffer, atOffset: 0, dataLength: length, destination: channelData)
        _ = asbd
        return pcm
    }

    private func level(_ buffer: AVAudioPCMBuffer) -> Double {
        let count = Int(buffer.frameLength)
        guard count > 0 else { return 0 }
        if let data = buffer.floatChannelData?[0] {
            var sum: Float = 0
            for index in 0..<count { sum += abs(data[index]) }
            return min(1, Double(sum / Float(count)) * 4)
        }
        if let data = buffer.int16ChannelData?[0] {
            var sum: Double = 0
            for index in 0..<count { sum += abs(Double(data[index])) / 32768 }
            return min(1, sum / Double(count) * 4)
        }
        return 0
    }
}

let bridge = AudioCaptureBridge()
func parse(_ line: String) -> [String: Any]? {
    guard let data = line.data(using: .utf8), let value = try? JSONSerialization.jsonObject(with: data), let object = value as? [String: Any] else { return nil }
    return object
}
while let line = readLine() {
    if let input = parse(line) { bridge.handle(input) }
}
