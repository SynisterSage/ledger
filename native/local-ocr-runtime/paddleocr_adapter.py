#!/usr/bin/env python3
"""Ledger's narrow local PaddleOCR adapter.

The Electron service owns process lifecycle and passes an image path. This
adapter owns only PaddleOCR API compatibility and emits the small JSON shape
Ledger accepts on stdout. It intentionally does not upload or persist images.
"""

import argparse
import json
import os
from pathlib import Path
import sys
import tempfile
import time


def configure_paddlex_cache():
    """Keep model/cache writes outside packaged app resources."""
    cache_dir = os.environ.get('LEDGER_PADDLEX_CACHE_HOME')
    if not cache_dir:
        cache_dir = str(Path(tempfile.gettempdir()) / 'ledger-paddlex')
    os.environ.setdefault('PADDLE_PDX_CACHE_HOME', cache_dir)


def fail(message):
    print(message, file=sys.stderr)
    return 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--language', default='auto')
    parser.add_argument('--mode', default='auto')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args()

    try:
        configure_paddlex_cache()
        from paddleocr import PaddleOCR
    except ImportError:
        return fail('PaddleOCR is not installed for the configured Python runtime.')

    started = time.perf_counter()
    language = 'en' if args.language in ('auto', 'en', 'en-US') else args.language
    try:
        ocr = PaddleOCR(lang=language, use_doc_orientation_classify=True, use_doc_unwarping=True)
        results = ocr.predict(args.input)
        lines = []
        for result in results:
            data = result.json if hasattr(result, 'json') else result
            if callable(data):
                data = data()
            if isinstance(data, str):
                data = json.loads(data)
            if not isinstance(data, dict):
                continue
            texts = data.get('rec_texts') or data.get('texts') or []
            scores = data.get('rec_scores') or data.get('scores') or []
            boxes = data.get('rec_boxes') or data.get('boxes') or []
            for index, text in enumerate(texts):
                value = str(text).strip()
                if not value:
                    continue
                line = {'text': value}
                if index < len(scores):
                    try:
                        line['confidence'] = float(scores[index])
                    except (TypeError, ValueError):
                        pass
                if index < len(boxes):
                    box = boxes[index]
                    try:
                        points = [(float(point[0]), float(point[1])) for point in box]
                        if points:
                            # Paddle returns pixel coordinates. Ledger's
                            # normalized box is optional, so omit it here
                            # until image dimensions are available reliably.
                            _ = points
                    except (TypeError, ValueError, IndexError):
                        pass
                lines.append(line)

        text = '\n'.join(line['text'] for line in lines)
        payload = {
            'text': text,
            'lines': lines,
            'engine': 'paddleocr',
            'language': language,
            'durationMs': round((time.perf_counter() - started) * 1000),
        }
        print(json.dumps(payload, ensure_ascii=False))
        return 0
    except Exception as error:  # Paddle surfaces provider-specific exceptions.
        return fail(f'PaddleOCR failed: {error}')


if __name__ == '__main__':
    sys.exit(main())
