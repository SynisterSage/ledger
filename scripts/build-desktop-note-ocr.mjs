import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const runtimeTarget = `${process.platform}-${process.arch}`;
const python = path.join(repoRoot, '.venv', 'note-ocr', 'bin', 'python');
const cache = path.join(repoRoot, '.cache', 'paddlex');
const output = path.join(repoRoot, 'native', 'local-ocr-runtime', runtimeTarget);
const work = path.join(repoRoot, 'native', 'local-ocr-runtime', 'build');

if (runtimeTarget !== 'darwin-arm64') {
  throw new Error(`Desktop OCR packaging currently supports darwin-arm64; received ${runtimeTarget}. Build the runtime on the target platform.`);
}
if (!fs.existsSync(python)) {
  throw new Error('Missing .venv/note-ocr. Install the pinned desktop OCR environment first.');
}
if (!fs.existsSync(path.join(cache, 'official_models'))) {
  throw new Error('Missing .cache/paddlex/official_models. Run the adapter once to download the pinned models first.');
}

fs.mkdirSync(work, { recursive: true });
execFileSync(python, [
  '-m', 'PyInstaller',
  '--noconfirm', '--clean', '--onedir', '--name', 'paddleocr',
  '--distpath', output,
  '--workpath', work,
  '--specpath', work,
  '--collect-all', 'paddle',
  '--collect-all', 'paddleocr',
  '--collect-all', 'paddlex',
  '--collect-all', 'cv2',
  '--collect-all', 'pyclipper',
  '--copy-metadata', 'paddlex',
  '--copy-metadata', 'beautifulsoup4',
  '--copy-metadata', 'einops',
  '--copy-metadata', 'ftfy',
  '--copy-metadata', 'Jinja2',
  '--copy-metadata', 'latex2mathml',
  '--copy-metadata', 'lxml',
  '--copy-metadata', 'openpyxl',
  '--copy-metadata', 'premailer',
  '--copy-metadata', 'regex',
  '--copy-metadata', 'scikit-learn',
  '--copy-metadata', 'scipy',
  '--copy-metadata', 'sentencepiece',
  '--copy-metadata', 'tiktoken',
  '--copy-metadata', 'tokenizers',
  '--copy-metadata', 'pypdfium2',
  '--add-data', `${cache}:bundled-paddlex`,
  path.join(repoRoot, 'native', 'local-ocr-runtime', 'paddleocr_adapter.py'),
], {
  cwd: repoRoot,
  env: {
    ...process.env,
    PADDLE_PDX_CACHE_HOME: cache,
    PYINSTALLER_CONFIG_DIR: path.join(work, 'pyinstaller-config'),
  },
  stdio: 'inherit',
});

const internal = path.join(output, 'paddleocr', '_internal');
const nativeLibraries = [
  [path.join('/opt/homebrew/opt/openblas/lib', 'libopenblas.0.dylib'), 'libopenblas.0.dylib'],
  [path.join('/opt/homebrew/opt/gcc/lib/gcc/current', 'libgfortran.5.dylib'), 'libgfortran.5.dylib'],
  [path.join('/opt/homebrew/opt/gcc/lib/gcc/current', 'libgomp.1.dylib'), 'libgomp.1.dylib'],
  [path.join('/opt/homebrew/opt/gcc/lib/gcc/current', 'libquadmath.0.dylib'), 'libquadmath.0.dylib'],
  [path.join('/opt/homebrew/opt/gcc/lib/gcc/current', 'libgcc_s.1.1.dylib'), 'libgcc_s.1.1.dylib'],
];
for (const [source, name] of nativeLibraries) {
  if (!fs.existsSync(source)) throw new Error(`Missing native runtime library: ${source}`);
  fs.copyFileSync(source, path.join(internal, name));
}

console.log(`Built ${path.join(output, 'paddleocr', 'paddleocr')}`);
