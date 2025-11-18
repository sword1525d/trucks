'use client';

import { useMemo, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, useMap } from 'react-leaflet';
import L, { LatLngExpression, LatLngBoundsExpression } from 'leaflet';
import type { LocationPoint } from './page';

// Ícone customizado para o caminhão
const truckIcon = new L.Icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/128/61/61922.png',
  iconSize: [40, 40],
  iconAnchor: [20, 40],
  popupAnchor: [0, -40],
});

// Componente para ajustar o zoom e a posição do mapa
const FitBounds = ({ bounds }: { bounds: LatLngBoundsExpression }) => {
  const map = useMap();
  useEffect(() => {
    if (bounds) {
      map.fitBounds(bounds, { padding: [30, 30] });
    }
  }, [map, bounds]);
  return null;
};

// Componente para recentralizar o mapa quando a última posição muda
const RecenterAutomatically = ({ center }: { center: LatLngExpression }) => {
    const map = useMap();
    useEffect(() => {
        map.setView(center, map.getZoom());
    }, [map, center]);
    return null;
}


interface RealTimeMapProps {
  locationHistory: LocationPoint[];
}

// Filtra locais para remover duplicatas consecutivas
const filterUniqueLocations = (locations: LocationPoint[]): LocationPoint[] => {
  if (!locations || locations.length === 0) return [];
  const unique: LocationPoint[] = [locations[0]];
  for (let i = 1; i < locations.length; i++) {
    if (locations[i].latitude !== locations[i - 1].latitude || locations[i].longitude !== locations[i - 1].longitude) {
      unique.push(locations[i]);
    }
  }
  return unique;
};


export default function RealTimeMap({ locationHistory }: RealTimeMapProps) {
  const { positions, bounds, lastPosition } = useMemo(() => {
    const uniqueLocations = filterUniqueLocations(locationHistory);
    
    const pos: LatLngExpression[] = uniqueLocations.map(p => [p.latitude, p.longitude]);
    const bds: LatLngBoundsExpression | null = pos.length > 0 ? L.latLngBounds(pos) : null;
    const lastPos: LatLngExpression | null = pos.length > 0 ? pos[pos.length - 1] : null;

    return { positions: pos, bounds: bds, lastPosition: lastPos };
  }, [locationHistory]);
  
  
  if (!lastPosition || !bounds) {
    return <div className="flex items-center justify-center h-full text-muted-foreground">Aguardando dados de localização...</div>;
  }

  return (
    <MapContainer 
      key={`map-${locationHistory.length}`}
      center={lastPosition} 
      zoom={15} 
      style={{ height: '100%', width: '100%' }} 
      className="rounded-md z-0"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Polyline positions={positions} color="blue" />
      <Marker position={lastPosition} icon={truckIcon} />
      <FitBounds bounds={bounds} />
      <RecenterAutomatically center={lastPosition} />
    </MapContainer>
  );
}
