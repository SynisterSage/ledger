# Ledger local AI runtime

Package the signed, pinned `llama-server` executable and every companion
runtime library for each target that is
actually enabled by Ledger's release configuration under a
platform/architecture directory:

```text
native/local-ai-runtime/darwin-arm64/llama-server
native/local-ai-runtime/darwin-arm64/libllama-server-impl.dylib
native/local-ai-runtime/darwin-arm64/libllama.0.dylib
native/local-ai-runtime/darwin-arm64/libggml.0.dylib
native/local-ai-runtime/win32-x64/llama-server.exe
native/local-ai-runtime/win32-x64/*.dll
```

The current repository explicitly targets Windows x64. The macOS builder does
not declare a universal or Intel target; its architecture follows the release
machine. Add `darwin-x64` only after an Intel macOS target is intentionally
enabled and tested.

These binaries are release artifacts, not source dependencies. The packaged
application resolves them from `process.resourcesPath/local-ai-runtime` and
never relies on a globally installed command. A clean release must not be
published until these files are present, pinned, signed where applicable, and
covered by platform QA.
