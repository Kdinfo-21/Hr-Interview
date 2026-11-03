// Lightweight, dependency-free inline icon set.
// Purely presentational — no new packages, no logic.
import { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const IconLogo = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <path d="M8 12h2m4 0h2M8 8h8M9 16h6" />
  </svg>
);

export const IconGrid = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);

export const IconCalendarPlus = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
    <path d="M3 9.5h18M8 2.5v4M16 2.5v4M12 13v5M9.5 15.5h5" />
  </svg>
);

export const IconUsers = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="9" cy="8" r="3.25" />
    <path d="M2.75 19c0-3.2 2.8-5.5 6.25-5.5S15.25 15.8 15.25 19" />
    <circle cx="17.2" cy="9" r="2.6" />
    <path d="M15.5 13.7c2.6.4 4.5 2.3 4.5 5.3" />
  </svg>
);

export const IconClock = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.2 2" />
  </svg>
);

export const IconCheckCircle = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12.5l2.5 2.5L16 9.5" />
  </svg>
);

export const IconAlertTriangle = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M10.6 3.9 2.4 18a1.8 1.8 0 0 0 1.55 2.7h16.1A1.8 1.8 0 0 0 21.6 18L13.4 3.9a1.8 1.8 0 0 0-3.1 0Z" />
    <path d="M12 9.5v4.25M12 17h.01" />
  </svg>
);

export const IconMic = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="9" y="2.5" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" />
  </svg>
);

export const IconVolume = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M4 9.5v5h3.5L13 19V5L7.5 9.5H4Z" />
    <path d="M16.2 9a4.2 4.2 0 0 1 0 6M18.8 6.2a8 8 0 0 1 0 11.6" />
  </svg>
);

export const IconCamera = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M4 8.2A1.7 1.7 0 0 1 5.7 6.5h1.6L8.4 4.4A1.7 1.7 0 0 1 9.8 3.6h4.4a1.7 1.7 0 0 1 1.4.8l1.1 2.1h1.6A1.7 1.7 0 0 1 20 8.2v9.1a1.7 1.7 0 0 1-1.7 1.7H5.7A1.7 1.7 0 0 1 4 17.3Z" />
    <circle cx="12" cy="12.5" r="3.4" />
  </svg>
);

export const IconLink = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M9.5 14.5 14.5 9.5" />
    <path d="M11 6.5 13.1 4.4a3.5 3.5 0 0 1 5 5L16 11.5M13 17.5l-2.1 2.1a3.5 3.5 0 0 1-5-5L8 12.5" />
  </svg>
);

export const IconCopy = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="8.5" y="8.5" width="12" height="12" rx="2.2" />
    <path d="M15.5 8.5V5.7A2.2 2.2 0 0 0 13.3 3.5H5.7A2.2 2.2 0 0 0 3.5 5.7v7.6a2.2 2.2 0 0 0 2.2 2.2h2.8" />
  </svg>
);

export const IconRefresh = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M4 12a8 8 0 0 1 13.66-5.66L20 8.5M20 12a8 8 0 0 1-13.66 5.66L4 15.5" />
    <path d="M20 4v4.5h-4.5M4 20v-4.5h4.5" />
  </svg>
);

export const IconArrowRight = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M4.5 12h15M13.5 6l6 6-6 6" />
  </svg>
);

export const IconShield = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M12 3.2 5 5.8v5.2c0 4.6 3 8 7 9.8 4-1.8 7-5.2 7-9.8V5.8Z" />
    <path d="M9 12l2.2 2.2L15.5 9.6" />
  </svg>
);

export const IconInbox = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M3.5 12.5h4.7l1.4 2.2h4.8l1.4-2.2h4.7" />
    <path d="M6 5.5h12l2.5 7v6a1.7 1.7 0 0 1-1.7 1.7H5.2A1.7 1.7 0 0 1 3.5 18.5v-6Z" />
  </svg>
);

export const IconFileText = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M7 3.5h7.2L18 7.3V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5A1.5 1.5 0 0 1 7 3.5Z" />
    <path d="M13.8 3.5V7h4.2M9 12h6M9 15.5h6M9 8.5h2.5" />
  </svg>
);

export const IconSparkle = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M12 3.5 13.4 8.6 18.5 10l-5.1 1.4L12 16.5l-1.4-5.1L5.5 10l5.1-1.4Z" />
    <path d="M18.5 15.5 19.1 17.4 21 18l-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6Z" />
  </svg>
);

export const IconDownload = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5" />
    <path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17" />
  </svg>
);

export const IconExternalLink = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M14 4h6v6" />
    <path d="M20 4 10 14" />
    <path d="M18 13.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7A1.5 1.5 0 0 1 5 5.5h5.5" />
  </svg>
);

export const IconChevronLeft = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
);
