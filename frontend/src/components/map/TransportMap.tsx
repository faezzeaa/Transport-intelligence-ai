import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import * as maplibregl from 'maplibre-gl';
import {
  RotateCcw,
  RotateCw,
  Layers,
  Flame,
  AlertTriangle,
  Info,
  Compass,
  Map as MapIcon,
  Check,
  ChevronDown,
  Search,
  Navigation,
  X,
  MapPin,
  Zap,
} from 'lucide-react';
import { Incident, IncidentSeverity, MapplsStatus, TomTomStatus, TomTomIncidentItem, LocationPreset } from '../../types';
import { MapLegend } from './MapLegend';
import { IncidentDetailPanel } from './IncidentDetailPanel';
import { api } from '../../services/api';
import { loadMapplsSdk } from '../../services/mapplsLoader';
import { LOCATION_PRESETS } from '../traffic/LiveTrafficAnalyticsPanel';

interface TransportMapProps {
  incidents: Incident[];
  selectedIncident: Incident | null;
  onSelectIncident: (incident: Incident | null) => void;
  onUpdateStatus: (id: string, newStatus: any) => Promise<void>;
  isLoading?: boolean;
  initialCenter?: [number, number];
  initialZoom?: number;
  activeLocation?: LocationPreset;
  onLocationChange?: (location: LocationPreset) => void;
  onViewportChange?: (viewport: { center: [number, number]; bbox: [number, number, number, number]; zoom: number }) => void;
  targetFlyTo?: { lat: number; lng: number; zoom?: number } | null;
}

export type BasemapProvider = 'mappls' | 'light-canvas' | 'dark-canvas' | 'openfreemap' | 'osm' | 'carto';

// Default to Chennai (Tamil Nadu Capital) or configured coordinates
const DEFAULT_LAT = parseFloat(import.meta.env.VITE_MAP_DEFAULT_LAT || '13.0827');
const DEFAULT_LNG = parseFloat(import.meta.env.VITE_MAP_DEFAULT_LNG || '80.2707');
const DEFAULT_ZOOM = parseFloat(import.meta.env.VITE_MAP_DEFAULT_ZOOM || '12.0');
const DEFAULT_CENTER: [number, number] = [DEFAULT_LNG, DEFAULT_LAT];

// 1. Esri World Light Gray Canvas (100% Keyless, clean light theme)
const ESRI_LIGHT_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  name: 'Esri World Light Gray Canvas',
  sources: {
    'esri-light-base': {
      type: 'raster',
      tiles: [
        'https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: '© Esri, HERE, Garmin, OpenStreetMap contributors',
      maxzoom: 16,
    },
    'esri-light-reference': {
      type: 'raster',
      tiles: [
        'https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: '',
      maxzoom: 16,
    },
  },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#f8fafc' },
    },
    {
      id: 'esri-light-base-layer',
      type: 'raster',
      source: 'esri-light-base',
      minzoom: 0,
      maxzoom: 20,
    },
    {
      id: 'esri-light-reference-layer',
      type: 'raster',
      source: 'esri-light-reference',
      minzoom: 0,
      maxzoom: 20,
      paint: {
        'raster-opacity': 0.85,
      },
    },
  ],
};

// 1. Esri World Dark Gray Canvas (100% Keyless, clean dark theme)
const ESRI_DARK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  name: 'Esri World Dark Gray Canvas',
  sources: {
    'esri-dark-base': {
      type: 'raster',
      tiles: [
        'https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: '© Esri, HERE, Garmin, OpenStreetMap contributors',
      maxzoom: 16,
    },
    'esri-dark-reference': {
      type: 'raster',
      tiles: [
        'https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: '',
      maxzoom: 16,
    },
  },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#060a12' },
    },
    {
      id: 'esri-dark-base-layer',
      type: 'raster',
      source: 'esri-dark-base',
      minzoom: 0,
      maxzoom: 20,
    },
    {
      id: 'esri-dark-reference-layer',
      type: 'raster',
      source: 'esri-dark-reference',
      minzoom: 0,
      maxzoom: 20,
      paint: {
        'raster-opacity': 0.85,
      },
    },
  ],
};

// 2. OpenStreetMap Standard (100% Keyless public raster)
const OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  name: 'OpenStreetMap Standard',
  sources: {
    'osm-tiles': {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#060a12' },
    },
    {
      id: 'osm-tiles-layer',
      type: 'raster',
      source: 'osm-tiles',
      minzoom: 0,
      maxzoom: 19,
    },
  ],
};

// 3. CARTO Dark Matter (Raster, supports optional VITE_CARTO_API_KEY)
const getCartoDarkStyle = (apiKey?: string): maplibregl.StyleSpecification => {
  const query = apiKey ? `?key=${encodeURIComponent(apiKey)}` : '';
  return {
    version: 8,
    name: 'CARTO Dark Matter',
    sources: {
      'carto-dark': {
        type: 'raster',
        tiles: [
          `https://a.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png${query}`,
          `https://b.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png${query}`,
          `https://c.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png${query}`,
        ],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors, © CARTO',
        maxzoom: 19,
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#060a12' },
      },
      {
        id: 'carto-dark-layer',
        type: 'raster',
        source: 'carto-dark',
        minzoom: 0,
        maxzoom: 19,
      },
    ],
  };
};

// 4. OpenFreeMap Dark (Keyless Vector Style)
const OPENFREEMAP_DARK_URL = 'https://tiles.openfreemap.org/styles/dark';

