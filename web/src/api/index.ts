import {
  type InfiniteData,
  QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { getInitData } from "../telegram";
import { ApiError, createApiClient } from "./client";
import type {
  AwardResult,
  CellGroup,
  Home,
  LivingPost,
  Me,
  Page,
  Prayer,
  ReactionSummary,
  ReactionType,
  Testimony,
  TestimonyBlock,
  TestimonySummary,
  UploadedImage,
} from "./types";

export { ApiError };

/** The one API client the app uses. Every call is authenticated with the raw initData. */
export const api = createApiClient({ baseUrl: import.meta.env.VITE_API_URL ?? "", getInitData });

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // Retrying a 4xx (bad initData, forbidden, not found) can't succeed.
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

export const keys = {
  me: ["me"] as const,
  home: ["home"] as const,
  cellGroups: ["cell-groups"] as const,
  prayers: ["prayers"] as const,
  living: (zone: string) => ["living", zone] as const,
  testimonies: (all: boolean) => ["testimonies", all ? "all" : "published"] as const,
  testimony: (id: string) => ["testimony", id] as const,
};

// ---- Profile & home --------------------------------------------------------

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: ({ signal }) => api.get<Me>("/api/me", signal) });

/** Always refetched on open/focus so Monday's new challenge appears right after 05:00 SGT. */
export const useHome = () =>
  useQuery({ queryKey: keys.home, queryFn: ({ signal }) => api.get<Home>("/api/home", signal), staleTime: 0 });

export const useCellGroups = () =>
  useQuery({
    queryKey: keys.cellGroups,
    queryFn: ({ signal }) => api.get<{ cellGroups: CellGroup[] }>("/api/cell-groups", signal),
    select: (d) => d.cellGroups,
    staleTime: 10 * 60_000,
  });

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<{ displayName: string | null; cellGroupId: string; stayAnonymous: boolean; showOnBoards: boolean; notificationsEnabled: boolean }>) =>
      api.patch<Me>("/api/me", patch),
    onSuccess: (me) => qc.setQueryData(keys.me, me),
  });
}

export function useLogPoints(kind: "meal-log" | "tithe") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<AwardResult>(`/api/points/${kind}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.me }),
  });
}

// ---- Prayer Wall -----------------------------------------------------------

export const usePrayers = () =>
  useInfiniteQuery({
    queryKey: keys.prayers,
    queryFn: ({ pageParam, signal }) =>
      api.get<Page<Prayer>>(`/api/prayers${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`, signal),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

/** Swap one prayer in the cached pages (after commenting or reacting). */
function patchPrayer(qc: ReturnType<typeof useQueryClient>, id: string, patch: (p: Prayer) => Prayer) {
  qc.setQueryData<InfiniteData<Page<Prayer>>>(keys.prayers, (data) =>
    data && { ...data, pages: data.pages.map((pg) => ({ ...pg, items: pg.items.map((p) => (p.id === id ? patch(p) : p)) })) },
  );
}

export function useCreatePrayer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { content: string; isAnonymous: boolean }) => api.post<Prayer>("/api/prayers", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.prayers }),
  });
}

export function useAddComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prayerId, ...input }: { prayerId: string; content: string; isAnonymous: boolean }) =>
      api.post<Prayer>(`/api/prayers/${encodeURIComponent(prayerId)}/comments`, input),
    onSuccess: (prayer) => patchPrayer(qc, prayer.id, () => prayer),
  });
}

export function useToggleReaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prayerId, type }: { prayerId: string; type: ReactionType }) =>
      api.post<{ id: string; reactions: ReactionSummary }>(`/api/prayers/${encodeURIComponent(prayerId)}/reactions`, { type }),
    onSuccess: ({ id, reactions }) => patchPrayer(qc, id, (p) => ({ ...p, reactions })),
  });
}

// ---- Living it Out ---------------------------------------------------------

export const useLiving = (zone: string) =>
  useInfiniteQuery({
    queryKey: keys.living(zone),
    queryFn: ({ pageParam, signal }) => {
      const qs = new URLSearchParams();
      if (zone !== "ALL") qs.set("zone", zone);
      if (pageParam) qs.set("cursor", pageParam);
      return api.get<Page<LivingPost>>(`/api/living${qs.size ? `?${qs}` : ""}`, signal);
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export function useCreateLiving() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ content, isAnonymous, images }: { content: string; isAnonymous: boolean; images: File[] }) => {
      const form = new FormData();
      form.set("content", content);
      form.set("isAnonymous", String(isAnonymous));
      for (const img of images) form.append("images", img);
      return api.post<{ post: LivingPost; points: AwardResult }>("/api/living", form);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["living"] });
      void qc.invalidateQueries({ queryKey: keys.me });
    },
  });
}

// ---- Testimonies -----------------------------------------------------------

export const useTestimonies = (includeDrafts = false) =>
  useQuery({
    queryKey: keys.testimonies(includeDrafts),
    queryFn: ({ signal }) =>
      api.get<{ items: TestimonySummary[] }>(`/api/testimonies${includeDrafts ? "?status=all" : ""}`, signal),
    select: (d) => d.items,
  });

export const useTestimony = (idOrSlug: string) =>
  useQuery({
    queryKey: keys.testimony(idOrSlug),
    queryFn: ({ signal }) => api.get<Testimony>(`/api/testimonies/${encodeURIComponent(idOrSlug)}`, signal),
  });

export interface TestimonyInput {
  title: string;
  subtitle?: string | null;
  byline?: string | null;
  coverMediaId?: string | null;
  blocks: TestimonyBlock[];
  status: "DRAFT" | "PUBLISHED";
}

export function useSaveTestimony() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: TestimonyInput }) =>
      id ? api.put<Testimony>(`/api/testimonies/${encodeURIComponent(id)}`, { ...input }) : api.post<Testimony>("/api/testimonies", { ...input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["testimonies"] }),
  });
}

export function useDeleteTestimony() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/testimonies/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["testimonies"] }),
  });
}

export function uploadImage(file: File, kind: "LIVING_POST" | "TESTIMONY"): Promise<UploadedImage> {
  const form = new FormData();
  form.set("image", file);
  return api.post<UploadedImage>(`/api/uploads?kind=${kind}`, form);
}
