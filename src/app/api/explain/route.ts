import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import {
  auditSentenceSafety,
  computeReadingConfidence,
  detectBodyRegion,
  deterministicAskLumen,
  deterministicExplainMri,
  evaluateReportUrgency,
  getVerifiedPrevalence,
  sanitizeLlmOutput,
  scrubPII,
} from "@/lib/mri-engine";
import { BodyRegion, MriFinding } from "@/lib/types";

const SYSTEM_PROMPT = `You are Lumen, a plain-language visual MRI report explainer for non-medical patients.

STRICT CLINICAL, ACCURACY & EPISTEMIC RULES:
1. DOCUMENT VALIDITY: First verify whether the input is actually an MRI or radiology report. If it is NOT a radiology/MRI report (or is completely illegible), set "isMriReport": false and "findings": [] — never invent findings.
2. NEVER DIAGNOSE OR PRESCRIBE: Never diagnose a disease, stage cancer, prescribe medication, recommend surgery, or invent symptoms/causes the user did not explicitly mention.
3. FACTUAL PREVALENCE ACCURACY: Never exaggerate how common an anatomical variant is. Distinguish between population prevalence and symptom rate: for example, an AICA vascular loop is present in roughly 12%-35% of people (say "many people have this loop" or "seen in roughly 1 in 4 to 1 in 3 people" — NEVER say "most people have these loops"), while among people who DO have one, most never notice symptoms. Never fabricate percentages.
4. ZERO-NOCEBO / ANTI-HYPERVIGILANCE: For harmless anatomical variants (e.g., AICA vascular loop, mild age-related disc desiccation), NEVER open with a list of scary symptoms. State calmly that among people with this variant, most have no symptoms, and only mention symptom correlation if the user brought it up or asks.
5. USE OPTIONAL PATIENT CONTEXT ACTIVELY: If the user provides their age or describes what is bothering them, explicitly connect how the scan findings relate to what they shared (without diagnosing) in "contextNote", "overallCalmTakeaway", and tailored "doctorQuestion" items. If they did NOT provide context, do NOT invent any.
6. PASSIVE-BY-DEFAULT ALERTING: Do not generate alarmist warnings for normal or routine findings. When a finding genuinely requires prompt review (e.g., mass effect, midline shift, cord compression, acute hemorrhage), state it plainly without catastrophizing.
7. PRESERVE NEGATION & LATERALITY (RadGraph Fidelity): Never flip "no / without / unremarkable" and never swap "left" and "right". Every "originalSentence" must be copied verbatim from the report.
8. AHRQ PEMAT READABILITY (Grade 6-8): Explain radiology acronyms (AICA, FLAIR, T2W, CP angle) in plain words inline.
9. HONEST UNCERTAINTY: Separate what the scan shows structurally from what requires a doctor's physical exam. If a line is cut off or illegible, say so rather than guessing.
10. NO EMOJIS anywhere in your response.
11. Return ONLY valid JSON matching the requested schema.`;

const VALID_REGIONS = new Set<BodyRegion>([
  "brain",
  "spine_lumbar",
  "knee",
  "shoulder",
  "abdomen",
  "unknown",
]);

function regionTitleFor(region: BodyRegion): string {
  switch (region) {
    case "brain":
      return "3D Brain & Cerebral Vessels Guide";
    case "spine_lumbar":
      return "3D Lumbar Spine & Disc Guide";
    case "knee":
      return "3D Knee Joint & Meniscus Guide";
    case "shoulder":
      return "Shoulder & Rotator Cuff Scan";
    case "abdomen":
      return "Abdomen & Pelvis Scan";
    default:
      return "Scan Region Not Identified";
  }
}

/**
 * Extracts readable text from uncompressed/standard PDF text streams (Tj / TJ operators)
 * so uploaded test PDFs work cleanly without external binary dependencies.
 */
