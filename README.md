# Lumen — 3D MRI Report Explainer

**Praneetha Kamabathula, MIT-WPU**  
*Studio 5b Assignment — AI-Enabled Design Track (Dr. Reddy's Laboratories)*  
**Live Prototype:** [https://lumenmri.vercel.app/](https://lumenmri.vercel.app/)

Lumen is a mobile-first (`390px`), pure Open Sans AI health-literacy prototype that translates unstructured MRI reports (PDFs, photos, or pasted text) into interactive 3D anatomical views and plain-language summaries for patients and family caregivers waiting to see their doctor.

*The name **Lumen** comes from Latin for light and clarity (illuminating dense medical jargon) as well as the anatomical term for the hollow inner space of a blood vessel—reflecting the vascular loop that inspired this project.*

---

## Repository Contents (Documentation, Research, Flows & Test Kit)

- **[PraneethaKamabathula_AIEnabled_Studio5b.pdf](./PraneethaKamabathula_AIEnabled_Studio5b.pdf)** — 4-page submission report (Problem, Psychological Safety, Concept, Information Architecture, End-to-End Flow, Live UI Screenshots, System Instructions, Safeguards, and Mandatory AI Disclosure).
- **[PraneethaKamabathula_AIEnabled_Studio5b.md](./PraneethaKamabathula_AIEnabled_Studio5b.md)** — Full Markdown case study including Information Architecture (IA), User & AI Processing Flow, System Instructions, and Safeguards.
- **[research_spec.md](./research_spec.md)** — Clinical literature grounding (Irving et al. *BMJ Open* 2017, Brinjikji et al. *AJNR* 2015, Jeblick et al. *European Radiology* 2024, RadGraph-XL, AHRQ PEMAT).
- **[sample-test-reports/](./sample-test-reports/)** — Standalone verification kit kept outside the UI so evaluators can test true live ingestion:
  - `01_brain_mri_aica_chavda_type2.pdf` — Normal brain MRI with Right AICA vascular loop (Chavda Type II, intact nerve).
  - `02_lumbar_spine_disc_desiccation.pdf` — L4–L5 disc desiccation and mild diffuse bulge.
  - `03_right_knee_meniscus_tear.pdf` — Right medial meniscus posterior horn tear with intact ACL/PCL.
  - `04_brain_mri_prompt_review_test.pdf` — Left frontal enhancing lesion with vasogenic edema and midline shift (tests deterministic rule-locked prompt-review banner).
  - `05_partial_blurry_low_confidence_test.pdf` — Truncated/missing Impression report (tests measurable reading confidence % and refusal to guess).
  - **[sample-test-reports/films/](./sample-test-reports/films/)** — 3 real anonymized clinical MRI scans from Wikimedia Commons (`01_real_brain_mri.jpg`, `02_real_lumbar_spine_mri.jpg`, `03_real_knee_mri.png`) for testing the direct **View Film** mode.
- **[public/models/](./public/models/)** — Official US Government open-license 3D anatomical `.glb` meshes from the NIH HuBMAP Human Reference Atlas & Allen Brain Atlas (`brain.glb`, `knee.glb`, CC-BY 4.0).

---

## Running Locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.local.example` to `.env.local` and add your Gemini API key:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```
4. Open `http://localhost:3000` and upload any PDF/photo from `sample-test-reports/`.
