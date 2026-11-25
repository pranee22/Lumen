export type BodyRegion =
  | "brain"
  | "spine_lumbar"
  | "knee"
  | "shoulder"
  | "abdomen"
  | "unknown";

export type FindingCategory =
  | "normal"
  | "variant_incidental"
  | "discuss_with_doctor"
  | "prompt_attention";

export type UrgencyTier =
  | "routine"
  | "upcoming_visit"
  | "contact_today"
  | "emergency_now";

export interface SpatialPin {
  x: number; // -1 to 1 in normalized 3D model space
  y: number; // -1 to 1
  z: number; // -1 to 1
  anatomicalLabel: string;
}

export interface PrevalenceContext {
  hasVerifiedData: boolean;
  citation?: string;
  percentageByAge?: Record<string, number>;
  summaryNote: string;
}

export interface SafetyAudit {
  negationPreserved: boolean;
  lateralityPreserved: boolean;
  detectedSide: "left" | "right" | "bilateral" | "midline" | "none";
  hedgedLanguageDetected: boolean;
  hedgeNote?: string;
}

export interface MriFinding {
  id: string;
  title: string;
  category: FindingCategory;
  categoryLabel: string;
  originalSentence: string;
  calmSummary: string;
  deeperAnatomy: string;
  whatItIsNot: string;
  pin: SpatialPin;
  prevalence: PrevalenceContext;
  safetyAudit: SafetyAudit;
  doctorQuestion: string;
}

export interface ReadingConfidence {
  scorePercent: number;
  level: "high" | "moderate" | "partial_unreadable";
  sectionsDetected: string[];
  missingOrUnreadable: string[];
  explanation: string;
}

export interface GentleContextPrompt {
  id: string;
  question: string;
  whyWeAsk: string;
  options: string[];
}

export interface MriExplainResponse {
  mode: "report";
  source: "gemini" | "deterministic_fallback";
  region: BodyRegion;
  regionTitle: string;
  piiRedacted: boolean;
  piiNotice?: string;
  readingConfidence: ReadingConfidence;
  urgencyTier: UrgencyTier;
  urgencyTitle: string;
  urgencyGuidance: string;
  overallCalmTakeaway: string;
  contextNote?: string;
  findings: MriFinding[];
  glossary: Array<{ term: string; plainMeaning: string }>;
  gentlePrompts: GentleContextPrompt[];
  doctorQuestions: string[];
  limitationsNotice: string;
}

export interface AskLumenResponse {
  mode: "ask";
  source: "gemini" | "deterministic_fallback";
  urgencyTier: UrgencyTier;
  emergencyTriggered: boolean;
  emergencyActions?: string[];
  boundaryTriggered: boolean;
  boundaryReason?: string;
  calmAnswer: string;
  whatWeDontKnow: string;
  suggestedDoctorQuestion: string;
}
