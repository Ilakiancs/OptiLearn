"""
01_prepare_dataset.py
Builds the PolyTutor training dataset from three synthetic sources.
Outputs JSONL files to finetuning/dataset/.
Deterministic: seeded with 42.
"""

import json
import os
import random
import sys
from pathlib import Path

random.seed(42)

DATASET_DIR = Path("finetuning/dataset")
DATASET_DIR.mkdir(parents=True, exist_ok=True)

SYSTEM_PROMPT = (
    "You are a patient, encouraging tutor working with displaced children in "
    "a refugee camp classroom. You respond only in the student's language. "
    "You never give direct answers — you guide with questions and analogies. "
    "You never use the words wrong, incorrect, failed, or mistake. "
    "When a student struggles, you try a different explanation. "
    "You keep responses to 3-5 sentences. After explaining, you ask "
    "a checking question to confirm understanding."
)


def make_example(system: str, user: str, assistant: str) -> dict:
    return {
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
            {"role": "assistant", "content": assistant},
        ]
    }


def validate_example(example: dict, idx: int):
    msgs = example.get("messages")
    if not isinstance(msgs, list) or len(msgs) != 3:
        raise ValueError(f"Example {idx}: 'messages' must be a list of 3 items. Got: {example}")
    roles = [m.get("role") for m in msgs]
    if roles != ["system", "user", "assistant"]:
        raise ValueError(f"Example {idx}: roles must be [system, user, assistant]. Got: {roles}")
    for m in msgs:
        if not isinstance(m.get("content"), str) or not m["content"].strip():
            raise ValueError(f"Example {idx}: all content fields must be non-empty strings.")


# ──────────────────────────────────────────────────────────────────────────────
# SOURCE 1 — Khan Academy style (8,000 examples)
# ──────────────────────────────────────────────────────────────────────────────

CONFUSION_TYPES = [
    "I don't understand {topic}.",
    "Is {topic} the same as {related}?",
    "My answer was {wrong_ans}, why is that not right?",
    "Can you explain {topic} differently?",
    "I keep getting confused about {topic}.",
    "I tried to do {topic} but I got stuck.",
    "What even is {topic}? I don't get it.",
    "My teacher said {topic} but I'm not sure what that means.",
    "How do you do {topic}?",
    "Why do we need {topic}?",
    "I thought {topic} meant {misunderstanding}, but I'm not sure.",
    "Can you show me {topic} with an example?",
    "I wrote {wrong_ans} for {topic}. Is that close?",
    "What's the difference between {topic} and {related}?",
    "I don't know how to start with {topic}.",
]

SOCRATIC_STYLES = [
    "analogy",
    "real_world",
    "step_by_step",
    "visual",
    "counter_question",
]

ANALOGY_INTROS = [
    "Think of it like {analogy}.",
    "Imagine {analogy} — it works the same way.",
    "It's a bit like {analogy}.",
    "Have you ever seen {analogy}? This is similar.",
    "Let's use {analogy} as an example.",
]

CHECKING_QUESTIONS = [
    "Can you try telling me what {topic} means in your own words?",
    "What do you think would happen if {scenario}?",
    "Can you give me one example of {topic}?",
    "If I gave you {example_input}, what would you do first?",
    "Does that make sense so far? Can you explain it back to me?",
    "What's one thing you remember about {topic} now?",
    "Can you try the next step on your own?",
    "How would you explain {topic} to a friend?",
]

ENCOURAGE_PHRASES = [
    "That's a great question.",
    "I'm glad you asked.",
    "Let's figure this out together.",
    "You're thinking about this the right way.",
    "Good noticing.",
    "That curiosity will help you a lot.",
    "Let's take it one step at a time.",
]

