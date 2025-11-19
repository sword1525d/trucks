'use client';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

interface OccupancySelectorProps {
  initialValue?: number;
  onValueChange: (value: number) => void;
  disabled?: boolean;
}

const TruckSVG = ({
  occupancy,
  onSegmentClick,
  disabled,
}: {
  occupancy: number;
  onSegmentClick: (segment: number) => void;
  disabled?: boolean;
}) => {
  const segments = Array.from({ length: 10 }, (_, i) => i + 1); // 1 to 10

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 300 120"
      className="w-full h-auto"
    >
      {/* Truck Body */}
      <path
        d="M288,105H270V90H220V70H10V105H5c-2.76,0-5-2.24-5-5V60c0-2.76,2.24-5,5-5H215c2.76,0,5,2.24,5,5v15h50v20h8c2.76,0,5,2.24,5,5v5h-3Z"
        className="fill-gray-300 dark:fill-gray-700"
      />
      {/* Wheels */}
      <circle cx="35" cy="105" r="12" className="fill-gray-800 dark:fill-gray-900" />
      <circle cx="185" cy="105" r="12" className="fill-gray-800 dark:fill-gray-900" />
      <circle cx="35" cy="105" r="5" className="fill-gray-500 dark:fill-gray-600" />
      <circle cx="185" cy="105" r="5" className="fill-gray-500 dark:fill-gray-600" />
      {/* Cab */}
      <path
        d="M220,90H270V55c0-5.52-4.48-10-10-10H230c-5.52,0-10,4.48-10,10V90Z"
        className="fill-gray-400 dark:fill-gray-600"
      />
      {/* Window */}
      <path
        d="M260,55h-25c-2.76,0-5,2.24-5,5v20h30V55Z"
        className="fill-blue-300 dark:fill-blue-800 opacity-70"
      />

      {/* Cargo Area (Segments) */}
      <g transform="translate(15, 73)">
        {segments.map((segment) => {
          const isFilled = segment * 10 <= occupancy;
          
          return (
            <rect
              key={segment}
              x={(10 - segment) * 20}
              y="0"
              width="18"
              height="15"
              className={cn(
                'transition-colors duration-200',
                isFilled
                  ? 'fill-primary'
                  : 'fill-gray-200 dark:fill-gray-800',
                !disabled &&
                  'cursor-pointer hover:fill-primary/80 dark:hover:fill-primary/50'
              )}
              onClick={() => !disabled && onSegmentClick(segment)}
            />
          );
        })}
      </g>
    </svg>
  );
};


export const OccupancySelector = ({
  initialValue = 0,
  onValueChange,
  disabled = false,
}: OccupancySelectorProps) => {
  const [occupancy, setOccupancy] = useState(initialValue);

  useEffect(() => {
    setOccupancy(initialValue);
  }, [initialValue]);

  const handleSegmentClick = (segmentNumber: number) => {
    const newOccupancy = segmentNumber * 10;
    setOccupancy(newOccupancy);
    onValueChange(newOccupancy);
  };

  const handleClear = () => {
    setOccupancy(0);
    onValueChange(0);
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center px-1">
        <span className="text-sm text-muted-foreground">Ocupação do Caminhão</span>
        <div className="flex items-center gap-2">
          {!disabled && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleClear} disabled={occupancy === 0}>
                <X className="h-4 w-4" />
                <span className="sr-only">Zerar ocupação</span>
            </Button>
          )}
          <span className="text-lg font-bold text-primary">{occupancy}%</span>
        </div>
      </div>
      <div
        className={cn(
          'rounded-lg border bg-card p-2',
          disabled && 'opacity-50'
        )}
      >
        <TruckSVG
          occupancy={occupancy}
          onSegmentClick={handleSegmentClick}
          disabled={disabled}
        />
      </div>
    </div>
  );
};
