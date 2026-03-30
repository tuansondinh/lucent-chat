#!/usr/bin/env node
'use strict'

const { execFileSync } = require('child_process')
const { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, statSync } = require('fs')
const { join } = require('path')

const STUDIO_DIR = join(__dirname, '..')
const AUDIO_SERVICE_DIR = join(STUDIO_DIR, 'audio-service')
const AUDIO_SERVICE_BUNDLE_DIR = join(STUDIO_DIR, 'build', 'audio-service-bundle')
const PYPROJECT_PATH = join(AUDIO_SERVICE_DIR, 'pyproject.toml')
const RELEASE_ENV_DIR = join(AUDIO_SERVICE_BUNDLE_DIR, '.venv-release')
const RUNTIME_DIR = join(AUDIO_SERVICE_BUNDLE_DIR, 'python-runtime')
const RELEASE_PYTHON = join(RELEASE_ENV_DIR, 'bin', 'python')
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

removeIfExists(AUDIO_SERVICE_BUNDLE_DIR)
mkdirSync(AUDIO_SERVICE_BUNDLE_DIR, { recursive: true })

if (!INCLUDE_AUDIO) {
  console.log('[audio-runtime] Skipping audio service bundle (LUCENT_INCLUDE_AUDIO_SERVICE=0).')
  process.exit(0)
}

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
    "print(json.dumps(project))",
  ].join('; '),
])

const project = JSON.parse(projectJson)
const dependencies = project.project.dependencies

run('uv', ['pip', 'install', '--python', RELEASE_PYTHON, ...dependencies], { stdio: 'inherit' })
run('uv', ['pip', 'install', '--python', RELEASE_PYTHON, '--no-deps', VOICE_BRIDGE_REQUIREMENT], { stdio: 'inherit' })
run('uv', ['pip', 'install', '--python', RELEASE_PYTHON, SPACY_EN_MODEL_URL], { stdio: 'inherit' })
run('cp', ['-RL', basePythonRoot, RUNTIME_DIR], { cwd: STUDIO_DIR, stdio: 'inherit' })
cpSync(join(AUDIO_SERVICE_DIR, 'audio_service.py'), join(AUDIO_SERVICE_BUNDLE_DIR, 'audio_service.py'))
cpSync(PYPROJECT_PATH, join(AUDIO_SERVICE_BUNDLE_DIR, 'pyproject.toml'))

const runtimePython = join(RUNTIME_DIR, 'bin', 'python3.12')
const sitePackages = join(RELEASE_ENV_DIR, 'lib', 'python3.12', 'site-packages')
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

const pythonStat = statSync(RELEASE_PYTHON)
console.log(`[audio-runtime] Built ${AUDIO_SERVICE_BUNDLE_DIR}`)
console.log(`[audio-runtime] Python size: ${pythonStat.size} bytes`)
console.log(`[audio-runtime] Bundled interpreter: ${runtimePython}`)
