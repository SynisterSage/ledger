# Ledger local transcription runtime

Ledger now prefers `whisper-server`, built from `ggml-org/whisper.cpp` commit `a630b35c6fc02c8879f751ec3f39a61327f01dc7`, as a loopback-only persistent runtime. It loads the model once and accepts sequential `/inference` requests. `whisper-cli` remains packaged as a CPU fallback.

CPU is the production default. The current packaged macOS server is CPU-only and reports Accelerate/NEON with `-ng`. Phase 4's repeatable benchmark on an arm64 M1 with `ggml-base.en.bin` measured one startup at about 159 ms, about 288 MiB peak RSS, and no failures across generated 5 s, 30 s, 60 s, and 180 s fixtures. Those generated fixtures are synthetic tones/silence, so they are a runtime-throughput baseline rather than a speech-quality benchmark. The observed RTFs were 0.108, 0.018, 0.014, and 0.012 respectively; use real speech fixtures for product decisions.

Metal is not enabled by default. A clean isolated Metal build from the pinned source started successfully on the same M1, but its 5 s result was slower than CPU (about 10.7 s startup and 0.146 RTF versus CPU's 0.108 on that fixture). The older packaged Metal path had exited with code 139; the isolated rebuild did not reproduce that crash, so the current evidence does not justify shipping Metal. Metal can be tested explicitly with `LEDGER_WHISPER_BACKEND=metal` and `LEDGER_WHISPER_SERVER_METAL=/path/to/whisper-server`; a runtime failure falls back to CPU once and preserves the queue.

The packaged macOS build includes the arm64 executable as an extra resource. Users download the `ggml-base.en.bin` model separately into Ledger application data; the model is never shipped in the installer.

To rebuild the CPU runtimes on macOS:

```sh
cmake -S /path/to/whisper.cpp -B /tmp/ledger-whisper-build \
  -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON \
  -DWHISPER_BUILD_SERVER=ON -DGGML_METAL=OFF -DBUILD_SHARED_LIBS=OFF
cmake --build /tmp/ledger-whisper-build --config Release --target whisper-cli -j4
cmake --build /tmp/ledger-whisper-build --config Release --target whisper-server -j4
cp /tmp/ledger-whisper-build/bin/whisper-cli native/whisper-cli
cp /tmp/ledger-whisper-build/bin/whisper-server native/whisper-server
```

To run the permanent benchmark against local fixtures:

```sh
npm run benchmark:whisper -- --backend cpu --runs 1 --fixtures /path/to/a.wav
npm run benchmark:whisper -- --backend both --runs 1 --output /tmp/ledger-whisper-report.json
```

The benchmark reports startup, preprocessing, inference, RTF, segment count, failures, diagnostics, and observed peak RSS. It generates deterministic synthetic fixtures when `--fixtures` is omitted.

To build the Windows runtime, open PowerShell with Git, CMake, and the Visual
Studio C++ build tools available, then run this from the Ledger repository:

```powershell
npm run build:whisper-windows
```

This checks out the same pinned whisper.cpp commit and writes
`native/whisper-cli.exe` and `native/whisper-server.exe`. Restart Ledger after building it. The model remains a
separate per-computer download under Ledger application data.
