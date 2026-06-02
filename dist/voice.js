import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { homedir } from "node:os";
import { getPlatformInstallHint } from "./install/platform.js";
const PARAKEET_SPECIFIER = "parakeet-coreml";
const SHERPA_ONNX_SPECIFIER = "sherpa-onnx-node";
const SHERPA_ONNX_MODEL_DIR_ENV = "SHERPA_ONNX_MODEL_DIR";
const SHERPA_ONNX_NUM_THREADS_ENV = "SHERPA_ONNX_NUM_THREADS";
const getVoiceConfigPath = () => process.env.VOICE_CONFIG_PATH || path.join(homedir(), ".config", "telepi", "voice-config.json");
const VOICE_CONFIG_DEFAULT = {
  backend: "sherpa-onnx",
  groq: { apiKey: "" },
  openai: { apiKey: "" },
};
const SHERPA_MODEL_DOCS_URL = "https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-transducer/nemo-transducer-models.html";
const FFMPEG_INSTALL_MESSAGE = `ffmpeg not found. Install it with: ${getPlatformInstallHint("ffmpeg")}`;
const NO_BACKEND_ERROR = `Voice messages require a transcription backend.

Option 1: Install Parakeet CoreML for local transcription on Apple Silicon (free, private, ~1.5GB download):
  npm install parakeet-coreml
Also requires ffmpeg: ${getPlatformInstallHint("ffmpeg")}

Option 2: Install Sherpa-ONNX for local/offline Parakeet transcription on Intel-based Macs (also works on Apple Silicon):
  npm install sherpa-onnx-node
  Also requires ffmpeg: ${getPlatformInstallHint("ffmpeg")}

Option 3: Groq (free cloud, whisper-large-v3-turbo):
  Use /voice in Telegram to set your Groq API key (console.groq.com)

Option 4: OpenAI (~$0.006/min):
  Use /voice in Telegram to set your OpenAI API key

Pro tips:
- Sherpa-ONNX: local, free, always available
- Groq: free cloud, needs API key
- OpenAI: paid cloud, needs API key`;

// --- Voice config ---
function readVoiceConfigSync() {
  try {
    const cfgPath = getVoiceConfigPath();
    if (!existsSync(cfgPath)) return { ...VOICE_CONFIG_DEFAULT };
    const raw = readFileSync(cfgPath, "utf-8");
    return { ...VOICE_CONFIG_DEFAULT, ...JSON.parse(raw) };
  } catch { return { ...VOICE_CONFIG_DEFAULT }; }
}

async function readVoiceConfig() {
  try {
    const raw = await readFile(getVoiceConfigPath(), "utf-8").catch(() => null);
    if (!raw) return { ...VOICE_CONFIG_DEFAULT };
    return { ...VOICE_CONFIG_DEFAULT, ...JSON.parse(raw) };
  } catch { return { ...VOICE_CONFIG_DEFAULT }; }
}

async function writeVoiceConfig(config) {
  const cfgPath = getVoiceConfigPath();
  const dir = path.dirname(cfgPath);
  await mkdir(dir, { recursive: true }).catch(() => {});
  await writeFile(cfgPath, JSON.stringify(config, null, 2), "utf-8");
}

export async function getSelectedBackend() {
  const config = await readVoiceConfig();
  return config.backend || "sherpa-onnx";
}

export async function setSelectedBackend(backend) {
  const config = await readVoiceConfig();
  config.backend = backend;
  await writeVoiceConfig(config);
}

export async function getBackendApiKey(backend) {
  const config = await readVoiceConfig();
  if (backend === "groq") return config.groq?.apiKey || "";
  if (backend === "openai") return config.openai?.apiKey || process.env.OPENAI_API_KEY?.trim() || "";
  return "";
}

export async function setBackendApiKey(backend, key) {
  const config = await readVoiceConfig();
  if (backend === "groq") {
    if (!config.groq) config.groq = {};
    config.groq.apiKey = key;
  } else if (backend === "openai") {
    if (!config.openai) config.openai = {};
    config.openai.apiKey = key;
  }
  await writeVoiceConfig(config);
}

export async function clearBackendApiKey(backend) {
  await setBackendApiKey(backend, "");
}

const _require = createRequire(import.meta.url);
let _importModule = async (specifier) => _require(specifier);
let _decodeAudio = decodeAudioToSamples;
let _engine = null;
let _sherpaRecognizer = null;
let _sherpaRecognizerConfigKey = null;
let _parakeetMutex = Promise.resolve();
let _sherpaMutex = Promise.resolve();

