"use client";

/* Adapted from "Like" by Bencho (bencho.dev/blocks/like).

   MIT License

   Copyright (c) 2026 Lorenzo Cabra

   Permission is hereby granted, free of charge, to any person obtaining a copy
   of this software and associated documentation files (the "Software"), to deal
   in the Software without restriction, including without limitation the rights
   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   copies of the Software, and to permit persons to whom the Software is
   furnished to do so, subject to the following conditions:

   The above copyright notice and this permission notice shall be included in all
   copies or substantial portions of the Software.

   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
   SOFTWARE. */

import { HeartIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { changeVote } from "@/app/[locale]/v/[slug]/actions";
import { loginPath } from "@/lib/auth/redirects";
import { intlLocales, type Locale } from "@/lib/i18n";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { hasSupabaseConfig } from "@/lib/supabase/config";
import { cn } from "@/lib/utils";

/* ══ Like ═════════════════════════════════════════════════
   A heart and a count. Press it and the heart vanishes, a disc
   blooms where it was and hollows out into a ring, seven pairs
   of dots burst off the ring, and the heart springs back past
   its size, while the count rolls up one. Press again and it
   empties and the count rolls back down.

   ── ONLY THE DIGITS THAT CHANGE ROLL ────────────────────
   An odometer, not a number being replaced: 1,284 to 1,285
   turns the last wheel and leaves the rest where they are,
   and 1,299 to 1,300 turns three, each a beat after the one
   to its right, the way a carry travels. Every digit is keyed
   by its place and its value, so a digit that did not change
   is the same element and never moves.

   ── UP FOR MORE, DOWN FOR LESS ─────────────────────────
   Liking rolls the new digit in from below and the old one out
   the top; unliking runs the other way. Direction is the whole
   difference between a count going up and a count being
   replaced. */

interface VoteCopy {
  vote: string;
  voted: string;
  loading: string;
  signIn: string;
  votes: string;
  error: string;
}

// Vários cards na mesma tela: uma consulta só de "em quem eu votei", compartilhada entre os botões.
let myVotes: Promise<Set<string> | null> | undefined;

function loadMyVotes(): Promise<Set<string> | null> {
  return myVotes ??= (async () => {
    const client = createBrowserSupabaseClient();
    const session = await client?.auth.getSession();
    if (!client || !session?.data.session) return null;
    const result = await client.rpc("my_votes");
    if (result.error) throw result.error;
    return new Set<string>((result.data ?? []).map((vote: { submission_id: string }) => vote.submission_id));
  })().catch((error: unknown) => {
    myVotes = undefined;
    throw error;
  });
}

function Roll({ value, up, locale }: { value: number; up: boolean; locale: Locale }) {
  const chars = value.toLocaleString(intlLocales[locale]).split("");
  /* places counted from the right, so a new leading digit does
     not shift the keys of the ones already there */
  return (
    <span className="lk-count" aria-hidden="true">
      {chars.map((char, index) => {
        const place = chars.length - 1 - index;
        if (!/\d/.test(char)) return <span key={`c${place}`} className="lk-comma">{char}</span>;
        return (
          <span key={`p${place}`} className="lk-wheel">
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                key={char}
                className="lk-digit"
                initial={{ y: up ? "100%" : "-100%", opacity: 0 }}
                animate={{ y: "0%", opacity: 1 }}
                exit={{ y: up ? "-100%" : "100%", opacity: 0 }}
                transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1], delay: place * 0.04 }}
              >
                {char}
              </motion.span>
            </AnimatePresence>
          </span>
        );
      })}
    </span>
  );
}

/* a disc that hollows into a ring, and pairs of dots */
function Bloom() {
  return (
    <span className="lk-burst" aria-hidden="true">
      <span className="lk-bloom" />
      {Array.from({ length: 7 }, (_, spoke) => (
        <span key={spoke} className="lk-spoke" style={{ "--a": `${spoke * (360 / 7) - 90}deg` } as React.CSSProperties}>
          <i />
          <i />
        </span>
      ))}
    </span>
  );
}

export function VoteButton({
  locale,
  submissionId,
  initialCount,
  copy,
  showLabel = false,
  className,
}: {
  locale: Locale;
  submissionId: string;
  initialCount: number;
  copy: VoteCopy;
  showLabel?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [voted, setVoted] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [count, setCount] = useState(initialCount);
  const [ready, setReady] = useState(() => !hasSupabaseConfig());
  const [pending, setPending] = useState(false);
  const [beat, setBeat] = useState(0);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    let mounted = true;
    if (!createBrowserSupabaseClient()) return () => { mounted = false; };

    loadMyVotes().then((votes) => {
      if (!mounted) return;
      setSignedIn(votes !== null);
      setVoted(votes?.has(submissionId) ?? false);
      setReady(true);
    }).catch(() => {
      if (mounted) setMessage(copy.error);
    });

    return () => { mounted = false; };
  }, [copy.error, submissionId]);

  async function toggleVote() {
    if (!ready) return;

    const client = createBrowserSupabaseClient();
    if (!client) {
      setMessage(copy.error);
      return;
    }

    const session = await client.auth.getSession();
    if (!session.data.session) {
      const next = `${window.location.pathname}${window.location.search}`;
      router.push(loginPath(locale, next));
      return;
    }

    const previousVoted = voted;
    const previousCount = count;
    setMessage(undefined);
    setVoted(!previousVoted);
    setCount(Math.max(previousCount + (previousVoted ? -1 : 1), 0));
    if (!previousVoted) setBeat((current) => current + 1);
    setPending(true);
    let failed = false;
    try {
      const result = await changeVote({
        submissionId,
        intent: previousVoted ? "revoke" : "cast",
      });
      failed = !result.ok;
    } catch {
      failed = true;
    } finally {
      setPending(false);
    }

    if (failed) {
      setVoted(previousVoted);
      setCount(previousCount);
      setMessage(copy.error);
      return;
    }
    const votes = await loadMyVotes().catch(() => null);
    if (previousVoted) votes?.delete(submissionId);
    else votes?.add(submissionId);
  }

  const label = !ready ? copy.loading : voted ? copy.voted : copy.vote;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <button
        type="button"
        className="lk"
        onClick={() => void toggleVote()}
        disabled={pending || !ready}
        data-voted={voted || undefined}
        aria-pressed={voted}
        aria-label={`${label}. ${count} ${copy.votes}`}
        title={!ready ? copy.loading : signedIn ? label : copy.signIn}
      >
        <span className="lk-heart">
          {/* keyed by the press, so every like plays once */}
          <span key={voted ? `on${beat}` : "off"} className="lk-glyph" data-on={voted || undefined} data-burst={voted && beat > 0 ? true : undefined}>
            <HeartIcon aria-hidden="true" className="size-4.5" fill={voted ? "currentColor" : "none"} />
          </span>
          {voted && beat > 0 ? <Bloom key={beat} /> : null}
        </span>
        {showLabel ? <span>{label}</span> : null}
        <Roll value={count} up={voted} locale={locale} />
      </button>
      {message ? <p role="alert" className="text-sm text-destructive-foreground">{message}</p> : null}
    </div>
  );
}