SUBJECT_SPECS = [
    {
        "subject": "math_counting",
        "label": "Math — counting and number sense",
        "grade": "grade 1-2",
        "count": 800,
        "topics": ["counting to 10", "counting to 20", "number order", "more and less",
                   "skip counting", "number before and after", "even and odd numbers"],
        "analogies": ["counting apples in a basket", "steps on a staircase",
                      "beads on a string", "fingers on your hand"],
        "scenarios": ["you have 3 apples and get 2 more", "you count backwards from 5"],
    },
    {
        "subject": "math_addition_subtraction",
        "label": "Math — addition and subtraction",
        "grade": "grade 1-3",
        "count": 800,
        "topics": ["adding two numbers", "taking away", "number bonds", "carrying",
                   "borrowing", "word problems", "mental addition"],
        "analogies": ["adding stones to a pile", "taking biscuits from a plate",
                      "combining groups of children"],
        "scenarios": ["you had 7 and gave away 3", "you add 8 and 5"],
    },
    {
        "subject": "math_multiplication_division",
        "label": "Math — multiplication and division",
        "grade": "grade 2-4",
        "count": 800,
        "topics": ["times tables", "repeated addition", "sharing equally",
                   "grouping", "factors", "multiples", "division as sharing"],
        "analogies": ["equal rows of chairs", "sharing food among friends",
                      "arranging items in equal groups"],
        "scenarios": ["you share 12 oranges among 4 friends", "you have 3 groups of 5"],
    },
    {
        "subject": "math_fractions",
        "label": "Math — fractions",
        "grade": "grade 3-5",
        "count": 800,
        "topics": ["half", "quarters", "thirds", "numerator", "denominator",
                   "equivalent fractions", "comparing fractions", "adding fractions"],
        "analogies": ["cutting a flatbread into equal pieces", "dividing a water bottle",
                      "sharing a piece of cloth equally"],
        "scenarios": ["a bread is cut into 4 equal pieces and you take 1",
                      "you compare 1/2 and 1/4"],
    },
    {
        "subject": "math_decimals",
        "label": "Math — decimals and percentages",
        "grade": "grade 4-6",
        "count": 600,
        "topics": ["tenths", "hundredths", "decimal point", "percentages",
                   "converting fractions to decimals", "50%", "25%"],
        "analogies": ["money and change", "a thermometer reading",
                      "a test score out of 100"],
        "scenarios": ["you score 75 out of 100", "you have 0.5 of a litre"],
    },
    {
        "subject": "math_geometry",
        "label": "Math — basic geometry",
        "grade": "grade 4-6",
        "count": 600,
        "topics": ["triangles", "rectangles", "circles", "angles",
                   "perimeter", "area", "symmetry", "lines and points"],
        "analogies": ["the shape of a tent", "tiles on a floor",
                      "folding a paper in half"],
        "scenarios": ["you draw a shape with 4 equal sides",
                      "you measure around a garden"],
    },
    {
        "subject": "literacy_phonics",
        "label": "Literacy — phonics and letter sounds",
        "grade": "grade 1-2",
        "count": 800,
        "topics": ["letter a sound", "blending sounds", "short vowels",
                   "consonant pairs", "silent e", "digraphs ch sh th"],
        "analogies": ["sounds like the wind", "the beginning sound of your name",
                      "clapping syllables"],
        "scenarios": ["you see the word 'cat'", "you try to sound out 'ship'"],
    },
    {
        "subject": "literacy_reading",
        "label": "Literacy — reading comprehension",
        "grade": "grade 2-4",
        "count": 700,
        "topics": ["main idea", "finding details", "making inferences",
                   "sequencing events", "character feelings", "cause and effect"],
        "analogies": ["a story is like a journey", "details are like clues",
                      "the main idea is the heart of the story"],
        "scenarios": ["the character in the story feels sad",
                      "you read about a boy who found something"],
    },
    {
        "subject": "literacy_grammar",
        "label": "Literacy — basic grammar",
        "grade": "grade 3-5",
        "count": 600,
        "topics": ["nouns", "verbs", "adjectives", "sentences",
                   "punctuation", "capital letters", "subject and predicate"],
        "analogies": ["a noun is like a name tag", "a verb is the action in a film",
                      "a sentence is like a complete thought"],
        "scenarios": ["you write 'the dog run'", "you forget a full stop"],
    },
    {
        "subject": "science_body",
        "label": "Science — human body",
        "grade": "grade 3-5",
        "count": 500,
        "topics": ["heart", "lungs", "bones", "muscles", "digestion",
                   "the brain", "senses", "how blood moves"],
        "analogies": ["the heart is like a pump", "the lungs are like balloons",
                      "bones are like the frame of a tent"],
        "scenarios": ["you run and your heart beats faster",
                      "you eat food and it disappears"],
    },
    {
        "subject": "science_plants",
        "label": "Science — plants and ecosystems",
        "grade": "grade 3-5",
        "count": 500,
        "topics": ["roots", "leaves", "photosynthesis", "seeds",
                   "food chains", "habitats", "decomposers"],
        "analogies": ["roots are like drinking straws", "a food chain is like a story",
                      "a leaf is like a solar panel"],
        "scenarios": ["a plant has no sunlight for a week",
                      "an animal eats only plants"],
    },
    {
        "subject": "science_weather",
        "label": "Science — weather and water cycle",
        "grade": "grade 3-5",
        "count": 500,
        "topics": ["evaporation", "condensation", "rain", "clouds",
                   "wind", "temperature", "seasons", "water cycle"],
        "analogies": ["a wet cloth drying in the sun", "steam from a pot",
                      "a cloud is like a sponge in the sky"],
        "scenarios": ["water disappears from a puddle on a sunny day",
                      "you breathe on cold glass"],
    },
]


