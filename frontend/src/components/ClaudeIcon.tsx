interface Props {
  size?: number;
}

export default function ClaudeIcon({ size = 24 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id="cc-grad" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FF8C42"/>
          <stop offset="100%" stopColor="#C84B00"/>
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx="20" fill="url(#cc-grad)"/>
      <path d="M 65 25 A 37.5 37.5 0 1 0 65 75"
            stroke="white" strokeWidth="12" strokeLinecap="round" fill="none"/>
      <path d="M 67 40 L 80 50 L 67 60"
            stroke="white" strokeWidth="7.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  );
}
