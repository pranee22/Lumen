"use client";

import React, { useRef, useState } from "react";
import {
  AlertOctagon,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  FileText,
  Paperclip,
  Send,
  Upload,
  X,
} from "lucide-react";
import { Mri3DRegionViewer } from "@/components/Mri3DRegionViewer";
import { AskLumenResponse, MriExplainResponse } from "@/lib/types";

interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
  attachmentName?: string;
  subNote?: string;
  doctorQuestion?: string;
  isEmergency?: boolean;
  emergencyActions?: string[];
  isBoundary?: boolean;
  quickReplies?: string[];
}

type SheetState = "resting" | "discuss" | "expanded";

export default function LumenApp() {
  const [screen, setScreen] = useState<"setup" | "result">("setup");

  // Screen 1 Inputs (No embedded samples — real file upload or paste + free-text optional context!)
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [reportText, setReportText] = useState<string>("");
  const [filmPreviewUrl, setFilmPreviewUrl] = useState<string | null>(null);
  const [filmFileName, setFilmFileName] = useState<string | null>(null);
  const [ageInput, setAgeInput] = useState<string>("");
  const [userContext, setUserContext] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Screen 2–4 State (Variant 2 Progressive Bottom Sheet)
  const [explainData, setExplainData] = useState<MriExplainResponse | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number>(0);
  const [sheetState, setSheetState] = useState<SheetState>("resting");
  const [showOriginalLine, setShowOriginalLine] = useState<boolean>(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState<string>("");
  const [chatFile, setChatFile] = useState<File | null>(null);
  const [isSending, setIsSending] = useState<boolean>(false);

  const dragStartY = useRef<number | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const handleFilmSelect = (file: File) => {
    if (filmPreviewUrl) URL.revokeObjectURL(filmPreviewUrl);
    setFilmPreviewUrl(URL.createObjectURL(file));
    setFilmFileName(file.name);
  };

  const buildInitialPromptFromReport = (data: MriExplainResponse): ChatMessage => {
    const notable = data.findings.find((f) => f.category !== "normal") || data.findings[0];
    const replies: string[] = [];
    if (notable) {
      replies.push(`Tell me more about ${notable.title}`);
    }
    if (userContext.trim()) {
      replies.push("How does this report relate to what I shared?");
    } else {
      replies.push("Are there any findings I should focus on?");
    }
    return {
      id: "init-ai",
      role: "assistant",
      text: "Ask me about any finding or medical term on your report, or attach another document below to discuss it alongside this scan.",
      quickReplies: replies,
    };
  };

  const resolveAgeBracket = (rawAge: string): string => {
    const n = parseInt(rawAge, 10);
    if (Number.isNaN(n)) return "";
    if (n < 30) return "20s";
    if (n < 40) return "30s";
    if (n < 50) return "40s";
    if (n < 60) return "50s";
    return "60s";
  };

  const handleAnalyze = async () => {
    if (!reportFile && !reportText.trim()) return;
    setIsLoading(true);
    setErrorMsg(null);
    const computedAge = resolveAgeBracket(ageInput);
    try {
      let res: Response;
      if (reportFile) {
        const form = new FormData();
        form.append("mode", "report");
        form.append("file", reportFile);
        form.append("text", reportText);
        form.append("ageBracket", computedAge);
        form.append("exactAge", ageInput.trim());
        form.append("userContext", userContext);
        res = await fetch("/api/explain", { method: "POST", body: form });
      } else {
        res = await fetch("/api/explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "report",
            text: reportText,
            ageBracket: computedAge,
            exactAge: ageInput.trim(),
            userContext,
          }),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || "Could not read this report.");
        return;
      }

      setExplainData(data);
      setSelectedIdx(0);
      setSheetState("resting");
      setShowOriginalLine(false);
      setMessages([buildInitialPromptFromReport(data)]);
      setScreen("result");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendChat = async (customText?: string) => {
    const q = (customText ?? chatInput).trim();
    const attached = customText ? null : chatFile;
    if ((!q && !attached) || isSending) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      text: q || `Attached ${attached?.name}`,
      attachmentName: attached?.name,
    };
    const recentHistory = messages
      .slice(-6)
      .map((m) => ({ role: m.role, text: m.text }));

    setMessages((prev) => [...prev, userMsg]);
    setChatInput("");
    setChatFile(null);
    setIsSending(true);
    if (sheetState === "resting") setSheetState("discuss");
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 40);

    try {
      let res: Response;
      if (attached) {
        const form = new FormData();
        form.append("mode", "ask");
        form.append("question", q);
        form.append("file", attached);
        form.append("userContext", userContext);
        form.append("exactAge", ageInput.trim());
        form.append("ageBracket", resolveAgeBracket(ageInput));
        form.append("history", JSON.stringify(recentHistory));
        if (explainData) {
          form.append("currentReport", JSON.stringify(explainData));
        }
        res = await fetch("/api/explain", { method: "POST", body: form });
      } else {
        res = await fetch("/api/explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "ask",
            question: q,
            currentReport: explainData,
            userContext,
            exactAge: ageInput.trim(),
            ageBracket: resolveAgeBracket(ageInput),
            history: recentHistory,
          }),
        });
      }
      const data: AskLumenResponse = await res.json();
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: data.calmAnswer,
          subNote: data.whatWeDontKnow || undefined,
          doctorQuestion: data.suggestedDoctorQuestion || undefined,
          isEmergency: data.emergencyTriggered,
          emergencyActions: data.emergencyActions,
          isBoundary: data.boundaryTriggered,
          quickReplies: data.boundaryTriggered
            ? ["Explain another term on my report", "What did the normal sections show?"]
            : undefined,
        },
      ]);
    } finally {
      setIsSending(false);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
    }
  };

  // Drag-handle gesture for Material 3 bottom sheet (drag up -> expanded full view; drag down -> resting 3D view)
  const handleSheetPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStartY.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleSheetPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartY.current === null) return;
    const delta = e.clientY - dragStartY.current;
    dragStartY.current = null;
    if (delta < -30) {
      setSheetState("expanded");
    } else if (delta > 30) {
      setSheetState("resting");
    } else {
      // Simple tap on drag handle toggles expanded <-> resting
      setSheetState((prev) => (prev === "expanded" ? "resting" : "expanded"));
    }
  };

  const activeFinding = explainData?.findings[selectedIdx] || explainData?.findings[0] || null;
  const needsAlert =
    explainData &&
    (explainData.urgencyTier === "contact_today" || explainData.urgencyTier === "emergency_now");

  return (
    <div className="min-h-screen bg-[#E9F1F1] py-0 sm:py-6">
      {/* Pure Sans-Serif 390px Mobile Frame (Apple Health x One UI x Material 3) */}
      <div className="mx-auto flex h-screen max-w-[390px] flex-col overflow-hidden bg-[#F4F9F9] shadow-xl sm:h-[844px] sm:rounded-[34px] sm:border sm:border-[#D6E6E6]">
        {/* ============================================================= */}
        {/* SCREEN 1: INTAKE & UPFRONT FREE-TEXT CONTEXT                  */}
        {/* ============================================================= */}
        {screen === "setup" && (
          <div className="flex h-full flex-col justify-between">
            {/* Samsung One UI Top Viewing Area */}
            <div className="px-6 pt-8 pb-5">
              <div className="flex items-center gap-2">
                <svg width="22" height="22" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                  {/* MRI Scanner Gantry Bore Arch */}
                  <path
                    d="M4 21V13.5C4 7.98 8.48 3.5 14 3.5C19.52 3.5 24 7.98 24 13.5V21"
                    stroke="#0E4F4F"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  {/* Inner Axial Magnetic Field / Tomographic Slice Ring */}
                  <circle
                    cx="14"
                    cy="13.5"
                    r="5.5"
                    stroke="#0E4F4F"
                    strokeWidth="1.6"
                    strokeDasharray="3.2 2"
                  />
                  {/* Brain / Cross-Section Slice Plane & Patient Table */}
                  <ellipse cx="14" cy="13.5" rx="2.6" ry="3.2" stroke="#0E4F4F" strokeWidth="1.5" />
                  <path
                    d="M2.5 22.5H25.5"
                    stroke="#0E4F4F"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <path
                    d="M8.5 19.5H19.5"
                    stroke="#0E4F4F"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
                <span className="text-sm font-semibold tracking-tight text-[#0E4F4F]">Lumen</span>
              </div>
              <h1 className="mt-4 text-2xl font-semibold tracking-tight text-[#18181B]">
                Understand your MRI report
              </h1>
              <p className="mt-1.5 text-xs leading-relaxed text-[#52525B]">
                Please upload your report PDF or photo, or paste the text below.
              </p>
            </div>

            {/* Bottom Thumb-Zone Sheet */}
            <div className="flex flex-1 flex-col justify-between overflow-y-auto rounded-t-[28px] bg-white px-5 pt-5 pb-5 shadow-sm">
              <div className="space-y-5">
                {/* Report File Upload + Paste + Grouped MRI Film Sheet */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#18181B]">MRI Report</span>
                    <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-[#0E4F4F] hover:underline">
                      <Upload className="h-3.5 w-3.5" />
                      <span>{reportFile ? "Change file" : "Upload PDF / Photo"}</span>
                      <input
                        type="file"
                        accept=".pdf,.txt,image/*"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) setReportFile(f);
                        }}
                        className="hidden"
                      />
                    </label>
                  </div>

                  {reportFile && (
                    <div className="flex items-center justify-between rounded-xl bg-[#F4F9F9] px-3 py-2 text-xs text-[#0E4F4F]">
                      <span className="flex items-center gap-1.5 truncate font-medium">
                        <FileText className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{reportFile.name}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setReportFile(null)}
                        className="ml-2 text-[11px] text-[#52525B] hover:text-[#DC2626]"
                      >
                        Remove
                      </button>
                    </div>
                  )}

                  <textarea
                    rows={4}
                    value={reportText}
                    onChange={(e) => setReportText(e.target.value)}
                    placeholder="Or paste your MRI report text here..."
                    className="w-full rounded-2xl border border-[#E4E4E7] bg-[#F9FBFB] p-3 text-xs leading-relaxed text-[#18181B] placeholder:text-[#A1A1AA] focus:border-[#0E4F4F] focus:bg-white focus:outline-none"
                  />

                  {/* Optional MRI Film Upload — Tightly grouped with MRI Report */}
                  <div className="flex items-center justify-between px-0.5 pt-0.5 text-xs">
                    <span className="truncate text-[#52525B]">
                      {filmFileName ? `Film: ${filmFileName}` : "MRI film sheet (optional)"}
                    </span>
                    <label className="ml-2 shrink-0 cursor-pointer font-semibold text-[#0E4F4F] hover:underline">
                      <span>{filmFileName ? "Replace" : "Attach film"}</span>
                      <input
                        type="file"
                        accept=".pdf,image/*"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleFilmSelect(f);
                        }}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>

                {/* Optional details: Clearly separated below MRI Report group */}
                <div className="space-y-2.5 border-t border-[#F1F5F5] pt-3.5">
                  <p className="text-xs font-semibold text-[#18181B]">Optional details</p>

                  <div className="flex items-center gap-2.5">
                    <label htmlFor="age-input" className="text-xs font-medium text-[#52525B]">
                      Age
                    </label>
                    <input
                      id="age-input"
                      type="number"
                      min={1}
                      max={120}
                      value={ageInput}
                      onChange={(e) => setAgeInput(e.target.value)}
                      placeholder="e.g. 24"
                      className="w-24 rounded-xl border border-[#E4E4E7] bg-[#F9FBFB] px-3 py-1.5 text-xs tabular-nums text-[#18181B] placeholder:text-[#A1A1AA] focus:border-[#0E4F4F] focus:bg-white focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="ctx-input" className="block text-xs font-medium text-[#52525B]">
                      What&apos;s bothering you?
                    </label>
                    <textarea
                      id="ctx-input"
                      rows={2}
                      value={userContext}
                      onChange={(e) => {
                        setUserContext(e.target.value);
                        e.target.style.height = "auto";
                        e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                      }}
                      placeholder="e.g., severe migraine, lower back ache, routine check..."
                      className="w-full resize-none rounded-xl border border-[#E4E4E7] bg-[#F9FBFB] px-3.5 py-2.5 text-xs leading-relaxed text-[#18181B] placeholder:text-[#A1A1AA] focus:border-[#0E4F4F] focus:bg-white focus:outline-none"
                    />
                  </div>
                </div>

                {errorMsg && <p className="text-xs text-[#DC2626]">{errorMsg}</p>}
              </div>

              <div className="space-y-2.5 pt-4">
                <button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={isLoading || (!reportFile && !reportText.trim())}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-[#0E4F4F] py-3 text-xs font-semibold text-white hover:bg-[#115E59] disabled:opacity-40"
                >
                  <span>{isLoading ? "Reading report..." : "Explain my report"}</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
                <p className="text-center text-[10px] leading-relaxed text-[#71717A]">
                  Plain-language report summary, not medical advice.
                  <br />
                  Always review with your doctor. None of your private data is stored.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================= */}
        {/* SCREENS 2–4: 3D HERO + PROGRESSIVE DRAGGABLE BOTTOM SHEET     */}
        {/* ============================================================= */}
        {screen === "result" && explainData && activeFinding && (
          <div className="flex h-full flex-col justify-between overflow-hidden">
            {/* Minimal Header */}
            <header className="flex shrink-0 items-center justify-between px-4 pt-3.5 pb-1">
              <div className="flex items-center gap-1.5">
                <svg width="18" height="18" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                  <path
                    d="M4 21V13.5C4 7.98 8.48 3.5 14 3.5C19.52 3.5 24 7.98 24 13.5V21"
                    stroke="#0E4F4F"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <circle
                    cx="14"
                    cy="13.5"
                    r="5.5"
                    stroke="#0E4F4F"
                    strokeWidth="1.6"
                    strokeDasharray="3.2 2"
                  />
                  <ellipse cx="14" cy="13.5" rx="2.6" ry="3.2" stroke="#0E4F4F" strokeWidth="1.5" />
                  <path d="M2.5 22.5H25.5" stroke="#0E4F4F" strokeWidth="2" strokeLinecap="round" />
                  <path d="M8.5 19.5H19.5" stroke="#0E4F4F" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                <span className="text-sm font-semibold tracking-tight text-[#0E4F4F]">Lumen</span>
              </div>
              <div className="flex items-center gap-2.5 text-[11px]">
                <span className="text-[#5F7878]">
                  {explainData.readingConfidence.scorePercent}% read
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setScreen("setup");
                    setSheetState("resting");
                    setErrorMsg(null);
                    setChatFile(null);
                    setShowOriginalLine(false);
                  }}
                  className="rounded-full border border-[#DCEAEA] bg-white px-2.5 py-1 font-medium text-[#18181B]"
                >
                  New scan
                </button>
              </div>
            </header>

            {/* Passive-by-Default Alert: ONLY shown if finding needs prompt attention or partial read! */}
            {needsAlert && (
              <div className="mx-4 mt-1.5 shrink-0 rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-xs font-medium text-[#B91C1C]">
                {explainData.urgencyTitle}
              </div>
            )}

            {explainData.readingConfidence.missingOrUnreadable.length > 0 && (
              <div className="mx-4 mt-1.5 shrink-0 rounded-xl bg-[#FEF3C7] px-3 py-2 text-[11px] text-[#92400E]">
                <strong>Incomplete scan:</strong>{" "}
                {explainData.readingConfidence.missingOrUnreadable[0]}
              </div>
            )}

            {/* Top Viewing Area: Clickable Three.js 3D Model OR Direct Film Viewer (Hidden when sheet is dragged to Full View) */}
            {sheetState !== "expanded" && (
              <div className="shrink-0">
                <Mri3DRegionViewer
                  region={explainData.region}
                  regionTitle={explainData.regionTitle}
                  findings={explainData.findings}
                  selectedFindingId={activeFinding.id}
                  onSelectFinding={(id) => {
                    const idx = explainData.findings.findIndex((f) => f.id === id);
                    if (idx >= 0) setSelectedIdx(idx);
                  }}
                  filmPreviewUrl={filmPreviewUrl}
                  filmFileName={filmFileName}
                  onUploadFilm={handleFilmSelect}
                  compact={sheetState === "discuss"}
                />
              </div>
            )}

            {/* Material 3 Draggable Bottom Sheet (28px top radius) */}
            <div className="flex flex-1 flex-col overflow-hidden rounded-t-[28px] border-t border-[#DCEAEA] bg-white shadow-sm">
              {/* 48dp Accessible Drag Handle */}
              <div
                onPointerDown={handleSheetPointerDown}
                onPointerUp={handleSheetPointerUp}
                className="flex shrink-0 cursor-ns-resize flex-col items-center justify-center py-2.5 select-none"
                title="Drag up for full view or tap to toggle"
              >
                <div className="h-1 w-10 rounded-full bg-[#D4D4D8]" />
                <span className="mt-1 text-[10px] text-[#71717A]">
                  {sheetState === "expanded"
                    ? "Drag down or tap to return to 3D"
                    : "Drag up for full details & chat"}
                </span>
              </div>

              {/* Scrollable Sheet Body */}
              <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-3.5">
                {/* Tailored Note from Optional Details — Placed Above Finding Category */}
                {explainData.contextNote && (
                  <div className="rounded-xl bg-[#F4F9F9] px-3.5 py-2.5 text-xs leading-relaxed text-[#52525B]">
                    <span className="font-semibold text-[#0E4F4F]">Based on what you shared: </span>
                    <span>{explainData.contextNote}</span>
                  </div>
                )}

                {/* Finding Stepper Header (1 of N) */}
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#0E4F4F]">
                    {activeFinding.categoryLabel}
                  </span>
                  {explainData.findings.length > 1 && (
                    <div className="flex items-center gap-1.5 text-[11px] text-[#52525B]">
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedIdx((i) =>
                            i === 0 ? explainData.findings.length - 1 : i - 1
                          )
                        }
                        aria-label="Previous finding"
                        className="rounded-full p-1 hover:bg-[#F4F9F9]"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                      <span className="tabular-nums">
                        {selectedIdx + 1} of {explainData.findings.length}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedIdx((i) => (i + 1) % explainData.findings.length)
                        }
                        aria-label="Next finding"
                        className="rounded-full p-1 hover:bg-[#F4F9F9]"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Active Finding Summary + Directly Linked Original Line */}
                <div className="space-y-2">
                  <h2 className="text-base font-semibold text-[#18181B]">
                    {activeFinding.title}
                  </h2>
                  <p className="text-xs leading-relaxed text-[#52525B]">
                    {activeFinding.calmSummary}
                  </p>
                  {(sheetState === "expanded" || showOriginalLine) && (
                    <p className="rounded-xl bg-[#F9FBFB] border border-[#EDF5F5] px-3 py-2 text-xs leading-relaxed text-[#52525B]">
                      <span className="font-semibold text-[#18181B]">Original line: </span>
                      &ldquo;{activeFinding.originalSentence}&rdquo;
                    </p>
                  )}
                </div>

                {/* Expanded View Extras: Consistent Open Sans Typography & Uniform Spacing */}
                {sheetState === "expanded" && (
                  <div className="space-y-3 border-t border-[#EDF5F5] pt-3 text-xs leading-relaxed text-[#52525B]">
                    {activeFinding.deeperAnatomy && (
                      <div>
                        <p className="font-semibold text-[#18181B]">What it means</p>
                        <p className="mt-0.5">{activeFinding.deeperAnatomy}</p>
                      </div>
                    )}
                    {activeFinding.whatItIsNot && (
                      <div>
                        <p className="font-semibold text-[#18181B]">Good to know</p>
                        <p className="mt-0.5">{activeFinding.whatItIsNot}</p>
                      </div>
                    )}
                    {activeFinding.prevalence.hasVerifiedData && (
                      <div>
                        <p className="font-semibold text-[#18181B]">How common</p>
                        <p className="mt-0.5">{activeFinding.prevalence.summaryNote}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* STATE 1 (RESTING): Original Line Toggle + "Discuss further" Button */}
                {sheetState === "resting" && (
                  <div className="flex items-center justify-between pt-1 text-xs">
                    <button
                      type="button"
                      onClick={() => setShowOriginalLine((v) => !v)}
                      className="font-medium text-[#0E4F4F] hover:underline"
                    >
                      {showOriginalLine ? "Hide original line" : "Original line"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSheetState("discuss")}
                      className="rounded-full bg-[#0E4F4F] px-4 py-2 font-semibold text-white hover:bg-[#115E59]"
                    >
                      Discuss further
                    </button>
                  </div>
                )}

                {/* STATE 2 & 3 (DISCUSS INLINE OR EXPANDED FULL VIEW): Multi-Turn Chat Thread */}
                {(sheetState === "discuss" || sheetState === "expanded") && (
                  <div className="space-y-3 border-t border-[#EDF5F5] pt-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-[#52525B]">
                        Discussion
                      </span>
                    </div>

                    {messages.map((m) => (
                      <div
                        key={m.id}
                        className={`flex flex-col ${
                          m.role === "user" ? "items-end" : "items-start"
                        }`}
                      >
                        {m.isEmergency ? (
                          <div className="w-full rounded-2xl border-2 border-[#DC2626] bg-[#FEF2F2] p-3 text-xs text-[#991B1B]">
                            <div className="flex items-start gap-2">
                              <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-[#DC2626]" />
                              <div>
                                <p className="font-bold">Seek immediate emergency care (108 / 112)</p>
                                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                                  {m.emergencyActions?.map((a, i) => (
                                    <li key={i}>{a}</li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div
                            className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
                              m.role === "user"
                                ? "bg-[#0E4F4F] text-white"
                                : "bg-[#F4F9F9] text-[#18181B]"
                            }`}
                          >
                            {m.isBoundary && (
                              <p className="mb-1 text-[11px] font-semibold text-[#B45309]">
                                Report clarification only — ask your doctor for medical advice
                              </p>
                            )}
                            {m.attachmentName && (
                              <p className="mb-1 flex items-center gap-1 text-[10px] opacity-85">
                                <FileText className="h-3 w-3 shrink-0" />
                                <span className="truncate">{m.attachmentName}</span>
                              </p>
                            )}
                            <p>{m.text}</p>
                            {m.subNote && (
                              <p className="mt-1.5 text-[11px] text-[#5F7878]">{m.subNote}</p>
                            )}
                            {m.doctorQuestion && (
                              <p className="mt-1.5 text-[11px] font-medium text-[#0E4F4F]">
                                Ask your doctor: &ldquo;{m.doctorQuestion}&rdquo;
                              </p>
                            )}
                          </div>
                        )}

                        {m.quickReplies && m.quickReplies.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {m.quickReplies.map((qr) => (
                              <button
                                key={qr}
                                type="button"
                                onClick={() => handleSendChat(qr)}
                                className="rounded-full border border-[#CBE0E0] bg-white px-3 py-1 text-[11px] font-medium text-[#0E4F4F] hover:bg-[#EDF6F6]"
                              >
                                {qr}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}

                    {isSending && (
                      <div className="flex items-start">
                        <div className="inline-flex items-center gap-1.5 rounded-2xl bg-[#F4F9F9] px-3.5 py-2.5 text-xs text-[#5F7878]">
                          <span>Thinking</span>
                          <span className="inline-flex gap-0.5">
                            <span className="h-1 w-1 animate-bounce rounded-full bg-[#0E4F4F] [animation-delay:-0.2s]" />
                            <span className="h-1 w-1 animate-bounce rounded-full bg-[#0E4F4F] [animation-delay:-0.1s]" />
                            <span className="h-1 w-1 animate-bounce rounded-full bg-[#0E4F4F]" />
                          </span>
                        </div>
                      </div>
                    )}

                    <div ref={chatEndRef} />
                  </div>
                )}
              </div>

              {/* Pinned Bottom Ask Bar (With File Attachment) + Unified Quiet Disclaimer */}
              <div className="shrink-0 border-t border-[#EDF5F5] bg-white px-4 pt-2.5 pb-3 space-y-2">
                {(sheetState === "discuss" || sheetState === "expanded") && (
                  <div className="space-y-1.5">
                    {chatFile && (
                      <div className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[#F4F9F9] px-3 py-1 text-[11px] text-[#0E4F4F]">
                        <FileText className="h-3 w-3 shrink-0" />
                        <span className="truncate">{chatFile.name}</span>
                        <button
                          type="button"
                          onClick={() => setChatFile(null)}
                          aria-label="Remove attached file"
                          className="ml-0.5 text-[#5F7878] hover:text-[#DC2626]"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleSendChat();
                      }}
                      className="flex items-center gap-2"
                    >
                      <label
                        title="Attach another report, scan, or lab note"
                        className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-[#DCEAEA] bg-[#F4F9F9] text-[#0E4F4F] hover:bg-[#EDF5F5]"
                      >
                        <Paperclip className="h-3.5 w-3.5" />
                        <input
                          type="file"
                          accept=".pdf,.txt,image/*"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) setChatFile(f);
                            e.target.value = "";
                          }}
                          className="hidden"
                        />
                      </label>
                      <input
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        placeholder="Ask anything or attach another file..."
                        className="flex-1 rounded-full border border-[#DCEAEA] bg-[#F4F9F9] px-3.5 py-2 text-xs text-[#18181B] placeholder:text-[#71717A] focus:border-[#0E4F4F] focus:bg-white focus:outline-none"
                      />
                      <button
                        type="submit"
                        disabled={isSending || (!chatInput.trim() && !chatFile)}
                        aria-label="Send"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0E4F4F] text-white disabled:opacity-40"
                      >
                        <Send className="h-3.5 w-3.5" />
                      </button>
                    </form>
                  </div>
                )}
                <p className="text-center text-[10px] leading-relaxed text-[#71717A]">
                  Plain-language report summary, not medical advice.
                  <br />
                  Always review with your doctor. None of your private data is stored.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
