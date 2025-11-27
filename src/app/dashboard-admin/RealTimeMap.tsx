
'use client';
import { useState, useEffect, useRef } from 'react';
import Map, { Marker, Source, Layer, MapRef, Popup } from 'react-map-gl';
import { LngLatBounds } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { type Segment } from './tracking/page';
import { Truck, Timer, Route, Milestone } from 'lucide-react';
import type { LineLayer } from 'react-map-gl';
import { useFirebase } from '@/firebase';
import { doc, getDoc } from 'firebase/firestore';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const DEFAULT_ZOOM = 12;

interface RealTimeMapProps {
  segments?: (Segment & { opacity?: number })[];
  fullLocationHistory: { latitude: number; longitude: number }[];
  vehicleId: string;
}

const RealTimeMap = ({ segments, fullLocationHistory, vehicleId }: RealTimeMapProps) => {
  const mapRef = useRef<MapRef>(null);
  const [showPopup, setShowPopup] = useState<Segment | null>(null);
  const { firestore } = useFirebase();
  const [initialZoom, setInitialZoom] = useState<number>(DEFAULT_ZOOM);

  useEffect(() => {
    const fetchSettings = async () => {
      if (!firestore) return;
      const companyId = localStorage.getItem('companyId');
      const sectorId = localStorage.getItem('sectorId');
      if (companyId && sectorId) {
        const settingsRef = doc(firestore, `companies/${companyId}/sectors/${sectorId}/settings`, 'app');
        const settingsSnap = await getDoc(settingsRef);
        if (settingsSnap.exists()) {
          const data = settingsSnap.data();
          setInitialZoom(data.map?.defaultZoom ?? DEFAULT_ZOOM);
        }
      }
    };
    fetchSettings();
  }, [firestore]);


  useEffect(() => {
    if (mapRef.current && fullLocationHistory.length > 0) {
      // If segments are provided, fit the map to the bounds of the entire route.
      if (segments && segments.length > 0) {
        const coordinates = fullLocationHistory.map(p => [p.longitude, p.latitude]) as [number, number][];
        if (coordinates.length === 0) return;

        const bounds = new LngLatBounds(coordinates[0], coordinates[0]);
        for (const coord of coordinates) {
          bounds.extend(coord);
        }
        mapRef.current.fitBounds(bounds, {
          padding: 80,
          duration: 1000,
        });
      } 
      // If no segments, it's real-time tracking. Fly to the latest position.
      else {
        const lastPosition = fullLocationHistory[fullLocationHistory.length - 1];
        if (lastPosition) {
           mapRef.current.flyTo({
            center: [lastPosition.longitude, lastPosition.latitude],
            zoom: initialZoom,
            duration: 1000,
          });
        }
      }
    }
  // The dependency array ensures this effect runs when the view type (segments vs. no segments) changes.
  }, [segments, fullLocationHistory, initialZoom]);


  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex items-center justify-center h-full bg-destructive/10 rounded-lg p-4">
        <p className="text-destructive text-center font-medium">
          A chave de acesso do Mapbox não foi configurada. Por favor, adicione seu token ao arquivo .env.local.
        </p>
      </div>
    );
  }

  if (fullLocationHistory.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-muted rounded-lg">
        <p className="text-muted-foreground">Sem dados de localização para exibir.</p>
      </div>
    );
  }

  const lastPosition = fullLocationHistory[fullLocationHistory.length - 1];

  return (
    <Map
      ref={mapRef}
      initialViewState={{
        longitude: lastPosition?.longitude || -46.6333,
        latitude: lastPosition?.latitude || -23.5505,
        zoom: initialZoom,
      }}
      style={{ width: '100%', height: '100%', borderRadius: '0.5rem' }}
      mapStyle="mapbox://styles/mapbox/streets-v12"
      mapboxAccessToken={MAPBOX_TOKEN}
    >
      {segments && segments.map((segment, index) => {
         const geojson = {
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'LineString' as const,
            coordinates: segment.path,
          },
        };

        const layerStyle: LineLayer = {
            id: `route-${segment.id}`,
            type: 'line',
            source: `route-${segment.id}`,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': segment.color, 'line-width': 5, 'line-opacity': segment.opacity ?? 0.9 },
        };
        
        return (
            <Source key={segment.id} id={`route-${segment.id}`} type="geojson" data={geojson}>
                <Layer {...layerStyle} />
            </Source>
        );
      })}

       {segments && segments.map((segment, index) => segment.path.length > 0 && (
         <Marker
           key={`marker-${segment.id}`}
           longitude={segment.path[0][0]}
           latitude={segment.path[0][1]}
           anchor="center"
           onClick={() => setShowPopup(segment)}
         >
           <div className="flex items-center justify-center w-6 h-6 rounded-full text-white font-bold text-xs shadow-lg" style={{ backgroundColor: segment.color, opacity: segment.opacity ?? 0.9 }}>
             {index + 1}
           </div>
         </Marker>
       ))}
       
      {showPopup && showPopup.path.length > 0 && (
        <Popup
            longitude={showPopup.path[0][0]}
            latitude={showPopup.path[0][1]}
            onClose={() => setShowPopup(null)}
            closeOnClick={false}
            anchor="bottom"
            offset={25}
        >
            <div className="text-xs space-y-1">
                <p className="font-bold">{showPopup.label}</p>
                <p className="flex items-center gap-1"><Route className="h-3 w-3" />Viagem: {showPopup.travelTime}</p>
                <p className="flex items-center gap-1"><Timer className="h-3 w-3" />Parada: {showPopup.stopTime}</p>
                 {showPopup.distance && <p className="flex items-center gap-1"><Milestone className="h-3 w-3" />Distância: {showPopup.distance}</p>}
            </div>
        </Popup>
      )}


      {lastPosition && (
        <Marker
          longitude={lastPosition.longitude}
          latitude={lastPosition.latitude}
          anchor="bottom"
        >
          <div className="relative flex flex-col items-center">
            <div className="bg-primary text-primary-foreground text-xs font-bold px-2 py-0.5 rounded-md -mt-8 shadow-lg whitespace-nowrap">
              {vehicleId}
            </div>
            <div className="bg-primary rounded-full p-2 shadow-lg mt-1">
              <Truck className="h-5 w-5 text-primary-foreground" />
            </div>
          </div>
        </Marker>
      )}
    </Map>
  );
};

export default RealTimeMap;
