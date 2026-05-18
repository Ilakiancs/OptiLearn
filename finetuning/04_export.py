"""
04_export.py
Convert fine-tuned PolyTutor weights to GGUF and register with Ollama.
Run locally after downloading weights from HuggingFace or Kaggle output.
"""

import shutil
import subprocess
import sys
from pathlib import Path

WEIGHTS_PATH = "finetuning/outputs/polytutor-weights"
GGUF_PATH = "finetuning/outputs/polytutor-gemma4-q4_K_M.gguf"
MODELS_DIR = "models"
MODELS_GGUF = f"{MODELS_DIR}/polytutor-gemma4-q4_K_M.gguf"
LLAMA_CPP_SCRIPT = "llama.cpp/convert_hf_to_gguf.py"
OLLAMA_MODEL_NAME = "polytutor-gemma4"
MODELFILE_PATH = "finetuning/Modelfile"


def check_llama_cpp():
    if not Path(LLAMA_CPP_SCRIPT).exists():
        print("ERROR: llama.cpp conversion script not found.")
        print("Clone llama.cpp first: git clone https://github.com/ggerganov/llama.cpp")
        sys.exit(1)
    print(f"  Found: {LLAMA_CPP_SCRIPT}")


def convert_to_gguf():
    print("\nStep 2 — Converting to GGUF (q4_K_M quantization)...")
    subprocess.run(
        [
            "python", LLAMA_CPP_SCRIPT,
            WEIGHTS_PATH,
            "--outfile", GGUF_PATH,
            "--outtype", "q4_K_M",
        ],
        check=True,
    )


def verify_gguf():
    print("\nStep 3 — Verifying GGUF output...")
    gguf = Path(GGUF_PATH)
    if not gguf.exists():
        print(f"ERROR: GGUF file not found at {GGUF_PATH}")
        sys.exit(1)

    size_bytes = gguf.stat().st_size
    size_gb = size_bytes / 1e9

    if size_gb < 4.0:
        print(f"ERROR: GGUF file is {size_gb:.2f}GB — expected > 4GB. Conversion may have failed.")
        sys.exit(1)

    print(f"  GGUF created: {size_gb:.2f}GB")


def copy_to_models():
    print(f"\nStep 4 — Copying GGUF to {MODELS_DIR}/...")
    Path(MODELS_DIR).mkdir(exist_ok=True)
    shutil.copy(GGUF_PATH, MODELS_GGUF)
    print(f"  Copied to: {MODELS_GGUF}")


def register_ollama():
    print(f"\nStep 5 — Registering with Ollama as '{OLLAMA_MODEL_NAME}'...")
    subprocess.run(
        ["ollama", "create", OLLAMA_MODEL_NAME, "-f", MODELFILE_PATH],
        check=True,
    )
    print(f"  Registered: {OLLAMA_MODEL_NAME}")


def smoke_test():
    print("\nStep 6 — Running smoke test...")
    try:
        result = subprocess.run(
            [
                "ollama", "run", OLLAMA_MODEL_NAME,
                "Hello. Can you help me understand what a fraction is?",
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
    except subprocess.TimeoutExpired:
        print("WARNING: Smoke test timed out after 120s. Check Ollama manually.")
        return

    response = result.stdout.strip()
    print(f"\n  Model response:\n  {response}\n")

    if "?" in response:
        print("  Smoke test PASSED — response is Socratic (contains a question).")
    else:
        print(
            "  Smoke test WARNING — response may not be Socratic. Review manually."
        )


def print_next_steps():
    print("\n" + "=" * 60)
    print("Model registered as polytutor-gemma4 in Ollama.")
    print("To switch from Gemini API to local model:")
    print("  1. Set USE_LOCAL_OLLAMA=true in .env")
    print("  2. Set OLLAMA_MODEL=polytutor-gemma4 in .env")
    print("  3. Restart the server: ./scripts/start.sh")
    print("=" * 60)


def main():
    print("=" * 60)
    print("04_export.py — GGUF conversion and Ollama registration")
    print("=" * 60)

    print("\nStep 1 — Checking for llama.cpp...")
    check_llama_cpp()

    convert_to_gguf()
    verify_gguf()
    copy_to_models()
    register_ollama()
    smoke_test()
    print_next_steps()


if __name__ == "__main__":
    main()