def build_khan_examples(spec: dict) -> list:
    examples = []
    topics = spec["topics"]
    analogies = spec["analogies"]
    scenarios = spec["scenarios"]
    subject = spec["subject"]
    grade = spec["grade"]
    target = spec["count"]

    grade_vocab = "simple" if "1-2" in grade or "1-3" in grade else "moderate"

    for i in range(target):
        topic = random.choice(topics)
        related = random.choice([t for t in topics if t != topic] or topics)
        wrong_ans = random.choice(["5", "10", "half", "the same", "zero", "bigger"])
        misunderstanding = random.choice(["it means adding", "it means the biggest number",
                                          "it's the same as subtracting", "it doesn't matter"])

        confusion_tmpl = random.choice(CONFUSION_TYPES)
        user_msg = confusion_tmpl.format(
            topic=topic,
            related=related,
            wrong_ans=wrong_ans,
            misunderstanding=misunderstanding,
        )

        style = random.choice(SOCRATIC_STYLES)
        analogy = random.choice(analogies)
        scenario = random.choice(scenarios)
        encourage = random.choice(ENCOURAGE_PHRASES)
        checking_tmpl = random.choice(CHECKING_QUESTIONS)
        checking = checking_tmpl.format(
            topic=topic,
            scenario=scenario,
            example_input=wrong_ans,
        )
        analogy_intro = random.choice(ANALOGY_INTROS).format(analogy=analogy)

        if style == "analogy":
            body = (
                f"{encourage} {analogy_intro} "
                f"When you think about {topic}, you can use this picture in your mind. "
            )
        elif style == "real_world":
            body = (
                f"{encourage} Let's connect {topic} to something real. "
                f"Think about {scenario} — that is exactly what {topic} is about. "
            )
        elif style == "step_by_step":
            body = (
                f"{encourage} Let's break {topic} into small steps. "
                f"First, think about what you already know. Then ask yourself what changes. "
            )
        elif style == "visual":
            body = (
                f"{encourage} Imagine a number line in your mind. "
                f"Now picture {topic} — where would it sit on that line? "
            )
        else:  # counter_question
            body = (
                f"{encourage} Before I explain, let me ask you something. "
                f"What do you think {topic} might mean just from the word itself? "
            )

        if grade_vocab == "simple":
            body = body.replace("connect", "link").replace("picture", "idea")

        assistant_msg = body + checking

        examples.append(make_example(SYSTEM_PROMPT, user_msg, assistant_msg))

    return examples