export function _setImportHook(hook) {
    _importModule = hook;
}
export function _setDecodeHook(hook) {
    _decodeAudio = hook;
}
export function _resetImportHook() {
    _importModule = async (specifier) => _require(specifier);
    _decodeAudio = decodeAudioToSamples;
    _engine = null;
    _sherpaRecognizer?.free?.();
    _sherpaRecognizer = null;
    _sherpaRecognizerConfigKey = null;
    _parakeetMutex = Promise.resolve();
    _sherpaMutex = Promise.resolve();
}

export async function transcribeAudio(filePath) {
  const selected = await getSelectedBackend();

  if (selected === "sherpa-onnx") {
    return await transcribeWithSelectedSherpa(filePath);
  }
  if (selected === "groq") {
    return await transcribeWithSelectedGroq(filePath);
  }
  if (selected === "openai") {
    return await transcribeWithSelectedOpenAI(filePath);
  }
  // fallback
  return await transcribeWithSelectedSherpa(filePath);
}

async function transcribeWithSelectedSherpa(filePath) {
  // Try parakeet first (faster), fallback to sherpa-onnx
  try {
    const parakeetMod = await _importModule(PARAKEET_SPECIFIER);
    return await transcribeWithParakeet(filePath, parakeetMod);
  } catch (error) {
    if (!isModuleNotFoundError(error, PARAKEET_SPECIFIER)) throw error;
  }
  const sherpaConfig = resolveSherpaConfig();
  if (sherpaConfig.status === "misconfigured") throw new Error(sherpaConfig.message);
  if (sherpaConfig.status === "configured") {
    try {
      const sherpaMod = await _importModule(SHERPA_ONNX_SPECIFIER);
      return await transcribeWithSherpaOnnx(filePath, sherpaMod, sherpaConfig.config);
    } catch (error) {
      if (isModuleNotFoundError(error, SHERPA_ONNX_SPECIFIER)) {
        throw new Error(`${SHERPA_ONNX_MODEL_DIR_ENV} is set, but ${SHERPA_ONNX_SPECIFIER} is not installed.\n\nInstall it with:\n  npm install ${SHERPA_ONNX_SPECIFIER}\n\nOr unset ${SHERPA_ONNX_MODEL_DIR_ENV} to disable Sherpa-ONNX fallback.`);
      }
      throw error;
    }
  }
  // If sherpa is disabled in env, check if openai key exists as last resort
  if (process.env.OPENAI_API_KEY?.trim()) {
    return await transcribeWithOpenAI(filePath);
  }
  throw new Error(NO_BACKEND_ERROR);
}

async function transcribeWithSelectedGroq(filePath) {
  const apiKey = await getBackendApiKey("groq");
  if (!apiKey) throw new Error("Groq API key not set. Use /voice in Telegram to set it.");
  return await transcribeWithGroq(filePath, apiKey);
}

async function transcribeWithSelectedOpenAI(filePath) {
  const configKey = await getBackendApiKey("openai");
  const apiKey = configKey || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OpenAI API key not set. Use /voice in Telegram to set it.");
  return await transcribeWithOpenAI(filePath, apiKey);
}

export async function getVoiceBackendStatus() {
  const config = await readVoiceConfig();
  const selected = await getSelectedBackend();
  const backends = [];
  let warning;

  // Check parakeet
  try {
    await _importModule(PARAKEET_SPECIFIER);
    backends.push("parakeet");
  } catch {}

  // Check sherpa-onnx
  const sherpaConfig = resolveSherpaConfig();
  if (sherpaConfig.status === "configured") {
    try {
      await _importModule(SHERPA_ONNX_SPECIFIER);
      backends.push("sherpa-onnx");
    } catch {}
  } else if (sherpaConfig.status === "misconfigured") {
    warning = sherpaConfig.message;
  }

  // Check groq (always available if we have config, mark as available even without key — user can set it)
  backends.push("groq");

  // Check openai
  if (process.env.OPENAI_API_KEY?.trim() || config.openai?.apiKey) {
    backends.push("openai");
  } else {
    // Show openai as available option even without key (user can set it)
    backends.push("openai");
  }

  return { backends, warning, selected };
}

const GROQ_ALLOWED_EXTS = new Set(["flac", "mp3", "mp4", "mpeg", "mpga", "m4a", "ogg", "opus", "wav", "webm"]);

async function transcribeWithGroq(filePath, apiKey) {
  const startedAt = Date.now();
  const audioBuffer = await readFile(filePath);
  const ext = (path.extname(filePath) || ".ogg").slice(1).toLowerCase();
  // Groq validates filename extension in the multipart form — use a safe one
  const safeExt = GROQ_ALLOWED_EXTS.has(ext) ? ext : "ogg";
  const form = new FormData();
  form.append("file", new Blob([audioBuffer]), `audio.${safeExt}`);
  form.append("model", "whisper-large-v3-turbo");
  form.append("temperature", "0");
  form.append("response_format", "json");
  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });
  if (!response.ok) {
    const errorText = (await response.text().catch(() => "")).trim();
    throw new Error(`Groq transcription failed (${response.status}): ${errorText || response.statusText || "Unknown error"}`);
  }
  const payload = (await response.json());
  if (typeof payload.text !== "string") {
    throw new Error("Groq transcription response did not include a text field");
  }
  return {
    text: payload.text,
    backend: "groq",
    durationMs: Date.now() - startedAt,
  };
}

