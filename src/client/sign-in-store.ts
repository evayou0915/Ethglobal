"use client";

import { create } from "zustand";

/** Tiny global store so any page can trigger the Nav's <SignInModal/>. */
type SignInState = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
};

export const useSignInModal = create<SignInState>((set) => ({
  isOpen: false,
  open:  () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