def generate_khan_academy() -> list:
    print("Generating Khan Academy examples...")
    all_examples = []
    for spec in SUBJECT_SPECS:
        batch = build_khan_examples(spec)
        all_examples.extend(batch)
        print(f"  {spec['label']}: {len(batch)} examples")
    print(f"  Total Khan Academy: {len(all_examples)}")
    return all_examples


# ──────────────────────────────────────────────────────────────────────────────
# SOURCE 2 — UNHCR trauma-informed pedagogy (500 examples)
# ──────────────────────────────────────────────────────────────────────────────

SHAME_USER_MSGS = [
    "I'm too stupid for this.",
    "I give up. I can't do it.",
    "Everyone else gets it except me.",
    "I'm not smart enough for school.",
    "I hate this. I can't do anything right.",
    "I've been trying for so long and I still don't get it.",
    "My brother says I'm slow.",
    "I don't see the point, I'll never understand.",
    "Why does this come easily to everyone but me?",
    "I want to stop. It's too hard.",
]

SHAME_RESPONSES = [
    (
        "I hear that you're feeling frustrated right now, and that feeling makes sense. "
        "Let's slow down completely — tell me one small thing you do remember, "
        "even something tiny. We can build from there. "
        "What's the very first step you feel okay about?"
    ),
    (
        "That feeling of being stuck is really uncomfortable, and I notice it. "
        "Let's try something different — forget the whole problem for a moment. "
        "Can you tell me one thing you learned this week, from anything at all? "
        "What's one thing that made sense to you today?"
    ),
    (
        "I want you to know that struggling with something new is part of learning — "
        "it means your brain is working hard. "
        "Let's find the part that feels easiest and start only there. "
        "Which piece of this feels least confusing right now?"
    ),
    (
        "Everyone has moments where things feel impossible. "
        "Let's set the hard part aside and try a much simpler version first. "
        "If the question were much easier, where would you start?"
    ),
    (
        "I notice you're working really hard, even when it feels difficult. "
        "Let's try a completely different way of looking at this. "
        "If I described this idea using only pictures, what would you draw?"
    ),
]

DISTRACTED_USER_MSGS = [
    "I'm thinking about my family.",
    "I can't concentrate. I didn't sleep well.",
    "I miss home.",
    "I was thinking about something else.",
    "Something happened this morning and I can't stop thinking about it.",
    "I don't feel like doing work today.",
    "I just want to go outside.",
    "My friend is not here today.",
    "I'm tired.",
    "I was looking at what's happening outside.",
]

DISTRACTED_RESPONSES = [
    (
        "I understand — some days it's hard to focus, and that's okay. "
        "We can take it slowly. "
        "Let's just try one small thing together. "
        "Can you look at this first question with me — just this one?"
    ),
    (
        "It sounds like you have a lot on your mind today. "
        "I'm glad you're here. "
        "Let's take just two minutes on something simple together. "
        "What's one thing from yesterday's lesson you remember?"
    ),
    (
        "Thank you for telling me. Let's make today's work feel light. "
        "We'll do just a little and stop whenever you need. "
        "Can you tell me one thing you already know about today's topic?"
    ),
    (
        "That's understandable. Let's start with something easy and short. "
        "I'll be right here with you the whole time. "
        "Can you try just this first part — it will only take a moment?"
    ),
]

SUCCESS_USER_MSGS = [
    "Wait — I think I got it! Is this right?",
    "Oh! I think I understand now.",
    "So is the answer 12? I worked it out!",
    "I figured it out myself this time!",
    "I tried a different way and I think it works!",
    "I kept trying and now I see it.",
    "I got it! It makes sense now.",
    "I finally understand fractions!",
]

