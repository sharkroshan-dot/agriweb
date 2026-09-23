"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api/client";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { CheckCircle2, ChevronRight, Clock, Loader2, MessageSquare, Smartphone, CreditCard, MapPin, Landmark, UploadCloud, XCircle } from "lucide-react";
import Link from "next/link";
import toast from "react-hot-toast";

export interface VerificationInfo {
  status: Record<string, boolean>;
  trustScore: number;
  kycStatus?: string | null;
  bankStatus?: string | null;
  role?: string;
}

export interface KYCDocument {
  type: string;
  documentNumber?: string;
  imageUrl: string;
}

export interface KYCExisting {
  farmName?: string;
  farmAddress?: string;
  farmCity?: string;
  farmState?: string;
  farmPincode?: string;
  farmSizeAcres?: number;
  documents?: KYCDocument[];
  bankAccount?: {
    accountHolderName?: string;
    accountNumber?: string;
    ifscCode?: string;
    bankName?: string;
  };
}

export function useVerificationStatus() {
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken;
  const queryClient = useQueryClient();

  const { data: flags, isLoading } = useQuery({
    queryKey: ["verificationStatus"],
    queryFn: async () => {
      const res = await api.get("/kyc/verification-status");
      return ((res as any)?.data ?? (res as any) ?? {}) as VerificationInfo;
    },
    enabled: Boolean(accessToken),
  });

  const { data: existing } = useQuery<KYCExisting | null, Error>({
    queryKey: ["kycStatus"],
    queryFn: async (): Promise<KYCExisting | null> => {
      const res = await api.get("/kyc/status");
      return ((res as any)?.data ?? (res as any) ?? null) as KYCExisting | null;
    },
    enabled: Boolean(accessToken),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["verificationStatus"] });
    queryClient.invalidateQueries({ queryKey: ["kycStatus"] });
    queryClient.invalidateQueries({ queryKey: ["farmerTrustScore"] });
    queryClient.invalidateQueries({ queryKey: ["securityCenter"] });
  };

  const info = flags ?? ({} as VerificationInfo);
  return {
    isLoading,
    status: info.status ?? {},
    trustScore: info.trustScore ?? 0,
    kycStatus: info.kycStatus ?? null,
    bankStatus: info.bankStatus ?? null,
    role: info.role,
    existing,
    refresh,
  };
}

function StepStateBadge({ state, rejectedReason }: { state: "done" | "review" | "rejected"; rejectedReason?: string }) {
  if (state === "done") {
    return (
      <Badge variant="success" className="gap-1">
        <CheckCircle2 className="h-3 w-3" /> Verified
      </Badge>
    );
  }
  if (state === "rejected") {
    return (
      <Badge variant="destructive" className="gap-1" title={rejectedReason || "Documents need correction"}>
        <XCircle className="h-3 w-3" /> Rejected — retry
      </Badge>
    );
  }
  return (
    <Badge variant="warning" className="gap-1">
      <Clock className="h-3 w-3" /> Under review
    </Badge>
  );
}

const VERIFICATION_STEPS = [
  { key: "mobile", label: "Mobile number", desc: "Verify the phone number on your account.", icon: Smartphone, href: "/farmer/verification/mobile" },
  { key: "identity", label: "Government ID", desc: "Upload Aadhaar and PAN to verify your identity.", icon: CreditCard, href: "/farmer/verification/identity" },
  { key: "farm", label: "Farm / land", desc: "Record your farm details and land ownership document.", icon: MapPin, href: "/farmer/verification/farm" },
  { key: "bank", label: "Bank details", desc: "Add the payout account used for settlements.", icon: Landmark, href: "/farmer/verification/bank" },
];

