// The media rig's optional-dependency guard (hyg-09). NO media dependency
// is added to package.json: sharp and ffmpeg-static are imported
// dynamically, guarded, and a missing module is a MESSAGE, never a stack
// trace — CI never downloads a 30 MB ffmpeg for tooling nobody runs there.
// docs/MEDIA-GUIDE.md's fenced `media-imports` block lists the modules
// scripts/media/** may import without declaring; scripts/repo-refs.mjs
// reads that block so the hygiene check stays green by policy, not by
// exception.

/** The exact message a missing optional module prints. Pinned by test. */
export function missingModuleMessage(moduleName) {
  return `error: ${moduleName} is not installed — this media script needs it locally.\nrun: npm i --no-save ${moduleName}\n(nothing is added to package.json; CI never installs it)`;
}

/**
 * Dynamically import an optional media dependency. On failure, print the
 * exact message to stderr and exit 1 — never a stack trace.
 *
 * @template T
 * @param {string} moduleName
 * @param {(mod: T) => void} [onMissing] called only when the import fails;
 *   if it returns true the caller has handled the absence (e.g. a system
 *   binary on PATH suffices) and the process does NOT exit.
 * @returns {Promise<T>}
 */
export async function loadOptional(moduleName, onMissing) {
  try {
    return await import(moduleName);
  } catch {
    if (onMissing && onMissing()) return undefined;
    console.error(missingModuleMessage(moduleName));
    process.exit(1);
  }
}
