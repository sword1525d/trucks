'use client';

import { Car, Truck } from 'lucide-react';
import { useState, useEffect } from 'react';

export default function Splash() {
  const [showTruck, setShowTruck] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowTruck(true);
    }, 500); // Meio segundo para a troca de ícone

    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background splash-container">
      <div className="flex flex-col items-center justify-center">
        <div className="splash-animation">
            <Car className="h-24 w-24 text-primary icon-car" />
            <Truck className="h-24 w-24 text-primary icon-truck" />
        </div>
        <h1 className="text-4xl font-bold font-headline text-primary mt-4 app-name">
          Frotacontrol
        </h1>
      </div>
    </div>
  );
}
