# 👉 This is where the AI model file goes 👈

**You are in `backend/models/`. This folder is intentionally empty except for this
README.** The actual model file (several GB) is NOT shipped with the repo — you
download it once, into THIS folder. Then DSOS's built-in AI works offline, no
Ollama, no other server needed.

## Easiest path: run the download script (one command)

From the **project root** (`dsos/`), run the script for your OS. It downloads the
default model straight into this folder for you:

```powershell
# Windows
pwsh backend/scripts/download-model.ps1
```
```bash
# macOS / Linux
bash backend/scripts/download-model.sh
```

That's it. Skip to step 3 below. The rest of this file is for doing it manually or
choosing a different model.

---

## Manual path

1. **Install the inference engine** (one-time, ~50 MB binary):
   ```powershell
   npm --prefix backend install node-llama-cpp
   ```

2. **Download a GGUF model into THIS folder** (`backend/models/`). Good options:

   | Model | Size | Best for | URL |
   |---|---|---|---|
   | Qwen 2.5 7B Instruct (Q4_K_M) | 4.7 GB | Tool use + reasoning, multilingual | `huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF` |
   | MythoMax-L2-13B (Q4_K_M) | 7.9 GB | Roleplay + character personality (DSOS default) | `huggingface.co/TheBloke/MythoMax-L2-13B-GGUF` |
   | Llama 3.1 8B Instruct (Q4_K_M) | 4.9 GB | General-purpose, tool use | `huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF` |
   | Hermes 3 Llama 3.1 8B (Q4_K_M) | 4.9 GB | Function calling + reasoning | `huggingface.co/NousResearch/Hermes-3-Llama-3.1-8B-GGUF` |

   The file must end in `.gguf` and live directly in this folder — e.g.
   `backend/models/mythomax-l2-13b.Q4_K_M.gguf`.

3. **In Shadow → Settings, set backend = "builtin"** (or leave it on "auto" — it
   prefers the built-in model over Ollama once a `.gguf` is in this folder).

4. On the first chat after switching, DSOS loads the model into memory (5–30s
   depending on hardware and model size). Every chat after that is fast.

## Auto-discovery

If multiple `.gguf` files are present, DSOS picks the **smallest** one by default (assumes smaller = faster on the user's hardware). Override by setting `builtinModelPath` in the Oracle settings UI to an absolute path.

## GPU acceleration

`node-llama-cpp` auto-detects and uses:
- **CUDA** on NVIDIA Windows/Linux
- **Metal** on Apple Silicon Mac
- **Vulkan** as a cross-vendor fallback
- **CPU** if no GPU is available (much slower but works)

No configuration needed. To verify GPU is being used, watch the backend log on first model load — it'll print `Using GPU` or `Using CPU`.

## Why use this instead of Ollama?

- **No external service.** Inference runs inside the DSOS Express process. One thing to start.
- **Bundleable.** Ships with DSOS — you can package a full Electron app with this folder and a model inside.
- **Drop-and-go.** Users can swap models by replacing the file, no `ollama pull`, no terminal commands.

## Why use Ollama instead?

- **Model ecosystem.** Ollama has a curated registry; `ollama pull qwen2.5:7b` is one command.
- **Memory efficiency.** Ollama can serve multiple apps sharing one model load.
- **Easier model switching at runtime.** Multiple models can be hot-swapped without restarting DSOS.

Both backends are supported — Oracle's `auto` mode will pick whichever is available.

## License reminders

Most GGUF models inherit a license from their base model. Check before redistributing in a paid product:
- **Llama 2 / 3.x derivatives** (MythoMax, Mythalion, Llama Instruct, Hermes, etc.): Meta Llama Community License. Commercial use allowed if you have under 700M MAU, must include the license text in redistribution.
- **Qwen 2.x**: Apache 2.0 (Qwen 2 / Qwen 2.5 7B+). Tongyi Qianwen License Agreement for the smaller variants.
- **Mistral**: Apache 2.0 for the 7B and smaller; Mistral AI Research License for newer/larger.

**Bundling a model inside a paid DSOS distribution requires you to include the model's license file alongside it.** Easiest path: ship without bundling and have DSOS auto-download on first run (the user is then the licensee).
