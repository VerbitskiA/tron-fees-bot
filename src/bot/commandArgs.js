/**
 * Разбор текста сообщения вида `/cmd@Bot args...`.
 * @param {import("grammy").Context} ctx
 */
export function commandArgs(ctx) {
  const text = ctx.message?.text?.trim() ?? "";
  const parts = text.split(/\s+/).filter(Boolean);
  const first = parts[0] ?? "";
  const cmdBase = first.split("@")[0]?.toLowerCase() ?? "";
  return { cmd: cmdBase, args: parts.slice(1) };
}
