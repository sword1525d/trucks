'use client';
import { useState, useEffect, useRef } from 'react';
import Map, { Marker, Source, Layer, MapRef, LngLatBounds } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { type LocationPoint } from './page';
import { Truck } from 'lucide-react';
import type { LineLayer } from 'react-map-gl';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// Estilo da linha do trajeto
const routeLayerStyle: LineLayer = {
  id: 'route',
  type: 'line',
  source: 'route',
  layout: {
    'line-join': 'round',
    'line-cap': 'round',
  },
  paint: {
    'line-color': '#2563eb', // Um azul forte
    'line-width': 5,
  },
};

interface RealTimeMapProps {
  locationHistory: LocationPoint[];
}

const RealTimeMap = ({ locationHistory }: RealTimeMapProps) => {
  const mapRef = useRef<MapRef>(null);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex items-center justify-center h-full bg-destructive/10 rounded-lg p-4">
        <p className="text-destructive text-center font-medium">
          A chave de acesso do Mapbox não foi configurada. Por favor, adicione seu token ao arquivo .env.local.
        </p>
      </div>
    );
  }

  if (!locationHistory || locationHistory.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-muted rounded-lg">
        <p className="text-muted-foreground">Sem dados de localização para exibir.</p>
      </div>
    );
  }

  // Transforma o histórico de localização em um formato GeoJSON para a linha
  const routeGeoJSON = {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'LineString' as const,
      coordinates: locationHistory.map(p => [p.longitude, p.latitude]),
    },
  };

  const lastPosition = locationHistory[locationHistory.length - 1];

  // Efeito para ajustar a visualização do mapa quando o histórico de localização muda
  useEffect(() => {
    if (mapRef.current && locationHistory.length > 1) {
      const coordinates = routeGeoJSON.geometry.coordinates;
      const bounds = new LngLatBounds(
        coordinates[0],
        coordinates[0]
      );
      for (const coord of coordinates) {
        bounds.extend(coord);
      }
      mapRef.current.fitBounds(bounds, {
        padding: 60, // Aumenta o padding para melhor visualização
        duration: 1000,
      });
    }
  }, [locationHistory, routeGeoJSON.geometry.coordinates]);


  return (
    <Map
      ref={mapRef}
      initialViewState={{
        longitude: lastPosition.longitude,
        latitude: lastPosition.latitude,
        zoom: 15,
      }}
      style={{ width: '100%', height: '100%', borderRadius: '0.5rem' }}
      mapStyle="mapbox://styles/mapbox/streets-v12"
      mapboxAccessToken={MAPBOX_TOKEN}
    >
      {/* Fonte de dados para a rota */}
      <Source id="route" type="geojson" data={routeGeoJSON}>
        <Layer {...routeLayerStyle} />
      </Source>
      
      {/* Marcador para a posição atual */}
      <Marker
        longitude={lastPosition.longitude}
        latitude={lastPosition.latitude}
        anchor="bottom"
      >
        <div className="bg-primary rounded-full p-2 shadow-lg">
            <Truck className="h-5 w-5 text-primary-foreground" />
        </div>
      </Marker>
    </Map>
  );
};

export default RealTimeMap;
