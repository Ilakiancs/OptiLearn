# PolyTutor Training Pipeline

Fine-tunes Gemma 3 9B into a trauma-aware, multilingual tutor using Unsloth QLoRA on Kaggle.

---

## 1. Prerequisites

- **Kaggle account** with GPU enabled (A100 recommended — 40GB VRAM)
- **Hugging Face account** with a token that has write access
- **Two Kaggle secrets** (Add-ons → Secrets in the notebook editor):
  - `HF_TOKEN` — your HuggingFace write token
  - `HF_USERNAME` — your HuggingFace username (e.g. `ilakian`)
- **llama.cpp cloned locally** for `04_export.py`:
  ```
  git clone https://github.com/ggerganov/llama.cpp
  ```

---

## 2. Running on Kaggle (step by step)

1. Upload `training/kaggle_notebook.ipynb` to a new Kaggle notebook
2. Enable **GPU accelerator** in notebook settings (Accelerator → GPU T4 x2 or P100, or enable A100 if available)
3. Add `HF_TOKEN` and `HF_USERNAME` to **Kaggle Secrets** (Add-ons → Secrets)
4. Upload the full repo or at minimum the `training/` directory as a dataset attached to the notebook
5. Run all cells in order
6. **Expected total runtime: ~3.5 hours** on A100

What each cell does:
- Cell 1: Install dependencies
- Cell 2: Verify GPU is available
- Cell 3: Generate the 11,500+ example training dataset
- Cell 4: Fine-tune Gemma 3 9B with QLoRA (~3 hours)
- Cell 5: Benchmark base vs fine-tuned on 60 held-out examples
- Cell 6: Display the benchmark report
- Cell 7: Publish the report to Hugging Face alongside the weights

---

## 3. Running locally after Kaggle

After Kaggle training completes:

1. **Download** `training/outputs/polytutor-weights/` from the Kaggle output panel
2. Place it at `training/outputs/polytutor-weights/` in this repo
3. **Clone llama.cpp** (if not already done):
   ```
   git clone https://github.com/ggerganov/llama.cpp
   ```
4. **Run the export script**:
   ```
   python training/04_export.py
   ```
   This converts the weights to GGUF (q4_K_M quantization) and registers the model with Ollama.
5. **Verify Ollama registration**:
   ```
   ollama list
   ```
   You should see `polytutor-gemma3` in the list.

---

## 4. Switching the app to use the fine-tuned model

Once the model is registered with Ollama:

1. Open `polytutor/.env`
2. Set:
   ```
   USE_LOCAL_OLLAMA=true
   OLLAMA_MODEL=polytutor-gemma3
   ```
3. Restart the server:
   ```
   ./scripts/start.sh
   ```

The app will now use the local fine-tuned model instead of the Gemini API.

---

## 5. Troubleshooting

| Problem | Fix |
|---|---|
| OOM error on A100 during training | Reduce `per_device_train_batch_size` to `1` in `02_finetune.py` |
| GGUF conversion fails | Ensure `llama.cpp` is cloned and your Python version matches (3.10+) |
| Ollama model not found | Re-run: `ollama create polytutor-gemma3 -f Modelfile` |
| `langdetect` import error during eval | Run: `pip install langdetect` |
| HuggingFace push fails | Check `HF_TOKEN` has write permissions; try logging in via `huggingface-cli login` |
| Training loss stuck | Check that `combined_train.jsonl` was generated correctly and has 11,500+ examples |

---

## Dataset structure

| File | Description |
|---|---|
| `dataset/khan_academy.jsonl` | 8,000 Socratic tutoring dialogues across math, literacy, science |
| `dataset/unhcr_pedagogy.jsonl` | 500 trauma-informed classroom scenarios |
| `dataset/multilingual_qa.jsonl` | 3,000 multilingual examples (Arabic, French, Swahili, Somali, Amharic, Tigrinya, Dinka, Hausa) |
| `dataset/combined_train.jsonl` | Merged and shuffled training set |
| `dataset/eval_set.jsonl` | 60 held-out evaluation examples |

All examples use the ChatML format required by Gemma 3's chat template.