export function VerificationStepsList() {
  const { isLoading, status, kycStatus, bankStatus } = useVerificationStatus();

  const stepState = (key: string): "done" | "review" | "todo" => {
    if (status[key]) return "done";
    if (key === "bank") {
      if (bankStatus && bankStatus !== "verified") return "review";
      return "todo";
    }
    if (kycStatus === "submitted") return "review";
    return "todo";
  };

  return (
    <div className="space-y-2">
      {VERIFICATION_STEPS.map((step) => {
        const state = stepState(step.key);
        return (
          <Link key={step.key} href={step.href} className="block rounded-lg border p-3 transition hover:border-emerald-400 hover:bg-emerald-50/40">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <step.icon className={cn("h-4 w-4", state === "done" ? "text-emerald-600" : "text-gray-400")} />
                <div>
                  <p className="text-sm font-medium">{step.label}</p>
                  <p className="text-xs text-muted-foreground">{step.desc}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {state === "done" ? (
                  <Badge variant="success" className="gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Verified
                  </Badge>
                ) : state === "review" ? (
                  <Badge variant="warning" className="gap-1">
                    <Clock className="h-3 w-3" /> Under review
                  </Badge>
                ) : (
                  <Badge variant="outline">Not started</Badge>
                )}
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>
          </Link>
        );
      })}
      {isLoading && <p className="py-2 text-center text-xs text-muted-foreground">Loading status…</p>}
    </div>
  );
}

function StepComplete() {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
        <div className="text-sm">
          <p className="font-medium text-emerald-800">Step verified</p>
          <p className="text-emerald-700">This verification is complete and reflected in your AgriConnect Score.</p>
        </div>
      </div>
      <Link href="/farmer/agri-score" className="shrink-0 text-sm font-semibold text-emerald-700 hover:underline">
        View score
      </Link>
    </div>
  );
}

function UploadButton({ uploading, uploaded, onPick, accept = "image/*" }: { uploading: boolean; uploaded: boolean; onPick: (file: File) => void; accept?: string }) {
  return (
    <label className="flex shrink-0 cursor-pointer items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">
      {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
      {uploaded ? "Replace" : "Upload"}
      <input type="file" accept={accept} className="hidden" disabled={uploading} onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])} />
    </label>
  );
}

function mediaUrl(url: string): string {
  if (url.startsWith("/uploads/")) {
    const base = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");
    return `${base}${url}`;
  }
  return url;
}

async function uploadDoc(file: File): Promise<string> {
  const res: any = await api.upload("/kyc/upload", file);
  const url = res?.data?.url;
  if (!url) throw new Error("Upload returned no URL");
  return url;
}

/* ------------------------- Mobile ------------------------- */

export function MobileVerificationSection() {
  const { isLoading, status, refresh } = useVerificationStatus();
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ["farmerProfile"],
    queryFn: () => api.get("/farmers/me/profile"),
  });

  const registeredPhone = (profile as any)?.data?.phone ?? (profile as any)?.phone ?? phone;

  const sendOtp = useMutation({
    mutationFn: async () => {
      const res = await api.post("/auth/login/otp", { phone: registeredPhone || phone });
      return res;
    },
    onSuccess: () => {
      setOtpSent(true);
      toast.success("OTP sent to your mobile");
    },
    onError: (err: any) => toast.error(err?.message || "Failed to send OTP"),
  });

  const verifyMobile = useMutation({
    mutationFn: async () => {
      const res = await api.post("/auth/verify-otp", { phone: registeredPhone || phone, otp });
      return res;
    },
    onSuccess: () => {
      toast.success("Mobile number verified");
      setOtp("");
      setOtpSent(false);
      refresh();
    },
    onError: (err: any) => toast.error(err?.message || "Invalid OTP"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Mobile number</p>
          <p className="text-xs text-muted-foreground">{registeredPhone ? `+${registeredPhone.replace(/^\+/, "")}` : "Verify the phone on your account"}</p>
        </div>
        {isLoading ? null : status.mobile ? <StepStateBadge state="done" /> : null}
      </div>
      {!status.mobile && !isLoading && (
        <div className="flex flex-wrap items-center gap-3">
          <Input placeholder="Phone number" className="h-10 w-52" value={registeredPhone || phone} onChange={(e) => setPhone(e.target.value)} disabled={!!registeredPhone} />
          <Button variant="outline" size="sm" disabled={sendOtp.isPending} onClick={() => sendOtp.mutate()}>
            {sendOtp.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <MessageSquare className="mr-1 h-4 w-4" />}
            {otpSent ? "Resend OTP" : "Send OTP"}
          </Button>
          {otpSent && (
            <>
              <Input placeholder="6-digit OTP" className="h-10 w-36" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value)} />
              <Button size="sm" disabled={otp.length !== 6 || verifyMobile.isPending} onClick={() => verifyMobile.mutate()}>
                {verifyMobile.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null} Verify
              </Button>
            </>
          )}
        </div>
      )}
      {status.mobile && !isLoading && <StepComplete />}
    </div>
  );
}

