'use client'

import { useState } from 'react';

interface DriverAvatarProps {
  driverName: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function DriverAvatar({ driverName, className = '', size = 'md' }: DriverAvatarProps) {
  const [imageError, setImageError] = useState(false);

  // Generate driver image path
  const getDriverImagePath = (name: string): string => {
    if (!name) return '/images/drivers/max_verstappen.jpg';
    
    // Convert driver name to filename format
    const driverFileName = name.toLowerCase()
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .replace(/[^a-z0-9_]/g, '') // Remove special characters except underscores
      .replace(/_+/g, '_') // Replace multiple underscores with single
      .replace(/^_+|_+$/g, ''); // Remove leading/trailing underscores
    
    return `/images/drivers/${driverFileName}.jpg`;
  };

  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10', 
    lg: 'w-12 h-12'
  };

  // Use Verstappen's image as the primary placeholder for all drivers
  const imagePath = imageError ? '/images/drivers/max_verstappen.jpg' : getDriverImagePath(driverName);

  return (
    <div className={`relative ${sizeClasses[size]} rounded-full overflow-hidden bg-gray-600 flex-shrink-0 ${className}`}>
      <img
        src={imagePath}
        alt={driverName}
        className="w-full h-full object-cover hover:scale-110 transition-transform duration-300"
        onError={(e) => {
          if (!imageError) {
            setImageError(true);
            // Use Verstappen's image as fallback
            const target = e.target as HTMLImageElement;
            target.src = '/images/drivers/max_verstappen.jpg';
          } else {
            // Final fallback to generic placeholder
            const target = e.target as HTMLImageElement;
            target.src = '/placeholder-user.jpg';
          }
        }}
      />
    </div>
  );
}
