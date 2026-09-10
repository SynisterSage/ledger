# Ledger local OCR runtime

The desktop Notes OCR service expects a local executable that accepts:

```text
--input /absolute/path/to/image.jpg
--language auto|en|...
--mode auto|handwriting|printed
--json
```

It must emit one JSON object on stdout using `@ledger/note-ocr-contract`:

```json
{"text":"...","lines":[{"text":"...","confidence":0.9}],"engine":"paddleocr"}
```

`paddleocr_adapter.py` is the reference adapter for a Python PaddleOCR
installation. Point development builds at it through
`LEDGER_PADDLEOCR_PATH` only after the Python environment has PaddleOCR
installed. Production packaging still needs a separately built and verified
runtime; this repository does not silently bundle an unverified Python
environment.
