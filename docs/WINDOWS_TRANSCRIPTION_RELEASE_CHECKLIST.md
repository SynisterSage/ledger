# Windows transcription release checklist

This checklist is for the signed packaged Windows build. Automated checks cover routing, structured errors, checkpoint storage, cleanup, finalization, suspend/resume wiring, and packaging invariants. Real device and conferencing checks must be completed on Windows 10 and Windows 11.

## Build and installation

- [ ] Run `npm run build:windows` on a Windows release machine.
- [ ] Stage the signed Windows Whisper runtime at `native/whisper-cli.exe` before packaging; `LEDGER_WHISPER_CLI` is available for development overrides.
- [ ] Build with the production code-signing certificate and verify the installer signature.
- [ ] Install cleanly; verify Ledger name, icon, publisher, and install location.
- [ ] Upgrade over an older build; confirm `userData/meeting-recordings` remains intact.
- [ ] Uninstall; confirm local recordings remain because `deleteAppDataOnUninstall` is false.

## Core recording matrix

Run each row for 5 minutes, then repeat start/stop three times without restarting Ledger.

| Output | Microphone | Checks |
| --- | --- | --- |
| Built-in speakers | Built-in | meters, pause/resume, transcript, reveal |
| Wired headphones | USB microphone | source balance, mute, stop/finalize |
| USB headphones | Webcam microphone | device names, saved selection |
| Bluetooth headphones | Bluetooth microphone | hands-free warning, quality |
| External monitor | USB audio interface | output change and loopback continuity |

For each combination verify that only audio reaches the recorder; no display video is rendered or saved.

## Meeting applications

- [ ] Teams desktop call.
- [ ] Zoom desktop call.
- [ ] Google Meet in Chrome.
- [ ] Google Meet in Edge.
- [ ] Browser video/audio outside a meeting app.
- [ ] Confirm the active output mix includes audible notifications and unrelated applications.

## Device and interruption checks

- [ ] Remove the microphone during recording; system audio continues and warning identifies the microphone.
- [ ] Remove headphones or change the default output; system audio either continues or reports interruption.
- [ ] Connect a new microphone during recording; Ledger does not silently switch to it.
- [ ] Keep a live track silent; it remains “No signal,” not “Disconnected.”
- [ ] Pause/resume, mute/unmute, and stop after each partial-source failure.
- [ ] Lock/unlock, suspend/resume, and verify wake health handling.
- [ ] Close the note/view, quit normally, force-close Ledger, and restart during finalization.
- [ ] Use the recovery prompt to open audio, recover once, then confirm no duplicate files or transcript segments.
- [ ] Discard a recovery and confirm only that recovery is removed.

## Long-session and quality checks

Run 30-minute, 60-minute, and 2-hour sessions with both sources active. Record:

- CPU and memory at start, 30 minutes, and end.
- Chunk write rate and finalization duration.
- Transcript delay and timestamp alignment.
- Clipping, distortion, echo, drift, repeated/missing audio, and source balance.
- UI responsiveness while transcript segments and meeting notes update.

## macOS regression

- [ ] Microphone and system capture still start and stop.
- [ ] Pause/resume, reveal, transcription, speaker edits, split/merge, and meeting-note actions work.
- [ ] Repeated recordings do not retain old streams or listeners.
- [ ] Interrupted macOS recordings remain recoverable.

Record OS version, Ledger version, adapter, selected devices, output device, recording duration, and result. Do not include transcript text, audio, tokens, or private note content in diagnostics.
