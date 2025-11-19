'use client';
import { useState, useEffect, useRef } from 'react';
import Map, { Marker, Source, Layer, MapRef, Popup } from 'react-map-gl';
import { LngLatBounds } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { type Segment } from './page';
import { Truck, Timer, Route } from 'lucide-react';
import type { LineLayer } from 'react-map-gl';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

interface RealTimeMapProps {
  segments: Segment[];
  fullLocationHistory: { latitude: number; longitude: number }[];
}

const RealTimeMap = ({ segments, fullLocationHistory }: RealTimeMapProps) => {
  const mapRef = useRef<MapRef>(null);
  const [showPopup, setShowPopup] = useState<Segment | null>(null);

  useEffect(() => {
    if (mapRef.current && fullLocationHistory.length > 0) {
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
  }, [segments, fullLocationHistory]);


  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex items-center justify-center h-full bg-destructive/10 rounded-lg p-4">
        <p className="text-destructive text-center font-medium">
          A chave de acesso do Mapbox não foi configurada. Por favor, adicione seu token ao arquivo .env.local.
        </p>
      </div>
    );
  }

  if (segments.length === 0 && fullLocationHistory.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-muted rounded-lg">
        <p className="text-muted-foreground">Sem dados de localização para exibir.</p>
      </div>
    );
  }

  const lastPosition = fullLocationHistory.length > 0 ? fullLocationHistory[fullLocationHistory.length - 1] : null;

  return (
    <Map
      ref={mapRef}
      initialViewState={{
        longitude: lastPosition?.longitude || -46.6333,
        latitude: lastPosition?.latitude || -23.5505,
        zoom: 12,
      }}
      style={{ width: '100%', height: '100%', borderRadius: '0.5rem' }}
      mapStyle="mapbox://styles/mapbox/streets-v12"
      mapboxAccessToken={MAPBOX_TOKEN}
    >
      {segments.map((segment, index) => {
         const geojson = {
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'LineString' as const,
            coordinates: segment.path,
          },
        };

        const layerStyle: LineLayer = {
            id: `route-${index}`,
            type: 'line',
            source: `route-${index}`,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': segment.color, 'line-width': 5, 'line-opacity': 0.9 },
        };
        
        return (
            <Source key={index} id={`route-${index}`} type="geojson" data={geojson}>
                <Layer {...layerStyle} />
            </Source>
        );
      })}

       {segments.map((segment, index) => segment.path.length > 0 && (
         <Marker
           key={`marker-${index}`}
           longitude={segment.path[0][0]}
           latitude={segment.path[0][1]}
           anchor="center"
           onClick={() => setShowPopup(segment)}
         >
           <div className="flex items-center justify-center w-6 h-6 rounded-full text-white font-bold text-xs shadow-lg" style={{ backgroundColor: segment.color }}>
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
            </div>
        </Popup>
      )}


      {lastPosition && (
        <Marker
          longitude={lastPosition.longitude}
          latitude={lastPosition.latitude}
          anchor="bottom"
        >
          <div className="bg-primary rounded-full p-2 shadow-lg">
              <Truck className="h-5 w-5 text-primary-foreground" />
          </div>
        </Marker>
      )}
    </Map>
  );
};

export default RealTimeMap;
