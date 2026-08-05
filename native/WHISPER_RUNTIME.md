# Ledger local transcription runtime

`whisper-cli` is built from `ggml-org/whisper.cpp` commit `a630b35c6fc02c8879f751ec3f39a61327f01dc7` with the Metal backend enabled and static ggml/whisper libraries.

The packaged macOS build includes the arm64 executable as an extra resource. Users download the `ggml-base.en.bin` model separately into Ledger application data; the model is never shipped in the installer.

To rebuild the runtime on macOS:

```sh
cmake -S /path/to/whisper.cpp -B /tmp/ledger-whisper-build \
  -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON \
  -DGGML_METAL=ON -DBUILD_SHARED_LIBS=OFF
cmake --build /tmp/ledger-whisper-build --config Release --target whisper-cli -j4
cp /tmp/ledger-whisper-build/bin/whisper-cli native/whisper-cli
```

To build the Windows runtime, open PowerShell with Git, CMake, and the Visual
Studio C++ build tools available, then run this from the Ledger repository:

```powershell
npm run build:whisper-windows
```

This checks out the same pinned whisper.cpp commit and writes
`native/whisper-cli.exe`. Restart Ledger after building it. The model remains a
separate per-computer download under Ledger application data.
