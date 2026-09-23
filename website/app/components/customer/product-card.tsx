"use client";

import Image from "next/image";
import Link from "next/link";
import { Star, ShoppingCart, Heart, Plus } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card";
import { cn, formatPrice } from "../../lib/utils";
import { useCartStore } from "../../lib/store/cart-store";
import { useWishlist } from "../../lib/hooks/use-wishlist";
import toast from "react-hot-toast";

interface ProductCardProps {
	product: any;
	compact?: boolean;
}

export function ProductCard({ product, compact = false }: ProductCardProps) {
	const addItem = useCartStore((s: any) => s.addItem);
	const { isWishlisted, toggle } = useWishlist();
	const wishlisted = isWishlisted(product.id);

	const handleAddToCart = (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		addItem({
			id: product.id,
			name: product.name,
			price: product.price,
			quantity: 1,
			image: product.images?.[0] || "/images/placeholder.jpg",
			farmerName: product.farmerName,
			unit: product.unit,
			pickupAvailable: product.pickupAvailable ?? false,
			farmAddress: product.farmAddress || "",
		});
		toast.success(`${product.name} added to cart!`);
	};

	const handleWishlist = (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		toggle(product.id);
	};

	const vStatus = product.verificationStatus;
	const verified = vStatus === "verified" || vStatus === "buyer_verified";
	const effectiveGrade = product.effectiveGrade || product.qualityGrade;

	const qualityBadge = (
		<span
			className={`absolute left-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-semibold shadow-sm ${
				verified
					? "bg-emerald-600 text-white"
					: "bg-amber-100 text-amber-800 border border-amber-200"
			}`}
		>
			{verified ? `✓ Grade ${effectiveGrade} Verified` : "⚠ Farmer Declared · Unverified"}
		</span>
	);

	if (compact) {
		return (
			<Link href={`/product/${product.id}`} className="group">
				<div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md">
					<div className="relative aspect-square overflow-hidden bg-slate-100">
						<Image
							src={product.images?.[0] || "/images/placeholder.jpg"}
							alt={product.name}
							fill
							className="object-cover transition-transform group-hover:scale-105"
						/>
					</div>
					<div className="p-3">
						<div className="mb-2 flex items-start justify-between gap-2">
							<span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">Farm fresh</span>
							<span className="text-xs text-slate-500">{product.unit}</span>
						</div>
						<h3 className="line-clamp-1 text-sm font-medium">{product.name}</h3>
						<div className="mt-2 flex items-center justify-between gap-2">
							<span className="font-bold text-slate-900">{formatPrice(product.price) ?? "N/A"}</span>
							<Button size="icon" className="h-8 w-8 rounded-full" onClick={handleAddToCart} aria-label={`Add ${product.name} to cart`} title="Add to cart"><Plus className="h-4 w-4" /></Button>
						</div>
						<div className="mt-1 flex items-center gap-1 text-xs text-gray-500">
							<Star className="h-3 w-3 text-yellow-500" />
							<span>{product.rating || 4.5}</span>
						</div>
					</div>
				</div>
			</Link>
		);
	}

	return (
		<Link href={`/product/${product.id}`} className="group">
			<Card className="overflow-hidden transition-all hover:shadow-lg">
				<CardHeader className="p-0">
					<div className="relative aspect-square overflow-hidden bg-slate-100">
						<Image
							src={product.images?.[0] || "/images/placeholder.jpg"}
							alt={product.name}
							fill
							className="object-cover transition-transform duration-300 group-hover:scale-110"
						/>
						{qualityBadge}
						<Button
							variant="ghost"
							className={cn(
								"absolute right-3 top-3 rounded-full bg-white/80 backdrop-blur-sm",
								wishlisted && "text-red-500"
							)}
							onClick={handleWishlist}
						>
							<Heart className={cn("h-4 w-4", wishlisted && "fill-current")} />
						</Button>
					</div>
				</CardHeader>
				<CardContent className="p-4">
					<div className="flex items-start justify-between gap-2">
						<div className="flex-1 min-w-0">
							<h3 className="line-clamp-1 text-sm font-medium group-hover:text-emerald-600">{product.name}</h3>
							<p className="text-xs text-slate-500">{product.farmerName || "Local Farmer"}</p>
						</div>
						<div className="flex items-center gap-1 text-sm">
							<Star className="h-3 w-3 text-yellow-500" />
							<span>{product.rating || 4.5}</span>
						</div>
					</div>
					<div className="mt-3 flex items-end justify-between gap-2">
						<div>
							<span className="text-lg font-bold text-slate-900">{formatPrice(product.price) ?? "N/A"}</span>
							<span className="ml-1 text-xs text-gray-500">/{product.unit}</span>
						</div>
						<div className="text-xs text-gray-500">{product.quantity > 50 ? "In Stock" : `${product.quantity} left`}</div>
					</div>
				</CardContent>
				<CardFooter className="p-4 pt-0">
					<Button className="w-full" onClick={handleAddToCart}>
						<ShoppingCart className="mr-2 h-4 w-4" />
						Add to Cart
					</Button>
				</CardFooter>
			</Card>
		</Link>
	);
}