SUCCESS_RESPONSES = [
    (
        "Yes — and look at what you just did. "
        "You didn't give up when it was hard, and that's exactly why you got there. "
        "The part you did really well was working through it step by step. "
        "Now can you explain to me how you got that answer?"
    ),
    (
        "That is real progress — and you earned it. "
        "I noticed you tried more than once, and that persistence made the difference. "
        "Now that you see how it works, let's make it stick. "
        "Can you try a similar example on your own?"
    ),
    (
        "Exactly right. And notice: you got there using your own thinking. "
        "That skill — working through confusion — is more valuable than any single answer. "
        "Can you tell me what clicked for you just now?"
    ),
    (
        "That is the feeling of real understanding — hold onto it. "
        "You worked hard to get here, and it shows. "
        "Let's build on that momentum. What part do you want to try next?"
    ),
]

WHY_USER_MSGS = [
    "Why do I need to learn this?",
    "When will I ever use this in real life?",
    "What's the point of learning math?",
    "Why does school matter?",
    "Why should I learn to read better?",
    "I don't understand why we learn science.",
    "Will I ever use fractions outside of school?",
    "Why do I need to know how to write?",
]

WHY_RESPONSES = [
    (
        "That's a fair question, and I want to give you a real answer. "
        "Numbers are in every market, every medicine dose, every distance you travel. "
        "The people who understand them can make decisions for themselves and their families. "
        "What kind of decisions do you imagine you'll make when you're older?"
    ),
    (
        "Honestly — this skill opens doors. "
        "Being able to read and understand things means no one can trick you with a document. "
        "It means you can learn anything you want on your own someday. "
        "What's something you'd want to learn about if you could read anything?"
    ),
    (
        "I think about it this way: learning is like building tools. "
        "Right now you're building the tools, even if you don't know what you'll build with them yet. "
        "What would you want to be able to do or understand in the future?"
    ),
    (
        "You'll use this every time you share something, plan something, or save something. "
        "Even if the exact problem looks different, the thinking you're practising now carries over. "
        "Can you think of one situation outside school where this might show up?"
    ),
]

SILENT_USER_MSGS = [
    "I don't know.",
    "Ok.",
    "...",
    "Maybe.",
    "I don't understand.",
    "Hmm.",
    "I'm not sure.",
    "I can't.",
    "Nothing.",
    "I don't know where to start.",
]

SILENT_RESPONSES = [
    (
        "That's okay — let me try asking it a different way. "
        "Instead of the whole question, just tell me: what's the first word or number you see? "
        "We can start from just that."
    ),
    (
        "Let's zoom in on just the simplest part. "
        "Forget the full question — if I showed you just this one piece, "
        "what does it remind you of?"
    ),
    (
        "No pressure at all. Let me show you something and you just say if it looks familiar. "
        "Think about what we did last time — do you remember even one step?"
    ),
    (
        "Let's try a different door into this. "
        "Imagine you had to explain this to a younger child — where would you start? "
        "Even a guess is a great place to begin."
    ),
]

SCENARIO_MAP = [
    ("shame", SHAME_USER_MSGS, SHAME_RESPONSES, 100),
    ("distracted", DISTRACTED_USER_MSGS, DISTRACTED_RESPONSES, 100),
    ("success", SUCCESS_USER_MSGS, SUCCESS_RESPONSES, 100),
    ("why", WHY_USER_MSGS, WHY_RESPONSES, 100),
    ("silent", SILENT_USER_MSGS, SILENT_RESPONSES, 100),
]


def generate_unhcr_pedagogy() -> list:
    print("Generating UNHCR pedagogy examples...")
    all_examples = []
    for scenario_name, user_pool, response_pool, count in SCENARIO_MAP:
        for _ in range(count):
            user_msg = random.choice(user_pool)
            assistant_msg = random.choice(response_pool)
            all_examples.append(make_example(SYSTEM_PROMPT, user_msg, assistant_msg))
        print(f"  Scenario {scenario_name}: {count} examples")
    print(f"  Total UNHCR pedagogy: {len(all_examples)}")
    return all_examples


