# Lumen — 3D MRI Report Explainer

**Praneetha Kamabathula, MIT-WPU**  
**Live Prototype:** [LumenMRI Vercel](https://lumenmri.vercel.app/)  
**GitHub Repository (Code, Research, IA, User Flows & Test MRI Kit):** [https://github.com/pranee22/Lumen](https://github.com/pranee22/Lumen)

---

## 1. Why This Project Matters

In India, patients routinely get MRI scans at stand-alone diagnostics centres and receive the printed radiology report directly—often days before their follow-up specialist appointment. Radiology reports are written clinician-to-clinician, not for laypeople. Even a reassuring brain MRI commonly reads:

> *"Clinical Indication: To rule out intracranial pathology. Right anterior inferior cerebellar artery loop — type II (Chavda classification). No evidence of nerve thinning, buckling, or altered signal changes."*

To a non-medical reader, **"Type II (Chavda classification)"** sounds like a disease stage, sparking late-night web searches and acute *"scanxiety."* In reality, an AICA vascular loop is a natural anatomical variation seen in roughly **12%–35% of healthy adults**, and most people who have one never notice symptoms. Similarly, **52%–80%** of completely pain-free adults aged 30–50 show spinal disc degeneration on MRI (Brinjikji et al., *AJNR* 2015). With Indian OPD consultations averaging **~2 minutes** (Irving et al., *BMJ Open* 2017), patients rarely have time to unpack unfamiliar terms unless they arrive oriented.

### Preserving Psychological Safety
Waiting days with an unexplained medical report places both patients and family caregivers in a state of hypervigilance. Lumen is designed primarily around **psychological safety**—communicating calm through restraint rather than alarmist banners, avoiding unprompted symptom checklists (zero-nocebo), and tying every simplified sentence directly to the original report line so users never feel the AI is guessing.

---

## 2. Concept & Why AI Is Essential

**Lumen** is a mobile-first (`390px`) AI report explainer that translates unstructured MRI reports (PDFs, photos, or pasted text) into an interactive 3D anatomical view and plain-language summary. *The name Lumen draws from Latin for light and clarity (illuminating dense medical jargon) as well as the anatomical term for the inner space of a blood vessel—reflecting the vascular loop that inspired the project.*

- **Why static websites cannot solve this:** MRI reports are unstructured free text across varying hospital templates, headings (*Observations*, *Findings*, *Impression*), and body regions. AI is needed to extract text from photographed printouts, preserve clinical negations and left/right laterality, map arbitrary clauses to 3D spatial regions, and answer open-ended follow-up questions grounded strictly in the report.
- **Why it is designed this way:**
  - *Visual-first 3D + 1 finding at a time:* Showing one finding on a rotatable 3D model with clickable numbered pins reduces cognitive overload compared to a wall of medical text.
  - *Direct View Film toggle:* Lets patients inspect their actual uploaded MRI film alongside the 3D orientation guide.
  - *Optional context above the finding:* Entered age and concerns shape a short personal bridge without diagnosing or inventing unmentioned symptoms.
  - *Passive-by-default alerting:* Routine scans show zero warning banners; urgency notices appear only when genuine clinical red flags are present.

---

## 3. Information Architecture & User Flow

### Information Architecture
1. **Intake & Context:** MRI report upload (PDF, photo, or pasted text), lightweight inline MRI film attach, and grouped Optional Details (Age + auto-expanding *"What's bothering you?"*).
2. **Visual Exploration Viewport:** 1-tap toggle between the rotatable 3D anatomical model (with clickable numbered badges synced to findings) and the zoomable direct MRI film viewer—or an honest empty state if no verified 3D model exists for that region.
3. **Progressive Bottom Sheet:** Three states—*Resting* (personal context note, 1 finding at a time, verbatim original line, *Discuss further*), *Discuss Inline* (compact 3D + multi-turn chat + paperclip file attach + *Thinking* indicator), and *Expanded View* (full anatomy context, verified prevalence when backed by studies, and continuous chat).

### End-to-End Flow
`Upload Report (+ optional Film, Age, Concern)` → `Privacy Scrub & Document Validity Check` *(Non-MRI / blurry photo → clear retry prompt, never fake cards)* → `Multimodal AI Extraction & 3D Pin Mapping` → `Safety Verification` *(Negation/side check, keyword-only citations, rule-locked urgency on critical findings)* → `Interactive 3D & Progressive Sheet` → `Discussion Chat` *(Routine term clarification | Medical-advice boundary + scaffolding chips | Acute neurological emergency halt to 108/112)*.

---

## 4. System Instructions & Safeguards (Clinical Reasoning)

Raw LLM radiology simplifications carry a **5%–10% error rate**, including flipped negations and swapped left/right sides (Jeblick et al., *European Radiology* 2024). Lumen pairs strict behavioral instructions with deterministic safety checks:

### System Instructions
1. **Verify the document first:** Confirm the upload is actually a radiology/MRI report before interpreting—never fabricate findings from unrelated files.
2. **No diagnosis or prescription:** Never diagnose a disease, recommend medication or surgery, or introduce symptoms/causes the user did not mention.
3. **Factual prevalence accuracy:** Clearly separate how common a variant is in the population (*"seen in roughly 12%–35% of healthy adults"*) from symptom rates (*"most people who have it never notice symptoms"*).
4. **Zero-nocebo framing:** Never open harmless anatomical variants with scary symptom checklists.
5. **Active grounding without noise:** Use optional age and concerns to personalize context; in chat, show doctor-advice prompts and disclaimers only when medical advice is requested.
6. **Verbatim fidelity & plain language:** Keep every original report quote intact, preserve negation and left/right laterality, and explain acronyms inline at Grade 6–8 readability.

### Safeguards

| Risk / Failure Mode | How Lumen Prevents It & Why It Matters |
|---|---|
| **Flipped negation or swapped side** | Every simplified sentence is checked against its original report line so *"no bleeding"* cannot flip or *right* swap to *left*; mismatches are intercepted before reaching the user. |
| **Wrong 3D organ shown** | If a scan region is unidentified or lacks a verified 3D model, Lumen shows an honest empty state with **View Film** rather than defaulting to an unrelated organ. |
| **Non-MRI or blurry photo** | Unreadable images and non-radiology files return a clear retry prompt rather than guessing or generating placeholder findings. |
| **Unverified statistics** | Population percentages are shown only when matched to verified clinical studies for that exact finding (e.g., Brinjikji *AJNR* 2015 for lumbar discs; Chavda series for AICA loops). |
| **Health data privacy** | Patient names, phone numbers, emails, and hospital IDs are masked before and after reading; nothing uploaded or typed is stored. |
| **Missed urgent finding** | Critical non-negated findings (mass effect, midline shift, cord compression, acute hemorrhage, aneurysm) lock a prompt-review banner that the AI cannot downgrade. |
| **Treatment requests & acute red flags** | Medication/surgery queries trigger a polite scope boundary with scaffolding chips; acute neurological symptoms in chat trigger an immediate **108 / 112** emergency halt. |

---

## 5. AI Models & Tools Used (Mandatory Disclosure)

| AI Model / Tool | Where Used | Used For |
|---|---|---|
| **Gemini 3 Flash Preview** *(fallback: Gemini 3.8 Flash)* | Server-side API (via built-in server API key) | Multimodal OCR and parsing of uploaded MRI PDFs/photos, plain-language translation, 3D spatial pin mapping, and grounded follow-up chat (including additional files attached mid-conversation). |
| **Antigravity AI Assistant** | Research, Critique & Build | Clinical citation verification, contrarian and multi-persona safety testing, prototype engineering, synthetic test PDF generation, and documentation structuring. |

*Prototype stack & open 3D assets: Built with Next.js, TypeScript, Tailwind CSS (Open Sans), and Three.js using official CC-BY 4.0 NIH HuBMAP / Allen Brain Atlas 3D meshes (`brain.glb`, `knee.glb`) and Wikimedia Commons clinical MRI scans.*
