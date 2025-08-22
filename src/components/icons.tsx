
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

export const IconWeapon1x1 = (props: SVGProps<SVGSVGElement>) => (
    <IconBase {...props}>
        <circle cx="12" cy="12" r="2" />
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

export const IconWeapon3x3 = (props: SVGProps<SVGSVGElement>) => (
    <IconBase {...props}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v3" />
        <path d="M12 19v3" />
        <path d="m3.5 3.5 2.1 2.1" />
        <path d="m18.4 18.4 2.1 2.1" />
        <path d="M2 12h3" />
        <path d="M19 12h3" />
        <path d="m3.5 20.5 2.1-2.1" />
        <path d="m18.4 5.6 2.1-2.1" />
    </IconBase>
);

export const IconWeapon5x5 = (props: SVGProps<SVGSVGElement>) => (
    <IconBase {...props}>
        <circle cx="12" cy="12" r="6" />
        <path d="M12 2v4" />
        <path d="M12 18v4" />
        <path d="m2.5 2.5 2.8 2.8" />
        <path d="m18.7 18.7 2.8 2.8" />
        <path d="M2 12h4" />
        <path d="M18 12h4" />
        <path d="m2.5 21.5 2.8-2.8" />
        <path d="m18.7 5.3 2.8-2.8" />
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

export const IconEnergy = (props: SVGProps<SVGSVGElement>) => (
    <IconBase {...props}>
        <path d="m13 2-3 9h5l-3 9" />
    </IconBase>
);
