"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, MapPin, Trash2, Star } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { api } from "../../../lib/api/client";
import toast from "react-hot-toast";

type Address = {
  id: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  zip_code: string;
  country: string;
  landmark?: string;
  address_type: string;
  is_default: boolean;
};

const initialForm = {
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  zip_code: "",
  country: "India",
  landmark: "",
  address_type: "home",
};

export default function AddressesPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [status, router]);

  const { data } = useQuery({
    queryKey: ["customerAddresses"],
    queryFn: () => api.get("/users/me/addresses"),
  });

  const addresses: Address[] = useMemo(() => {
    const list = Array.isArray(data) ? data : data?.data || [];
    return list.map((a: any) => ({ ...a, id: a._id || a.id }));
  }, [data]);

  if (status === "loading") return <div className="p-6 text-sm text-slate-500">Loading...</div>;
  if (status === "unauthenticated") return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.address_line1 || !form.city || !form.state || !form.zip_code) {
      toast.error("Please fill in all required fields");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/users/me/addresses", form);
      await queryClient.refetchQueries({ queryKey: ["customerAddresses"] });
      setForm(initialForm);
      setShowForm(false);
      toast.success("Address added");
    } catch (err: any) {
      const message = err?.message || "Failed to add address";
      const cleaned = message.replace(/^"|"$/g, "");
      toast.error(cleaned.length > 120 ? cleaned.slice(0, 120) + "..." : cleaned);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/users/me/addresses/${id}`);
      await queryClient.refetchQueries({ queryKey: ["customerAddresses"] });
      toast.success("Address removed");
    } catch {
      toast.error("Failed to remove address");
    }
  };

  const handleSetPermanent = async (id: string) => {
    try {
      await api.put(`/users/me/addresses/${id}/permanent`);
      await queryClient.refetchQueries({ queryKey: ["customerAddresses"] });
      await queryClient.invalidateQueries({ queryKey: ["customerSidebarProfile"] });
      toast.success("Permanent address updated");
    } catch {
      toast.error("Failed to set permanent address");
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/checkout"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">Saved Addresses</h1>
          <p className="text-sm text-muted-foreground">Manage your delivery addresses</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus className="mr-2 h-4 w-4" /> Add Address
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>New Address</CardTitle>
            <CardDescription>Enter your delivery address details</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAdd} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium mb-1">Address Line 1 *</label>
                  <Input name="address_line1" value={form.address_line1} onChange={handleChange} placeholder="Street address" required />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium mb-1">Address Line 2</label>
                  <Input name="address_line2" value={form.address_line2} onChange={handleChange} placeholder="Apartment, suite, etc." />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">City *</label>
                  <Input name="city" value={form.city} onChange={handleChange} placeholder="City" required />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">State *</label>
                  <Input name="state" value={form.state} onChange={handleChange} placeholder="State" required />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">ZIP Code *</label>
                  <Input name="zip_code" value={form.zip_code} onChange={handleChange} placeholder="PIN code" required />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Landmark</label>
                  <Input name="landmark" value={form.landmark} onChange={handleChange} placeholder="Nearby landmark" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Type</label>
                  <select name="address_type" value={form.address_type} onChange={handleChange} className="w-full rounded-md border px-3 py-2 text-sm">
                    <option value="permanent">Permanent</option>
                    <option value="home">Home</option>
                    <option value="work">Work</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
                <Button type="submit" disabled={submitting}>{submitting ? "Saving..." : "Save Address"}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {addresses.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <MapPin className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">No addresses saved</p>
            <p className="text-sm text-muted-foreground">Add a delivery address to start ordering.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {addresses.map((addr) => (
            <Card key={addr.id}>
              <CardContent className="flex items-start justify-between p-4">
                <div className="flex items-start gap-3">
                  <MapPin className="mt-1 h-5 w-5 text-emerald-600" />
                  <div>
                    <p className="font-medium">
                      {addr.address_line1}{addr.address_line2 ? `, ${addr.address_line2}` : ""}
                      {addr.is_default && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          <Star className="h-3 w-3" /> Default
                        </span>
                      )}
                      {addr.address_type === "permanent" && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                          <Star className="h-3 w-3 fill-amber-500" /> Permanent
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {addr.city}, {addr.state} - {addr.zip_code}
                    </p>
                    <p className="text-xs capitalize text-muted-foreground">{addr.address_type}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {addr.address_type === "permanent" ? (
                    <Button variant="ghost" size="sm" title="Permanent address" aria-label="Permanent address">
                      <Star className="h-4 w-4 fill-amber-500 text-amber-500" />
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => handleSetPermanent(addr.id)} title="Set as permanent" aria-label="Set as permanent">
                      <Star className="h-4 w-4 text-gray-400" />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(addr.id)} title="Remove">
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
