import { motion } from "motion/react";
import { EASE_EXIT } from "./motion";

/**
 * The rubber stamp. It renders only when handed a result object, never on a timer.
 * Lands with scale 1.35 to 1 in 180 ms on the exit curve (a stamp accelerates into the paper), no bounce.
 * Reduced motion: MotionConfig drops the scale and keeps the fade.
 */
export function Stamp({ result, className = "" }: { result: { ok: boolean } | null; className?: string }) {
  if (!result) return null;
  const ok = result.ok;
  return (
    <motion.div
      key={String(ok)}
      role="status"
      className={`stamp ${ok ? "ok" : "bad"} ${className}`}
      style={{ rotate: ok ? -4 : 3 }}
      initial={{ scale: 1.35, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.18, ease: EASE_EXIT }}
    >
      {ok ? "Verified" : <>Exception<span aria-hidden> · </span><span className="sr-only">: </span>do not pay</>}
    </motion.div>
  );
}