/* ------------------------- Identity ------------------------- */

const IDENTITY_DOCS = [
  { key: "aadhaar", label: "Aadhaar card" },
  { key: "pan", label: "PAN card" },
];

export function IdentityVerificationSection() {
  const { isLoading, status, kycStatus, refresh } = useVerificationStatus();
  const [docs, setDocs] = useState<Record<string, KYCDocument>>({});
  const [uploading, setUploading] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      const documents = Object.values(docs).map((d) => ({
        type: d.type,
        documentNumber: d.documentNumber || undefined,
        imageUrl: d.imageUrl,
      }));
      return api.post("/kyc/submit", { documents });
    },
    onSuccess: () => {
      toast.success("Identity documents submitted for review");
      refresh();
    },
    onError: (err: any) => toast.error(err?.message || "Failed to submit identity documents"),
  });

  const state = status.identity ? "done" : kycStatus === "rejected" ? "rejected" : kycStatus === "submitted" ? "review" : undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Government ID</p>
          <p className="text-xs text-muted-foreground">Upload Aadhaar and PAN card images for identity verification.</p>
        </div>
        {state && <StepStateBadge state={state} />}
      </div>
      {!status.identity && !isLoading && (
        <>
          <div className="space-y-3">
            {IDENTITY_DOCS.map((doc) => {
              const current = docs[doc.key];
              return (
                <div key={doc.key} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{doc.label}</span>
                      {current?.imageUrl && <Badge variant="success">Uploaded</Badge>}
                    </div>
                    <input
                      placeholder="Document number (optional)"
                      className="mt-2 h-9 w-full max-w-xs rounded-lg border px-3 text-sm"
                      value={current?.documentNumber ?? ""}
                      onChange={(e) => setDocs((prev) => ({ ...prev, [doc.key]: { ...(prev[doc.key] ?? {}), type: doc.key, documentNumber: e.target.value } as KYCDocument }))}
                    />
                  </div>
                  <UploadButton
                    uploading={uploading === doc.key}
                    uploaded={!!current?.imageUrl}
                    onPick={async (file) => {
                      setUploading(doc.key);
                      try {
                        const url = await uploadDoc(file);
                        setDocs((prev) => ({ ...prev, [doc.key]: { ...(prev[doc.key] ?? {}), type: doc.key, imageUrl: url } as KYCDocument }));
                        toast.success(`${doc.label} uploaded`);
                      } catch (err: any) {
                        toast.error(err?.message || "Upload failed");
                      } finally {
                        setUploading(null);
                      }
                    }}
                  />
                </div>
              );
            })}
          </div>
          <Button
            size="sm"
            disabled={submit.isPending || !!uploading || !docs.aadhaar?.imageUrl}
            onClick={() => submit.mutate()}
          >
            {submit.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null} Submit identity documents
          </Button>
        </>
      )}
      {status.identity && !isLoading && <StepComplete />}
    </div>
  );
}

/* ------------------------- Farm / land ------------------------- */

