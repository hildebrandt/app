"use client";

import { motion, type Transition } from "motion/react";
import { useSyncExternalStore, type SVGProps } from "react";

/*!
 * LoaderCircle animation adapted from Lucide Animated.
 * https://lucide-animated.com/r/loader-circle.json
 *
 * MIT License
 *
 * Copyright (c) 2024-2026 pqoqubbw
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * The original loader-circle path is from Lucide and is licensed under the ISC
 * License:
 *
 * ISC License
 *
 * Copyright (c) 2026 Lucide Icons and Contributors
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const INITIAL = { rotate: 0 };
const REST = { rotate: 0 };
const SPIN = { rotate: 360 };
const ORIGIN = { transformOrigin: "12px 12px" };
const SPIN_TRANSITION: Transition = {
  duration: 0.8,
  ease: "linear",
  repeat: Number.POSITIVE_INFINITY,
};
const STOP_TRANSITION: Transition = { duration: 0 };

let reducedMotionQuery: MediaQueryList | undefined;

function getReducedMotionQuery() {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return undefined;
  }
  reducedMotionQuery ??= window.matchMedia(REDUCED_MOTION_QUERY);
  return reducedMotionQuery;
}

function subscribeToReducedMotion(onChange: () => void) {
  const query = getReducedMotionQuery();
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

export interface LoaderCircleIconProps extends SVGProps<SVGSVGElement> {
  size?: number;
  spinning?: boolean;
}

export function LoaderCircleIcon({
  size = 16,
  spinning = false,
  ...props
}: LoaderCircleIconProps) {
  const reducedMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    () => getReducedMotionQuery()?.matches ?? true,
    () => true
  );
  const animating = spinning && !reducedMotion;

  return (
    <svg
      {...props}
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <motion.path
        animate={animating ? SPIN : REST}
        d="M21 12a9 9 0 1 1-6.219-8.56"
        initial={INITIAL}
        style={ORIGIN}
        transition={animating ? SPIN_TRANSITION : STOP_TRANSITION}
      />
    </svg>
  );
}
