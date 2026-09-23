"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { Camera, Loader2, SwitchCamera, Upload } from "lucide-react";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";

interface CameraCaptureProps {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
  onUpload?: (files: File[]) => void;
}

export function CameraCapture({ open, onClose, onCapture, onUpload }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraBack, setCameraBack] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const openCameraWith = async (facingBack: boolean) => {
    setCameraBack(facingBack);
    stopCamera();
    setReady(false);
    setError(null);
    setStarting(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("unsupported");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facingBack ? "environment" : "user" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setReady(true);
    } catch (err: any) {
      setError(err?.message || "Camera could not be opened. Check camera permissions or upload a file instead.");
    } finally {
      setStarting(false);
    }
  };

  useEffect(() => {
    if (open) {
      void openCameraWith(cameraBack);
    } else {
      stopCamera();
      setReady(false);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const switchCamera = () => void openCameraWith(!cameraBack);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      if (onUpload) {
        onUpload(Array.from(files));
      } else {
        onCapture(files[0]);
      }
    } finally {
      e.target.value = "";
      stopCamera();
      onClose();
    }
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      onCapture(new File([blob], `product-${Date.now()}.jpg`, { type: "image/jpeg" }));
      stopCamera();
      onClose();
    }, "image/jpeg", 0.9);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Take a photo</DialogTitle>
            <DialogDescription>
              Capture your product or upload an existing image.
            </DialogDescription>
          </DialogHeader>
          <div className="relative overflow-hidden rounded-lg bg-slate-900">
            <video ref={videoRef} playsInline muted className="h-64 w-full object-cover" />
            {starting && !error && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-900/60 text-sm text-white">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening camera...
              </div>
            )}
            {error && (
              <div className="p-4 text-center text-sm text-red-400">
                <p>{error}</p>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={switchCamera}
              disabled={starting || !!error}
            >
              <SwitchCamera className="mr-1.5 h-4 w-4" /> Switch
            </Button>
            <Button
              type="button"
              size="sm"
              className="flex-1"
              disabled={starting || !!error || !ready}
              onClick={capturePhoto}
            >
              <Camera className="mr-1.5 h-4 w-4" /> Take Photo
            </Button>
            <label className="flex flex-1 cursor-pointer items-center justify-center rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100">
              <Upload className="mr-1.5 h-4 w-4" /> Upload File
              <input
                type="file"
                multiple
                accept="image/*"
                className="sr-only"
                onChange={handleFile}
              />
            </label>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
