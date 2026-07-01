# Scientific-modality worker — optional self-hosting after license review

This plug-in translates uploaded **scientific files** (protein sequence / protein 3D structure /
molecule / single-cell) into natural-language evidence using an operator-managed
native-to-text expert provider. It is optional and decoupled: when it is not running, Model Router
falls back to readable raw file text where safe (see *When the server is down*).

Commercial builds do not bundle model weights, do not auto-start this provider, and do not ship a
default expert connection. Use this document only after independently verifying that every selected
model, dependency, and deployment mode is allowed for your commercial use case.

## Where things run

```
  Operator-managed service                  Local machine                    Provider cloud / remote
  ─────────────────────────                 ─────────────                    ─────
  expert-translator        :8001  ┐── provider (licensed text-output models, lazy)
  sci-modality module      :3898  ┘── ServiceResult HTTP API  <—— SSH tunnel ——  SciForge app
                                                                                 model-router ──> configured text provider
                                                                                              └─> configured vision provider
```

- The **operator-managed service** runs only the experts + this module. It can be shut down anytime.
- The **app + Model Router** run on the local machine; text, vision, and other LLM/API traffic still
  go through Model Router. Only scientific-file translation needs this optional worker.

## One-time setup (operator-managed service)

1. **Python env** (CUDA-enabled), e.g. `conda create -n serve python=3.10 && conda activate serve`.
2. Install a CUDA torch build, then the provider deps:
   ```bash
   pip install torch --index-url https://download.pytorch.org/whl/cu121
   pip install -r provider/requirements.txt
   ```
3. Place reviewed, licensed model weights outside the repository and set
   `EXPERT_MODEL_DIR` / `PROT2TEXT_MODEL_DIR` to those absolute paths. Do not commit, package,
   or publish the weights from this repo. BioT5+-style molecule providers need `pip install selfies`
   (SMILES→SELFIES).
4. **Prot2Text micro-service (`protein_structure`)** runs in its own conda env because its graph
   pipeline pulls invasive deps; keep it out of the main `serve` env:
   ```bash
   conda create -y -n p2t --clone serve
   /root/miniconda3/envs/p2t/bin/pip install graphein         # graph construction
   apt-get install -y dssp                                     # provides /usr/bin/mkdssp (secondary structure)
   ```
   Prot2Text ships old custom modeling code: `provider/start_prot2text.sh` patches its
   `transformers.deepspeed` import, seeds the `transformers_modules` cache with its `.py` files, and
   monkeypatches the AlphaFold downloader to consume the request's raw PDB (the box has no internet).
5. `npm install` once at the repo root so this module's `tsx` runtime is available.

## Start / stop / verify

```bash
cd packages/workers/sci-modality-router
export SCIFORGE_ENABLE_LOCAL_EXPERT_PROVIDER=1
export EXPERT_MODEL_DIR=/absolute/path/to/licensed/expert-models
export PROT2TEXT_MODEL_DIR=/absolute/path/to/licensed/prot2text-checkpoint
bash deploy/start.sh                # idempotent; brings up experts(:8001) + module(:3898)
bash provider/start_prot2text.sh &  # protein_structure micro-service on :8002 (p2t env)
bash deploy/verify.sh               # no-cheat check: real fingerprints + input-dependent generated text
bash deploy/stop.sh                 # frees the GPUs
```

Required license-gated env: `SCIFORGE_ENABLE_LOCAL_EXPERT_PROVIDER=1`, `EXPERT_MODEL_DIR`, and
`PROT2TEXT_MODEL_DIR` for the structure micro-service.

Useful env overrides: `PYTHON`, `EXPERT_DEVICE` (default `cuda:0`),
`C2S_DEVICE` (default `cuda:1`; C2S-Scale-27B ~54GB gets its own GPU), `HF_ENDPOINT`
(default `https://hf-mirror.com`). Experts load lazily on first request, so startup is instant
and only the modalities you actually use consume VRAM. `protein_structure` is served by the
separate `start_prot2text.sh` process (`PROT2TEXT_DEVICE`, default GPU1).

For unattended service management, keep the same license-gated environment in your process manager.

## Connect Model Router

```bash
# 1) tunnel the module port to your machine:
ssh -p <port> -N -L 3898:127.0.0.1:3898 <user>@<server>
# 2) point the Model Router sidecar/CLI at it; it will generate `translators.scientific`:
export SCIFORGE_SCIMODALITY_SERVICE_URL=http://127.0.0.1:3898
export SCIFORGE_SCIMODALITY_SERVICE_TOKEN=<same-token-as-SCIMODALITY_ROUTER_RUNTIME_TOKEN>
```

Check the worker directly from the Model Router host:
`curl -H "Authorization: Bearer $SCIFORGE_SCIMODALITY_SERVICE_TOKEN" http://127.0.0.1:3898/experts/status`
lists each expert's online state and device.

## When the server is down (graceful, no errors)

If the optional service is off (or the private connection is down), Model Router fails open and
**falls back to readable raw file text where safe**. The turn still completes, and GUI/local runtime/Codex/Claude
do not call this service directly. Other model traffic is unaffected.

## Troubleshooting

- **Reloading after editing the module/provider**: kill the OLD process by PID first (it holds the
  port; a restart that races it dies with `EADDRINUSE` and the old code keeps serving). Verify a
  reload by hitting a changed behavior, not just `/health`. Free a port with `fuser -k 3898/tcp`.
  Never `pkill -f <token>` where the token also appears in your SSH command line — it kills your
  own shell.
- **GPU out of memory**: experts load lazily, so only loaded modalities use VRAM; move experts to
  a freer `EXPERT_DEVICE`, or restart the provider to evict models you are not using.
- **An expert shows offline in `/experts/status`**: check `deploy/run/experts.log` (and the
  prot2text micro-service log for `protein_structure`); usually a missing model download or VRAM pressure.