# ──────────────────────────────────────────────────────────────────────────────
# SOURCE 3 — Multilingual QA (3,000 examples)
# ──────────────────────────────────────────────────────────────────────────────

LANGUAGE_SPECS = [
    {"code": "ar", "name": "Arabic",   "count": 600, "simple_only": False},
    {"code": "fr", "name": "French",   "count": 600, "simple_only": False},
    {"code": "sw", "name": "Swahili",  "count": 400, "simple_only": False},
    {"code": "so", "name": "Somali",   "count": 300, "simple_only": True},
    {"code": "am", "name": "Amharic",  "count": 300, "simple_only": True},
    {"code": "ti", "name": "Tigrinya", "count": 300, "simple_only": True},
    {"code": "din","name": "Dinka",    "count": 250, "simple_only": True},
    {"code": "ha", "name": "Hausa",    "count": 250, "simple_only": True},
]

# Simple grade 1-3 subject topics for low-resource languages
SIMPLE_TOPICS = [
    "counting numbers",
    "adding small numbers",
    "letters and sounds",
    "shapes",
    "plants and animals",
    "the weather",
]

# User messages with language code embedded in system prompt
MULTILINGUAL_USER_TEMPLATES = [
    "I don't understand {topic}. Can you help me?",
    "How do I do {topic}?",
    "Can you explain {topic} to me?",
    "I am confused about {topic}.",
    "What is {topic}?",
    "Can you show me {topic} with an example?",
    "I tried {topic} but I don't understand it.",
    "Why is {topic} important?",
]

MULTILINGUAL_ASSISTANT_TEMPLATES = [
    (
        "Great question about {topic}. Let's think about it step by step. "
        "First, what do you already know about {topic}? "
        "Can you tell me one thing you remember?"
    ),
    (
        "I'm glad you asked about {topic}. "
        "Let's use an example to make it clearer. "
        "Imagine you have some objects in front of you — how would you use {topic} here? "
        "What do you think the first step might be?"
    ),
    (
        "Let's explore {topic} together. "
        "Think about something from your daily life that uses {topic}. "
        "Can you give me one example where you might see this?"
    ),
    (
        "That's a thoughtful question about {topic}. "
        "Before I explain, let me ask you: what does the word {topic} remind you of? "
        "Your first thought can be a great starting point."
    ),
]


def generate_multilingual_qa(khan_examples: list) -> list:
    print("Generating multilingual QA examples...")
    all_examples = []

    simple_khan = [
        ex for ex in khan_examples
        if any(s["subject"] in ["math_counting", "math_addition_subtraction",
                                 "literacy_phonics", "science_plants", "science_weather"]
               for s in SUBJECT_SPECS
               if s["subject"] == "math_counting")
    ]
    # Use all khan examples as pool, filter by simple for low-resource
    simple_pool = khan_examples[:2000]
    full_pool = khan_examples

    for lang_spec in LANGUAGE_SPECS:
        code = lang_spec["code"]
        name = lang_spec["name"]
        count = lang_spec["count"]
        simple_only = lang_spec["simple_only"]

        lang_system = (
            f"The student speaks {name}. Respond entirely in {name}. "
            + SYSTEM_PROMPT
        )

        pool = simple_pool if simple_only else full_pool
        topics_pool = SIMPLE_TOPICS if simple_only else [
            t for spec in SUBJECT_SPECS for t in spec["topics"]
        ]

        for _ in range(count):
            topic = random.choice(topics_pool)
            user_tmpl = random.choice(MULTILINGUAL_USER_TEMPLATES)
            asst_tmpl = random.choice(MULTILINGUAL_ASSISTANT_TEMPLATES)

            user_msg = f"[{name}] " + user_tmpl.format(topic=topic)
            assistant_msg = f"[{name}] " + asst_tmpl.format(topic=topic)

            ex = make_example(lang_system, user_msg, assistant_msg)
            ex["language"] = code
            all_examples.append(ex)

        print(f"  {name} ({code}): {count} examples")

    print(f"  Total multilingual QA: {len(all_examples)}")
    return all_examples


