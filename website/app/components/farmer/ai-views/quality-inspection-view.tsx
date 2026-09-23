"use client";

import { useState, useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { Camera, Loader2, ImageIcon, AlertTriangle, CheckCircle, XCircle, Mic, MicOff, Zap, Eye, RotateCcw, Download } from "lucide-react";
import { api } from "../../../lib/api/client";
import { cn } from "../../../lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Progress } from "../../../components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import toast from "react-hot-toast";

const GRADE_COLORS = {
  A: "bg-emerald-100 text-emerald-700 border-emerald-300",
  B: "bg-amber-100 text-amber-700 border-amber-300",
  C: "bg-red-100 text-red-700 border-red-300",
};

const GRADE_LABELS = {
  A: "Premium Quality",
  B: "Good Quality",
  C: "Needs Improvement",
};

const GRADE_DESCRIPTIONS = {
  A: "Excellent freshness, minimal damage, meets all export standards",
  B: "Good freshness, minor cosmetic issues, suitable for local markets",
  C: "Significant damage or freshness concerns, requires sorting",
};

interface QualityAssessment {
  estimatedGrade: "A" | "B" | "C";
  confidence: number;
  model: "quality_vision" | "heuristic";
  findings: string[];
  declaredGrade?: string;
  mismatch: boolean;
  recommendation: "manual_inspection" | "sample_verification" | "review_evidence";
  assessedAt: string;
}

interface InspectionData {
  freshness: number;
  damagedPct: number;
  photos: string[];
  weightKg: number;
  farmerDeclaredGrade?: string;
}

export function QualityInspectionView() {
  const [photos, setPhotos] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [formData, setFormData] = useState<InspectionData>({
    freshness: 85,
    damagedPct: 2,
    photos: [],
    weightKg: 0,
    farmerDeclaredGrade: "",
  });
  const [assessment, setAssessment] = useState<QualityAssessment | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceCommand, setVoiceCommand] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const analyzeMutation = useMutation({
    mutationFn: async (data: InspectionData) => {
      const response = await api.post("/ai/quality-check", data);
      return response;
    },
    onSuccess: (data) => {
      setAssessment(data.data || data);
      toast.success("Quality analysis complete!");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Quality analysis failed");
    },
  });

  const handlePhotoUpload = useCallback((files: FileList) => {
    const newFiles = Array.from(files).slice(0, 5 - photos.length);
    const validFiles = newFiles.filter((file) => file.type.startsWith("image/"));
    
    if (validFiles.length !== newFiles.length) {
      toast.error("Only image files are allowed");
    }
    
    const newPhotos = [...photos, ...validFiles];
    setPhotos(newPhotos);
    
    const newPreviews = validFiles.map((file) => URL.createObjectURL(file));
    setPreviewUrls((prev) => [...prev, ...newPreviews]);
    
    setFormData((prev) => ({ ...prev, photos: [...prev.photos, ...newPreviews] }));
  }, [photos.length]);

  const removePhoto = useCallback((index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
    setPreviewUrls((prev) => {
      URL.revokeObjectURL(prev[index]);
      return prev.filter((_, i) => i !== index);
    });
    setFormData((prev) => ({ ...prev, photos: prev.photos.filter((_, i) => i !== index) }));
  }, []);

  const handleAnalyze = () => {
    if (photos.length === 0) {
      toast.error("Please upload at least one photo");
      return;
    }
    if (formData.weightKg <= 0) {
      toast.error("Please enter the weight");
      return;
    }
    analyzeMutation.mutate(formData);
  };

  const handleVoiceStart = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      
      mediaRecorderRef.current.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };
      
      mediaRecorderRef.current.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const formData = new FormData();
        formData.append("audio", audioBlob);
        
        try {
          const response = await api.post("/ai/voice/transcribe", formData);
          setVoiceCommand(response.text || "");
          processVoiceCommand(response.text || "");
        } catch (error) {
          toast.error("Voice recognition failed");
        }
        
        stream.getTracks().forEach((track) => track.stop());
      };
      
      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (error) {
      toast.error("Microphone access denied");
    }
  };

  const handleVoiceStop = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const processVoiceCommand = (command: string) => {
    const lower = command.toLowerCase();
    
    if (lower.includes("freshness")) {
      const match = lower.match(/freshness\s*(\d+)/);
      if (match) setFormData((prev) => ({ ...prev, freshness: parseInt(match[1]) }));
    }
    if (lower.includes("damage") || lower.includes("damaged")) {
      const match = lower.match(/(damage|damaged)\s*(\d+)/);
      if (match) setFormData((prev) => ({ ...prev, damagedPct: parseInt(match[2]) }));
    }
    if (lower.includes("weight")) {
      const match = lower.match(/weight\s*(\d+(\.\d+)?)/);
      if (match) setFormData((prev) => ({ ...prev, weightKg: parseFloat(match[1]) }));
    }
    if (lower.includes("grade") || lower.includes("declare")) {
      const grades = ["a", "b", "c"];
      for (const grade of grades) {
        if (lower.includes(grade)) {
          setFormData((prev) => ({ ...prev, farmerDeclaredGrade: grade.toUpperCase() }));
          break;
        }
      }
    }
    if (lower.includes("analyze") || lower.includes("check") || lower.includes("inspect")) {
      handleAnalyze();
    }
  };

  const resetForm = () => {
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    setPhotos([]);
    setPreviewUrls([]);
    setFormData({
      freshness: 85,
      damagedPct: 2,
      photos: [],
      weightKg: 0,
      farmerDeclaredGrade: "",
    });
    setAssessment(null);
    setVoiceCommand("");
  };

  const getGradeBadge = (grade: "A" | "B" | "C") => (
    <Badge className={cn("text-lg px-4 py-2", GRADE_COLORS[grade])}>
      Grade {grade}
    </Badge>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Zap className="h-6 w-6 text-emerald-600" />
          AI Quality Inspection
        </h1>
        <p className="text-gray-500 mt-1">
          Upload produce photos for AI-powered quality grading. Uses computer vision when available,
          falls back to evidence-based heuristic assessment.
        </p>
      </div>

      <Tabs defaultValue="inspect" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="inspect">Inspect</TabsTrigger>
          <TabsTrigger value="voice">Voice Assistant</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="inspect" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Camera className="h-5 w-5" /> Photo Evidence
              </CardTitle>
              <CardDescription>Upload 1-5 clear photos of the produce from different angles</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                {previewUrls.map((url, index) => (
                  <div key={index} className="relative aspect-square group">
                    <img
                      src={url}
                      alt={`Photo ${index + 1}`}
                      className="w-full h-full object-cover rounded-lg border"
                    />
                    <button
                      onClick={() => removePhoto(index)}
                      className="absolute top-2 right-2 rounded-full bg-red-500 text-white p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <XCircle className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                {photos.length < 5 && (
                  <label className="relative aspect-square border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-emerald-400 transition-colors">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => e.target.files && handlePhotoUpload(e.target.files)}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                    />
                    <div className="flex flex-col items-center justify-center h-full text-gray-400">
                      <Camera className="h-10 w-10 mb-2" />
                      <span className="text-sm">Add Photo</span>
                      <span className="text-xs">({photos.length}/5)</span>
                    </div>
                  </label>
                )}
              </div>
              {photos.length > 0 && (
                <p className="mt-2 text-sm text-gray-500">
                  {photos.length} photo(s) uploaded. Drag to reorder (coming soon).
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Eye className="h-5 w-5" /> Quality Parameters
              </CardTitle>
              <CardDescription>Enter measured values or use voice commands</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Freshness Score (%)</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={formData.freshness}
                      onChange={(e) => setFormData((prev) => ({ ...prev, freshness: parseInt(e.target.value) }))}
                      className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                    />
                    <span className="text-lg font-bold text-emerald-600 w-16 text-right">
                      {formData.freshness}%
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">0% = Overripe, 100% = Just harvested</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Damage Percentage (%)</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="0"
                      max="50"
                      value={formData.damagedPct}
                      onChange={(e) => setFormData((prev) => ({ ...prev, damagedPct: parseInt(e.target.value) }))}
                      className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-red-500"
                    />
                    <span className="text-lg font-bold text-red-600 w-16 text-right">
                      {formData.damagedPct}%
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">% of produce with visible damage/bruising</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Weight (kg)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={formData.weightKg}
                    onChange={(e) => setFormData((prev) => ({ ...prev, weightKg: parseFloat(e.target.value) || 0 }))}
                    className="w-full"
                    placeholder="Enter total weight"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Declared Grade (Optional)</label>
                  <select
                    value={formData.farmerDeclaredGrade}
                    onChange={(e) => setFormData((prev) => ({ ...prev, farmerDeclaredGrade: e.target.value }))}
                    className="w-full"
                  >
                    <option value="">Select grade</option>
                    <option value="A">Grade A - Premium</option>
                    <option value="B">Grade B - Good</option>
                    <option value="C">Grade C - Standard</option>
                  </select>
                  <p className="text-xs text-gray-500">Your declared grade for comparison</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-4">
            <Button
              onClick={handleAnalyze}
              disabled={analyzeMutation.isPending || photos.length === 0 || formData.weightKg <= 0}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-lg py-3"
            >
              {analyzeMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Zap className="mr-2 h-5 w-5" />
                  Run AI Inspection
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={resetForm}
              className="px-6"
            >
              <RotateCcw className="mr-2 h-5 w-5" />
              Reset
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="voice" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mic className="h-5 w-5" /> Voice Assistant
              </CardTitle>
              <CardDescription>Control inspection hands-free with voice commands</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <Button
                  onClick={isRecording ? handleVoiceStop : handleVoiceStart}
                  variant={isRecording ? "destructive" : "default"}
                  size="lg"
                  className="h-16 w-16 rounded-full"
                >
                  {isRecording ? (
                    <MicOff className="h-8 w-8" />
                  ) : (
                    <Mic className="h-8 w-8" />
                  )}
                </Button>
                <div className="flex-1">
                  <p className={cn("font-medium", isRecording ? "text-red-600" : "text-gray-700")}>
                    {isRecording ? "Listening... Speak now" : "Tap to start voice command"}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">
                    {isRecording ? "Say: 'Freshness 90, damage 5, weight 25kg, grade A, analyze'" : "Try: 'Set freshness to 90 percent, damage 5 percent, weight 25 kilograms, declare grade A, then analyze'"}
                  </p>
                </div>
              </div>

              {voiceCommand && (
                <div className="p-4 bg-gray-50 rounded-lg border">
                  <p className="font-medium">Last command:</p>
                  <p className="text-gray-700 mt-1">"{voiceCommand}"</p>
                </div>
              )}

              <div className="grid gap-2 sm:grid-cols-2">
                <Button variant="outline" onClick={() => processVoiceCommand("Set freshness to 90 percent")}>
                  Freshness 90%
                </Button>
                <Button variant="outline" onClick={() => processVoiceCommand("Set damage to 2 percent")}>
                  Damage 2%
                </Button>
                <Button variant="outline" onClick={() => processVoiceCommand("Set weight to 25 kilograms")}>
                  Weight 25kg
                </Button>
                <Button variant="outline" onClick={() => processVoiceCommand("Declare grade A")}>
                  Grade A
                </Button>
                <Button variant="outline" onClick={() => processVoiceCommand("Analyze quality")}>
                  Analyze
                </Button>
                <Button variant="outline" onClick={() => processVoiceCommand("Reset form")}>
                  Reset
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ImageIcon className="h-5 w-5" /> Inspection History
              </CardTitle>
              <CardDescription>Previous quality assessments for this harvest lot</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <p className="text-center text-gray-500 py-8">No inspection history yet. Run your first analysis above.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {assessment && (
        <Card className={cn("border-l-4", assessment.mismatch && "border-l-amber-500")}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-emerald-600" />
              AI Assessment Result
              {assessment.mismatch && (
                <AlertTriangle className="h-5 w-5 text-amber-500 ml-2" />
              )}
            </CardTitle>
            <CardDescription>
              Model: {assessment.model === "quality_vision" ? "Computer Vision" : "Heuristic Analysis"} ·
              Confidence: {Math.round(assessment.confidence * 100)}%
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center gap-3">
                {getGradeBadge(assessment.estimatedGrade)}
                <div>
                  <p className="font-semibold text-gray-900">{GRADE_LABELS[assessment.estimatedGrade]}</p>
                  <p className="text-sm text-gray-500">{GRADE_DESCRIPTIONS[assessment.estimatedGrade]}</p>
                </div>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <Progress value={assessment.confidence * 100} className="w-48 h-2" />
                <span className="text-sm font-medium">{Math.round(assessment.confidence * 100)}%</span>
              </div>
            </div>

            {assessment.declaredGrade && (
              <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                <p className="font-medium text-blue-900">Grade Comparison</p>
                <div className="mt-2 flex items-center gap-4">
                  <div className="text-center">
                    <p className="text-xs text-gray-500">Your Declaration</p>
                    <Badge className={cn("text-lg", GRADE_COLORS[assessment.declaredGrade as "A" | "B" | "C"])}>
                      Grade {assessment.declaredGrade}
                    </Badge>
                  </div>
                  <span className="text-gray-400">vs</span>
                  <div className="text-center">
                    <p className="text-xs text-gray-500">AI Estimate</p>
                    {getGradeBadge(assessment.estimatedGrade)}
                  </div>
                </div>
                {assessment.mismatch && (
                  <p className="mt-2 text-amber-700 text-sm">
                    ⚠️ Mismatch detected: Farmer declared Grade {assessment.declaredGrade}, AI estimates Grade {assessment.estimatedGrade}.
                    Manual inspection required before "Verified" status.
                  </p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <p className="font-medium">Findings:</p>
              <ul className="space-y-1 pl-4">
                {assessment.findings.map((finding, i) => (
                  <li key={i} className="text-sm text-gray-600 flex items-start gap-2">
                    <span className="text-emerald-600 mt-1">•</span>
                    {finding}
                  </li>
                ))}
              </ul>
            </div>

            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="font-medium">Recommendation:</p>
              <p className="mt-1 text-gray-700">
                {assessment.recommendation === "manual_inspection" && (
                  <>
                    <span className="font-medium text-amber-700">Manual Inspection Required</span>
                    <span className="ml-2"> - Mismatch between declared and estimated grade. Schedule a physical inspection.</span>
                  </>
                )}
                {assessment.recommendation === "sample_verification" && (
                  <>
                    <span className="font-medium text-emerald-700">Sample Verification Sufficient</span>
                    <span className="ml-2"> - Declared grade consistent with evidence. Random sample check recommended.</span>
                  </>
                )}
                {assessment.recommendation === "review_evidence" && (
                  <>
                    <span className="font-medium text-blue-700">Review Evidence Needed</span>
                    <span className="ml-2"> - Insufficient evidence. Add more photos and verified weight before verification.</span>
                  </>
                )}
              </p>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1">
                <Download className="mr-2 h-4 w-4" />
                Download Report
              </Button>
              <Button variant="outline" className="flex-1" onClick={resetForm}>
                <RotateCcw className="mr-2 h-4 w-4" />
                New Inspection
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}