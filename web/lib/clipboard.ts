import { toast } from "sonner";

export async function copyText(text: string, label = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(label);
  } catch {
    toast.error("Could not copy to clipboard");
  }
}

export function shareURL(slug: string) {
  return `${window.location.origin}/status/${slug}`;
}

export function groupShareURL(slug: string) {
  return `${window.location.origin}/status/group/${slug}`;
}
