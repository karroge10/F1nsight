interface TrackIconProps {
  className?: string;
}

export function TrackIcon({ className = "w-16 h-8" }: TrackIconProps) {
  return (
    <div className={`${className} relative opacity-30`}>
      <svg viewBox="0 0 64 32" className="w-full h-full">
        <path
          d="M8 16 C8 8, 16 4, 24 8 L40 8 C48 8, 56 12, 56 16 C56 20, 48 24, 40 24 L24 24 C16 24, 8 20, 8 16 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-gray-600"
        />
        <path
          d="M12 16 C12 12, 16 10, 20 12 L44 12 C48 12, 52 14, 52 16 C52 18, 48 20, 44 20 L20 20 C16 20, 12 18, 12 16 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          className="text-gray-700"
        />
      </svg>
    </div>
  );
}

