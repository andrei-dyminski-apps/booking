/**
 * What runs before the first paint to put the saved theme on `<html>`, so a dark-mode
 * visitor never sees the light page first. It is `next-themes`' own script, spelled out
 * for the props `Providers` hands it (`attribute="class"`, the `theme` key in storage,
 * `system` by default, `color-scheme` set), because that one cannot be allowed by the
 * policy any more.
 *
 * The page it runs in is prerendered without a request (`cacheComponents`), so a nonce
 * minted per request never reaches it. The policy allows this exact text by its hash
 * instead (`_app/proxy/content-security-policy.ts`), which is why it is a constant rather
 * than something built per render: a single character changed here is a different hash,
 * and the proxy computes it from this same string. `next-themes`' own script carries
 * only the nonce, so `Providers` leaves it inert.
 */
export const THEME_SCRIPT =
  '(function(){try{var t=localStorage.getItem("theme")||"system";if(t==="system")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";var e=document.documentElement;e.classList.remove("light","dark");e.classList.add(t);if(t==="light"||t==="dark")e.style.colorScheme=t}catch(_){}})()';
