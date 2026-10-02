import { cn } from "cn";

import { locationLabel } from "@/lib/format";

export function LocationLabel({
  city,
  code,
  name,
  className,
}: {
  city?: string;
  code?: string;
  name?: string;
  className?: string;
}) {
  const cc = (code || "").trim().toLowerCase();
  const flag = /^[a-z]{2}$/.test(cc);
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      {flag ? (
        <img
          alt=""
          width={20}
          height={15}
          src={`https://flagcdn.com/w40/${cc}.png`}
          className="h-3.5 w-5 shrink-0 rounded-[2px] object-cover"
        />
      ) : null}
      <span className="truncate">{locationLabel(city, code, name)}</span>
    </span>
  );
}
