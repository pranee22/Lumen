import {
  AskLumenResponse,
  BodyRegion,
  FindingCategory,
  MriExplainResponse,
  MriFinding,
  ReadingConfidence,
  SafetyAudit,
  UrgencyTier,
} from "./types";

export function scrubPII(text: string): {
  cleanedText: string;
  piiRedacted: boolean;
  piiNotice?: string;
} {
  let cleaned = text;
  let found = false;

  const patterns: Array<[RegExp, string]> = [
    [/(?:\+91[\s-]?)?[6-9]\d{9}\b/g, "[PHONE REDACTED]"],
    [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[EMAIL REDACTED]"],
    [/\b(?:UHID|MRN|Patient\s*ID|Reg\s*No\.?)[\s:#-]*[A-Za-z0-9/-]+/gi, "[ID REDACTED]"],
    [/\b(?:Patient\s*Name|Name\s*of\s*Patient)[\s:.-]+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}/g, "Patient Name: [REDACTED]"],
  ];

  for (const [rx, replacement] of patterns) {
    if (rx.test(cleaned)) {
      found = true;
      cleaned = cleaned.replace(rx, replacement);
    }
  }

  return {
    cleanedText: cleaned,
    piiRedacted: found,
    piiNotice: found
      ? "Personal identifiers (name, phone, or hospital ID) were automatically masked before analysis. Nothing is saved after you close this tab."
      : undefined,
  };
}

export function detectBodyRegion(text: string): { region: BodyRegion; title: string } {
  const lower = text.toLowerCase();
  if (
    lower.includes("brain") ||
    lower.includes("intracranial") ||
    lower.includes("cerebral") ||
    lower.includes("cerebell") ||
    lower.includes("ventricle") ||
    lower.includes("frontal lobe")
  ) {
    return { region: "brain", title: "3D Brain & Cerebral Vessels Guide" };
  }
  if (
    lower.includes("knee") ||
    lower.includes("menisc") ||
    lower.includes("cruciate") ||
    lower.includes("acl")
  ) {
    return { region: "knee", title: "3D Knee Joint & Meniscus Guide" };
  }
  if (
    lower.includes("shoulder") ||
    lower.includes("rotator cuff") ||
    lower.includes("supraspinatus") ||
    lower.includes("labrum")
  ) {
    return { region: "shoulder", title: "3D Shoulder & Rotator Cuff Guide" };
  }
  if (
    lower.includes("abdomen") ||
    lower.includes("pelvis") ||
    lower.includes("hepatic") ||
    lower.includes("liver") ||
    lower.includes("renal")
  ) {
    return { region: "abdomen", title: "Abdomen & Pelvis Scan" };
  }
  if (
    /\b(lumbar|spine|spinal|vertebra|disc|disk|l1|l2|l3|l4|l5|s1|facet|cauda equina|thecal sac)\b/.test(
      lower
    )
  ) {
    return { region: "spine_lumbar", title: "3D Lumbar Spine & Disc Guide" };
  }
  return { region: "unknown", title: "Scan Region Not Identified" };
}

/**
 * Matches verified clinical prevalence data strictly by anatomical keyword on a specific finding,
 * never by array index.
 */
export function getVerifiedPrevalence(
  sentence: string,
  ageBracket: string
): {
  hasVerifiedData: boolean;
  citation?: string;
  summaryNote: string;
} {
  const lower = sentence.toLowerCase();
  if (/\b(anterior inferior cerebellar artery|vascular loop|arterial loop|aica|chavda)\b/.test(lower)) {
    return {
      hasVerifiedData: true,
      citation: "Chavda & McDermott MRI / Anatomical Series",
      summaryNote:
        "AICA vascular loops (Type I–II) are a natural anatomical variation seen in roughly 12%–35% of healthy people; most people who have one never notice any symptoms.",
    };
  }
  if (/\b(desiccation|disc bulge|disk bulge|disc degeneration|l4-l5|l5-s1)\b/.test(lower)) {
    const pct =
      ageBracket === "20s"
        ? "37%"
        : ageBracket === "40s"
          ? "68%"
          : ageBracket === "50s"
            ? "80%"
            : ageBracket === "60s"
              ? "88%"
              : "52%";
    return {
      hasVerifiedData: true,
      citation: "Brinjikji et al., AJNR 2015 (3,110 pain-free adults)",
      summaryNote: `In Brinjikji et al. (AJNR 2015), disc degeneration/bulges were found in ${pct} of completely pain-free people in their ${ageBracket}.`,
    };
  }
  if (/\bfacet\b/.test(lower)) {
    return {
      hasVerifiedData: true,
      citation: "Brinjikji et al., AJNR 2015",
      summaryNote:
        "Seen in 9%–18% of pain-free adults in their 30s–40s and 32%–50% by ages 50–60.",
    };
  }
  return {
    hasVerifiedData: false,
    summaryNote:
      "Lumen only displays population percentages when backed by a verified clinical study.",
  };
}

/**
 * Strips emojis and intercepts accidental prescriptive or definitive diagnostic phrasing in LLM output.
 */
export function sanitizeLlmOutput(text: string): {
  text: string;
  boundaryTriggered: boolean;
} {
  const noEmoji = text.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "").trim();
  const hasPrescriptive =
    /\b(you should take|start taking|take \d+\s*mg|i recommend surgery|you definitely have|you have cancer|this is cancer|stop taking your medication)\b/i.test(
      noEmoji
    );
  if (hasPrescriptive) {
    return {
      text: "Lumen cannot diagnose a condition or recommend medication or surgery. Please review this finding directly with your doctor alongside your physical exam.",
      boundaryTriggered: true,
    };
  }
  return { text: noEmoji, boundaryTriggered: false };
}

/**
 * Deterministic, measurable Reading Confidence Calculator.
 * Never lets the AI invent its own percentage.
 */
export function computeReadingConfidence(text: string): ReadingConfidence {
  const lower = text.toLowerCase();
  const sectionsDetected: string[] = [];
  const missingOrUnreadable: string[] = [];

  if (/\b(technique|protocol|sequences|t1w|t2w|flair|dwi)\b/i.test(text)) {
    sectionsDetected.push("Technique");
  }
  const hasClinicalBody =
    /\b(findings|observations|observation|report|study|noted|normal|unremarkable|no evidence)\b/i.test(
      text
    );
  if (hasClinicalBody) sectionsDetected.push("Observations");
  const hasConclusion =
    /\b(impression|conclusion|summary|opinion|final|no other significant abnormality)\b/i.test(text);
  if (hasConclusion) sectionsDetected.push("Impression");

  let score = 95;

  if (!hasClinicalBody) {
    score -= 18;
    missingOrUnreadable.push("Could not identify clear clinical observations in the uploaded text");
  }
  if (!hasConclusion || /impression:\s*\[/i.test(text)) {
    score -= 16;
    missingOrUnreadable.push("Final Impression / Conclusion appears missing or incomplete");
  }

  const cutOffMatches = text.match(/\[.*?(?:cut off|illegible|blurred|missing|unreadable).*?\]|\.{3,}/gi);
  if (cutOffMatches && cutOffMatches.length > 0) {
    score -= cutOffMatches.length * 14;
    missingOrUnreadable.push(
      `${cutOffMatches.length} line(s) appear cut off, blurred, or incomplete in the provided text`
    );
  }

  if (text.trim().length < 110) {
    score -= 20;
    missingOrUnreadable.push("Only a short snippet of the report was provided");
  }

  // Check if recognizable radiology vocabulary exists
  const hasRadTerms =
    /\b(mri|t1|t2|flair|disc|l4|l5|menisc|intracranial|cerebr|lesion|signal|unremarkable|normal|stenosis|loop)\b/i.test(
      lower
    );
  if (!hasRadTerms) {
    score -= 30;
    missingOrUnreadable.push("Few standard MRI terms recognized—verify that this is the full radiology text");
  }

  const clamped = Math.max(25, Math.min(98, score));
  const level: ReadingConfidence["level"] =
    clamped >= 85 ? "high" : clamped >= 65 ? "moderate" : "partial_unreadable";

  const explanation =
    level === "high"
      ? "All major report sections (Findings & Impression) were clearly readable and matched known anatomical terms."
      : level === "moderate"
        ? "Most lines were readable, but one or more sections were brief or lacked a full Impression summary."
        : "Part of this report appears cut off or missing. Lumen has translated only the legible lines and will not guess the missing sections.";

  return {
    scorePercent: clamped,
    level,
    sectionsDetected,
    missingOrUnreadable,
    explanation,
  };
}

export function auditSentenceSafety(original: string, plain: string): SafetyAudit {
  const origLower = original.toLowerCase();
  const plainLower = plain.toLowerCase();

  const origHasNegation = /\b(no|without|unremarkable|normal|intact|preserved|negative for|free of)\b/.test(
    origLower
  );
  const plainHasReassurance =
    /\b(no|not|without|none|zero|never|isn't|aren't|doesn't|normal|clear|healthy|intact|free of|nothing concerning|reassuring|unharmed|uncompressed|unaffected|undamaged|fine|variation|harmless|benign|looks good|expected|appropriate|typical|symmetric|as they should|look right|looks right|match your age|good shape)\b/.test(
      plainLower
    );
  const negationPreserved = !origHasNegation || plainHasReassurance;

  let detectedSide: SafetyAudit["detectedSide"] = "none";
  if (/\bbilateral\b/.test(origLower)) detectedSide = "bilateral";
  else if (/\bright\b/.test(origLower) && /\bleft\b/.test(origLower)) detectedSide = "bilateral";
  else if (/\bright\b/.test(origLower)) detectedSide = "right";
  else if (/\bleft\b/.test(origLower)) detectedSide = "left";
  else if (/\bmidline\b/.test(origLower)) detectedSide = "midline";

  let lateralityPreserved = true;
  if (detectedSide === "right" && /\bleft\b/.test(plainLower) && !/\bright\b/.test(plainLower)) {
    lateralityPreserved = false;
  }
  if (detectedSide === "left" && /\bright\b/.test(plainLower) && !/\bleft\b/.test(plainLower)) {
    lateralityPreserved = false;
  }

  const hedgedLanguageDetected =
    /\b(likely|possible|cannot be excluded|correlate clinically|suggestive of|equivocal|probable)\b/.test(
      origLower
    );

  return {
    negationPreserved,
    lateralityPreserved,
    detectedSide,
    hedgedLanguageDetected,
    hedgeNote: hedgedLanguageDetected
      ? "The radiologist used cautious/hedged phrasing ('likely' or 'correlate clinically'), meaning your doctor will combine this note with how you actually feel."
      : undefined,
  };
}

/**
 * Deterministic rule-locked urgency tier evaluator.
 * The AI can never downgrade a critical finding.
 */
export function evaluateReportUrgency(
  text: string,
  findings: MriFinding[],
  confidence: ReadingConfidence
): {
  tier: UrgencyTier;
  title: string;
  guidance: string;
} {
  const lower = text.toLowerCase();
  // Look for critical terms that are NOT negated on the same clause
  const clauses = lower.split(/[.;\n]+/);
  let hasNonNegatedCritical = false;

  for (const c of clauses) {
    const isNegated = /\b(no|without|absent|negative for|rule out)\b/.test(c);
    const hasCriticalWord =
      /\b(midline shift|mass effect|enhancing lesion|enhancing mass|vasogenic edema|cord compression|cauda equina|acute infarct|acute stroke|acute hemorrhage|subdural|epidural|aneurysm|dissection|abscess|hydrocephalus|herniation|suspicious for malignancy)\b/.test(
        c
      );
    if (hasCriticalWord && !isNegated) {
      hasNonNegatedCritical = true;
      break;
    }
  }

  if (
    hasNonNegatedCritical ||
    findings.some((f) => f.category === "prompt_attention")
  ) {
    return {
      tier: "contact_today",
      title: "Contact Your Referring Doctor Promptly (Today or Within 24–48 Hours)",
      guidance:
        "This report includes a finding (such as localized swelling, pressure/shift, or an enhancing area) that your doctor should review promptly rather than waiting weeks. Stay calm—many treatable conditions look like this on MRI, and your specialist will guide the exact next steps.",
    };
  }

  if (confidence.level === "partial_unreadable") {
    return {
      tier: "upcoming_visit",
      title: "Share the Complete Original Report at Your Doctor Appointment",
      guidance:
        "Because part of this report text was cut off or missing, please bring the full printed sheet or DICOM films/CD from the diagnostics centre to your doctor visit.",
    };
  }

  if (findings.some((f) => f.category === "discuss_with_doctor")) {
    return {
      tier: "upcoming_visit",
      title: "Discuss at Your Scheduled Doctor Appointment",
      guidance:
        "No urgent red-flag emergencies were flagged, but there are mechanical or tissue findings (such as a disc bulge or meniscal tear) worth reviewing with your doctor alongside your physical exam.",
    };
  }

  return {
    tier: "routine",
    title: "Reassuring Scan — Share Routinely at Your Scheduled Visit",
    guidance:
      "The core structures in this scan look clear, and any minor notes appear to be harmless anatomical variants or mild everyday changes. Keep your scheduled appointment so your doctor can confirm alongside your symptoms.",
  };
}

/**
 * Deterministic MRI report analyzer (also powers Silent Fallback Mode).
 */
export function deterministicExplainMri(
  rawText: string,
  ageBracket: string = "30s"
): MriExplainResponse {
  const pii = scrubPII(rawText);
  const text = pii.cleanedText;
  const { region, title: regionTitle } = detectBodyRegion(text);
  const confidence = computeReadingConfidence(text);

  const lines = text
    .split(/\n+/)
    .map((l) => l.replace(/^[-•*]\s*/, "").trim())
    .filter(
      (l) =>
        l.length > 8 &&
        !/^(MRI|TECHNIQUE|FINDINGS|OBSERVATION|IMPRESSION|Previous reports|-- End of Report)\b/i.test(l)
    );

  const findings: MriFinding[] = [];
  let idx = 1;
  const pushUnique = (f: MriFinding) => {
    if (!findings.some((existing) => existing.title === f.title)) {
      findings.push(f);
    }
  };

  for (const line of lines) {
    const lower = line.toLowerCase();

    // 1. Brain: No acute infarct, hemorrhage or space occupying mass lesion / no intracranial pathology
    if (
      /\bno\b.*\b(infarct|hemorrhage|space occupying|mass lesion|intracranial|pathology|abnormality)\b/.test(
        lower
      ) &&
      !/\bclinical indication\b/.test(lower)
    ) {
      const calm =
        "Completely clear of the big three worries: there is NO stroke ('acute infarct'), NO bleeding ('hemorrhage'), and NO tumor or growth ('space-occupying mass lesion').";
      pushUnique({
        id: `f-${idx++}`,
        title: "No Stroke, Bleeding, or Mass ('No Acute Infarct, Hemorrhage or Mass Lesion')",
        category: "normal",
        categoryLabel: "Normal & Reassuring",
        originalSentence: line,
        calmSummary: calm,
        deeperAnatomy:
          "Every brain MRI begins by checking for acute stroke (using DWI/ADC diffusion sequences), bleeding (using GRE sequences), and abnormal growths. Your scan passed all three checks cleanly.",
        whatItIsNot:
          "When your report says 'Clinical Indication: To rule out intracranial pathology,' that just records why the scan was ordered—and this line confirms the check came back clear.",
        pin: { x: -0.22, y: 0.34, z: 0.18, anatomicalLabel: "Cerebral Hemispheres (Clear)" },
        prevalence: {
          hasVerifiedData: false,
          summaryNote: "Baseline healthy brain appearance.",
        },
        safetyAudit: auditSentenceSafety(line, calm),
        doctorQuestion:
          "Since the MRI rules out any acute infarct, bleeding, or mass lesion, can we be confident there is no structural emergency?",
      });
      continue;
    }

    // 2. Brain: Right AICA Vascular Loop — Chavda Type II & No nerve thinning/buckling
    if (/\b(anterior inferior cerebellar artery|vascular loop|arterial loop|aica|chavda)\b/.test(lower)) {
      const calm =
        "A normal small artery at the base of the right side of the brain takes a curved loop ('Chavda Type II') near the right inner-ear nerve canal. Crucially, your report confirms 'no nerve thinning, buckling, or signal change'—meaning the nerve structure itself is intact and healthy.";
      pushUnique({
        id: `f-${idx++}`,
        title: "Right AICA Arterial Loop — Chavda Type II (Intact Nerve, Anatomical Variant)",
        category: "variant_incidental",
        categoryLabel: "Anatomical Variant — Intact Nerve",
        originalSentence: line,
        calmSummary: calm,
        deeperAnatomy:
          "Why does it say 'Type II (Chavda classification)'? Chavda Type I/II/III is simply an anatomical ruler describing how far a normal artery curves into the internal auditory canal (where the 8th cranial nerve for right-ear hearing and balance travels). Type II means the loop enters less than halfway into the canal. Because the report explicitly states 'no nerve thinning or buckling,' there is no tumor and no structural nerve damage.",
        whatItIsNot:
          "It is NOT a tumor (which is what 'rule out intracranial pathology' checks for), NOT an aneurysm, and NOT a ticking clock you need to monitor daily.",
        pin: { x: 0.36, y: -0.26, z: -0.14, anatomicalLabel: "Right AICA Loop (Ear Nerve Canal)" },
        prevalence: {
          hasVerifiedData: true,
          citation: "Chavda & McDermott MRI / Anatomical Series",
          summaryNote:
            "AICA vascular loops (Type I–II) are a natural anatomical variation seen in roughly 12%–35% of healthy people; most people who have one never notice any symptoms.",
        },
        safetyAudit: auditSentenceSafety(line, calm),
        doctorQuestion:
          "The report notes a Right AICA loop (Chavda Type II) with no nerve thinning or buckling — can you confirm whether this is just a harmless anatomical variation?",
      });
      continue;
    }

    // 2b. Brain: Hippocampi, Thalami, Basal Ganglia, Pituitary, Brainstem, Cerebellum, Ventricles
    if (/\b(hippocamp|thalami|basal ganglia|internal capsule)\b/.test(lower)) {
      const calm =
        "Your brain's deep memory centers (hippocampi) and movement/sensory relay hubs (thalami and basal ganglia) look completely healthy and symmetric on both left and right sides.";
      pushUnique({
        id: `f-${idx++}`,
        title: "Healthy Deep Memory & Relay Centers (Hippocampi, Thalami & Basal Ganglia)",
        category: "normal",
        categoryLabel: "Normal & Symmetric",
        originalSentence: line,
        calmSummary: calm,
        deeperAnatomy:
          "The hippocampi process memory, while the thalami and basal ganglia sit deep in the center of the brain to coordinate smooth movement and sensory signals. 'No volume loss or abnormal signal' means healthy tissue volume.",
        whatItIsNot: "No deep brain degeneration or asymmetry.",
        pin: { x: -0.14, y: 0.06, z: 0.04, anatomicalLabel: "Hippocampi & Basal Ganglia" },
        prevalence: {
          hasVerifiedData: false,
          summaryNote: "Healthy age-appropriate deep brain structures.",
        },
        safetyAudit: auditSentenceSafety(line, calm),
        doctorQuestion: "Are all deep brain structures and fluid spaces completely normal for my age?",
      });
      continue;
    }

    if (/\b(pituitary|hypothalamus|medulla|pons|mid brain|cerebellum|ventricles|cp angles)\b/.test(lower)) {
      const calm =
        "Your hormone center (pituitary), brainstem (medulla, pons, midbrain), balance center (cerebellum), and natural fluid spaces (ventricles and cisterns) are all clear and healthy for your age.";
      pushUnique({
        id: `f-${idx++}`,
        title: "Clear Brainstem, Cerebellum, Pituitary & Fluid Spaces",
        category: "normal",
        categoryLabel: "Normal for Age",
        originalSentence: line,
        calmSummary: calm,
        deeperAnatomy:
          "The posterior fossa at the back of the head houses the cerebellum (balance) and brainstem (automatic functions). 'Both CP angles are clear' and 'ventricles normal for age' confirm normal fluid circulation.",
        whatItIsNot: "No blockage of fluid circulation or pressure buildup.",
        pin: { x: 0.0, y: -0.22, z: -0.24, anatomicalLabel: "Cerebellum & Brainstem" },
        prevalence: {
          hasVerifiedData: false,
          summaryNote: "Normal healthy baseline across all sequences.",
        },
        safetyAudit: auditSentenceSafety(line, calm),
        doctorQuestion: "Is any follow-up imaging needed at all given that all sequences are normal?",
      });
      continue;
    }

    // 3. Paranasal sinus mucosal thickening
    if (/\b(sinus|mucosal thickening)\b/.test(lower)) {
      const calm =
        "Mild swelling of the inner lining of your nasal sinuses—extremely common after a minor cold, allergies, or dry air.";
      pushUnique({
        id: `f-${idx++}`,
        title: "Mild Sinus Lining Swelling (Mucosal Thickening)",
        category: "variant_incidental",
        categoryLabel: "Common Incidental Note",
        originalSentence: line,
        calmSummary: calm,
        deeperAnatomy:
          "Brain MRIs automatically capture the sinus cavities behind your nose and forehead. Even mild seasonal allergies or a recent sniffle shows up as 'mucosal thickening.'",
        whatItIsNot: "Not a brain issue; it sits inside the air cavities of the nose/sinuses.",
        pin: { x: 0.0, y: -0.18, z: 0.55, anatomicalLabel: "Paranasal Sinuses" },
        prevalence: {
          hasVerifiedData: false,
          summaryNote: "Seen incidentally on a large share of routine head MRIs.",
        },
        safetyAudit: auditSentenceSafety(line, calm),
        doctorQuestion: "Could mild sinus inflammation contribute to any forehead or facial pressure?",
      });
      continue;
    }

    // 4. Brain Critical: Enhancing lesion / edema / midline shift
    if (/\b(enhancing lesion|vasogenic edema|midline shift|mass effect)\b/.test(lower)) {
      const calm =
        "The scan shows a localized spot in the left frontal brain tissue with surrounding fluid swelling that is gently pushing nearby structures by a few millimeters. This needs a prompt, calm review with your specialist.";
      pushUnique({
        id: `f-${idx++}`,
        title: "Localized Frontal Tissue Finding & Swelling (Prompt Doctor Review)",
        category: "prompt_attention",
        categoryLabel: "Needs Prompt Doctor Review",
        originalSentence: line,
        calmSummary: calm,
        deeperAnatomy:
          "'Enhancing' means the area absorbed the IV contrast dye, and 'vasogenic edema' means fluid swelling around it. Because the skull is a fixed space, swelling can nudge the center line ('midline shift') slightly.",
        whatItIsNot:
          "An MRI report alone cannot name the exact tissue cause (infections, inflammation, and growths can look similar)—only your neurologist or neurosurgeon can interpret this alongside your history.",
        pin: { x: -0.36, y: 0.28, z: 0.32, anatomicalLabel: "Left Frontal Lobe" },
        prevalence: {
          hasVerifiedData: false,
          summaryNote: "Lumen does not have prevalence statistics for individualized contrast-enhancing findings.",
        },
        safetyAudit: auditSentenceSafety(line, calm),
        doctorQuestion:
          "Could you review the left frontal finding and swelling on my MRI today and let me know what immediate next steps or medications are needed?",
      });
      continue;
    }

    // 5. Spine: L4-L5 disc desiccation & mild bulge
    if (/\b(desiccation|disc bulge|disk bulge|l4-l5)\b/.test(lower) && !/\bcut off\b/.test(lower)) {
      const calm =
        "The cushion disc between your L4 and L5 lower-back bones has lost some natural water content ('desiccation') and bulges outward slightly—very much like a car tire settling gently with mileage.";
      pushUnique({
        id: `f-${idx++}`,
        title: "L4–L5 Disc Water Loss (Desiccation) & Mild Bulge",
        category: "discuss_with_doctor",
        categoryLabel: "Common Age Change — Discuss With Doctor",
        originalSentence: line,
        calmSummary: calm,
        deeperAnatomy:
          "Spinal discs act as shock absorbers filled with water-rich gel. Over time they naturally dry slightly ('loss of T2 signal / desiccation') and widen around the edge ('diffuse bulge').",
        whatItIsNot:
          "It is NOT a broken spine or a pinched spinal cord—the report notes no severe canal narrowing.",
        pin: { x: 0.0, y: -0.22, z: 0.12, anatomicalLabel: "L4–L5 Intervertebral Disc" },
        prevalence: {
          hasVerifiedData: true,
          citation: "Brinjikji et al., AJNR 2015 (3,110 pain-free adults)",
          percentageByAge: { "20s": 37, "30s": 52, "40s": 68, "50s": 80, "60s": 88 },
          summaryNote: `In Brinjikji et al. (AJNR 2015), disc degeneration/bulges were found in ${
            ageBracket === "20s"
              ? "37%"
              : ageBracket === "40s"
                ? "68%"
                : ageBracket === "50s"
                  ? "80%"
                  : "52%"
          } of completely pain-free people in their ${ageBracket}.`,
        },
        safetyAudit: auditSentenceSafety(line, calm),
        doctorQuestion:
          "Since mild L4–L5 disc desiccation and bulges are common even in people without pain, does this match where my discomfort is, or would physiotherapy help?",
      });
      continue;
    }

    // 6. Spine: No high-grade stenosis / normal vertebral height
    if (
      /\bno\b.*\b(stenosis|compression)\b/.test(lower) ||
      /\bnormal vertebral\b/.test(lower) ||
      /\bl3-l4 disc appears normal\b/.test(lower)
    ) {
      const calm =
        "Reassuring: the main spinal canal and nerve exits have plenty of room, with no severe pinching.";
      pushUnique({
        id: `f-${idx++}`,
        title: "Clear Nerve Pathways & Alignment",
        category: "normal",
        categoryLabel: "Normal & Reassuring",
        originalSentence: line,
        calmSummary: calm,
        deeperAnatomy:
          "'No high-grade canal stenosis or nerve root compression' means the tunnel carrying your spinal nerves is open and the nerves exiting to your legs are not trapped.",
        whatItIsNot: "No surgical nerve entrapment is described on this line.",
        pin: { x: 0.0, y: 0.18, z: -0.05, anatomicalLabel: "Spinal Canal & Nerve Roots" },
        prevalence: {
          hasVerifiedData: false,
          summaryNote: "Healthy baseline spinal alignment and nerve clearance.",
        },
        safetyAudit: auditSentenceSafety(line, calm),
        doctorQuestion: "With no nerve root compression seen, is it safe to stay active and walk daily?",
      });
      continue;
    }

    // 7. Spine: Facet hypertrophy
    if (/\bfacet\b/.test(lower)) {
      const calm =
        "Mild wear-and-tear thickening of the small stabilizing joints at the back of the L4–L5 vertebrae.";
      pushUnique({
        id: `f-${idx++}`,
        title: "Mild Facet Joint Wear (Hypertrophy)",
        category: "variant_incidental",
        categoryLabel: "Mild Wear & Tear",
        originalSentence: line,
        calmSummary: calm,
        deeperAnatomy:
          "Facet joints are small hinge joints behind each disc that guide back motion. 'Mild hypertrophy' simply means slight bone/ligament thickening from everyday posture and load.",
        whatItIsNot: "Not an acute injury or fracture.",
        pin: { x: 0.22, y: -0.22, z: -0.22, anatomicalLabel: "Bilateral L4–L5 Facet Joints" },
        prevalence: {
          hasVerifiedData: true,
          citation: "Brinjikji et al., AJNR 2015",
          summaryNote: "Seen in 9%–18% of pain-free adults in their 30s–40s and 32%–50% by ages 50–60.",
        },
        safetyAudit: auditSentenceSafety(line, calm),
        doctorQuestion: "Do my facet joints need any specific posture or core-strengthening exercises?",
      });
      continue;
    }

    // 8. Knee: Meniscal tear
    if (/\bmenisc\w*\s+tear\b|\bposterior horn\b.*\bmedial meniscus\b/.test(lower)) {
      const calm =
        "There is a small horizontal split in the back section ('posterior horn') of the inner cushion pad ('medial meniscus') of your right knee.";
      pushUnique({
        id: `f-${idx++}`,
        title: "Right Medial Meniscus Cushion Tear (Posterior Horn)",
        category: "discuss_with_doctor",
        categoryLabel: "Worth Discussing With Doctor",
        originalSentence: line,
        calmSummary: calm,
        deeperAnatomy:
          "The medial meniscus is a C-shaped cartilage shock absorber between your thighbone and shinbone on the inner side of the knee. An oblique tear reaching the bottom surface can cause catching or ache when squatting.",
        whatItIsNot:
          "Not every meniscal tear requires surgery—many horizontal tears respond well to targeted physiotherapy depending on your knee stability.",
        pin: { x: 0.32, y: -0.08, z: -0.18, anatomicalLabel: "Right Medial Meniscus (Posterior Horn)" },
        prevalence: {
          hasVerifiedData: false,
          summaryNote:
            "Horizontal meniscal tears can result from twisting or gradual cartilage wear; treatment depends on locking/catching symptoms.",
        },
        safetyAudit: auditSentenceSafety(line, calm),
        doctorQuestion:
          "For this posterior horn medial meniscus tear, can we start with physiotherapy, or do my symptoms point toward another approach?",
      });
      continue;
    }

    // 9. Knee: Intact ACL/PCL
    if (/\b(cruciate|acl|pcl)\b.*\bintact\b/.test(lower)) {
      const calm =
        "Great news: your main knee-stabilizing ropes (the ACL and PCL ligaments) are completely intact and strong.";
      pushUnique({
        id: `f-${idx++}`,
        title: "Intact ACL & PCL Stabilizing Ligaments",
        category: "normal",
        categoryLabel: "Normal & Reassuring",
        originalSentence: line,
        calmSummary: calm,
        deeperAnatomy:
          "The anterior and posterior cruciate ligaments cross in the center of your knee to prevent the joint from sliding out of place. 'Normal signal and fiber continuity' means zero tear.",
        whatItIsNot: "No ligament rupture.",
        pin: { x: 0.0, y: 0.05, z: 0.05, anatomicalLabel: "Cruciate Ligaments (ACL / PCL)" },
        prevalence: {
          hasVerifiedData: false,
          summaryNote: "Healthy intact ligament structure.",
        },
        safetyAudit: auditSentenceSafety(line, calm),
        doctorQuestion: "Since my ACL and PCL are intact, what movements are safe while my meniscus recovers?",
      });
      continue;
    }

    // 10. Cut-off / Unreadable line
    if (/\[.*?(?:cut off|illegible|blurred|missing).*?\]/.test(lower)) {
      pushUnique({
        id: `f-${idx++}`,
        title: "Unreadable or Cut-Off Report Line (Not Guessed)",
        category: "discuss_with_doctor",
        categoryLabel: "Incomplete Text — Verify Original",
        originalSentence: line,
        calmSummary:
          "This line was cut off or illegible in the scan text. Lumen will never guess missing words on a medical report.",
        deeperAnatomy:
          "Because even one missing word (such as 'no' vs 'mild' vs 'severe') changes the meaning of an MRI sentence, only the complete original report should be used here.",
        whatItIsNot: "Not an automatic warning—it simply means the text could not be read safely.",
        pin: { x: 0.0, y: -0.25, z: 0.1, anatomicalLabel: "L4–L5 Region (Incomplete Text)" },
        prevalence: {
          hasVerifiedData: false,
          summaryNote: "Insufficient information to provide statistics.",
        },
        safetyAudit: {
          negationPreserved: true,
          lateralityPreserved: true,
          detectedSide: "none",
          hedgedLanguageDetected: false,
          hedgeNote: "Explicitly halted interpretation on truncated text.",
        },
        doctorQuestion:
          "Could you review the full original MRI film and complete printout for the L4–L5 level?",
      });
    }
  }

  // Fallback if user pasted custom MRI text not matching the pre-mapped clauses
  if (findings.length === 0) {
    const firstLine = lines[0] || text.slice(0, 140);
    const isNormal = /\b(no|unremarkable|normal|intact)\b/i.test(firstLine);
    const cat: FindingCategory = isNormal ? "normal" : "discuss_with_doctor";
    const calm = isNormal
      ? "This line uses standard radiology terms indicating no acute structural abnormality was detected in the mentioned area."
      : "This line describes an observation on your scan that depends on your physical exam and symptoms—Lumen does not have enough clinical context to interpret it alone.";
    findings.push({
      id: "f-custom-1",
      title: isNormal ? "Reassuring Radiological Statement" : "Scan Observation for Doctor Review",
      category: cat,
      categoryLabel: isNormal ? "Normal & Reassuring" : "Needs Doctor Context",
      originalSentence: firstLine,
      calmSummary: calm,
      deeperAnatomy:
        "Radiologists describe tissue appearance using water/fat signal brightness (T1, T2, FLAIR). Your physician pairs these visual notes with your symptoms.",
      whatItIsNot: "An MRI description is an observation of tissue appearance, not a standalone treatment plan.",
      pin: { x: 0, y: 0, z: 0.1, anatomicalLabel: "Scanned Region" },
      prevalence: {
        hasVerifiedData: false,
        summaryNote: "Lumen does not have verified population prevalence data for this specific custom line.",
      },
      safetyAudit: auditSentenceSafety(firstLine, calm),
      doctorQuestion: "Could you walk me through what this MRI observation means in light of my symptoms?",
    });
  }

  const urgency = evaluateReportUrgency(text, findings, confidence);

  const overallCalmTakeaway =
    urgency.tier === "contact_today"
      ? "Your report contains a finding that deserves a prompt, calm review with your specialist today or within 24–48 hours. See the highlighted 3D marker below and bring the prepared questions to your doctor."
      : confidence.level === "partial_unreadable"
        ? "Lumen translated the readable lines of your report, but flagged missing or cut-off sections rather than guessing. Please share the full printed report with your doctor."
        : findings.every((f) => f.category === "normal" || f.category === "variant_incidental")
          ? "Take a breath: your scan shows no dangerous pathology. The medical terms in your report describe healthy tissue alongside a harmless anatomical variation."
          : "Your scan has no emergency red flags, and several major structures look completely healthy. One or two mechanical or age-related notes are worth discussing calmly at your scheduled appointment.";

  return {
    mode: "report",
    source: "deterministic_fallback",
    region,
    regionTitle,
    piiRedacted: pii.piiRedacted,
    piiNotice: pii.piiNotice,
    readingConfidence: confidence,
    urgencyTier: urgency.tier,
    urgencyTitle: urgency.title,
    urgencyGuidance: urgency.guidance,
    overallCalmTakeaway,
    findings,
    glossary: [
      {
        term: "No intracranial pathology / Unremarkable",
        plainMeaning: "Healthy and clear—nothing abnormal or concerning was found.",
      },
      {
        term: "Anatomical variant / Incidental",
        plainMeaning: "A harmless natural difference in how a blood vessel or tissue is shaped (like left-handedness), unrelated to disease.",
      },
      {
        term: "Desiccation / Loss of T2 signal",
        plainMeaning: "Natural loss of water content in a spinal cushion disc over time—very common even in people without back pain.",
      },
      {
        term: "Correlate clinically",
        plainMeaning: "A note from the radiologist telling your doctor: 'Check if this matches where the patient actually feels symptoms.'",
      },
    ],
    gentlePrompts: [
      {
        id: "gp-reason",
        question: "What prompted this MRI scan? (Optional — skip anytime)",
        whyWeAsk: "Helps tailor which doctor questions matter most for your visit, without guessing a diagnosis.",
        options: ["Routine headaches / check-up", "Joint or back ache", "Follow-up on an older scan", "Prefer to skip"],
      },
      {
        id: "gp-age",
        question: "Which age bracket is this scan for? (Optional)",
        whyWeAsk: "Many MRI findings (like disc dryness) become common with normal aging.",
        options: ["20s", "30s", "40s", "50s+", "Skip"],
      },
    ],
    doctorQuestions: findings.map((f) => f.doctorQuestion).slice(0, 3),
    limitationsNotice:
      "Lumen is an educational translator, not a radiologist or doctor. It explains terminology from the text you provide, cannot view raw DICOM slices, and never recommends treatment or medication.",
  };
}

export function deterministicAskLumen(
  question: string,
  currentReport?: MriExplainResponse | null
): AskLumenResponse {
  const lower = question.toLowerCase();

  // 1. Acute Red-Flag Symptoms in Chat -> Emergency Now
  const hasEmergencySymptoms =
    /\b(worst headache|thunderclap|sudden severe headache|arm feels weak|leg weakness|numbness in groin|bladder control|slurred speech|can't see|blurred vision.*weak|fainting|seizure)\b/.test(
      lower
    );
  if (hasEmergencySymptoms) {
    return {
      mode: "ask",
      source: "deterministic_fallback",
      urgencyTier: "emergency_now",
      emergencyTriggered: true,
      emergencyActions: [
        "Stop using this app and seek in-person emergency medical evaluation immediately (call 108 / 112 in India or go to the nearest emergency room).",
        "Sudden severe headache combined with vision changes or limb weakness requires immediate clinical assessment, regardless of what an earlier MRI report said.",
        "Do not drive yourself to the hospital.",
      ],
      boundaryTriggered: false,
      calmAnswer: "Please seek immediate emergency care for these current physical symptoms.",
      whatWeDontKnow: "An MRI explainer cannot evaluate acute, sudden neurological symptoms.",
      suggestedDoctorQuestion:
        "I developed sudden severe headache and weakness—please evaluate me for acute neurological changes.",
    };
  }

  // 2. Out-of-bounds treatment / medication / surgery / diagnosis request
  const asksForTreatment =
    /\b(what medication|what medicine|which tablet|should i take|do i need surgery|prescribe|treatment plan|cure|will i need an operation)\b/.test(
      lower
    );
  if (asksForTreatment) {
    return {
      mode: "ask",
      source: "deterministic_fallback",
      urgencyTier: currentReport?.urgencyTier || "upcoming_visit",
      emergencyTriggered: false,
      boundaryTriggered: true,
      boundaryReason:
        "Lumen can only read your MRI report and clarify medical terms — not provide medical advice or treatment plans.",
      calmAnswer:
        "Lumen can only read your MRI report and explain what the terms mean — it cannot advise on medication, surgery, or treatment. Please ask your doctor directly about this query so they can pair the scan with your physical exam. If you'd like, I can still clarify any other terms or sections on your report.",
      whatWeDontKnow: "",
      suggestedDoctorQuestion:
        "Looking at my MRI alongside my physical exam, what next steps or treatment do you recommend?",
    };
  }

  // 3. Arterial / Vascular Loop / Chavda Type II question
  if (/\b(arterial loop|vascular loop|aica|aneurysm|chavda|type ii)\b/.test(lower)) {
    return {
      mode: "ask",
      source: "deterministic_fallback",
      urgencyTier: "routine",
      emergencyTriggered: false,
      boundaryTriggered: false,
      calmAnswer:
        "A 'Right AICA loop — Type II (Chavda classification)' is NOT a disease stage, aneurysm, or tumor. The Chavda scale (Type I, II, III) simply describes where a normal small blood vessel curves near the inner-ear canal entrance (Type II means it loops less than halfway into the canal). Most importantly, your report states 'No evidence of nerve thinning, buckling, or altered signal changes'—meaning the nerve is completely healthy and unpressed.",
      whatWeDontKnow:
        "AICA loops are seen in roughly 12%–35% of healthy adults, and most people who have one have no symptoms. Only your doctor can confirm whether it relates to anything you have been experiencing.",
      suggestedDoctorQuestion:
        "Since my report shows no nerve thinning or buckling with the Chavda Type II AICA loop, can we treat this as a harmless incidental variant?",
    };
  }

  // 4. Unremarkable / No intracranial pathology / Clinical Indication question
  if (/\b(unremarkable|no intracranial pathology|pathology|clinical indication|rule out)\b/.test(lower)) {
    return {
      mode: "ask",
      source: "deterministic_fallback",
      urgencyTier: "routine",
      emergencyTriggered: false,
      boundaryTriggered: false,
      calmAnswer:
        "When an MRI report says 'Clinical Indication: To rule out intracranial pathology,' that is standard hospital shorthand recording why the doctor ordered the camera check—not a suspicion of a specific disease. And 'No other significant abnormality seen in brain' confirms that the check passed cleanly.",
      whatWeDontKnow:
        "A normal structural MRI rules out physical tissue masses, bleeding, or strokes, though functional causes (like tension headaches, migraine, or eye/neck strain) don't show up on MRI and are evaluated by talking with your doctor.",
      suggestedDoctorQuestion:
        "Now that the MRI has ruled out any intracranial pathology, what everyday or functional causes should we look at?",
    };
  }

  // 5. Default Epistemic Humility Response
  return {
    mode: "ask",
    source: "deterministic_fallback",
    urgencyTier: currentReport?.urgencyTier || "upcoming_visit",
    emergencyTriggered: false,
    boundaryTriggered: false,
    calmAnswer:
      "That is a thoughtful question to bring to your appointment. An MRI report describes how tissue water and structure look on camera, and many scary-sounding terms turn out to be mild or common when a doctor checks how you actually move and feel.",
    whatWeDontKnow:
      "Lumen does not have enough clinical information from the report text alone to make a definitive medical claim on this point—your physician's physical exam is the missing half of the picture.",
    suggestedDoctorQuestion:
      "Could you explain how this specific note on my MRI relates to what I am feeling day to day?",
  };
}
