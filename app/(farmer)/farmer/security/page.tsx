"use client";

import { SecurityCenter } from "../../../components/security/security-center";

export default function FarmerSecurityPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Security center</h1>
        <p className="text-sm text-muted-foreground">Protect your account, devices and verification.</p>
      </div>
      <SecurityCenter />
    </div>
  );
}