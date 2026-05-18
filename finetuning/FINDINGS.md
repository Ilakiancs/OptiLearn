# Fine-Tuning Benchmark Findings

## Setup

| | |
|---|---|
| Base model | `unsloth/gemma-4-9b-it` |
| Method | QLoRA (r=16, alpha=32, NF4 4-bit quantization) |
| Target modules | q_proj, k_proj, v_proj, o_proj, gate_proj, up_proj, down_proj |
| Training data | 11,500+ synthetic examples (3 sources — see below) |
| Epochs | 2 |
| Learning rate | 2e-4 (linear schedule, 50 warmup steps) |
| Batch size | 2 per device, 8 gradient accumulation steps (effective batch = 16) |
| Hardware | Kaggle A100 40GB |
| Training time | ~3 hours |
| Evaluation set | 60 held-out examples |

---

## Evaluation Dimensions

Three dimensions scored automatically on the 60 held-out examples:

**Socratic quality (1–5)**
Does the response guide rather than give direct answers? Scored by: presence of a trailing question, absence of direct-answer phrases ("the answer is", "it equals"), presence of analogy/imagination language.

**Language compliance (1–5)**
Is the response in the student's requested language? Scored via `langdetect`. 5 = match, 3 = uncertain, 1 = English when another language was expected.

**Trauma-aware tone (1–5)**
Does the response avoid shame language? Scored against a blocklist: "wrong", "incorrect", "failed", "mistake", "that's not right", "you should know".

---

## Results

| Dimension | Base Gemma 4 | Fine-tuned | Delta |
|---|---|---|---|
| Socratic quality | 4.2 / 5 | 3.8 / 5 | −0.4 |
| Language compliance | 4.8 / 5 | 4.6 / 5 | −0.2 |
| Trauma-aware tone | 4.9 / 5 | 4.7 / 5 | −0.2 |
| **Overall** | **4.6 / 5** | **4.4 / 5** | **−0.2** |

The base model outperformed the fine-tuned variant on every dimension.

---

## Why the fine-tune underperformed

**The training data was synthetic and low-diversity.**

`01_prepare_dataset.py` generates examples by filling templates:
```
user:  "I don't understand {topic}."
asst:  "That's a great question. Think of it like {analogy}. {checking_question}"
```

Every example follows the same skeleton. After 11,500 of these, the model learns to produce that skeleton on demand — but loses the flexible, contextual judgment that Gemma 4 already has from its base training.

The base model's instruction-tuning included far more diverse tutoring-style interactions than our synthetic set could replicate. When fine-tuning reduces diversity, it narrows the model's behaviour rather than improving it.

This is consistent with published findings on SFT for instruction-following tasks: high-quality, diverse data matters more than volume, and fine-tuning on low-diversity synthetic data degrades general instruction-following quality (Lima, 2023; Self-play fine-tuning, 2024).

---

## What would change the outcome

The `data/` folder contains 2,109 **real** multi-turn tutoring conversations — genuine exchanges with real student language, real confusion, real emotional moments. Average 9 turns per conversation, up to 44 turns. This is qualitatively different from the synthetic data.

A fine-tuning run on the real data alone — or real data combined with LLM-generated high-diversity conversations — is the next logical experiment. The pipeline is fully in place; the bottleneck is data quality, not infrastructure.

---

## Deployment decision

OptiLearn currently uses **base Gemma 4 via Ollama** with a carefully engineered system prompt (`OPTILEARN_26B_SYSTEM_PROMPT` in `optilearn/app/core/prompts.py`).

The prompt encodes the same constraints the fine-tuning was attempting to teach:
- Socratic guidance over direct answers
- Trauma-aware vocabulary exclusions
- Language-matching instruction
- 3–5 sentence response length with a checking question

This approach scores 4.6/5 on our evaluation rubric. The fine-tuned model scored 4.4/5. We shipped the better result.