export function FarmVerificationSection() {
  const { isLoading, status, kycStatus, existing, refresh } = useVerificationStatus();
  const [farm, setFarm] = useState({
    farmName: "",
    farmAddress: "",
    farmCity: "",
    farmState: "",
    farmPincode: "",
    farmSizeAcres: "",
  });
  const [landDoc, setLandDoc] = useState<KYCDocument | null>(null);
  const [landVideo, setLandVideo] = useState<KYCDocument | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const prefilled = useRef(false);

  useEffect(() => {
    if (!existing || prefilled.current) return;
    prefilled.current = true;
    setFarm({
      farmName: existing.farmName ?? "",
      farmAddress: existing.farmAddress ?? "",
      farmCity: existing.farmCity ?? "",
      farmState: existing.farmState ?? "",
      farmPincode: existing.farmPincode ?? "",
      farmSizeAcres: existing.farmSizeAcres ? String(existing.farmSizeAcres) : "",
    });
    const land = existing.documents?.find((d) => d.type === "land_document");
    if (land) setLandDoc({ type: "land_document", imageUrl: land.imageUrl });
    const video = existing.documents?.find((d) => d.type === "land_video");
    if (video) setLandVideo({ type: "land_video", imageUrl: video.imageUrl });
  }, [existing]);

  const submit = useMutation({
    mutationFn: async () => {
      const documents: { type: string; imageUrl: string }[] = [];
      if (landDoc) documents.push({ type: "land_document", imageUrl: landDoc.imageUrl });
      if (landVideo) documents.push({ type: "land_video", imageUrl: landVideo.imageUrl });
      return api.post("/kyc/submit", {
        farmName: farm.farmName.trim(),
        farmAddress: farm.farmAddress.trim(),
        farmCity: farm.farmCity.trim(),
        farmState: farm.farmState.trim(),
        farmPincode: farm.farmPincode.trim(),
        farmSizeAcres: parseFloat(farm.farmSizeAcres),
        documents,
      });
    },
    onSuccess: () => {
      toast.success("Farm details submitted for review");
      refresh();
    },
    onError: (err: any) => toast.error(err?.message || "Failed to submit farm details"),
  });

  const state = status.farm ? "done" : kycStatus === "rejected" ? "rejected" : kycStatus === "submitted" ? "review" : undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Farm / land</p>
          <p className="text-xs text-muted-foreground">Record your farm details and land ownership document.</p>
        </div>
        {state && <StepStateBadge state={state} />}
      </div>
      {!status.farm && !isLoading && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input placeholder="Farm name" value={farm.farmName} onChange={(e) => setFarm({ ...farm, farmName: e.target.value })} />
            <Input placeholder="Farm size (acres)" inputMode="decimal" value={farm.farmSizeAcres} onChange={(e) => setFarm({ ...farm, farmSizeAcres: e.target.value })} />
            <Input placeholder="Farm address" className="sm:col-span-2" value={farm.farmAddress} onChange={(e) => setFarm({ ...farm, farmAddress: e.target.value })} />
            <Input placeholder="City" value={farm.farmCity} onChange={(e) => setFarm({ ...farm, farmCity: e.target.value })} />
            <Input placeholder="State" value={farm.farmState} onChange={(e) => setFarm({ ...farm, farmState: e.target.value })} />
            <Input placeholder="PIN code" inputMode="numeric" value={farm.farmPincode} onChange={(e) => setFarm({ ...farm, farmPincode: e.target.value })} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span className="text-sm font-medium">Land document (image)</span>
              {landDoc?.imageUrl ? (
                <>
                  <img src={mediaUrl(landDoc.imageUrl)} alt="Land document" className="h-20 w-20 rounded-lg border object-cover" />
                  <Badge variant="success">Uploaded</Badge>
                </>
              ) : null}
            </div>
            <UploadButton
              uploading={uploading === "land_document"}
              uploaded={!!landDoc?.imageUrl}
              onPick={async (file) => {
                setUploading("land_document");
                try {
                  const url = await uploadDoc(file);
                  setLandDoc({ type: "land_document", imageUrl: url });
                  toast.success("Land image uploaded");
                } catch (err: any) {
                  toast.error(err?.message || "Upload failed");
                } finally {
                  setUploading(null);
                }
              }}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span className="text-sm font-medium">Land video</span>
              {landVideo?.imageUrl ? (
                <>
                  <video src={mediaUrl(landVideo.imageUrl)} controls className="h-24 w-40 rounded-lg border bg-black object-cover" />
                  <Badge variant="success">Uploaded</Badge>
                </>
              ) : null}
            </div>
            <UploadButton
              uploading={uploading === "land_video"}
              uploaded={!!landVideo?.imageUrl}
              accept="video/*"
              onPick={async (file) => {
                setUploading("land_video");
                try {
                  const url = await uploadDoc(file);
                  setLandVideo({ type: "land_video", imageUrl: url });
                  toast.success("Land video uploaded");
                } catch (err: any) {
                  toast.error(err?.message || "Upload failed");
                } finally {
                  setUploading(null);
                }
              }}
            />
          </div>
          <Button
            size="sm"
            disabled={submit.isPending || !!uploading || !farm.farmName || !farm.farmAddress || !farm.farmCity || !farm.farmState || !farm.farmPincode || !landDoc?.imageUrl || !landVideo?.imageUrl}
            onClick={() => submit.mutate()}
          >
            {submit.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null} Submit farm details
          </Button>
        </>
      )}
      {status.farm && !isLoading && <StepComplete />}
    </div>
  );
}

