# Training Data

## Real tutoring conversations

These are genuine student–tutor exchanges, not synthetically generated.

| File | Examples | Avg turns | Max turns |
|---|---|---|---|
| `optilearn_sft_train.jsonl` | 2,109 | 8.9 | 44 |
| `optilearn_sft_eval.jsonl` | 60 | — | — |

**Why these matter:** Real students write differently from template-filled synthetic examples. They code-switch, express frustration, go off-topic, and ask follow-up questions that depend on previous answers. A model trained on this data learns to handle genuine tutoring dynamics, not surface patterns.

Sample exchanges from the training set:

```
student: HIII!!! sorry to bother u again but I'm kind of stuck on this question
tutor:   Can you write that as a fraction for me?
```

```
student: I don't know why I even try. I always fail.
tutor:   I'm really glad you told me. Learning while going through difficult
         times is one of the hardest things a person can do...
```

```
student: derivatives in trigonometry
tutor:   Alright! Let's begin with the first problem.
         Problem 1: Compute the derivative of y = sin(x).
student: cos(x)
tutor:   That's right! Now, can you tell me why?
         [... 38 more turns]
```

## Format

Every example is a JSONL line with a `messages` array in ChatML format:

```json
{
  "messages": [
    {"role": "system",    "content": "You are OptiLearn, a warm and patient AI tutor..."},
    {"role": "user",      "content": "I don't understand fractions."},
    {"role": "assistant", "content": "Let's figure it out together. If you cut a ..."},
    {"role": "user",      "content": "oh ok so the bottom number is how many pieces?"},
    {"role": "assistant", "content": "Exactly. What do you think the top number means?"}
  ]
}
```

Compatible with Gemma 4's chat template via Unsloth's `get_chat_template(tokenizer, "gemma-4")`.

## Synthetic dataset

The larger synthetic dataset (11,500+ examples) is not committed — it is generated on demand by running `01_prepare_dataset.py` from the repo root. It covers math, literacy, and science topics across 8 languages. See `FINDINGS.md` for why the synthetic data underperformed relative to the base model.