async function transcribeWithParakeet(filePath, parakeetMod) {
    const samples = await _decodeAudio(filePath);
    return withParakeetLock(async () => {
        const startedAt = Date.now();
        const engine = await getParakeetEngine(parakeetMod);
        const result = await engine.transcribe(samples);
        const text = extractTranscribedText(result);
        if (text === undefined) {
            throw new Error("parakeet-coreml returned an unsupported transcription result");
        }
        const durationMs = typeof result === "object" && result !== null && typeof result.durationMs === "number"
            ? result.durationMs
            : Date.now() - startedAt;
        return {
            text,
            backend: "parakeet",
            durationMs,
        };
    });
}

async function getParakeetEngine(parakeetMod) {
    if (_engine) return _engine;
    const mod = parakeetMod;
    const ParakeetAsrEngine = mod?.ParakeetAsrEngine ?? mod?.default?.ParakeetAsrEngine;
    if (typeof ParakeetAsrEngine !== "function") {
        throw new Error("parakeet-coreml was loaded but does not expose a ParakeetAsrEngine class");
    }
    const engine = new ParakeetAsrEngine();
    if (typeof engine.initialize !== "function") {
        throw new Error("parakeet-coreml was loaded but the engine does not expose initialize()");
    }
    if (typeof engine.transcribe !== "function") {
        throw new Error("parakeet-coreml was loaded but the engine does not expose transcribe(samples)");
    }
    await engine.initialize();
    _engine = engine;
    return _engine;
}

async function withParakeetLock(task) {
    return withMutex(task, {
        getCurrent: () => _parakeetMutex,
        setCurrent: (next) => { _parakeetMutex = next; },
    });
}

async function withSherpaLock(task) {
    return withMutex(task, {
        getCurrent: () => _sherpaMutex,
        setCurrent: (next) => { _sherpaMutex = next; },
    });
}

async function withMutex(task, controller) {
    const previous = controller.getCurrent();
    let release;
    controller.setCurrent(new Promise((resolve) => { release = resolve; }));
    await previous.catch(() => {});
    try {
        return await task();
    } finally {
        release();
    }
}

async function transcribeWithSherpaOnnx(filePath, sherpaMod, config) {
    const samples = await _decodeAudio(filePath);
    return withSherpaLock(async () => {
        const startedAt = Date.now();
        const recognizer = getSherpaRecognizer(sherpaMod, config);
        const stream = recognizer.createStream();
        try {
            stream.acceptWaveform({ sampleRate: 16000, samples });
            recognizer.decode(stream);
            const result = recognizer.getResult(stream);
            const text = extractTranscribedText(result);
            if (text === undefined) {
                throw new Error("sherpa-onnx-node returned an unsupported transcription result");
            }
            return { text, backend: "sherpa-onnx", durationMs: Date.now() - startedAt };
        } finally {
            stream.free?.();
        }
    });
}

async function transcribeWithOpenAI(filePath, apiKey) {
  const startedAt = Date.now();
  const audioBuffer = await readFile(filePath);
  const ext = (path.extname(filePath) || ".ogg").slice(1).toLowerCase();
  const mimeTypes = {
    ogg: "audio/ogg", oga: "audio/ogg", mp3: "audio/mpeg",
    m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav",
    webm: "audio/webm", flac: "audio/flac",
  };
  const mimeType = mimeTypes[ext] ?? "audio/ogg";
  const form = new FormData();
  form.append("file", new Blob([audioBuffer], { type: mimeType }), path.basename(filePath) || "audio.ogg");
  form.append("model", "whisper-1");
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });
  if (!response.ok) {
    const errorText = (await response.text().catch(() => "")).trim();
    throw new Error(`OpenAI transcription failed (${response.status}): ${errorText || response.statusText || "Unknown error"}`);
  }
  const payload = (await response.json());
  if (typeof payload.text !== "string") {
    throw new Error("OpenAI transcription response did not include a text field");
  }
  return { text: payload.text, backend: "openai", durationMs: Date.now() - startedAt };
}

