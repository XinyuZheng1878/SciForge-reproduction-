# Scientific-modality plug-in — GPU server deployment

This plug-in translates uploaded **scientific files** (protein / nucleotide / molecule /
single-cell / spatial / spectrometry) into natural-language evidence using **real expert models on
a GPU**. It is optional and decoupled: when it is not running, the app simply reads the raw file
text instead — no errors (see *When the server is down*).

## Where things run

```
  GPU server (this plug-in)                 Local machine                    Cloud
  ─────────────────────────                 ─────────────                    ─────
  ChemLLM-7B (vLLM)        :8000  ┐
  expert-translator        :8001  ┤── provider (real GPU models)
  sci-modality module      :3898  ┘── ServiceResult HTTP API  <—— SSH tunnel ——  SciForge app
                                                                                 model-router ──> DeepSeek (text)
                                                                                              └─> Qwen3.7-Plus (vision)
```

- The **GPU server** runs only the experts + this module. It can be shut down anytime.
- The **app + model-router** run on the local machine; **DeepSeek (text)** and **Qwen3.7-Plus
  (vision)** are cloud endpoints — so **text and image still work even when the GPU server is off**;
  only scientific-file translation needs this plug-in.

## One-time setup (on the GPU server)

1. **Python env** (CUDA-enabled), e.g. `conda create -n serve python=3.10 && conda activate serve`.
2. Install a CUDA torch build, then the provider deps:
   ```bash
   pip install torch --index-url https://download.pytorch.org/whl/cu121
   pip install -r provider/requirements.txt
   # for the molecule expert only:
   pip install vllm
   ```
3. **Download the models** (HuggingFace ids; cache or download into `$EXPERT_MODEL_DIR`):
   - protein  `facebook/esm2_t12_35M_UR50D`
   - nucleotide `InstaDeepAI/nucleotide-transformer-v2-50m-multi-species`
   - single-cell / spatial `allenai/scibert_scivocab_uncased`
   - spectrometry `seyonec/ChemBERTa-zinc-base-v1` (or your ChemBERTa-77M checkpoint)
   - molecule `AI4Chem/ChemLLM-7B-Chat` (served by vLLM)
4. `npm install` once at the repo root so this module's `tsx` runtime is available.

## Start / stop / verify

```bash
cd plugins/sci-modality-router-service
bash deploy/start.sh      # idempotent; brings up chemllm(:8000) + experts(:8001) + module(:3898)
bash deploy/verify.sh     # 18-assertion no-cheat check across all six modalities (real GPU numbers)
bash deploy/stop.sh       # frees the GPUs
```

Useful env overrides: `PYTHON`, `EXPERT_MODEL_DIR`, `CHEMLLM_MODEL_DIR`, `EXPERT_DEVICE` (default
`cuda:1`), `SKIP_CHEMLLM=1` (skip the molecule expert if you don't need it / are tight on VRAM).

**Run it when the server boots** — just re-run `bash deploy/start.sh` (it skips anything already up).
To make it automatic, add that line to a `@reboot` cron entry or a systemd unit.

## Connect Model Router

```bash
# 1) tunnel the module port to your machine:
ssh -p <port> -N -L 3898:127.0.0.1:3898 <user>@<server>
# 2) point the Model Router process at it:
export SCIFORGE_SCIMODALITY_SERVICE_URL=http://127.0.0.1:3898
```

Check it from the Model Router host: `curl http://127.0.0.1:3898/experts/status` lists each expert's
online state and device.

## When the server is down (graceful, no errors)

If the GPU server is off (or the tunnel is down), Model Router fails open and **falls back to
readable raw file text where safe**. The turn still completes, and GUI/Kun/Codex do not call this
service directly. Text chat and image (Qwen) are unaffected. Nothing to do — bring the server back
up and re-run `deploy/start.sh` to restore experts.

## Troubleshooting

- **Reloading after editing the module/provider**: kill the OLD process by PID first (it holds the
  port; a restart that races it dies with `EADDRINUSE` and the old code keeps serving). Verify a
  reload by hitting a changed behavior, not just `/health`. Free a port with `fuser -k 3898/tcp`.
  Never `pkill -f <token>` where the token also appears in your SSH command line — it kills your
  own shell.
- **GPU out of memory**: lower `CHEMLLM_GPU_MEM_UTIL`, or `SKIP_CHEMLLM=1`, or put experts on a
  different `EXPERT_DEVICE`.
- **An expert shows offline in `/experts/status`**: check `deploy/run/experts.log` /
  `deploy/run/chemllm.log`; usually a missing model download or VRAM pressure.