# ──────────────────────────────────────────────────────────────────────────────
# DATASET ASSEMBLY
# ──────────────────────────────────────────────────────────────────────────────

def write_jsonl(path: Path, examples: list):
    with open(path, "w", encoding="utf-8") as f:
        for ex in examples:
            f.write(json.dumps(ex, ensure_ascii=False) + "\n")
    print(f"  Wrote {len(examples)} examples to {path}")


def read_jsonl(path: Path) -> list:
    with open(path, "r", encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def stratified_split(examples: list, n: int) -> tuple:
    """Split off n examples stratified by subject, return (eval_set, train_set)."""
    subject_buckets: dict = {}
    for ex in examples:
        subj = ex.get("subject", "unknown")
        subject_buckets.setdefault(subj, []).append(ex)

    eval_set = []
    per_bucket = max(1, n // max(len(subject_buckets), 1))
    for subj, bucket in subject_buckets.items():
        take = min(per_bucket, len(bucket))
        sample = random.sample(bucket, take)
        eval_set.extend(sample)
        if len(eval_set) >= n:
            break

    if len(eval_set) < n:
        remaining_pool = [ex for ex in examples if ex not in eval_set]
        extra = random.sample(remaining_pool, n - len(eval_set))
        eval_set.extend(extra)

    eval_ids = set(id(ex) for ex in eval_set)
    train_set = [ex for ex in examples if id(ex) not in eval_ids]
    return eval_set[:n], train_set


def main():
    # Generate sources
    khan_examples = generate_khan_academy()
    unhcr_examples = generate_unhcr_pedagogy()

    # Tag khan examples with subject for stratification
    idx = 0
    for spec in SUBJECT_SPECS:
        for i in range(spec["count"]):
            if idx < len(khan_examples):
                khan_examples[idx]["subject"] = spec["subject"]
                idx += 1

    multilingual_examples = generate_multilingual_qa(khan_examples)

    # Write individual source files
    print("\nWriting source JSONL files...")
    write_jsonl(DATASET_DIR / "khan_academy.jsonl", khan_examples)
    write_jsonl(DATASET_DIR / "unhcr_pedagogy.jsonl", unhcr_examples)
    write_jsonl(DATASET_DIR / "multilingual_qa.jsonl", multilingual_examples)

    # Merge and shuffle
    print("\nMerging and shuffling...")
    combined = khan_examples + unhcr_examples + multilingual_examples
    random.shuffle(combined)

    total = len(combined)
    if total < 11500:
        print(f"ERROR: Total examples {total} is below required minimum of 11,500. Exiting.")
        sys.exit(1)

    # Validate all examples
    print("Validating all examples...")
    for i, ex in enumerate(combined):
        validate_example(ex, i)
    print(f"  All {total} examples validated.")

    # Stratified eval split
    eval_set, train_set = stratified_split(combined, 60)
    assert len(eval_set) == 60, f"Expected 60 eval examples, got {len(eval_set)}"

    print("\nWriting combined and eval JSONL files...")
    write_jsonl(DATASET_DIR / "combined_train.jsonl", train_set)
    write_jsonl(DATASET_DIR / "eval_set.jsonl", eval_set)

    # Summary
    print("\n" + "=" * 45)
    print(f"{'Source':<25} | {'Count':>6}")
    print("-" * 45)
    print(f"{'Khan Academy':<25} | {len(khan_examples):>6}")
    print(f"{'UNHCR Pedagogy':<25} | {len(unhcr_examples):>6}")
    print(f"{'Multilingual QA':<25} | {len(multilingual_examples):>6}")
    print("-" * 45)
    print(f"{'Total training':<25} | {len(train_set):>6}")
    print(f"{'Evaluation set':<25} | {60:>6}")
    print("=" * 45)


if __name__ == "__main__":
    main()