function getSherpaRecognizer(sherpaMod, config) {
    const configKey = `${config.encoder}|${config.decoder}|${config.joiner}|${config.tokens}|${config.numThreads}`;
    if (_sherpaRecognizer && _sherpaRecognizerConfigKey === configKey) return _sherpaRecognizer;
    _sherpaRecognizer?.free?.();
    const OfflineRecognizer = resolveSherpaRecognizerConstructor(sherpaMod);
    if (typeof OfflineRecognizer !== "function") {
        throw new Error("sherpa-onnx-node was loaded but does not expose an OfflineRecognizer class");
    }
    _sherpaRecognizer = new OfflineRecognizer({
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: {
            transducer: { encoder: config.encoder, decoder: config.decoder, joiner: config.joiner },
            tokens: config.tokens, numThreads: config.numThreads, provider: "cpu", debug: 0, modelType: "nemo_transducer",
        },
    });
    _sherpaRecognizerConfigKey = configKey;
    return _sherpaRecognizer;
}

function resolveSherpaRecognizerConstructor(sherpaMod) {
    const mod = sherpaMod;
    return mod?.OfflineRecognizer ?? mod?.default?.OfflineRecognizer;
}

function resolveSherpaConfig() {
    const modelDirRaw = process.env[SHERPA_ONNX_MODEL_DIR_ENV]?.trim();
    if (!modelDirRaw) return { status: "disabled" };
    const modelDir = path.resolve(modelDirRaw);
    const requiredFiles = [
        ["encoder.int8.onnx", path.join(modelDir, "encoder.int8.onnx")],
        ["decoder.int8.onnx", path.join(modelDir, "decoder.int8.onnx")],
        ["joiner.int8.onnx", path.join(modelDir, "joiner.int8.onnx")],
        ["tokens.txt", path.join(modelDir, "tokens.txt")],
    ];
    const missingFiles = requiredFiles.filter(([, filePath]) => !existsSync(filePath)).map(([name]) => name);
    if (missingFiles.length > 0) {
        return {
            status: "misconfigured",
            message: `${SHERPA_ONNX_MODEL_DIR_ENV} is set to ${modelDir}, but the directory is incomplete.\n\nMissing required files:\n${missingFiles.map((name) => `  - ${name}`).join("\n")}\n\nPoint ${SHERPA_ONNX_MODEL_DIR_ENV} at an extracted Sherpa-ONNX Parakeet model directory.\nDocs: ${SHERPA_MODEL_DOCS_URL}`,
        };
    }
    return {
        status: "configured",
        config: {
            encoder: path.join(modelDir, "encoder.int8.onnx"),
            decoder: path.join(modelDir, "decoder.int8.onnx"),
            joiner: path.join(modelDir, "joiner.int8.onnx"),
            tokens: path.join(modelDir, "tokens.txt"),
            numThreads: parseSherpaThreadCount(process.env[SHERPA_ONNX_NUM_THREADS_ENV]),
        },
    };
}

function parseSherpaThreadCount(raw) {
    const trimmed = raw?.trim();
    if (!trimmed) return 2;
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 2;
}

function decodeAudioToSamples(filePath) {
    return new Promise((resolve, reject) => {
        const stdoutChunks = [];
        const stderrChunks = [];
        let settled = false;
        const ffmpeg = spawn("ffmpeg", ["-i", filePath, "-ar", "16000", "-ac", "1", "-f", "f32le", "pipe:1"], {
            stdio: ["ignore", "pipe", "pipe"],
        });
        const finish = (callback) => { if (settled) return; settled = true; callback(); };
        ffmpeg.stdout.on("data", (chunk) => { stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); });
        ffmpeg.stderr.on("data", (chunk) => { stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); });
        ffmpeg.once("error", (error) => {
            finish(() => {
                if (error.code === "ENOENT") { reject(new Error(FFMPEG_INSTALL_MESSAGE)); return; }
                reject(error);
            });
        });
        ffmpeg.once("close", (code, signal) => {
            finish(() => {
                if (code !== 0) {
                    const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
                    const reason = stderr || (signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`);
                    reject(new Error(`ffmpeg failed to decode audio: ${reason}`));
                    return;
                }
                const buffer = Buffer.concat(stdoutChunks);
                if (buffer.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
                    reject(new Error("ffmpeg returned invalid float32 PCM output"));
                    return;
                }
                const samples = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / Float32Array.BYTES_PER_ELEMENT).slice();
                resolve(samples);
            });
        });
    });
}

function extractTranscribedText(result) {
    if (typeof result === "string") return result;
    if (typeof result === "object" && result !== null && typeof result.text === "string") return result.text;
    return undefined;
}

function isModuleNotFoundError(error, specifier) {
    const code = typeof error === "object" && error !== null ? error.code : undefined;
    if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
        const message = error instanceof Error ? error.message : String(error);
        return !message || message.includes(specifier);
    }
    const message = error instanceof Error ? error.message : String(error);
    return (message.includes(`Cannot find package '${specifier}'`) ||
        message.includes(`Cannot find module '${specifier}'`) ||
        message.includes(`Cannot resolve module '${specifier}'`));
}
