"use client";

import { FormEvent, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import {
  Search,
  Package,
  Edit,
  MoreVertical,
  RefreshCw,
  Plus,
  Download,
  Upload,
  Eye,
  XCircle,
} from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Progress } from "../../components/ui/progress";
import { cn, formatPrice } from "../../lib/utils";
import { PageErrorState } from "../../components/common/page-state";
import { api } from "../../lib/api/client";
import toast from "react-hot-toast";

const statusColors: Record<string, string> = {
  in_stock: "bg-green-500/10 text-green-600 border-green-500/20",
  low_stock: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
  out_of_stock: "bg-red-500/10 text-red-600 border-red-500/20",
  expired: "bg-gray-500/10 text-gray-600 border-gray-500/20",
  reserved: "bg-blue-500/10 text-blue-600 border-blue-500/20",
};

const statusLabels: Record<string, string> = {
  in_stock: "In Stock",
  low_stock: "Low Stock",
  out_of_stock: "Out of Stock",
  expired: "Expired",
  reserved: "Reserved",
};

const storageTypes = [
  { value: "ambient", label: "Ambient" },
  { value: "chilled", label: "Chilled" },
  { value: "frozen", label: "Frozen" },
  { value: "controlled_atmosphere", label: "Controlled Atmosphere" },
];

const emptyStockForm = {
  productId: "",
  variantId: "",
  quantity: "1",
  reservedQuantity: "0",
  minThreshold: "10",
  maxThreshold: "",
  locationInWarehouse: "",
  batchNumber: "",
  expiryDate: "",
  storageType: "ambient",
};

