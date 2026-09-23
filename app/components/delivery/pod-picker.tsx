"use client";

import * as React from "react";
import { Camera, Upload, SwitchCamera } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";

interface PodPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  uploading?: boolean;
  onFile: (file: File) => void;
}

export function PodPicker({ open, onOpenChange, uploading = false, onFile }: PodPickerProps) {
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const [view, setView] = React.useState<"menu" | "camera">("menu");
  const [cameraBack, setCameraBack] = React.useState(true);
  const [cameraError, setCameraError] = React.useState<string | null>(null);
  const [starting, setStarting] = React.useState(false);

  const stopCamera = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  React.useEffect(() => stopCamera, [stopCamera]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    onFile(file);
    onOpenChange(false);
    setView("menu");
  };

  const attachToVideo = (stream: MediaStream, attempt: number) => {
    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
      void video.play().catch(() => undefined);
      return;
    }
    if (attempt < 50) {
      setTimeout(() => attachToVideo(stream, attempt + 1), 100);
    }
  };

  const openCameraWith = async (facingBack: boolean) => {
    setView("camera");
    setCameraBack(facingBack);
    stopCamera();
    setCameraError(null);
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
      attachToVideo(stream, 0);
    } catch {
      setCameraError("Camera could not be opened. Check camera permissions or upload a file instead.");
    } finally {
      setStarting(false);
    }
  };

  const openCamera = () => void openCameraWith(true);

  const switchCamera = () => void openCameraWith(!cameraBack);

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
      onFile(new File([blob], "proof-of-delivery.jpg", { type: "image/jpeg" }));
      stopCamera();
      setView("menu");
      onOpenChange(false);
    }, "image/jpeg", 0.8);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      stopCamera();
      setView("menu");
      setCameraError(null);
    }
    onOpenChange(nextOpen);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          {view === "menu" ? (
            <>
              <DialogHeader>
                <DialogTitle>Proof of Delivery</DialogTitle>
                <DialogDescription>
                  Open the camera to capture the delivery or upload any file as proof.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start"
                  disabled={uploading}
                  onClick={openCamera}
                >
                  <Camera className="mr-2 h-4 w-4" /> Open Camera
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="mr-2 h-4 w-4" /> Upload Any File
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => handleOpenChange(false)}
                >
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Take a photo</DialogTitle>
                <DialogDescription>
                  Capture the delivery proof or upload an existing file.
                </DialogDescription>
              </DialogHeader>
              <div className="relative overflow-hidden rounded-lg bg-slate-900">
                <video ref={videoRef} playsInline muted className="h-64 w-full object-cover" />
                {starting && !cameraError && (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-900/60 text-sm text-white">
                    Opening camera...
                  </div>
                )}
                {cameraError && (
                  <div className="p-4 text-center text-sm text-red-400">
                    <p>{cameraError}</p>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={switchCamera}
                  disabled={starting || !!cameraError}
                >
                  <SwitchCamera className="mr-1.5 h-4 w-4" /> Switch
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="flex-1"
                  disabled={starting || !!cameraError || uploading}
                  onClick={capturePhoto}
                >
                  <Camera className="mr-1.5 h-4 w-4" /> Take Photo
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="mr-1.5 h-4 w-4" /> Upload File
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFile}
      />
    </>
  );
}
