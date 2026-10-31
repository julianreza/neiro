export function modelSource(id: string, provider: string): string {
  const generic = /^(?:9router|hermes|other|unknown)?$/i;
  const parts = id.split("/").filter(Boolean);
  while (parts.length && generic.test(parts[0])) parts.shift();
  const source = !generic.test(provider.trim()) ? provider.trim() : parts.length > 1 ? parts[0] : "Other";
  if (/^(ag|antigravity)$/i.test(source)) return "Antigravity";
  if (/^chatgpt$/i.test(source)) return "ChatGPT";
  return source;
}