export default function WarehouseStockPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [stockForm, setStockForm] = useState(emptyStockForm);
  const [isSaving, setIsSaving] = useState(false);

  const { data: stockData, isLoading, isError, refetch } = useQuery({
    queryKey: ["warehouseStock", statusFilter, categoryFilter],
    queryFn: () =>
      api.get("/warehouse/me/stock", {
        params: {
          status: statusFilter !== "all" ? statusFilter : undefined,
          category: categoryFilter !== "all" ? categoryFilter : undefined,
          limit: 50,
        },
      }),
  });

  const { data: categories } = useQuery({
    queryKey: ["productCategories"],
    queryFn: () => api.get("/products/categories"),
  });

  const stockItems = useMemo(() => {
    const items = stockData?.data?.stock || stockData?.data?.items || [];
    const query = searchTerm.trim().toLowerCase();

    if (!query) {
      return items;
    }

    return items.filter((item: any) =>
      [item.name, item.productName, item.productId, item.batchNumber, item.locationInWarehouse]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [searchTerm, stockData]);

  const openAddDialog = () => {
    setStockForm(emptyStockForm);
    setShowAddDialog(true);
  };

  const openEditDialog = (item: any) => {
    setSelectedItem(item);
    setStockForm({
      productId: item.productId || "",
      variantId: item.variantId || "",
      quantity: String(item.quantity ?? 0),
      reservedQuantity: String(item.reservedQuantity ?? 0),
      minThreshold: String(item.minThreshold ?? 10),
      maxThreshold: item.maxThreshold ? String(item.maxThreshold) : "",
      locationInWarehouse: item.locationInWarehouse || "",
      batchNumber: item.batchNumber || "",
      expiryDate: item.expiryDate ? String(item.expiryDate).slice(0, 10) : "",
      storageType: item.storageType || "ambient",
    });
    setShowEditDialog(true);
  };

  const buildStockPayload = () => ({
    productId: stockForm.productId.trim(),
    variantId: stockForm.variantId.trim() || undefined,
    quantity: Number(stockForm.quantity),
    reservedQuantity: Number(stockForm.reservedQuantity || 0),
    minThreshold: Number(stockForm.minThreshold || 0),
    maxThreshold: stockForm.maxThreshold ? Number(stockForm.maxThreshold) : undefined,
    locationInWarehouse: stockForm.locationInWarehouse.trim() || undefined,
    batchNumber: stockForm.batchNumber.trim() || undefined,
    expiryDate: stockForm.expiryDate ? new Date(stockForm.expiryDate).toISOString() : undefined,
    storageType: stockForm.storageType,
  });

  const handleAddStock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!stockForm.productId.trim()) {
      toast.error("Product ID is required");
      return;
    }

    try {
      setIsSaving(true);
      await api.post("/warehouse/me/stock", buildStockPayload());
      toast.success("Stock added successfully");
      setShowAddDialog(false);
      refetch();
    } catch (error) {
      toast.error("Failed to add stock");
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateStock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedItem?.id) {
      toast.error("Select a stock item first");
      return;
    }

    try {
      setIsSaving(true);
      const payload = {
        quantity: Number(stockForm.quantity),
        reservedQuantity: Number(stockForm.reservedQuantity || 0),
        minThreshold: Number(stockForm.minThreshold || 0),
        maxThreshold: stockForm.maxThreshold ? Number(stockForm.maxThreshold) : undefined,
        locationInWarehouse: stockForm.locationInWarehouse.trim() || undefined,
        batchNumber: stockForm.batchNumber.trim() || undefined,
        expiryDate: stockForm.expiryDate ? new Date(stockForm.expiryDate).toISOString() : undefined,
        storageType: stockForm.storageType,
      };
      await api.put(`/warehouse/me/stock/${selectedItem.id}`, payload);
      toast.success("Stock updated successfully");
      setShowEditDialog(false);
      refetch();
    } catch (error) {
      toast.error("Failed to update stock");
    } finally {
      setIsSaving(false);
    }
  };

  const updateStockForm = (field: keyof typeof stockForm, value: string) => {
    setStockForm((current) => ({ ...current, [field]: value }));
  };

  const renderStockForm = (mode: "add" | "edit") => (
    <form className="space-y-4" onSubmit={mode === "add" ? handleAddStock : handleUpdateStock}>
      {mode === "add" && (
        <div>
          <label className="text-sm font-medium">Product ID</label>
          <Input value={stockForm.productId} onChange={(event) => updateStockForm("productId", event.target.value)} className="mt-1" required />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium">Quantity</label>
          <Input type="number" min="0" value={stockForm.quantity} onChange={(event) => updateStockForm("quantity", event.target.value)} className="mt-1" required />
        </div>
        <div>
          <label className="text-sm font-medium">Reserved Quantity</label>
          <Input type="number" min="0" value={stockForm.reservedQuantity} onChange={(event) => updateStockForm("reservedQuantity", event.target.value)} className="mt-1" />
        </div>
        <div>
          <label className="text-sm font-medium">Min Threshold</label>
          <Input type="number" min="0" value={stockForm.minThreshold} onChange={(event) => updateStockForm("minThreshold", event.target.value)} className="mt-1" />
        </div>
        <div>
          <label className="text-sm font-medium">Max Threshold</label>
          <Input type="number" min="0" value={stockForm.maxThreshold} onChange={(event) => updateStockForm("maxThreshold", event.target.value)} className="mt-1" />
        </div>
      </div>
      <div>
        <label className="text-sm font-medium">Location</label>
        <Input value={stockForm.locationInWarehouse} onChange={(event) => updateStockForm("locationInWarehouse", event.target.value)} className="mt-1" placeholder="Aisle 3, Rack 2" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium">Batch Number</label>
          <Input value={stockForm.batchNumber} onChange={(event) => updateStockForm("batchNumber", event.target.value)} className="mt-1" />
        </div>
        <div>
          <label className="text-sm font-medium">Expiry Date</label>
          <Input type="date" value={stockForm.expiryDate} onChange={(event) => updateStockForm("expiryDate", event.target.value)} className="mt-1" />
        </div>
      </div>
      <div>
        <label className="text-sm font-medium">Storage Type</label>
        <Select value={stockForm.storageType} onValueChange={(value) => updateStockForm("storageType", value)}>
          <SelectTrigger className="mt-1">
            <SelectValue placeholder="Select storage type" />
          </SelectTrigger>
          <SelectContent>
            {storageTypes.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={() => (mode === "add" ? setShowAddDialog(false) : setShowEditDialog(false))}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Saving..." : mode === "add" ? "Add Stock" : "Save Changes"}
        </Button>
      </div>
    </form>
  );

  if (isError) {
    return (
      <div className="space-y-6">
        <div><h1 className="text-3xl font-bold">Stock Management</h1><p className="text-muted-foreground">Manage warehouse inventory</p></div>
        <PageErrorState title="Unable to load warehouse stock" description="The warehouse inventory service did not return stock data. Retry without changing your inventory." retry={() => { void refetch(); }} />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between"><div><h1 className="text-3xl font-bold">Stock Management</h1><p className="text-muted-foreground">Manage warehouse inventory</p></div></div>
        {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />)}
      </div>
    );
  }

  const inventorySummary = useMemo(() => {
    const total = stockItems.reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0);
    const low = stockItems.filter((item: any) => item.status === "low_stock" || Number(item.quantity || 0) <= Number(item.minThreshold || 0)).length;
    const expired = stockItems.filter((item: any) => item.expiryDate && new Date(item.expiryDate).getTime() < Date.now()).length;
    const reserved = stockItems.reduce((sum: number, item: any) => sum + Number(item.reservedQuantity || 0), 0);
    return { total, low, expired, reserved };
  }, [stockItems]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h1 className="text-3xl font-bold">Stock Management</h1><p className="text-muted-foreground">{stockItems.length} items in inventory</p></div>
        <div className="flex items-center gap-2"><Button variant="outline" size="sm"><Download className="mr-2 h-4 w-4" />Export</Button><Button variant="outline" size="icon" onClick={() => refetch()}><RefreshCw className="h-4 w-4" /></Button><Button onClick={openAddDialog}><Plus className="mr-2 h-4 w-4" />Add Stock</Button></div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Total Stock", inventorySummary.total, "units"],
          ["Low Stock", inventorySummary.low, "items"],
          ["Expiring / Expired", inventorySummary.expired, "items"],
          ["Reserved", inventorySummary.reserved, "units"],
        ].map(([label, value, unit]) => (
          <Card key={String(label)}><CardContent className="p-4"><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold text-slate-900">{value}</p><p className="text-xs text-slate-400">{unit}</p></CardContent></Card>
        ))}
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input placeholder="Search inventory..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" /></div>
        <div className="flex gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger><SelectContent><SelectItem value="all">All Status</SelectItem><SelectItem value="in_stock">In Stock</SelectItem><SelectItem value="low_stock">Low Stock</SelectItem><SelectItem value="out_of_stock">Out of Stock</SelectItem><SelectItem value="expired">Expired</SelectItem><SelectItem value="reserved">Reserved</SelectItem></SelectContent></Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}><SelectTrigger className="w-[150px]"><SelectValue placeholder="Category" /></SelectTrigger><SelectContent><SelectItem value="all">All Categories</SelectItem>{(categories?.data || categories || []).map((cat: any) => <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>)}</SelectContent></Select>
        </div>
      </div>

      {stockItems.length === 0 ? (
        <Card className="p-12 text-center"><Package className="mx-auto h-12 w-12 text-muted-foreground" /><h3 className="mt-4 text-lg font-semibold">No items found</h3><p className="mt-2 text-muted-foreground">{searchTerm || statusFilter !== "all" || categoryFilter !== "all" ? "Try adjusting your filters" : "Start adding items to your inventory"}</p><Button className="mt-4" onClick={openAddDialog}><Plus className="mr-2 h-4 w-4" />Add First Item</Button></Card>
      ) : (
        <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full"><thead className="border-b bg-muted/50"><tr><th className="p-4 text-left text-sm font-medium text-muted-foreground">Product</th><th className="p-4 text-left text-sm font-medium text-muted-foreground">Category</th><th className="p-4 text-left text-sm font-medium text-muted-foreground">Quantity</th><th className="p-4 text-left text-sm font-medium text-muted-foreground">Location</th><th className="p-4 text-left text-sm font-medium text-muted-foreground">Status</th><th className="p-4 text-left text-sm font-medium text-muted-foreground">Expiry</th><th className="p-4 text-right text-sm font-medium text-muted-foreground">Actions</th></tr></thead><tbody>{stockItems.map((item: any) => {
          const productName = item.name || item.productName || String(item.productId || "Product");
          const maxThreshold = item.maxThreshold || Math.max(item.quantity || 0, item.minThreshold || 1);
          return (
            <tr key={item.id} className="border-b transition-colors hover:bg-muted/50"><td className="p-4"><div className="flex items-center gap-3"><div className="h-10 w-10 overflow-hidden rounded-md bg-muted"><Image src={item.image || "/images/placeholder-product.jpg"} alt={productName} width={40} height={40} className="h-full w-full object-cover" /></div><div><p className="font-medium">{productName}</p><p className="text-sm text-muted-foreground">{item.price ? `${formatPrice(item.price)} / ${item.unit || "unit"}` : item.productId}</p></div></div></td><td className="p-4"><Badge variant="outline">{item.category || item.storageType || "General"}</Badge></td><td className="p-4"><div><p className="font-medium">{item.quantity}</p><div className="mt-1 w-24"><Progress value={Math.min(((item.quantity || 0) / maxThreshold) * 100, 100)} className="h-1.5" /></div></div></td><td className="p-4 text-sm">{item.locationInWarehouse || "Not assigned"}</td><td className="p-4"><Badge variant="outline" className={cn("border", statusColors[item.status as keyof typeof statusColors])}>{statusLabels[item.status as keyof typeof statusLabels] || item.status || "In Stock"}</Badge></td><td className="p-4 text-sm">{item.expiryDate ? <span className={cn(new Date(item.expiryDate) < new Date() ? "text-red-600" : new Date(item.expiryDate) < new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) ? "text-yellow-600" : "text-green-600")}>{new Date(item.expiryDate).toLocaleDateString()}</span> : <span className="text-muted-foreground">N/A</span>}</td><td className="p-4 text-right"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => openEditDialog(item)}><Edit className="mr-2 h-4 w-4" />Edit</DropdownMenuItem><DropdownMenuItem><Eye className="mr-2 h-4 w-4" />View Details</DropdownMenuItem><DropdownMenuItem><Upload className="mr-2 h-4 w-4" />Move Location</DropdownMenuItem><DropdownMenuItem className="text-destructive"><XCircle className="mr-2 h-4 w-4" />Remove</DropdownMenuItem></DropdownMenuContent></DropdownMenu></td></tr>
          );
        })}</tbody></table></div></CardContent></Card>
      )}

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}><DialogContent><DialogHeader><DialogTitle>Add Stock</DialogTitle><DialogDescription>Add a new inventory item or increase an existing product's quantity.</DialogDescription></DialogHeader>{renderStockForm("add")}</DialogContent></Dialog>
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}><DialogContent><DialogHeader><DialogTitle>Update Stock</DialogTitle><DialogDescription>Update inventory details for {selectedItem?.name || selectedItem?.productName || selectedItem?.productId}</DialogDescription></DialogHeader>{renderStockForm("edit")}</DialogContent></Dialog>
    </div>
  );
}
