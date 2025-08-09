'use client'

import { useState, useEffect } from 'react';

interface TrackBackgroundProps {
  circuit: string;
  className?: string;
  children?: React.ReactNode;
}

export function TrackBackground({ circuit, className = '', children }: TrackBackgroundProps) {
  const [imageUrl, setImageUrl] = useState<string>('/f1-aerial.png');
  const [imageLoaded, setImageLoaded] = useState(false);

  // Generate track image path
  const getTrackImagePath = (circuitName: string): string => {
    if (!circuitName) return '/f1-aerial.png';
    
    const trackName = circuitName.toLowerCase()
      .replace(/circuit/gi, '')
      .replace(/international/gi, '')
      .replace(/grand prix/gi, '')
      .replace(/de\s+/gi, '')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, ''); // remove leading/trailing hyphens
    
    return `/images/tracks/${trackName}.jpg`;
  };

  useEffect(() => {
    const trackImagePath = getTrackImagePath(circuit);
    
    // Preload the image to check if it exists
    const img = new Image();
    img.onload = () => {
      setImageUrl(trackImagePath);
      setImageLoaded(true);
    };
    img.onerror = () => {
      // First fallback: try zandvoort.jpg as placeholder
      const fallbackImg = new Image();
      fallbackImg.onload = () => {
        setImageUrl('/images/tracks/zandvoort.jpg');
        setImageLoaded(true);
      };
      fallbackImg.onerror = () => {
        // Final fallback: default F1 image
        setImageUrl('/f1-aerial.png');
        setImageLoaded(true);
      };
      fallbackImg.src = '/images/tracks/zandvoort.jpg';
    };
    
    img.src = trackImagePath;
  }, [circuit]);

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* Background Image */}
      <div 
        className="absolute inset-0 bg-cover bg-center transition-opacity duration-500"
        style={{
          backgroundImage: `url('${imageUrl}')`,
          opacity: imageLoaded ? 0.4 : 0 // Increased opacity from 0.2 to 0.4
        }}
      />
      
      {/* Gradient Overlay for better text readability - reduced opacity */}
      <div className="absolute inset-0 bg-gradient-to-r from-red-600/60 to-red-800/60" />
      
      {/* Content */}
      <div className="relative z-10">
        {children}
      </div>
    </div>
  );
}
