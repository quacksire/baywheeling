'use client'
import { useEffect, useRef } from 'react';
import { Deck } from '@deck.gl/core';
import { PathLayer } from '@deck.gl/layers';
import { useMap } from '@/components/ui/map';

interface RouteData {
  routeKey: string;
  coordinates: [number, number][];
  duration: number;
  distance: number;
  endStationName: string;
  rideCount: number;
}

interface DeckGLRoutesProps {
  routes: Map<string, RouteData>;
  color?: [number, number, number, number];
  width?: number;
  opacity?: number;
}

export function DeckGLRoutes({
  routes,
  color = [255, 255, 255, 255], // white as RGBA
  width = 3,
  opacity = 153, // 0.6 * 255
}: DeckGLRoutesProps) {
  const { map } = useMap();
  const deckRef = useRef<Deck | null>(null);

  useEffect(() => {
    if (!map) return;

    // Get canvas element
    const canvas = document.getElementById('deck-canvas') as HTMLCanvasElement;
    if (!canvas) return;

    // Convert routes Map to array format for deck.gl
    const routesArray = Array.from(routes.values()).map((route) => ({
      path: route.coordinates,
      id: route.routeKey,
      rideCount: route.rideCount,
    }));

    // Calculate width based on number of rides using the route
    const getRouteWidth = (d: any) => {
      // Base width of 1, increases slightly with rideCount
      // Logarithmic scaling with small multiplier for monthly data
      // 2 rides = 1.07x, 5 rides = 1.16x, 10 rides = 1.23x
      return 1 + Math.log(d.rideCount) * 0.1;
    };

    // Create or update deck.gl instance
    if (!deckRef.current) {
      deckRef.current = new Deck({
        canvas: canvas,
        width: '100%',
        height: '100%',
        initialViewState: {
          longitude: map.getCenter().lng,
          latitude: map.getCenter().lat,
          zoom: map.getZoom(),
          pitch: 0,
          bearing: 0,
        },
        controller: false, // Let maplibre handle controls
        layers: [
          new PathLayer({
            id: 'route-paths',
            data: routesArray,
            pickable: true,
            widthScale: width,
            widthMinPixels: 2,
            getPath: (d: any) => d.path,
            getColor: () => [color[0], color[1], color[2], opacity],
            getWidth: getRouteWidth,
          }),
        ],
      });
    } else {
      // Update layers with new routes
      deckRef.current.setProps({
        layers: [
          new PathLayer({
            id: 'route-paths',
            data: routesArray,
            pickable: true,
            widthScale: width,
            widthMinPixels: 2,
            getPath: (d: any) => d.path,
            getColor: () => [color[0], color[1], color[2], opacity],
            getWidth: getRouteWidth,
          }),
        ],
      });
    }

    // Sync deck.gl camera with maplibre
    const handleMapMove = () => {
      if (deckRef.current) {
        const center = map.getCenter();
        deckRef.current.setProps({
          initialViewState: {
            longitude: center.lng,
            latitude: center.lat,
            zoom: map.getZoom(),
            pitch: map.getPitch(),
            bearing: map.getBearing(),
          },
        });
      }
    };

    map.on('move', handleMapMove);

    return () => {
      map.off('move', handleMapMove);
    };
  }, [map, routes, color, width, opacity]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (deckRef.current) {
        deckRef.current.finalize();
        deckRef.current = null;
      }
    };
  }, []);

  return (
    <canvas
      id="deck-canvas"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    />
  );
}