/* ------------------------- Bank ------------------------- */

export function BankVerificationSection() {
  const { isLoading, status, bankStatus, existing, refresh } = useVerificationStatus();
  const [bank, setBank] = useState({
    accountHolderName: "",
    accountNumber: "",
    ifscCode: "",
    bankName: "",
  });
  const prefilled = useRef(false);

  useEffect(() => {
    if (!existing?.bankAccount || prefilled.current) return;
    prefilled.current = true;
    setBank({
      accountHolderName: existing.bankAccount.accountHolderName ?? "",
      accountNumber: existing.bankAccount.accountNumber ?? "",
      ifscCode: existing.bankAccount.ifscCode ?? "",
      bankName: existing.bankAccount.bankName ?? "",
    });
  }, [existing]);

  const submit = useMutation({
    mutationFn: async () => {
      return api.post("/kyc/submit", {
        bankAccount: {
          accountHolderName: bank.accountHolderName.trim(),
          accountNumber: bank.accountNumber.trim(),
          ifscCode: bank.ifscCode.trim(),
          bankName: bank.bankName.trim() || undefined,
        },
      });
    },
    onSuccess: () => {
      toast.success("Bank details submitted for verification");
      refresh();
    },
    onError: (err: any) => toast.error(err?.message || "Failed to submit bank details"),
  });

  const state = status.bank ? "done" : bankStatus === "rejected" ? "rejected" : bankStatus && bankStatus !== "verified" ? "review" : undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Bank details</p>
          <p className="text-xs text-muted-foreground">Add the account used for farmer payouts. An admin verifies it.</p>
        </div>
        {state && <StepStateBadge state={state} />}
      </div>
      {!status.bank && !isLoading && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input placeholder="Account holder name" value={bank.accountHolderName} onChange={(e) => setBank({ ...bank, accountHolderName: e.target.value })} />
            <Input placeholder="Bank name" value={bank.bankName} onChange={(e) => setBank({ ...bank, bankName: e.target.value })} />
            <Input placeholder="Account number" value={bank.accountNumber} onChange={(e) => setBank({ ...bank, accountNumber: e.target.value })} />
            <Input placeholder="IFSC code" value={bank.ifscCode} onChange={(e) => setBank({ ...bank, ifscCode: e.target.value })} />
          </div>
          <Button size="sm" disabled={submit.isPending || !bank.accountHolderName || !bank.accountNumber || !bank.ifscCode} onClick={() => submit.mutate()}>
            {submit.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null} Submit bank details
          </Button>
        </>
      )}
      {status.bank && !isLoading && <StepComplete />}
    </div>
  );
}