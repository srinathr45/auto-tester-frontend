const CSS_UTILITY_CLASS =
  /^(flex|inline-flex|grid|inline-grid|items-|justify-|gap-|space-|w-|h-|min-|max-|p-|m-|px-|py-|pt-|pb-|pl-|pr-|mx-|my-|mt-|mb-|ml-|mr-|text-|bg-|rounded|border|shadow|ring-|opacity-|from-|to-|via-|dark$|light$|sm:|md:|lg:|xl:|hover:|focus:|active:|disabled:|aria-|font-|leading-|tracking-|overflow-|cursor-|transition|duration-|ease-|animate-|z-|top-|left-|right-|bottom-|inset-)/;

/**
 * Tailwind variants (`dark:…`, `ring-…/40`) are not valid bare CSS class selectors.
 * Only keep simple BEM-ish identifiers.
 */
export function isSafeCssClass(c: string): boolean {
  if (!c || c.length < 2) return false;
  if (/[:/\[\]()@!%.#]/.test(c)) return false;
  return /^[a-zA-Z_][\w-]*$/.test(c);
}

/**
 * Prefer distinctive classes (registry-search-clear) over shared ones (form-select-clear).
 */
export function pickBestCssClasses(className?: string, limit = 2): string[] {
  if (!className) return [];
  const classes = String(className)
    .trim()
    .split(/\s+/)
    .filter((c) => c && isSafeCssClass(c) && !CSS_UTILITY_CLASS.test(c));
  const score = (c: string) => {
    let s = c.length;
    if (/^form-select-clear$/i.test(c)) s -= 40;
    if (/search|registry|unique/i.test(c)) s += 50;
    if (/clear|btn|button|icon/i.test(c)) s += 8;
    return s;
  };
  return [...classes].sort((a, b) => score(b) - score(a)).slice(0, limit);
}

export { CSS_UTILITY_CLASS };