export const TransportMap: React.FC<TransportMapProps> = ({
  incidents,
  selectedIncident,
  onSelectIncident,
  onUpdateStatus,
  initialCenter,
  initialZoom,
  activeLocation,
  onLocationChange,
  onViewportChange,
  targetFlyTo,
}) => {
  // Map container refs
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapplsContainerRef = useRef<HTMLDivElement>(null);

  // Map instance refs
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapplsMapRef = useRef<any>(null);

  // Marker refs
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const mapplsMarkersRef = useRef<any[]>([]);
  const searchMarkerRef = useRef<maplibregl.Marker | null>(null);
  const tomtomMarkersRef = useRef<maplibregl.Marker[]>([]);
  const mapplsTomTomMarkersRef = useRef<any[]>([]);
  const debounceTimerRef = useRef<any>(null);

  // Map state
  const [activeSeverityFilter, setActiveSeverityFilter] = useState<string>('ALL');
  const [showCongestionLayer, setShowCongestionLayer] = useState(true);
  const [showCorridorLayer, setShowCorridorLayer] = useState(true);
  const isDarkInitial = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

  // Active geographic location state
  const [currentLocation, setCurrentLocation] = useState<LocationPreset>(() => {
    if (activeLocation) return activeLocation;
    if (typeof window !== 'undefined') {
      const param = new URLSearchParams(window.location.search).get('location')?.toLowerCase();
      if (param) {
        const found = LOCATION_PRESETS.find((p) => p.id === param || p.name.toLowerCase() === param);
        if (found) return found;
      }
    }
    return LOCATION_PRESETS[0]; // Default: Chennai
  });
  const [isLocationMenuOpen, setIsLocationMenuOpen] = useState(false);

  // Basemap state
  const [basemap, setBasemapState] = useState<BasemapProvider>(() => {
    if (typeof window !== 'undefined') {
      const urlParam = new URLSearchParams(window.location.search).get('basemap');
      if (urlParam && ['mappls', 'light-canvas', 'dark-canvas', 'openfreemap', 'osm', 'carto'].includes(urlParam)) {
        return urlParam as BasemapProvider;
      }
      const saved = localStorage.getItem('transport_ai_basemap');
      if (saved && ['mappls', 'light-canvas', 'dark-canvas', 'openfreemap', 'osm', 'carto'].includes(saved)) {
        return saved as BasemapProvider;
      }
    }
    return isDarkInitial ? 'dark-canvas' : 'light-canvas';
  });

  const setBasemap = useCallback((provider: BasemapProvider) => {
    setBasemapState(provider);
    if (typeof window !== 'undefined') {
      localStorage.setItem('transport_ai_basemap', provider);
    }
  }, []);

  const [isBasemapMenuOpen, setIsBasemapMenuOpen] = useState(false);
  const [isStyleLoaded, setIsStyleLoaded] = useState(false);
  const [tileError, setTileError] = useState<string | null>(null);
  const [cursorCoords, setCursorCoords] = useState<{ lat: number; lng: number } | null>(null);

  // Mappls integration state
  const [isMapplsLoading, setIsMapplsLoading] = useState(false);
  const [mapplsError, setMapplsError] = useState<string | null>(null);
  const [mapplsStatus, setMapplsStatus] = useState<MapplsStatus | null>(null);
  const [mapplsBannerNotice, setMapplsBannerNotice] = useState<string | null>(null);

  // Mappls Place Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showSearchResults, setShowSearchResults] = useState(false);

  // TomTom Live Traffic integration state
  const [tomtomStatus, setTomtomStatus] = useState<TomTomStatus | null>(null);
  const [showTomTomTraffic, setShowTomTomTraffic] = useState(true);
  const [tomtomIncidents, setTomtomIncidents] = useState<TomTomIncidentItem[]>([]);
  const [isRefreshingTraffic, setIsRefreshingTraffic] = useState(false);
  const [lastTrafficSyncTime, setLastTrafficSyncTime] = useState<string | null>(null);
  const [trafficError, setTrafficError] = useState<string | null>(null);

  const cartoApiKey = import.meta.env.VITE_CARTO_API_KEY as string | undefined;
  const mapplsStaticKey = import.meta.env.VITE_MAPPLS_STATIC_KEY as string | undefined;

  // Sync external activeLocation changes
  useEffect(() => {
    if (activeLocation && activeLocation.id !== currentLocation.id) {
      setCurrentLocation(activeLocation);
      flyToCoordinates(activeLocation.lat, activeLocation.lng, activeLocation.zoom);
    }
  }, [activeLocation]);

  // Handle programmatic targetFlyTo
  useEffect(() => {
    if (targetFlyTo) {
      flyToCoordinates(targetFlyTo.lat, targetFlyTo.lng, targetFlyTo.zoom || 14.5);
    }
  }, [targetFlyTo]);

  // Fetch live TomTom incidents for a specific bounding box
  const fetchTrafficForBbox = useCallback(
    (bbox: [number, number, number, number], center?: { lat: number; lng: number }) => {
      if (!tomtomStatus?.is_configured) return;
      setIsRefreshingTraffic(true);
      setTrafficError(null);

      api.getTomTomIncidents(bbox)
        .then((res) => {
          if (res.success && res.incidents) {
            setTomtomIncidents(res.incidents);
            setLastTrafficSyncTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
          }
        })
        .catch((err) => {
          console.warn('[TransportMap] TomTom incidents query failed:', err);
          setTrafficError('Unable to update live traffic incidents for current view.');
        })
        .finally(() => {
          setIsRefreshingTraffic(false);
        });

      if (onViewportChange && center) {
        onViewportChange({
          center: [center.lng, center.lat],
          bbox,
          zoom: mapRef.current?.getZoom() || mapplsMapRef.current?.getZoom() || DEFAULT_ZOOM,
        });
      }
    },
    [tomtomStatus, onViewportChange]
  );

  // Audit TomTom and Mappls services on mount
  useEffect(() => {
    api.getTomTomStatus()
      .then((status) => {
        setTomtomStatus(status);
        if (status.is_configured) {
          const cLat = initialCenter ? initialCenter[1] : currentLocation.lat;
          const cLng = initialCenter ? initialCenter[0] : currentLocation.lng;
          const initBbox: [number, number, number, number] = [
            roundCoord(cLng - 0.25),
            roundCoord(cLat - 0.25),
            roundCoord(cLng + 0.25),
            roundCoord(cLat + 0.25),
          ];
          fetchTrafficForBbox(initBbox, { lat: cLat, lng: cLng });
        }
      })
      .catch((err) => console.warn('[TransportMap] TomTom status failed:', err));

    api.getMapplsStatus()
      .then((status) => {
        setMapplsStatus(status);
      })
      .catch((err) => console.warn('[TransportMap] Mappls status failed:', err));
  }, []);

  // Filter incidents according to active severity filter
  const filteredIncidents = useMemo(() => {
    if (activeSeverityFilter === 'ALL') return incidents;
    return incidents.filter((inc) => inc.severity === activeSeverityFilter);
  }, [incidents, activeSeverityFilter]);

  // Resolve style based on selected basemap provider (for MapLibre)
  const getStyleForProvider = useCallback(
    (provider: BasemapProvider): maplibregl.StyleSpecification | string => {
      const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
      switch (provider) {
        case 'light-canvas':
          return ESRI_LIGHT_STYLE;
        case 'dark-canvas':
          return ESRI_DARK_STYLE;
        case 'openfreemap':
          return OPENFREEMAP_DARK_URL;
        case 'osm':
          return OSM_STYLE;
        case 'carto':
          return getCartoDarkStyle(cartoApiKey);
        case 'mappls':
        default:
          return isDark ? ESRI_DARK_STYLE : ESRI_LIGHT_STYLE;
      }
    },
    [cartoApiKey]
  );

  // Helper to fly to coordinates across both MapLibre and Mappls engines
  const flyToCoordinates = (lat: number, lng: number, zoomLevel: number = 13.0) => {
    if (basemap === 'mappls' && mapplsMapRef.current) {
      try {
        if (typeof mapplsMapRef.current.flyTo === 'function') {
          mapplsMapRef.current.flyTo({ center: [lng, lat], zoom: zoomLevel, speed: 1.2 });
        } else if (typeof mapplsMapRef.current.setCenter === 'function') {
          mapplsMapRef.current.setCenter({ lat, lng });
          mapplsMapRef.current.setZoom(zoomLevel);
        }
      } catch (e) {
        console.warn('[TransportMap] Mappls flyTo error:', e);
      }
    } else if (mapRef.current) {
      try {
        mapRef.current.flyTo({ center: [lng, lat], zoom: zoomLevel, pitch: 25, speed: 1.2 });
      } catch (e) {
        console.warn('[TransportMap] MapLibre flyTo error:', e);
      }
    }
  };

  // Switch active geographic location preset
  const handleSelectLocationPreset = (preset: LocationPreset) => {
    setCurrentLocation(preset);
    setIsLocationMenuOpen(false);
    flyToCoordinates(preset.lat, preset.lng, preset.zoom);

    if (onLocationChange) {
      onLocationChange(preset);
    }

    const bbox: [number, number, number, number] = [
      roundCoord(preset.lng - 0.25),
      roundCoord(preset.lat - 0.25),
      roundCoord(preset.lng + 0.25),
      roundCoord(preset.lat + 0.25),
    ];
    fetchTrafficForBbox(bbox, { lat: preset.lat, lng: preset.lng });
  };

  // Trigger manual refresh for current viewport
  const handleManualRefresh = () => {
    let bbox: [number, number, number, number] | null = null;
    let center = { lat: currentLocation.lat, lng: currentLocation.lng };

    if (basemap === 'mappls' && mapplsMapRef.current) {
      try {
        const b = mapplsMapRef.current.getBounds();
        const c = mapplsMapRef.current.getCenter();
        if (c) center = { lat: c.lat || c[1], lng: c.lng || c[0] };
        if (b) {
          bbox = [
            roundCoord(b.getWest ? b.getWest() : b[0][0]),
            roundCoord(b.getSouth ? b.getSouth() : b[0][1]),
            roundCoord(b.getEast ? b.getEast() : b[1][0]),
            roundCoord(b.getNorth ? b.getNorth() : b[1][1]),
          ];
        }
      } catch (e) {}
    } else if (mapRef.current) {
      try {
        const b = mapRef.current.getBounds();
        const c = mapRef.current.getCenter();
        center = { lat: c.lat, lng: c.lng };
        bbox = [
          roundCoord(b.getWest()),
          roundCoord(b.getSouth()),
          roundCoord(b.getEast()),
          roundCoord(b.getNorth()),
        ];
      } catch (e) {}
    }

    if (!bbox) {
      bbox = [
        roundCoord(center.lng - 0.25),
        roundCoord(center.lat - 0.25),
        roundCoord(center.lng + 0.25),
        roundCoord(center.lat + 0.25),
      ];
    }

    fetchTrafficForBbox(bbox, center);
  };

  // Initialize MapLibre GL map (for non-Mappls basemaps)
  useEffect(() => {
    if (basemap === 'mappls') {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      return;
    }

    if (!mapContainerRef.current) return;

    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    setIsStyleLoaded(false);
    setTileError(null);

    try {
      const initialStyle = getStyleForProvider(basemap);
      const startCenter: [number, number] = initialCenter || [currentLocation.lng, currentLocation.lat];
      const startZoom = initialZoom || currentLocation.zoom || DEFAULT_ZOOM;

      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: initialStyle,
        center: startCenter,
        zoom: startZoom,
        pitch: 25,
        attributionControl: false,
      });

      map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right');

      map.on('load', () => {
        setIsStyleLoaded(true);
        setTileError(null);
        map.resize();
      });

      map.on('styledata', () => {
        if (map.isStyleLoaded()) {
          setIsStyleLoaded(true);
        }
      });

      // Track cursor coordinates
      map.on('mousemove', (e: any) => {
        setCursorCoords({
          lat: parseFloat(e.lngLat.lat.toFixed(4)),
          lng: parseFloat(e.lngLat.lng.toFixed(4)),
        });
      });

      // Viewport movement handler for live traffic updates
      map.on('moveend', () => {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
          try {
            const b = map.getBounds();
            const c = map.getCenter();
            const bbox: [number, number, number, number] = [
              roundCoord(b.getWest()),
              roundCoord(b.getSouth()),
              roundCoord(b.getEast()),
              roundCoord(b.getNorth()),
            ];
            fetchTrafficForBbox(bbox, { lat: c.lat, lng: c.lng });
            if (onViewportChange) {
              onViewportChange({ center: [c.lng, c.lat], bbox, zoom: map.getZoom() });
            }
          } catch (err) {
            console.warn('[TransportMap] Error on moveend viewport update:', err);
          }
        }, 600);
      });

      map.on('error', (e: any) => {
        console.warn('[TransportMap] Tile or resource warning:', e);
        const msg = e.error?.message || e.message || '';
        if (msg.includes('401') || msg.includes('403') || msg.includes('fetch') || msg.includes('network')) {
          setTileError(
            'Basemap tile connection issue. Incident markers and spatial telemetry remain 100% operational.'
          );
        }
      });

      const handleWindowResize = () => map.resize();
      window.addEventListener('resize', handleWindowResize);

      const resizeObserver = new ResizeObserver(() => {
        if (mapRef.current) {
          mapRef.current.resize();
        }
      });
      if (mapContainerRef.current) {
        resizeObserver.observe(mapContainerRef.current);
      }

      mapRef.current = map;

      return () => {
        window.removeEventListener('resize', handleWindowResize);
        resizeObserver.disconnect();
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        markersRef.current.forEach((m) => m.remove());
        markersRef.current = [];
        tomtomMarkersRef.current.forEach((m) => m.remove());
        tomtomMarkersRef.current = [];
        if (searchMarkerRef.current) {
          searchMarkerRef.current.remove();
          searchMarkerRef.current = null;
        }
        map.remove();
        mapRef.current = null;
      };
    } catch (err: any) {
      console.error('[TransportMap] Map initialization error:', err);
      setTileError('WebGL map canvas unavailable. Coordinate telemetry and incident records active.');
    }
  }, [basemap, getStyleForProvider]);

  // Initialize official Mappls Web Maps SDK v3.0 (when basemap === 'mappls')
  useEffect(() => {
    if (basemap !== 'mappls') {
      if (mapplsMapRef.current) {
        try {
          if (typeof mapplsMapRef.current.remove === 'function') {
            mapplsMapRef.current.remove();
          }
        } catch (e) {
          console.warn('[TransportMap] Error removing Mappls map instance:', e);
        }
        mapplsMapRef.current = null;
      }
      return;
    }

    if (!mapplsContainerRef.current) return;

    if (!mapplsStaticKey) {
      setMapplsError(
        'VITE_MAPPLS_STATIC_KEY is not configured in frontend/.env. Fallback to Esri Canvas is recommended.'
      );
      return;
    }

    let isMounted = true;
    setIsMapplsLoading(true);
    setMapplsError(null);

    const targetCenterLat = initialCenter ? initialCenter[1] : currentLocation.lat;
    const targetCenterLng = initialCenter ? initialCenter[0] : currentLocation.lng;
    const targetZoom = initialZoom || currentLocation.zoom || DEFAULT_ZOOM;

    loadMapplsSdk(mapplsStaticKey)
      .then((mapplsSdk) => {
        if (!isMounted) return;

        if (mapplsContainerRef.current) {
          mapplsContainerRef.current.innerHTML = '';
        }

        try {
          const map = new mapplsSdk.Map(mapplsContainerRef.current, {
            center: [targetCenterLat, targetCenterLng],
            zoom: targetZoom,
            traffic: showTomTomTraffic,
          });

          map.on('load', () => {
            if (!isMounted) return;
            setIsMapplsLoading(false);
            setIsStyleLoaded(true);
            setMapplsError(null);
          });

          map.addListener('mousemove', (e: any) => {
            if (e && e.lngLat) {
              setCursorCoords({
                lat: parseFloat(e.lngLat.lat.toFixed(4)),
                lng: parseFloat(e.lngLat.lng.toFixed(4)),
              });
            }
          });

          // Viewport movement handler for Mappls
          map.addListener('dragend', () => {
            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = setTimeout(() => {
              try {
                const b = map.getBounds();
                const c = map.getCenter();
                if (b && c) {
                  const bbox: [number, number, number, number] = [
                    roundCoord(b.getWest ? b.getWest() : b[0][0]),
                    roundCoord(b.getSouth ? b.getSouth() : b[0][1]),
                    roundCoord(b.getEast ? b.getEast() : b[1][0]),
                    roundCoord(b.getNorth ? b.getNorth() : b[1][1]),
                  ];
                  fetchTrafficForBbox(bbox, { lat: c.lat || c[1], lng: c.lng || c[0] });
                  if (onViewportChange) {
                    onViewportChange({
                      center: [c.lng || c[0], c.lat || c[1]],
                      bbox,
                      zoom: typeof map.getZoom === 'function' ? map.getZoom() : 12,
                    });
                  }
                }
              } catch (e) {}
            }, 600);
          });

          map.on('error', (e: any) => {
            console.warn('[TransportMap] Mappls map error event:', e);
            if (isMounted) {
              setMapplsError(
                'Mappls Map encountered a tile loading or domain restriction. Esri Canvas fallback is ready.'
              );
            }
          });

          mapplsMapRef.current = map;
        } catch (initErr: any) {
          console.error('[TransportMap] Failed to initialize mappls.Map:', initErr);
          if (isMounted) {
            setMapplsError(initErr.message || 'Failed to instantiate Mappls Web Maps SDK map.');
            setIsMapplsLoading(false);
          }
        }
      })
      .catch((sdkErr: any) => {
        console.error('[TransportMap] Failed to load Mappls SDK:', sdkErr);
        if (isMounted) {
          setMapplsError(
            sdkErr.message || 'Failed to load official Mappls Web Maps SDK v3.0 script from sdk.mappls.com.'
          );
          setIsMapplsLoading(false);
        }
      });

    return () => {
      isMounted = false;
      mapplsMarkersRef.current.forEach((m) => {
        try {
          if (typeof m.remove === 'function') m.remove();
        } catch (e) {}
      });
      mapplsMarkersRef.current = [];
      mapplsTomTomMarkersRef.current.forEach((m) => {
        try {
          if (typeof m.remove === 'function') m.remove();
        } catch (e) {}
      });
      mapplsTomTomMarkersRef.current = [];
      if (mapplsMapRef.current) {
        try {
          if (typeof mapplsMapRef.current.remove === 'function') {
            mapplsMapRef.current.remove();
          }
        } catch (e) {}
        mapplsMapRef.current = null;
      }
    };
  }, [basemap, mapplsStaticKey, showTomTomTraffic]);

  // Synchronize MapLibre incident markers (for non-Mappls basemaps)
  useEffect(() => {
    if (basemap === 'mappls') return;
    const map = mapRef.current;
    if (!map) return;

    if (!map.isStyleLoaded() && !isStyleLoaded) {
      return;
    }

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    filteredIncidents.forEach((incident) => {
      const isSelected = selectedIncident?.id === incident.id;
      const el = document.createElement('div');
      el.className = 'group cursor-pointer relative';

      const colorMap: Record<
        IncidentSeverity,
        { bg: string; border: string; glow: string; text: string }
      > = {
        CRITICAL: {
          bg: 'bg-red-600',
          border: 'border-red-300 ring-4 ring-red-600/40',
          glow: 'animate-radar-critical',
          text: 'text-white',
        },
        HIGH: {
          bg: 'bg-orange-500',
          border: 'border-orange-200 ring-2 ring-orange-500/30',
          glow: '',
          text: 'text-white',
        },
        MEDIUM: {
          bg: 'bg-amber-500',
          border: 'border-amber-200 ring-2 ring-amber-500/30',
          glow: '',
          text: 'text-slate-900',
        },
        LOW: {
          bg: 'bg-emerald-500',
          border: 'border-emerald-200',
          glow: '',
          text: 'text-white',
        },
      };

      const cfg = colorMap[incident.severity] || colorMap.MEDIUM;

      el.innerHTML = `
        <div class="relative flex items-center justify-center">
          <div class="w-7 h-7 rounded-full ${cfg.bg} ${cfg.border} ${cfg.glow} ${cfg.text} flex items-center justify-center font-bold text-[10px] shadow-lg transition-transform hover:scale-125 ${
        isSelected ? 'scale-125 ring-8 ring-sky-400' : ''
      }">
            !
          </div>
          <div class="absolute -top-7 hidden group-hover:flex items-center rounded bg-slate-900/95 text-white text-[10px] px-2 py-0.5 border border-slate-700 whitespace-nowrap shadow-md pointer-events-none z-30 font-sans">
            ${incident.location_name}
          </div>
        </div>
      `;

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onSelectIncident(incident);
        map.flyTo({
          center: [incident.longitude, incident.latitude],
          zoom: 14.5,
          speed: 1.2,
        });
      });

      try {
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([incident.longitude, incident.latitude])
          .addTo(map);

        markersRef.current.push(marker);
      } catch (err) {
        console.warn('[TransportMap] Error adding marker:', err);
      }
    });
  }, [basemap, filteredIncidents, selectedIncident, onSelectIncident, isStyleLoaded]);

  // Synchronize Mappls incident markers (when basemap === 'mappls')
  useEffect(() => {
    if (basemap !== 'mappls') return;
    const map = mapplsMapRef.current;
    if (!map || !(window as any).mappls) return;

    mapplsMarkersRef.current.forEach((m) => {
      try {
        if (typeof m.remove === 'function') m.remove();
      } catch (e) {}
    });
    mapplsMarkersRef.current = [];

    filteredIncidents.forEach((incident) => {
      const isSelected = selectedIncident?.id === incident.id;
      const el = document.createElement('div');
      el.className = 'group cursor-pointer relative';

      const colorMap: Record<
        IncidentSeverity,
        { bg: string; border: string; glow: string; text: string }
      > = {
        CRITICAL: {
          bg: 'bg-red-600',
          border: 'border-red-300 ring-4 ring-red-600/40',
          glow: 'animate-radar-critical',
          text: 'text-white',
        },
        HIGH: {
          bg: 'bg-orange-500',
          border: 'border-orange-200 ring-2 ring-orange-500/30',
          glow: '',
          text: 'text-white',
        },
        MEDIUM: {
          bg: 'bg-amber-500',
          border: 'border-amber-200 ring-2 ring-amber-500/30',
          glow: '',
          text: 'text-slate-900',
        },
        LOW: {
          bg: 'bg-emerald-500',
          border: 'border-emerald-200',
          glow: '',
          text: 'text-white',
        },
      };

      const cfg = colorMap[incident.severity] || colorMap.MEDIUM;

      el.innerHTML = `
        <div class="relative flex items-center justify-center">
          <div class="w-7 h-7 rounded-full ${cfg.bg} ${cfg.border} ${cfg.glow} ${cfg.text} flex items-center justify-center font-bold text-[10px] shadow-lg transition-transform hover:scale-125 ${
        isSelected ? 'scale-125 ring-8 ring-sky-400' : ''
      }">
            !
          </div>
          <div class="absolute -top-7 hidden group-hover:flex items-center rounded bg-slate-900/95 text-white text-[10px] px-2 py-0.5 border border-slate-700 whitespace-nowrap shadow-md pointer-events-none z-30 font-sans">
            ${incident.location_name}
          </div>
        </div>
      `;

      try {
        const marker = new (window as any).mappls.Marker({
          map: map,
          position: { lat: incident.latitude, lng: incident.longitude },
          html: el.outerHTML,
          popupHtml: `<strong>${incident.title}</strong><br/>${incident.location_name}`,
        });

        marker.addListener('click', () => {
          onSelectIncident(incident);
          if (typeof map.flyTo === 'function') {
            map.flyTo({
              center: [incident.longitude, incident.latitude],
              zoom: 14.5,
              speed: 1.2,
            });
          }
        });

        mapplsMarkersRef.current.push(marker);
      } catch (err) {
        console.warn('[TransportMap] Error adding Mappls marker:', err);
      }
    });

    return () => {
      mapplsMarkersRef.current.forEach((m) => {
        try {
          if (typeof m.remove === 'function') m.remove();
        } catch (e) {}
      });
      mapplsMarkersRef.current = [];
    };
  }, [basemap, filteredIncidents, selectedIncident, onSelectIncident, isStyleLoaded]);

  // Synchronize TomTom Traffic Flow Raster Layer (on MapLibre)
  useEffect(() => {
    if (basemap === 'mappls') return;
    const map = mapRef.current;
    if (!map || !isStyleLoaded) return;

    const SOURCE_ID = 'tomtom-flow-source';
    const LAYER_ID = 'tomtom-flow-layer';

    if (showTomTomTraffic && tomtomStatus?.is_configured) {
      if (!map.getSource(SOURCE_ID)) {
        try {
          map.addSource(SOURCE_ID, {
            type: 'raster',
            tiles: [api.getTomTomFlowTileUrl()],
            tileSize: 256,
            attribution: '© TomTom Traffic',
            maxzoom: 22,
          });

          map.addLayer({
            id: LAYER_ID,
            type: 'raster',
            source: SOURCE_ID,
            minzoom: 0,
            maxzoom: 22,
            paint: {
              'raster-opacity': 0.85,
            },
          });
        } catch (err) {
          console.warn('[TransportMap] Error adding TomTom flow layer:', err);
        }
      } else {
        if (map.getLayer(LAYER_ID)) {
          map.setLayoutProperty(LAYER_ID, 'visibility', 'visible');
        }
      }
    } else {
      if (map.getLayer(LAYER_ID)) {
        map.setLayoutProperty(LAYER_ID, 'visibility', 'none');
      }
    }
  }, [basemap, isStyleLoaded, showTomTomTraffic, tomtomStatus]);

  // Synchronize TomTom Live Incident Markers (on MapLibre)
  useEffect(() => {
    if (basemap === 'mappls') return;
    const map = mapRef.current;
    if (!map || !isStyleLoaded) return;

    tomtomMarkersRef.current.forEach((m) => m.remove());
    tomtomMarkersRef.current = [];

    if (!showTomTomTraffic || tomtomIncidents.length === 0) return;

    tomtomIncidents.forEach((item) => {
      const el = document.createElement('div');
      el.className = 'group cursor-pointer relative';

      const isCritical = item.magnitude_of_delay === 3;
      const isMajor = item.magnitude_of_delay === 2;
      const colorClass = isCritical
        ? 'bg-rose-600 border-rose-300 ring-2 ring-rose-500/50'
        : isMajor
        ? 'bg-amber-500 border-amber-200 ring-2 ring-amber-500/40'
        : 'bg-amber-600 border-amber-300 ring-1 ring-amber-400/30';

      el.innerHTML = `
        <div class="relative flex items-center justify-center">
          <div class="w-6 h-6 rounded-full ${colorClass} text-white flex items-center justify-center font-bold text-[9px] shadow-lg transition-transform hover:scale-125 border">
            TT
          </div>
          <div class="absolute -top-7 hidden group-hover:flex items-center rounded bg-slate-900/95 text-white text-[10px] px-2 py-0.5 border border-amber-500/40 whitespace-nowrap shadow-md pointer-events-none z-30 font-mono">
            ${item.category ? item.category.toUpperCase() : 'INCIDENT'}: ${item.description || 'TomTom Live'}
          </div>
        </div>
      `;

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const syntheticIncident: Incident = {
          id: `tomtom-${item.id}`,
          title: item.title || item.description || 'Live TomTom Incident',
          description: `${item.description || 'Road incident reported by TomTom Live Traffic'}. Delay: ${
            item.delay_seconds || 0
          }s, Length: ${item.length_meters || 0}m. Source: TomTom Traffic Service.`,
          category: item.category === 'ACCIDENT' ? 'ACCIDENT' : item.category === 'ROADWORK' ? 'ROADWORK' : 'CONGESTION',
          severity: isCritical ? 'CRITICAL' : isMajor ? 'HIGH' : 'MEDIUM',
          status: 'VERIFIED',
          latitude: item.latitude,
          longitude: item.longitude,
          location_name: item.location_name || item.title || 'Live Traffic Corridor',
          corridor: item.location_name || null,
          speed_limit_kmh: null,
          current_speed_kmh: null,
          congestion_level_pct: isCritical ? 85 : isMajor ? 60 : 35,
          affected_lanes: 1,
          tags: ['tomtom', 'live', item.category || 'incident'],
          is_simulated: false,
          data_source: 'tomtom_live',
          created_at: item.start_time || new Date().toISOString(),
          updated_at: item.end_time || new Date().toISOString(),
          resolved_at: null,
        };
        onSelectIncident(syntheticIncident);
        map.flyTo({
          center: [item.longitude, item.latitude],
          zoom: 14.5,
          speed: 1.2,
        });
      });

      try {
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([item.longitude, item.latitude])
          .addTo(map);
        tomtomMarkersRef.current.push(marker);
      } catch (err) {
        console.warn('[TransportMap] Error adding TomTom incident marker:', err);
      }
    });

    return () => {
      tomtomMarkersRef.current.forEach((m) => m.remove());
      tomtomMarkersRef.current = [];
    };
  }, [basemap, isStyleLoaded, showTomTomTraffic, tomtomIncidents, onSelectIncident]);

  // Synchronize TomTom Live Incident markers (on Mappls)
  useEffect(() => {
    if (basemap !== 'mappls') return;
    const map = mapplsMapRef.current;
    if (!map || !(window as any).mappls) return;

    mapplsTomTomMarkersRef.current.forEach((m) => {
      try {
        if (typeof m.remove === 'function') m.remove();
      } catch (e) {}
    });
    mapplsTomTomMarkersRef.current = [];

    if (!showTomTomTraffic || tomtomIncidents.length === 0) return;

    tomtomIncidents.forEach((item) => {
      const isCritical = item.magnitude_of_delay === 3;
      const isMajor = item.magnitude_of_delay === 2;
      const colorClass = isCritical
        ? 'bg-rose-600 border-rose-300 ring-2 ring-rose-500/50'
        : isMajor
        ? 'bg-amber-500 border-amber-200 ring-2 ring-amber-500/40'
        : 'bg-amber-600 border-amber-300 ring-1 ring-amber-400/30';

      const el = document.createElement('div');
      el.className = 'group cursor-pointer relative';
      el.innerHTML = `
        <div class="relative flex items-center justify-center">
          <div class="w-6 h-6 rounded-full ${colorClass} text-white flex items-center justify-center font-bold text-[9px] shadow-lg transition-transform hover:scale-125 border">
            TT
          </div>
          <div class="absolute -top-7 hidden group-hover:flex items-center rounded bg-slate-900/95 text-white text-[10px] px-2 py-0.5 border border-amber-500/40 whitespace-nowrap shadow-md pointer-events-none z-30 font-mono">
            ${item.category ? item.category.toUpperCase() : 'INCIDENT'}: ${item.description || 'TomTom Live'}
          </div>
        </div>
      `;

      try {
        const marker = new (window as any).mappls.Marker({
          map: map,
          position: { lat: item.latitude, lng: item.longitude },
          html: el.outerHTML,
          popupHtml: `<strong>TomTom Incident</strong><br/>${item.description || 'Live Traffic Alert'}`,
        });

        marker.addListener('click', () => {
          const syntheticIncident: Incident = {
            id: `tomtom-${item.id}`,
            title: item.title || item.description || 'Live TomTom Incident',
            description: `${item.description || 'Road incident reported by TomTom Live Traffic'}. Delay: ${
              item.delay_seconds || 0
            }s, Length: ${item.length_meters || 0}m. Source: TomTom Traffic Service.`,
            category: item.category === 'ACCIDENT' ? 'ACCIDENT' : item.category === 'ROADWORK' ? 'ROADWORK' : 'CONGESTION',
            severity: isCritical ? 'CRITICAL' : isMajor ? 'HIGH' : 'MEDIUM',
            status: 'VERIFIED',
            latitude: item.latitude,
            longitude: item.longitude,
            location_name: item.location_name || item.title || 'Live Traffic Corridor',
            corridor: item.location_name || null,
            speed_limit_kmh: null,
            current_speed_kmh: null,
            congestion_level_pct: isCritical ? 85 : isMajor ? 60 : 35,
            affected_lanes: 1,
            tags: ['tomtom', 'live', item.category || 'incident'],
            is_simulated: false,
            data_source: 'tomtom_live',
            created_at: item.start_time || new Date().toISOString(),
            updated_at: item.end_time || new Date().toISOString(),
            resolved_at: null,
          };
          onSelectIncident(syntheticIncident);
          if (typeof map.flyTo === 'function') {
            map.flyTo({
              center: [item.longitude, item.latitude],
              zoom: 14.5,
              speed: 1.2,
            });
          }
        });

        mapplsTomTomMarkersRef.current.push(marker);
      } catch (err) {
        console.warn('[TransportMap] Error adding TomTom incident marker on Mappls:', err);
      }
    });

    return () => {
      mapplsTomTomMarkersRef.current.forEach((m) => {
        try {
          if (typeof m.remove === 'function') m.remove();
        } catch (e) {}
      });
      mapplsTomTomMarkersRef.current = [];
    };
  }, [basemap, showTomTomTraffic, tomtomIncidents, onSelectIncident]);

  const handleRecenter = () => {
    flyToCoordinates(currentLocation.lat, currentLocation.lng, currentLocation.zoom);
  };

  // Mappls Geocode search handler
  const handleMapplsSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim() || searchQuery.length < 2) return;

    setIsSearching(true);
    setSearchError(null);
    setShowSearchResults(true);

    try {
      const res = await api.geocodeMappls(searchQuery);
      if (res.success && res.results && res.results.length > 0) {
        setSearchResults(res.results);
      } else {
        setSearchResults([]);
        if (res.http_status_code === 401 || !res.success) {
          setSearchError(
            res.error ||
              'Mappls Geocoding returned HTTP 401 (Bad client credentials). Server credentials must be authorized with Mappls.'
          );
        } else {
          setSearchError('No matching places found.');
        }
      }
    } catch (err: any) {
      setSearchError(err.message || 'Mappls search failed.');
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectSearchResult = (result: any) => {
    const { longitude, latitude } = result;

    if (basemap === 'mappls' && mapplsMapRef.current) {
      if (typeof mapplsMapRef.current.flyTo === 'function') {
        mapplsMapRef.current.flyTo({
          center: [longitude, latitude],
          zoom: 13.5,
          speed: 1.2,
        });
      }
    } else if (mapRef.current) {
      if (searchMarkerRef.current) {
        searchMarkerRef.current.remove();
      }

      const el = document.createElement('div');
      el.className = 'flex items-center justify-center';
      el.innerHTML = `
        <div class="h-6 w-6 rounded-full bg-sky-500 border-2 border-white text-white flex items-center justify-center shadow-lg animate-bounce">
          📍
        </div>
      `;

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([longitude, latitude])
        .addTo(mapRef.current);
      searchMarkerRef.current = marker;

      mapRef.current.flyTo({
        center: [longitude, latitude],
        zoom: 13.5,
        speed: 1.2,
      });
    }

    const bbox: [number, number, number, number] = [
      roundCoord(longitude - 0.25),
      roundCoord(latitude - 0.25),
      roundCoord(longitude + 0.25),
      roundCoord(latitude + 0.25),
    ];
    fetchTrafficForBbox(bbox, { lat: latitude, lng: longitude });

    setShowSearchResults(false);
  };

  const basemapOptions: { id: BasemapProvider; label: string; badge: string; isKeyless: boolean }[] = [
    {
      id: 'mappls',
      label: 'Mappls Enterprise Map',
      badge: mapplsStaticKey ? 'Official SDK v3.0' : 'Key Required',
      isKeyless: false,
    },
    {
      id: 'light-canvas',
      label: 'Light Gray Canvas',
      badge: 'Keyless (Professional)',
      isKeyless: true,
    },
    {
      id: 'dark-canvas',
      label: 'Dark Gray Canvas',
      badge: 'Keyless Dark',
      isKeyless: true,
    },
    {
      id: 'carto',
      label: 'CARTO Dark Matter',
      badge: cartoApiKey ? 'Key Configured' : 'Key Required',
      isKeyless: false,
    },
    {
      id: 'openfreemap',
      label: 'OpenFreeMap Dark',
      badge: 'Keyless Vector',
      isKeyless: true,
    },
    {
      id: 'osm',
      label: 'OpenStreetMap Standard',
      badge: 'Keyless Raster',
      isKeyless: true,
    },
  ];

  return (
    <div className="relative w-full h-[600px] rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-[#060a12] overflow-hidden shadow-xs dark:shadow-2xl transition-colors">
      {/* Top Map Action Toolbar */}
      <div className="absolute top-3 left-3 right-3 z-10 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        {/* Left Toolbar Items */}
        <div className="flex flex-wrap items-center gap-1.5 pointer-events-auto">
          {/* Quick Location Preset Selector */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setIsLocationMenuOpen(!isLocationMenuOpen);
                setIsBasemapMenuOpen(false);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-sky-300 dark:border-sky-500/40 bg-white/95 dark:bg-[#0b1120]/95 backdrop-blur-md px-3 py-1.5 text-xs font-bold text-sky-700 dark:text-sky-300 hover:border-sky-400 transition-colors shadow-sm"
              title="Select City or Geographic Area"
            >
              <MapPin className="h-3.5 w-3.5 text-sky-500 shrink-0" />
              <span>{currentLocation.name}</span>
              <span className="text-[10px] font-mono font-normal opacity-80">
                ({currentLocation.state === 'Karnataka' ? 'KA' : 'TN'})
              </span>
              <ChevronDown className="h-3 w-3 opacity-60 ml-0.5" />
            </button>

            {isLocationMenuOpen && (
              <div className="absolute left-0 mt-1 w-72 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b1120] backdrop-blur-md p-1.5 shadow-2xl z-40 space-y-1">
                <div className="px-2.5 py-1 text-[10px] font-mono uppercase text-slate-400 tracking-wider">
                  Select Geographic Area (Tamil Nadu & Karnataka):
                </div>
                <div className="max-h-64 overflow-y-auto space-y-0.5 pr-1">
                  {LOCATION_PRESETS.map((loc) => {
                    const isSelected = currentLocation.id === loc.id;
                    return (
                      <button
                        key={loc.id}
                        type="button"
                        onClick={() => handleSelectLocationPreset(loc)}
                        className={`w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                          isSelected
                            ? 'bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300 font-bold border border-sky-200 dark:border-sky-500/30'
                            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        <div className="text-left">
                          <p className="leading-none flex items-center gap-1.5">
                            <span>{loc.name}</span>
                            <span className="text-[10px] font-mono text-slate-400">({loc.state})</span>
                          </p>
                          <span className="text-[10px] text-slate-400 font-sans mt-0.5 inline-block">
                            {loc.description}
                          </span>
                        </div>
                        {isSelected && <Check className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Basemap Switcher Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setIsBasemapMenuOpen(!isBasemapMenuOpen);
                setIsLocationMenuOpen(false);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-[#0b1120]/95 backdrop-blur-md px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors shadow-xs"
            >
              <MapIcon className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
              <span>{basemapOptions.find((b) => b.id === basemap)?.label || 'Canvas'}</span>
              <ChevronDown className="h-3 w-3 opacity-60 ml-0.5" />
            </button>

            {isBasemapMenuOpen && (
              <div className="absolute left-0 mt-1 w-64 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b1120] backdrop-blur-md p-1.5 shadow-xl z-30 space-y-1">
                <div className="px-2 py-1 text-[10px] font-mono uppercase text-slate-400 tracking-wider">
                  Select Basemap Provider:
                </div>
                {basemapOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setBasemap(opt.id);
                      setIsBasemapMenuOpen(false);
                    }}
                    className={`w-full flex items-center justify-between rounded-lg px-2.5 py-2 text-xs transition-colors ${
                      basemap === opt.id
                        ? 'bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300 font-semibold border border-sky-200 dark:border-sky-500/30'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <div className="text-left">
                      <p className="leading-none">{opt.label}</p>
                      <span className="text-[10px] text-slate-400 font-mono mt-0.5 inline-block">
                        {opt.badge}
                      </span>
                    </div>
                    {basemap === opt.id && <Check className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* TomTom Live Traffic Toggle */}
          {tomtomStatus?.is_configured && (
            <button
              type="button"
              onClick={() => setShowTomTomTraffic(!showTomTomTraffic)}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all shadow-xs backdrop-blur-md ${
                showTomTomTraffic
                  ? 'bg-amber-50 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 font-semibold border-amber-300 dark:border-amber-600/50'
                  : 'bg-white/95 dark:bg-[#0b1120]/95 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800'
              }`}
              title="Toggle live TomTom traffic flow and incident overlay"
            >
              <Zap className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
              <span>Traffic {tomtomIncidents.length > 0 ? `(${tomtomIncidents.length})` : ''}</span>
            </button>
          )}

          {/* Manual Refresh Button */}
          {tomtomStatus?.is_configured && (
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={isRefreshingTraffic}
              className="flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-[#0b1120]/95 backdrop-blur-md px-2 py-1.5 text-xs font-mono text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors shadow-xs disabled:opacity-50"
              title="Manually refresh traffic data for visible area"
            >
              <RotateCw className={`h-3 w-3 ${isRefreshingTraffic ? 'animate-spin text-sky-500' : ''}`} />
              <span className="hidden md:inline">{isRefreshingTraffic ? 'Syncing...' : lastTrafficSyncTime || 'Sync'}</span>
            </button>
          )}

          {/* Recenter / Reset Button */}
          <button
            type="button"
            onClick={handleRecenter}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-[#0b1120]/95 backdrop-blur-md px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors shadow-xs"
            title={`Recenter to ${currentLocation.name}`}
          >
            <RotateCcw className="h-3.5 w-3.5 text-slate-500" />
            <span className="hidden sm:inline">Reset</span>
          </button>
        </div>

        {/* Right Toolbar: Place Search Input */}
        <div className="relative pointer-events-auto">
          <form onSubmit={handleMapplsSearch} className="flex items-center">
            <div className="relative flex items-center">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search location (TN / Bengaluru)..."
                className="w-44 sm:w-60 rounded-lg border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-[#0b1120]/95 backdrop-blur-md py-1.5 pl-8 pr-7 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 shadow-xs focus:border-sky-500"
              />
              <Search className="absolute left-2.5 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setShowSearchResults(false);
                  }}
                  className="absolute right-2 text-slate-400 hover:text-slate-700 dark:hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <button
              type="submit"
              disabled={isSearching}
              className="ml-1 rounded-lg border border-sky-300 dark:border-sky-500/40 bg-sky-50 dark:bg-sky-950/60 px-2 py-1.5 text-xs font-semibold text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/60 shadow-xs"
            >
              {isSearching ? '...' : 'Find'}
            </button>
          </form>

          {/* Search Results Dropdown */}
          {showSearchResults && (
            <div className="absolute right-0 mt-1 w-80 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b1120] backdrop-blur-md p-2 shadow-2xl z-40 max-h-60 overflow-y-auto">
              <div className="flex items-center justify-between pb-1 mb-1 border-b border-slate-200 dark:border-slate-800 text-[10px] font-mono text-slate-500">
                <span>Location Results:</span>
                <button
                  type="button"
                  onClick={() => setShowSearchResults(false)}
                  className="text-slate-500 hover:text-slate-800 dark:hover:text-white"
                >
                  Close
                </button>
              </div>

              {searchError ? (
                <div className="p-2 text-xs text-amber-300 bg-amber-950/40 border border-amber-800/40 rounded-lg flex items-start gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <span className="text-[11px] leading-relaxed">{searchError}</span>
                </div>
              ) : searchResults.length === 0 ? (
                <div className="p-2 text-xs text-slate-400 text-center">No locations found.</div>
              ) : (
                <div className="space-y-1">
                  {searchResults.map((item, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSelectSearchResult(item)}
                      className="w-full text-left p-2 rounded-lg text-xs hover:bg-slate-100 dark:hover:bg-slate-800/60 text-slate-800 dark:text-slate-200 transition-colors"
                    >
                      <p className="font-semibold text-slate-900 dark:text-white truncate">{item.formatted_address}</p>
                      <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                        {item.latitude.toFixed(4)}, {item.longitude.toFixed(4)}
                        {item.city ? ` • ${item.city}` : ''}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* MapLibre GL Map Canvas Container */}
      <div
        ref={mapContainerRef}
        id="maplibre-canvas-container"
        className="w-full h-full"
        style={{ display: basemap === 'mappls' ? 'none' : 'block' }}
      />

      {/* Official Mappls Web Maps SDK v3.0 Canvas Container */}
      <div
        ref={mapplsContainerRef}
        id="mappls-canvas-container"
        className="w-full h-full"
        style={{ display: basemap === 'mappls' ? 'block' : 'none' }}
      />

      {/* Mappls Loading State */}
      {basemap === 'mappls' && isMapplsLoading && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-900/80 backdrop-blur-sm text-white">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-sky-400 border-t-transparent mb-3" />
          <p className="text-sm font-semibold tracking-wide">Loading Mappls Web Maps SDK v3.0...</p>
          <span className="text-xs text-slate-400 mt-1">Exploring {currentLocation.name}, {currentLocation.state}</span>
        </div>
      )}

      {/* Mappls Error / Fallback State */}
      {basemap === 'mappls' && mapplsError && (
        <div className="absolute top-16 left-4 z-20 max-w-md rounded-xl border border-red-500/50 bg-red-950/95 backdrop-blur-md p-4 text-xs text-red-200 shadow-2xl">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-white text-sm">Mappls SDK Notice</p>
              <p className="mt-1 text-[11px] leading-relaxed text-red-200">{mapplsError}</p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setBasemap('dark-canvas')}
                  className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 border border-slate-700 transition-colors"
                >
                  Switch to Esri Dark Canvas
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Connection Warning Banner */}
      {trafficError && (
        <div className="absolute bottom-12 left-4 z-10 max-w-md rounded-lg border border-amber-500/50 bg-amber-950/90 backdrop-blur-md p-2.5 text-xs text-amber-200 flex items-start gap-2 shadow-xl">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span>{trafficError}</span>
            <button
              type="button"
              onClick={() => setTrafficError(null)}
              className="ml-2 text-sky-400 hover:underline"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Legal Attribution Bar */}
      <div className="absolute bottom-1 left-2 z-10 text-[10px] font-mono text-slate-400 bg-slate-950/70 px-2 py-0.5 rounded backdrop-blur-sm pointer-events-none">
        © TomTom Live Traffic • © MapmyIndia / Mappls • © Esri, HERE, Garmin • © OpenStreetMap contributors
      </div>

      {/* Coordinates readout bar in footer */}
      {cursorCoords && (
        <div className="absolute bottom-4 right-16 z-10 hidden sm:flex items-center gap-2 rounded-md border border-slate-800 bg-[#080d1a]/90 backdrop-blur-md px-2.5 py-1 text-[11px] font-mono text-slate-400">
          <Compass className="h-3 w-3 text-sky-400" />
          <span>
            {cursorCoords.lat >= 0 ? `${cursorCoords.lat}° N` : `${Math.abs(cursorCoords.lat)}° S`},{' '}
            {cursorCoords.lng >= 0 ? `${cursorCoords.lng}° E` : `${Math.abs(cursorCoords.lng)}° W`}
          </span>
        </div>
      )}

      {/* Map Legend */}
      <MapLegend />

      {/* Synchronized Selected Incident Detail Panel */}
      <IncidentDetailPanel
        incident={selectedIncident}
        onClose={() => onSelectIncident(null)}
        onUpdateStatus={onUpdateStatus}
      />
    </div>
  );
};

function roundCoord(val: number): number {
  return parseFloat(val.toFixed(4));
}