function extractTextFromPdfBuffer(buf: Buffer): string {
  const raw = buf.toString("latin1");
  const matches: string[] = [];
  const tjRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = tjRegex.exec(raw)) !== null) {
    const unescaped = m[1]
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "")
      .replace(/\\\(/g, "(")
      .replace(/\\\)/g, ")")
      .replace(/\\\\/g, "\\");
    if (unescaped.trim()) matches.push(unescaped.trim());
  }
  return matches.join("\n");
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    let mode: "report" | "ask" = "report";
    let rawText = "";
    let ageBracket = "";
    let exactAge = "";
    let userContext = "";
    let question = "";
    let currentReport = null;
    let uploadedFileBase64: string | null = null;
    let uploadedMimeType: string | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      mode = form.get("mode") === "ask" ? "ask" : "report";
      rawText = String(form.get("text") || "").trim();
      ageBracket = String(form.get("ageBracket") || "").trim();
      exactAge = String(form.get("exactAge") || "").trim();
      userContext = String(form.get("userContext") || "").trim();
      question = String(form.get("question") || "").trim();
      const rawReportJson = form.get("currentReport");
      if (typeof rawReportJson === "string" && rawReportJson.trim()) {
        try {
          currentReport = JSON.parse(rawReportJson);
        } catch {}
      }

      const file = form.get("file");
      if (file && typeof file !== "string") {
        const arrayBuf = await file.arrayBuffer();
        const buf = Buffer.from(arrayBuf);
        uploadedMimeType = file.type || "application/pdf";
        uploadedFileBase64 = buf.toString("base64");

        if (file.name.toLowerCase().endsWith(".txt") || uploadedMimeType.startsWith("text/")) {
          rawText = buf.toString("utf8").trim();
        } else if (
          file.name.toLowerCase().endsWith(".pdf") ||
          uploadedMimeType === "application/pdf"
        ) {
          const extracted = extractTextFromPdfBuffer(buf);
          if (extracted.length > 20) {
            rawText = extracted;
          }
        }
      }
    } else {
      const body = await req.json();
      mode = body.mode === "ask" ? "ask" : "report";
      rawText = typeof body.text === "string" ? body.text.trim() : "";
      ageBracket = typeof body.ageBracket === "string" ? body.ageBracket.trim() : "";
      exactAge = typeof body.exactAge === "string" ? body.exactAge.trim() : "";
      userContext = typeof body.userContext === "string" ? body.userContext.trim() : "";
      question = typeof body.question === "string" ? body.question.trim() : "";
      currentReport = body.currentReport || null;
    }

    const apiKey = process.env.GEMINI_API_KEY;

    // 1. ASK MODE (Continuous Multi-Turn Chat — Grounded in Findings + Optional User Context + Attached Files)
    if (mode === "ask") {
      if (!question && !uploadedFileBase64) {
        return NextResponse.json({ error: "Please enter a question or attach a file." }, { status: 400 });
      }
      const effectiveQuestion = question || "Please review this attached file alongside my MRI report.";
      const det = deterministicAskLumen(effectiveQuestion, currentReport);
      if (det.emergencyTriggered || det.boundaryTriggered) {
        return NextResponse.json(det);
      }

      if (apiKey && apiKey.trim().length > 10) {
        try {
          const ai = new GoogleGenAI({ apiKey });
          const findingsContext = Array.isArray(currentReport?.findings)
            ? currentReport.findings
                .map(
                  (f: MriFinding, idx: number) =>
                    `${idx + 1}. ${f.title} (${f.categoryLabel}) — Original: "${f.originalSentence}"`
                )
                .join("\n")
            : "None";

          const askParts: Array<
            { text: string } | { inlineData: { data: string; mimeType: string } }
          > = [];
          if (uploadedFileBase64 && uploadedMimeType) {
            askParts.push({
              inlineData: {
                data: uploadedFileBase64,
                mimeType: uploadedMimeType,
              },
            });
          }

          const attachedTextNote = rawText
            ? `\nExtracted text from newly attached file:\n"""\n${scrubPII(rawText).cleanedText}\n"""`
            : uploadedFileBase64
              ? "\nThe patient also attached an additional document/image above — read it carefully and discuss it alongside their MRI report."
              : "";

          askParts.push({
            text: `Answer this patient's question about their MRI report clearly, accurately, and without introducing details they did not mention.
Patient question: "${effectiveQuestion}"
Patient optional age: "${exactAge || ageBracket || "Not provided"}"
Patient optional concern: "${userContext || "Not provided"}"
Report summary: "${currentReport?.overallCalmTakeaway || "MRI report"}"
Report findings:
${findingsContext}${attachedTextNote}

RULES FOR THIS REPLY:
- If the user is asking for medical advice, diagnosis, causation certainty, or treatment that Lumen cannot provide, set "needsDoctorAdvice": true, politely explain that Lumen can only read the report and clarify terms, advise them to ask their doctor for this query, and offer to help clarify any other terms on their report.
- If the user is simply asking what a term, section, or attached document means, answer clearly and set "needsDoctorAdvice": false, "whatWeDontKnow": "", and "suggestedDoctorQuestion": "" (do NOT repeat disclaimers or doctor questions on routine clarification replies).

Return ONLY JSON:
{
  "needsDoctorAdvice": false,
  "calmAnswer": "2-3 accurate plain-language sentences grounded ONLY in the report findings, attached file (if any), and what the user actually shared",
  "whatWeDontKnow": "ONLY populate if needsDoctorAdvice is true; otherwise empty string",
  "suggestedDoctorQuestion": "ONLY populate if needsDoctorAdvice is true or the user explicitly asks what to ask their doctor; otherwise empty string"
}`,
          });

          let resText: string | undefined;
          for (const model of ["gemini-3-flash-preview", "gemini-3.8-flash"]) {
            try {
              const res = await ai.models.generateContent({
                model,
                contents: [{ role: "user", parts: askParts }],
                config: {
                  systemInstruction: SYSTEM_PROMPT,
                  responseMimeType: "application/json",
                  temperature: 0.15,
                },
              });
              if (res.text) {
                resText = res.text;
                break;
              }
            } catch {
              // try next model
            }
          }
          if (resText) {
            const parsed = JSON.parse(resText);
            const safeAnswer = sanitizeLlmOutput(parsed.calmAnswer || det.calmAnswer);
            const wantsDoctor = Boolean(parsed.needsDoctorAdvice) || safeAnswer.boundaryTriggered;
            const safeUnknown =
              wantsDoctor && parsed.whatWeDontKnow
                ? sanitizeLlmOutput(parsed.whatWeDontKnow).text
                : "";
            const safeQ = parsed.suggestedDoctorQuestion
              ? sanitizeLlmOutput(parsed.suggestedDoctorQuestion).text
              : "";
            return NextResponse.json({
              ...det,
              source: "gemini",
              boundaryTriggered: det.boundaryTriggered || wantsDoctor,
              calmAnswer: safeAnswer.text,
              whatWeDontKnow: safeUnknown,
              suggestedDoctorQuestion: safeQ,
            });
          }
        } catch {
          // Silent fallback
        }
      }
      return NextResponse.json({
        ...det,
        whatWeDontKnow: det.boundaryTriggered ? det.whatWeDontKnow : "",
        suggestedDoctorQuestion: det.boundaryTriggered ? det.suggestedDoctorQuestion : "",
      });
    }

    // 2. REPORT MODE
    if (!rawText && !uploadedFileBase64) {
      return NextResponse.json(
        { error: "Please upload an MRI report file or paste the report text." },
        { status: 400 }
      );
    }

    // If an image/scanned PDF has no selectable text and no API key, fail honestly (never run regex on "")
    if (!rawText && uploadedFileBase64 && (!apiKey || apiKey.trim().length <= 10)) {
      return NextResponse.json(
        {
          error:
            "Reading image-based reports requires a live Gemini API key. Please paste the report text or configure GEMINI_API_KEY in .env.local.",
        },
        { status: 422 }
      );
    }

    const effectiveAgeBracket = ageBracket || "30s";

    if (apiKey && apiKey.trim().length > 10) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const pii = scrubPII(rawText);

        const parts: Array<
          | { text: string }
          | { inlineData: { data: string; mimeType: string } }
        > = [];

        if (uploadedFileBase64 && uploadedMimeType) {
          parts.push({
            inlineData: {
              data: uploadedFileBase64,
              mimeType: uploadedMimeType,
            },
          });
        }

        const ageDisplay = exactAge ? `${exactAge} years old` : ageBracket || "Not provided";
        parts.push({
          text: `Translate this MRI report into structured, sentence-linked findings with 3D spatial coordinates (-0.5 to 0.5).
Patient optional age: "${ageDisplay}"
Patient optional concern ("What's bothering you"): "${userContext || "Not provided"}"
${pii.cleanedText ? `Extracted report text:\n"""\n${pii.cleanedText}\n"""` : "Read the attached MRI report document carefully."}

IMPORTANT:
- If the uploaded document is NOT an MRI or radiology report (or is unreadable), set "isMriReport": false and "findings": [].
- Set "region" strictly to one of: "brain", "spine_lumbar", "knee", "shoulder", "abdomen", "unknown". Never guess a random organ.
- If the patient provided their age or concern above, write a 1-2 sentence "contextNote" directly addressing how this scan relates to what they shared (without diagnosing), and reflect their concern in the most relevant finding's "doctorQuestion". If they did not provide optional details, set "contextNote" to "".
- Never say "most people have [variant]" unless verified >50%. For AICA loops, say "many people have this variation, and most who have it never notice symptoms."

Return ONLY JSON matching:
{
  "isMriReport": true,
  "region": "brain | spine_lumbar | knee | shoulder | abdomen | unknown",
  "extractedText": "The full verbatim text read from the report (omit patient name, phone, and hospital ID)",
  "overallCalmTakeaway": "1-2 concise plain-language sentences",
  "contextNote": "1-2 sentences connecting the report to the optional age/concern provided, or empty string if none provided",
  "findings": [
    {
      "id": "f-1",
      "title": "Short plain title",
      "category": "normal | variant_incidental | discuss_with_doctor | prompt_attention",
      "categoryLabel": "Short label",
      "originalSentence": "Exact verbatim quote from report",
      "calmSummary": "1-2 accurate plain-language sentences",
      "deeperAnatomy": "Brief anatomical explanation",
      "whatItIsNot": "Brief clarification of what this does NOT mean",
      "pin": { "x": 0.0, "y": 0.1, "z": 0.1, "anatomicalLabel": "Short anatomical label" },
      "doctorQuestion": "1 specific question for the doctor"
    }
  ]
}`,
        });

        let resText: string | undefined;
        for (const model of ["gemini-3-flash-preview", "gemini-3.8-flash"]) {
          try {
            const res = await ai.models.generateContent({
              model,
              contents: [{ role: "user", parts }],
              config: {
                systemInstruction: SYSTEM_PROMPT,
                responseMimeType: "application/json",
                temperature: 0.1,
              },
            });
            if (res.text) {
              resText = res.text;
              break;
            }
          } catch {
            // try next model
          }
        }

        if (resText) {
          const parsed = JSON.parse(resText);

          // Code-level Guardrail: Reject non-MRI or unreadable documents cleanly
          if (parsed.isMriReport === false) {
            return NextResponse.json(
              {
                error:
                  "This file does not appear to be a readable MRI report. Please upload an MRI report PDF/photo or paste the report text.",
              },
              { status: 422 }
            );
          }

          // Code-level Guardrail: Post-OCR PII scrubbing on extracted text
          const postPii = scrubPII(parsed.extractedText || pii.cleanedText || rawText);
          const effectiveText = postPii.cleanedText;

          // Cross-check region detection (never default to a random organ)
          const detRegion = detectBodyRegion(effectiveText);
          const llmRegion: BodyRegion = VALID_REGIONS.has(parsed.region)
            ? parsed.region
            : "unknown";
          const finalRegion: BodyRegion =
            detRegion.region !== "unknown" ? detRegion.region : llmRegion;
          const finalRegionTitle = regionTitleFor(finalRegion);

          const confidence = computeReadingConfidence(effectiveText);
          const baseFallback = deterministicExplainMri(effectiveText, effectiveAgeBracket);

          if (Array.isArray(parsed.findings) && parsed.findings.length > 0) {
            const verifiedFindings: MriFinding[] = parsed.findings.map(
              (f: Partial<MriFinding>, i: number) => {
                const orig = scrubPII(f.originalSentence || "Report line").cleanedText;
                const rawCalm = sanitizeLlmOutput(f.calmSummary || "").text;
                const audit = auditSentenceSafety(orig, rawCalm);

                // Active Code-Level Circuit Breaker: never render a flipped negation or swapped left/right
                const safeCalm =
                  !audit.negationPreserved || !audit.lateralityPreserved
                    ? "Lumen detected a wording mismatch while simplifying this line. Please read the exact original line below and review it with your doctor."
                    : rawCalm;

                return {
                  id: f.id || `f-${i + 1}`,
                  title: sanitizeLlmOutput(f.title || "MRI Observation").text,
                  category: f.category || "discuss_with_doctor",
                  categoryLabel: sanitizeLlmOutput(f.categoryLabel || "Review With Doctor").text,
                  originalSentence: orig,
                  calmSummary: safeCalm,
                  deeperAnatomy: sanitizeLlmOutput(f.deeperAnatomy || "").text,
                  whatItIsNot: sanitizeLlmOutput(
                    f.whatItIsNot || "Requires clinical correlation by your doctor."
                  ).text,
                  pin: f.pin || { x: 0, y: 0, z: 0, anatomicalLabel: "Scanned Area" },
                  // Keyword-matched verified prevalence ONLY (never copied by array index)
                  prevalence: getVerifiedPrevalence(orig, effectiveAgeBracket),
                  safetyAudit: audit,
                  doctorQuestion: sanitizeLlmOutput(
                    f.doctorQuestion ||
                      "Could you explain how this finding relates to my symptoms?"
                  ).text,
                };
              }
            );

            const urgency = evaluateReportUrgency(effectiveText, verifiedFindings, confidence);
            const cleanContextNote =
              (userContext || exactAge) && parsed.contextNote
                ? sanitizeLlmOutput(parsed.contextNote).text
                : undefined;

            return NextResponse.json({
              ...baseFallback,
              source: "gemini",
              region: finalRegion,
              regionTitle: finalRegionTitle,
              piiRedacted: pii.piiRedacted || postPii.piiRedacted,
              piiNotice: pii.piiNotice || postPii.piiNotice,
              readingConfidence: confidence,
              urgencyTier: urgency.tier,
              urgencyTitle: urgency.title,
              urgencyGuidance: urgency.guidance,
              overallCalmTakeaway: sanitizeLlmOutput(
                parsed.overallCalmTakeaway || baseFallback.overallCalmTakeaway
              ).text,
              contextNote: cleanContextNote,
              findings: verifiedFindings,
              doctorQuestions: verifiedFindings.map((vf) => vf.doctorQuestion).slice(0, 3),
            });
          }
        }
      } catch {
        // Fall through to honest failure or deterministic fallback below
      }
    }

    // Code-level Guardrail: If an image/PDF had NO extractable text and Gemini failed, do NOT fake a report!
    if (!rawText) {
      return NextResponse.json(
        {
          error:
            "Could not read text from this uploaded file right now. Please try again with a clearer photo/PDF or paste the report text.",
        },
        { status: 422 }
      );
    }

    const fallbackResult = deterministicExplainMri(rawText, effectiveAgeBracket);
    if (userContext || exactAge) {
      const ctxParts: string[] = [];
      if (exactAge) ctxParts.push(`age ${exactAge}`);
      if (userContext) ctxParts.push(`"${userContext}"`);
      fallbackResult.contextNote = `Noted your details (${ctxParts.join(", ")}). Bring these alongside your report so your doctor can check whether any scan observation connects to how you feel.`;
    }
    return NextResponse.json(fallbackResult);
  } catch {
    return NextResponse.json({ error: "Unable to process MRI report right now." }, { status: 500 });
  }
}
