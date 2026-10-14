"use client";

import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSettings } from "@/store/settings";
import { LogoMark } from "./Logo";

/**
 * First-visit name gate.
 *
 * The very first time Sidify is opened on a device we ask for a name, save it
 * as `profileName` (persisted in `sidify-settings` / localStorage) and never
 * ask again. That same name is what Listen Together uses automatically —
 * `displayName()` in the room client and both room pages read `profileName`,
 * so there is no second prompt inside a room.
 *
 * Until the persisted settings have rehydrated we render only the Sidify
 * splash, so a returning listener never sees the gate flash before their
 * saved name loads. The old shipped default ("Siddharth") counts as
 * "no name yet": anyone still carrying it is asked once, for real.
 */
export default function NameGate() {
  const profileName = useSettings((s) => s.profileName);
  const nameAsked = useSettings((s) => s.nameAsked);
  const [draft, setDraft] = useState("");
  const hydrated = useSyncExternalStore(
    (onChange) => useSettings.persist.onFinishHydration(onChange),
    () => useSettings.persist.hasHydrated(),
    () => false
  );

  const saved = profileName.trim();
  const hasRealName = saved.length > 0 && saved !== "Siddharth";

  // A name saved before this gate existed (Settings, an older room join) is
  // already "remembered" — mark it asked instead of interrogating them again.
  useEffect(() => {
    if (hydrated && !nameAsked && hasRealName) useSettings.getState().set({ nameAsked: true });
  }, [hydrated, nameAsked, hasRealName]);

  const needsName = hydrated && !nameAsked && !hasRealName;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const name = draft.trim().slice(0, 24);
    if (!name) return;
    useSettings.getState().set({ profileName: name, nameAsked: true });
  };

  return (
    <AnimatePresence>
      {!hydrated && (
        <motion.div
          key="sidify-splash"
          className="fixed inset-0 z-[120] grid place-items-center bg-bg"
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          aria-hidden="true"
        >
          <LogoMark size={56} />
        </motion.div>
      )}
      {needsName && (
        <motion.div
          key="sidify-name-gate"
          className="fixed inset-0 z-[120] grid place-items-center bg-bg/80 px-4 backdrop-blur-2xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          role="dialog"
          aria-modal="true"
          aria-label="Welcome to Sidify"
        >
          <motion.form
            onSubmit={submit}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", damping: 26, stiffness: 320 }}
            className="bar-glass w-full max-w-[400px] rounded-[26px] p-7 text-center"
          >
            <LogoMark size={56} className="mx-auto" />
            <h1 className="mt-4 text-[26px] font-extrabold tracking-[-0.5px]">Welcome to Sidify</h1>
            <p className="mt-1.5 text-[14.5px] leading-relaxed text-fg-2">
              What should we call you? This is the name friends will see when you listen together.
            </p>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Your name"
              aria-label="Your name"
              maxLength={24}
              autoFocus
              autoComplete="name"
              enterKeyHint="go"
              className="field mt-5 h-12 w-full text-center text-[16px] font-semibold"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              className="mt-3 inline-flex h-12 w-full items-center justify-center rounded-full bg-primary text-[15px] font-bold text-on-primary transition-[opacity,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
            >
              Continue
            </button>
            <p className="mt-3 text-[12px] leading-relaxed text-fg-3">We&apos;ll remember it on this device, so we only ask once.</p>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
