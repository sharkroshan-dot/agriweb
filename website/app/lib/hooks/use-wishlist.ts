"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { api } from "../api/client";
import toast from "react-hot-toast";

export const WISHLIST_QUERY_KEY = ["customerWishlist"];

export interface WishlistItem {
  id: string;
  name?: string;
  price?: number;
  unit?: string;
  image?: string;
  farmerName?: string;
  inStock?: boolean;
  rating?: number;
  pickupAvailable?: boolean;
  farmAddress?: string;
  wishlistedAt?: string;
}

export function useWishlist() {
  const { data: session, status } = useSession();
  const queryClient = useQueryClient();
  const role = (session?.user as any)?.role;
  // Wishlist endpoints are customer-only. Delivery, farmer, admin, and
  // warehouse sessions must not trigger a request that will return 403.
  const enabled = status === "authenticated" && role === "customer";

  const { data, isLoading, refetch } = useQuery({
    queryKey: WISHLIST_QUERY_KEY,
    queryFn: async () => {
      const res = await api.get("/customers/me/wishlist");
      const list = Array.isArray(res) ? res : res?.data || [];
      return list as WishlistItem[];
    },
    enabled,
  });

  const items = (data || []) as WishlistItem[];

  const isWishlisted = (productId: string) =>
    items.some((item) => String(item.id) === String(productId));

  const toggleMutation = useMutation({
    mutationFn: async ({
      productId,
      currentlyWishlisted,
    }: {
      productId: string;
      currentlyWishlisted: boolean;
    }) => {
      if (currentlyWishlisted) {
        await api.delete(`/customers/me/wishlist/${productId}`);
        return false;
      }
      await api.post(`/customers/me/wishlist/${productId}`);
      return true;
    },
    onMutate: async ({ productId, currentlyWishlisted }) => {
      await queryClient.cancelQueries({ queryKey: WISHLIST_QUERY_KEY });
      const previous = queryClient.getQueryData<WishlistItem[]>(WISHLIST_QUERY_KEY);
      queryClient.setQueryData<WishlistItem[]>(WISHLIST_QUERY_KEY, (old = []) => {
        if (currentlyWishlisted) {
          return old.filter((item) => String(item.id) !== String(productId));
        }
        if (old.some((item) => String(item.id) === String(productId))) return old;
        return [{ id: productId } as WishlistItem, ...old];
      });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(WISHLIST_QUERY_KEY, context.previous);
      }
      toast.error("Could not update wishlist");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: WISHLIST_QUERY_KEY });
    },
  });

  const toggle = (productId: string) => {
    if (status !== "authenticated") {
      toast.error("Please sign in to save products");
      return false;
    }
    const currently = isWishlisted(productId);
    toggleMutation.mutate({ productId, currentlyWishlisted: currently });
    toast.success(currently ? "Removed from wishlist" : "Added to wishlist");
    return !currently;
  };

  const remove = (productId: string) => {
    if (!isWishlisted(productId)) return;
    toggleMutation.mutate({ productId, currentlyWishlisted: true });
  };

  return {
    items,
    isLoading,
    isWishlisted,
    toggle,
    remove,
    refetch,
    enabled,
  };
}
