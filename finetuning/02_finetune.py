"""
02_finetune.py
QLoRA fine-tuning of Gemma 4 9B using Unsloth.
Designed to run on Kaggle A100 (40GB VRAM).
"""

import json
import os
import time
from datetime import datetime
from pathlib import Path

import torch
from datasets import load_dataset
from trl import SFTTrainer
from transformers import TrainingArguments
from unsloth import FastLanguageModel
from unsloth.chat_templates import get_chat_template

HF_TOKEN = os.environ["HF_TOKEN"]
HF_USERNAME = os.environ["HF_USERNAME"]

DATASET_PATH = "finetuning/dataset/combined_train.jsonl"
OUTPUT_DIR = "finetuning/outputs/polytutor-weights"
LORA_DIR = "finetuning/outputs/polytutor-lora"
CHECKPOINT_DIR = "finetuning/outputs/checkpoints"
LOG_PATH = "finetuning/outputs/training_log.jsonl"

Path(OUTPUT_DIR).mkdir(parents=True, exist_ok=True)
Path(LORA_DIR).mkdir(parents=True, exist_ok=True)
Path(CHECKPOINT_DIR).mkdir(parents=True, exist_ok=True)

# ──────────────────────────────────────────────────────────────────────────────
# Model loading
# ──────────────────────────────────────────────────────────────────────────────

print("=" * 60)
print("Loading model: unsloth/gemma-4-9b-it")
print("=" * 60)

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="unsloth/gemma-4-9b-it",
    max_seq_length=2048,
    dtype=None,        # auto-detect
    load_in_4bit=True, # NF4 quantization
)

# ──────────────────────────────────────────────────────────────────────────────
# LoRA configuration
# ──────────────────────────────────────────────────────────────────────────────

print("\nApplying LoRA adapters...")

model = FastLanguageModel.get_peft_model(
    model,
    r=16,
    target_modules=[
        "q_proj", "k_proj", "v_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj",
    ],
    lora_alpha=32,
    lora_dropout=0,          # Unsloth optimised — keep at 0
    bias="none",
    use_gradient_checkpointing="unsloth",
    random_state=42,
    use_rslora=False,
    loftq_config=None,
)

# ──────────────────────────────────────────────────────────────────────────────
# Dataset loading and formatting
# ──────────────────────────────────────────────────────────────────────────────

print("\nLoading and formatting dataset...")

tokenizer = get_chat_template(tokenizer, chat_template="gemma-4")

raw_dataset = load_dataset("json", data_files=DATASET_PATH, split="train")
print(f"  Raw examples loaded: {len(raw_dataset)}")


def format_example(example: dict) -> dict:
    text = tokenizer.apply_chat_template(
        example["messages"],
        tokenize=False,
        add_generation_prompt=False,
    )
    return {"text": text}


formatted_dataset = raw_dataset.map(format_example, remove_columns=raw_dataset.column_names)

# Filter examples exceeding 2048 tokens
def is_within_limit(example: dict) -> bool:
    tokens = tokenizer(example["text"], return_length=True)["length"][0]
    return tokens <= 2048


before_count = len(formatted_dataset)
formatted_dataset = formatted_dataset.filter(is_within_limit)
after_count = len(formatted_dataset)
filtered_count = before_count - after_count

print(f"  Examples filtered (> 2048 tokens): {filtered_count}")
print(f"  Final training examples: {after_count}")

# ──────────────────────────────────────────────────────────────────────────────
# GPU memory stats
# ──────────────────────────────────────────────────────────────────────────────

print("\nGPU memory before training:")
print(torch.cuda.memory_summary(abbreviated=True))

# ──────────────────────────────────────────────────────────────────────────────
# Training configuration
# ──────────────────────────────────────────────────────────────────────────────

print("\nConfiguring trainer...")


from transformers import TrainerCallback


class JsonlLoggerCallback(TrainerCallback):
    def __init__(self, log_path: str):
        self.log_path = log_path
        self.log_file = open(log_path, "w", encoding="utf-8")

    def on_log(self, args, state, control, logs=None, **kwargs):
        if logs is not None:
            entry = {
                "step": state.global_step,
                "loss": logs.get("loss"),
                "learning_rate": logs.get("learning_rate"),
                "epoch": logs.get("epoch"),
                "timestamp": datetime.utcnow().isoformat(),
            }
            self.log_file.write(json.dumps(entry) + "\n")
            self.log_file.flush()

    def on_train_end(self, args, state, control, **kwargs):
        self.log_file.close()


trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=formatted_dataset,
    dataset_text_field="text",
    max_seq_length=2048,
    dataset_num_proc=2,
    packing=False,
    args=TrainingArguments(
        per_device_train_batch_size=2,
        gradient_accumulation_steps=8,   # effective batch = 16
        warmup_steps=50,
        num_train_epochs=2,
        learning_rate=2e-4,
        fp16=not torch.cuda.is_bf16_supported(),
        bf16=torch.cuda.is_bf16_supported(),
        logging_steps=10,
        optim="adamw_8bit",
        weight_decay=0.01,
        lr_scheduler_type="linear",
        seed=42,
        output_dir=CHECKPOINT_DIR,
        report_to="none",
    ),
    callbacks=[JsonlLoggerCallback(LOG_PATH)],
)

# ──────────────────────────────────────────────────────────────────────────────
# Training
# ──────────────────────────────────────────────────────────────────────────────

print("\nStarting training...")
start_time = time.time()
trainer.train()
elapsed_minutes = (time.time() - start_time) / 60
print(f"\nTraining complete. Total time: {elapsed_minutes:.1f} minutes")

# ──────────────────────────────────────────────────────────────────────────────
# Save weights
# ──────────────────────────────────────────────────────────────────────────────

print("\nSaving model weights...")

model.save_pretrained(OUTPUT_DIR)
tokenizer.save_pretrained(OUTPUT_DIR)
print(f"  HuggingFace format saved to: {OUTPUT_DIR}")

model.save_pretrained_merged(
    LORA_DIR,
    tokenizer,
    save_method="lora",
)
print(f"  LoRA adapter saved to: {LORA_DIR}")

# ──────────────────────────────────────────────────────────────────────────────
# Push to Hugging Face Hub
# ──────────────────────────────────────────────────────────────────────────────

repo_id = f"{HF_USERNAME}/polytutor-gemma4-9b"
print(f"\nPushing to Hugging Face Hub: {repo_id}")

model.push_to_hub(repo_id, token=HF_TOKEN)
tokenizer.push_to_hub(repo_id, token=HF_TOKEN)

print(f"\nModel published at: https://huggingface.co/{repo_id}")
print("Fine-tuning complete.")
