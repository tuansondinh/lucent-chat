#!/usr/bin/env node
'use strict'

const { execFileSync } = require('child_process')
const { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } = require('fs')
const { createHash } = require('crypto')
const { join } = require('path')

const STUDIO_DIR = join(__dirname, '..')
const AUDIO_SERVICE_DIR = join(STUDIO_DIR, 'audio-service')
const AUDIO_SERVICE_BUNDLE_DIR = join(STUDIO_DIR, 'build', 'audio-service-bundle')
const PYPROJECT_PATH = join(AUDIO_SERVICE_DIR, 'pyproject.toml')
const AUDIO_SERVICE_PY = join(AUDIO_SERVICE_DIR, 'audio_service.py')
const RELEASE_ENV_DIR = join(AUDIO_SERVICE_BUNDLE_DIR, '.venv-release')
const RUNTIME_DIR = join(AUDIO_SERVICE_BUNDLE_DIR, 'python-runtime')
const RELEASE_PYTHON = join(RELEASE_ENV_DIR, 'bin', 'python')
const CACHE_STAMP = join(AUDIO_SERVICE_BUNDLE_DIR, '.build-stamp')
const SPACY_EN_MODEL_URL = 'https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl'
const VOICE_BRIDGE_REQUIREMENT = 'lucent-voice-bridge==0.1.0'
const INCLUDE_AUDIO = process.env.LUCENT_INCLUDE_AUDIO_SERVICE !== '0'

function run(bin, args, opts = {}) {
  console.log(`\n$ ${[bin, ...args].join(' ')}`)
  const output = execFileSync(bin, args, {
    cwd: AUDIO_SERVICE_DIR,
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
    ...opts,
  })
  return typeof output === 'string' ? output.trim() : ''
}

function removeIfExists(pathname) {
  rmSync(pathname, { recursive: true, force: true })
}

/** Hash the files that determine whether a rebuild is needed. */
function computeInputHash() {
  const h = createHash('sha256')
  for (const f of [PYPROJECT_PATH, AUDIO_SERVICE_PY]) {
    if (existsSync(f)) h.update(readFileSync(f))
  }
  // Also include the voice-bridge pin so a version bump triggers a rebuild
  h.update(VOICE_BRIDGE_REQUIREMENT)
  return h.digest('hex')
}

function prunePythonPayload(sitePackagesDir) {
  const removable = [
    'claude_agent_sdk',
    'claude_agent_sdk-0.1.52.dist-info',
    'pip',
    'pip-26.0.1.dist-info',
    'setuptools',
    'setuptools-81.0.0.dist-info',
    'wheel',
    'wheel-0.45.1.dist-info',
  ]

  for (const entry of removable) {
    removeIfExists(join(sitePackagesDir, entry))
  }

  const stack = [sitePackagesDir]
  while (stack.length > 0) {
    const current = stack.pop()
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '__pycache__' || entry.name === 'tests' || entry.name === 'test') {
          removeIfExists(fullPath)
          continue
        }
        stack.push(fullPath)
        continue
      }
      if (entry.name.endsWith('.pyc') || entry.name.endsWith('.pyo')) {
        removeIfExists(fullPath)
      }
    }
  }
}

function ensureFile(pathname, message) {
  if (!existsSync(pathname)) {
    console.error(`[audio-runtime] ERROR: ${message}`)
    process.exit(1)
  }
}

ensureFile(PYPROJECT_PATH, `Missing ${PYPROJECT_PATH}`)

if (!INCLUDE_AUDIO) {
  console.log('[audio-runtime] Skipping audio service bundle (LUCENT_INCLUDE_AUDIO_SERVICE=0).')
  process.exit(0)
}

// ── Cache check ───────────────────────────────────────────────────────────────
// Skip the expensive pip install + Python runtime copy if nothing has changed
// since the last successful build. The stamp file stores a SHA-256 of the
// inputs (pyproject.toml + audio_service.py + voice-bridge pin).
const inputHash = computeInputHash()
const runtimePython = join(RUNTIME_DIR, 'bin', 'python3.12')
const sitePackages  = join(RELEASE_ENV_DIR, 'lib', 'python3.12', 'site-packages')

if (
  existsSync(CACHE_STAMP) &&
  readFileSync(CACHE_STAMP, 'utf8').trim() === inputHash &&
  existsSync(runtimePython) &&
  existsSync(sitePackages)
) {
  console.log(`[audio-runtime] Bundle is up to date (hash ${inputHash.slice(0, 12)}…). Skipping rebuild.`)
  console.log(`[audio-runtime] Built ${AUDIO_SERVICE_BUNDLE_DIR}`)
  process.exit(0)
}

console.log(`[audio-runtime] Cache miss (hash ${inputHash.slice(0, 12)}…). Rebuilding bundle…`)

// Full rebuild — wipe previous output and start fresh
removeIfExists(AUDIO_SERVICE_BUNDLE_DIR)
mkdirSync(AUDIO_SERVICE_BUNDLE_DIR, { recursive: true })

const basePython = process.env.AUDIO_SERVICE_PYTHON
  ?? run('uv', ['python', 'find', '--system', '3.12'])
const basePythonRoot = join(basePython, '..', '..')

console.log(`[audio-runtime] Base Python: ${basePython}`)
console.log(`[audio-runtime] Base Python root: ${basePythonRoot}`)

run('uv', ['venv', RELEASE_ENV_DIR, '--python', basePython], { stdio: 'inherit' })

const projectJson = run(basePython, [
  '-c',
  [
    'import json, pathlib, tomllib',
    `project = tomllib.loads(pathlib.Path(${JSON.stringify(PYPROJECT_PATH)}).read_text())`,
    'print(json.dumps(project))',
  ].join('; '),
])

const project = JSON.parse(projectJson)
const dependencies = project.project.dependencies

run('uv', ['pip', 'install', '--python', RELEASE_PYTHON, ...dependencies], { stdio: 'inherit' })
run('uv', ['pip', 'install', '--python', RELEASE_PYTHON, '--no-deps', VOICE_BRIDGE_REQUIREMENT], { stdio: 'inherit' })
run('uv', ['pip', 'install', '--python', RELEASE_PYTHON, SPACY_EN_MODEL_URL], { stdio: 'inherit' })
run('cp', ['-RL', basePythonRoot, RUNTIME_DIR], { cwd: STUDIO_DIR, stdio: 'inherit' })
cpSync(AUDIO_SERVICE_PY, join(AUDIO_SERVICE_BUNDLE_DIR, 'audio_service.py'))
cpSync(PYPROJECT_PATH, join(AUDIO_SERVICE_BUNDLE_DIR, 'pyproject.toml'))

prunePythonPayload(sitePackages)

run(runtimePython, [
  '-c',
  'import fastapi, numpy, onnxruntime, uvicorn, voice_bridge; print("AUDIO_RUNTIME_OK")',
], {
  env: {
    ...process.env,
    PYTHONPATH: sitePackages,
  },
  stdio: 'inherit',
})

// Write stamp only after a fully successful build so a failed build doesn't
// leave a stale cache that skips a necessary rebuild next time.
writeFileSync(CACHE_STAMP, inputHash)

const pythonStat = statSync(RELEASE_PYTHON)
console.log(`[audio-runtime] Built ${AUDIO_SERVICE_BUNDLE_DIR}`)
console.log(`[audio-runtime] Python size: ${pythonStat.size} bytes`)
console.log(`[audio-runtime] Bundled interpreter: ${runtimePython}`)
