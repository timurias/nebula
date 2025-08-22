import { cn } from "@/lib/utils";
import type { SVGProps } from "react";

const IconBase = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
    className={cn("w-full h-full", props.className)}
  />
);

export const IconStructure = (props: SVGProps<SVGSVGElement>) => (
  <IconBase {...props}>
    <rect width="14" height="14" x="5" y="5" rx="2" />
  </IconBase>
);

export const IconWeapon = (props: SVGProps<SVGSVGElement>) => (
  <IconBase {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v2" />
    <path d="M12 20v2" />
    <path d="m4.93 4.93 1.41 1.41" />
    <path d="m17.66 17.66 1.41 1.41" />
    <path d="M2 12h2" />
    <path d="M20 12h2" />
    <path d="m4.93 19.07 1.41-1.41" />
    <path d="m17.66 6.34 1.41-1.41" />
  </IconBase>
);

export const IconAmmo = (props: SVGProps<SVGSVGElement>) => (
  <IconBase {...props}>
    <path d="M7 20v-2.02" />
    <path d="M17 20v-2.02" />
    <path d="M7 5V2" />
    <path d="M17 5V2" />
    <path d="M5 22h14" />
    <path d="M5 2h14" />
    <ellipse cx="12" cy="12.5" rx="5" ry="7.5" />
  </IconBase>
);

export const IconMedical = (props: SVGProps<SVGSVGElement>) => (
  <IconBase {...props}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </IconBase>
);
