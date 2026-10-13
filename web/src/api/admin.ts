import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, keys } from "./index";
import type { AdminChallenge, AdminGoal, ChallengeInput, CellGroupBoard, IndividualBoard, Person } from "./types";

// ---- Leaderboards (everyone) -------------------------------------------------

export const useIndividualBoard = (limit = 50) =>
  useQuery({
    queryKey: ["leaderboard", "individuals", limit],
    queryFn: ({ signal }) => api.get<IndividualBoard>(`/api/leaderboard/individuals?limit=${limit}`, signal),
  });

export const useCellGroupBoard = () =>
  useQuery({
    queryKey: ["leaderboard", "cell-groups"],
    queryFn: ({ signal }) => api.get<CellGroupBoard>("/api/leaderboard/cell-groups", signal),
  });

// ---- Admin -------------------------------------------------------------------

const adminKeys = {
  challenges: ["admin", "challenges"] as const,
  goals: ["admin", "goals"] as const,
  people: (q: string) => ["admin", "people", q] as const,
};

export const useAdminChallenges = () =>
  useQuery({
    queryKey: adminKeys.challenges,
    queryFn: ({ signal }) =>
      api.get<{ items: AdminChallenge[]; weeks: { weekStart: string; weekNumber: number }[] }>("/api/admin/challenges", signal),
  });

export function useSaveChallenge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: ChallengeInput }) =>
      id
        ? api.put<AdminChallenge>(`/api/admin/challenges/${encodeURIComponent(id)}`, { ...input })
        : api.post<AdminChallenge>("/api/admin/challenges", { ...input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.challenges });
      void qc.invalidateQueries({ queryKey: keys.home });
    },
  });
}

export function useDeleteChallenge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/admin/challenges/${encodeURIComponent(id)}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.challenges });
      void qc.invalidateQueries({ queryKey: keys.home });
    },
  });
}

export const useAdminGoals = () =>
  useQuery({
    queryKey: adminKeys.goals,
    queryFn: ({ signal }) => api.get<{ months: string[]; items: AdminGoal[] }>("/api/admin/monthly-goals", signal),
  });

export function useSaveGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ month, title, description }: { month: string; title: string; description: string | null }) =>
      api.put<AdminGoal>(`/api/admin/monthly-goals/${month}`, { title, description }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.goals });
      void qc.invalidateQueries({ queryKey: keys.home });
    },
  });
}

export function useDeleteGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (month: string) => api.delete<void>(`/api/admin/monthly-goals/${month}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.goals });
      void qc.invalidateQueries({ queryKey: keys.home });
    },
  });
}

export const usePeople = (q: string) =>
  useQuery({
    queryKey: adminKeys.people(q),
    queryFn: ({ signal }) => api.get<{ items: Person[] }>(`/api/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`, signal),
    select: (d) => d.items,
    placeholderData: (previous) => previous,
  });

export function useUpdatePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...change }: { id: string; role?: "ADMIN" | "USER"; cellGroupId?: string | null }) =>
      change.role
        ? api.post<Person>(`/api/admin/users/${encodeURIComponent(id)}/role`, { role: change.role })
        : api.patch<Person>(`/api/admin/users/${encodeURIComponent(id)}`, { cellGroupId: change.cellGroupId ?? null }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "people"] });
      void qc.invalidateQueries({ queryKey: ["leaderboard"] });
      void qc.invalidateQueries({ queryKey: keys.me });
    },
  });
}
